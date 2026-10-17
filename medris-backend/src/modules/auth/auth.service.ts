import type { AppConfig } from "../../config/app-config.js";
import type { SessionInfo } from "../../contracts/v1.js";
import type { DataContext, Identity } from "../../database/context.js";
import { SupabaseAuthAdmin } from "../../integrations/supabase-auth.js";
import type { Logger } from "../../lib/logger.js";
import type { RateLimiter } from "../../lib/rate-limit.js";
import { AppError, badRequest, unauthenticated } from "../../shared/errors/app-error.js";
import type { AuthMethod } from "../../shared/types/http.js";
import { resolveGoogleAccount } from "./account-linking.js";
import type { GoogleSignIn } from "./google-oidc.js";
import { checkPassword, loginEmailFor } from "./password.service.js";
import type { SessionService } from "./session.service.js";

/** What the controller knows about the request that the rules need. */
export interface RequestMeta {
  userAgent?: string | null;
  ip?: string | null;
  logger: Logger;
}

export interface SignedIn {
  userId: string;
  /** The raw session token, for the cookie. Never logged or returned in a body. */
  token: string;
  expiresAt: string;
}

/** Only same-site relative paths, so the sign-in flow cannot be used as an open redirect. */
export function safeReturnPath(value: string | undefined): string {
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\0-\x1f]/.test(value)) return "/";
  return value;
}

type AuthAdmin = Pick<SupabaseAuthAdmin, "createUser">;

/**
 * Sign-in rules: password checks against the existing accounts, per-account
 * throttling, Google account linking and session lifetimes. The controller
 * only moves cookies and redirects.
 */
export class AuthService {
  constructor(
    private readonly deps: {
      config: AppConfig;
      data: () => DataContext;
      sessions: SessionService;
      google: GoogleSignIn | null;
      rateLimiter: RateLimiter;
      /** Creates first-time Google users; built only when needed. */
      authAdmin?: () => AuthAdmin;
    },
  ) {}

  sessionInfo(identity: Identity | null, method: AuthMethod): SessionInfo {
    return {
      authenticated: Boolean(identity),
      userId: identity?.userId ?? null,
      method,
      source: identity?.source ?? null,
      backendSessionsEnabled: this.deps.sessions.enabled,
    };
  }

  async login(input: { identifier: string; password: string }, meta: RequestMeta): Promise<SignedIn> {
    const { rateLimiter, sessions, data } = this.deps;
    // A second limit per account stops slow, distributed guessing against one user.
    const perAccount = await rateLimiter.consume(`auth-login-account:${loginEmailFor(input.identifier)}`, 20, 3_600_000);
    if (!perAccount.allowed) throw new AppError(429, "rate_limited", "Too many sign-in attempts for this account. Try again later.");

    const result = await checkPassword(data(), input.identifier, input.password);
    if (!result.ok) {
      meta.logger.warn("password sign-in refused", { reason: result.reason });
      if (result.reason === "banned") throw new AppError(403, "forbidden", "This account is blocked.");
      if (result.reason === "unconfirmed") throw new AppError(403, "forbidden", "Please confirm your e-mail address first.");
      throw unauthenticated("Incorrect e-mail/phone or password.");
    }
    const session = await sessions.create(result.userId, "password", { userAgent: meta.userAgent, ip: meta.ip });
    return { userId: result.userId, token: session.token, expiresAt: session.expiresAt };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.deps.sessions.revoke(token);
  }

  async logoutEverywhere(me: Identity): Promise<{ revoked: number }> {
    return { revoked: await this.deps.sessions.revokeAllForUser(me.userId) };
  }

  /** Begins Google sign-in: where to send the browser, and the state to keep in a short-lived cookie. */
  googleStart(returnTo: string | undefined): { url: string; flowCookie: string } {
    const flow = this.google().start();
    return { url: flow.url, flowCookie: JSON.stringify({ s: flow.state, v: flow.codeVerifier, r: safeReturnPath(returnTo) }) };
  }

  /** Completes Google sign-in: checks state, verifies the ID token, links the account, opens a session. */
  async googleFinish(input: { code: string; state: string }, flowCookie: string | undefined, meta: RequestMeta): Promise<SignedIn & { returnTo: string }> {
    let saved: { s?: string; v?: string; r?: string } = {};
    try {
      saved = JSON.parse(flowCookie ?? "{}");
    } catch {
      /* treated as missing */
    }
    if (!saved.s || !saved.v || saved.s !== input.state) throw badRequest("The sign-in link expired. Please try again.");

    let profile;
    try {
      profile = await this.google().finish(input.code, saved.v);
    } catch (err) {
      meta.logger.warn("google sign-in failed", { err });
      throw unauthenticated("Google sign-in did not complete. Please try again.");
    }
    // The admin client is only needed (and only built) for a first-time Google user.
    const authAdmin: AuthAdmin = { createUser: (user) => (this.deps.authAdmin?.() ?? SupabaseAuthAdmin.fromEnv()).createUser(user) };
    const account = await resolveGoogleAccount(this.deps.data(), authAdmin, profile);
    const session = await this.deps.sessions.create(account.userId, "google", { userAgent: meta.userAgent, ip: meta.ip });
    return { userId: account.userId, token: session.token, expiresAt: session.expiresAt, returnTo: safeReturnPath(saved.r) };
  }

  private google(): GoogleSignIn {
    if (!this.deps.google) throw new AppError(404, "feature_disabled", "Google sign-in through the backend is not enabled on this deployment.");
    return this.deps.google;
  }
}
