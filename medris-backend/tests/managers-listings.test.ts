import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./support/test-db.js";
import { seedProduct, seedUser, seedVendor } from "./support/fixtures.js";

/** Migration 0070: managers manage the shop's listings; staff and strangers cannot. */
describe("managers manage listings (migration 0070)", () => {
  let db: TestDatabase; let owner: string, manager: string, staff: string, stranger: string, shop: string, product: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    owner = (await seedUser(db, { role: "vendor" })).id; manager = (await seedUser(db)).id; staff = (await seedUser(db)).id; stranger = (await seedUser(db)).id;
    shop = (await seedVendor(db, owner)).id; product = await seedProduct(db, shop);
    await db.query(`insert into public.vendor_members (vendor_id, user_id, role, status) values ($1, $2, 'manager', 'active'), ($1, $3, 'staff', 'active')`, [shop, manager, staff]);
  }, 60000);
  afterAll(async () => db.close());
  async function as<T>(userId: string, sql: string, params: unknown[] = []) {
    const { client, release } = await db.sqlClient();
    try {
      await client.query(`select set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.sub', $2, false)`, [JSON.stringify({ sub: userId, role: "authenticated" }), userId]);
      await client.query(`set role authenticated`);
      return (await client.query(sql, params)).rows as T[];
    } finally { await client.query(`reset role`); release(); }
  }
  it("a manager can edit and pause a product; staff and strangers cannot", async () => {
    expect(await as(manager, `update public.products set name = 'Renamed', status = 'paused' where id = $1 returning id`, [product])).toHaveLength(1);
    expect(await as(staff, `update public.products set name = 'Nope' where id = $1 returning id`, [product])).toHaveLength(0);
    expect(await as(stranger, `update public.products set name = 'Nope' where id = $1 returning id`, [product])).toHaveLength(0);
    const [row] = await db.query<{ name: string; status: string }>(`select name, status::text from public.products where id = $1`, [product]);
    expect(row).toEqual({ name: "Renamed", status: "paused" });
  });
  it("a manager can still see a paused product; a stranger cannot", async () => {
    expect(await as(manager, `select id from public.products where id = $1`, [product])).toHaveLength(1);
    expect(await as(stranger, `select id from public.products where id = $1`, [product])).toHaveLength(0);
  });
  it("a manager can delete a product; staff cannot", async () => {
    const other = await seedProduct(db, shop);
    expect(await as(staff, `delete from public.products where id = $1 returning id`, [other])).toHaveLength(0);
    expect(await as(manager, `delete from public.products where id = $1 returning id`, [other])).toHaveLength(1);
  });
});
