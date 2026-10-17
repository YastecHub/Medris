import { z } from "../../shared/openapi/zod.js";

/** Response shapes of /api/v1/favorites. */

export const FavoritesSchema = z
  .object({ productIds: z.array(z.string()), packageIds: z.array(z.string()) })
  .openapi("Favorites");

export const SavedResult = z.object({
  saved: z.literal(true),
  created: z.boolean().openapi({ description: "false when it was already saved (the call is idempotent)." }),
});

export const UnsavedResult = z.object({ saved: z.literal(false), removed: z.number().int().min(0) });
