import { controller, ok } from "../../shared/http/route.js";
import * as routes from "./catalogue.routes.js";

/** /api/v1/catalogue - see catalogue.routes.ts for the contract. */
export const catalogueController = controller()
  .route(routes.listSectors, async ({ services, identity, input }) => ok(await services.catalogue.sectors(identity, input.query.order)))
  .route(routes.listCategories, async ({ services, identity, input }) => ok(await services.catalogue.categories(identity, input.query.sectorId)));
