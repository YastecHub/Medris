import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsAdminService, windowOf } from "../../src/modules/payments-admin/payments-admin.service.js";
import { seedOrder, seedProduct, seedUser, seedVendor, setRole } from "../support/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

describe("admin payments and daily reconciliation (issue #101)", () => {
  let db: TestDatabase;
  let svc: PaymentsAdminService;
  let admin: string;
  let stranger: string;
  let buyer: string;
  let shop: string;
  let product: string;
  const savedKey = process.env.PAYSTACK_SECRET_KEY;
  let paystackRows: Array<{ reference: string; amount: number }> | "down";
  const DAY = "2026-10-20";
  const inDay = `${DAY}T10:00:00Z`;
  const as = (userId: string) => ({ userId }) as never;
  const page = { limit: 50, offset: 0 };

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_admin_payments";
    db = await createTestDatabase();
    svc = new PaymentsAdminService(() => db.data);
    admin = (await seedUser(db)).id;
    await setRole(db, admin, "admin");
    stranger = (await seedUser(db)).id;
    buyer = (await seedUser(db)).id;
    const owner = (await seedUser(db, { role: "vendor" })).id;
    shop = (await seedVendor(db, owner, { name: "Dayo" })).id;
    product = await seedProduct(db, shop);
  }, 60_000);
  beforeEach(async () => {
    await db.query(`delete from public.paystack_refunds`);
    await db.query(`delete from public.vendor_payouts`);
    await db.query(`delete from public.paystack_transactions`);
    await db.query(`delete from public.paystack_reconciliation_reports`);
    await db.query(`delete from public.notifications where title like 'Payment%'`);
    paystackRows = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        if (/\/transaction\?/.test(String(url))) {
          if (paystackRows === "down") return new Response("{}", { status: 503 });
          return new Response(JSON.stringify({ status: true, data: paystackRows.map((r) => ({ ...r, status: "success", id: 1 })) }), { status: 200 });
        }
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

  const ledger = (reference: string, status: string, kobo: number, paidAt: string | null = inDay, purpose = "order_payment") =>
    db.query(`insert into public.paystack_transactions (reference, purpose, vendor_id, payer_user_id, amount_kobo, status, paid_at) values ($1, $2, $3, $4, $5, $6, $7)`, [reference, purpose, shop, buyer, kobo, status, paidAt]);
  const lastReport = async () => (await db.query<{ problems: number; report: { problems: Array<{ kind: string; reference?: string }>; checked: number; legacyPaymentsNotInLedger: number; error?: string } }>(`select problems, report from public.paystack_reconciliation_reports order by created_at desc limit 1`))[0]!;

  it("the window is one whole UTC day", () => {
    expect(windowOf(DAY)).toEqual({ start: "2026-10-20T00:00:00.000Z", end: "2026-10-21T00:00:00.000Z" });
  });

  it("every planted mismatch is reported, and a matching payment is not", async () => {
    await ledger("lvm_ord_good", "success", 100000);
    await ledger("lvm_ord_unsettled", "initialized", 50000, null);
    await ledger("lvm_ord_amount", "success", 70000);
    await ledger("lvm_ord_ghost", "success", 30000); // settled here, nothing at Paystack
    paystackRows = [
      { reference: "lvm_ord_good", amount: 100000 },
      { reference: "lvm_ord_unsettled", amount: 50000 },
      { reference: "lvm_ord_amount", amount: 75000 },
      { reference: "lvm_ord_unknown", amount: 20000 }, // our kind of reference, but not in the ledger
      { reference: "medris_legacy_1", amount: 10000 }, // an old-flow payment: not a problem
    ];
    const r = await svc.reconcile(DAY);
    const rep = await lastReport();
    const kinds = rep.report.problems.map((p) => `${p.kind}:${p.reference}`).sort();
    expect(kinds).toEqual([
      "amount_mismatch:lvm_ord_amount",
      "missing_from_ledger:lvm_ord_unknown",
      "paid_at_paystack_not_settled:lvm_ord_unsettled",
      "settled_here_not_at_paystack:lvm_ord_ghost",
    ]);
    expect(rep.report.legacyPaymentsNotInLedger).toBe(1);
    expect(rep.report.checked).toBe(5);
    expect(r.problems).toBe(4);
    const told = await db.query(`select body from public.notifications where user_id = $1 and title = 'Payments don''t match Paystack'`, [admin]);
    expect(told).toHaveLength(1);
  });

  it("stuck payouts and refunds are reported", async () => {
    const order = await seedOrder(db, buyer, shop, { status: "completed", productIds: [product], total: 1000 });
    await db.query(`insert into public.vendor_payouts (order_id, vendor_id, amount_kobo, transfer_reference, status) values ($1, $2, 100000, 'lvm_po_stuck', 'processing')`, [order, shop]);
    await ledger("lvm_ord_r", "success", 100000);
    paystackRows = [{ reference: "lvm_ord_r", amount: 100000 }];
    await db.query(`insert into public.paystack_refunds (transaction_reference, order_id, attempt, amount_kobo, status) values ('lvm_ord_r', $1, 1, 1000, 'processing')`, [order]);
    await db.query(`alter table public.vendor_payouts disable trigger user`);
    await db.query(`alter table public.paystack_refunds disable trigger user`);
    await db.query(`update public.vendor_payouts set updated_at = now() - interval '3 hours'`);
    await db.query(`update public.paystack_refunds set updated_at = now() - interval '3 hours'`);
    await db.query(`alter table public.vendor_payouts enable trigger user`);
    await db.query(`alter table public.paystack_refunds enable trigger user`);
    await svc.reconcile(DAY);
    const kinds = (await lastReport()).report.problems.map((p) => p.kind).sort();
    expect(kinds).toEqual(["refund_stuck", "transfer_stuck"]);
  });

  it("a clean day stores a clean report and tells nobody", async () => {
    await ledger("lvm_ord_fine", "success", 5000);
    paystackRows = [{ reference: "lvm_ord_fine", amount: 5000 }];
    expect(await svc.reconcile(DAY)).toEqual({ problems: 0, checked: 1 });
    expect((await lastReport()).problems).toBe(0);
    expect(await db.query(`select 1 from public.notifications where title = 'Payments don''t match Paystack'`)).toHaveLength(0);
  });

  it("when Paystack cannot be asked, that is reported loudly instead of looking clean", async () => {
    paystackRows = "down";
    const r = await svc.reconcile(DAY);
    expect(r.problems).toBe(1);
    expect((await lastReport()).report.error).toMatch(/Could not ask Paystack/);
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and title = 'Payment check could not run'`, [admin])).length).toBeGreaterThan(0);
  });

  it("running the same day twice keeps one report", async () => {
    await svc.reconcile(DAY);
    await svc.reconcile(DAY);
    expect(await db.query(`select 1 from public.paystack_reconciliation_reports`)).toHaveLength(1);
  });

  it("only admins can see anything", async () => {
    await expect(svc.summary(as(stranger))).rejects.toThrow(/admin/i);
    await expect(svc.transactions(as(stranger), {}, page)).rejects.toThrow(/admin/i);
    await expect(svc.refunds(as(stranger), {}, page)).rejects.toThrow(/admin/i);
    await expect(svc.reports(as(stranger), 5)).rejects.toThrow(/admin/i);
    await expect(svc.summary(as(admin))).resolves.toBeTruthy();
  });

  it("lists filter by status, purpose and vendor, and totals add up", async () => {
    await ledger("lvm_ord_a", "success", 200000, new Date().toISOString());
    await ledger("lvm_ord_b", "failed", 90000, null);
    await ledger("commission_c", "success", 5000, new Date().toISOString(), "commission");
    expect((await svc.transactions(as(admin), { status: "success" }, page)).map((t) => (t as unknown as { reference: string }).reference).sort()).toEqual(["commission_c", "lvm_ord_a"]);
    expect(await svc.transactions(as(admin), { purpose: "commission" }, page)).toHaveLength(1);
    expect(await svc.transactions(as(admin), { vendorId: "00000000-0000-0000-0000-000000000000" }, page)).toHaveLength(0);
    const s = await svc.summary(as(admin));
    expect(s.today.collected).toBe(2000); // order payments only: commission is not an order payment
    expect(s.health.held_payouts).toBe(0);
  });
});
