import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./support/test-db.js";
import { seedUser } from "./support/fixtures.js";

/** Migration 0066: a business account (made by "Add business") may share its owner's phone number; nobody else may. */
describe("business accounts share the owner's phone number (migration 0066)", () => {
  let db: TestDatabase;
  beforeAll(async () => { db = await createTestDatabase(); });
  afterAll(async () => db.close());

  const setPhone = (id: string, phone: string) => db.query(`update public.users set phone = $2 where id = $1`, [id, phone]);

  it("two ordinary accounts still cannot share a phone number", async () => {
    const a = await seedUser(db, { phone: "08011110001" });
    const b = await seedUser(db, { phone: null });
    await expect(setPhone(b.id, "08011110001")).rejects.toThrow(/users_phone_key|duplicate key/);
    expect(a.id).not.toBe(b.id);
  });

  it("a business account may use the same number as its owner and as the owner's other businesses", async () => {
    const owner = await seedUser(db, { phone: "08022220002" });
    const biz1 = await seedUser(db, { phone: null });
    const biz2 = await seedUser(db, { phone: null });
    for (const b of [biz1, biz2]) {
      await db.query(`insert into public.business_links (business_user_id, owner_id) values ($1, $2)`, [b.id, owner.id]);
      await db.query(`update public.users set is_business_account = true where id = $1`, [b.id]);   // the server does this when it creates the business
    }
    await setPhone(biz1.id, "08022220002");
    await setPhone(biz2.id, "08022220002");
    const rows = await db.query<{ n: string }>(`select count(*)::text as n from public.users where phone = '08022220002'`);
    expect(rows[0]!.n).toBe("3");
  });

  it("an ordinary account still cannot take a number a business account is using", async () => {
    const owner = await seedUser(db, { phone: "08033330003" });
    const biz = await seedUser(db, { phone: null });
    await db.query(`insert into public.business_links (business_user_id, owner_id) values ($1, $2)`, [biz.id, owner.id]);
    await db.query(`update public.users set is_business_account = true where id = $1`, [biz.id]);
    await setPhone(biz.id, "08033330003");
    const stranger = await seedUser(db, { phone: null });
    await expect(setPhone(stranger.id, "08033330003")).rejects.toThrow(/users_phone_key|duplicate key/);
  });

  it("a signed-in person cannot switch the business flag on for themselves", async () => {
    const owner = await seedUser(db, { phone: "08044440004" });
    const user = await seedUser(db, { phone: null });
    const { client, release } = await db.sqlClient();
    try {
      await client.query(`select set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.sub', $2, false)`, [JSON.stringify({ sub: user.id, role: "authenticated" }), user.id]);
      await client.query(`update public.users set is_business_account = true where id = $1`, [user.id]);
      const r = await client.query<{ f: boolean }>(`select is_business_account as f from public.users where id = $1`, [user.id]);
      expect(r.rows[0]!.f).toBe(false);
    } finally {
      await client.query(`select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)`);
      release();
    }
    await expect(setPhone(user.id, "08044440004")).rejects.toThrow(/users_phone_key|duplicate key/);
    expect(owner.id).not.toBe(user.id);
  });
});
