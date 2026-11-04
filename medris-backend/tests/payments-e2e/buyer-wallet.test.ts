/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { describe, expect, it } from "vitest";
import { api, shopRefunds, json, newOrder, payOrder, rowOf, runJob, sendWebhook, startPayment, useWorld } from "./harness.js";

// Migration 0019: a buyer with a refund account gets refunds in a wallet (not on the card) and withdraws them to the bank.
describe("the buyer's refunds wallet", () => {
  const w = useWorld();
  const call = async (name: string, token: string, body: Record<string, unknown> = {}) => json(await api.post(w, `/rpc/${name}`, token, body));
  const save = (token: string) => call("save_refund_account", token, { p_bank_code: "057", p_account_number: "0123456789", p_confirmed_name: "Obi Ada", p_password: "right-password-123" });

  it("a refund lands in the Levromart wallet, whether or not the buyer saved a bank account (migration 0033)", async () => {
    const o = await newOrder(w, 5000, "confirmed", w.buyer2.id);
    const started = await startPayment(w, o, w.buyer2.token);
    await sendWebhook(w, "charge.success", w.paystack.completeCheckout(started.data.reference));
    expect((await call("buyer_cancel_order", w.buyer2.token, { p_order_id: o })).status).toBe(200);
    expect((await shopRefunds(w, o)).status).toBe(200);
    await runJob(w, "paystack-refunds");
    expect(w.paystack.callsTo("POST", "/refund")).toHaveLength(0);
    expect(await rowOf(w, `select 1 as x from public.refund_credits where order_id = $1`, [o])).toBeFalsy();
    expect((await call("get_levro_wallet", w.buyer2.token)).data.balance_kobo).toBe("485000");
  });

  it("the name must match; then the account is saved without the full number", async () => {
    expect((await call("save_refund_account", w.buyer.token, { p_bank_code: "057", p_account_number: "0123456789", p_confirmed_name: "Somebody Else", p_password: "right-password-123" })).status).toBe(400);
    expect((await call("save_refund_account", w.buyer.token, { p_bank_code: "057", p_account_number: "0123456789", p_confirmed_name: "Obi Ada" })).status).toBe(400); // no password
    expect((await call("save_refund_account", w.buyer.token, { p_bank_code: "057", p_account_number: "0123456789", p_confirmed_name: "Obi Ada", p_password: "nope" })).status).toBe(403);
    expect((await call("save_refund_account", w.buyer.token, { p_bank_code: "057", p_account_number: "12", p_confirmed_name: "Obi Ada", p_password: "right-password-123" })).status).toBe(400);
    expect((await save(w.buyer.token)).status).toBe(200);
    const s = await call("get_refund_wallet", w.buyer.token);
    expect(s.data).toMatchObject({ has_account: true, available_kobo: "0" });
    expect(JSON.stringify(s.data)).not.toContain("0123456789");
  });

  // Refund money that was waiting in the old refunds wallet is moved into the Levromart wallet by migration 0033. The old
  // withdrawal path is kept for any such money (an older backend still running during the switch); it is tested here.
  const oldCredit = async (kobo: number) => {
    const o = await newOrder(w, kobo / 100);
    await payOrder(w, o);
    const ref = await rowOf<any>(w, `insert into public.paystack_refunds (transaction_reference, order_id, attempt, amount_kobo, reason, source, status)
      select provider_reference, order_id, 1, $2, 'old', 'admin', 'processed' from public.payments where order_id = $1 and status = 'paid' limit 1 returning id`, [o, kobo]);
    await w.db.query(`insert into public.refund_credits (buyer_id, order_id, refund_id, amount_kobo) values ($1, $2, $3, $4)`, [w.buyer.id, o, ref.id, kobo]);
    return o;
  };

  it("old refund money is withdrawn to the bank, and a failed transfer puts it back", async () => {
    const o = await oldCredit(500000);
    expect((await call("get_refund_wallet", w.buyer.token)).data.available_kobo).toBe("500000");
    expect((await call("withdraw_refunds", w.buyer2.token)).status).toBe(400); // no account
    expect((await call("withdraw_refunds", w.buyer.token)).status).toBe(200);
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(1);
    expect((await call("withdraw_refunds", w.buyer.token)).status).toBe(400); // nothing left
    const wd = await rowOf<any>(w, `select transfer_reference as ref from public.refund_withdrawals where buyer_id = $1 and status = 'processing'`, [w.buyer.id]);
    expect(wd.ref).toMatch(/^lvm_bw_/);
    await sendWebhook(w, "transfer.success", { reference: wd.ref });
    expect((await rowOf<any>(w, `select status from public.refund_credits where order_id = $1`, [o])).status).toBe("sent");
    const o2 = await oldCredit(300000);
    expect((await call("withdraw_refunds", w.buyer.token)).status).toBe(200);
    const wd2 = await rowOf<any>(w, `select transfer_reference as ref from public.refund_withdrawals where status = 'processing' and buyer_id = $1`, [w.buyer.id]);
    await sendWebhook(w, "transfer.failed", { reference: wd2.ref, reason: "Account closed" });
    expect((await call("get_refund_wallet", w.buyer.token)).data.available_kobo).toBe("300000");
    void o2;
  });
});
