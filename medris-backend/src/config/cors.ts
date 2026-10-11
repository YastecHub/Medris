import cors from "cors";
import type { RequestHandler } from "express";
import type { AppConfig } from "./app-config.js";

/**
 * Cross-origin policy.
 *
 * In production the app and the API share one origin, so no CORS headers are
 * needed and none are sent. A separately hosted frontend (a preview domain, a
 * native shell, local development against a remote API) is allowed by listing
 * its exact origin in CORS_ALLOWED_ORIGINS. Wildcards are never used, and
 * credentials (the backend session cookie) are only accepted from listed
 * origins.
 */
export function corsMiddleware(config: AppConfig): RequestHandler | null {
  const allowed = new Set(config.cors.allowedOrigins);
  if (!allowed.size) return null;
  return cors({
    origin: (origin, callback) => callback(null, origin && allowed.has(origin.replace(/\/$/, "")) ? origin : false),
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-cron-secret", "X-Request-Id", "X-Requested-With"],
    exposedHeaders: ["X-Request-Id", "Retry-After"],
    credentials: true,
    maxAge: 600,
  });
}
