import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { identityOf, seedOrder, seedProduct, seedUser, seedVendor, setRole } from "../support/fixtures.js";
import { runTableQuery } from "../support/parity.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

/** Migration 0005: the Paystack ledger tables, their row-level security and their uniqueness rules. */
describe("paystack ledger (migration 0005)", () => {
  let db: TestDatabase;
  let admin: string;
  let buyerA: string;
  let buyerB: string;
  let ownerA: string;
  let ownerB: string;
  let shopA: string;
  let shopB: string;
  let orderA: string;
  let orderB: string;

  const insertTx = (reference: string, orderId: string | null, payer: string, extra = "") =>
    db.query(
      `insert into public.paystack_transactions (reference, purpose, order_id, payer_user_id, amount_kobo ${extra ? "," + extra.split("=")[0] : ""})
       values ($1, 'order_payment', $2, $3, 150000 ${extra ? "," + extra.split("=")[1] : ""})`,
      [reference, orderId, payer],
    );
  const seen = async (userId: string | null, table: string) =>
    ((await runTableQuery(db, userId ? identityOf(userId) : null, sql`select id from public.${sql.identifier(table)}`)).result as unknown[]) ?? [];

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = (await seedUser(db)).id;
    await setRole(db, admin, "admin");
    buyerA = (await seedUser(db)).id;
    buyerB = (await seedUser(db)).id;
    ownerA = (await seedUser(db, { role: "vendor" })).id;
    ownerB = (await seedUser(db, { role: "vendor" })).id;
    shopA = (await seedVendor(db, ownerA, { name: "Shop A" })).id;
    shopB = (await seedVendor(db, ownerB, { name: "Shop B" })).id;
    const productA = await seedProduct(db, shopA);
    const productB = await seedProduct(db, shopB);
    orderA = await seedOrder(db, buyerA, shopA, { productIds: [productA], total: 1500 });
    orderB = await seedOrder(db, buyerB, shopB, { productIds: [productB], total: 1500 });
    await insertTx("lvm_ord_a_1", orderA, buyerA);
    await insertTx("lvm_ord_b_1", orderB, buyerB);
    await db.query(`insert into public.vendor_payouts (order_id, vendor_id, amount_kobo, transfer_reference) values ($1, $2, 145500, 'po_a'), ($3, $4, 145500, 'po_b')`, [orderA, shopA, orderB, shopB]);
    await db.query(`insert into public.paystack_events (event_key, event, reference) values ('evt_1', 'charge.success', 'lvm_ord_a_1')`);
    await db.query(`insert into public.paystack_refunds (transaction_reference, order_id, amount_kobo) values ('lvm_ord_a_1', $1, 1000)`, [orderA]);
  }, 60_000);
  afterAll(() => db.close());

  it("a buyer reads only their own transactions; admins read all; signed-out sees nothing", async () => {
    expect(await seen(buyerA, "paystack_transactions")).toHaveLength(1);
    expect(await seen(buyerB, "paystack_transactions")).toHaveLength(1);
    expect(await seen(admin, "paystack_transactions")).toHaveLength(2);
    expect(await seen(null, "paystack_transactions")).toHaveLength(0);
  });

  it("a vendor reads only their own payouts; admins read all", async () => {
    expect(await seen(ownerA, "vendor_payouts")).toHaveLength(1);
    expect(await seen(ownerB, "vendor_payouts")).toHaveLength(1);
    expect(await seen(buyerA, "vendor_payouts")).toHaveLength(0);
    expect(await seen(admin, "vendor_payouts")).toHaveLength(2);
  });

  it("webhook events are admin-only; refunds are visible to the order's buyer, its vendor and admins", async () => {
    expect(await seen(buyerA, "paystack_events")).toHaveLength(0);
    expect(await seen(admin, "paystack_events")).toHaveLength(1);
    expect(await seen(buyerA, "paystack_refunds")).toHaveLength(1);
    expect(await seen(ownerA, "paystack_refunds")).toHaveLength(1);
    expect(await seen(buyerB, "paystack_refunds")).toHaveLength(0);
    expect(await seen(admin, "paystack_refunds")).toHaveLength(1);
  });

  it("the browser roles cannot insert or update any of the four tables", async () => {
    const attempts = [
      sql`insert into public.paystack_transactions (reference, purpose, amount_kobo) values ('x1', 'commission', 1)`,
      sql`insert into public.paystack_events (event_key, event) values ('x1', 'charge.success')`,
      sql`insert into public.vendor_payouts (order_id, vendor_id, amount_kobo, transfer_reference) values (${orderA}, ${shopA}, 1, 'x1')`,
      sql`insert into public.paystack_refunds (transaction_reference, order_id, amount_kobo) values ('lvm_ord_a_1', ${orderA}, 1)`,
      sql`update public.paystack_transactions set status = 'success'`,
      sql`update public.vendor_payouts set status = 'success'`,
    ];
    for (const who of [buyerA, ownerA, admin, null]) {
      for (const q of attempts) {
        const outcome = await runTableQuery(db, who ? identityOf(who) : null, q, false);
        expect("error" in outcome && outcome.error, `${who ?? "anon"} should be refused`).toBeTruthy();
      }
    }
  });

  it("two concurrent inserts of the same reference: one wins, one gets a unique violation", async () => {
    const dup = () => db.query(`insert into public.paystack_transactions (reference, purpose, payer_user_id, amount_kobo) values ('lvm_dup', 'commission', $1, 99900)`, [ownerA]);
    const results = await Promise.allSettled([dup(), dup()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(lost.reason?.code ?? lost.reason)).toContain("23505");
  });

  it("two concurrent payouts with the same transfer reference: one wins", async () => {
    const q = (order: string, shop: string) =>
      db.query(`insert into public.vendor_payouts (order_id, payout_purpose, vendor_id, amount_kobo, transfer_reference) values ($1, 'x', $2, 1, 'po_same')`, [order, shop]);
    const results = await Promise.allSettled([q(orderA, shopA), q(orderB, shopB)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("only one open attempt per order and purpose; a settled one does not block a new attempt", async () => {
    const o = await seedOrder(db, buyerA, shopA, { productIds: [await seedProduct(db, shopA)], total: 1500 });
    await insertTx("open_1", o, buyerA);
    await expect(insertTx("open_2", o, buyerA)).rejects.toMatchObject({ code: "23505" });
    await db.query(`update public.paystack_transactions set status = 'abandoned' where reference = 'open_1'`);
    await insertTx("open_3", o, buyerA);
  });

  it("the same webhook event cannot be recorded twice; the same refund attempt cannot be repeated", async () => {
    await expect(db.query(`insert into public.paystack_events (event_key, event) values ('evt_1', 'charge.success')`)).rejects.toMatchObject({ code: "23505" });
    await expect(db.query(`insert into public.paystack_refunds (transaction_reference, order_id, amount_kobo) values ('lvm_ord_a_1', $1, 1000)`, [orderA])).rejects.toMatchObject({ code: "23505" });
  });
});
