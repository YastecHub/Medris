import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedUser, seedVendor } from "../support/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

describe("no numbers in a shop's about text (migration 0011)", () => {
  let db: TestDatabase;
  let shop: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    const owner = (await seedUser(db, { role: "vendor" })).id;
    shop = (await seedVendor(db, owner, { name: "Dayo" })).id;
  }, 60_000);
  afterAll(async () => db.close());

  const setBio = (bio: string | null) => db.query(`update public.vendors set bio = $2 where id = $1`, [shop, bio]);

  it("refuses digits in a changed bio, whichever kind", async () => {
    await expect(setBio("Call 08031234567")).rejects.toThrow(/Numbers are not allowed/);
    await expect(setBio("Open since 2019")).rejects.toThrow(/Numbers are not allowed/);
    await expect(setBio("Pay to ٠١٢٣")).rejects.toThrow(/Numbers are not allowed/);
  });

  it("accepts a bio without digits, and an empty one", async () => {
    await setBio("Fresh food and drinks for the whole campus");
    await setBio(null);
    expect((await db.query<{ bio: string | null }>(`select bio from public.vendors where id = $1`, [shop]))[0]!.bio).toBeNull();
  });

  it("leaves an old bio with digits alone when something else changes", async () => {
    await db.query(`alter table public.vendors disable trigger vendors_bio_no_numbers`);
    await setBio("Old text 123");
    await db.query(`alter table public.vendors enable trigger vendors_bio_no_numbers`);
    await db.query(`update public.vendors set city = 'Lagos' where id = $1`, [shop]);
    await expect(setBio("Old text 123 again")).rejects.toThrow(/Numbers are not allowed/);
  });
});
