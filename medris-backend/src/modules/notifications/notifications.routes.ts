import { defineRoute } from "../../shared/http/route.js";
import { z } from "../../shared/openapi/zod.js";
import { requireUser } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { CountSchema, commonErrors, dataResponse, errorResponses, jsonBody } from "../../shared/openapi/schemas.js";
import { signedIn } from "../../shared/openapi/security.js";
import { CountQuery, ListQuery, MarkReadBody, NotificationSchema, RecentQuery, RecentUnreadSchema, UpdatedResult } from "./notifications.schemas.js";

/**
 * In-app notifications of the signed-in user. New notifications are still
 * created by database triggers and delivered live through Supabase Realtime;
 * these endpoints cover reading and marking.
 */

const tags = ["Notifications"];
const readErrors = { ...errorResponses(400, 401), ...commonErrors };

export const listNotifications = defineRoute({
  method: "get",
  path: "/notifications",
  tags,
  summary: "The notification panel",
  description: "Every unread notification plus read ones newer than `readSince`, newest first.",
  security: signedIn,
  middleware: [requireUser] as const,
  request: { query: ListQuery },
  responses: { 200: dataResponse(z.array(NotificationSchema), "Notifications."), ...readErrors },
});

export const unreadCount = defineRoute({
  method: "get",
  path: "/notifications/unread-count",
  tags,
  summary: "Unread count (badges)",
  description: "Unread, not archived, not deleted; optionally one type and only newer than `after`.",
  security: signedIn,
  middleware: [requireUser] as const,
  request: { query: CountQuery },
  responses: { 200: dataResponse(CountSchema, "The count."), ...readErrors },
});

export const recentUnread = defineRoute({
  method: "get",
  path: "/notifications/recent-unread",
  tags,
  summary: "Latest unread notifications",
  description: "id, type, created_at and target_params, for the sound/vibration catch-up.",
  security: signedIn,
  middleware: [requireUser] as const,
  request: { query: RecentQuery },
  responses: { 200: dataResponse(z.array(RecentUnreadSchema), "Latest unread notifications."), ...readErrors },
});

export const markRead = defineRoute({
  method: "post",
  path: "/notifications/read",
  tags,
  summary: "Mark notifications read or unread",
  description: "`{ \"all\": true }` marks everything read; `{ \"ids\": [...], \"read\": false }` marks those unread.",
  security: signedIn,
  middleware: [requireUser, rateLimit({ name: "notifications-read", limit: 240, windowMs: 60_000 })] as const,
  request: { body: jsonBody(MarkReadBody) },
  responses: { 200: dataResponse(UpdatedResult, "Number of rows changed."), ...errorResponses(400, 401, 415, 429), ...commonErrors },
});
