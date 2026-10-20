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
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    // The second line: what supabase-js sends to the data API (/rest/v1), as Supabase's own API allows.
    allowedHeaders: [
      ...["Content-Type", "Authorization", "x-cron-secret", "X-Request-Id", "X-Requested-With"],
      ...["apikey", "x-client-info", "Prefer", "Range", "Range-Unit", "Accept-Profile", "Content-Profile", "x-supabase-api-version", "Accept"],
    ],
    exposedHeaders: ["X-Request-Id", "Retry-After", "Content-Range", "Range", "Preference-Applied", "Content-Profile", "Content-Location", "Location"],
    credentials: true,
    maxAge: 600,
  });
}
