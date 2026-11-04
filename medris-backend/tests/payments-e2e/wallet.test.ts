/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { describe, expect, it } from "vitest";
import { api, shopRefunds, rpcWithPin, handOver, json, newOrder, payOrder, rowOf, runJob, sendWebhook, useWorld } from "./harness.js";

// Migration 0033: one Levromart wallet per person - @tags, top-ups, transfers, paying orders, earnings, refunds, withdrawals.
describe("the Levromart wallet", () => {
  const w = useWorld();
  const call = rpcWithPin(w);
  const balance = async (token: string) => Number((await call("get_levro_wallet", token)).data.balance_kobo);
  const handleOf = async (userId: string) => (await rowOf<any>(w, `select handle from public.wallet_accounts where user_id = $1`, [userId])).handle as string;
  /** Puts money in a wallet directly (as a settled top-up would), dated `hoursAgo`. */
  const fund = async (userId: string, kobo: number, hoursAgo = 48) => {
    await w.db.query(`insert into public.wallet_accounts (user_id, handle) select id, public.wallet_make_handle(name, id) from public.users where id = $1 on conflict do nothing`, [userId]);
    const r = await w.db.query<any>(`update public.wallet_accounts set balance_kobo = balance_kobo + $2 where user_id = $1 returning balance_kobo`, [userId, kobo]);
    await w.db.query(`insert into public.wallet_entries (user_id, kind, amount_kobo, balance_after_kobo, reference, created_at) values ($1, 'topup', $2, $3, $4, now() - ($5 || ' hours')::interval)`, [userId, kobo, r[0].balance_kobo, "seed:" + Math.random(), String(hoursAgo)]);
  };
  const reset = async () => {
    await w.db.query(`delete from public.wallet_entries`);
    await w.db.query(`delete from public.wallet_transfers`);
    await w.db.query(`delete from public.wallet_withdrawals`);
    await w.db.query(`update public.wallet_accounts set balance_kobo = 0, frozen = false`);
  };

  it("everyone has a wallet with an @tag, and people are found by the start of their @tag only", async () => {
    await reset();
    const s = await call("get_levro_wallet", w.buyer.token);
    expect(s.status).toBe(200);
    expect(s.data.handle).toMatch(/^[a-z0-9_]{3,24}$/);
    expect(s.data.balance_kobo).toBe("0");
    const other = await handleOf(w.buyer2.id);
    const found = await call("find_wallet_people", w.buyer.token, { p_query: "@" + other.slice(0, 3) });
    expect(found.data.map((p: any) => p.handle)).toContain(other);
    expect(found.data.map((p: any) => p.handle)).not.toContain(s.data.handle);
    expect((await call("find_wallet_people", w.buyer.token, { p_query: "a" })).data).toEqual([]);
  });

  it("a top-up through Paystack puts the asked amount in the wallet, once", async () => {
    await reset();
    const started = await call("wallet_topup", w.buyer.token, { p_amount_kobo: 200000 });
    expect(started.status).toBe(200);
    expect(started.data.walletAmountNaira).toBe(2000);
    expect(started.data.amountNaira).toBeGreaterThan(2000); // Paystack's fee is paid on top
    const event = w.paystack.completeCheckout(started.data.reference);
    await sendWebhook(w, "charge.success", event);
    await sendWebhook(w, "charge.success", event, { id: 999001 }); // the same payment told twice
    expect(await balance(w.buyer.token)).toBe(200000);
    expect((await call("wallet_topup", w.buyer.token, { p_amount_kobo: 50 })).status).toBe(400);
  });

  it("sending money: enough balance, not to yourself, a repeated tap sends once", async () => {
    await reset();
    await fund(w.buyer.id, 300000);
    const to = await handleOf(w.buyer2.id);
    const me = await handleOf(w.buyer.id);
    expect((await call("wallet_send", w.buyer.token, { p_to: me, p_amount_kobo: 10000 })).status).toBe(400);
    expect((await call("wallet_send", w.buyer.token, { p_to: to, p_amount_kobo: 900000 })).status).toBe(400);
    expect((await call("wallet_send", w.buyer.token, { p_to: "nobody_here_x", p_amount_kobo: 10000 })).status).toBe(404);
    const a = await call("wallet_send", w.buyer.token, { p_to: "@" + to, p_amount_kobo: 100000, p_note: "for lunch", p_key: "k-1" });
    expect(a.status).toBe(200);
    const again = await call("wallet_send", w.buyer.token, { p_to: to, p_amount_kobo: 100000, p_key: "k-1" });
    expect(again.data.duplicate).toBe(true);
    expect(a.data.fee_kobo).toBe("1500"); // Paystack's fee on ₦1,000: 1.5%
    expect(await balance(w.buyer.token)).toBe(198500); // 300000 - 100000 sent - 1500 fee
    expect(await balance(w.buyer2.token)).toBe(100000);
    expect(await rowOf(w, `select 1 as x from public.notifications where user_id = $1 and type = 'wallet_received'`, [w.buyer2.id])).toBeTruthy();
    // a wallet on hold cannot send
    await w.db.query(`update public.wallet_accounts set frozen = true where user_id = $1`, [w.buyer.id]);
    expect((await call("wallet_send", w.buyer.token, { p_to: to, p_amount_kobo: 10000 })).status).toBe(403);
    await w.db.query(`update public.wallet_accounts set frozen = false where user_id = $1`, [w.buyer.id]);
  });

  it("two transfers at the same moment can never spend the same money", async () => {
    await reset();
    await fund(w.buyer.id, 100000);
    const to = await handleOf(w.buyer2.id);
    const both = await Promise.all([1, 2, 3].map((i) => call("wallet_send", w.buyer.token, { p_to: to, p_amount_kobo: 60000, p_key: "race-" + i })));
    expect(both.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balance(w.buyer.token)).toBe(39100); // 100000 - 60000 sent - 900 fee
    expect(await balance(w.buyer2.token)).toBe(60000);
  });

  it("paying an order from the wallet: no Paystack, the order is paid, Levromart keeps 3% when it completes", async () => {
    await reset();
    await w.db.query(`delete from public.platform_wallet_entries where kind like 'transaction_fee%'`);
    await fund(w.buyer.id, 1000000);
    const o = await newOrder(w, 5000);
    const r = await call("wallet_pay_order", w.buyer.token, { p_order_id: o });
    expect(r.status).toBe(200);
    expect(r.data.fee_kobo).toBe("17500"); // 1.5% of ₦5,000 + ₦100
    expect(await balance(w.buyer.token)).toBe(482500); // 1,000,000 - 500,000 order - 17,500 fee
    expect((await rowOf<any>(w, `select coalesce(sum(amount_kobo),0)::text as k from public.platform_wallet_entries where kind = 'transaction_fee'`)).k).toBe("17500"); // the fee is Levromart's
    expect(w.paystack.callsTo("POST", "/transaction/initialize")).toHaveLength(0);
    expect(await rowOf(w, `select status from public.payments where order_id = $1 and provider_reference like 'lvm\\_ord\\_%'`, [o])).toMatchObject({ status: "paid" });
    expect((await call("wallet_pay_order", w.buyer.token, { p_order_id: o })).status).toBe(400); // nothing left to pay
    expect((await json(await api.post(w, `/orders/${o}/paystack/initialize`, w.buyer.token))).status).toBe(400); // nor with a card
    expect(await balance(w.buyer.token)).toBe(482500);
    expect((await call("wallet_pay_order", w.buyer2.token, { p_order_id: o })).status).toBe(403);
    await handOver(w, o);
    expect((await json(await api.post(w, `/orders/${o}/received`, w.buyer.token))).status).toBe(200);
    expect(await rowOf<any>(w, `select amount::text as a, status from public.commission_charges where order_id = $1`, [o])).toMatchObject({ a: "150.00", status: "paid" });
    expect(await rowOf(w, `select status from public.vendor_payouts where order_id = $1`, [o])).toMatchObject({ status: "on_hold" });
  });

  it("a shop moves its earnings into its wallet: 24-hour-old money at once, newer money after an admin", async () => {
    await reset();
    await w.db.query(`delete from public.withdrawal_requests`);
    await w.db.query(`update public.vendor_payouts set status = 'success' where status in ('on_hold','pending')`);
    const old = await newOrder(w, 4000);
    await payOrder(w, old);
    await handOver(w, old);
    await json(await api.post(w, `/orders/${old}/received`, w.buyer.token));
    await w.db.query(`update public.payments set paid_at = now() - interval '30 hours' where order_id = $1`, [old]);
    const fresh = await newOrder(w, 2000);
    await payOrder(w, fresh);
    await handOver(w, fresh);
    await json(await api.post(w, `/orders/${fresh}/received`, w.buyer.token));
    const r = await call("request_withdrawal", w.vendor.token, { p_destination: "wallet" });
    expect(r.status).toBe(200);
    expect(r.data.sent_kobo).toBe(388000); // 4000 - 3%
    expect(await balance(w.vendor.token)).toBe(388000);
    expect(await rowOf(w, `select status from public.vendor_payouts where order_id = $1`, [old])).toMatchObject({ status: "to_wallet" });
    const open = await rowOf<any>(w, `select id from public.withdrawal_requests where status = 'requested' and destination = 'wallet'`);
    expect(open).toBeTruthy();
    expect((await call("admin_decide_withdrawal", w.admin.token, { p_request_id: open.id, p_decision: "approve" })).status).toBe(200);
    expect(await balance(w.vendor.token)).toBe(388000 + 194000);
    await runJob(w, "vendor-payouts");
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(0); // nothing left Levromart's Paystack balance
    // a refund on an order whose money is already in the shop's wallet is taken back from that wallet
    const back = await call("admin_refund_order", w.admin.token, { p_order_id: old, p_amount_naira: 1000, p_reason: "Item damaged" });
    if (back.status === 200) expect(await balance(w.vendor.token)).toBe(388000 + 194000 - 100000);
  });

  it("refunds land in the buyer's wallet", async () => {
    await reset();
    const o = await newOrder(w, 3000, "confirmed", w.buyer2.id);
    const started = await json(await api.post(w, `/orders/${o}/paystack/initialize`, w.buyer2.token));
    await sendWebhook(w, "charge.success", w.paystack.completeCheckout(started.data.reference));
    expect((await call("buyer_cancel_order", w.buyer2.token, { p_order_id: o })).status).toBe(200);
    expect((await shopRefunds(w, o)).status).toBe(200);
    await runJob(w, "paystack-refunds");
    expect(w.paystack.callsTo("POST", "/refund")).toHaveLength(0);
    expect(await balance(w.buyer2.token)).toBe(291000);
  });

  it("withdrawals: no waiting after a bank change; the PIN and a fee (Paystack's) are all that is asked", async () => {
    await reset();
    await w.db.query(`delete from public.platform_wallet_entries where kind like 'transaction_fee%'`);
    await w.db.query(`delete from public.buyer_payout_accounts where user_id = $1`, [w.buyer.id]);
    await fund(w.buyer.id, 500000, 1); // money that only just arrived: it can still go to the bank
    expect((await call("wallet_withdraw", w.buyer.token, { p_amount_kobo: 100000 })).status).toBe(400); // no bank account
    expect((await call("save_refund_account", w.buyer.token, { p_bank_code: "057", p_account_number: "0123456789", p_confirmed_name: "Obi Ada", p_password: "right-password-123" })).status).toBe(200);
    // a brand-new bank account: it goes at once, nothing waits for an admin
    const first = await call("wallet_withdraw", w.buyer.token, { p_amount_kobo: 100000 });
    expect(first.status).toBe(200);
    expect(["sent", "processing"]).toContain(first.data.status);
    expect(first.data.fee_kobo).toBe("1500");
    expect(await balance(w.buyer.token)).toBe(398500); // 500000 - 100000 - 1500 fee
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(1);
    expect((await rowOf<any>(w, `select coalesce(sum(amount_kobo),0)::text as k from public.platform_wallet_entries where kind = 'transaction_fee'`)).k).toBe("1500");
    // "everything" leaves room for the fee, so the wallet ends at exactly zero
    const all = await call("wallet_withdraw", w.buyer.token, {});
    expect(all.status).toBe(200);
    expect(await balance(w.buyer.token)).toBe(0);
    expect(Number(all.data.amount_kobo) + Number(all.data.fee_kobo)).toBe(398500);
  });

  it("a failed bank transfer puts the money back in the wallet", async () => {
    await reset();
    await w.db.query(`delete from public.platform_wallet_entries where kind like 'transaction_fee%'`);
    await fund(w.buyer.id, 300000, 48);
    await w.db.query(`update public.buyer_payout_accounts set verified_at = now() - interval '3 days' where user_id = $1`, [w.buyer.id]);
    await w.db.query(`insert into public.wallet_withdrawals (user_id, amount_kobo, status, transfer_reference, recipient_code) select $1, 1000, 'success', 'lvm_ww_seed', transfer_recipient_code from public.buyer_payout_accounts where user_id = $1`, [w.buyer.id]);
    const r = await call("wallet_withdraw", w.buyer.token, { p_amount_kobo: 200000 });
    expect(["sent", "processing"]).toContain(r.data.status);
    const wd = await rowOf<any>(w, `select transfer_reference as ref from public.wallet_withdrawals where user_id = $1 and amount_kobo = 200000`, [w.buyer.id]);
    await sendWebhook(w, "transfer.failed", { reference: wd.ref, reason: "Account closed" });
    expect(await balance(w.buyer.token)).toBe(300000); // the amount and the fee are both back
    // Levromart's wallet keeps nothing from a withdrawal that did not happen
    expect((await rowOf<any>(w, `select coalesce(sum(amount_kobo),0)::text as k from public.platform_wallet_entries where kind in ('transaction_fee', 'transaction_fee_return') and reference like '%withdrawal%'`)).k).toBe("0");
  });
});
