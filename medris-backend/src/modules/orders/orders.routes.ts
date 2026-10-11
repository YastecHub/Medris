import { z } from "../../shared/openapi/zod.js";
import { accessToken, legacyRoute } from "../../shared/openapi/legacy-docs.js";
import { only } from "../../shared/openapi/security.js";

/** Contract of the order endpoints (documentation; see orders.controller.ts). */
export const ordersDocs = [
  legacyRoute({
    method: "post",
    path: "/order-payout-action",
    summary: "Money-moving order actions",
    description:
      "`release` (default; buyer or admin confirms receipt, pays out held money), `refund` and `mark-manual` (admins), " +
      "`buyer-cancel` (within 5 h of paying, while confirmed), `vendor-decline` (pending/confirmed). Status changes run as the caller.",
    body: z
      .object({ action: z.enum(["release", "refund", "mark-manual", "buyer-cancel", "vendor-decline"]).optional(), orderId: z.string(), accessToken, reason: z.string().optional() })
      .openapi("PayoutActionRequest"),
    responses: { 200: "Done.", 400: "Missing input or refused by the database.", 401: "Invalid session.", 403: "Not allowed.", 404: "Order not found.", 405: "Only POST.", 500: "Server error." },
  }),
  legacyRoute({
    method: "post",
    path: "/order-reminders",
    summary: "Order reminder sweep (scheduled)",
    description: "Any method. Reminds parties of orders waiting on them.",
    security: only("cronSecret"),
    responses: { 200: ["Counts.", z.object({ checked: z.number(), reminded: z.number() })], 401: "Wrong secret.", 500: "Server error." },
  }),
  legacyRoute({
    method: "post",
    path: "/order-notify",
    summary: "Order e-mails (not implemented)",
    description: "Kept for compatibility: checks the caller is a party to the order, then answers 500 as the original did. Nothing in the app calls it.",
    body: z.object({ orderId: z.string(), eventType: z.string(), accessToken }),
    responses: { 400: "Missing input.", 401: "Invalid session.", 403: "Not a party to the order.", 404: "Order not found.", 405: "Only POST.", 500: "Not implemented." },
  }),
];
