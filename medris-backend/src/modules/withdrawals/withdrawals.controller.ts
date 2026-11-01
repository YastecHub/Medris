import { controller, ok } from "../../shared/http/route.js";
import * as routes from "./withdrawals.routes.js";

/** Vendor withdrawals - all balances and decisions are calculated/enforced by WithdrawalsService. */
export const withdrawalsController = controller()
  .route(routes.mySummary, async ({ services, user }) => ok(await services.withdrawals.summary(user())))
  .route(routes.requestWithdrawal, async ({ services, user }) => ok(await services.withdrawals.request(user())))
  .route(routes.adminWithdrawals, async ({ services, user, input }) => ok(await services.withdrawals.adminList(user(), input.query.status ?? null)))
  .route(routes.decideWithdrawal, async ({ services, user, input }) => ok(await services.withdrawals.decide(user(), input.params.id, input.body.decision, input.body.reason ?? null)))
  .route(routes.reopenDispute, async ({ services, user, input }) => ok(await services.withdrawals.reopenDispute(user(), input.params.id, input.body.note ?? null)));
