import type { CookieOptions, Response } from "express";
import type { AppConfig } from "../../config/app-config.js";

/**
 * The browser session cookie: HttpOnly (no script access), Secure, SameSite=Lax
 * (sent on top-level navigations such as the Google redirect back, not on
 * cross-site sub-requests) and, when Secure, the `__Host-` prefix so it can
 * never be set by a sub-domain or for another path.
 */
export function sessionCookieName(config: AppConfig): string {
  return config.auth.cookieSecure ? `__Host-${config.auth.cookieName}` : config.auth.cookieName;
}

function base(config: AppConfig, path: string): CookieOptions {
  return { httpOnly: true, secure: config.auth.cookieSecure, sameSite: "lax", path };
}

export function setSessionCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(sessionCookieName(config), token, { ...base(config, "/"), maxAge: config.auth.sessionTtlDays * 24 * 60 * 60 * 1000 });
}

/** Expires the cookie (Max-Age=0). */
export function clearSessionCookie(res: Response, config: AppConfig): void {
  res.cookie(sessionCookieName(config), "", { ...base(config, "/"), maxAge: 0 });
}

/** Short-lived cookie holding the Google sign-in state and PKCE verifier (10 minutes). */
export const OAUTH_COOKIE = "medris_oauth";

export function setOAuthCookie(res: Response, config: AppConfig, value: string): void {
  res.cookie(OAUTH_COOKIE, value, { ...base(config, "/api/v1/auth"), maxAge: 600 * 1000 });
}

export function clearOAuthCookie(res: Response, config: AppConfig): void {
  res.cookie(OAUTH_COOKIE, "", { ...base(config, "/api/v1/auth"), maxAge: 0 });
}
