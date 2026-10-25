import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setDataContextProvider } from "../../src/database/index.js";
import { PaystackWebhookService } from "../../src/modules/paystack-webhook/paystack-webhook.service.js";
import { VendorFeesService } from "../../src/modules/vendor-fees/vendor-fees.service.js";
import { seedOrder, seedProduct, seedUser, seedVendor } from "../support/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

const SECRET = "sk_test_vendor_fees";
const sign = (raw: string) => crypto.createHmac("sha512", SECRET).update(raw).digest("hex");

describe("vendor fees through Paystack (issue #100)", () => {
  let db: TestDatabase;
  let fees: VendorFeesService;
  let webhook: PaystackWebhookService;
  let buyer: string;
  let owner: string;
  let other: string;
  let shop: string;
  const savedKey = process.env.PAYSTACK_SECRET_KEY;
  let seq = 0;
  let initializeAnswer: () => Response;
  let verifyAmount: (reference: string) => number | null;
  const initCalls: Array<Record<string, unknown>> = [];

  const ok = (data: unknown) => new Response(JSON.stringify({ status: true, data }), { status: 200 });
  const me = (userId: string) => ({ userId, email: `${userId.slice(0, 6)}@test.dev` }) as never;

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    db = await createTestDatabase();
    fees = new VendorFeesService(() => db.data, true);
    webhook = new PaystackWebhookService(() => db.data);
    setDataContextProvider(() => db.data);
    buyer = (await seedUser(db)).id;
    other = (await seedUser(db)).id;
    owner = (await seedUser(db, { role: "vendor" })).id;
    shop = (await seedVendor(db, owner, { name: "Dayo" })).id;
  }, 60_000);
  beforeEach(() => {
    initCalls.length = 0;
    initializeAnswer = () => ok({ authorization_url: `https://checkout.paystack.test/${++seq}`, access_code: `AC${seq}`, reference: "x" });
    verifyAmount = () => null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        if (/\/transaction\/initialize$/.test(u)) {
          initCalls.push(JSON.parse(String(init?.body)));
          return initializeAnswer();
        }
        const v = /\/transaction\/verify\/([^/?]+)/.exec(u);
        if (v) {
          const reference = decodeURIComponent(v[1]!);
          const amount = verifyAmount(reference);
          if (amount === null) return ok({ status: "abandoned", reference, amount: 0 });
          const meta = initCalls.find((c) => c.reference === reference)?.metadata ?? {};
          return ok({ id: 7000 + ++seq, status: "success", reference, amount, currency: "NGN", channel: "card", paid_at: new Date().toISOString(), metadata: meta });
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    setDataContextProvider(null);
    if (savedKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = savedKey;
    await db.close();
  });

  const eventIds = new Map<string, number>();
  // a repeat delivery of the same payment carries the same event id; a different payment, a different one
  const pay = (reference: string) => {
    if (!eventIds.has(reference)) eventIds.set(reference, 5000 + eventIds.size);
    const raw = JSON.stringify({ event: "charge.success", data: { id: eventIds.get(reference), reference } });
    return webhook.handle(raw, sign(raw));
  };
  async function monthlyProduct() {
    const id = await seedProduct(db, shop);
    await db.query(`update public.products set billing_model = 'monthly', status = 'paused' where id = $1`, [id]);
    return id;
  }
  const listingRow = async (id: string) => (await db.query<{ status: string; billing_status: string; billing_reference: string | null; until: string | null }>(`select status, billing_status, billing_reference, billing_paid_until::text as until from public.products where id = $1`, [id]))[0]!;
  const ledger = (reference: string) => db.query<{ purpose: string; status: string; amount_kobo: string; listing_id: string | null; vendor_id: string }>(`select purpose, status, amount_kobo::text, listing_id, vendor_id from public.paystack_transactions where reference = $1`, [reference]);

  it("listing: starting the payment records it, pauses the listing and charges exactly ₦999", async () => {
    const id = await monthlyProduct();
    const r = (await fees.initializeListing(me(owner), "product", id, "https://app.test")) as { reference: string; amountNaira: number; authorizationUrl: string };
    expect(r.amountNaira).toBe(999);
    expect(initCalls[0]).toMatchObject({ amount: 99900, metadata: expect.objectContaining({ purpose: "levromart_listing_monthly", listing_id: id, kind: "product" }) });
    expect(await ledger(r.reference)).toEqual([expect.objectContaining({ purpose: "listing_fee", status: "initialized", amount_kobo: "99900", listing_id: id })]);
    expect(await listingRow(id)).toMatchObject({ status: "paused", billing_status: "pending_payment", billing_reference: r.reference });
  });

  it("listing: a double tap gets the same link and one ledger row", async () => {
    const id = await monthlyProduct();
    const a = (await fees.initializeListing(me(owner), "product", id, "https://app.test")) as { reference: string };
    const b = (await fees.initializeListing(me(owner), "product", id, "https://app.test")) as { reference: string };
    expect(b.reference).toBe(a.reference);
    expect(initCalls).toHaveLength(1);
  });

  it("listing: the webhook activates it once; a repeat does not extend it; paying again is refused as already active", async () => {
    const id = await monthlyProduct();
    const r = (await fees.initializeListing(me(owner), "product", id, "https://app.test")) as { reference: string };
    verifyAmount = () => 99900;
    await pay(r.reference);
    const first = await listingRow(id);
    expect(first).toMatchObject({ status: "active", billing_status: "active", billing_reference: null });
    expect(first.until).not.toBeNull();
    await pay(r.reference);
    expect((await listingRow(id)).until).toBe(first.until);
    const again = await fees.initializeListing(me(owner), "product", id, "https://app.test");
    expect(again).toMatchObject({ alreadyActive: true });
    expect(initCalls).toHaveLength(1);
    expect((await ledger(r.reference))[0]!.status).toBe("success");
  });

  it("listing: a payment of the wrong amount activates nothing", async () => {
    const id = await monthlyProduct();
    const r = (await fees.initializeListing(me(owner), "product", id, "https://app.test")) as { reference: string };
    verifyAmount = () => 50000;
    await pay(r.reference);
    expect((await listingRow(id)).billing_status).toBe("pending_payment");
  });

  it("listing: only the owner, only monthly billing, and the switch must be on", async () => {
    const id = await monthlyProduct();
    await expect(fees.initializeListing(me(other), "product", id, "https://app.test")).rejects.toThrow(/own listing/);
    const commissionListing = await seedProduct(db, shop);
    await expect(fees.initializeListing(me(owner), "product", commissionListing, "https://app.test")).rejects.toThrow(/monthly billing/);
    await expect(new VendorFeesService(() => db.data, false).initializeListing(me(owner), "product", id, "https://app.test")).rejects.toThrow();
  });

  it("listing: Paystack refusing to start the payment puts the listing back as it was", async () => {
    const id = await monthlyProduct();
    initializeAnswer = () => new Response(JSON.stringify({ status: false, message: "Invalid email" }), { status: 400 });
    await expect(fees.initializeListing(me(owner), "product", id, "https://app.test")).rejects.toThrow(/Invalid email/);
    expect(await listingRow(id)).toMatchObject({ status: "paused", billing_reference: null });
  });

  async function owedCommission(...amounts: number[]) {
    await db.query(`delete from public.commission_charges where vendor_id = $1`, [shop]);
    for (const amount of amounts) {
      const order = await seedOrder(db, buyer, shop, { status: "completed", total: 10000 });
      await db.query(`delete from public.commission_charges where order_id = $1`, [order]);
      await db.query(`insert into public.commission_charges (vendor_id, order_id, amount, status) values ($1, $2, $3, 'owed')`, [shop, order, amount]);
    }
  }

  it("commission: one charge is settled by the webhook, exactly as before", async () => {
    await owedCommission(300);
    const r = await fees.initializeCommission(me(owner), "https://app.test");
    expect(r.amountNaira).toBe(300);
    expect(r.reference).toMatch(/^commission_/);
    expect(await ledger(r.reference)).toEqual([expect.objectContaining({ purpose: "commission", amount_kobo: "30000", vendor_id: shop })]);
    verifyAmount = () => 30000;
    await pay(r.reference);
    const settlement = await db.query<{ status: string }>(`select status from public.commission_settlements where provider_reference = $1`, [r.reference]);
    expect(settlement[0]!.status).toBe("paid");
    const charges = await db.query<{ status: string }>(`select status from public.commission_charges where vendor_id = $1`, [shop]);
    expect(charges.map((c) => c.status)).toEqual(["paid"]);
  });

  it("commission: several charges are one payment, all settled together", async () => {
    await owedCommission(120.5, 80, 49.5);
    const r = await fees.initializeCommission(me(owner), "https://app.test");
    expect(r.amountNaira).toBe(250);
    verifyAmount = () => 25000;
    await pay(r.reference);
    const charges = await db.query<{ status: string }>(`select status from public.commission_charges where vendor_id = $1`, [shop]);
    expect(charges.map((c) => c.status)).toEqual(["paid", "paid", "paid"]);
    await expect(fees.initializeCommission(me(owner), "https://app.test")).rejects.toThrow(/No commission currently owed/);
  });

  it("commission: a double tap makes one payment and one settlement", async () => {
    await owedCommission(100);
    const results = await Promise.allSettled([fees.initializeCommission(me(owner), "https://app.test"), fees.initializeCommission(me(owner), "https://app.test")]);
    // The second tap arrives while the first is still being set up with Paystack. Depending on timing it either waits and
    // gets the same payment back (real PostgreSQL), or is turned away (PGlite runs one query at a time) - never a second
    // payment.
    const fulfilled = results.flatMap((r) => (r.status === "fulfilled" ? [r] : []));
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(new Set(fulfilled.map((r) => r.value.reference)).size).toBe(1);
    const a = fulfilled[0]!.value;
    const b = await fees.initializeCommission(me(owner), "https://app.test");
    expect(b.reference).toBe(a.reference);
    const settlements = await db.query(`select 1 from public.commission_settlements where vendor_id = $1 and status = 'pending'`, [shop]);
    expect(settlements.length).toBeGreaterThanOrEqual(1);
    const open = await db.query(`select 1 from public.paystack_transactions where purpose = 'commission' and vendor_id = $1 and status = 'initialized'`, [shop]);
    expect(open).toHaveLength(1);
  });

  it("commission: someone without a shop cannot pay; a changed amount replaces the old attempt", async () => {
    await expect(fees.initializeCommission(me(other), "https://app.test")).rejects.toThrow(/shop/);
    await owedCommission(100);
    const first = await fees.initializeCommission(me(owner), "https://app.test");
    await owedCommission(100, 50);
    const second = await fees.initializeCommission(me(owner), "https://app.test");
    expect(second.reference).not.toBe(first.reference);
    expect(second.amountNaira).toBe(150);
    expect((await ledger(first.reference))[0]!.status).toBe("abandoned");
  });
});
