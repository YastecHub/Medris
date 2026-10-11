import { createMiddleware } from "hono/factory";
import { optionalEnv } from "../config/env.js";

/**
 * Shared-secret checks for scheduled jobs. As before, when CRON_SECRET is not
 * configured the check is skipped (see docs: set it in every environment).
 */

/** Exact `Authorization: Bearer <CRON_SECRET>` (GitHub Actions order-reminder trigger). */
export const requireBearerCronSecret = createMiddleware(async (c, next) => {
  const expected = optionalEnv("CRON_SECRET");
  if (expected && c.req.header("authorization") !== `Bearer ${expected}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** `Authorization: Bearer <secret>` (Vercel Cron) or `x-cron-secret: <secret>`. */
export const requireCronSecret = createMiddleware(async (c, next) => {
  const expected = optionalEnv("CRON_SECRET");
  if (expected) {
    const supplied = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || c.req.header("x-cron-secret") || "";
    if (supplied !== expected) return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** Requests from the database (pg_net) carry the shared webhook secret. */
export function hasWebhookSecret(headerValue: string | undefined, expected: string): boolean {
  return headerValue === expected;
}
