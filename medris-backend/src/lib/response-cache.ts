/**
 * A small in-memory cache for answers that are the same for everyone (public listings, counts, school names...),
 * so a hundred visitors opening the home page cost one database query instead of a hundred.
 *
 * - Entries expire after their TTL (seconds, not minutes: public data may lag a little, never for long).
 * - Least recently used entries go first when the size limits are reached.
 * - Single flight: while one request loads a key, others asking for the same key wait for that answer instead of
 *   all going to the database at once.
 *
 * In memory, per process. TieredCache (below) puts Redis behind it, so a restart or a new deploy does not start
 * empty and several dynos would share one copy.
 */
import type { RedisLike } from "../integrations/redis.js";

/** What the routes need from a cache: ResponseCache (memory only) or TieredCache (memory, then Redis). */
export interface CacheStore {
  getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>, size: (v: T) => number, keep?: (v: T) => boolean): Promise<{ value: T; hit: boolean }>;
}
export interface CacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  now?: () => number;
}

interface Entry<T> {
  value: T;
  bytes: number;
  expiresAt: number;
}

export class ResponseCache implements CacheStore {
  private readonly entries = new Map<string, Entry<unknown>>();
  private readonly loading = new Map<string, Promise<unknown>>();
  private bytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  readonly stats = { hits: 0, misses: 0, shared: 0 };

  constructor(o: CacheOptions = {}) {
    this.maxEntries = o.maxEntries ?? 500;
    this.maxBytes = o.maxBytes ?? 32 * 1024 * 1024;
    this.now = o.now ?? Date.now;
  }

  get<T>(key: string): T | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.delete(key);
      return undefined;
    }
    // Most recently used goes to the end.
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number, bytes: number): void {
    if (ttlMs <= 0 || bytes > this.maxBytes / 4) return; // too big to be worth keeping
    this.delete(key);
    this.entries.set(key, { value, bytes, expiresAt: this.now() + ttlMs });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }

  delete(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.bytes -= e.bytes;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * The cached value, or load it once (concurrent callers share the load). `keep` decides whether the loaded value
   * may be cached (e.g. only successful answers); a failed load is never cached and is rethrown to every waiter.
   */
  async getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>, size: (v: T) => number, keep: (v: T) => boolean = () => true): Promise<{ value: T; hit: boolean }> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      this.stats.hits++;
      return { value: cached, hit: true };
    }
    const pending = this.loading.get(key) as Promise<T> | undefined;
    if (pending) {
      this.stats.shared++;
      return { value: await pending, hit: true };
    }
    this.stats.misses++;
    const p = load();
    this.loading.set(key, p);
    try {
      const value = await p;
      if (keep(value)) this.set(key, value, ttlMs, size(value));
      return { value, hit: false };
    } finally {
      this.loading.delete(key);
    }
  }
}

/** Values bigger than this stay in memory only (the Redis plan is small). */
const MAX_REDIS_BYTES = 256 * 1024;

/**
 * Two layers: this process's memory first (fastest), then Redis (shared, and still there after a restart or deploy),
 * then the database. What Redis holds carries its own expiry time, so copying it into memory never makes it live
 * longer than its TTL. When Redis is not connected this behaves exactly like ResponseCache.
 */
export class TieredCache implements CacheStore {
  private readonly loading = new Map<string, Promise<{ value: unknown; hit: boolean }>>();
  readonly stats = { hits: 0, redisHits: 0, misses: 0, shared: 0 };

  constructor(
    private readonly redis: RedisLike,
    readonly memory: ResponseCache = new ResponseCache(),
    private readonly now: () => number = Date.now,
  ) {}

  async getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>, size: (v: T) => number, keep: (v: T) => boolean = () => true): Promise<{ value: T; hit: boolean }> {
    const local = this.memory.get<T>(key);
    if (local !== undefined) {
      this.stats.hits++;
      return { value: local, hit: true };
    }
    const pending = this.loading.get(key) as Promise<{ value: T; hit: boolean }> | undefined;
    if (pending) {
      this.stats.shared++;
      return { value: (await pending).value, hit: true };
    }
    const p = this.fetch(key, ttlMs, load, size, keep);
    this.loading.set(key, p);
    try {
      return await p;
    } finally {
      this.loading.delete(key);
    }
  }

  private async fetch<T>(key: string, ttlMs: number, load: () => Promise<T>, size: (v: T) => number, keep: (v: T) => boolean): Promise<{ value: T; hit: boolean }> {
    if (this.redis.isUp()) {
      try {
        const raw = await this.redis.get(`cache:${key}`);
        if (raw) {
          const { v, exp } = JSON.parse(raw, revive) as { v: T; exp: number };
          const left = exp - this.now();
          if (left > 0) {
            this.memory.set(key, v, left, size(v));
            this.stats.redisHits++;
            return { value: v, hit: true };
          }
        }
      } catch {
        /* Redis slow or unreadable: load from the database below */
      }
    }
    this.stats.misses++;
    const value = await load();
    if (keep(value)) {
      const bytes = size(value);
      this.memory.set(key, value, ttlMs, bytes);
      if (this.redis.isUp() && bytes <= MAX_REDIS_BYTES) {
        // Not awaited: the caller has its answer; a failed write only means the next dyno or restart loads it again.
        this.redis.set(`cache:${key}`, JSON.stringify({ v: value, exp: this.now() + ttlMs }, replace), ttlMs).catch(() => undefined);
      }
    }
    return { value, hit: false };
  }
}

/** Buffers (the data API's cached bodies) go to Redis as base64, not as JSON arrays of numbers. */
function replace(_key: string, value: unknown): unknown {
  const b = value as { type?: unknown; data?: unknown } | null;
  return b && b.type === "Buffer" && Array.isArray(b.data) ? { $b64: Buffer.from(b.data as number[]).toString("base64") } : value;
}
function revive(_key: string, value: unknown): unknown {
  const b = value as { $b64?: unknown } | null;
  return b && typeof b === "object" && typeof b.$b64 === "string" && Object.keys(b).length === 1 ? Buffer.from(b.$b64, "base64") : value;
}

/** A stable key for an arguments object (property order does not matter). */
export function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableKey((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
