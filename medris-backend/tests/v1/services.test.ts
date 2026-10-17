import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Identity } from "../../src/database/context.js";
import { AuthService } from "../../src/modules/auth/auth.service.js";
import { createSessionService } from "../../src/modules/auth/session.service.js";
import { CartService } from "../../src/modules/cart/cart.service.js";
import { FavoritesService } from "../../src/modules/favorites/favorites.service.js";
import { NotificationsService } from "../../src/modules/notifications/notifications.service.js";
import { UsersService } from "../../src/modules/users/users.service.js";
import { RateLimiter } from "../../src/lib/rate-limit.js";
import { silentLogger } from "../../src/lib/logger.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { createTestDatabase, truncate, type TestDatabase } from "../support/test-db.js";
import { seedNotification, seedProduct, seedUser, seedVendor, testConfig } from "../support/fixtures.js";

/**
 * Services are plain classes over a DataContext, so their rules can be tested
 * without HTTP: construct one with the test database and call it.
 */
const identity = (userId: string): Identity => ({ userId, email: null, claims: { sub: userId, role: "authenticated", aud: "authenticated" }, source: "supabase-jwt" });

describe("services (no HTTP)", () => {
  let db: TestDatabase;
  const data = () => db.data;

  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => db?.close());
  beforeEach(async () => truncate(db, ["cart_items", "notifications", "favorites"]));

  it("CartService adds, counts and refuses to change an item that is not yours", async () => {
    const buyer = identity((await seedUser(db)).id);
    const vendor = await seedVendor(db, (await seedUser(db, { role: "vendor" })).id);
    const product = await seedProduct(db, vendor.id);
    const cart = new CartService(data);

    await cart.add(buyer, { productId: product, quantity: 2 });
    expect(await cart.count(buyer)).toEqual({ count: 1 });
    const [item] = await cart.list(buyer);
    expect(item?.quantity).toBe(2);

    const stranger = identity((await seedUser(db)).id);
    await expect(cart.setQuantity(stranger, item!.id, 5)).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(await cart.setQuantity(buyer, item!.id, 5)).toEqual({ id: item!.id, quantity: 5 });
  });

  it("FavoritesService saving is idempotent", async () => {
    const me = identity((await seedUser(db)).id);
    const vendor = await seedVendor(db, (await seedUser(db, { role: "vendor" })).id);
    const product = await seedProduct(db, vendor.id);
    const favorites = new FavoritesService(data);
    expect(await favorites.save(me, "product", product)).toEqual({ saved: true, created: true });
    expect(await favorites.save(me, "product", product)).toEqual({ saved: true, created: false });
    expect((await favorites.list(me)).productIds).toEqual([product]);
    expect(await favorites.unsave(me, "product", product)).toEqual({ saved: false, removed: 1 });
  });

  it("NotificationsService shows read notifications from the last 30 days by default", async () => {
    const user = await seedUser(db);
    const now = Date.parse("2026-10-01T12:00:00Z");
    await seedNotification(db, user.id, { read: true, createdAt: "2026-09-20T00:00:00Z" });
    await seedNotification(db, user.id, { read: true, createdAt: "2026-08-01T00:00:00Z" });
    await seedNotification(db, user.id, { read: false, createdAt: "2026-01-01T00:00:00Z" });
    const service = new NotificationsService(data, () => now);
    expect(await service.panel(identity(user.id), { limit: 50 })).toHaveLength(2);
    expect(await service.markRead(identity(user.id), { all: true })).toEqual({ updated: 1 });
  });

  it("UsersService.me throws not_found without a profile", async () => {
    await expect(new UsersService(data).me(identity("00000000-0000-4000-8000-000000000999"))).rejects.toBeInstanceOf(AppError);
  });

  it("AuthService rejects a Google return whose state does not match", async () => {
    const config = testConfig({ AUTH_BACKEND_SESSIONS: "true" });
    const google = { start: () => ({ url: "https://accounts.google.com/x", state: "s1", codeVerifier: "v1" }), finish: async () => ({ sub: "1", email: null, emailVerified: false, name: null, picture: null }) };
    const auth = new AuthService({ config, data, sessions: createSessionService(config, data), google, rateLimiter: new RateLimiter() });
    const started = auth.googleStart("//evil.example");
    expect(JSON.parse(started.flowCookie)).toMatchObject({ s: "s1", r: "/" });
    await expect(auth.googleFinish({ code: "c", state: "other" }, started.flowCookie, { logger: silentLogger })).rejects.toMatchObject({ status: 400 });
  });
});
