import { z } from "../../shared/openapi/zod.js";
import { accessToken, legacyRoute } from "../../shared/openapi/legacy-docs.js";
import { VENDOR_PAYMENT_ACTIONS } from "./vendor-payments.service.js";

/** Contract of /api/vendor-payments, also served as /api/listing-payments (documentation; see vendor-payments.controller.ts). */

const ActionBody = z
  .looseObject({
    action: z.enum(VENDOR_PAYMENT_ACTIONS as [string, ...string[]]),
    accessToken,
    id: z.string().optional().openapi({ description: "pay-listing: the listing id." }),
    listingId: z.string().optional(),
    kind: z.enum(["product", "package"]).optional(),
    reference: z.string().optional(),
    bankCode: z.string().optional(),
    accountNumber: z.string().optional(),
    bucket: z.string().optional(),
    key: z.string().optional(),
    contentType: z.string().optional(),
  })
  .openapi("VendorPaymentActionRequest");

export const vendorPaymentsDocs = ["/vendor-payments", "/listing-payments"].flatMap((path) => [
  legacyRoute({
    method: "post",
    path,
    summary: "Vendor payouts, commission, monthly billing, ₦999 listing payments and media uploads",
    description: "`action` picks the operation; unknown actions answer 400 `Unknown payment action`.",
    body: ActionBody,
    responses: { 200: "Depends on the action (often `{ authorization_url, reference }`).", 400: "Invalid input or unknown action.", 401: "Invalid session.", 404: "No vendor profile.", 405: "Only GET/POST.", 500: "Server error." },
  }),
  legacyRoute({
    method: "get",
    path,
    summary: "Paystack return for a ₦999 listing payment",
    query: z.object({ reference: z.string(), purpose: z.literal("listing").optional() }),
    responses: { 302: "Back into the app with the outcome.", 400: "Missing reference.", 500: "Server error." },
  }),
]);
