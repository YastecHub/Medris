import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LevroData } from "../src/bridge/data-gateway.ts";

/** sb.from() through the backend's data API (src/bridge/table-shim.ts): same request, other address, Supabase as safety net. */

const SUPA = "https://example.supabase.co/rest/v1";
const BACKEND = "https://api.example.dev";
let supabaseCalls: string[];

async function setup(ready: boolean, backend: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "vapid");
  vi.stubEnv("VITE_BACKEND_URL", BACKEND);
  // GET /api/v1/data-api (readiness) goes through the global fetch; the queries through the client's own fetch.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ready }), { status: 200 })));
  const restFetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith(SUPA)) {
      supabaseCalls.push(`${init?.method ?? "GET"} ${url.slice(SUPA.length)}`);
      return new Response("[]", { status: 200 });
    }
    return backend(url, init);
  });
  const client = { rest: { url: SUPA, fetch: restFetch }, rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(), auth: { onAuthStateChange: vi.fn() } };
  vi.stubGlobal("sb", client);
  await import("../src/bridge/data-gateway.ts");
  (globalThis as unknown as { window: { levroData: LevroData } }).window.levroData.installTables(client as never);
  await new Promise((r) => setTimeout(r, 0));
  return { query: (path: string, init?: RequestInit) => (client.rest.fetch as (u: string, i?: RequestInit) => Promise<Response>)(SUPA + path, init), restFetch };
}

beforeEach(() => {
  supabaseCalls = [];
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sb.from through the backend's data API", () => {
  it("sends the same request (path, query, headers, body) to the backend once it is ready", async () => {
    const backend = vi.fn(async () => new Response('[{"id":1}]', { status: 200 }));
    const { query } = await setup(true, backend);
    const init = { method: "POST", headers: { Authorization: "Bearer t", Prefer: "return=representation" }, body: '{"a":1}' };
    expect(await (await query("/favorites?select=id", init)).json()).toEqual([{ id: 1 }]);
    expect(backend).toHaveBeenCalledWith(`${BACKEND}/rest/v1/favorites?select=id`, init);
    expect(supabaseCalls).toEqual([]);
  });

  it("stays on Supabase while the data API is not ready", async () => {
    const backend = vi.fn();
    const { query } = await setup(false, backend);
    await query("/products?select=id");
    expect(backend).not.toHaveBeenCalled();
    expect(supabaseCalls).toEqual(["GET /products?select=id"]);
  });

  it("a read goes to Supabase when the backend is down; a write does not run twice", async () => {
    const { query } = await setup(true, async () => new Response("<html>timeout</html>", { status: 503 }));
    await query("/products?select=id");
    const write = await query("/orders?id=eq.1", { method: "PATCH", body: "{}" });
    expect(write.status).toBe(503);
    expect(supabaseCalls).toEqual(["GET /products?select=id"]);
  });

  it("a write the data API refused before running (PGRST0xx) goes to Supabase", async () => {
    const { query } = await setup(true, async () => new Response('{"code":"PGRST001","message":"no connection"}', { status: 503 }));
    await query("/favorites", { method: "POST", body: "{}" });
    expect(supabaseCalls).toEqual(["POST /favorites"]);
  });

  it("a request that never left the browser goes to Supabase, and the backend is skipped for a while", async () => {
    const backend = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    const { query } = await setup(true, backend);
    await query("/favorites", { method: "POST", body: "{}" });
    await query("/products?select=id");
    expect(backend).toHaveBeenCalledTimes(1);
    expect(supabaseCalls).toEqual(["POST /favorites", "GET /products?select=id"]);
  });
});
