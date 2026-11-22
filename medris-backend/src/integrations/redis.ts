import { createClient } from "@redis/client";
import type { Logger } from "../lib/logger.js";

/**
 * The few Redis commands the backend uses (the shared cache and the rate-limit counters).
 *
 * Redis only ever makes things faster or shared; nothing depends on it. While it is not connected `isUp()` is false
 * and callers use their in-memory fallback straight away, and every command gives up after a short time instead of
 * holding a request.
 */
export interface RedisLike {
  isUp(): boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** Counts one hit in a fixed window: the count so far and the milliseconds until the window ends. */
  incrWindow(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }>;
  /** Round trip in milliseconds. */
  ping(): Promise<number>;
  close(): Promise<void>;
}

/** A command that takes longer than this is given up on (the database or memory answers instead). */
const COMMAND_TIMEOUT_MS = 250;
/** Every key the backend writes starts with this, so the database can be shared or inspected safely. */
const PREFIX = "levro:";

function withTimeout<T>(p: Promise<T>, ms = COMMAND_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("redis: timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export class RedisLink implements RedisLike {
  private readonly client;
  private up = false;
  private closed = false;
  private warned = false;

  constructor(url: string, private readonly logger: Logger) {
    this.client = createClient({
      url,
      // While disconnected, commands fail at once instead of queueing behind the reconnect.
      disableOfflineQueue: true,
      socket: { connectTimeout: 5_000, reconnectStrategy: (retries: number) => Math.min(500 * (retries + 1), 10_000) },
    });
    this.client.on("ready", () => {
      this.up = true;
      this.warned = false;
      this.logger.info("redis: connected");
    });
    this.client.on("end", () => {
      this.up = false;
    });
    this.client.on("error", (err: unknown) => {
      this.up = false;
      // Once per outage, not once per reconnect attempt; never the URL (it holds the password).
      if (!this.warned) this.logger.warn("redis: not reachable; using memory until it is back", { reason: err instanceof Error ? err.message : String(err) });
      this.warned = true;
    });
    this.client.connect().catch(() => {
      /* reported by the "error" handler; the client keeps retrying */
    });
  }

  isUp(): boolean {
    return this.up && !this.closed;
  }

  async get(key: string): Promise<string | null> {
    return withTimeout(this.client.get(PREFIX + key));
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await withTimeout(this.client.set(PREFIX + key, value, { expiration: { type: "PX", value: Math.max(1, Math.round(ttlMs)) } }));
  }

  async incrWindow(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
    const k = PREFIX + key;
    // The first hit creates the key with the window as its lifetime; INCR keeps that lifetime.
    const [, count, ttl] = await withTimeout(
      this.client
        .multi()
        .set(k, "0", { condition: "NX", expiration: { type: "PX", value: Math.max(1, Math.round(windowMs)) } })
        .incr(k)
        .pTTL(k)
        .exec(),
    );
    return { count: Number(count), ttlMs: Number(ttl) };
  }

  async ping(): Promise<number> {
    const t = performance.now();
    await withTimeout(this.client.ping(), 2_000);
    return Math.round(performance.now() - t);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.up = false;
    await this.client.close().catch(() => undefined);
  }
}
