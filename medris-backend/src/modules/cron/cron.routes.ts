import { only } from "../../shared/openapi/security.js";
import { legacyRoute } from "../../shared/openapi/legacy-docs.js";

/** Contract of /api/daily-cron (documentation; see cron.controller.ts). */
const run = (method: "get" | "post") =>
  legacyRoute({
    method,
    path: "/daily-cron",
    summary: "Daily maintenance (Vercel Cron, 03:00 UTC)",
    description:
      "Listing billing reminders/expiry, commission deadline reminders, deletes read notifications older than 60 days and " +
      "(with backend sessions on) sessions that ended over 30 days ago. Accepts the secret as `Authorization: Bearer` or `x-cron-secret`.",
    security: only("cronSecret"),
    responses: { 200: "`{ ok, notificationsTrimmed, commissionReminders, ... }`.", 401: "Wrong secret.", 405: "Only GET/POST.", 500: "Server error.", 502: "The listing billing processor failed." },
  });

export const cronDocs = [run("get"), run("post")];
