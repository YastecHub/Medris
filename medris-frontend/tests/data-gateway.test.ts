import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LevroData } from "../src/bridge/data-gateway.ts";

/**
 * The legacy data gateway (src/bridge/data-gateway.ts).
 *
 * Off (the default build): every method must run exactly the Supabase query
 * its call site ran before - recorded here call by call.
 * On: the request goes to /api/v1 with the user's token, and the response is
 * reshaped into the { data, error, count } the call sites expect.
 */

type Call = [string, ...unknown[]];
let chains: Call[][];

/** A stand-in for the global supabase-js client that records each query builder chain. */
function fakeSupabase(result: unknown = { data: "legacy", error: null, count: 7 }) {
  const builder = (chain: Call[]): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result);
          return (...args: unknown[]) => {
            chain.push([prop, ...args]);
            return builder(chain);
          };
        },
      },
    );
  return {
    from: (table: string) => {
      const chain: Call[] = [["from", table]];
      chains.push(chain);
      return builder(chain);
    },
    rpc: (name: string, args: unknown) => {
      const chain: Call[] = [["rpc", name, args]];
      chains.push(chain);
      return builder(chain);
    },
    auth: { getSession: async () => ({ data: { session: { access_token: "user-token" } } }) },
  };
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  };
}

async function loadGateway(features: string | undefined) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "vapid");
  vi.stubEnv("VITE_BACKEND_FEATURES", features ?? "");
  await import("../src/bridge/data-gateway.ts");
  return (globalThis as unknown as { window: { levroData: LevroData } }).window.levroData;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  chains = [];
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sb", fakeSupabase());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("data gateway: features off (default build)", () => {
  it("runs exactly the original Supabase queries and never calls the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const d = await loadGateway(undefined);
    expect(d.features).toEqual([]);

    expect(await d.cart.count("u1")).toEqual({ data: "legacy", error: null, count: 7 });
    await d.cart.add("p1", 2, null);
    await d.cart.setQuantity("c1", 3);
    await d.cart.removeMany(["c1", "c2"]);
    await d.notifications.panel("u1", "2026-09-10T00:00:00.000Z");
    await d.notifications.offerCount("u1", "1970-01-01T00:00:00.000Z");
    await d.notifications.markAllRead("u1");
    await d.favorites.productIds("u1");
    await d.favorites.addPackage("u1", "k1");
    await d.follows.set("v1", true);
    await d.follows.isFollowing("u1", "v1");
    await d.follows.vendorIds("u1");
    await d.catalogue.sectors("name");
    await d.catalogue.categories();

    expect(chains).toEqual([
      [["from", "cart_items"], ["select", "id", { count: "exact", head: true }], ["eq", "buyer_id", "u1"]],
      [["rpc", "add_to_cart", { p_product_id: "p1", p_quantity: 2, p_variant_id: null }]],
      [["from", "cart_items"], ["update", { quantity: 3 }], ["eq", "id", "c1"]],
      [["from", "cart_items"], ["delete"], ["in", "id", ["c1", "c2"]]],
      [
        ["from", "notifications"],
        ["select", "*"],
        ["eq", "user_id", "u1"],
        ["is", "deleted_at", null],
        ["or", "read.eq.false,created_at.gte.2026-09-10T00:00:00.000Z"],
        ["order", "created_at", { ascending: false }],
        ["limit", 150],
      ],
      [
        ["from", "notifications"],
        ["select", "id", { count: "exact", head: true }],
        ["eq", "user_id", "u1"],
        ["eq", "type", "new_offer"],
        ["eq", "read", false],
        ["eq", "archived", false],
        ["is", "deleted_at", null],
        ["gt", "created_at", "1970-01-01T00:00:00.000Z"],
      ],
      [["from", "notifications"], ["update", { read: true }], ["eq", "user_id", "u1"], ["eq", "read", false], ["is", "deleted_at", null]],
      [["from", "favorites"], ["select", "product_id"], ["eq", "buyer_id", "u1"]],
      [["from", "package_favorites"], ["insert", { buyer_id: "u1", package_id: "k1" }]],
      [["rpc", "toggle_vendor_follow", { p_vendor_id: "v1", p_following: true }]],
      [["from", "vendor_follows"], ["select", "id"], ["eq", "vendor_id", "v1"], ["eq", "follower_id", "u1"], ["maybeSingle"]],
      [["from", "vendor_follows"], ["select", "vendor_id"], ["eq", "follower_id", "u1"], ["limit", 2000]],
      [["from", "sectors"], ["select", "*"], ["order", "name"]],
      [["from", "categories"], ["select", "*"], ["order", "name"]],
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the cart page's exact embedded select", async () => {
    const d = await loadGateway("");
    await d.cart.list("u1");
    expect(chains[0]).toEqual([
      ["from", "cart_items"],
      [
        "select",
        "id, variant_id, quantity, created_at, variant:product_variants(*), product:products(id, name, sale_price, discount_price, photos, quantity_available, status, delivery_fee, delivery_fee_mode, delivery_fee_per_km, vendor:vendors(id, business_name, previous_business_name, name_changed_at, is_active, verification_status, delivery_fee, delivery_fee_mode, delivery_fee_per_km, lat, lng))",
      ],
      ["eq", "buyer_id", "u1"],
      ["order", "created_at", { ascending: true }],
    ]);
  });
});

