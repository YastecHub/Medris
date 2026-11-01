import { defineRoute } from "../../shared/http/route.js";
import { z } from "../../shared/openapi/zod.js";
import { requireUser } from "../../middleware/auth.js";
import { commonErrors, dataResponse, errorResponses, jsonBody } from "../../shared/openapi/schemas.js";
import { signedIn } from "../../shared/openapi/security.js";

/** Vendor withdrawal requests. Amounts are calculated server-side from the order payout ledger. */
const tags = ["Vendor withdrawals"];
const id = z.object({ id: z.string().uuid() });
const summaryResponse = z.object({
  min_kobo: z.number(),
  instant_kobo: z.number(),
  approval_kobo: z.number(),
  held_kobo: z.number(),
  has_dispute: z.boolean(),
  disputed_order_ids: z.array(z.string()),
  blocked: z.string().nullable(),
  recent_bank_change: z.number().nullable(),
  open_request: z.record(z.string(), z.unknown()).nullable(),
  recent: z.array(z.record(z.string(), z.unknown())),
}).openapi("VendorWithdrawalSummary");
const requestResponse = z.object({
  sent_kobo: z.number(),
  requested_kobo: z.number(),
  held_kobo: z.number(),
  has_dispute: z.boolean(),
}).openapi("VendorWithdrawalRequestResult");

export const mySummary = defineRoute({
  method: "get",
  path: "/shops/mine/withdrawals",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Get the signed-in shop's withdrawal wallet summary",
  responses: { 200: dataResponse(summaryResponse, "Server-calculated balances and withdrawal history."), ...errorResponses(401, 403), ...commonErrors },
});

export const requestWithdrawal = defineRoute({
  method: "post",
  path: "/shops/mine/withdrawals",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Request withdrawal of eligible vendor earnings",
  description: "The amount is calculated from completed order payout rows. No client-supplied amount is accepted. Eligible funds enter the existing payout worker; newer funds require admin approval.",
  responses: { 200: dataResponse(requestResponse, "Instant funds queued and/or newer funds submitted for approval."), ...errorResponses(400, 401, 403, 409), ...commonErrors },
});

export const adminWithdrawals = defineRoute({
  method: "get",
  path: "/admin/withdrawals",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "List vendor withdrawal requests (admins)",
  request: { query: z.object({ status: z.enum(["requested", "approved", "rejected"]).optional() }) },
  responses: { 200: dataResponse(z.array(z.record(z.string(), z.unknown())), "Withdrawal requests with bank and dispute context."), ...errorResponses(401, 403), ...commonErrors },
});

export const decideWithdrawal = defineRoute({
  method: "post",
  path: "/admin/withdrawals/{id}/decision",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Approve or reject a vendor withdrawal request (admins)",
  request: {
    params: id,
    body: jsonBody(z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().max(500).nullable().optional() }).openapi("DecideWithdrawalRequest")),
  },
  responses: { 200: dataResponse(z.object({ status: z.string(), released: z.number().optional() }), "Decision recorded; approved payouts enter the existing worker queue."), ...errorResponses(400, 401, 403, 404, 409, 415), ...commonErrors },
});

export const reopenDispute = defineRoute({
  method: "post",
  path: "/admin/disputes/{id}/reopen",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Reopen a resolved dispute before vendor funds have been sent (admins)",
  request: { params: id, body: jsonBody(z.object({ note: z.string().max(500).nullable().optional() }).openapi("ReopenDisputeRequest")) },
  responses: { 200: dataResponse(z.object({ done: z.boolean() }), "Dispute reopened and any pending order payout returned to hold."), ...errorResponses(401, 403, 404, 409, 415), ...commonErrors },
});
