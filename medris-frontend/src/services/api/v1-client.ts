import type { V1ErrorBody } from "@medris/contracts";
import { appConfig } from "@/config/env";
import { getAccessToken } from "@/lib/legacy-runtime";

/**
 * Client for the backend's own API (/api/v1). Signs requests with the
 * current Supabase access token (Authorization: Bearer); when backend
 * sessions are enabled the HttpOnly session cookie is sent as well.
 * Failures become V1Error with the API's stable error code.
 */
export class V1Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "V1Error";
  }

  /** The server could not be reached or is temporarily unavailable. */
  get isUnavailable(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }

  /**
   * The request certainly never reached the backend (offline, the address could not be resolved, the browser
   * refused it before sending - e.g. a site the backend does not allow). Unlike a timeout or a 5xx, a write in
   * this state did not run, so it is safe to send it another way.
   */
  get notSent(): boolean {
    return this.code === "network_error";
  }
}

export interface V1RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Send the access token (default true). */
  auth?: boolean;
  timeoutMs?: number;
  /** The caller's own cancel signal (e.g. a search replaced by a newer one). */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export function v1Url(path: string, query?: V1RequestOptions["query"]): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== "") params.set(key, String(value));
  const qs = params.toString();
  return `${appConfig.backendUrl}/api/v1/${path.replace(/^\/+/, "")}${qs ? `?${qs}` : ""}`;
}

/** The client-side timeout, joined with the caller's signal when there is one. */
function requestSignal(options: V1RequestOptions): AbortSignal | undefined {
  // AbortSignal.timeout / AbortSignal.any are missing on some older mobile browsers; they simply get no client-side timeout.
  const timeout = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) : undefined;
  if (!options.signal) return timeout;
  if (!timeout) return options.signal;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([options.signal, timeout]) : options.signal;
}

/**
 * When a request cannot leave the browser (the backend refuses this site, it is not reachable, the phone is
 * offline), the next ones would fail the same way and each would cost a round trip before the Supabase fallback.
 * So the backend is skipped for a minute: requests fail at once as "not sent", and callers use Supabase.
 */
const PAUSE_AFTER_NETWORK_ERROR_MS = 60_000;
let pausedUntil = 0;

/** Skip the backend for `ms` (e.g. it answered that an endpoint does not exist yet). */
export function pauseBackend(ms: number): void {
  pausedUntil = Math.max(pausedUntil, Date.now() + ms);
}

export async function v1Request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, options: V1RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.auth !== false) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (Date.now() < pausedUntil) throw new V1Error("Network problem. Please check your connection and try again.", 0, "network_error");
  let response: Response;
  try {
    response = await fetch(v1Url(path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: appConfig.backendUrl ? "include" : "same-origin",
      signal: requestSignal(options),
    });
  } catch (err) {
    if (options.signal?.aborted) throw new V1Error("AbortError: The operation was aborted.", 0, "aborted");
    const name = (err as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new V1Error("The request took too long. Please try again.", 0, "timeout");
    pauseBackend(PAUSE_AFTER_NETWORK_ERROR_MS);
    throw new V1Error("Network problem. Please check your connection and try again.", 0, "network_error");
  }
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as { data?: T } & Partial<V1ErrorBody>;
  if (!response.ok) {
    const error = payload?.error;
    throw new V1Error(error?.message || `Request failed (${response.status})`, response.status, error?.code || "http_error", error?.details, payload?.requestId);
  }
  return payload?.data as T;
}
