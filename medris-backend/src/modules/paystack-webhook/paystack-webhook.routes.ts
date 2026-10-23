import { defineRoute } from "../../shared/http/route.js";
import { z } from "../../shared/openapi/zod.js";
import { only } from "../../shared/openapi/security.js";
import { jsonResponse } from "../../shared/openapi/schemas.js";

const tags = ["Payments"];

/**
 * Paystack tells Levromart what happened. Public (no sign-in): the caller is proven by the HMAC signature in
 * `x-paystack-signature`, checked on the raw body. Served before the JSON body guard so the exact bytes are used.
 */
export const paystackWebhook = defineRoute({
  method: "post",
  path: "/payments/paystack/webhook",
  tags,
  summary: "Paystack webhook",
  description:
    "Verifies `x-paystack-signature` (HMAC-SHA512 of the raw body with the secret key); anything invalid gets 401 and changes nothing. " +
    "Each event is recorded once (a repeat answers 200 and does nothing). `charge.success` asks Paystack to verify the payment and compares the " +
    "amount and currency with what was recorded, then settles listing fees, commission, billing and order payments like the old webhook. " +
    "`transfer.*`, `refund.*` and `charge.dispute.*` update payouts and refunds and alert admins; states only move forward. " +
    "Unknown events are stored and answered with 200. If a payment cannot be verified right now the event stays unprocessed and the " +
    "reconciliation job (`paystack-reconcile`) settles it later.",
  security: only("paystackSignature"),
  responses: {
    200: jsonResponse(z.object({ received: z.literal(true), result: z.string() }), "Received (result says what was done, or `duplicate`)."),
    400: jsonResponse(z.object({ error: z.string() }), "The body is not JSON."),
    401: jsonResponse(z.object({ error: z.string() }), "Invalid signature."),
    500: jsonResponse(z.object({ error: z.string() }), "Could not process the event; Paystack will send it again."),
  },
});
