import { describe, expect, it } from "vitest";
import { ageRows, api, completeAndPayOut, json, newOrder, payOrder, rowOf, runJob, sendWebhook, startPayment, useWorld } from "./harness.js";

describe("timeouts (unknown outcomes) and failures", () => {
  const w = useWorld();
  const payout = (orderId: string) => rowOf<{ status: string; attempts: number; transfer_reference: string; next_attempt_at: string | null }>(w, `select status, attempts, transfer_reference, next_attempt_at::text from public.vendor_payouts where order_id = $1`, [orderId]);
  const payStatus = async (orderId: string) => (await rowOf(w, `select status::text as s from public.payments where order_id = $1`, [orderId]))?.s;

  it("initialize times out: the buyer is told to try again, nothing is half-started, and paying then works", async () => {
    const orderId = await newOrder(w);
    w.paystack.fault(/\/transaction\/initialize/, { kind: "timeout" });
    const failed = await startPayment(w, orderId);
    expect(failed.status).toBe(503);
    expect(await payStatus(orderId)).toBeUndefined(); // no payment row left behind
    w.paystack.fault(/\/transaction\/initialize/, null);
    const ok = await startPayment(w, orderId);
    expect(ok.status).toBe(200);
  });

  it("the health page names any payment database change that is not applied (none missing here), and reveals no key", async () => {
    const r = await json(await api.get(w, "/payments/health"));
    expect(r.status).toBe(200);
    expect(r.data.missingMigrations).toEqual([]);
    expect(JSON.stringify(r.body)).not.toMatch(/sk_(test|live)_/);
    await w.db.query(`drop trigger orders_queue_paystack_refunds on public.orders`);
    const after = await json(await api.get(w, "/payments/health"));
    expect(after.data.missingMigrations).toEqual(["0008"]);
  });

  it("Pay is tapped again after the first link was already paid (slow bank transfer): the payment is settled once and the buyer is told so", async () => {
    const orderId = await newOrder(w);
    const first = await startPayment(w, orderId);
    w.paystack.completeCheckout(first.data.reference as string);
    const again = await startPayment(w, orderId);
    expect(again.status).toBe(409);
    expect(await payStatus(orderId)).toBe("paid");
    const n = await w.db.query(`select 1 from public.notifications where user_id = $1 and type = 'payment_confirmed' and (target_params->>'orderId') = $2`, [w.vendor.id, orderId]);
    expect(n).toHaveLength(1);
  });

  it("the Paystack key is missing on the server: a clear 'not available' answer, nothing half-started", async () => {
    const orderId = await newOrder(w);
    const saved = process.env.PAYSTACK_SECRET_KEY;
    delete process.env.PAYSTACK_SECRET_KEY;
    try {
      const failed = await startPayment(w, orderId);
      expect(failed.status).toBe(503);
      expect(failed.body.error.code).toBe("service_unavailable");
      expect(await payStatus(orderId)).toBeUndefined();
    } finally {
      process.env.PAYSTACK_SECRET_KEY = saved;
    }
    expect((await startPayment(w, orderId)).status).toBe(200);
  });

  it("the buyer's confirmation call cannot reach Paystack: nothing is lost, the reconciliation job settles it once", async () => {
    const orderId = await newOrder(w);
    const reference = (await startPayment(w, orderId)).data.reference as string;
    w.paystack.completeCheckout(reference);
    w.paystack.fault(/\/transaction\/verify/, { kind: "timeout" });
    const status = await json(await api.get(w, `/payments/paystack/${reference}`, w.buyer.token));
    expect(status.status).toBe(200); // reports what we know; it does not crash or pay twice
    expect(await payStatus(orderId)).toBe("pending");
    w.paystack.fault(/\/transaction\/verify/, null);
    // the payment is old enough to be looked up by the job
    await w.db.query(`alter table public.paystack_transactions disable trigger user`);
    await w.db.query(`update public.paystack_transactions set created_at = now() - interval '40 minutes' where reference = $1`, [reference]);
    await w.db.query(`alter table public.paystack_transactions enable trigger user`);
    await runJob(w, "paystack-reconcile");
    await runJob(w, "paystack-reconcile");
    expect(await payStatus(orderId)).toBe("paid");
    const n = await w.db.query(`select 1 from public.notifications where user_id = $1 and type = 'payment_confirmed' and (target_params->>'orderId') = $2`, [w.vendor.id, orderId]);
    expect(n).toHaveLength(1);
  });

  it("a transfer that Paystack never saw is sent again with the same reference, once", async () => {
    const orderId = await newOrder(w);
    await payOrder(w, orderId);
    w.paystack.fault(/^\/transfer$/, { kind: "timeout" });
    const ref = await completeAndPayOut(w, orderId);
    expect(w.paystack.transfers.size).toBe(0);
    expect((await payout(orderId))?.status).toBe("pending");
    w.paystack.fault(/^\/transfer$/, null);
    await w.db.query(`update public.vendor_payouts set next_attempt_at = null where order_id = $1`, [orderId]);
    await runJob(w, "vendor-payouts");
    await runJob(w, "vendor-payouts");
    expect(w.paystack.transfers.size).toBe(1);
    expect([...w.paystack.transfers.keys()]).toEqual([ref]);
  });

  it("a transfer Paystack did make but never answered: verify finds it, no second transfer is created", async () => {
    const orderId = await newOrder(w);
    await payOrder(w, orderId);
    w.paystack.fault(/^\/transfer$/, { kind: "lost_response" });
    await completeAndPayOut(w, orderId);
    expect(w.paystack.transfers.size).toBe(1);
    w.paystack.fault(/^\/transfer$/, null);
    await runJob(w, "vendor-payouts");
    await runJob(w, "vendor-payouts");
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(1);
    expect((await payout(orderId))?.status).toBe("processing"); // waiting for Paystack's webhook
    const reference = (await payout(orderId))!.transfer_reference;
    w.paystack.setTransferOutcome(reference, "success");
    await ageRows(w, "vendor_payouts", `order_id = '${orderId}'`, "2 hours");
    await runJob(w, "paystack-reconcile"); // looks the stale transfer up and settles it like the webhook
    expect((await payout(orderId))?.status).toBe("success");
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(1);
  });

  it("a declined or abandoned card leaves the order unpaid, and trying again works", async () => {
    const orderId = await newOrder(w);
    const first = (await startPayment(w, orderId)).data.reference as string;
    w.paystack.declineCheckout(first, "failed");
    const status = await json(await api.get(w, `/payments/paystack/${first}`, w.buyer.token));
    expect(status.data.status).toBe("failed");
    expect((await rowOf(w, `select status::text as s from public.payments where provider_reference = $1`, [first]))?.s).not.toBe("paid");
    const second = await startPayment(w, orderId);
    expect(second.status).toBe(200);
    expect(second.data.reference).not.toBe(first);
    await sendWebhook(w, "charge.success", w.paystack.completeCheckout(second.data.reference));
    expect((await rowOf(w, `select status::text as s from public.payments where provider_reference = $1`, [second.data.reference]))?.s).toBe("paid");
  });

  // FOUND BY THIS SUITE (bug issue #127): a declined attempt that was closed by the status check
  // keeps its pending card payment row, so the order ends up with a paid row AND a stale pending one.
  it.fails("a declined attempt leaves no pending card payment row behind", async () => {
    const orderId = await newOrder(w);
    const first = (await startPayment(w, orderId)).data.reference as string;
    w.paystack.declineCheckout(first, "failed");
    await api.get(w, `/payments/paystack/${first}`, w.buyer.token);
    const second = (await startPayment(w, orderId)).data.reference as string;
    await sendWebhook(w, "charge.success", w.paystack.completeCheckout(second));
    const pending = await w.db.query(`select 1 from public.payments where order_id = $1 and status = 'pending'`, [orderId]);
    expect(pending).toHaveLength(0);
  });

  it("a failed transfer is retried under a new reference with a wait in between; after three failures it is held for an admin", async () => {
    const orderId = await newOrder(w, 6000);
    await payOrder(w, orderId);
    const first = await completeAndPayOut(w, orderId);
    const seen = new Set<string>([first]);
    for (let round = 1; round <= 3; round++) {
      const current = (await payout(orderId))!;
      await sendWebhook(w, "transfer.failed", { reference: current.transfer_reference, reason: "Could not credit the account" });
      expect((await payout(orderId))?.status).toBe("failed");
      await runJob(w, "vendor-payouts"); // too early: still waiting
      if (round === 1) expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(1);
      await ageRows(w, "vendor_payouts", `order_id = '${orderId}'`, "2 hours");
      await runJob(w, "vendor-payouts");
      const next = (await payout(orderId))!;
      if (round < 3) {
        expect(next.status).toBe("processing");
        expect(seen.has(next.transfer_reference)).toBe(false); // never the same reference twice
        seen.add(next.transfer_reference);
      }
    }
    expect((await payout(orderId))?.status).toBe("on_hold");
    expect(w.paystack.transfers.size).toBe(3);
    const alerted = await w.db.query(`select 1 from public.notifications where user_id = $1 and title = 'Vendor payout needs you'`, [w.admin.id]);
    expect(alerted.length).toBeGreaterThan(0);
  });

  it("Paystack's balance is too low: the payout waits without a retry storm and admins are told once", async () => {
    await w.db.query(`delete from public.notifications where title = 'Top up the Paystack balance'`);
    const orderId = await newOrder(w, 2500);
    await payOrder(w, orderId);
    w.paystack.fault(/^\/transfer$/, { kind: "insufficient_balance" });
    await completeAndPayOut(w, orderId);
    await runJob(w, "vendor-payouts");
    await runJob(w, "vendor-payouts");
    const p = await payout(orderId);
    expect(p?.status).toBe("pending");
    expect(p?.next_attempt_at).not.toBeNull();
    expect(w.paystack.callsTo("POST", "/transfer")).toHaveLength(1);
    const alerts = await w.db.query(`select 1 from public.notifications where user_id = $1 and title = 'Top up the Paystack balance'`, [w.admin.id]);
    expect(alerts).toHaveLength(1);
  });
});
