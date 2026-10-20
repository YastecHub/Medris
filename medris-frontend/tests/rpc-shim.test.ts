import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LevroData } from "../src/bridge/data-gateway.ts";

/**
 * sb.rpc() through the backend (src/bridge/rpc-shim.ts): the call site's code is unchanged, the request goes to
 * POST /api/v1/rpc/{name}, and Supabase is only a safety net that never runs the same write twice.
 */

type Rpc = (name: string, args?: Record<string, unknown>, options?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  abortSignal(s: AbortSignal): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
let supabaseCalls: [string, unknown][];

function fakeSupabase() {
  const client = {
    rpc(name: string, args: unknown) {
      supabaseCalls.push([name, args]);
      const result = Promise.resolve({ data: "from-supabase", error: null });
      return Object.assign(result, { abortSignal: () => result });
    },
    auth: { getSession: async () => ({ data: { session: { access_token: "user-token" } } }) },
  };
  return client as unknown as { rpc: Rpc };
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function setup(env: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "vapid");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const client = fakeSupabase();
  vi.stubGlobal("sb", client);
  await import("../src/bridge/data-gateway.ts");
  const levroData = (globalThis as unknown as { window: { levroData: LevroData } }).window.levroData;
  levroData.installRpc(client as never);
  return { sb: client, levroData };
}

beforeEach(() => {
  supabaseCalls = [];
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const BACKEND = { VITE_BACKEND_URL: "https://api.example.dev" };

describe("sb.rpc through the backend", () => {
  it("is on whenever the build knows the backend's address", async () => {
    const { levroData } = await setup(BACKEND);
    expect(levroData.features).toEqual(["catalogue", "cart", "favorites", "follows", "notifications", "rpc"]);
  });

  it("is off without a backend address (development, tests) - Supabase as before", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { sb, levroData } = await setup({});
    expect(levroData.features).toEqual([]);
    expect(await sb.rpc("get_vendor_stats", { p_vendor_id: "v1" })).toEqual({ data: "from-supabase", error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the function's arguments with the user's token and resolves to { data, error }", async () => {
    const fetchMock = vi.fn(async () => json(200, { data: [{ completed_orders: 3 }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { sb } = await setup(BACKEND);
    const result = await sb.rpc("get_vendor_stats", { p_vendor_id: "v1" });
    expect(result).toMatchObject({ data: [{ completed_orders: 3 }], error: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.dev/api/v1/rpc/get_vendor_stats");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ p_vendor_id: "v1" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
    expect(init.credentials).toBe("include");
    expect(supabaseCalls).toEqual([]);
  });

  it("is lazy like supabase-js: nothing is sent until the call is awaited", async () => {
    const fetchMock = vi.fn(async () => json(200, { data: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { sb } = await setup(BACKEND);
    const call = sb.rpc("touch_last_seen");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await call).toMatchObject({ data: null, error: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the original's error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(400, { error: { code: "bad_request", message: "You cannot follow your own shop." } })));
    const { sb } = await setup(BACKEND);
    const { data, error } = await sb.rpc("toggle_vendor_follow", { p_vendor_id: "v1", p_following: true });
    expect(data).toBeNull();
    expect(error).toMatchObject({ message: "You cannot follow your own shop.", code: "bad_request" });
    expect(supabaseCalls).toEqual([]);
  });

  it("supports .abortSignal() and .catch()", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { data: [] })));
    const { sb } = await setup(BACKEND);
    expect(await sb.rpc("search_products_full_v2", { p_query: "rice" }).abortSignal(new AbortController().signal)).toMatchObject({ data: [] });
    const viaCatch = (sb.rpc("touch_last_seen") as unknown as Promise<unknown>).catch(() => "rejected");
    expect(await viaCatch).toMatchObject({ error: null });
  });

  it("a read uses Supabase when the backend is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(503, { error: { code: "service_unavailable", message: "down" } })));
    const { sb } = await setup(BACKEND);
    expect(await sb.rpc("get_vendor_stats", { p_vendor_id: "v1" })).toEqual({ data: "from-supabase", error: null });
    expect(supabaseCalls).toEqual([["get_vendor_stats", { p_vendor_id: "v1" }]]);
  });

  it("a write is never sent twice: a 503 is reported, not retried on Supabase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(503, { error: { code: "service_unavailable", message: "down" } })));
    const { sb } = await setup(BACKEND);
    const { error } = await sb.rpc("create_sale_order", { p_vendor_id: "v1" });
    expect(error).toMatchObject({ message: "down" });
    expect(supabaseCalls).toEqual([]);
  });

  it("a write that never left the browser goes to Supabase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const { sb } = await setup(BACKEND);
    expect(await sb.rpc("add_order_note", { p_order_id: "o1", p_body: "hi" })).toEqual({ data: "from-supabase", error: null });
    expect(supabaseCalls).toEqual([["add_order_note", { p_order_id: "o1", p_body: "hi" }]]);
  });

  it("a backend deployed before this endpoint existed: everything goes to Supabase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { error: { code: "not_found", message: "Not found." } })));
    const { sb } = await setup(BACKEND);
    expect(await sb.rpc("create_sale_order", { p_vendor_id: "v1" })).toEqual({ data: "from-supabase", error: null });
    expect(supabaseCalls).toEqual([["create_sale_order", { p_vendor_id: "v1" }]]);
  });

  it("a busy backend (429): reads use Supabase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(429, { error: { code: "rate_limited", message: "Too many requests." } })));
    const { sb } = await setup(BACKEND);
    expect(await sb.rpc("get_vendor_stats", { p_vendor_id: "v1" })).toEqual({ data: "from-supabase", error: null });
    const { error } = await sb.rpc("add_order_note", { p_order_id: "o1", p_body: "hi" });
    expect(error).toMatchObject({ code: "rate_limited" });
  });

  it("after a request the browser could not send, the backend is skipped for a while (no repeated failures)", async () => {
    const fetchMock = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    vi.stubGlobal("fetch", fetchMock);
    const { sb } = await setup(BACKEND);
    await sb.rpc("get_vendor_stats", { p_vendor_id: "v1" });
    await sb.rpc("get_vendor_stats", { p_vendor_id: "v2" });
    await sb.rpc("add_order_note", { p_order_id: "o1", p_body: "hi" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(supabaseCalls.map(([n]) => n)).toEqual(["get_vendor_stats", "get_vendor_stats", "add_order_note"]);
  });

  it("functions the backend does not answer, and calls with options, go to Supabase", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { sb } = await setup(BACKEND);
    await sb.rpc("increment_chat_usage", {});
    await sb.rpc("get_vendor_stats", { p_vendor_id: "v1" }, { count: "exact" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(supabaseCalls.map(([n]) => n)).toEqual(["increment_chat_usage", "get_vendor_stats"]);
  });

  it("can be switched off for one browser", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { sb, levroData } = await setup(BACKEND);
    levroData.useBackend("none");
    await sb.rpc("get_vendor_stats", { p_vendor_id: "v1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
