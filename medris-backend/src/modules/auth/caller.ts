import { loadConfig } from "../../config/app-config.js";
import type { Identity } from "../../database/context.js";
import { SupabaseAccessTokenVerifier, type AccessTokenVerifier } from "./access-token.js";

/**
 * Identity for the original endpoints, which receive the Supabase access
 * token in the JSON body (`accessToken`). The token is verified locally by
 * the same verifier /api/v1 uses (createApp installs it); before, each
 * endpoint asked Supabase's /auth/v1/user.
 */
let verifier: AccessTokenVerifier | null = null;

export function setAccessTokenVerifier(next: AccessTokenVerifier | null): void {
  verifier = next;
}

function current(): AccessTokenVerifier {
  if (!verifier) {
    const config = loadConfig();
    verifier = new SupabaseAccessTokenVerifier({
      supabaseUrl: config.supabase.url,
      anonKey: config.supabase.anonKey,
      jwtSecret: config.supabase.jwtSecret,
      issuer: config.supabase.jwtIssuer,
      audience: config.supabase.jwtAudience,
    });
  }
  return verifier;
}

export async function identityFromAccessToken(token: unknown): Promise<Identity | null> {
  if (typeof token !== "string" || !token) return null;
  return current().verify(token);
}
