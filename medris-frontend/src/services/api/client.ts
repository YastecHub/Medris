import { appConfig } from "@/config/env";
import { getAccessToken } from "@/lib/legacy-runtime";

/**
 * Centralised client for medris-backend. All endpoints live under /api on the
 * configured base URL (same origin by default). The API authenticates with
 * the Supabase access token sent in the JSON body as `accessToken`, which is
 * the existing contract of every endpoint.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  /** Adds the signed-in user's access token to the body. */
  authenticated?: boolean;
  signal?: AbortSignal;
}

export function apiUrl(path: string, query?: Record<string, string>): string {
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : "";
  return `${appConfig.apiBaseUrl}/api/${path.replace(/^\/+/, "")}${qs}`;
}

export async function apiRequest<TResponse>(path: string, options: ApiRequestOptions = {}): Promise<TResponse> {
  const method = options.method ?? (options.body ? "POST" : "GET");
  let body = options.body;
  if (options.authenticated) {
    const accessToken = await getAccessToken();
    if (!accessToken) throw new ApiError("Please log in to continue.", 401, null);
    body = { ...body, accessToken };
  }
  const response = await fetch(apiUrl(path, options.query), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: options.signal,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, data);
  }
  return data as TResponse;
}
