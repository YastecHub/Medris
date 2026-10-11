import { defineRoute } from "../../shared/http/route.js";
import type { RequestHandler } from "express";
import { requireUser } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { featureDisabled } from "../../shared/errors/app-error.js";
import { commonErrors, dataResponse, errorResponses, jsonBody } from "../../shared/openapi/schemas.js";
import { optionalSignIn, signedIn } from "../../shared/openapi/security.js";
import { GoogleCallbackQuery, GoogleStartQuery, LoginBody, LoginResult, LogoutAllResult, SessionInfoSchema } from "./auth.schemas.js";

/**
 * Authentication endpoints. `GET /auth/session` is always available; the rest
 * need AUTH_BACKEND_SESSIONS=true (off in production until approved) and
 * otherwise answer 404 `feature_disabled`.
 */

const tags = ["Auth"];

const backendSessionsOn: RequestHandler = (_req, res, next) => {
  if (!res.locals.services.sessions.enabled) throw featureDisabled("Backend sign-in");
  next();
};

const googleSignInOn: RequestHandler = (_req, res, next) => {
  if (!res.locals.services.sessions.enabled || !res.locals.services.google) throw featureDisabled("Google sign-in through the backend");
  next();
};

const disabledNote = "Needs AUTH_BACKEND_SESSIONS=true; otherwise 404 `feature_disabled`.";

export const getSession = defineRoute({
  method: "get",
  path: "/auth/session",
  tags,
  summary: "Who the backend thinks you are",
  security: optionalSignIn,
  responses: { 200: dataResponse(SessionInfoSchema, "The caller's identity, if any."), ...errorResponses(401) },
});

export const login = defineRoute({
  method: "post",
  path: "/auth/login",
  tags,
  summary: "Sign in with e-mail/phone and password",
  description: `Checks the existing Supabase Auth password (bcrypt) and sets the session cookie. Rate-limited per IP and per account. ${disabledNote}`,
  security: [],
  middleware: [
    backendSessionsOn,
    rateLimit({ name: "auth-login-ip", limit: 10, windowMs: 60_000 }),
    rateLimit({ name: "auth-login-ip-hour", limit: 60, windowMs: 3_600_000 }),
  ] as const,
  request: { body: jsonBody(LoginBody) },
  responses: {
    200: {
      ...dataResponse(LoginResult, "Signed in; the session cookie is set."),
      headers: { "Set-Cookie": { description: "The HttpOnly session cookie.", schema: { type: "string" } } },
    },
    ...errorResponses(400, 401, 403, 404, 415, 429),
    ...commonErrors,
  },
});

export const logout = defineRoute({
  method: "post",
  path: "/auth/logout",
  tags,
  summary: "Sign this browser out",
  description: `Revokes the session in the cookie and clears it. ${disabledNote}`,
  security: optionalSignIn,
  middleware: [backendSessionsOn] as const,
  responses: { 204: { description: "Signed out." }, ...errorResponses(403, 404), ...commonErrors },
});

export const logoutAll = defineRoute({
  method: "post",
  path: "/auth/logout-all",
  tags,
  summary: "Sign out everywhere",
  description: `Revokes every backend session of the account. ${disabledNote}`,
  security: signedIn,
  middleware: [requireUser, backendSessionsOn] as const,
  responses: { 200: dataResponse(LogoutAllResult, "Number of sessions revoked."), ...errorResponses(401, 403, 404), ...commonErrors },
});

export const googleStart = defineRoute({
  method: "get",
  path: "/auth/google/start",
  tags,
  summary: "Start Google sign-in",
  description: `Redirects to Google (OpenID Connect with PKCE). ${disabledNote} Also needs GOOGLE_* settings.`,
  security: [],
  middleware: [googleSignInOn, rateLimit({ name: "auth-google-start", limit: 30, windowMs: 60_000 })] as const,
  request: { query: GoogleStartQuery },
  responses: { 302: { description: "To Google's consent screen." }, ...errorResponses(400, 404, 429) },
});

export const googleCallback = defineRoute({
  method: "get",
  path: "/auth/google/callback",
  tags,
  summary: "Google sign-in return",
  description: "Google redirects here. Verifies state and the ID token, links the account, sets the session cookie and redirects to `returnTo`.",
  security: [],
  middleware: [googleSignInOn, rateLimit({ name: "auth-google-callback", limit: 30, windowMs: 60_000 })] as const,
  request: { query: GoogleCallbackQuery },
  responses: { 302: { description: "Back into the app." }, ...errorResponses(400, 401, 403, 404, 429), ...commonErrors },
});
