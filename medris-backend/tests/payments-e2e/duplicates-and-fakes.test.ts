import { describe, expect, it } from "vitest";
import { api, completeAndPayOut, json, newOrder, payOrder, rowOf, sendWebhook, sendWebhookRaw, startPayment, useWorld } from "./harness.js";

describe("duplicates, fakes and mismatches", () => {
  const w = useWorld();
  const paymentStatus = async (orderId: string) => (await rowOf(w, `select status::text as s from public.payments where order_id = $1`, [orderId]))?.s;
  const adminAlerts = async (title: string) => (await w.db.query(`select 1 from public.notifications where user_id = $1 and title = $2`, [w.admin.id, title])).length;

  it("a double tap on Pay returns the same payment and starts one transaction", async () => {
    const orderId = await newOrder(w);
    const [a, b] = await Promise.all([startPayment(w, orderId), startPayment(w, orderId)]);
    const ok = [a, b].filter((r) => r.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const again = await startPayment(w, orderId);
    expect(again.status).toBe(200);
    expect(again.data.reference).toBe(ok[0]!.data.reference);
    expect(w.paystack.callsTo("POST", "/transaction/initialize")).toHaveLength(1);
  });

  it("the same webhook delivered twice settles once", async () => {
    const orderId = await newOrder(w);
    const reference = (await startPayment(w, orderId)).data.reference as string;
    const first = await sendWebhook(w, "charge.success", w.paystack.completeCheckout(reference));
    const second = await sendWebhookRaw(w, first.raw, w.paystack.sign(first.raw));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await paymentStatus(orderId)).toBe("paid");
    const n = await w.db.query(`select 1 from public.notifications where user_id = $1 and type = 'payment_confirmed' and (target_params->>'orderId') = $2`, [w.vendor.id, orderId]);
    expect(n).toHaveLength(1);
  });

  it("coming back to the app settles the payment from Paystack's answer; a later webhook changes nothing", async () => {
    const orderId = await newOrder(w);
    const reference = (await startPayment(w, orderId)).data.reference as string;
    const charge = w.paystack.completeCheckout(reference);
    const status = await json(await api.get(w, `/payments/paystack/${reference}`, w.buyer.token));
    expect(status.status).toBe(200);
    expect(status.data.status).toBe("success");
    expect(await paymentStatus(orderId)).toBe("paid");
    await sendWebhook(w, "charge.success", charge);
    expect(await paymentStatus(orderId)).toBe("paid");
    const n = await w.db.query(`select 1 from public.notifications where user_id = $1 and type = 'payment_confirmed' and (target_params->>'orderId') = $2`, [w.vendor.id, orderId]);
    expect(n).toHaveLength(1);
  });

  it("verify and the webhook at the same moment settle once", async () => {
    const orderId = await newOrder(w);
    const reference = (await startPayment(w, orderId)).data.reference as string;
    const charge = w.paystack.completeCheckout(reference);
    await Promise.all([api.get(w, `/payments/paystack/${reference}`, w.buyer.token), sendWebhook(w, "charge.success", charge), sendWebhook(w, "charge.success", charge, { id: 1 })]);
    expect(await paymentStatus(orderId)).toBe("paid");
    const n = await w.db.query(`select 1 from public.notifications where user_id = $1 and type = 'payment_confirmed' and (target_params->>'orderId') = $2`, [w.vendor.id, orderId]);
    expect(n).toHaveLength(1);
  });

  it("a bad or missing signature is refused (401) and changes nothing", async () => {
    const orderId = await newOrder(w);
    const reference = (await startPayment(w, orderId)).data.reference as string;
    const charge = w.paystack.completeCheckout(reference);
    expect((await sendWebhook(w, "charge.success", charge, { signature: "0".repeat(128) })).status).toBe(401);
    expect((await sendWebhook(w, "charge.success", charge, { signature: null })).status).toBe(401);
    expect(await paymentStatus(orderId)).toBe("pending");
    expect(await w.db.query(`select 1 from public.paystack_events where reference = $1`, [reference])).toHaveLength(0);
  });

  it("Paystack reporting a smaller amount does not settle the order, and an admin is told", async () => {
    const orderId = await newOrder(w);
    const reference = (await startPayment(w, orderId)).data.reference as string;
    const before = await adminAlerts("Payment amount does not match");
    await sendWebhook(w, "charge.success", w.paystack.completeCheckout(reference, { reportAmount: 1000 }));
    expect(await paymentStatus(orderId)).toBe("pending");
    expect(await adminAlerts("Payment amount does not match")).toBeGreaterThan(before);
  });

  it("a payment in another currency does not settle the order", async () => {
    const orderId = await newOrder(w);
    const reference = (await startPayment(w, orderId)).data.reference as string;
    await sendWebhook(w, "charge.success", w.paystack.completeCheckout(reference, { reportCurrency: "USD" }));
    expect(await paymentStatus(orderId)).toBe("pending");
  });

  it("transfer events out of order: the later truth wins and nothing is credited twice", async () => {
    const orderId = await newOrder(w, 4000);
    await payOrder(w, orderId);
    const transferRef = await completeAndPayOut(w, orderId);
    // reversed arrives first, then success: a reversal is final, a late "success" is ignored
    await sendWebhook(w, "transfer.reversed", { reference: transferRef });
    await sendWebhook(w, "transfer.success", { reference: transferRef });
    expect((await rowOf(w, `select status from public.vendor_payouts where order_id = $1`, [orderId]))?.status).toBe("reversed");

    // success first, then reversed: the bank took it back, so reversed wins
    const second = await newOrder(w, 4000);
    await payOrder(w, second);
    const ref2 = await completeAndPayOut(w, second);
    await sendWebhook(w, "transfer.success", { reference: ref2 });
    await sendWebhook(w, "transfer.reversed", { reference: ref2 });
    expect((await rowOf(w, `select status from public.vendor_payouts where order_id = $1`, [second]))?.status).toBe("reversed");
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(2); // one transfer per order, never more
  });
});
