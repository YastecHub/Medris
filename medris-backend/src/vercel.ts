import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./app.js";

/**
 * Vercel Node.js function handler. Each of the 12 files in the repository's
 * api/ folder re-exports this (the Hobby plan allows 12 functions), so every
 * file serves the whole API and routing happens inside Express.
 *
 * /api/v1/* has no file of its own: vercel.json rewrites it to
 * /api/notify?__route=/api/v1/<rest>. Depending on how Vercel presents a
 * rewritten request, req.url is either the original path or that destination;
 * `restoreRewrittenUrl` turns the destination form back into the original so
 * both cases route the same.
 */
export function restoreRewrittenUrl(url: string | undefined): string | undefined {
  if (!url || !url.includes("__route=")) return url;
  const parsed = new URL(url, "http://internal");
  const route = parsed.searchParams.get("__route");
  parsed.searchParams.delete("__route");
  if (!route || !/^\/api\/v1(\/|$)/.test(route) || route.includes("..") || route.includes("//")) {
    return `${parsed.pathname}${parsed.search}`;
  }
  return `${route}${parsed.search}`;
}

const app = createApp();

export default function vercelHandler(req: IncomingMessage, res: ServerResponse): void {
  req.url = restoreRewrittenUrl(req.url);
  app(req, res);
}
