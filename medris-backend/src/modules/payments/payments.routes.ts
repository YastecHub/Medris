import { z } from "../../shared/openapi/zod.js";
import { accessToken, legacyRoute } from "../../shared/openapi/legacy-docs.js";
import { only } from "../../shared/openapi/security.js";

/** Contract of the order payment endpoints (documentation; see payments.controller.ts). */
export const paymentsDocs = [
  legacyRoute({
    method: "post",
    path: "/initiate-payment",
    summary: "Start a Paystack checkout for an order",
    description: "The amount comes from create_payment_intent() (run as the buyer), never from the client.",
    body: z.object({ orderId: z.string(), accessToken }).openapi("InitiatePaymentRequest"),
    responses: {
      200: ["Checkout URL.", z.object({ authorization_url: z.string(), reference: z.string() })],
      400: "Missing input, not your order, or Paystack refused.",
      405: "Only POST.",
      500: "Server error.",
    },
  }),
  legacyRoute({
    method: "get",
    path: "/verify-payment",
    summary: "Confirm a payment right after checkout",
    description: "Settles the payment when Paystack reports success. The webhook remains the source of truth.",
    query: z.object({ reference: z.string() }),
    responses: { 200: ["Paystack's status.", z.object({ status: z.string().optional() })], 400: "Missing reference or Paystack error.", 500: "Server error." },
  }),
  legacyRoute({
    method: "post",
    path: "/paystack-webhook",
    summary: "Paystack webhook",
    description: "`charge.success` settles order payments, commission, monthly billing and ₦999 listing activations.",
    security: only("paystackSignature"),
    body: z.looseObject({ event: z.string(), data: z.looseObject({}) }),
    responses: { 200: ["Received.", z.object({ received: z.literal(true) })], 401: "Invalid signature.", 500: "Server error." },
  }),
];
