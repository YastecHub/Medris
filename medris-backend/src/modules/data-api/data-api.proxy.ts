import http from "node:http";
import type { RequestHandler, Response } from "express";
import type { ResponseCache } from "../../lib/response-cache.js";

/** What the proxy needs from the running PostgREST (integrations/data-api/postgrest.ts). */
export interface DataApiUpstream {
  port: number;
  ready(): Promise<boolean>;
}

/** Headers that belong to one connection and must not be forwarded (RFC 9110 section 7.6.1). */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "cookie"]);
const JWT = /^Bearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/** Signed-out reads are the same for every visitor: kept this long (row-level security as anon decides what they see). */
const PUBLIC_TTL_MS = 30_000;
const MAX_CACHED_BODY = 512 * 1024;
/** The request headers that change PostgREST's answer, so they are part of the cache key. */
const VARY = ["accept", "prefer", "range", "range-unit", "accept-profile"];

interface Cached {
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

/**
 * /rest/v1/*: the app's table queries (supabase-js sb.from()), passed to PostgREST unchanged - the body is streamed,
 * never parsed. An Authorization header that is not a user's access token (supabase-js sends the publishable key
 * there for signed-out visitors) is dropped, so the request runs as the anonymous role, as on Supabase.
 * Cookies are not forwarded.
 */
export function dataApiProxy(upstream: () => DataApiUpstream | null, cache: () => ResponseCache | null = () => null): RequestHandler {
  return (req, res) => {
    const up = upstream();
    if (!up) {
      res.status(503).json({ code: "PGRST000", details: null, hint: null, message: "The data API is not enabled on this deployment." });
      return;
    }
    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(name) && value !== undefined) headers[name] = value;
    if (typeof headers.authorization === "string" && !JWT.test(headers.authorization)) delete headers.authorization;

    // A signed-out read (no user token) is the same for everyone: answer it from memory for a few seconds.
    const store = cache();
    if (store && (req.method === "GET" || req.method === "HEAD") && headers.authorization === undefined) {
      const key = `rest|${req.method}|${req.url}|${VARY.map((h) => String(req.headers[h] ?? "")).join("|")}`;
      store
        .getOrLoad<Cached>(key, PUBLIC_TTL_MS, () => fetchBuffered(up.port, req.method!, req.url, headers), (v) => v.body.length + 512, (v) => (v.status === 200 || v.status === 206) && v.body.length <= MAX_CACHED_BODY)
        .then(({ value, hit }) => send(res, value, hit))
        .catch(() => {
          if (!res.headersSent) res.status(503).json({ code: "PGRST000", details: null, hint: null, message: "The data API is starting. Please try again." });
        });
      return;
    }

    const forward = http.request({ host: "127.0.0.1", port: up.port, method: req.method, path: req.url, headers }, (answer) => {
      res.status(answer.statusCode ?? 502);
      for (const [name, value] of Object.entries(answer.headers)) if (!HOP_BY_HOP.has(name) && value !== undefined) res.setHeader(name, value);
      answer.pipe(res);
    });
    forward.on("error", () => {
      if (!res.headersSent) res.status(503).json({ code: "PGRST000", details: null, hint: null, message: "The data API is starting. Please try again." });
      else res.end();
    });
    req.pipe(forward);
  };
}

/** One upstream request, read completely (for answers that may be cached). */
function fetchBuffered(port: number, method: string, path: string, headers: http.OutgoingHttpHeaders): Promise<Cached> {
  return new Promise((resolve, reject) => {
    const forward = http.request({ host: "127.0.0.1", port, method, path, headers }, (answer) => {
      const chunks: Buffer[] = [];
      answer.on("data", (c: Buffer) => chunks.push(c));
      answer.on("end", () => {
        const kept: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(answer.headers)) if (!HOP_BY_HOP.has(name) && name !== "set-cookie" && name !== "date" && value !== undefined) kept[name] = value;
        resolve({ status: answer.statusCode ?? 502, headers: kept, body: Buffer.concat(chunks) });
      });
      answer.on("error", reject);
    });
    forward.on("error", reject);
    forward.end();
  });
}

function send(res: Response, c: Cached, hit: boolean): void {
  if (res.headersSent) return;
  res.status(c.status);
  for (const [name, value] of Object.entries(c.headers)) res.setHeader(name, value);
  res.setHeader("X-Levro-Cache", hit ? "hit" : "miss");
  res.end(c.body);
}
