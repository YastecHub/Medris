import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FollowsService } from "../../src/modules/follows/follows.service.js";
import { seedUser, seedVendor } from "../support/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

describe("customers following a shop are visible to signed-in people", () => {
  let db: TestDatabase;
  let svc: FollowsService;
  let shop: string;
  let customer: string;
  let viewer: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    svc = new FollowsService(() => db.data);
    const owner = (await seedUser(db, { role: "vendor" })).id;
    shop = (await seedVendor(db, owner, { name: "Dayo" })).id;
    customer = (await seedUser(db, { name: "Ada Customer" })).id;
    viewer = (await seedUser(db)).id;
    const otherOwner = (await seedUser(db, { role: "vendor" })).id;
    const otherShop = (await seedVendor(db, otherOwner, { name: "Other Shop" })).id;
    await db.query(`insert into public.vendor_follows (follower_id, vendor_id) values ($1, $2), ($3, $2)`, [customer, shop, otherOwner]);
    void otherShop;
  }, 60_000);
  afterAll(async () => db.close());

  it("lists customers (not shops) with only a name, picture and date", async () => {
    const rows = await svc.followerCustomers({ userId: viewer } as never, shop);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["avatar_url", "followed_at", "name"]);
    expect(rows[0]!.name).toBe("Ada Customer");
  });

  it("needs a signed-in person", () => {
    expect(() => svc.followerCustomers(null, shop)).toThrow(/Authentication/);
  });
});
