import { Google, generateCodeVerifier, generateState } from "arctic";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppConfig } from "../../config/app-config.js";

/**
 * "Sign in with Google" run by the backend (OpenID Connect, authorization-code
 * flow with PKCE), for use with backend sessions.
 *
 * - arctic builds the authorization URL and exchanges the code (PKCE S256,
 *   random state checked on return);
 * - the ID token is verified with jose against Google's published keys
 *   (issuer, audience = our client id, expiry), even though it arrives
 *   directly from Google's token endpoint.
 *
 * Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI (a Google
 * Cloud OAuth client whose redirect URI is <origin>/api/v1/auth/google/callback).
 * Supabase's own Google sign-in keeps working in parallel; it is configured in
 * the Supabase dashboard and is not touched by this code.
 */

export interface GoogleProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface GoogleSignIn {
  start(): { url: string; state: string; codeVerifier: string };
  finish(code: string, codeVerifier: string): Promise<GoogleProfile>;
}

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export interface GoogleSignInDeps {
  exchange?: (code: string, codeVerifier: string) => Promise<string>;
  jwks?: Parameters<typeof jwtVerify>[1];
}

export function createGoogleSignIn(config: AppConfig, deps: GoogleSignInDeps = {}): GoogleSignIn | null {
  const google = config.auth.google;
  if (!google) return null;
  const client = new Google(google.clientId, google.clientSecret, google.redirectUri);
  const jwks = deps.jwks ?? createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  const exchange =
    deps.exchange ??
    (async (code: string, codeVerifier: string) => (await client.validateAuthorizationCode(code, codeVerifier)).idToken());

  return {
    start() {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const url = client.createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]);
      url.searchParams.set("prompt", "select_account");
      return { url: url.toString(), state, codeVerifier };
    },

    async finish(code, codeVerifier) {
      const idToken = await exchange(code, codeVerifier);
      const { payload } = await jwtVerify(idToken, jwks, { issuer: GOOGLE_ISSUERS, audience: google.clientId, clockTolerance: 5 });
      if (typeof payload.sub !== "string" || !payload.sub) throw new Error("Google did not return an account id.");
      return {
        sub: payload.sub,
        email: typeof payload.email === "string" ? payload.email.toLowerCase() : null,
        emailVerified: payload.email_verified === true,
        name: typeof payload.name === "string" ? payload.name : null,
        picture: typeof payload.picture === "string" ? payload.picture : null,
      };
    },
  };
}
