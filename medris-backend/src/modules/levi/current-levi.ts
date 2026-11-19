import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";

/**
 * Levi's current brain lives in api/chat.js (the file the app's Levi has always been developed in). Since the site no
 * longer runs on Vercel, this server runs that same file for POST /api/chat, so Levi is exactly the one the team keeps
 * improving. The TypeScript port in this folder (levi.service.ts) stays as the fallback and for the tests.
 *
 * The file uses Vercel's handler shape - (req, res) with res.status().json() - which Express's req/res already provide,
 * and reads the request body itself, so the route must not parse it first.
 */

type Handler = (req: Request, res: Response) => Promise<void> | void;

function findChatFile(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.LEVI_CHAT_FILE,
    path.resolve(here, "..", "..", "..", "..", "api", "chat.js"), // medris-backend/{src,dist}/modules/levi -> repository root
    path.resolve(process.cwd(), "api", "chat.js"),
    path.resolve(process.cwd(), "..", "api", "chat.js"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

let cached: Handler | null | undefined;

/** The api/chat.js handler, or null when this deployment does not have the file (or in tests). */
export function currentLevi(): Handler | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (process.env.NODE_ENV === "test" || process.env.LEVI_SOURCE === "backend") return cached;
  const file = findChatFile();
  if (!file) return cached;
  try {
    const handler = createRequire(file)(file) as unknown;
    cached = typeof handler === "function" ? (handler as Handler) : null;
    if (cached) console.log(JSON.stringify({ level: "info", msg: "Levi: answering with api/chat.js", file }));
  } catch (err) {
    console.error("[Levromart] could not load api/chat.js; using the backend's Levi", err);
    cached = null;
  }
  return cached;
}
