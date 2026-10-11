import { z } from "../../shared/openapi/zod.js";
import { idParam, isoDateTime } from "../../shared/openapi/schemas.js";
import { pageLimit } from "../../shared/validation/index.js";

/** Request and response shapes of /api/v1/notifications. */

export const NotificationSchema = z
  .looseObject({ id: z.string(), type: z.string(), title: z.string(), read: z.boolean(), created_at: z.string() })
  .openapi("Notification", { description: "A notifications row with every column." });

export const RecentUnreadSchema = z
  .object({ id: z.string(), type: z.string(), created_at: z.string(), target_params: z.unknown() })
  .openapi("RecentUnreadNotification");

export const ListQuery = z.object({
  readSince: isoDateTime.optional().openapi({ description: "Include read notifications newer than this (default: 30 days ago)." }),
  limit: pageLimit(150, 300),
});

export const CountQuery = z.object({
  type: z.string().regex(/^[a-z_]{1,64}$/).optional().openapi({ example: "new_message" }),
  after: isoDateTime.optional(),
});

export const RecentQuery = z.object({ limit: pageLimit(5, 50) });

export const MarkReadBody = z
  .union([
    z.object({ all: z.literal(true) }),
    z.object({ ids: z.array(idParam).min(1).max(500), read: z.boolean().default(true) }),
  ])
  .openapi("MarkNotificationsRequest");

export const UpdatedResult = z.object({ updated: z.number().int().min(0) });
