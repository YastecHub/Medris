import { controller, ok } from "../../shared/http/route.js";
import * as routes from "./refunds.routes.js";

/** Refunds - see refunds.routes.ts. */
export const refundsController = controller().route(routes.refundOrder, async ({ services, user, input }) => ok(await services.refunds.refundOrder(user(), input.params.orderId, input.body)));
