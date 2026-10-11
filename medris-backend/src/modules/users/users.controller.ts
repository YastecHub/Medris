import { controller, ok } from "../../shared/http/route.js";
import * as routes from "./users.routes.js";

/** /api/v1/me - see users.routes.ts for the contract. */
export const usersController = controller().route(routes.getMe, async ({ services, user }) => ok(await services.users.me(user())));
