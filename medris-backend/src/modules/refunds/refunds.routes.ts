import { defineRoute } from "../../shared/http/route.js";
import { z } from "../../shared/openapi/zod.js";
import { requireUser } from "../../middleware/auth.js";
import { commonErrors, dataResponse, errorResponses, jsonBody } from "../../shared/openapi/schemas.js";
import { signedIn } from "../../shared/openapi/security.js";

/** Refunds for orders paid through Paystack (issue #99). */

export const refundOrder = defineRoute({
  method: "post",
  path: "/admin/orders/{orderId}/refund",
  tags: ["Refunds"],
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Refund an order paid through Paystack (admins)",
  description:
    "Refundable = what the buyer paid for the order through Paystack (not Paystack's fee) minus refunds already made or under way. " +
    "Refused once the vendor's payout is on its way or sent. The refund is queued and sent to Paystack by the refund worker; its status then follows Paystack's refund events.",
  request: {
    params: z.object({ orderId: z.string().uuid() }),
    body: jsonBody(z.object({ amountNaira: z.number().positive().max(100_000_000).optional(), reason: z.string().min(3).max(200) }).openapi("RefundOrderRequest")),
  },
  responses: {
    200: dataResponse(z.object({ orderId: z.string(), amount: z.number(), status: z.literal("pending") }).openapi("RefundQueued"), "Queued."),
    ...errorResponses(400, 401, 403, 404, 409, 415),
    ...commonErrors,
  },
});
