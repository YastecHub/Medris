import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./support/test-db.js";
import { seedProduct, seedUser, seedVendor } from "./support/fixtures.js";

/** Migration 0072: a manager's comment appears as the shop. */
describe("managers reply as the shop (migration 0072)", () => {
  let db: TestDatabase; let owner: string, manager: string, staff: string, shop: string, product: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    owner = (await seedUser(db, { role: "vendor" })).id; manager = (await seedUser(db)).id; staff = (await seedUser(db)).id;
    shop = (await seedVendor(db, owner)).id; product = await seedProduct(db, shop);
    await db.query(`update public.vendors set business_name = 'Fay Lux' where id = $1`, [shop]);
    await db.query(`insert into public.vendor_members (vendor_id, user_id, role, status) values ($1, $2, 'manager', 'active'), ($1, $3, 'staff', 'active')`, [shop, manager, staff]);
  }, 60000);
  afterAll(async () => db.close());
  async function as(userId: string, sql: string, params: unknown[] = []) {
    const { client, release } = await db.sqlClient();
    try {
      await client.query(`select set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.sub', $2, false)`, [JSON.stringify({ sub: userId, role: "authenticated" }), userId]);
      await client.query(`set role authenticated`);
      return (await client.query(sql, params)).rows as Record<string, unknown>[];
    } finally { await client.query(`reset role`); release(); }
  }
  it("a manager's comment carries the shop's name; a staff member's carries their own", async () => {
    const m = await as(manager, `insert into public.product_comments (product_id, content) values ($1, 'Yes, it is in stock') returning author_name`, [product]);
    expect(m[0]!.author_name).toBe("Fay Lux");
    const s = await as(staff, `insert into public.product_comments (product_id, content) values ($1, 'Hello') returning author_name`, [product]);
    expect(s[0]!.author_name).not.toBe("Fay Lux");
  });
});
