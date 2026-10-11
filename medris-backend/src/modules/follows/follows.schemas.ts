import { z } from "../../shared/openapi/zod.js";
import { idParam } from "../../shared/openapi/schemas.js";

/** Request and response shapes of /api/v1/follows. */

export const VendorParams = z.object({ vendorId: idParam });

export const FollowsSchema = z.object({ vendorIds: z.array(z.string()), count: z.number().int().min(0) }).openapi("Follows");

export const FollowingSchema = z.object({ following: z.boolean() });

export const SetFollowingBody = z.object({ following: z.boolean() }).openapi("SetFollowingRequest");

export const SetFollowingResult = z.object({
  following: z.boolean(),
  result: z.unknown().openapi({ description: "What toggle_vendor_follow() returned." }),
});

export const UnfollowResult = z.object({ following: z.literal(false), removed: z.number().int().min(0) });
