import { describe, expect, it } from "vitest";
import { grossUpForBuyerFees, nairaToKobo, paystackFeeOn } from "../../src/integrations/paystack/index.js";
import { api, completeAndPayOut, json, newOrder, payOrder, rowOf, runJob, sendWebhook, startPayment, useWorld, withdraw, handOver } from "./harness.js";

describe("money arithmetic, pay after delivery, secrets in logs", () => {
  const w = useWorld();

  it("the buyer's total always covers the order amount after Paystack's fee, with no kobo to spare", () => {
    for (const naira of [0.1 + 0.2, 1, 999, 2499.99, 2500, 2501, 15000.05, 100000, 1234567.89, 20_000_000]) {
      const net = nairaToKobo(naira);
      const { grossKobo, feeKobo } = grossUpForBuyerFees(net);
      expect(grossKobo - feeKobo).toBe(net);
      expect(grossKobo - paystackFeeOn(grossKobo)).toBeGreaterThanOrEqual(net); // Levromart gets the full order amount
      expect(grossKobo - 1 - paystackFeeOn(grossKobo - 1)).toBeLessThan(net); // and the buyer is never charged a kobo too much
    }
  });

  // paid (naira), commission (naira), refunded (kobo)  ->  what the vendor is sent (kobo), worked out here with whole numbers
  const cases: Array<[string, number, number, number]> = [
    ["₦999 listing-sized order", 999, 0, 0],
    ["₦0.10 + ₦0.20 style fractions", 0.1 + 0.2, 0.01, 0],
    ["a large order with a part refund", 1234567.89, 61728.39, 5],
    ["commission on a round order", 5000, 150, 0],
  ];
  for (const [label, paid, commission, refundKobo] of cases) {
    it(`the payout is paid − refunds − commission, exact in kobo: ${label}`, async () => {
      const orderId = await newOrder(w, Math.max(1, Math.round(paid)));
      const reference = `lvm_ord_${Math.random().toString(16).slice(2, 14)}`;
      await w.db.query(`insert into public.payments (order_id, payment_type, amount, method, status, provider_reference) values ($1, 'sale_price', $2, 'card', 'paid', $3)`, [orderId, paid.toFixed(2), reference]);
      await w.db.query(`insert into public.paystack_transactions (reference, purpose, order_id, payer_user_id, amount_kobo, status, paid_at) values ($1, 'order_payment', $2, $3, $4, 'success', now())`, [reference, orderId, w.buyer.id, nairaToKobo(paid) + 1000]);
      if (refundKobo) await w.db.query(`insert into public.paystack_refunds (transaction_reference, order_id, attempt, amount_kobo, status) values ($1, $2, 1, $3, 'processed')`, [reference, orderId, refundKobo]);
      await w.db.query(`update public.orders set status = 'completed' where id = $1`, [orderId]);
      await w.db.query(`delete from public.commission_charges where order_id = $1`, [orderId]);
      if (commission) await w.db.query(`insert into public.commission_charges (vendor_id, order_id, amount, status) values ($1, $2, $3, 'owed')`, [w.vendor.shop, orderId, commission.toFixed(2)]);
      await withdraw(w, orderId);
      await runJob(w, "vendor-payouts");
      const expected = nairaToKobo(Number(paid.toFixed(2))) - nairaToKobo(commission) - refundKobo;
      const sent = w.paystack.callsTo("POST", "/transfer").at(-1)!.body as { amount: number };
      expect(sent.amount).toBe(expected);
      expect(Number.isInteger(sent.amount)).toBe(true);
    });
  }

  it("pay after delivery: the deposit first, the balance after hand-over, and the two add up to the order amount", async () => {
    const orderId = await newOrder(w, 10000);
    await w.db.query(`update public.orders set delivery_method = 'delivery', payment_timing = 'pay_after', payment_deposit_percent = 20, delivery_fee = 0 where id = $1`, [orderId]);
    const deposit = await startPayment(w, orderId);
    expect(deposit.status).toBe(200);
    expect(deposit.data.orderAmountNaira).toBe(2000);
    await sendWebhook(w, "charge.success", w.paystack.completeCheckout(deposit.data.reference));
    expect((await rowOf(w, `select status::text as s from public.orders where id = $1`, [orderId]))?.s).toBe("confirmed");
    // the vendor hands the order over; now the balance is due
    // the vendor hands the order over (the app does this through the order-status function; the test records the result)
    await w.db.query(`update public.orders set status = 'handed_over' where id = $1`, [orderId]);
    const balance = await startPayment(w, orderId);
    expect(balance.status).toBe(200);
    expect(balance.data.orderAmountNaira).toBe(8000); // total minus the deposit, to the kobo
    expect(balance.data.reference).not.toBe(deposit.data.reference);
    await sendWebhook(w, "charge.success", w.paystack.completeCheckout(balance.data.reference));
    const paid = await w.db.query<{ status: string; amount: string }>(`select status::text, amount::text from public.payments where order_id = $1 order by amount`, [orderId]);
    expect(paid.map((p) => p.status)).toEqual(["paid", "paid"]);
    expect(paid.reduce((s, p) => s + nairaToKobo(Number(p.amount)), 0)).toBe(1_000_000);
    expect((await startPayment(w, orderId)).status).toBe(400); // nothing left to pay
  });

  it("no log line or error message ever contains the secret key", async () => {
    const lines: string[] = [];
    const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info, write: process.stdout.write.bind(process.stdout), ewrite: process.stderr.write.bind(process.stderr) };
    const grab = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    console.log = console.warn = console.error = console.info = grab as typeof console.log;
    process.stdout.write = ((c: string | Uint8Array) => (lines.push(String(c)), true)) as typeof process.stdout.write;
    process.stderr.write = ((c: string | Uint8Array) => (lines.push(String(c)), true)) as typeof process.stderr.write;
    const bodies: string[] = [];
    try {
      const orderId = await newOrder(w, 2200);
      const started = await json(await api.post(w, `/orders/${orderId}/paystack/initialize`, w.buyer.token));
      bodies.push(JSON.stringify(started.body));
      w.paystack.fault(/\/transaction\/verify/, { kind: "status", status: 500, message: "boom" });
      bodies.push(JSON.stringify((await json(await api.get(w, `/payments/paystack/${started.data.reference}`, w.buyer.token))).body));
      bodies.push(JSON.stringify((await sendWebhook(w, "charge.success", { reference: "lvm_ord_unknown" })).body));
      bodies.push(JSON.stringify((await sendWebhook(w, "charge.success", {}, { signature: "bad" })).body));
    } finally {
      Object.assign(console, { log: originals.log, warn: originals.warn, error: originals.error, info: originals.info });
      process.stdout.write = originals.write;
      process.stderr.write = originals.ewrite;
    }
    expect([...lines, ...bodies].join("\n")).not.toMatch(/sk_(test|live)_/);
  });
});

