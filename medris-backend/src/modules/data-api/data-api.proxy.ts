import http from "node:http";
import type { RequestHandler } from "express";

/** What the proxy needs from the running PostgREST (integrations/data-api/postgrest.ts). */
export interface DataApiUpstream {
  port: number;
  ready(): Promise<boolean>;
}

/** Headers that belong to one connection and must not be forwarded (RFC 9110 section 7.6.1). */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "cookie"]);
const JWT = /^Bearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/**
 * /rest/v1/*: the app's table queries (supabase-js sb.from()), passed to PostgREST unchanged - the body is streamed,
 * never parsed. An Authorization header that is not a user's access token (supabase-js sends the publishable key
 * there for signed-out visitors) is dropped, so the request runs as the anonymous role, as on Supabase.
 * Cookies are not forwarded.
 */
export function dataApiProxy(upstream: () => DataApiUpstream | null): RequestHandler {
  return (req, res) => {
    const up = upstream();
    if (!up) {
      res.status(503).json({ code: "PGRST000", details: null, hint: null, message: "The data API is not enabled on this deployment." });
      return;
    }
    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(name) && value !== undefined) headers[name] = value;
    if (typeof headers.authorization === "string" && !JWT.test(headers.authorization)) delete headers.authorization;
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
