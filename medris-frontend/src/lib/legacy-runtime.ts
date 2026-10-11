import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Typed access to globals created by the legacy runtime (src/legacy).
 *
 * The legacy scripts declare `sb` (the one Supabase client, created from the
 * supabase-js CDN bundle) with top-level `const`, which lives in the shared
 * global scope rather than on `window`. React code must reuse that client:
 * a second client would run a second auth listener and token refresh.
 */

declare const sb: SupabaseClient | undefined;

export function getLegacySupabase(): SupabaseClient | null {
  return typeof sb === "undefined" ? null : sb;
}

export async function getAccessToken(): Promise<string | null> {
  const client = getLegacySupabase();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}