/**
 * The same thing at the same moment, many times over. This only means something on real PostgreSQL (several connections);
 * on the in-memory test database there is one connection, so it is skipped there unless forced.
 */
const REAL = !!process.env.TEST_DATABASE_URL || !!process.env.PAYMENTS_E2E_FORCE_CONCURRENCY;
describe.skipIf(!REAL)("concurrency (real PostgreSQL)", () => {
  const w = useWorld();
  const N = 8;

  it("the same webhook arriving 8 times at once settles the payment once", async () => {
    const orderId = await newOrder(w, 3300);
    const reference = (await startPayment(w, orderId)).data.reference as string;
    const charge = w.paystack.completeCheckout(reference);
    const first = await sendWebhook(w, "charge.success", charge, { id: 4242 });
    const results = await Promise.all(Array.from({ length: N }, () => sendWebhook(w, "charge.success", charge, { id: 4242 })));
    expect([first, ...results].every((r) => r.status === 200)).toBe(true);
    expect((await w.db.query(`select 1 from public.notifications where user_id = $1 and type = 'payment_confirmed' and (target_params->>'orderId') = $2`, [w.vendor.id, orderId])).length).toBe(1);
  });

  it("verify and webhooks racing: one settlement", async () => {
    const orderId = await newOrder(w, 3400);
    const reference = (await startPayment(w, orderId)).data.reference as string;
    const charge = w.paystack.completeCheckout(reference);
    await Promise.all([...Array.from({ length: 4 }, () => api.get(w, `/payments/paystack/${reference}`, w.buyer.token)), ...Array.from({ length: 4 }, (_, i) => sendWebhook(w, "charge.success", charge, { id: 5000 + i }))]);
    expect((await w.db.query(`select 1 from public.notifications where user_id = $1 and type = 'payment_confirmed' and (target_params->>'orderId') = $2`, [w.vendor.id, orderId])).length).toBe(1);
  });

  it("8 payout workers at once make one transfer", async () => {
    const orderId = await newOrder(w, 3500);
    await payOrder(w, orderId);
    await handOver(w, orderId);
    await json(await api.post(w, `/orders/${orderId}/received`, w.buyer.token));
    await withdraw(w, orderId);
    await Promise.all(Array.from({ length: N }, () => runJob(w, "vendor-payouts")));
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(1);
  });

  it("8 refund requests at once make one refund", async () => {
    const orderId = await newOrder(w, 3600);
    await payOrder(w, orderId);
    const results = await Promise.all(Array.from({ length: N }, () => api.post(w, `/admin/orders/${orderId}/refund`, w.admin.token, { reason: "many clicks" }).then(json)));
    await Promise.all(Array.from({ length: 3 }, () => runJob(w, "paystack-refunds")));
    expect(results.length).toBe(N);
    expect(w.paystack.callsTo("POST", "/refund")).toHaveLength(1);
  });

  it("a refund and a payout at the same moment never take the same money", async () => {
    const orderId = await newOrder(w, 3700);
    await payOrder(w, orderId);
    await handOver(w, orderId);
    await json(await api.post(w, `/orders/${orderId}/received`, w.buyer.token));
    await withdraw(w, orderId);
    const [refund] = await Promise.all([json(await api.post(w, `/admin/orders/${orderId}/refund`, w.admin.token, { reason: "race" })), runJob(w, "vendor-payouts")]);
    await runJob(w, "paystack-refunds");
    const transfers = w.paystack.callsTo("POST", "/transfer").length;
    const refunds = w.paystack.callsTo("POST", "/refund").length;
    expect(transfers + refunds).toBeLessThanOrEqual(1);
    void refund;
    void completeAndPayOut;
  });
});
