import type { RequestHandler, Response } from "express";

/**
 * The request timeout (REQUEST_TIMEOUT_MS) for /api/v1: if nothing was sent
 * in time, `onTimeout` answers (504 `request_timeout`). The work keeps running
 * and its database transaction still commits or rolls back on its own; only
 * the late response is dropped.
 */
export function requestTimeout(ms: number, onTimeout: (res: Response) => void): RequestHandler {
  return (_req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) onTimeout(res);
    }, ms);
    timer.unref();
    const clear = () => clearTimeout(timer);
    res.on("finish", clear);
    res.on("close", clear);
    next();
  };
}
