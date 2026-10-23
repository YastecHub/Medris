import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setDataContextProvider } from "../../src/database/index.js";
import { PaystackWebhookService } from "../../src/modules/paystack-webhook/paystack-webhook.service.js";
import { canMovePayout, canMoveRefund, canMoveTransaction } from "../../src/modules/paystack-webhook/paystack-state.js";
import { seedOrder, seedProduct, seedUser, seedVendor, setRole } from "../support/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

const SECRET = "sk_test_webhook_secret";
const sign = (raw: string) => crypto.createHmac("sha512", SECRET).update(raw).digest("hex");

describe("paystack webhook (issue #94)", () => {
  let db: TestDatabase;
  let service: PaystackWebhookService;
  let buyer: string;
  let owner: string;
  let shop: string;
  let product: string;
  let admin: string;
  let seq = 0;
  const savedKey = process.env.PAYSTACK_SECRET_KEY;
  // what Paystack's verify endpoint answers, per reference (a function so a test can make it fail)
  let verifyAnswer: (reference: string) => Response | Promise<Response> = () => new Response("{}", { status: 404 });

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    db = await createTestDatabase();
    service = new PaystackWebhookService(() => db.data);
    setDataContextProvider(() => db.data); // the shared settlement code reaches the database through the global context
    admin = (await seedUser(db)).id;
    await setRole(db, admin, "admin");
    buyer = (await seedUser(db)).id;
    owner = (await seedUser(db, { role: "vendor" })).id;
    shop = (await seedVendor(db, owner, { name: "Dayo" })).id;
    product = await seedProduct(db, shop);
  }, 60_000);
  // the config unstubs globals after every test, so the stub is set before each one
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        const m = /\/transaction\/verify\/([^/?]+)/.exec(u);
        if (m) return verifyAnswer(decodeURIComponent(m[1]!));
        const t = /\/transfer\/verify\/([^/?]+)/.exec(u);
        if (t) return verifyAnswer(decodeURIComponent(t[1]!));
        return new Response("{}", { status: 404 });
      }),
    );
  });
  afterEach(() => {
    verifyAnswer = () => new Response("{}", { status: 404 });
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    setDataContextProvider(null);
    if (savedKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = savedKey;
    await db.close();
  });

  const ok = (data: unknown) => new Response(JSON.stringify({ status: true, data }), { status: 200 });
  const send = (event: string, data: Record<string, unknown>, opts: { signature?: string | null; raw?: string } = {}) => {
    const raw = opts.raw ?? JSON.stringify({ event, data });
    return service.handle(raw, opts.signature === null ? undefined : (opts.signature ?? sign(raw)));
  };

  /** An order with a pending card payment and a recorded Paystack attempt of the same amount. */
  async function paidOrderSetup(amountKobo = 150000) {
    const n = ++seq;
    const orderId = await seedOrder(db, buyer, shop, { productIds: [product], total: amountKobo / 100 });
    const reference = `lvm_test_${n}`;
    await db.query(`insert into public.payments (order_id, payment_type, amount, method, status, provider_reference) values ($1, 'sale_price', $2, 'card', 'pending', $3)`, [orderId, amountKobo / 100, reference]);
    await db.query(`insert into public.paystack_transactions (reference, purpose, order_id, payer_user_id, amount_kobo) values ($1, 'order_payment', $2, $3, $4)`, [reference, orderId, buyer, amountKobo]);
    return { orderId, reference, id: 9000 + n };
  }
  const verifySuccess = (reference: string, id: number, amount = 150000) => ok({ id, status: "success", reference, amount, currency: "NGN", channel: "card", paid_at: new Date().toISOString() });
  const paymentStatus = async (orderId: string) => (await db.query<{ status: string }>(`select status::text from public.payments where order_id = $1`, [orderId]))[0]!.status;
  const txStatus = async (reference: string) => (await db.query<{ status: string }>(`select status from public.paystack_transactions where reference = $1`, [reference]))[0]!.status;
  const events = async (reference: string) => db.query<{ result: string; processed_at: string | null; error: string | null }>(`select result, processed_at, error from public.paystack_events where reference = $1`, [reference]);

  it("a valid signature is processed; an invalid or missing one is refused and changes nothing", async () => {
    const s = await paidOrderSetup();
    verifyAnswer = () => verifySuccess(s.reference, s.id);
    const raw = JSON.stringify({ event: "charge.success", data: { id: s.id, reference: s.reference } });
    expect((await send("charge.success", {}, { raw, signature: "0".repeat(128) })).status).toBe(401);
    expect((await send("charge.success", {}, { raw, signature: null })).status).toBe(401);
    expect(await events(s.reference)).toHaveLength(0);
    expect(await paymentStatus(s.orderId)).toBe("pending");
    const good = await send("charge.success", {}, { raw });
    expect(good.status).toBe(200);
    expect(await paymentStatus(s.orderId)).toBe("paid");
    expect(await txStatus(s.reference)).toBe("success");
  });

  it("the same event twice is processed once", async () => {
    const s = await paidOrderSetup();
    verifyAnswer = () => verifySuccess(s.reference, s.id);
    const first = await send("charge.success", { id: s.id, reference: s.reference });
    const second = await send("charge.success", { id: s.id, reference: s.reference });
    expect((first.body as { result: string }).result).toBe("settled");
    expect((second.body as { result: string }).result).toBe("duplicate");
    expect(await events(s.reference)).toHaveLength(1);
  });

  it("two deliveries at the same moment: one settlement", async () => {
    const s = await paidOrderSetup();
    verifyAnswer = () => verifySuccess(s.reference, s.id);
    const results = await Promise.all([send("charge.success", { id: s.id, reference: s.reference }), send("charge.success", { id: s.id, reference: s.reference })]);
    const names = results.map((r) => (r.body as { result: string }).result).sort();
    expect(names).toEqual(["duplicate", "settled"]);
    expect(await events(s.reference)).toHaveLength(1);
    expect(await paymentStatus(s.orderId)).toBe("paid");
  });

  it("an amount mismatch is not settled and admins are alerted", async () => {
    const s = await paidOrderSetup(150000);
    verifyAnswer = () => verifySuccess(s.reference, s.id, 100000); // Paystack says less
    const res = await send("charge.success", { id: s.id, reference: s.reference });
    expect((res.body as { result: string }).result).toBe("amount_mismatch");
    expect(await paymentStatus(s.orderId)).toBe("pending");
    expect(await txStatus(s.reference)).toBe("initialized");
    const alerts = await db.query(`select 1 from public.notifications where user_id = $1 and type = 'admin_alert' and body like $2`, [admin, `%${s.reference}%`]);
    expect(alerts.length).toBeGreaterThan(0);
  });

  it("a verify that times out is not settled, then the reconciliation job settles it exactly once", async () => {
    const s = await paidOrderSetup();
    verifyAnswer = () => {
      throw new TypeError("network down");
    };
    const res = await send("charge.success", { id: s.id, reference: s.reference });
    expect(res.status).toBe(200);
    expect((res.body as { result: string }).result).toBe("verify_unavailable");
    expect(await paymentStatus(s.orderId)).toBe("pending");
    expect((await events(s.reference))[0]!.processed_at).toBeNull();

    verifyAnswer = () => verifySuccess(s.reference, s.id);
    await db.query(`update public.paystack_transactions set created_at = now() - interval '1 hour' where reference = $1`, [s.reference]);
    const summary = await service.reconcile();
    expect(summary.settled).toBeGreaterThanOrEqual(1);
    expect(await paymentStatus(s.orderId)).toBe("paid");
    expect(await txStatus(s.reference)).toBe("success");
    // the webhook arriving afterwards is a duplicate
    const late = await send("charge.success", { id: s.id, reference: s.reference });
    expect((late.body as { result: string }).result).toBe("duplicate");
    expect(await events(s.reference)).toHaveLength(1);
  });

  it("transfer events out of order never move a payout backwards", async () => {
    const o1 = await seedOrder(db, buyer, shop, { productIds: [product], total: 1000 });
    const o2 = await seedOrder(db, buyer, shop, { productIds: [product], total: 1000 });
    await db.query(`insert into public.vendor_payouts (order_id, vendor_id, amount_kobo, transfer_reference, status) values ($1, $3, 97000, 'po_ooo_1', 'processing'), ($2, $3, 97000, 'po_ooo_2', 'processing')`, [o1, o2, shop]);
    const st = async (ref: string) => (await db.query<{ status: string }>(`select status from public.vendor_payouts where transfer_reference = $1`, [ref]))[0]!.status;
    // reversed, then a late success: stays reversed
    await send("transfer.reversed", { id: 1, reference: "po_ooo_1" });
    const late = await send("transfer.success", { id: 2, reference: "po_ooo_1" });
    expect((late.body as { result: string }).result).toMatch(/out of order/);
    expect(await st("po_ooo_1")).toBe("reversed");
    // success, then reversed: the later truth wins
    await send("transfer.success", { id: 3, reference: "po_ooo_2" });
    expect(await st("po_ooo_2")).toBe("success");
    await send("transfer.reversed", { id: 4, reference: "po_ooo_2" });
    expect(await st("po_ooo_2")).toBe("reversed");
  });

  it("a card dispute holds the order's pending payout and alerts admins; refund events update the refund", async () => {
    const s = await paidOrderSetup();
    verifyAnswer = () => verifySuccess(s.reference, s.id);
    await send("charge.success", { id: s.id, reference: s.reference });
    await db.query(`insert into public.vendor_payouts (order_id, vendor_id, amount_kobo, transfer_reference) values ($1, $2, 97000, $3)`, [s.orderId, shop, `po_${s.reference}`]);
    await send("charge.dispute.create", { id: 77, transaction: { reference: s.reference }, due_at: "2026-11-01" });
    expect((await db.query<{ status: string }>(`select status from public.vendor_payouts where transfer_reference = $1`, [`po_${s.reference}`]))[0]!.status).toBe("on_hold");

    await db.query(`insert into public.paystack_refunds (transaction_reference, order_id, amount_kobo, status) values ($1, $2, 1000, 'processing')`, [s.reference, s.orderId]);
    await send("refund.processed", { id: 5, transaction_reference: s.reference });
    expect((await db.query<{ status: string }>(`select status from public.paystack_refunds where transaction_reference = $1`, [s.reference]))[0]!.status).toBe("processed");
    const again = await send("refund.failed", { id: 6, transaction_reference: s.reference });
    expect((again.body as { result: string }).result).toMatch(/out of order/);
  });

  it("old-webhook parity: commission settlement and the ₦999 listing activation end the same way, with no double activation", async () => {
    // commission (reference starts "commission_"): the settlement becomes paid
    await db.query(`insert into public.commission_settlements (vendor_id, amount, status, provider_reference) values ($1, 500, 'pending', 'commission_p1')`, [shop]);
    verifyAnswer = () => ok({ id: 5001, status: "success", reference: "commission_p1", amount: 50000, currency: "NGN" });
    await send("charge.success", { id: 5001, reference: "commission_p1" });
    expect(await db.query(`select status from public.commission_settlements where provider_reference = 'commission_p1'`)).toEqual([{ status: "paid" }]);

    // listing: pending_payment -> active for a month, reference cleared
    const listing = await seedProduct(db, shop);
    await db.query(`update public.products set billing_model = 'monthly', billing_status = 'pending_payment', billing_reference = 'levro_listing_p1' where id = $1`, [listing]);
    const metadata = { purpose: "levromart_listing_monthly", kind: "product", listing_id: listing, vendor_id: shop };
    verifyAnswer = () => ok({ id: 5002, status: "success", reference: "levro_listing_p1", amount: 99900, currency: "NGN", metadata });
    await send("charge.success", { id: 5002, reference: "levro_listing_p1" });
    const read = () => db.query<{ status: string; billing_status: string; billing_reference: string | null; until: string }>(`select status, billing_status, billing_reference, billing_paid_until::text as until from public.products where id = $1`, [listing]);
    const [after] = await read();
    expect(after).toMatchObject({ status: "active", billing_status: "active", billing_reference: null });
    // a second event for the same payment (different id) must not add another month
    await send("charge.success", { id: 5003, reference: "levro_listing_p1" });
    expect((await read())[0]!.until).toBe(after!.until);
  });

  it("an unknown event is stored and answered with 200", async () => {
    const res = await send("customeridentification.success", { id: 1, reference: "zzz" });
    expect(res.status).toBe(200);
    expect((await events("zzz"))[0]!.result).toMatch(/unknown event/);
  });
});

describe("paystack state rules", () => {
  it("only move forward", () => {
    expect(canMovePayout("processing", "success")).toBe(true);
    expect(canMovePayout("success", "reversed")).toBe(true);
    expect(canMovePayout("reversed", "success")).toBe(false);
    expect(canMovePayout("failed", "success")).toBe(false);
    expect(canMoveTransaction("success", "initialized")).toBe(false);
    expect(canMoveTransaction("abandoned", "success")).toBe(true);
    expect(canMoveRefund("processed", "failed")).toBe(false);
    expect(canMoveRefund("failed", "processed")).toBe(true);
  });
});
