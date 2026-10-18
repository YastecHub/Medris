import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../support/test-db.js";
import { accessToken, buildTestApp, call, seedProduct, seedUser, seedVendor } from "../support/fixtures.js";
import { legacyDefinitions } from "../../src/routes/legacy.js";
import { v1Definitions } from "../../src/routes/v1.js";

/* eslint-disable @typescript-eslint/no-explicit-any -- walking a generated OpenAPI document */

describe("OpenAPI document, Swagger UI and request bodies", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof buildTestApp>;
  let doc: any;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = buildTestApp(db);
    const res = await app.fetch(new Request("https://app.test/api/v1/openapi.json"));
    expect(res.status).toBe(200);
    doc = await res.json();
  });
  afterAll(async () => db?.close());

  it("documents every /api/v1 route the app serves, with the security schemes", () => {
    expect(doc.openapi).toBe("3.1.0");
    const documented = new Set<string>();
    for (const [path, ops] of Object.entries<any>(doc.paths)) for (const method of Object.keys(ops)) documented.add(`${method.toUpperCase()} ${path}`);

    // Every route mounted by the /api/v1 controllers (the same definitions drive routing and docs).
    const served = v1Definitions.map((d) => `${d.method.toUpperCase()} /api/v1${d.path}`);
    expect(served.length).toBeGreaterThan(20);
    for (const route of served) expect(documented, route).toContain(route);
    for (const d of legacyDefinitions) expect(documented, d.path).toContain(`${d.method.toUpperCase()} /api${d.path}`);
    // No middleware leaks into the document.
    expect(JSON.stringify(doc)).not.toContain("middleware");

    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual(["bearerAuth", "cronSecret", "paystackSignature", "sessionCookie", "webhookSecret"]);
    expect(doc.components.schemas.ErrorResponse).toBeDefined();
    expect(doc.paths["/api/v1/cart"].get.security).toEqual([{ bearerAuth: [] }, { sessionCookie: [] }]);
  });

  it("documents the original endpoints at their real paths", () => {
    for (const path of [
      "/api/notify",
      "/api/chat",
      "/api/delete-account",
      "/api/auth-otp",
      "/api/daily-cron",
      "/api/initiate-payment",
      "/api/verify-payment",
      "/api/paystack-webhook",
      "/api/order-payout-action",
      "/api/order-reminders",
      "/api/order-notify",
      "/api/vendor-payments",
      "/api/listing-payments",
      "/api/turn",
      "/api/notif-icon",
    ]) {
      expect(doc.paths[path], path).toBeDefined();
    }
    expect(doc.paths["/api/paystack-webhook"].post.security).toEqual([{ paystackSignature: [] }]);
  });

  it("serves Swagger UI (from swagger-ui-dist, no CDN) pointing at the document", async () => {
    const bare = await app.fetch(new Request("https://app.test/api/v1/docs"));
    expect(bare.status).toBe(301);
    expect(bare.headers.get("location")).toBe("/api/v1/docs/");
    const page = await app.fetch(new Request("https://app.test/api/v1/docs/"));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("swagger-ui-bundle.js");
    const init = await (await app.fetch(new Request("https://app.test/api/v1/docs/swagger-ui-init.js"))).text();
    expect(init).toContain("/api/v1/openapi.json");
    const bundle = await app.fetch(new Request("https://app.test/api/v1/docs/swagger-ui-bundle.js"));
    expect(bundle.status).toBe(200);
  });

  it("redirects the usual guesses (/docs, /api-docs, /swagger, /api/docs) to Swagger UI", async () => {
    for (const path of ["/docs", "/api-docs", "/swagger", "/api/docs"]) {
      const res = await app.fetch(new Request(`https://app.test${path}`));
      expect(res.status, path).toBe(302);
      expect(res.headers.get("location"), path).toBe("/api/v1/docs/");
    }
  });

  it("is off in production unless API_DOCS_ENABLED says otherwise", async () => {
    const prod = buildTestApp(db, { env: { NODE_ENV: "production" } });
    expect((await prod.fetch(new Request("https://app.test/api/v1/openapi.json"))).status).toBe(404);
    expect((await prod.fetch(new Request("https://app.test/api/v1/docs"))).status).toBe(404);
    const opted = buildTestApp(db, { env: { NODE_ENV: "production", API_DOCS_ENABLED: "true" } });
    expect((await opted.fetch(new Request("https://app.test/api/v1/openapi.json"))).status).toBe(200);
    const off = buildTestApp(db, { env: { API_DOCS_ENABLED: "false" } });
    expect((await off.fetch(new Request("https://app.test/api/v1/docs"))).status).toBe(404);
  });

  it("the bare root opens Swagger when the docs are on; share links and docs-off hosts keep the link preview", async () => {
    const opted = buildTestApp(db, { env: { NODE_ENV: "production", API_DOCS_ENABLED: "true" } });
    const root = await opted.fetch(new Request("https://api.test/"));
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/api/v1/docs/");
    const share = await opted.fetch(new Request("https://api.test/?product=00000000-0000-0000-0000-000000000000"));
    expect(share.status).not.toBe(302);
    const prod = buildTestApp(db, { env: { NODE_ENV: "production" } });
    expect((await prod.fetch(new Request("https://api.test/"))).status).not.toBe(302);
  });

  describe("request bodies", () => {
    let token: string;
    let product: string;
    beforeAll(async () => {
      token = await accessToken((await seedUser(db)).id);
      const vendor = await seedVendor(db, (await seedUser(db, { role: "vendor" })).id);
      product = await seedProduct(db, vendor.id);
    });

    const post = (body: string, headers: Record<string, string>) =>
      app.fetch(new Request("https://app.test/api/v1/cart/items", { method: "POST", headers: { Authorization: `Bearer ${token}`, ...headers }, body }));

    it("refuses a JSON body sent without Content-Type: application/json", async () => {
      const res = await post(JSON.stringify({ productId: product }), { "Content-Type": "text/plain" });
      expect(res.status).toBe(415);
      expect(await res.json()).toMatchObject({ error: { code: "unsupported_media_type" } });
    });

    it("reports missing fields by name for an empty body", async () => {
      const res = await post("", { "Content-Type": "application/json" });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "validation_failed", details: [{ path: "productId" }] } });
    });

    it("refuses malformed JSON and oversized bodies", async () => {
      const bad = await post("{oops", { "Content-Type": "application/json" });
      expect(await bad.json()).toMatchObject({ error: { code: "bad_request", message: "The request body is not valid JSON." } });
      const big = await post(JSON.stringify({ productId: product, pad: "x".repeat(70_000) }), { "Content-Type": "application/json" });
      expect(big.status).toBe(400);
      expect(await big.json()).toMatchObject({ error: { message: "The request body is too large." } });
    });

    it("accepts a JSON media type with a charset", async () => {
      const res = await post(JSON.stringify({ productId: product }), { "Content-Type": "application/json; charset=utf-8" });
      expect(res.status).toBe(201);
    });

    it("validates path and query parameters with the same error shape", async () => {
      const path = await call(app, "PATCH", "/api/v1/cart/items/not-an-id", { token, body: { quantity: 1 } });
      expect(await path.json()).toMatchObject({ error: { code: "validation_failed", details: [{ path: "id", message: "Must be a valid id." }] } });
      const query = await call(app, "GET", "/api/v1/notifications?limit=0", { token });
      expect(query.status).toBe(400);
      expect(await query.json()).toMatchObject({ error: { code: "validation_failed", details: [{ path: "limit" }] } });
    });
  });
});
