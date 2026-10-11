import type { RequestHandler } from "express";
import type { AppServices } from "../container.js";

const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * First middleware for every request: assigns a request id (reusing a sane
 * incoming X-Request-Id, echoed in the response header), exposes the services
 * and a request-scoped logger in `res.locals`, and writes one access-log line
 * per request with status and duration. Query strings are not logged (they
 * can carry tokens on older endpoints).
 */
export function requestContext(services: AppServices): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get("x-request-id");
    const requestId = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
    const logger = services.logger.child({ requestId });
    Object.assign(res.locals, { requestId, logger, services, identity: null, authMethod: null });
    res.setHeader("X-Request-Id", requestId);

    const started = performance.now();
    // Captured now: routers strip their mount path from req.path while they handle the request.
    const path = req.path;
    res.on("finish", () => {
      const fields = {
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
        userId: res.locals.identity?.userId,
      };
      if (res.statusCode >= 500) logger.error("request failed", fields);
      else if (!path.includes("/health")) logger.info("request", fields);
    });
    next();
  };
}
