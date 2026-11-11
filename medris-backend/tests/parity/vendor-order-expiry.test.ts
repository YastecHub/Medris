import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScheduledJobsService } from "../../src/modules/scheduled-jobs/scheduled-jobs.service.js";
import { seedOrder, seedProduct, seedUser, seedVendor } from "../support/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

describe("vendor chosen order expiry (migration 0045)", () => {
  let db: TestDatabase;
  let jobs: ScheduledJobsService;
  let buyer: string;
  beforeAll(async () => {
    db = await createTestDatabase();
    jobs = new ScheduledJobsService(() => db.data);
    buyer = (await seedUser(db)).id;
  }, 60_000);
  afterAll(async () => db.close());

  async function pendingOrder(minutes: number, ageMin: number) {
    const owner = (await seedUser(db, { role: "vendor" })).id;
    const shop = (await seedVendor(db, owner, { name: "Shop" + Math.random() })).id;
    await db.query(`update public.vendors set order_expiry_minutes = $1 where id = $2`, [minutes, shop]);
    const product = await seedProduct(db, shop);
    const id = await seedOrder(db, buyer, shop, { status: "pending", productIds: [product], total: 1000 });
    await db.query(`update public.orders set created_at = now() - make_interval(mins => $1) where id = $2`, [ageMin, id]);
    return id;
  }
  const status = async (id: string) => (await db.query<{ status: string }>(`select status from public.orders where id = $1`, [id]))[0]!.status;

  it("cancels at the shop's own time, not always at 30 minutes", async () => {
    const stays = await pendingOrder(120, 45); // 2 hours chosen, 45 minutes old: stays
    const goes = await pendingOrder(60, 61); // 1 hour chosen, 61 minutes old: cancelled
    const never = await pendingOrder(0, 5000); // never: stays
    const dflt = await pendingOrder(30, 31); // default: cancelled
    await jobs.autoCancelUnconfirmedOrders();
    expect(await status(stays)).toBe("pending");
    expect(await status(goes)).toBe("cancelled");
    expect(await status(never)).toBe("pending");
    expect(await status(dflt)).toBe("cancelled");
  });

  it("refuses a value that is not one of the allowed choices", async () => {
    const owner = (await seedUser(db, { role: "vendor" })).id;
    const shop = (await seedVendor(db, owner, { name: "Bad" })).id;
    await expect(db.query(`update public.vendors set order_expiry_minutes = 45 where id = $1`, [shop])).rejects.toThrow();
  });
});
