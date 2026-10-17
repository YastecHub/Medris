import { SignJWT } from "jose";
import { loadConfig, type AppConfig } from "../../src/config/app-config.js";
import { createApp } from "../../src/app.js";
import type { AppServices } from "../../src/container.js";
import { silentLogger } from "../../src/lib/logger.js";
import { RateLimiter } from "../../src/lib/rate-limit.js";
import { SupabaseAccessTokenVerifier } from "../../src/modules/auth/access-token.js";
import { createSessionService } from "../../src/modules/auth/session.service.js";
import { asFetch } from "./http.js";
import type { TestDatabase } from "./test-db.js";

/** Shared helpers for tests that run the API against the test database. */

export const JWT_SECRET = "test-jwt-secret-with-at-least-32-characters!";
export const SUPABASE_URL = "https://example.supabase.co";
export const ISSUER = `${SUPABASE_URL}/auth/v1`;

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    SUPABASE_URL,
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    SUPABASE_JWT_SECRET: JWT_SECRET,
    DATABASE_URL: "postgres://unused-in-tests/db",
    ...env,
  });
}

/** A Supabase-style access token, signed with the test secret. */
export async function accessToken(
  userId: string,
  options: { role?: string; expiresIn?: string; issuer?: string; secret?: string; email?: string } = {},
): Promise<string> {
  return new SignJWT({ role: options.role ?? "authenticated", email: options.email ?? `${userId.slice(0, 8)}@test.dev`, aud: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(options.issuer ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "1h")
    .sign(new TextEncoder().encode(options.secret ?? JWT_SECRET));
}

export function buildTestApp(testDb: TestDatabase, options: { env?: Record<string, string>; services?: Partial<AppServices> } = {}) {
  const config = testConfig(options.env);
  const data = () => testDb.data;
  const services: Partial<AppServices> = {
    config,
    logger: silentLogger,
    data,
    accessTokens: new SupabaseAccessTokenVerifier({ jwtSecret: JWT_SECRET, issuer: ISSUER, audience: "authenticated", supabaseUrl: SUPABASE_URL }),
    sessions: createSessionService(config, data),
    google: null,
    rateLimiter: new RateLimiter(),
    ...options.services,
  };
  return asFetch(createApp({ services }));
}

export function call(app: ReturnType<typeof buildTestApp>, method: string, path: string, init: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return app.fetch(
    new Request(`https://app.test${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }),
  );
}

let counter = 0;
export function uuid(): string {
  return crypto.randomUUID();
}

/* --------------------------------------------------------------- seeding */

export async function seedUser(db: TestDatabase, options: { role?: "buyer" | "vendor" | "admin"; email?: string; phone?: string; password?: string } = {}) {
  const id = uuid();
  const n = ++counter;
  const email = options.email ?? `user${n}-${id.slice(0, 6)}@test.dev`;
  await db.query(`insert into auth.users (id, email, encrypted_password, email_confirmed_at) values ($1, $2, $3, now())`, [id, email, options.password ?? null]);
  await db.query(`insert into public.users (id, name, email, phone, role) values ($1, $2, $3, $4, $5)`, [id, `User ${n}`, email, options.phone ?? null, options.role ?? "buyer"]);
  return { id, email };
}

export async function seedVendor(db: TestDatabase, ownerId: string, options: { verified?: boolean; active?: boolean; name?: string } = {}) {
  const sectorId = await seedSector(db);
  const id = uuid();
  await db.query(
    `insert into public.vendors (id, user_id, business_name, sector_id, verification_status, is_active, lat, lng) values ($1, $2, $3, $4, $5, $6, 6.5, 3.4)`,
    [id, ownerId, options.name ?? `Shop ${++counter}`, sectorId, options.verified === false ? "pending" : "verified", options.active ?? true],
  );
  return { id, sectorId };
}

export async function seedSector(db: TestDatabase, options: { name?: string; sortOrder?: number } = {}) {
  const id = uuid();
  const n = ++counter;
  await db.query(`insert into public.sectors (id, slug, name, sort_order) values ($1, $2, $3, $4)`, [id, `sector-${n}`, options.name ?? `Sector ${n}`, options.sortOrder ?? n]);
  return id;
}

export async function seedProduct(db: TestDatabase, vendorId: string, options: { status?: "active" | "paused" | "removed"; price?: number; name?: string } = {}) {
  const id = uuid();
  await db.query(
    `insert into public.products (id, vendor_id, name, listing_type, sale_price, status, photos, delivery_fee_mode) values ($1, $2, $3, 'sale', $4, $5, '{https://img.test/a.jpg}', 'flat')`,
    [id, vendorId, options.name ?? `Product ${++counter}`, options.price ?? 2500, options.status ?? "active"],
  );
  return id;
}

export async function seedNotification(db: TestDatabase, userId: string, options: { read?: boolean; type?: string; createdAt?: string; deleted?: boolean; archived?: boolean } = {}) {
  const id = uuid();
  await db.query(
    `insert into public.notifications (id, user_id, type, title, read, created_at, deleted_at, archived) values ($1, $2, $3, 'Hello', $4, $5, $6, $7)`,
    [id, userId, options.type ?? "system", options.read ?? false, options.createdAt ?? new Date().toISOString(), options.deleted ? new Date().toISOString() : null, options.archived ?? false],
  );
  return id;
}
