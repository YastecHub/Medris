import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { optionalEnv } from "../config/env.js";

/**
 * Shared-secret checks for scheduled jobs. As before, when CRON_SECRET is not
 * configured the check is skipped (see docs: set it in every environment).
 */

/** Exact `Authorization: Bearer <CRON_SECRET>` (GitHub Actions order-reminder trigger). */
export const requireBearerCronSecret: RequestHandler = (req, res, next) => {
  const expected = optionalEnv("CRON_SECRET");
  if (expected && !secretsMatch(req.get("authorization") ?? "", `Bearer ${expected}`)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

/** `Authorization: Bearer <secret>` (Vercel Cron) or `x-cron-secret: <secret>`. */
export const requireCronSecret: RequestHandler = (req, res, next) => {
  const expected = optionalEnv("CRON_SECRET");
  if (expected) {
    const supplied = req.get("authorization")?.replace(/^Bearer\s+/i, "") || req.get("x-cron-secret") || "";
    if (!secretsMatch(supplied, expected)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }
  next();
};

/** Constant-time string comparison for shared secrets. */
export function secretsMatch(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Requests from the database (pg_net) carry the shared webhook secret. */
export function hasWebhookSecret(headerValue: string | undefined, expected: string): boolean {
  return typeof headerValue === "string" && secretsMatch(headerValue, expected);
}
