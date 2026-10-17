import { defineRoute } from "../../shared/http/route.js";
import { requireUser } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { commonErrors, dataResponse, errorResponses, jsonBody } from "../../shared/openapi/schemas.js";
import { signedIn } from "../../shared/openapi/security.js";
import { FollowingSchema, FollowsSchema, SetFollowingBody, SetFollowingResult, UnfollowResult, VendorParams } from "./follows.schemas.js";

/**
 * Shops the signed-in user follows. toggle_vendor_follow() keeps its rules
 * (no following your own shop, the follower notifications, points).
 */

const tags = ["Follows"];
const writeLimit = rateLimit({ name: "follows-write", limit: 60, windowMs: 60_000 });
const writeErrors = { ...errorResponses(400, 401, 415, 429), ...commonErrors };

export const listFollows = defineRoute({
  method: "get",
  path: "/follows",
  tags,
  summary: "Followed shops",
  security: signedIn,
  middleware: [requireUser] as const,
  responses: { 200: dataResponse(FollowsSchema, "Followed vendor ids (up to 2000) and the total."), ...errorResponses(401), ...commonErrors },
});

export const isFollowing = defineRoute({
  method: "get",
  path: "/follows/{vendorId}",
  tags,
  summary: "Is the user following this shop?",
  security: signedIn,
  middleware: [requireUser] as const,
  request: { params: VendorParams },
  responses: { 200: dataResponse(FollowingSchema, "Whether the user follows the shop."), ...errorResponses(400, 401), ...commonErrors },
});

export const setFollowing = defineRoute({
  method: "put",
  path: "/follows/{vendorId}",
  tags,
  summary: "Follow or unfollow a shop",
  description: "Runs toggle_vendor_follow().",
  security: signedIn,
  middleware: [requireUser, writeLimit] as const,
  request: { params: VendorParams, body: jsonBody(SetFollowingBody) },
  responses: { 200: dataResponse(SetFollowingResult, "Done."), ...writeErrors },
});

export const unfollow = defineRoute({
  method: "delete",
  path: "/follows/{vendorId}",
  tags,
  summary: "Unfollow a shop",
  description: "Deletes the follow row directly (the comment menu's unfollow).",
  security: signedIn,
  middleware: [requireUser, writeLimit] as const,
  request: { params: VendorParams },
  responses: { 200: dataResponse(UnfollowResult, "Removed (0 when not following)."), ...writeErrors },
});
