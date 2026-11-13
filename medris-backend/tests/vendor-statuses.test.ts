import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./support/test-db.js";
import { seedProduct, seedUser, seedVendor } from "./support/fixtures.js";

/** Migration 0068: vendor statuses last 24 hours, only the shop (or its manager) writes, everyone reads live ones. */
describe("vendor statuses (migration 0068)", () => {
  let db: TestDatabase; let owner: string, manager: string, stranger: string, shop: string, other: string, product: string, otherProduct: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    owner = (await seedUser(db, { role: "vendor" })).id; manager = (await seedUser(db)).id; stranger = (await seedUser(db)).id;
    shop = (await seedVendor(db, owner)).id; product = await seedProduct(db, shop);
    const o2 = (await seedUser(db, { role: "vendor" })).id; other = (await seedVendor(db, o2)).id; otherProduct = await seedProduct(db, other);
    await db.query(`insert into public.vendor_members (vendor_id, user_id, role, status) values ($1, $2, 'manager', 'active')`, [shop, manager]);
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
  it("the owner and a manager can post; a stranger and another shop's owner cannot", async () => {
    await as(owner, `insert into public.vendor_statuses (vendor_id, product_id, caption) values ($1, $2, 'Fresh stock')`, [shop, product]);
    await as(manager, `insert into public.vendor_statuses (vendor_id, product_id) values ($1, $2)`, [shop, product]);
    await expect(as(stranger, `insert into public.vendor_statuses (vendor_id, product_id) values ($1, $2)`, [shop, product])).rejects.toThrow();
    await expect(as(owner, `insert into public.vendor_statuses (vendor_id, product_id) values ($1, $2)`, [shop, otherProduct])).rejects.toThrow(/does not belong/);
  });
  it("everyone sees live statuses, which last 24 hours; expired ones disappear", async () => {
    const live = await as<{ id: string }>(stranger, `select id from public.vendor_statuses where vendor_id = $1`, [shop]);
    expect(live).toHaveLength(2);
    const [row] = await db.query<{ h: string }>(`select round(extract(epoch from (expires_at - created_at)) / 3600)::text as h from public.vendor_statuses limit 1`);
    expect(row!.h).toBe("24");
    await db.query(`update public.vendor_statuses set expires_at = now() - interval '1 minute' where caption = 'Fresh stock'`);
    expect(await as(stranger, `select id from public.vendor_statuses where vendor_id = $1`, [shop])).toHaveLength(1);
  });
  it("views are counted once per person and only the shop sees who looked; at most 10 live statuses", async () => {
    const [s] = await as<{ id: string }>(stranger, `select id from public.vendor_statuses where vendor_id = $1`, [shop]);
    await as(stranger, `insert into public.vendor_status_views (status_id, viewer_id) values ($1, $2)`, [s!.id, stranger]);
    await expect(as(stranger, `insert into public.vendor_status_views (status_id, viewer_id) values ($1, $2)`, [s!.id, stranger]), 'duplicate view').rejects.toThrow();
    await expect(as(stranger, `insert into public.vendor_status_views (status_id, viewer_id) values ($1, $2)`, [s!.id, owner]), 'someone else').rejects.toThrow();
    expect(await as(owner, `select viewer_id from public.vendor_status_views where status_id = $1`, [s!.id])).toHaveLength(1);
    expect(await as(manager, `select viewer_id from public.vendor_status_views where status_id = $1`, [s!.id])).toHaveLength(1);
    for (let i = 0; i < 9; i++) await as(owner, `insert into public.vendor_statuses (vendor_id, product_id) values ($1, $2)`, [shop, product]);
    await expect(as(owner, `insert into public.vendor_statuses (vendor_id, product_id) values ($1, $2)`, [shop, product]), 'limit').rejects.toThrow(/at most 10/);
  });
});

describe("vendor status alerts to followers (migration 0069)", () => {
  it("followers get one alert per hour; muted or opted-out followers do not", async () => {
    const db = await createTestDatabase();
    try {
      const owner = (await seedUser(db, { role: "vendor" })).id, a = (await seedUser(db)).id, b = (await seedUser(db)).id, c = (await seedUser(db)).id;
      const shop = (await seedVendor(db, owner)).id, product = await seedProduct(db, shop);
      for (const u of [a, b, c]) await db.query(`insert into public.vendor_follows (follower_id, vendor_id) values ($1, $2)`, [u, shop]);
      await db.query(`insert into public.vendor_follow_preferences (follower_id, vendor_id, notify_new_listing) values ($1, $2, false)`, [b, shop]);
      await db.query(`insert into public.vendor_follow_preferences (follower_id, vendor_id, mute_mode, muted_until) values ($1, $2, '8h', now() + interval '1 day')`, [c, shop]);
      await db.query(`insert into public.vendor_statuses (vendor_id, product_id, caption, created_by) values ($1, $2, 'New stock', $3)`, [shop, product, owner]);
      await db.query(`insert into public.vendor_statuses (vendor_id, product_id, created_by) values ($1, $2, $3)`, [shop, product, owner]);
      const rows = await db.query<{ user_id: string }>(`select user_id from public.notifications where type = 'vendor_status'`);
      expect(rows.map((r) => r.user_id)).toEqual([a]);
    } finally { await db.close(); }
  }, 60000);
});
