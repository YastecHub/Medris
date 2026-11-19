import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";
import { accessToken, buildTestApp, seedProduct, seedUser, seedVendor } from "../support/fixtures.js";
import { jsonRequest, setTestEnv, stubFetch } from "../helpers.js";

/**
 * What only the old Vercel functions did, now answered by the backend (the site no longer runs those functions):
 * switching between a person's businesses, share-link details for the site's share function, the profile-picture
 * proxy, the wallet checks before deleting an account, and Cloudinary image uploads.
 */

let db: TestDatabase;
let app: ReturnType<typeof buildTestApp>;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => db?.close());
beforeEach(() => {
  setTestEnv();
  app = buildTestApp(db);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function linked() {
  const owner = await seedUser(db, { email: `own-${Date.now()}@levro.test` });
  const biz = await seedUser(db);
  await db.query(`insert into public.business_links (business_user_id, owner_id, label) values ($1, $2, 'Second shop')`, [biz.id, owner.id]);
  return { owner, biz };
}

describe("businesses (one login, several shops)", () => {
  it("lists the owner's businesses with their shop and unread count, and the owner for a business account", async () => {
    const { owner, biz } = await linked();
    const shop = await seedVendor(db, biz.id, { name: "Biz Shop" });
    await db.query(`insert into public.notifications (user_id, type, title, read) values ($1, 'system', 'hi', false), ($1, 'system', 'hi', false)`, [biz.id]);
    const res = await app.fetch(jsonRequest("/api/delete-account", { action: "list-businesses", accessToken: await accessToken(owner.id) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ isBusiness: false, max: 5, businesses: [{ userId: biz.id, name: "Biz Shop", status: "verified", paused: false, unread: 2 }] });

    const asBiz = (await (await app.fetch(jsonRequest("/api/delete-account", { action: "list-businesses", accessToken: await accessToken(biz.id) }))).json()) as Record<string, unknown>;
    expect(asBiz).toMatchObject({ isBusiness: true, businesses: [{ userId: owner.id }] });
    expect(asBiz.owner).toBeDefined();
    void shop;
  });

  it("pauses only the owner's own business, from the main account", async () => {
    const { owner, biz } = await linked();
    const shop = await seedVendor(db, biz.id);
    const stranger = await seedUser(db);
    const refused = await app.fetch(jsonRequest("/api/delete-account", { action: "pause-business", targetUserId: biz.id, paused: true, accessToken: await accessToken(stranger.id) }));
    expect(refused.status).toBe(403);
    const fromBiz = await app.fetch(jsonRequest("/api/delete-account", { action: "pause-business", targetUserId: biz.id, paused: true, accessToken: await accessToken(biz.id) }));
    expect(fromBiz.status).toBe(403);
    const ok = await app.fetch(jsonRequest("/api/delete-account", { action: "pause-business", targetUserId: biz.id, paused: true, accessToken: await accessToken(owner.id) }));
    expect(await ok.json()).toEqual({ paused: true });
    expect((await db.query<{ is_active: boolean }>(`select is_active from public.vendors where id = $1`, [shop.id]))[0]!.is_active).toBe(false);
  });

  it("switches into a linked account only (a one-time sign-in link, used at once)", async () => {
    const { owner, biz } = await linked();
    const stranger = await seedUser(db);
    const { calls } = stubFetch([
      { method: "GET", match: `/auth/v1/admin/users/${biz.id}`, json: { id: biz.id, email: "biz@accounts.levromart.app" } },
      { method: "POST", match: "/auth/v1/admin/generate_link", json: { hashed_token: "h1" } },
      { method: "POST", match: "/auth/v1/verify", json: { access_token: "a1", refresh_token: "r1" } },
    ]);
    const no = await app.fetch(jsonRequest("/api/delete-account", { action: "switch-business", targetUserId: biz.id, accessToken: await accessToken(stranger.id) }));
    expect(no.status).toBe(403);
    const yes = await app.fetch(jsonRequest("/api/delete-account", { action: "switch-business", targetUserId: biz.id, accessToken: await accessToken(owner.id) }));
    expect(await yes.json()).toEqual({ session: { access_token: "a1", refresh_token: "r1" } });
    expect(JSON.parse(calls.find((c) => c.url.includes("/verify"))!.body!)).toEqual({ type: "magiclink", token_hash: "h1" });
  });
});

describe("deleting an account", () => {
  it("refuses while money is in the wallet", async () => {
    const user = await seedUser(db);
    // every account gets a wallet when it is created; put money in it
    await db.query(`update public.wallet_accounts set balance_kobo = 150000 where user_id = $1`, [user.id]);
    const res = await app.fetch(jsonRequest("/api/delete-account", { action: "delete", accessToken: await accessToken(user.id) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/₦1,500 in your Levromart wallet/);
  });
});

describe("share links and pictures", () => {
  it("gives a shared shop's or product's preview details as JSON for the site's share function", async () => {
    const owner = await seedUser(db, { role: "vendor" });
    const shop = await seedVendor(db, owner.id, { name: "Favy lux Jewel" });
    const product = await seedProduct(db, shop.id, { name: "Gold ring" });
    const s = await app.fetch(new Request(`https://api.test/api/delete-account?sharemeta=1&origin=${encodeURIComponent("https://levromart.com")}&storefront=${shop.id}`));
    expect(s.status).toBe(200);
    expect(await s.json()).toMatchObject({ title: "Favy lux Jewel | Levromart", pageUrl: `https://levromart.com/?storefront=${shop.id}`, query: `storefront=${shop.id}` });
    const p = (await (await app.fetch(new Request(`https://api.test/api/delete-account?sharemeta=1&product=${product}`))).json()) as Record<string, string>;
    expect(p).toMatchObject({ title: "Gold ring | Levromart" });
    expect(p.image).toMatch(/\/api\/delete-account\?ogprod=/);
    expect((await app.fetch(new Request(`https://api.test/api/delete-account?sharemeta=1&storefront=${crypto.randomUUID()}`))).status).toBe(404);
    // a site that is not ours is not used for the page address
    const evil = (await (await app.fetch(new Request(`https://api.test/api/delete-account?sharemeta=1&origin=https%3A%2F%2Fevil.example&storefront=${shop.id}`))).json()) as Record<string, string>;
    expect(evil.pageUrl).not.toMatch(/evil/);
  });

  it("proxies pictures from our own storage only", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("PNGDATA", { status: 200, headers: { "content-type": "image/png" } })));
    const bad = await app.fetch(new Request(`https://api.test/api/delete-account?imgproxy=${encodeURIComponent("https://evil.example/a.png")}`));
    expect(bad.status).toBe(400);
    const ok = await app.fetch(new Request(`https://api.test/api/delete-account?imgproxy=${encodeURIComponent("https://res.cloudinary.com/demo/image/upload/a.png")}`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
  });
});

describe("image uploads on Cloudinary", () => {
  it("hands out a signed Cloudinary upload when IMAGE_STORAGE=cloudinary", async () => {
    vi.stubEnv("IMAGE_STORAGE", "cloudinary");
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "demo");
    vi.stubEnv("CLOUDINARY_API_KEY", "key");
    vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
    const user = await seedUser(db);
    const res = await app.fetch(jsonRequest("/api/vendor-payments", { action: "r2-presign-upload", accessToken: await accessToken(user.id), key: `avatars/${user.id}/avatar.jpg`, contentType: "image/jpeg" }));
    expect(res.status).toBe(200);
    const out = (await res.json()) as { uploadUrl: string; method: string; fields: Record<string, string>; publicUrl: string };
    expect(out.method).toBe("POST");
    expect(out.uploadUrl).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    expect(out.fields).toMatchObject({ folder: "levromart", public_id: `avatars/${user.id}/avatar`, api_key: "key" });
    expect(out.fields.signature).toMatch(/^[0-9a-f]{40}$/);
    expect(out.publicUrl).toBe(`https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/levromart/avatars/${user.id}/avatar`);

    const video = (await (await app.fetch(jsonRequest("/api/vendor-payments", { action: "r2-presign-upload", accessToken: await accessToken(user.id), key: `product-photos/s/${user.id}.mp4`, contentType: "video/mp4" }))).json()) as Record<string, string>;
    expect(video.uploadUrl).toBe("https://api.cloudinary.com/v1_1/demo/video/upload");
  });
});

describe("migration 0074", () => {
  it("points the database's notification calls at the backend on Heroku", async () => {
    const defs = await db.query<{ def: string }>(
      `select pg_get_functiondef(p) as def from unnest(array['public.notify_email_on_notification()'::regprocedure, 'public.ring_callee_again(uuid)'::regprocedure, 'public.send_background_reminders()'::regprocedure]) p`,
    );
    expect(defs).toHaveLength(3);
    for (const { def } of defs) {
      expect(def).not.toContain("levromart.vercel.app");
      expect(def).toContain("https://levromart-5212f03a7e44.herokuapp.com/api/notify");
      expect(def).toContain("x-webhook-secret"); // the secret header is kept as it was
    }
  });
});
