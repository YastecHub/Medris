import { controller, json } from "../../shared/http/route.js";
import * as routes from "./health.routes.js";

/** /api/v1/health - see health.routes.ts. Bodies are not wrapped, so probes can read them directly. */
export const healthController = controller()
  .route(routes.live, ({ services }) => json(services.health.live()))
  .route(routes.ready, async ({ services, logger }) => {
    const readiness = await services.health.ready(logger);
    return json(readiness, readiness.status === "ok" ? 200 : 503);
  });
