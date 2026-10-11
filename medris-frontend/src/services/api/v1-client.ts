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
}

export interface V1RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Send the access token (default true). */
  auth?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export function v1Url(path: string, query?: V1RequestOptions["query"]): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== "") params.set(key, String(value));
  const qs = params.toString();
  return `${appConfig.apiBaseUrl}/api/v1/${path.replace(/^\/+/, "")}${qs ? `?${qs}` : ""}`;
}

export async function v1Request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, options: V1RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.auth !== false) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let response: Response;
  try {
    response = await fetch(v1Url(path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: appConfig.apiBaseUrl ? "include" : "same-origin",
      // AbortSignal.timeout is missing on some older mobile browsers; they simply get no client-side timeout.
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) : undefined,
    });
  } catch {
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
