import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, errors as joseErrors, jwtVerify, type JWTPayload } from "jose";
import type { Identity } from "../../database/context.js";

/**
 * Verifies the Supabase access tokens the app already has, inside the backend.
 *
 * Supabase Auth stays the identity provider during the transition, so every
 * signed-in user keeps their session. What changes is who checks the token:
 * instead of asking Supabase on every request (GET /auth/v1/user), the
 * backend verifies the JWT signature, expiry, issuer and audience itself:
 *
 *  - asymmetric signing keys (ES256/RS256, Supabase's current default): public
 *    keys from <SUPABASE_URL>/auth/v1/.well-known/jwks.json, cached;
 *  - the legacy shared secret (HS256): SUPABASE_JWT_SECRET;
 *  - an HS256 token with no secret configured: falls back to Supabase's
 *    /auth/v1/user endpoint (the previous behaviour), so nothing breaks while
 *    the secret is being added.
 *
 * Only `authenticated` user tokens are accepted; the public anon key (also a
 * JWT, role "anon") and service-role keys are rejected.
 */

export interface AccessTokenVerifier {
  /** The caller's identity, or null when the token is missing, invalid or expired. */
  verify(token: string): Promise<Identity | null>;
}

export interface SupabaseVerifierOptions {
  supabaseUrl?: string;
  anonKey?: string;
  jwtSecret?: string;
  issuer?: string;
  audience: string;
  /** Override for tests: a JWKS resolver instead of the remote one. */
  jwks?: Parameters<typeof jwtVerify>[1];
  fetch?: typeof fetch;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toIdentity(payload: JWTPayload): Identity | null {
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!UUID.test(sub)) return null;
  if (payload.role !== "authenticated") return null;
  return {
    userId: sub,
    email: typeof payload.email === "string" ? payload.email : null,
    claims: payload as Record<string, unknown>,
    source: "supabase-jwt",
    sessionId: typeof payload.session_id === "string" ? payload.session_id : undefined,
  };
}

export class SupabaseAccessTokenVerifier implements AccessTokenVerifier {
  private readonly secret?: Uint8Array;
  private jwks?: Parameters<typeof jwtVerify>[1];

  constructor(private readonly options: SupabaseVerifierOptions) {
    if (options.jwtSecret) this.secret = new TextEncoder().encode(options.jwtSecret);
    this.jwks = options.jwks;
  }

  async verify(token: string): Promise<Identity | null> {
    if (!token || token.split(".").length !== 3) return null;
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(token).alg;
    } catch {
      return null;
    }

    const verifyOptions = {
      issuer: this.options.issuer,
      audience: this.options.audience,
      clockTolerance: 5,
    };

    try {
      if (alg === "HS256") {
        if (this.secret) return toIdentity((await jwtVerify(token, this.secret, { ...verifyOptions, algorithms: ["HS256"] })).payload);
        return await this.verifyRemotely(token);
      }
      if (alg === "ES256" || alg === "RS256" || alg === "EdDSA") {
        const keys = this.keySet();
        if (!keys) return null;
        return toIdentity((await jwtVerify(token, keys, { ...verifyOptions, algorithms: ["ES256", "RS256", "EdDSA"] })).payload);
      }
      return null;
    } catch (err) {
      if (err instanceof joseErrors.JOSEError) return null;
      throw err;
    }
  }

  private keySet(): Parameters<typeof jwtVerify>[1] | undefined {
    if (this.jwks) return this.jwks;
    if (!this.options.supabaseUrl) return undefined;
    this.jwks = createRemoteJWKSet(new URL(`${this.options.supabaseUrl}/auth/v1/.well-known/jwks.json`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
    return this.jwks;
  }

  /** Previous behaviour: ask Supabase Auth whether the token is valid. */
  private async verifyRemotely(token: string): Promise<Identity | null> {
    const { supabaseUrl, anonKey } = this.options;
    if (!supabaseUrl || !anonKey) return null;
    const doFetch = this.options.fetch ?? fetch;
    const res = await doFetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const user = (await res.json().catch(() => null)) as { id?: string } | null;
    if (!user?.id) return null;
    // Supabase has just vouched for the token, so its (unverified) claims can be used as-is.
    const payload = decodeJwt(token);
    if (payload.sub !== user.id) return null;
    return toIdentity(payload);
  }
}
