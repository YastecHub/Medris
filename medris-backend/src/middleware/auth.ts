import type { Request, RequestHandler, Response } from "express";
import { forbidden, unauthenticated } from "../shared/errors/app-error.js";
import { getCookie } from "../shared/http/cookies.js";
import { sessionCookieName } from "../modules/auth/session-cookie.js";

/**
 * Who is calling?
 *
 *  1. `Authorization: Bearer <Supabase access token>` - what the app sends today.
 *  2. The backend session cookie - only when AUTH_BACKEND_SESSIONS is on.
 *
 * A bearer token that is present but invalid is rejected outright (401) rather
 * than treated as anonymous, so an expired session never silently degrades
 * into a signed-out view of private data.
 */
export const authenticate: RequestHandler = async (req, res, next) => {
  const services = res.locals.services;
  const header = req.get("authorization");
  if (header && /^Bearer\s+/i.test(header)) {
    const identity = await services.accessTokens.verify(header.replace(/^Bearer\s+/i, "").trim());
    if (!identity) throw unauthenticated("Invalid or expired session. Please log in again.");
    res.locals.identity = identity;
    res.locals.authMethod = "bearer";
  } else if (services.sessions.enabled) {
    const token = getCookie(req, sessionCookieName(services.config));
    if (token) {
      const identity = await services.sessions.resolve(token);
      if (identity) {
        res.locals.identity = identity;
        res.locals.authMethod = "cookie";
      }
    }
  }
  next();
};

export const requireUser: RequestHandler = (_req, res, next) => {
  if (!res.locals.identity) throw unauthenticated();
  next();
};

/** The caller's role from public.users (read through RLS as the caller). */
export function callerRole(res: Response): Promise<string | null> {
  return res.locals.services.users.roleOf(res.locals.identity);
}

/** Role-based access for endpoints that are not covered by row-level security alone. */
export function requireRole(...roles: string[]): RequestHandler {
  return async (_req, res, next) => {
    if (!res.locals.identity) throw unauthenticated();
    const role = await callerRole(res);
    if (!role || !roles.includes(role)) throw forbidden();
    next();
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The origin this request was addressed to (behind Vercel: from X-Forwarded-Proto/Host). */
export function selfOrigin(req: Request): string {
  return `${req.protocol}://${req.get("host") ?? ""}`;
}

/**
 * CSRF protection for cookie-authenticated requests: a state-changing request
 * that relies on the session cookie must come from a trusted origin (the app
 * itself or AUTH_TRUSTED_ORIGINS). Bearer-token requests cannot be forged
 * cross-site and are not affected.
 */
export const csrfProtection: RequestHandler = (req, res, next) => {
  if (res.locals.authMethod === "cookie" && !SAFE_METHODS.has(req.method)) {
    const referer = req.get("referer");
    let origin = req.get("origin") ?? "";
    if (!origin && referer) {
      try {
        origin = new URL(referer).origin;
      } catch {
        origin = "";
      }
    }
    const trusted = new Set([selfOrigin(req), ...res.locals.services.config.auth.trustedOrigins]);
    if (!origin || !trusted.has(origin.replace(/\/$/, ""))) throw forbidden("This request was blocked because it did not come from the app.");
  }
  next();
};
