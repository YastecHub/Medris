import type { Request, Response } from "express";
import { readBodyText } from "../shared/http/body.js";

/**
 * Reads the request body as JSON the same way the original Vercel functions
 * did: an empty body counts as `{}`, and malformed JSON throws (which the
 * controller turns into a 500 with the parser's message, as before).
 */
export async function readJsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  const raw = await readBodyText(req);
  return JSON.parse(raw || "{}") as T;
}

export function json(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function methodNotAllowed(res: Response, message = "Method not allowed"): void {
  json(res, 405, { error: message });
}

/** Origin of the incoming request, falling back to its host (as the original code did). */
export function requestOrigin(req: Request): string {
  return req.get("origin") || `https://${req.get("host") ?? ""}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "");
}
