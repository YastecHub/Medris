import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { jsonRequest, setTestEnv, stubFetch } from "./helpers.js";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "ada@example.com", user_metadata: { name: "Ada", phone: "08012345678" } };

describe("account actions (/api/delete-account)", () => {
  beforeEach(() => setTestEnv());
  afterEach(() => vi.unstubAllEnvs());

  it("ensure-profile never deletes an account when the profile row exists", async () => {
    const { calls } = stubFetch([
      { match: "/auth/v1/user", json: USER },
      { method: "GET", match: "/rest/v1/users?id=eq.", json: [{ id: USER.id }] },
    ]);
    const res = await createApp().fetch(jsonRequest("/api/delete-account", { action: "ensure-profile", accessToken: "tok" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, created: false });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(calls.some((c) => c.url.includes("delete_my_account"))).toBe(false);
  });

  it("ensure-profile re-creates a missing profile row as a buyer, without deleting anything", async () => {
    const { calls } = stubFetch([
      { match: "/auth/v1/user", json: { ...USER, user_metadata: { ...USER.user_metadata, role: "vendor" } } },
      { method: "GET", match: "/rest/v1/users?id=eq.", json: [] },
      { method: "POST", match: "/rest/v1/users", status: 201 },
    ]);
    const res = await createApp().fetch(jsonRequest("/api/delete-account", { action: "ensure-profile", accessToken: "tok" }));
    expect(await res.json()).toEqual({ ok: true, created: true });
    const insert = calls.find((c) => c.method === "POST" && c.url.endsWith("/rest/v1/users"));
    expect(JSON.parse(insert?.body ?? "{}")).toMatchObject({ id: USER.id, role: "buyer", name: "Ada" });
    expect(calls.some((c) => c.method === "DELETE" || c.url.includes("delete_my_account"))).toBe(false);
  });

  it("ensure-profile does not guess when the profile lookup fails", async () => {
    const { calls } = stubFetch([
      { match: "/auth/v1/user", json: USER },
      { method: "GET", match: "/rest/v1/users?id=eq.", status: 503, json: { message: "busy" } },
    ]);
    const res = await createApp().fetch(jsonRequest("/api/delete-account", { action: "ensure-profile", accessToken: "tok" }));
    expect(res.status).toBe(502);
    expect(calls.some((c) => c.method !== "GET")).toBe(false);
  });

  it("rejects an unknown action instead of deleting the account", async () => {
    const { calls } = stubFetch([]);
    const res = await createApp().fetch(jsonRequest("/api/delete-account", { action: "something-else", accessToken: "tok" }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("still deletes when the app's Delete account screen sends no action", async () => {
    const { calls } = stubFetch([
      { match: "/auth/v1/user", json: USER },
      { method: "GET", match: "/rest/v1/vendors?", json: [] },
      { method: "GET", match: "/rest/v1/conversations?", json: [] },
      { method: "POST", match: "/rest/v1/rpc/delete_my_account", json: {} },
      { method: "POST", match: "/storage/v1/object/list/", json: [] },
      { method: "DELETE", match: `/auth/v1/admin/users/${USER.id}`, json: {} },
    ]);
    const res = await createApp().fetch(jsonRequest("/api/delete-account", { accessToken: "tok" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/auth/v1/admin/users/"))).toBe(true);
  });

  it("blocks vendor account deletion while orders are active", async () => {
    stubFetch([
      { match: "/auth/v1/user", json: USER },
      { method: "GET", match: "/rest/v1/vendors?", json: [{ id: "v1" }] },
      { method: "GET", match: "/rest/v1/orders?", json: [{ id: "o1", status: "pending" }] },
    ]);
    const res = await createApp().fetch(jsonRequest("/api/delete-account", { accessToken: "tok" }));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: expect.stringContaining("1 order(s) are still active") });
  });

  it("validates registration input with the original messages", async () => {
    stubFetch([]);
    const app = createApp();
    const missingName = await app.fetch(jsonRequest("/api/register", { action: "register", phone: "08012345678", password: "longenough", role: "buyer" }));
    expect(missingName.status).toBe(400);
    expect(await missingName.json()).toEqual({ error: "Full name is required." });
    const shortPassword = await app.fetch(jsonRequest("/api/register", { action: "register", name: "Ada", phone: "08012345678", password: "short", role: "buyer" }));
    expect(await shortPassword.json()).toEqual({ error: "Password must be at least 8 characters." });
  });

  it("serves TURN servers on GET /api/turn and GET /api/delete-account?turn=1", async () => {
    stubFetch([]);
    const app = createApp();
    for (const path of ["/api/turn", "/api/delete-account?turn=1"]) {
      const res = await app.fetch(new Request(`https://app.test${path}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, max-age=600");
      const body = (await res.json()) as { iceServers: unknown[]; source: string };
      expect(body.iceServers.length).toBeGreaterThan(0);
      expect(body.source).toBe("open-relay (shared, unreliable)");
    }
  });

  it("answers other methods with 405", async () => {
    stubFetch([]);
    const res = await createApp().fetch(new Request("https://app.test/api/delete-account", { method: "PUT" }));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "Method not allowed." });
  });
});
