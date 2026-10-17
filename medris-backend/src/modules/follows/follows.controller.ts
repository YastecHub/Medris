import { controller, ok } from "../../shared/http/route.js";
import * as routes from "./follows.routes.js";

/** /api/v1/follows - see follows.routes.ts for the contract. */
export const followsController = controller()
  .route(routes.listFollows, async ({ services, user }) => ok(await services.follows.list(user())))
  .route(routes.isFollowing, async ({ services, user, input }) => ok(await services.follows.isFollowing(user(), input.params.vendorId)))
  .route(routes.setFollowing, async ({ services, user, input }) => ok(await services.follows.setFollowing(user(), input.params.vendorId, input.body.following)))
  .route(routes.unfollow, async ({ services, user, input }) => ok(await services.follows.unfollow(user(), input.params.vendorId)));
