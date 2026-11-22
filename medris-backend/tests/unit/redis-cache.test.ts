import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { RedisLink } from "../../src/integrations/redis.js";
import { createLogger } from "../../src/lib/logger.js";
import { MemoryRateLimitStore, RateLimiter, RedisRateLimitStore } from "../../src/lib/rate-limit.js";
import { ResponseCache, TieredCache } from "../../src/lib/response-cache.js";
import { clientIp } from "../../src/shared/responses.js";
import { FakeRedis } from "../support/fake-redis.js";

const size = (v: unknown) => JSON.stringify(v).length;

describe("TieredCache (memory, then Redis, then the database)", () => {
  it("loads once, then answers from memory", async () => {
    const redis = new FakeRedis();
    const c = new TieredCache(redis);
    let loads = 0;
    const load = async () => ({ n: ++loads });
    expect(await c.getOrLoad("k", 30_000, load, size)).toEqual({ value: { n: 1 }, hit: false });
    expect(await c.getOrLoad("k", 30_000, load, size)).toEqual({ value: { n: 1 }, hit: true });
    expect(loads).toBe(1);
    expect(redis.data.has("cache:k")).toBe(true);
  });

  it("a restart (empty memory) is answered from Redis, not the database", async () => {
    const redis = new FakeRedis();
    let loads = 0;
    const load = async () => ({ n: ++loads });
    await new TieredCache(redis).getOrLoad("k", 30_000, load, size);
    const afterRestart = new TieredCache(redis);
    expect(await afterRestart.getOrLoad("k", 30_000, load, size)).toEqual({ value: { n: 1 }, hit: true });
    expect(loads).toBe(1);
    expect(afterRestart.stats.redisHits).toBe(1);
  });

  it("never keeps a value longer than its TTL by copying it from Redis into memory", async () => {
    let now = 1_000_000;
    const clock = () => now;
    const redis = new FakeRedis(clock);
    let loads = 0;
    const load = async () => ({ n: ++loads });
    await new TieredCache(redis, new ResponseCache({ now: clock }), clock).getOrLoad("k", 30_000, load, size);
    now += 25_000; // 5 s left in Redis
    const second = new TieredCache(redis, new ResponseCache({ now: clock }), clock);
    expect((await second.getOrLoad("k", 30_000, load, size)).value).toEqual({ n: 1 });
    now += 6_000; // the original 30 s are over: memory must not still have it
    expect((await second.getOrLoad("k", 30_000, load, size)).value).toEqual({ n: 2 });
  });

  it("keeps working from memory when Redis is down or failing", async () => {
    const redis = new FakeRedis();
    redis.up = false;
    const c = new TieredCache(redis);
    let loads = 0;
    const load = async () => ++loads;
    await c.getOrLoad("k", 30_000, load, () => 8);
    expect((await c.getOrLoad("k", 30_000, load, () => 8)).hit).toBe(true);
    expect(redis.calls).toBe(0);

    const failing = new FakeRedis();
    failing.failing = true;
    const d = new TieredCache(failing);
    expect(await d.getOrLoad("x", 30_000, async () => "fresh", () => 8)).toEqual({ value: "fresh", hit: false });
  });

  it("does not cache what `keep` refuses, and shares one load between simultaneous callers", async () => {
    const c = new TieredCache(new FakeRedis());
    let loads = 0;
    const slow = () => new Promise<number>((r) => setTimeout(() => r(++loads), 10));
    const [a, b] = await Promise.all([c.getOrLoad("s", 30_000, slow, () => 8), c.getOrLoad("s", 30_000, slow, () => 8)]);
    expect([a.value, b.value, loads]).toEqual([1, 1, 1]);
    const refused = new FakeRedis();
    const r = new TieredCache(refused);
    await r.getOrLoad("e", 30_000, async () => ({ status: 500 }), size, (v) => v.status === 200);
    expect(refused.data.size).toBe(0);
  });

  it("stores Buffers (cached data API bodies) compactly and gets them back as Buffers", async () => {
    const redis = new FakeRedis();
    const body = Buffer.from('[{"id":1}]');
    await new TieredCache(redis).getOrLoad("b", 30_000, async () => ({ status: 200, body }), () => 64);
    expect(redis.data.get("cache:b")!.value).toContain('"$b64"');
    const back = await new TieredCache(redis).getOrLoad("b", 30_000, async () => ({ status: 0, body: Buffer.alloc(0) }), () => 64);
    expect(Buffer.isBuffer(back.value.body)).toBe(true);
    expect(back.value.body.toString()).toBe('[{"id":1}]');
  });
});

describe("RedisRateLimitStore", () => {
  it("counts in Redis, shared by every process", async () => {
    const redis = new FakeRedis();
    const one = new RateLimiter(new RedisRateLimitStore(redis));
    const two = new RateLimiter(new RedisRateLimitStore(redis));
    expect((await one.consume("login:ip:1", 2, 60_000)).allowed).toBe(true);
    expect((await two.consume("login:ip:1", 2, 60_000)).allowed).toBe(true);
    expect((await one.consume("login:ip:1", 2, 60_000)).allowed).toBe(false);
  });

  it("counts in memory while Redis is down or failing", async () => {
    const redis = new FakeRedis();
    redis.failing = true;
    const limiter = new RateLimiter(new RedisRateLimitStore(redis, new MemoryRateLimitStore()));
    await limiter.consume("k", 1, 60_000);
    expect((await limiter.consume("k", 1, 60_000)).allowed).toBe(false);
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => ({ get: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;
  it("trusts only the address Heroku's router added (the last one)", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });
  it("behind Cloudflare, uses the visitor's address Cloudflare reports", () => {
    expect(clientIp(req({ "x-forwarded-for": "102.89.1.1, 172.70.1.1", "cf-connecting-ip": "102.89.1.1" }))).toBe("102.89.1.1");
    expect(clientIp(req({ "x-forwarded-for": "2a06:98c1::1", "cf-connecting-ip": "102.89.1.1" }))).toBe("102.89.1.1");
  });
  it("ignores CF-Connecting-IP sent by anyone who is not Cloudflare", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "9.9.9.9" }))).toBe("203.0.113.9");
  });
  it("falls back to X-Real-IP, then unknown", () => {
    expect(clientIp(req({ "x-real-ip": "10.0.0.1" }))).toBe("10.0.0.1");
    expect(clientIp(req({}))).toBe("unknown");
  });
});

// Against a real Redis only when one is given (REDIS_TEST_URL=redis://localhost:6379 npm test).
describe.skipIf(!process.env.REDIS_TEST_URL)("RedisLink against a real Redis", () => {
  it("gets, sets with expiry, counts windows and pings", async () => {
    const link = new RedisLink(process.env.REDIS_TEST_URL!, createLogger({ level: "error" }));
    for (let i = 0; i < 50 && !link.isUp(); i++) await new Promise((r) => setTimeout(r, 50));
    expect(link.isUp()).toBe(true);
    const key = `test:${Date.now()}`;
    await link.set(key, "v", 200);
    expect(await link.get(key)).toBe("v");
    const a = await link.incrWindow(`${key}:rl`, 60_000);
    const b = await link.incrWindow(`${key}:rl`, 60_000);
    expect([a.count, b.count]).toEqual([1, 2]);
    expect(b.ttlMs).toBeGreaterThan(50_000);
    expect(await link.ping()).toBeGreaterThanOrEqual(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(await link.get(key)).toBeNull();
    await link.close();
    expect(link.isUp()).toBe(false);
  });
});
