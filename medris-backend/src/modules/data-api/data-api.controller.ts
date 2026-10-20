import { controller, json } from "../../shared/http/route.js";
import * as routes from "./data-api.routes.js";

/** GET /api/v1/data-api: is the data API (/rest/v1, PostgREST) ready? */
export const dataApiController = controller().route(routes.dataApiInfo, async ({ services }) =>
  json({ ready: services.dataApi ? await services.dataApi.ready() : false, url: "/rest/v1" }),
);
