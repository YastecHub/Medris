import { Router } from "express";
import helmet from "helmet";
import type { AppServices } from "../container.js";
import { authenticate, csrfProtection } from "../middleware/auth.js";
import { jsonBodyGuard } from "../middleware/json-body.js";
import { requestTimeout } from "../middleware/timeout.js";
import { authController } from "../modules/auth/auth.controller.js";
import { cartController } from "../modules/cart/cart.controller.js";
import { catalogueController } from "../modules/catalogue/catalogue.controller.js";
import { favoritesController } from "../modules/favorites/favorites.controller.js";
import { followsController } from "../modules/follows/follows.controller.js";
import { healthController } from "../modules/health/health.controller.js";
import { notificationsController } from "../modules/notifications/notifications.controller.js";
import { usersController } from "../modules/users/users.controller.js";
import { AppError } from "../shared/errors/app-error.js";
import { v1ErrorResponse } from "../shared/errors/handler.js";
import type { RouteDefinition } from "../shared/http/route.js";

/** Every /api/v1 controller, in mounting order. Health comes first so probes never need a token. */
const publicControllers = [healthController];
const controllers = [authController, usersController, catalogueController, cartController, favoritesController, followsController, notificationsController];

/** Route definitions of /api/v1 (paths relative to /api/v1), for the OpenAPI document. */
export const v1Definitions: RouteDefinition[] = [...publicControllers, ...controllers].flatMap((c) => c.definitions);

/** Security headers for API responses (no CSP: they are JSON, not pages). */
export const apiSecurityHeaders = helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false, crossOriginOpenerPolicy: false });

/**
 * /api/v1: the backend's own API (validated input, consistent JSON envelopes,
 * authorisation in code + RLS in the database). Mounted under /api/v1 by
 * createApp(); every route here is relative to that prefix.
 *
 * Each module is a controller (HTTP) -> service (rules) -> repository (SQL);
 * the route definitions double as the OpenAPI document (/api/v1/docs).
 *
 * Order: security headers and the request timeout apply to everything;
 * health checks come before authentication so a probe never needs a token.
 */
export function v1Router(services: AppServices): Router {
  const v1 = Router();
  v1.use(apiSecurityHeaders);
  v1.use(
    requestTimeout(services.config.requestTimeoutMs, (res) =>
      v1ErrorResponse(res.req, res, new AppError(504, "request_timeout", "The request took too long. Please try again."), res.locals.logger),
    ),
  );
  for (const c of publicControllers) v1.use(c.router);
  v1.use(authenticate);
  v1.use(csrfProtection);
  v1.use(jsonBodyGuard);
  for (const c of controllers) v1.use(c.router);
  return v1;
}
