import { requireEnv } from "../config/env.js";

/**
 * Thin, dependency-free access to the existing Supabase project over its REST
 * (PostgREST), Auth and Storage HTTP APIs - the same calls the original API
 * functions made, gathered in one place.
 *
 * Two kinds of access exist on purpose:
 *  - `SupabaseAdmin` uses the service-role key and bypasses Row Level
 *    Security. Use it only after the caller has been authorised in code.
 *  - `asUser(accessToken)` forwards the signed-in user's own token with the
 *    public anon key, so Postgres RLS and SECURITY DEFINER checks
 *    (`auth.uid()`) still decide what the user may do.
 */

export interface AuthUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export class SupabaseAdmin {
  constructor(
    readonly url: string,
    private readonly serviceKey: string,
  ) {}

  static fromEnv(): SupabaseAdmin {
    return new SupabaseAdmin(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
  }

  /** Raw service key, needed only for HMAC tokens derived from it (call decline links). */
  get key(): string {
    return this.serviceKey;
  }

  get authHeaders(): Record<string, string> {
    return { apikey: this.serviceKey, Authorization: `Bearer ${this.serviceKey}` };
  }

  jsonHeaders(prefer?: string): Record<string, string> {
    return { ...this.authHeaders, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) };
  }

  /** fetch() against `/rest/v1/<path>` with service-role headers merged in. */
  rest(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers: { ...this.authHeaders, ...(init.headers as Record<string, string> | undefined) },
    });
  }

  /** GET rows and parse them. Like the original code, the response status is not checked. */
  async select<T>(path: string): Promise<T[]> {
    const res = await this.rest(path);
    return (await res.json()) as T[];
  }

  async first<T>(path: string): Promise<T | undefined> {
    const [row] = await this.select<T>(path);
    return row;
  }

  patch(path: string, body: unknown, prefer = "return=minimal"): Promise<Response> {
    return this.rest(path, { method: "PATCH", headers: this.jsonHeaders(prefer), body: JSON.stringify(body) });
  }

  insert(path: string, body: unknown, prefer = "return=minimal"): Promise<Response> {
    return this.rest(path, { method: "POST", headers: this.jsonHeaders(prefer), body: JSON.stringify(body) });
  }

  delete(path: string, prefer?: string): Promise<Response> {
    return this.rest(path, { method: "DELETE", headers: prefer ? { Prefer: prefer } : {} });
  }

  rpc(name: string, args: unknown = {}): Promise<Response> {
    return this.rest(`rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof args === "string" ? args : JSON.stringify(args),
    });
  }

  /** Supabase Auth admin API (`/auth/v1/admin/...`). */
  authAdmin(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.url}/auth/v1/admin/${path}`, {
      ...init,
      headers: { ...this.jsonHeaders(), ...(init.headers as Record<string, string> | undefined) },
    });
  }

  /** Supabase Storage API (`/storage/v1/...`). */
  storage(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.url}/storage/v1/${path}`, {
      ...init,
      headers: { ...this.jsonHeaders(), ...(init.headers as Record<string, string> | undefined) },
    });
  }
}

/** Requests made with the caller's own JWT, so RLS applies. */
export class SupabaseUserClient {
  constructor(
    readonly url: string,
    private readonly anonKey: string,
    private readonly accessToken: string,
  ) {}

  static fromEnv(accessToken: string): SupabaseUserClient {
    return new SupabaseUserClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), accessToken);
  }

  private get headers(): Record<string, string> {
    return { apikey: this.anonKey, Authorization: `Bearer ${this.accessToken}` };
  }

  rest(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) },
    });
  }

  rpc(name: string, args: unknown): Promise<Response> {
    return this.rest(`rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  }
}

export interface UserLookup {
  ok: boolean;
  status: number;
  user: AuthUser | null;
}

/**
 * Resolves an access token to its Supabase Auth user (`GET /auth/v1/user`).
 * `apikey` defaults to the anon key, as almost every original endpoint did.
 * Like the original code, a non-JSON response body throws.
 */
export async function lookupUser(accessToken: string, apikey: "anon" | "service" = "anon"): Promise<UserLookup> {
  const url = requireEnv("SUPABASE_URL");
  const key = apikey === "anon" ? requireEnv("SUPABASE_ANON_KEY") : requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json()) as AuthUser | null;
  return { ok: res.ok, status: res.status, user: res.ok && body?.id ? body : null };
}

/** Same as `lookupUser`, but never throws on a non-JSON body; returns null instead. */
export async function lookupUserSafe(accessToken: string): Promise<AuthUser | null> {
  const url = requireEnv("SUPABASE_URL");
  const anon = requireEnv("SUPABASE_ANON_KEY");
  if (!accessToken) return null;
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as AuthUser | null;
  return body?.id ? body : null;
}
