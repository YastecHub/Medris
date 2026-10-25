/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { describe, expect, it } from "vitest";
import { api, json, newOrder, payOrder, rowOf, runJob, sendWebhook, startPayment, useWorld } from "./harness.js";

// Migration 0019: a buyer with a refund account gets refunds in a wallet (not on the card) and withdraws them to the bank.
describe("the buyer's refunds wallet", () => {
  const w = useWorld();
  const call = async (name: string, token: string, body: Record<string, unknown> = {}) => json(await api.post(w, `/rpc/${name}`, token, body));
  const save = (token: string) => call("save_refund_account", token, { p_bank_code: "057", p_account_number: "0123456789", p_confirmed_name: "Obi Ada" });

  it("a buyer without an account is refunded on the card as before", async () => {
    const o = await newOrder(w, 5000, "confirmed", w.buyer2.id);
    const started = await startPayment(w, o, w.buyer2.token);
    await sendWebhook(w, "charge.success", w.paystack.completeCheckout(started.data.reference));
    expect((await call("buyer_cancel_order", w.buyer2.token, { p_order_id: o })).status).toBe(200);
    await runJob(w, "paystack-refunds");
    expect(w.paystack.callsTo("POST", "/refund")).toHaveLength(1);
    expect(await rowOf(w, `select 1 as x from public.refund_credits where order_id = $1`, [o])).toBeFalsy();
  });

  it("the name must match; then the account is saved without the full number", async () => {
    expect((await call("save_refund_account", w.buyer.token, { p_bank_code: "057", p_account_number: "0123456789", p_confirmed_name: "Somebody Else" })).status).toBe(400);
    expect((await call("save_refund_account", w.buyer.token, { p_bank_code: "057", p_account_number: "12", p_confirmed_name: "Obi Ada" })).status).toBe(400);
    expect((await save(w.buyer.token)).status).toBe(200);
    const s = await call("get_refund_wallet", w.buyer.token);
    expect(s.data).toMatchObject({ has_account: true, available_kobo: "0" });
    expect(JSON.stringify(s.data)).not.toContain("0123456789");
  });

  it("refunds go into the wallet, then are withdrawn to the bank", async () => {
    w.paystack.reset();
    const o = await newOrder(w, 5000);
    await payOrder(w, o);
    expect((await call("buyer_cancel_order", w.buyer.token, { p_order_id: o })).status).toBe(200);
    await runJob(w, "paystack-refunds");
    expect(w.paystack.callsTo("POST", "/refund")).toHaveLength(0);
    expect((await rowOf<any>(w, `select amount_kobo::text as k, status from public.refund_credits where order_id = $1`, [o]))).toMatchObject({ k: "500000", status: "available" });
    expect((await rowOf<any>(w, `select status from public.paystack_refunds where order_id = $1`, [o])).status).toBe("processed");
    await runJob(w, "paystack-refunds"); // a second run credits nothing twice
    expect((await call("get_refund_wallet", w.buyer.token)).data.available_kobo).toBe("500000");

    // a freshly saved account waits a day
    const early = await call("withdraw_refunds", w.buyer.token);
    expect(early.status).toBe(400);
    await w.db.query(`update public.buyer_payout_accounts set verified_at = now() - interval '2 days' where user_id = $1`, [w.buyer.id]);
    expect((await call("withdraw_refunds", w.buyer2.token)).status).toBe(400); // no account
    const ok = await call("withdraw_refunds", w.buyer.token);
    expect(ok.status).toBe(200);
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(1);
    expect((await call("withdraw_refunds", w.buyer.token)).status).toBe(400); // nothing left
    const wd = await rowOf<any>(w, `select transfer_reference as ref, status from public.refund_withdrawals where buyer_id = $1`, [w.buyer.id]);
    expect(wd.ref).toMatch(/^lvm_bw_/);
    await sendWebhook(w, "transfer.success", { reference: wd.ref });
    expect((await rowOf<any>(w, `select status from public.refund_withdrawals where buyer_id = $1`, [w.buyer.id])).status).toBe("success");
    expect((await rowOf<any>(w, `select status from public.refund_credits where order_id = $1`, [o])).status).toBe("sent");
  });

  it("a failed transfer puts the money back in the wallet", async () => {
    const o = await newOrder(w, 3000);
    await payOrder(w, o);
    await call("buyer_cancel_order", w.buyer.token, { p_order_id: o });
    await runJob(w, "paystack-refunds");
    expect((await call("withdraw_refunds", w.buyer.token)).status).toBe(200);
    const wd = await rowOf<any>(w, `select transfer_reference as ref from public.refund_withdrawals where status = 'processing' and buyer_id = $1`, [w.buyer.id]);
    await sendWebhook(w, "transfer.failed", { reference: wd.ref, reason: "Account closed" });
    expect((await call("get_refund_wallet", w.buyer.token)).data.available_kobo).toBe("300000");
  });
});
