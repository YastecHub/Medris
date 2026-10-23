import { controller, ok } from "../../shared/http/route.js";
import * as routes from "./payout-accounts.routes.js";

/** Payout accounts - see payout-accounts.routes.ts. */
export const payoutAccountsController = controller()
  .route(routes.banks, async ({ services }) => ok(await services.payoutAccounts.listBanks()))
  .route(routes.resolveAccount, async ({ services, input }) => ok(await services.payoutAccounts.resolve(input.body)))
  .route(routes.saveMyAccount, async ({ services, user, input }) => ok(await services.payoutAccounts.saveMine(user(), input.body)))
  .route(routes.myAccount, async ({ services, user }) => ok(await services.payoutAccounts.mine(user())))
  .route(routes.unverifiedShops, async ({ services, user, input }) => ok(await services.payoutAccounts.unverifiedShops(user(), input.query)));
