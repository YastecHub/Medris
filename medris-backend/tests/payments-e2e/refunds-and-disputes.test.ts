import { describe, expect, it } from "vitest";
import { api, completeAndPayOut, json, newOrder, payOrder, rowOf, runJob, sendWebhook, useWorld, withdraw, handOver } from "./harness.js";

describe("refunds, disputes, chargebacks and cancellations", () => {
  const w = useWorld();
  const refundRows = (orderId: string) => w.db.query<{ status: string; amount_kobo: string; attempt: number }>(`select status, amount_kobo::text, attempt from public.paystack_refunds where order_id = $1 order by attempt`, [orderId]);
  const doRefund = async (orderId: string, body: Record<string, unknown>, token = w.admin.token) => json(await api.post(w, `/admin/orders/${orderId}/refund`, token, body));
  const payoutOf = (orderId: string) => rowOf<{ id: string; status: string; hold_reason: string | null; amount_kobo: string }>(w, `select id, status, hold_reason, amount_kobo::text from public.vendor_payouts where order_id = $1`, [orderId]);

  it("a full refund: queued, sent to Paystack once, finished by refund.processed; the buyer and vendor are told", async () => {
    const orderId = await newOrder(w, 5000);
    const reference = await payOrder(w, orderId);
    const r = await doRefund(orderId, { reason: "Dispute settled for the buyer" });
    expect(r.status).toBe(200);
    await runJob(w, "paystack-refunds");
    await runJob(w, "paystack-refunds");
    expect(w.paystack.refunds).toHaveLength(1);
    expect(w.paystack.callsTo("POST", "/refund")[0]!.body).toMatchObject({ transaction: reference, amount: 500000 }); // the order amount, not Paystack's fee
    await sendWebhook(w, "refund.processed", { transaction_reference: reference, id: 12345 });
    expect((await refundRows(orderId))[0]!.status).toBe("processed");
    expect((await w.db.query(`select 1 from public.notifications where user_id = $1 and type = 'refund_started'`, [w.buyer.id])).length).toBeGreaterThan(0);
    expect((await w.db.query(`select 1 from public.notifications where user_id = $1 and type = 'order_refunded'`, [w.vendor.id])).length).toBeGreaterThan(0);
  });

  it("partial refunds add up; more than what is left is refused", async () => {
    const orderId = await newOrder(w, 2000);
    const reference = await payOrder(w, orderId);
    expect((await doRefund(orderId, { amountNaira: 500.5, reason: "Item was damaged" })).status).toBe(200);
    await runJob(w, "paystack-refunds");
    await sendWebhook(w, "refund.processed", { transaction_reference: reference });
    const tooMuch = await doRefund(orderId, { amountNaira: 1500, reason: "too much" });
    expect(tooMuch.status).toBe(400);
    expect((await doRefund(orderId, { reason: "the rest" })).status).toBe(200);
    expect((await refundRows(orderId)).map((x) => x.amount_kobo)).toEqual(["50050", "149950"]);
  });

  it("a double click makes one refund", async () => {
    const orderId = await newOrder(w, 1000);
    await payOrder(w, orderId);
    const results = await Promise.all([doRefund(orderId, { reason: "first click" }), doRefund(orderId, { reason: "second click" })]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    await runJob(w, "paystack-refunds");
    await runJob(w, "paystack-refunds");
    expect(w.paystack.refunds).toHaveLength(1);
  });

  it("after the vendor has been paid, a refund is refused", async () => {
    const orderId = await newOrder(w, 3000);
    await payOrder(w, orderId);
    await completeAndPayOut(w, orderId);
    const r = await doRefund(orderId, { reason: "too late" });
    expect(r.status).toBe(409);
    expect(await refundRows(orderId)).toHaveLength(0);
  });

  it("refund.failed marks the refund failed and alerts an admin", async () => {
    const orderId = await newOrder(w, 1200);
    const reference = await payOrder(w, orderId);
    await doRefund(orderId, { reason: "buyer asked" });
    await runJob(w, "paystack-refunds");
    await sendWebhook(w, "refund.failed", { transaction_reference: reference });
    expect((await refundRows(orderId))[0]!.status).toBe("failed");
    expect((await w.db.query(`select 1 from public.notifications where user_id = $1 and title = 'Refund failed'`, [w.admin.id])).length).toBeGreaterThan(0);
  });

  it("Paystack refusing the refund: failed, admin told, never retried by itself", async () => {
    const orderId = await newOrder(w, 1500);
    await payOrder(w, orderId);
    w.paystack.fault(/\/refund/, { kind: "status", status: 400, message: "Transaction has already been fully reversed" });
    await doRefund(orderId, { reason: "again" });
    await runJob(w, "paystack-refunds");
    await runJob(w, "paystack-refunds");
    expect((await refundRows(orderId))[0]!.status).toBe("failed");
    expect(w.paystack.callsTo("POST", "/refund")).toHaveLength(1);
  });

  it("a card chargeback (charge.dispute.create) holds the payout; an admin can release it once it is settled", async () => {
    const orderId = await newOrder(w, 7000);
    const reference = await payOrder(w, orderId);
    await handOver(w, orderId);
    await json(await api.post(w, `/orders/${orderId}/received`, w.buyer.token)); // completes: a payout is queued, not yet sent
    await withdraw(w, orderId);
    expect((await payoutOf(orderId))?.status).toBe("pending");
    await sendWebhook(w, "charge.dispute.create", { transaction: { reference }, due_at: "2026-12-01T00:00:00Z" });
    const held = await payoutOf(orderId);
    expect(held?.status).toBe("on_hold");
    expect(held?.hold_reason).toMatch(/dispute/i);
    await runJob(w, "vendor-payouts");
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(0);
    await sendWebhook(w, "charge.dispute.resolve", { transaction: { reference }, resolution: "merchant-accepted" });
    const rel = await json(await api.post(w, `/admin/payouts/${held!.id}/release`, w.admin.token));
    expect(rel.status).toBe(200);
    await runJob(w, "vendor-payouts");
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(1);
  });

  it("an open dispute on the order holds the payout; closing it and releasing sends it", async () => {
    const orderId = await newOrder(w, 3500);
    await payOrder(w, orderId);
    await handOver(w, orderId);
    await json(await api.post(w, `/orders/${orderId}/received`, w.buyer.token));
    await withdraw(w, orderId);
    await w.db.query(`insert into public.disputes (order_id, raised_by, reason, status) values ($1, 'buyer', 'Not as described', 'open')`, [orderId]);
    await runJob(w, "vendor-payouts");
    const held = await payoutOf(orderId);
    expect(held?.status).toBe("on_hold");
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(0);
    await w.db.query(`update public.disputes set status = 'resolved' where order_id = $1`, [orderId]);
    await json(await api.post(w, `/admin/payouts/${held!.id}/release`, w.admin.token));
    await runJob(w, "vendor-payouts");
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(1);
  });

  it("cancelling a paid order before hand-over refunds the buyer by itself", async () => {
    const orderId = await newOrder(w, 1800);
    await payOrder(w, orderId);
    const res = await json(await api.post(w, `/orders/${orderId}/status`, w.buyer.token, { status: "cancelled" }));
    expect(res.status).toBe(200);
    await runJob(w, "paystack-refunds");
    expect(w.paystack.refunds).toHaveLength(1);
    expect(w.paystack.callsTo("POST", "/refund")[0]!.body).toMatchObject({ amount: 180000 });
  });

  it("a partial refund, then completion: the payout is what was paid minus the refund minus commission, to the kobo", async () => {
    const orderId = await newOrder(w, 4000);
    const reference = await payOrder(w, orderId);
    await doRefund(orderId, { amountNaira: 1000.25, reason: "one item returned" });
    await runJob(w, "paystack-refunds");
    await sendWebhook(w, "refund.processed", { transaction_reference: reference });
    await completeAndPayOut(w, orderId);
    const commission = Math.round(Number((await rowOf(w, `select coalesce(sum(amount), 0)::text as c from public.commission_charges where order_id = $1`, [orderId]))?.c ?? 0) * 100);
    expect(w.paystack.callsTo("POST", "/transfer")[0]!.body).toMatchObject({ amount: 400000 - 100025 - commission });
  });

  it.todo("resolving a dispute in the buyer's favour offers 'Refund via Paystack' on the dispute screen (issue #99: button not built; admins use the Payments screen)");
  it.todo("a rental's refundable deposit is refunded when the rental is returned (issue #99: not built)");
});
