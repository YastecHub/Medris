import { describe, expect, it } from "vitest";
import { grossUpForBuyerFees } from "../../src/integrations/paystack/index.js";
import { api, json, newOrder, rowOf, runJob, sendWebhook, startPayment, useWorld } from "./harness.js";

describe("an order paid in full through Paystack (end to end)", () => {
  const w = useWorld();

  it("initialize -> pay -> webhook -> order paid -> buyer confirms -> payout sent -> transfer.success", async () => {
    const orderId = await newOrder(w, 5000);

    // 1. initialize: the amount comes from the server (the order amount plus Paystack's fee), never from the client
    const started = await startPayment(w, orderId);
    expect(started.status).toBe(200);
    const { grossKobo } = grossUpForBuyerFees(500000);
    expect(started.data.amountNaira).toBe(grossKobo / 100);
    const init = w.paystack.callsTo("POST", "/transaction/initialize");
    expect(init).toHaveLength(1);
    expect(init[0]!.body).toMatchObject({ amount: grossKobo });
    const reference = started.data.reference as string;

    // 2. the buyer pays on Paystack; Paystack tells us
    const charge = w.paystack.completeCheckout(reference, { channel: "card" });
    const hook = await sendWebhook(w, "charge.success", charge);
    expect(hook.status).toBe(200);

    // 3. the order is paid; the vendor was told; the ledger says success
    const pay = await rowOf(w, `select status::text as status, amount::text as amount from public.payments where order_id = $1`, [orderId]);
    expect(pay).toMatchObject({ status: "paid", amount: "5000" }); // the order amount only: the fee is not part of it
    expect((await rowOf(w, `select status from public.paystack_transactions where reference = $1`, [reference]))?.status).toBe("success");
    const told = await w.db.query(`select 1 from public.notifications where user_id = $1 and type = 'payment_confirmed'`, [w.vendor.id]);
    expect(told.length).toBeGreaterThan(0);

    // 4. completion queues exactly one payout; the worker sends it once
    expect((await rowOf(w, `select status::text as s from public.orders where id = $1`, [orderId]))?.s).toBe("confirmed");
    expect((await json(await api.post(w, `/orders/${orderId}/received`, w.buyer.token))).status).toBe(200);
    expect((await rowOf(w, `select status::text as s from public.orders where id = $1`, [orderId]))?.s).toBe("completed");
    // commission is recorded once, by the completion itself
    const charges = await w.db.query<{ amount: string }>(`select amount::text from public.commission_charges where order_id = $1`, [orderId]);
    expect(charges.length).toBeLessThanOrEqual(1);
    const commissionKobo = Math.round(Number(charges[0]?.amount ?? 0) * 100);
    expect((await runJob(w, "vendor-payouts")).status).toBe(200);
    expect((await runJob(w, "vendor-payouts")).status).toBe(200);
    const transfers = w.paystack.callsTo("POST", "/transfer");
    expect(transfers).toHaveLength(1);
    expect(transfers[0]!.body).toMatchObject({ amount: 500000 - commissionKobo, recipient: "RCP_e2e" }); // what was paid minus the commission

    // 5. Paystack says the transfer went through
    const payout = await rowOf<{ transfer_reference: string }>(w, `select transfer_reference from public.vendor_payouts where order_id = $1`, [orderId]);
    await sendWebhook(w, "transfer.success", { reference: payout!.transfer_reference });
    expect((await rowOf(w, `select status from public.vendor_payouts where order_id = $1`, [orderId]))?.status).toBe("success");
    const sent = await w.db.query(`select 1 from public.notifications where user_id = $1 and type = 'payout_sent'`, [w.vendor.id]);
    expect(sent.length).toBeGreaterThan(0);
  });

  it("the client cannot choose the amount", async () => {
    const orderId = await newOrder(w, 3000);
    const res = await json(await api.post(w, `/orders/${orderId}/paystack/initialize`, w.buyer.token, { amount: 1, amountNaira: 1 }));
    expect(res.status).toBe(200);
    expect(w.paystack.callsTo("POST", "/transaction/initialize")[0]!.body).toMatchObject({ amount: grossUpForBuyerFees(300000).grossKobo });
  });
});
