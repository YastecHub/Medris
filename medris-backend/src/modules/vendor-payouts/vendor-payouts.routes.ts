import { defineRoute } from "../../shared/http/route.js";
import { z } from "../../shared/openapi/zod.js";
import { requireUser } from "../../middleware/auth.js";
import { commonErrors, dataResponse, errorResponses, jsonBody } from "../../shared/openapi/schemas.js";
import { signedIn } from "../../shared/openapi/security.js";

/** Paying vendors after an order is completed (issue #98). */

const tags = ["Vendor payouts"];
const page = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0) });
const id = z.object({ id: z.string().uuid() });
const Result = z.object({ id: z.string(), status: z.string() }).openapi("PayoutActionResult");
const Mine = z
  .object({
    id: z.string(),
    orderId: z.string(),
    amount: z.number(),
    commission: z.number(),
    status: z.string(),
    holdReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("MyPayout");

export const myPayouts = defineRoute({
  method: "get",
  path: "/shops/mine/payouts",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "The shop's payouts, newest first",
  request: { query: page },
  responses: { 200: dataResponse(z.array(Mine), "Each payout with its status (pending, processing, success, on_hold, failed, reversed, paid_manually)."), ...errorResponses(400, 401), ...commonErrors },
});

export const adminPayouts = defineRoute({
  method: "get",
  path: "/admin/payouts",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "All vendor payouts (admins)",
  request: {
    query: page.extend({
      status: z.enum(["pending", "processing", "success", "failed", "reversed", "on_hold", "paid_manually"]).optional(),
      vendorId: z.string().uuid().optional(),
      orderId: z.string().uuid().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }),
  },
  responses: { 200: dataResponse(z.array(z.record(z.string(), z.unknown())).openapi("AdminPayouts"), "Payouts, newest first."), ...errorResponses(400, 401, 403), ...commonErrors },
});

export const releasePayout = defineRoute({
  method: "post",
  path: "/admin/payouts/{id}/release",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Release a held, failed or reversed payout now (admins)",
  description: "Puts it back in the queue; the payout worker sends it on its next run. Logged in the admin action log.",
  request: { params: id },
  responses: { 200: dataResponse(Result, "Queued."), ...errorResponses(400, 401, 403, 404, 409), ...commonErrors },
});

export const holdPayout = defineRoute({
  method: "post",
  path: "/admin/payouts/{id}/hold",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Hold a pending payout (admins)",
  request: { params: id, body: jsonBody(z.object({ reason: z.string().min(3).max(200) }).openapi("HoldPayoutRequest")) },
  responses: { 200: dataResponse(Result, "On hold."), ...errorResponses(400, 401, 403, 404, 409, 415), ...commonErrors },
});

export const markPayoutManual = defineRoute({
  method: "post",
  path: "/admin/payouts/{id}/mark-manual",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Record that the vendor was paid outside Paystack (admins)",
  description: "No Paystack call. Who did it and why are recorded and the vendor is told.",
  request: { params: id, body: jsonBody(z.object({ note: z.string().min(3).max(300) }).openapi("MarkPayoutManualRequest")) },
  responses: { 200: dataResponse(Result, "Recorded."), ...errorResponses(400, 401, 403, 404, 409, 415), ...commonErrors },
});
