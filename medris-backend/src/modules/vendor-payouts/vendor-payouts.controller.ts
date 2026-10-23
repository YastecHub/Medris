import { controller, ok } from "../../shared/http/route.js";
import * as routes from "./vendor-payouts.routes.js";

/** Vendor payouts - see vendor-payouts.routes.ts. */
export const vendorPayoutsController = controller()
  .route(routes.myPayouts, async ({ services, user, input }) => ok(await services.vendorPayouts.mine(user(), input.query)))
  .route(routes.adminPayouts, async ({ services, user, input }) => ok(await services.vendorPayouts.list(user(), input.query)))
  .route(routes.releasePayout, async ({ services, user, input }) => ok(await services.vendorPayouts.release(user(), input.params.id)))
  .route(routes.holdPayout, async ({ services, user, input }) => ok(await services.vendorPayouts.hold(user(), input.params.id, input.body.reason)))
  .route(routes.markPayoutManual, async ({ services, user, input }) => ok(await services.vendorPayouts.markManual(user(), input.params.id, input.body.note)));
