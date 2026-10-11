/**
 * Fixed-window rate limiting.
 *
 * The default store keeps counters in memory, which on Vercel means per
 * function instance: it stops bursts from one client hitting one instance
 * (brute-force password attempts, scripted cart spam) but is not a global
 * quota. For a hard global limit, implement `RateLimitStore` on Redis/Upstash
 * or a database table and pass it to createServices().
 */

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
