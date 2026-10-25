/**
 * A small in-memory cache for answers that are the same for everyone (public listings, counts, school names...),
 * so a hundred visitors opening the home page cost one database query instead of a hundred.
 *
 * - Entries expire after their TTL (seconds, not minutes: public data may lag a little, never for long).
 * - Least recently used entries go first when the size limits are reached.
 * - Single flight: while one request loads a key, others asking for the same key wait for that answer instead of
 *   all going to the database at once.
 *
 * In memory, per process: with one Heroku dyno that is all that's needed. With several, each keeps its own copy
 * (still correct, just less saved) - that is the point to consider a shared store such as Redis.
 */
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

export class ResponseCache {
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
