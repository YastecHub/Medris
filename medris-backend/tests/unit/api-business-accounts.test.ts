import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// "Add business": a signed-in person gets another, linked Levromart account and can switch between them without logging in again.
const require = createRequire(import.meta.url);
const handler = require("../../../api/delete-account.js");

function post(body: unknown) {
  const req = Object.assign(new EventEmitter(), { method: "POST", url: "/api/delete-account", headers: {} });
  queueMicrotask(() => { req.emit("data", Buffer.from(JSON.stringify(body))); req.emit("end"); });
  return req;
}
function response() {
  const res = { statusCode: 0, body: {} as Record<string, unknown>, status(c: number) { res.statusCode = c; return res; }, setHeader() {}, json(v: Record<string, unknown>) { res.body = v; }, end() {} };
  return res;
}

const OWNER = "11111111-1111-4111-8111-111111111111";
const BIZ = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

type Store = { links: { owner_id: string; business_user_id: string; label: string }[]; calls: string[] };
function fakeSupabase(store: Store) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = String(url); const method = init.method || "GET";
    store.calls.push(`${method} ${u.replace("https://sb.test", "")}`);
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
    if (u.endsWith("/auth/v1/user")) {
      const token = String((init.headers as Record<string, string>).Authorization || "").replace("Bearer ", "");
      return token === "tok-owner" ? json({ id: OWNER }) : token === "tok-biz" ? json({ id: BIZ }) : json({ msg: "bad" }, 401);
    }
    if (u.includes("/rest/v1/business_links") && method === "GET") {
      const mine = store.links.filter((l) => u.includes(`owner_id.eq.${l.owner_id}`) || u.includes(`business_user_id.eq.${l.business_user_id}`));
      return json(mine);
    }
    if (u.endsWith("/auth/v1/admin/users") && method === "POST") return json({ id: BIZ });
    if (u.includes("/auth/v1/admin/users/") && method === "GET") return json({ id: "x", email: "biz.x@accounts.levromart.app" });
    if (u.endsWith("/rest/v1/users") && method === "POST") return new Response(null, { status: 201 });
    if (u.endsWith("/rest/v1/business_links") && method === "POST") { const b = JSON.parse(String(init.body)); store.links.push(b); return new Response(null, { status: 201 }); }
    if (u.endsWith("/auth/v1/admin/generate_link")) return json({ hashed_token: "hash123" });
    if (u.endsWith("/auth/v1/verify")) return json({ access_token: "new-access", refresh_token: "new-refresh" });
    if (u.includes("/rest/v1/users?id=in.")) return json([{ id: BIZ, name: "Bola Bakes" }, { id: OWNER, name: "Ada" }]);
    if (u.includes("/rest/v1/vendors?user_id=in.")) return json([{ user_id: BIZ, business_name: "Bola Bakes", verification_status: "pending" }]);
    return json({}, 404);
  });
}

let store: Store;
beforeEach(() => {
  process.env.SUPABASE_URL = "https://sb.test"; process.env.SUPABASE_ANON_KEY = "anon"; process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  store = { links: [], calls: [] };
  vi.stubGlobal("fetch", fakeSupabase(store));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("api/delete-account.js: several businesses from one login", () => {
  it("creates a linked business account and returns a session for it", async () => {
    const res = response();
    await handler(post({ action: "create-business", accessToken: "tok-owner", name: "  Bola   Bakes " }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ created: true, userId: BIZ, name: "Bola Bakes", session: { access_token: "new-access", refresh_token: "new-refresh" } });
    expect(store.links).toEqual([{ business_user_id: BIZ, owner_id: OWNER, label: "Bola Bakes" }]);
  });

  it("refuses without a login, with a bad name, and from inside a business account", async () => {
    let res = response(); await handler(post({ action: "create-business", accessToken: "nope", name: "Shop" }), res); expect(res.statusCode).toBe(401);
    res = response(); await handler(post({ action: "create-business", accessToken: "tok-owner", name: "x" }), res); expect(res.statusCode).toBe(400);
    store.links.push({ owner_id: OWNER, business_user_id: BIZ, label: "Bola Bakes" });
    res = response(); await handler(post({ action: "create-business", accessToken: "tok-biz", name: "Another" }), res); expect(res.statusCode).toBe(403);
  });

  it("lets the owner open a linked business, and a business go back to its owner, but nobody else's account", async () => {
    store.links.push({ owner_id: OWNER, business_user_id: BIZ, label: "Bola Bakes" });
    let res = response(); await handler(post({ action: "switch-business", accessToken: "tok-owner", targetUserId: BIZ }), res);
    expect(res.statusCode).toBe(200); expect(res.body).toMatchObject({ session: { access_token: "new-access" } });
    res = response(); await handler(post({ action: "switch-business", accessToken: "tok-biz", targetUserId: OWNER }), res);
    expect(res.statusCode).toBe(200);
    res = response(); await handler(post({ action: "switch-business", accessToken: "tok-owner", targetUserId: OTHER }), res);
    expect(res.statusCode).toBe(403);
    res = response(); await handler(post({ action: "switch-business", accessToken: "tok-biz", targetUserId: OTHER }), res);
    expect(res.statusCode).toBe(403);
  });

  it("lists the businesses with their set-up status", async () => {
    store.links.push({ owner_id: OWNER, business_user_id: BIZ, label: "Bola Bakes" });
    const res = response(); await handler(post({ action: "list-businesses", accessToken: "tok-owner" }), res);
    expect(res.body).toEqual({ isBusiness: false, max: 5, businesses: [{ userId: BIZ, name: "Bola Bakes", status: "pending", logo: null, paused: false, unread: 0 }] });
  });
});
