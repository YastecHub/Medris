import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Reads the request body as JSON the same way the original Vercel functions
 * did: an empty body counts as `{}`, and malformed JSON throws (which the
 * route turns into a 500 with the parser's message, as before).
 */
export async function readJsonBody<T = Record<string, unknown>>(c: Context): Promise<T> {
  const raw = await c.req.text();
  return JSON.parse(raw || "{}") as T;
}

export function json(c: Context, status: number, body: unknown): Response {
  return c.json(body as object, status as ContentfulStatusCode);
}

export function methodNotAllowed(c: Context, message = "Method not allowed"): Response {
  return json(c, 405, { error: message });
}

/** Origin of the incoming request, falling back to its host (as the original code did). */
export function requestOrigin(c: Context): string {
  return c.req.header("origin") || `https://${c.req.header("host") ?? ""}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "");
}
