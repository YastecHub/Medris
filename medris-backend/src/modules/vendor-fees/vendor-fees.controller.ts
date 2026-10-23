import { controller, ok } from "../../shared/http/route.js";
import * as routes from "./vendor-fees.routes.js";

/** Vendor fees - see vendor-fees.routes.ts. */
export const vendorFeesController = controller()
  .route(routes.payCommission, async ({ services, user, req }) => ok(await services.vendorFees.initializeCommission(user(), services.config.appOrigin || (req.get("origin") ?? ""))))
  .route(routes.payListing, async ({ services, user, input, req }) => ok(await services.vendorFees.initializeListing(user(), input.params.kind, input.params.listingId, services.config.appOrigin || (req.get("origin") ?? ""))));
