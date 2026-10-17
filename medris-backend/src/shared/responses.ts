import type { Request } from "express";

/** First address in X-Forwarded-For (set by Vercel), falling back to X-Real-IP. */
export function clientIp(req: Request): string {
  const forwarded = req.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.get("x-real-ip") || "unknown";
}
