import type { RedisLike } from "../../src/integrations/redis.js";

/** An in-memory stand-in for Redis that can be switched off or made to fail. */
export class FakeRedis implements RedisLike {
  readonly data = new Map<string, { value: string; expiresAt: number }>();
  up = true;
  failing = false;
  calls = 0;
  constructor(private readonly now: () => number = Date.now) {}
  isUp() {
    return this.up;
  }
  private guard() {
    this.calls++;
    if (this.failing) throw new Error("redis: timed out");
  }
  async get(key: string) {
    this.guard();
    const e = this.data.get(key);
    return e && e.expiresAt > this.now() ? e.value : null;
  }
  async set(key: string, value: string, ttlMs: number) {
    this.guard();
    this.data.set(key, { value, expiresAt: this.now() + ttlMs });
  }
  async incrWindow(key: string, windowMs: number) {
    this.guard();
    const e = this.data.get(key);
    const live = e && e.expiresAt > this.now() ? e : { value: "0", expiresAt: this.now() + windowMs };
    live.value = String(Number(live.value) + 1);
    this.data.set(key, live);
    return { count: Number(live.value), ttlMs: live.expiresAt - this.now() };
  }
  async ping() {
    return 1;
  }
  async close() {}
}