describe("data gateway: features on", () => {
  it("calls /api/v1 with the user's token and returns the call sites' shape", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === "/api/v1/cart" && init.method === "GET") return json(200, { data: [{ id: "c1", quantity: 2 }] });
      if (url === "/api/v1/cart/count") return json(200, { data: { count: 3 } });
      if (url === "/api/v1/notifications/unread-count?type=new_offer&after=2026-10-01T00%3A00%3A00.000Z") return json(200, { data: { count: 1 } });
      return json(404, { error: { code: "not_found", message: "Not found." } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const d = await loadGateway("cart,notifications");
    expect(d.features).toEqual(["cart", "notifications"]);

    expect(await d.cart.list("u1")).toEqual({ data: [{ id: "c1", quantity: 2 }], error: null });
    expect(await d.cart.count("u1")).toEqual({ data: null, error: null, count: 3 });
    expect(await d.notifications.offerCount("u1", "2026-10-01T00:00:00.000Z")).toEqual({ data: null, error: null, count: 1 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
    expect(chains).toEqual([]);

    // Features not listed keep using Supabase.
    await d.catalogue.sectors();
    expect(chains).toHaveLength(1);
  });

  it("passes the API's error message through like a Supabase error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(400, { error: { code: "bad_request", message: "You cannot add your own product to your cart." } })));
    const d = await loadGateway("all");
    expect(await d.cart.add("p1", 1, null)).toEqual({
      data: null,
      count: null,
      error: { message: "You cannot add your own product to your cart.", code: "bad_request", details: undefined, status: 400 },
    });
  });

  it("falls back to Supabase for reads when the backend is unavailable, but never repeats a non-idempotent write", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => json(503, { error: { code: "service_unavailable", message: "DATABASE_URL is not configured on this deployment." } })));
    const d = await loadGateway("all");
    expect(await d.cart.list("u1")).toEqual({ data: "legacy", error: null, count: 7 });
    expect(chains).toHaveLength(1);
    const added = await d.cart.add("p1", 1, null);
    expect(added.error?.status).toBe(503);
    expect(chains).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("loads product and package favourites with one request", async () => {
    const fetchMock = vi.fn(async () => json(200, { data: { productIds: ["p1"], packageIds: ["k1", "k2"] } }));
    vi.stubGlobal("fetch", fetchMock);
    const d = await loadGateway("favorites");
    const [products, packages] = await Promise.all([d.favorites.productIds("u1"), d.favorites.packageIds("u1")]);
    expect(products.data).toEqual([{ product_id: "p1" }]);
    expect(packages.data).toEqual([{ package_id: "k1" }, { package_id: "k2" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follow state is truthy only when following", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => json(200, { data: { following: url.endsWith("/v1") } })));
    const d = await loadGateway("follows");
    expect((await d.follows.isFollowing("u1", "v1")).data).toBeTruthy();
    expect((await d.follows.isFollowing("u1", "v2")).data).toBeNull();
  });

  it("can be switched per browser and survives a reload", async () => {
    vi.stubGlobal("fetch", vi.fn());
    let d = await loadGateway("");
    expect(d.useBackend("cart")).toEqual(["cart"]);
    d = await loadGateway("");
    expect(d.features).toEqual(["cart"]);
    expect(d.useBackend(null)).toEqual([]);
  });
});
