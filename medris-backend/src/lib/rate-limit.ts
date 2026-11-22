/**
 * Fixed-window rate limiting.
 *
 * The default store keeps counters in memory, per process. RedisRateLimitStore keeps them in Redis, so they are
 * shared between dynos and a restart does not reset them; it falls back to memory while Redis is not connected.
 */
import type { RedisLike } from "../integrations/redis.js";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(private readonly maxKeys = 10_000) {}

  async hit(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }> {
    this.sweep(now);
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }
    current.count += 1;
    return current;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000 && this.buckets.size < this.maxKeys) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
    // Still too many live keys (an attack spraying keys): drop the oldest.
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly fallback: RateLimitStore = new MemoryRateLimitStore(),
  ) {}

  async hit(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }> {
    if (this.redis.isUp()) {
      try {
        const { count, ttlMs } = await this.redis.incrWindow(`rl:${key}`, windowMs);
        return { count, resetAt: now + (ttlMs > 0 ? ttlMs : windowMs) };
      } catch {
        /* Redis slow or gone: count in memory for now */
      }
    }
    return this.fallback.hit(key, windowMs, now);
  }
}

export class RateLimiter {
  constructor(
    private readonly store: RateLimitStore = new MemoryRateLimitStore(),
    private readonly now: () => number = Date.now,
  ) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const { count, resetAt } = await this.store.hit(key, windowMs, this.now());
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt };
  }
}
