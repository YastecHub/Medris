import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RefundsService } from "../../src/modules/refunds/refunds.service.js";
import { VendorPayoutsService } from "../../src/modules/vendor-payouts/vendor-payouts.service.js";
import { seedOrder, seedProduct, seedUser, seedVendor, setRole } from "../support/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

describe("paystack refunds (issue #99)", () => {
  let db: TestDatabase;
  let refunds: RefundsService;
  let payouts: VendorPayoutsService;
  let buyer: string;
  let owner: string;
  let shop: string;
  let product: string;
  let admin: string;
  let stranger: string;
  const savedKey = process.env.PAYSTACK_SECRET_KEY;
  const calls: Array<Record<string, unknown>> = [];
  let refundAnswer: () => Response;
  const ok = (data: unknown) => new Response(JSON.stringify({ status: true, data }), { status: 200 });

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_refunds";
    db = await createTestDatabase();
    refunds = new RefundsService(() => db.data);
    payouts = new VendorPayoutsService(() => db.data);
    admin = (await seedUser(db)).id;
    await setRole(db, admin, "admin");
    stranger = (await seedUser(db)).id;
    buyer = (await seedUser(db)).id;
    owner = (await seedUser(db, { role: "vendor" })).id;
    shop = (await seedVendor(db, owner, { name: "Dayo" })).id;
    product = await seedProduct(db, shop);
  }, 60_000);
  beforeEach(async () => {
    calls.length = 0;
    await db.query(`delete from public.paystack_refunds`);
    await db.query(`delete from public.vendor_payouts`);
    await db.query(`update public.vendors set transfer_recipient_code = 'RCP_test', payout_verified_at = now() where id = $1`, [shop]);
    refundAnswer = () => ok({ status: "pending", transaction: { reference: "x" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        if (/\/refund$/.test(u) && init?.method === "POST") {
          calls.push(JSON.parse(String(init.body)));
          return refundAnswer();
        }
        if (/\/transfer$/.test(u) && init?.method === "POST") return ok({ transfer_code: "TRF", reference: "x", status: "pending" });
        return new Response("{}", { status: 404 });
      }),
    );
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = savedKey;
    await db.close();
  });

  /** An order paid by card through Paystack (net `naira`; the buyer's fee is on top and not part of it). */
  async function paidOrder(naira = 2000, status = "confirmed") {
    const orderId = await seedOrder(db, buyer, shop, { status, productIds: [product], total: naira });
    const ref = `lvm_ord_${crypto.randomBytes(6).toString("hex")}`;
    await db.query(`insert into public.payments (order_id, payment_type, amount, method, status, provider_reference) values ($1, 'sale_price', $2, 'card', 'paid', $3)`, [orderId, naira, ref]);
    await db.query(`insert into public.paystack_transactions (reference, purpose, order_id, payer_user_id, amount_kobo, status) values ($1, 'order_payment', $2, $3, $4, 'success')`, [ref, orderId, buyer, Math.round(naira * 100) + 4000]);
    return { orderId, ref };
  }
  const rows = (orderId: string) => db.query<{ status: string; amount_kobo: string; attempt: number; source: string }>(`select status, amount_kobo::text, attempt, source from public.paystack_refunds where order_id = $1 order by attempt`, [orderId]);
  const as = (userId: string) => ({ userId }) as never;

  it("refunds everything still refundable by default, as the order amount (not Paystack's fee)", async () => {
    const { orderId } = await paidOrder(2000);
    const r = await refunds.refundOrder(as(admin), orderId, { reason: "Dispute settled for the buyer" });
    expect(r.amount).toBe(2000);
    expect(await rows(orderId)).toEqual([expect.objectContaining({ status: "pending", amount_kobo: "200000", source: "admin" })]);
    await refunds.run();
    expect(calls).toEqual([expect.objectContaining({ amount: 200000 })]);
    expect((await rows(orderId))[0]!.status).toBe("processing");
    const told = await db.query(`select 1 from public.notifications where user_id = $1 and type = 'refund_started'`, [buyer]);
    expect(told.length).toBeGreaterThan(0);
  });

  it("a partial refund, then the rest; more than is refundable is refused", async () => {
    const { orderId } = await paidOrder(2000);
    await refunds.refundOrder(as(admin), orderId, { amountNaira: 500.5, reason: "Item was damaged" });
    await refunds.run();
    await db.query(`update public.paystack_refunds set status = 'processed' where order_id = $1`, [orderId]);
    await expect(refunds.refundOrder(as(admin), orderId, { amountNaira: 1500, reason: "too much" })).rejects.toThrow(/at most ₦1,499\.5/);
    await refunds.refundOrder(as(admin), orderId, { reason: "the rest" });
    const all = await rows(orderId);
    expect(all.map((x) => x.amount_kobo)).toEqual(["50050", "149950"]);
    expect(all.map((x) => x.attempt)).toEqual([1, 2]);
  });

  it("a double click makes one refund", async () => {
    const { orderId } = await paidOrder(1000);
    const results = await Promise.allSettled([refunds.refundOrder(as(admin), orderId, { reason: "x1x" }), refunds.refundOrder(as(admin), orderId, { reason: "x2x" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await rows(orderId)).toHaveLength(1);
    await refunds.run();
    await refunds.run();
    expect(calls).toHaveLength(1);
  });

  it("only admins can refund", async () => {
    const { orderId } = await paidOrder(1000);
    await expect(refunds.refundOrder(as(stranger), orderId, { reason: "please" })).rejects.toThrow(/admin/i);
    expect(await rows(orderId)).toHaveLength(0);
  });

  it("after the vendor's payout has left, the refund is refused", async () => {
    const { orderId } = await paidOrder(1000, "confirmed");
    await db.query(`update public.orders set status = 'completed' where id = $1`, [orderId]);
    await db.query(`delete from public.commission_charges where order_id = $1`, [orderId]);
    await payouts.run(); // sends it: now "processing"
    await expect(refunds.refundOrder(as(admin), orderId, { reason: "too late" })).rejects.toThrow(/already been paid/);
    expect(await rows(orderId)).toHaveLength(0);
  });

  it("a refund and a payout at the same moment never take the same money", async () => {
    const { orderId } = await paidOrder(1000, "confirmed");
    await db.query(`update public.orders set status = 'completed' where id = $1`, [orderId]);
    await db.query(`delete from public.commission_charges where order_id = $1`, [orderId]);
    const [r] = await Promise.allSettled([refunds.refundOrder(as(admin), orderId, { reason: "race" }), payouts.run()]);
    const transfers = await db.query<{ status: string }>(`select status from public.vendor_payouts where order_id = $1`, [orderId]);
    const refunded = (await rows(orderId)).length > 0;
    const paidOut = ["processing", "success"].includes(transfers[0]!.status);
    expect(refunded && paidOut).toBe(false);
    expect(r.status === "fulfilled").toBe(refunded);
  });

  it("a full refund holds a payout that has not left yet", async () => {
    const { orderId } = await paidOrder(1000, "confirmed");
    await db.query(`update public.orders set status = 'completed' where id = $1`, [orderId]);
    await refunds.refundOrder(as(admin), orderId, { reason: "buyer won the dispute" });
    expect((await db.query<{ status: string }>(`select status from public.vendor_payouts where order_id = $1`, [orderId]))[0]!.status).toBe("on_hold");
  });

  it("cancelling a paid order queues a refund by itself, once", async () => {
    const { orderId } = await paidOrder(1800);
    await db.query(`update public.orders set status = 'cancelled' where id = $1`, [orderId]);
    await db.query(`update public.orders set status = 'confirmed' where id = $1`, [orderId]);
    await db.query(`update public.orders set status = 'cancelled' where id = $1`, [orderId]);
    expect(await rows(orderId)).toEqual([expect.objectContaining({ amount_kobo: "180000", source: "cancellation" })]);
    await refunds.run();
    expect(calls).toHaveLength(1);
  });

  it("cancelling an order that was not paid through Paystack queues nothing", async () => {
    const orderId = await seedOrder(db, buyer, shop, { status: "pending", productIds: [product], total: 900 });
    await db.query(`update public.orders set status = 'cancelled' where id = $1`, [orderId]);
    expect(await rows(orderId)).toHaveLength(0);
  });

  it("Paystack saying no marks the refund failed and tells admins; a timeout is never retried by itself", async () => {
    const a = await paidOrder(1000);
    refundAnswer = () => new Response(JSON.stringify({ status: false, message: "Transaction has already been fully reversed" }), { status: 400 });
    await refunds.refundOrder(as(admin), a.orderId, { reason: "first" });
    await refunds.run();
    expect((await rows(a.orderId))[0]!.status).toBe("failed");
    const alerted = await db.query(`select 1 from public.notifications where user_id = $1 and title = 'Refund failed'`, [admin]);
    expect(alerted.length).toBeGreaterThan(0);

    const b = await paidOrder(1000);
    refundAnswer = () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    await refunds.refundOrder(as(admin), b.orderId, { reason: "second" });
    await refunds.run();
    expect((await rows(b.orderId))[0]!.status).toBe("processing");
    const before = calls.length;
    await refunds.run();
    expect(calls.length).toBe(before);
  });
});
