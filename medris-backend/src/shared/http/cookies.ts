import { parse } from "cookie";
import type { Request } from "express";

/** One cookie from the request's Cookie header (undefined when absent). */
export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parse(header)[name];
}
