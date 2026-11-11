import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";
import { accessToken, buildTestApp, call, seedUser, seedVendor } from "../support/fixtures.js";

/** "Show when I'm online" (migration 0062): on by default; a shop that switches it off shows nothing to anyone. */
describe("shop online status can be hidden", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof buildTestApp>;
  beforeAll(async () => {
    db = await createTestDatabase();
    app = buildTestApp(db);
  });
  afterAll(async () => db?.close());

  it("shows presence by default and hides it once the shop switches it off", async () => {
    const owner = await seedUser(db, { role: "vendor" });
    const shop = await seedVendor(db, owner.id);
    await db.query(`insert into public.user_presence (user_id, last_seen_at) values ($1, now() - interval '2 hours')`, [owner.id]);
    const ask = async () => ((await (await call(app, "POST", "/api/v1/rpc/get_shop_presence", { body: { p_vendor_id: shop.id } })).json()) as { data: { online: boolean; last_seen_at: string | null } }).data;
    expect((await ask()).last_seen_at).not.toBeNull();
    await db.query(`update public.vendors set show_online_status = false where id = $1`, [shop.id]);
    expect(await ask()).toEqual({ online: false, last_seen_at: null });
    // the owner can switch it back through the app's normal shop update
    const token = await accessToken(owner.id);
    const res = await call(app, "PATCH", "/api/v1/shops/mine", { token, body: { show_online_status: true } });
    expect(res.status).toBeLessThan(300);
    expect((await ask()).last_seen_at).not.toBeNull();
  });
});
