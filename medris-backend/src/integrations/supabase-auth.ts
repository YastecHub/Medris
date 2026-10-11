import { requireEnv } from "../config/env.js";

/**
 * Supabase Auth admin API - the identity provider during the transition.
 *
 * Isolated here so the rest of the backend never builds Supabase URLs. These
 * calls create, look up and delete login accounts in auth.users; they are the
 * remaining Supabase Auth dependency of the backend (see docs/AUTH.md for the
 * plan to replace them).
 */

export interface AuthUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface CreateAuthUser {
  email: string;
  password?: string;
  email_confirm?: boolean;
  user_metadata?: Record<string, unknown>;
}

export class SupabaseAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SupabaseAuthError";
  }
}

export class SupabaseAuthAdmin {
  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly doFetch: typeof fetch = (...args) => fetch(...args),
  ) {}

  static fromEnv(): SupabaseAuthAdmin {
    return new SupabaseAuthAdmin(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
  }

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    return this.doFetch(`${this.url}/auth/v1/admin/${path}`, {
      ...init,
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  }

  /** Finds a login account by e-mail (case-insensitive), paging the admin list like the original code. */
  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const target = email.trim().toLowerCase();
    if (!target) return null;
    for (let page = 1; page <= 20; page++) {
      const response = await this.request(`users?page=${page}&per_page=1000`, { method: "GET" });
      if (!response.ok) return null;
      const data = (await response.json().catch(() => ({}))) as { users?: AuthUser[] } | AuthUser[];
      const list = Array.isArray(data) ? data : data.users || [];
      const match = list.find((user) => String(user?.email || "").trim().toLowerCase() === target);
      if (match) return match;
      if (list.length < 1000) break;
    }
    return null;
  }

  /** Creates a login account. Throws SupabaseAuthError with Supabase's message on failure. */
  async createUser(input: CreateAuthUser): Promise<AuthUser> {
    const response = await this.request("users", { method: "POST", body: JSON.stringify(input) });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || !body?.id) {
      const message = String(body?.msg || body?.message || body?.error_description || "Could not create the account.");
      throw new SupabaseAuthError(message, response.status || 400);
    }
    return body as AuthUser;
  }

  /** Sets a user's password (admin API; avoids the client-side "must differ" misfire for OAuth-only accounts). */
  async setPassword(userId: string, password: string): Promise<{ ok: boolean; message?: string }> {
    const response = await this.request(`users/${encodeURIComponent(userId)}`, { method: "PUT", body: JSON.stringify({ password }) });
    const body = (await response.json().catch(() => ({}))) as Record<string, string | undefined>;
    return response.ok ? { ok: true } : { ok: false, message: body.msg || body.error_description || body.message };
  }

  /** Hard-deletes a login account (cascades its sessions and refresh tokens). */
  async deleteUser(userId: string): Promise<{ ok: boolean; detail: string }> {
    const response = await this.request(`users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    return { ok: response.ok, detail: response.ok ? "" : await response.text().catch(() => "") };
  }
}

/**
 * The Supabase Auth user for an access token (GET /auth/v1/user). Only used
 * where the endpoint needs the user's Auth metadata (profile repair); identity
 * checks use the locally verified token (modules/auth/access-token.ts).
 */
export async function fetchAuthUser(accessToken: string): Promise<{ ok: boolean; status: number; user: AuthUser | null }> {
  const url = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` } });
  const body = (await res.json().catch(() => null)) as AuthUser | null;
  return { ok: res.ok, status: res.status, user: res.ok && body?.id ? body : null };
}
