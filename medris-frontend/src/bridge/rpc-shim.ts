/**
 * sb.rpc() through the backend.
 *
 * The legacy code calls about 150 database functions with `sb.rpc(name, args)`. installRpc(sb) wraps that one
 * method: a function the backend answers (services/api/rpc-functions.ts) goes to POST /api/v1/rpc/{name}, where the
 * backend's port runs the same rules (proven equal by its parity suite). The call site keeps working unchanged:
 * the wrapper is lazy and thenable like supabase-js's builder, supports .abortSignal(), and resolves to the same
 * `{ data, error }` - the error keeps the original's message.
 *
 * Supabase is used only as a safety net, never for the same write twice:
 *   - a read goes to Supabase when the backend is unreachable, slow, down or busy (0, 429, 502, 503, 504);
 *   - a write goes there only when it certainly never left the browser (offline, a site the backend refuses).
 * Any other function, or a call with options (head/count), goes straight to Supabase as before.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { V1Error, v1Request } from "@/services/api/v1-client";
import { RPC_READS, isBackendRpc } from "@/services/api/rpc-functions";

type RpcResult = { data: unknown; error: { message: string; code: string; details: unknown; hint: string } | null; count: null; status: number; statusText: string };
type Rpc = SupabaseClient["rpc"];

/** Write timeout: the backend's own limit is 30 s (and a sleeping server takes a few seconds to wake up). */
const TIMEOUT_MS = 30_000;
const warned = { shown: false };

class BackendRpcCall implements PromiseLike<RpcResult> {
  private signal: AbortSignal | undefined;
  private running: Promise<RpcResult> | null = null;

  constructor(
    private readonly name: string,
    private readonly args: Record<string, unknown>,
    private readonly viaSupabase: (signal: AbortSignal | undefined) => PromiseLike<RpcResult>,
  ) {}

  abortSignal(signal: AbortSignal): this {
    this.signal = signal;
    return this;
  }

  private run(): Promise<RpcResult> {
    this.running ??= this.send();
    return this.running;
  }

  private async send(): Promise<RpcResult> {
    try {
      const data = await v1Request<unknown>("POST", `rpc/${this.name}`, { body: this.args, timeoutMs: TIMEOUT_MS, signal: this.signal });
      return { data: data === undefined ? null : data, error: null, count: null, status: 200, statusText: "OK" };
    } catch (err) {
      if (!(err instanceof V1Error)) return failure("Something went wrong. Please try again.", "client_error", 0);
      if (err.code === "aborted") return failure(err.message, "20", 0);
      const retry = RPC_READS.has(this.name) ? err.isUnavailable || err.status === 429 : err.notSent;
      if (retry) {
        if (!warned.shown) {
          warned.shown = true;
          console.warn(`[levroData] backend unavailable (${err.status || err.code}); using Supabase directly for now.`);
        }
        return Promise.resolve(this.viaSupabase(this.signal));
      }
      return failure(err.message, err.code, err.status, err.details);
    }
  }

  then<A = RpcResult, B = never>(onFulfilled?: ((value: RpcResult) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return this.run().then(onFulfilled, onRejected);
  }

  catch<B = never>(onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<RpcResult | B> {
    return this.run().catch(onRejected);
  }

  finally(onFinally?: (() => void) | null): Promise<RpcResult> {
    return this.run().finally(onFinally);
  }
}

function failure(message: string, code: string, status: number, details: unknown = null): RpcResult {
  return { data: null, error: { message, code, details, hint: "" }, count: null, status, statusText: "" };
}

const ORIGINAL = Symbol.for("levro.supabaseRpc");

/** The client's own rpc (Supabase directly), for code that must not go through the backend. */
export function supabaseRpc(client: SupabaseClient): Rpc {
  const saved = (client as unknown as Record<symbol, Rpc | undefined>)[ORIGINAL];
  return saved ?? client.rpc.bind(client);
}

/**
 * Wraps client.rpc once. `enabled()` is read on every call, so the per-browser switch
 * (levroData.useBackend) takes effect at once.
 */
export function installRpc(client: SupabaseClient, enabled: () => boolean): void {
  const holder = client as unknown as Record<symbol, Rpc | undefined>;
  if (holder[ORIGINAL]) return;
  const original = client.rpc.bind(client) as Rpc;
  holder[ORIGINAL] = original;
  const wrapped = ((name: string, args?: Record<string, unknown>, options?: Record<string, unknown>) => {
    if (!enabled() || !isBackendRpc(name) || (options && Object.keys(options).length)) return original(name, args, options as never);
    const viaSupabase = (signal: AbortSignal | undefined) => {
      const builder = original(name, args) as unknown as { abortSignal(s: AbortSignal): PromiseLike<RpcResult> } & PromiseLike<RpcResult>;
      return signal ? builder.abortSignal(signal) : builder;
    };
    return new BackendRpcCall(name, args ?? {}, viaSupabase);
  }) as unknown as Rpc;
  client.rpc = wrapped;
}
