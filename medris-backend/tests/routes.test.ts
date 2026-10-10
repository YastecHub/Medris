import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { TEST_ENV, jsonRequest, setTestEnv, stubFetch } from "./helpers.js";

describe("routing and guards", () => {
  beforeEach(() => setTestEnv());
  afterEach(() => vi.unstubAllEnvs());

  it("returns JSON 404 for unknown API paths", async () => {
    const res = await createApp().fetch(new Request("https://app.test/api/does-not-exist"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it.each(["/api/chat", "/api/notify", "/api/auth-otp", "/api/initiate-payment", "/api/order-payout-action"])("%s only accepts POST", async (path) => {
    const res = await createApp().fetch(new Request(`https://app.test${path}`));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "Method not allowed" });
  });

  it("daily cron requires the shared secret", async () => {
    stubFetch([]);
    const app = createApp();
    expect((await app.fetch(new Request("https://app.test/api/daily-cron"))).status).toBe(401);
    expect((await app.fetch(new Request("https://app.test/api/daily-cron", { method: "PUT" }))).status).toBe(405);
  });

  it("daily cron runs the billing jobs with Vercel's bearer secret", async () => {
    const { calls } = stubFetch([
      { method: "POST", match: "rpc/process_listing_billing_reminders", json: { reminded: 2 } },
      { method: "POST", match: "rpc/process_commission_deadline_reminders", json: { sent: 1 } },
      { method: "DELETE", match: "/rest/v1/notifications?", status: 204 },
    ]);
    const res = await createApp().fetch(new Request("https://app.test/api/daily-cron", { headers: { Authorization: `Bearer ${TEST_ENV.CRON_SECRET}` } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, notificationsTrimmed: true, reminded: 2, commissionReminders: { sent: 1 } });
    expect(calls).toHaveLength(3);
  });

  it("order reminders accept only the exact bearer secret", async () => {
    stubFetch([{ match: "/rest/v1/orders?", json: [] }]);
    const app = createApp();
    expect((await app.fetch(new Request("https://app.test/api/order-reminders", { method: "POST", headers: { "x-cron-secret": TEST_ENV.CRON_SECRET } }))).status).toBe(401);
    const ok = await app.fetch(new Request("https://app.test/api/order-reminders", { method: "POST", headers: { Authorization: `Bearer ${TEST_ENV.CRON_SECRET}` } }));
    expect(await ok.json()).toEqual({ checked: 0, reminded: 0 });
  });

  it("notify rejects database calls without the webhook secret", async () => {
    stubFetch([]);
    const res = await createApp().fetch(jsonRequest("/api/notify", { notificationId: "n1" }));
    expect(res.status).toBe(401);
  });

  it("decline-call validates the call id before touching the database", async () => {
    const { calls } = stubFetch([]);
    const res = await createApp().fetch(jsonRequest("/api/notify", { action: "decline-call", callId: "nope", token: "x" }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("decline-call only works with the token minted for that call and callee", async () => {
    const callId = "22222222-2222-2222-2222-222222222222";
    const calleeId = "33333333-3333-3333-3333-333333333333";
    const token = crypto.createHmac("sha256", TEST_ENV.SUPABASE_SERVICE_ROLE_KEY).update(`call:${callId}:${calleeId}`).digest("hex");
    const { calls } = stubFetch([
      { method: "GET", match: "/rest/v1/voice_calls?", json: [{ id: callId, callee_id: calleeId, status: "ringing" }] },
      { method: "PATCH", match: "/rest/v1/voice_calls?", status: 204 },
    ]);
    const app = createApp();
    expect((await app.fetch(jsonRequest("/api/notify", { action: "decline-call", callId, token: "wrong" }))).status).toBe(401);
    const ok = await app.fetch(jsonRequest("/api/notify", { action: "decline-call", callId, token }));
    expect(await ok.json()).toEqual({ ok: true });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("vendor-payments rejects unknown and prototype-named actions", async () => {
    stubFetch([]);
    const app = createApp();
    for (const action of ["list-banks", "toString", "constructor"]) {
      const res = await app.fetch(jsonRequest("/api/vendor-payments", { action }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Unknown payment action" });
    }
    const alias = await app.fetch(jsonRequest("/api/listing-payments", { action: "nope" }));
    expect(alias.status).toBe(400);
    const noRef = await app.fetch(new Request("https://app.test/api/vendor-payments"));
    expect(await noRef.json()).toEqual({ error: "payment reference is required" });
  });

  it("r2 presign refuses folders outside the public image folders", async () => {
    stubFetch([]);
    const res = await createApp().fetch(jsonRequest("/api/vendor-payments", { action: "r2-presign-upload", accessToken: "t", key: "vendor-docs/x.pdf", contentType: "application/pdf" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown upload folder." });
  });
});

describe("Paystack webhook", () => {
  beforeEach(() => setTestEnv());
  afterEach(() => vi.unstubAllEnvs());

  const sign = (body: string) => crypto.createHmac("sha512", TEST_ENV.PAYSTACK_SECRET_KEY).update(body).digest("hex");

  it("rejects an invalid signature", async () => {
    const { calls } = stubFetch([]);
    const res = await createApp().fetch(new Request("https://app.test/api/paystack-webhook", { method: "POST", body: "{}", headers: { "x-paystack-signature": "bad" } }));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("marks an order payment paid on charge.success", async () => {
    const { calls } = stubFetch([{ method: "PATCH", match: "/rest/v1/payments?provider_reference=eq.medris_abc", status: 204 }]);
    const body = JSON.stringify({ event: "charge.success", data: { reference: "medris_abc", status: "success", amount: 5000 } });
    const res = await createApp().fetch(new Request("https://app.test/api/paystack-webhook", { method: "POST", body, headers: { "x-paystack-signature": sign(body) } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({ status: "paid" });
  });

  it("activates a ₦999 monthly listing named in the metadata", async () => {
    const { calls } = stubFetch([
      {
        method: "GET",
        match: "/rest/v1/products?id=eq.p1",
        json: [{ id: "p1", status: "paused", billing_model: "monthly", billing_status: "pending_payment", billing_reference: "levro_listing_1", billing_paid_until: null }],
      },
      { method: "PATCH", match: "/rest/v1/products?", status: 204 },
      { method: "PATCH", match: "/rest/v1/listing_payment_intents?", status: 204 },
    ]);
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: "levro_listing_1", status: "success", amount: 99900, metadata: { purpose: "levromart_listing_monthly", kind: "product", listing_id: "p1", vendor_id: "v1" } },
    });
    const res = await createApp().fetch(new Request("https://app.test/api/paystack-webhook", { method: "POST", body, headers: { "x-paystack-signature": sign(body) } }));
    expect(res.status).toBe(200);
    const update = calls.find((c) => c.method === "PATCH" && c.url.includes("/rest/v1/products?"));
    expect(JSON.parse(update?.body ?? "{}")).toMatchObject({ status: "active", billing_status: "active", billing_reference: null });
  });
});
