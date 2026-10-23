import { controller, ok } from "../../shared/http/route.js";
import * as routes from "./payments-admin.routes.js";

/** Admin payments - see payments-admin.routes.ts. */
export const paymentsAdminController = controller()
  .route(routes.summary, async ({ services, user }) => ok(await services.paymentsAdmin.summary(user())))
  .route(routes.transactions, async ({ services, user, input }) => ok(await services.paymentsAdmin.transactions(user(), input.query, input.query)))
  .route(routes.refunds, async ({ services, user, input }) => ok(await services.paymentsAdmin.refunds(user(), input.query, input.query)))
  .route(routes.reconciliation, async ({ services, user, input }) => ok(await services.paymentsAdmin.reports(user(), input.query.limit)));
