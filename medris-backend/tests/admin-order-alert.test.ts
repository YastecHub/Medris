import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./support/test-db.js";
import { seedOrder, seedUser, seedVendor } from "./support/fixtures.js";

/** Migration 0073: every admin is told about a new pending order. */
describe("admin new-order alert (migration 0073)", () => {
  let db: TestDatabase; let admin: string, admin2: string, buyer: string, shop: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    admin = (await seedUser(db, { role: "admin" })).id; admin2 = (await seedUser(db, { role: "admin" })).id;
    buyer = (await seedUser(db)).id; const owner = (await seedUser(db, { role: "vendor" })).id; shop = (await seedVendor(db, owner)).id;
  }, 60000);
  afterAll(async () => db.close());
  it("a new pending order alerts all admins once; a completed one does not", async () => {
    const order = await seedOrder(db, buyer, shop, { status: "pending" });
    await seedOrder(db, buyer, shop, { status: "completed" });
    const rows = await db.query<{ user_id: string; target_view: string }>(`select user_id, target_view from public.notifications where type = 'admin_new_order' and target_params->>'orderId' = $1`, [order]);
    expect(rows.map((r) => r.user_id).sort()).toEqual([admin, admin2].sort());
    expect(rows.every((r) => r.target_view === "adminOrders")).toBe(true);
    const all = await db.query(`select 1 from public.notifications where type = 'admin_new_order'`);
    expect(all).toHaveLength(2);
  });
});
