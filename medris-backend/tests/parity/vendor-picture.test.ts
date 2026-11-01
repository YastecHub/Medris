import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedUser, seedVendor } from "../support/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";

/** Migration 0030: one picture for a vendor everywhere. */
describe("vendor picture follows the profile photo (migration 0030)", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  }, 60_000);
  afterAll(async () => db?.close());

  const logo = async (vendorId: string) => (await db.query<{ logo_url: string | null }>(`select logo_url from public.vendors where id = $1`, [vendorId]))[0]!.logo_url;
  const setAvatar = (userId: string, url: string | null) => db.query(`update public.users set avatar_url = $2 where id = $1`, [userId, url]);

  it("a new profile photo becomes the shop picture; removing the business logo falls back to the photo", async () => {
    const owner = await seedUser(db, { role: "vendor" });
    const shop = await seedVendor(db, owner.id);
    await setAvatar(owner.id, "https://img.test/avatars/me/avatar.jpg?t=1");
    expect(await logo(shop.id)).toBe("https://img.test/avatars/me/avatar.jpg?t=1");

    // the vendor uploads a separate business logo, then removes it
    await db.query(`update public.vendors set logo_url = 'https://img.test/vendor-logos/x/logo.png' where id = $1`, [shop.id]);
    expect(await logo(shop.id)).toBe("https://img.test/vendor-logos/x/logo.png");
    await db.query(`update public.vendors set logo_url = null where id = $1`, [shop.id]);
    expect(await logo(shop.id)).toBe("https://img.test/avatars/me/avatar.jpg?t=1");
  });

  it("removing the profile photo leaves no picture anywhere (the default avatar shows)", async () => {
    const owner = await seedUser(db, { role: "vendor" });
    const shop = await seedVendor(db, owner.id);
    await setAvatar(owner.id, "https://img.test/avatars/r/avatar.jpg");
    await setAvatar(owner.id, null);
    expect(await logo(shop.id)).toBeNull();
  });

  it("notifications show the sender's current photo, and none once it is removed", async () => {
    const vendorUser = await seedUser(db, { role: "vendor" });
    const buyer = await seedUser(db);
    await setAvatar(vendorUser.id, "https://img.test/avatars/v/avatar.jpg?t=1");
    await db.query(
      `insert into public.notifications (user_id, type, title, body, actor_id, actor_name, actor_avatar_url) values ($1, 'delivery_started', 'On the way', 'Your driver has started the delivery', $2, 'Shop', 'https://img.test/avatars/v/avatar.jpg?t=1')`,
      [buyer.id, vendorUser.id],
    );
    const photo = async () => (await db.query<{ a: string | null }>(`select actor_avatar_url as a from public.notifications where user_id = $1`, [buyer.id]))[0]!.a;
    await setAvatar(vendorUser.id, "https://img.test/avatars/v/avatar.jpg?t=2");
    expect(await photo()).toBe("https://img.test/avatars/v/avatar.jpg?t=2");
    await setAvatar(vendorUser.id, null);
    expect(await photo()).toBeNull();
  });
});
