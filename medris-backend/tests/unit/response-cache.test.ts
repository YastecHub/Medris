import { describe, expect, it } from "vitest";
import { ResponseCache, stableKey } from "../../src/lib/response-cache.js";

describe("ResponseCache", () => {
  it("keeps a value for its TTL, then forgets it", () => {
    let now = 1000;
    const c = new ResponseCache({ now: () => now });
    c.set("a", 1, 500, 10);
    expect(c.get("a")).toBe(1);
    now = 1499;
    expect(c.get("a")).toBe(1);
    now = 1500;
    expect(c.get("a")).toBeUndefined();
  });

  it("drops the least recently used entries when full", () => {
    const c = new ResponseCache({ maxEntries: 2 });
    c.set("a", 1, 10_000, 1);
    c.set("b", 2, 10_000, 1);
    c.get("a");
    c.set("c", 3, 10_000, 1);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });

  it("respects the size limit and refuses huge values", () => {
    const c = new ResponseCache({ maxBytes: 100 });
    c.set("huge", "x", 10_000, 60);
    expect(c.get("huge")).toBeUndefined();
    c.set("a", 1, 10_000, 20);
    c.set("b", 2, 10_000, 20);
    expect(c.size).toBe(2);
  });

  it("loads once for many concurrent callers, and never caches a failure", async () => {
    const c = new ResponseCache();
    let calls = 0;
    const load = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return "v";
    };
    const results = await Promise.all([1, 2, 3, 4].map(() => c.getOrLoad("k", 10_000, load, () => 1)));
    expect(calls).toBe(1);
    expect(results.map((r) => r.value)).toEqual(["v", "v", "v", "v"]);
    await expect(c.getOrLoad("bad", 10_000, async () => Promise.reject(new Error("db down")), () => 1)).rejects.toThrow("db down");
    expect(c.get("bad")).toBeUndefined();
  });

  it("does not keep what `keep` refuses", async () => {
    const c = new ResponseCache();
    await c.getOrLoad("k", 10_000, async () => ({ status: 500 }), () => 1, (v) => v.status === 200);
    expect(c.get("k")).toBeUndefined();
  });

  it("stableKey ignores property order", () => {
    expect(stableKey({ b: [2, 1], a: { y: 1, x: null } })).toBe(stableKey({ a: { x: null, y: 1 }, b: [2, 1] }));
    expect(stableKey({ a: [1, 2] })).not.toBe(stableKey({ a: [2, 1] }));
  });
});
