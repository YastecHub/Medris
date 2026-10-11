import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CartService } from "../../src/modules/cart/cart.service.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";
import { accessToken, buildTestApp, call, seedUser } from "../support/fixtures.js";

/** Behaviour that depends on the HTTP framework (Express), checked explicitly. */
describe("Express HTTP layer", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof buildTestApp>;
  let token: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = buildTestApp(db);
    token = await accessToken((await seedUser(db)).id);
  });
  afterAll(async () => db?.close());

  it("sends no framework fingerprint and no automatic ETag", async () => {
    const res = await call(app, "GET", "/api/v1/cart/count", { token });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-powered-by")).toBeNull();
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reuses a sane incoming X-Request-Id and puts it in error bodies", async () => {
    const res = await call(app, "GET", "/api/v1/nope", { headers: { "x-request-id": "trace-12345678" } });
    expect(res.status).toBe(404);
    expect(res.headers.get("x-request-id")).toBe("trace-12345678");
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Not found." }, requestId: "trace-12345678" });
  });

  it("answers 504 request_timeout when a handler runs past REQUEST_TIMEOUT_MS", async () => {
    const slowCart = { count: () => new Promise((resolve) => setTimeout(() => resolve({ count: 0 }), 1_500)) } as unknown as CartService;
    const slow = buildTestApp(db, { env: { REQUEST_TIMEOUT_MS: "1000" }, services: { cart: slowCart } });
    const res = await call(slow, "GET", "/api/v1/cart/count", { token });
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ error: { code: "request_timeout" } });
  });

  it("turns an unexpected error into a 500 without internals, for /api/v1 and the original endpoints", async () => {
    const broken = { count: async () => Promise.reject(new Error("secret internals")) } as unknown as CartService;
    const res = await call(buildTestApp(db, { services: { cart: broken } }), "GET", "/api/v1/cart/count", { token });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({ code: "internal_error", message: "Something went wrong. Please try again." });
  });

  it("keeps the original endpoints' plain error shape", async () => {
    const res = await app.fetch(new Request("https://app.test/api/chat", { method: "GET" }));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "Method not allowed" });
  });
});
