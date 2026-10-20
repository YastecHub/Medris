import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PostgrestClient } from "@supabase/postgrest-js";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgrestProcess } from "../../src/integrations/data-api/postgrest.js";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";
import { buildTestApp, call, seedProduct, seedUser, seedVendor } from "../support/fixtures.js";

/**
 * The data API: /rest/v1 on the backend is PostgREST (the server Supabase runs) behind a streaming proxy.
 * The proxy is tested against a stand-in upstream; the real thing (the app's own client, supabase's postgrest-js,
 * against PostgREST on the test database, signed in with an ES256 token like Supabase Auth's) runs when
 * TEST_DATABASE_URL is set and the binary is installed (node scripts/install-postgrest.mjs).
 */

describe("data API proxy", () => {
  let db: TestDatabase;
  let upstream: Server;
  let seen: { method?: string; url?: string; headers: Record<string, unknown>; body: string }[];
  beforeAll(async () => {
    db = await createTestDatabase();
    seen = [];
    upstream = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(206, { "Content-Type": "application/json", "Content-Range": "0-0/7" });
        res.end('[{"id":1}]');
      });
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  });
  afterAll(async () => {
    upstream?.close();
    await db?.close();
  });

  const app = (port: number | null) =>
    buildTestApp(db, { services: { dataApi: port === null ? null : { port, ready: async () => true } } });

  it("passes the request through and the answer back (status, Content-Range, body)", async () => {
    const port = (upstream.address() as AddressInfo).port;
    const jwt = "eyJhbGciOiJFUzI1NiJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.c2ln";
    const res = await call(app(port), "POST", "/rest/v1/cart_items?select=id", {
      body: { product_id: "p" },
      headers: { Authorization: `Bearer ${jwt}`, Prefer: "return=representation", apikey: "sb_publishable_x", Cookie: "medris_session=secret" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("0-0/7");
    expect(await res.json()).toEqual([{ id: 1 }]);
    const got = seen.at(-1)!;
    expect(got).toMatchObject({ method: "POST", url: "/cart_items?select=id", body: '{"product_id":"p"}' });
    expect(got.headers).toMatchObject({ authorization: `Bearer ${jwt}`, prefer: "return=representation" });
    expect(got.headers.cookie).toBeUndefined();
  });

  it("drops an Authorization that is not a user's token (the publishable key): the request runs as anon", async () => {
    const port = (upstream.address() as AddressInfo).port;
    await call(app(port), "GET", "/rest/v1/products?select=id", { headers: { Authorization: "Bearer sb_publishable_x" } });
    expect(seen.at(-1)!.headers.authorization).toBeUndefined();
  });

  it("answers 503 when the data API is not running, and GET /api/v1/data-api says whether it is ready", async () => {
    expect((await call(app(null), "GET", "/rest/v1/products")).status).toBe(503);
    expect(await (await call(app(null), "GET", "/api/v1/data-api")).json()).toEqual({ ready: false, url: "/rest/v1" });
    const port = (upstream.address() as AddressInfo).port;
    expect(await (await call(app(port), "GET", "/api/v1/data-api")).json()).toEqual({ ready: true, url: "/rest/v1" });
  });
});

const canRunPostgrest = Boolean(process.env.TEST_DATABASE_URL) && PostgrestProcess.available("bin/postgrest");

describe.skipIf(!canRunPostgrest)("data API: real PostgREST on the test database", () => {
  let db: TestDatabase;
  let pgrst: PostgrestProcess;
  let sign: (claims: Record<string, unknown>) => Promise<string>;
  let base: string;
  let server: Server;

  beforeAll(async () => {
    db = await createTestDatabase();
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "ES256", use: "sig" };
    sign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: "test" }).setExpirationTime("1h").sign(privateKey);
    pgrst = new PostgrestProcess({ bin: "bin/postgrest", databaseUrl: db.url!, sslMode: "disable", port: 3931, adminPort: 3932, loadJwks: async () => ({ keys: [jwk] }) });
    await pgrst.start();
    for (let i = 0; i < 100 && !(await pgrst.ready()); i++) await new Promise((r) => setTimeout(r, 100));
    const app = buildTestApp(db, { services: { dataApi: pgrst } });
    server = createServer(app.app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rest/v1`;
  }, 60_000);
  afterAll(async () => {
    server?.close();
    await pgrst?.stop();
    await db?.close();
  });

  const client = (token?: string) => new PostgrestClient(base, { headers: { apikey: "sb_publishable_x", Authorization: `Bearer ${token ?? "sb_publishable_x"}` } });

  it("runs the app's queries with Supabase's roles and row-level security", async () => {
    const owner = await seedUser(db, { role: "vendor" });
    const vendor = await seedVendor(db, owner.id);
    const live = await seedProduct(db, vendor.id, { name: "Live one" });
    const paused = await seedProduct(db, vendor.id, { name: "Paused one", status: "paused" });
    const buyer = await seedUser(db);
    await db.query(`insert into public.cart_items (buyer_id, product_id, quantity) values ($1, $2, 2)`, [buyer.id, live]);

    // Signed out (the publishable key): public listings only, no carts.
    const anon = client();
    const listed = await anon.from("products").select("id, name, vendor:vendors(id)").in("id", [live, paused]);
    expect(listed.error).toBeNull();
    expect(listed.data).toEqual([{ id: live, name: "Live one", vendor: { id: vendor.id } }]);
    expect((await anon.from("cart_items").select("id")).data).toEqual([]);

    // Signed in (an ES256 token like Supabase Auth's): the buyer's own cart, counted the way the app counts.
    const me = client(await sign({ sub: buyer.id, role: "authenticated", aud: "authenticated" }));
    const count = await me.from("cart_items").select("id", { count: "exact", head: true }).eq("buyer_id", buyer.id);
    expect(count).toMatchObject({ error: null, count: 1 });
    const added = await me.from("favorites").insert({ buyer_id: buyer.id, product_id: live }).select("product_id").single();
    expect(added).toMatchObject({ error: null, data: { product_id: live } });

    // Someone else's token cannot write the buyer's rows (RLS).
    const stranger = client(await sign({ sub: (await seedUser(db)).id, role: "authenticated", aud: "authenticated" }));
    const refused = await stranger.from("favorites").insert({ buyer_id: buyer.id, product_id: paused });
    expect(refused.error?.code).toBe("42501");
  });

  it("refuses a token it cannot verify, like Supabase", async () => {
    const forged = client("eyJhbGciOiJFUzI1NiIsImtpZCI6InRlc3QifQ.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.AAAA");
    const res = await forged.from("products").select("id").limit(1);
    expect(res.status).toBe(401);
  });
});
