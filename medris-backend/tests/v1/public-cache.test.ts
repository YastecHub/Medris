import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";
import { accessToken, buildTestApp, call, seedUser, seedVendor } from "../support/fixtures.js";

/**
 * Public answers kept in memory for a few seconds (lib/response-cache.ts): signed-out table reads through the data
 * API proxy, and the database functions whose answer never depends on who asks. Anything signed in, any write and any
 * failure goes to the database every time.
 */
describe("public answers cache", () => {
  let db: TestDatabase;
  let upstream: Server;
  let hits: { method?: string; url?: string; auth?: string }[];
  let status = 200;
  beforeAll(async () => {
    db = await createTestDatabase();
    upstream = createServer((req, res) => {
      hits.push({ method: req.method, url: req.url, auth: req.headers.authorization });
      res.writeHead(status, { "Content-Type": "application/json", "Content-Range": "0-0/1" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify([{ n: hits.length }]));
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  });
  beforeEach(() => {
    hits = [];
    status = 200;
  });
  afterAll(async () => {
    upstream?.close();
    await db?.close();
  });

  const app = (cache: boolean) =>
    buildTestApp(db, {
      env: { RESPONSE_CACHE_ENABLED: String(cache) },
      services: { dataApi: { port: (upstream.address() as AddressInfo).port, ready: async () => true } },
    });

  it("a signed-out table read is answered from memory the second time", async () => {
    const a = app(true);
    const first = await call(a, "GET", "/rest/v1/products?select=id", { headers: { Authorization: "Bearer sb_publishable_x" } });
    const second = await call(a, "GET", "/rest/v1/products?select=id", { headers: { Authorization: "Bearer sb_publishable_x" } });
    expect(await first.json()).toEqual([{ n: 1 }]);
    expect(await second.json()).toEqual([{ n: 1 }]);
    expect(second.headers.get("x-levro-cache")).toBe("hit");
    expect(second.headers.get("content-range")).toBe("0-0/1");
    expect(hits).toHaveLength(1);
  });

  it("different queries, Range or Prefer headers are kept apart", async () => {
    const a = app(true);
    await call(a, "GET", "/rest/v1/products?select=id");
    await call(a, "GET", "/rest/v1/products?select=name");
    await call(a, "GET", "/rest/v1/products?select=id", { headers: { Range: "0-9" } });
    await call(a, "GET", "/rest/v1/products?select=id", { headers: { Prefer: "count=exact" } });
    expect(hits).toHaveLength(4);
  });

  it("never caches a signed-in read, a write or a failed answer", async () => {
    const a = app(true);
    const jwt = "Bearer eyJhbGciOiJFUzI1NiJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.c2ln";
    await call(a, "GET", "/rest/v1/cart_items?select=id", { headers: { Authorization: jwt } });
    await call(a, "GET", "/rest/v1/cart_items?select=id", { headers: { Authorization: jwt } });
    await call(a, "POST", "/rest/v1/favorites", { body: {} });
    await call(a, "POST", "/rest/v1/favorites", { body: {} });
    status = 500;
    await call(a, "GET", "/rest/v1/vendors?select=id");
    await call(a, "GET", "/rest/v1/vendors?select=id");
    expect(hits).toHaveLength(6);
  });

  it("RESPONSE_CACHE_ENABLED=false turns it off", async () => {
    const a = app(false);
    await call(a, "GET", "/rest/v1/products?select=id");
    await call(a, "GET", "/rest/v1/products?select=id");
    expect(hits).toHaveLength(2);
  });

  it("database functions: shared answers for everyone where the answer never depends on the caller", async () => {
    const owner = await seedUser(db, { role: "vendor" });
    const vendor = await seedVendor(db, owner.id);
    const a = app(true);
    const body = { p_vendor_ids: [vendor.id] };
    const first = await call(a, "POST", "/api/v1/rpc/get_vendor_follower_counts", { body });
    expect(first.headers.get("x-levro-cache")).toBe("miss");
    // Someone follows: a signed-in caller within 30 seconds still gets the shared answer, by design.
    const buyer = await seedUser(db);
    await db.query(`insert into public.vendor_follows (vendor_id, follower_id) values ($1, $2)`, [vendor.id, buyer.id]);
    const second = await call(a, "POST", "/api/v1/rpc/get_vendor_follower_counts", { body, token: await accessToken(buyer.id) });
    expect(second.headers.get("x-levro-cache")).toBe("hit");
    expect(await second.json()).toEqual(await first.json());
  });

  it("caller-dependent functions are shared only between signed-out visitors", async () => {
    const a = app(true);
    const anon1 = await call(a, "POST", "/api/v1/rpc/get_vendor_spotlight", { body: {} });
    const anon2 = await call(a, "POST", "/api/v1/rpc/get_vendor_spotlight", { body: {} });
    expect(anon1.headers.get("x-levro-cache")).toBe("miss");
    expect(anon2.headers.get("x-levro-cache")).toBe("hit");
    const me = await seedUser(db);
    const signedIn = await call(a, "POST", "/api/v1/rpc/get_vendor_spotlight", { body: {}, token: await accessToken(me.id) });
    expect(signedIn.headers.get("x-levro-cache")).toBeNull();
  });

  it("writes through the functions are never cached", async () => {
    const a = app(true);
    const me = await seedUser(db);
    const token = await accessToken(me.id);
    const r1 = await call(a, "POST", "/api/v1/rpc/touch_last_seen", { body: {}, token });
    expect(r1.headers.get("x-levro-cache")).toBeNull();
  });
});
