import { z } from "../../shared/openapi/zod.js";
import { accessToken, legacyRoute } from "../../shared/openapi/legacy-docs.js";
import { only } from "../../shared/openapi/security.js";

/** Contract of /api/notify (documentation; see notify.controller.ts). */
export const notifyDocs = [
  legacyRoute({
    method: "post",
    path: "/notify",
    summary: "Notification delivery (e-mail + web push), test pushes and call declines",
    description:
      "`action: test-push` (with `accessToken`) and `action: decline-call` (with `callId`, `token`) need no secret. " +
      "Everything else is called by the database with `x-webhook-secret`: `{ notificationId, ringAgain? }` delivers one notification, " +
      "`{ reminders: [...] }` sends batched reminder pushes.",
    security: [...only("webhookSecret"), {}],
    body: z
      .object({
        action: z.enum(["test-push", "decline-call"]).optional(),
        accessToken: accessToken.optional(),
        callId: z.string().optional(),
        token: z.string().optional(),
        notificationId: z.string().optional(),
        ringAgain: z.boolean().optional(),
        reminders: z
          .array(z.object({ user_id: z.string(), kind: z.string().optional(), title: z.string().optional(), body: z.string().optional(), view: z.string().optional(), params: z.record(z.string(), z.unknown()).optional() }))
          .max(500)
          .optional(),
      })
      .openapi("NotifyRequest"),
    responses: { 200: "`{ email, push }`, `{ reminders, sent }`, `{ ok }` or the push outcome.", 400: "Missing or invalid id.", 401: "Wrong secret, token or session.", 405: "Only POST.", 500: "Server error." },
  }),
];
