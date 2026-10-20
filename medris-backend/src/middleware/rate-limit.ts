import type { Request, RequestHandler, Response } from "express";
import { rateLimited } from "../shared/errors/app-error.js";
import { clientIp } from "../shared/responses.js";

export interface RateLimitRule {
  /** Groups counters (e.g. "auth-login"). */
  name: string;
  limit: number;
  windowMs: number;
  /** Defaults to the signed-in user's id, else the client IP. */
  key?: (req: Request, res: Response) => string;
}

export function rateLimit(rule: RateLimitRule): RequestHandler {
  return async (req, res, next) => {
    await consumeRateLimit(rule, req, res);
    next();
  };
}

/** Counts one request against the rule; throws 429 (with Retry-After) when the window is used up. */
export async function consumeRateLimit(rule: RateLimitRule, req: Request, res: Response): Promise<void> {
  const { services, identity } = res.locals;
  if (!services.config.rateLimit.enabled) return;
  const subject = rule.key ? rule.key(req, res) : identity ? `user:${identity.userId}` : `ip:${clientIp(req)}`;
  const result = await services.rateLimiter.consume(`${rule.name}:${subject}`, rule.limit, rule.windowMs);
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    throw rateLimited(retryAfter);
  }
}
