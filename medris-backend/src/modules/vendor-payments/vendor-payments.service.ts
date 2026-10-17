import type { LegacyResult, ServiceResult } from "../../shared/types/service.js";
import { consumeListingPayment, finishListingPaymentRedirect, startListingPayment, verifyListingPayment } from "./listing-payment.service.js";
import { migrateFile, optimizeFile, presignUpload } from "./media.service.js";
import { createSubaccount, payCommission, setupMonthlyBilling } from "./vendor-billing.service.js";

/**
 * /api/vendor-payments (also /api/listing-payments): vendor payouts set-up,
 * commission and monthly billing, ₦999 listing activations and media uploads.
 *
 * The browser still sends "list-banks", "list-listing-drafts",
 * "save-listing-draft" and "delete-listing-draft"; the original API never
 * implemented them either, so they keep answering 400 "Unknown payment action".
 */

type ActionHandler = (body: Record<string, unknown>, origin: string) => Promise<ServiceResult>;

const ACTIONS: Record<string, ActionHandler> = {
  "create-subaccount": (body) => createSubaccount(body),
  "pay-commission": (body, origin) => payCommission(body, origin),
  "setup-monthly-billing": (body, origin) => setupMonthlyBilling(body, origin),
  "pay-listing": (body, origin) => startListingPayment(body, origin),
  // Browser recovery after the Paystack redirect; the browser can never declare success itself.
  "verify-listing-payment": (body) => verifyListingPayment(body),
  // Legacy paid-draft flow; only consumes a payment Paystack reports as successful.
  "consume-listing-payment": (body) => consumeListingPayment(body),
  // Older clients: requires an existing listing id.
  "prepare-listing-payment": async (body, origin) => {
    if (!body.listingId) {
      return { status: 400, body: { error: "Create the listing first, then provide its listingId for the ₦999 activation payment." } };
    }
    return startListingPayment({ ...body, id: body.listingId }, origin);
  },
  "r2-presign-upload": (body) => presignUpload(body),
  "r2-migrate-file": (body) => migrateFile(body),
  "r2-optimize-file": (body) => optimizeFile(body),
};

/** The supported `action` values (documentation and tests). */
export const VENDOR_PAYMENT_ACTIONS = Object.keys(ACTIONS);

export function runVendorPaymentAction(body: Record<string, unknown>, origin: string): Promise<ServiceResult> {
  const action = String(body.action);
  const handler = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!handler) return Promise.resolve({ status: 400, body: { error: "Unknown payment action" } });
  return handler(body, origin);
}

/** GET ?reference=...[&purpose=listing]: Paystack's return for a ₦999 listing payment -> back to the app. */
export async function listingPaymentReturn(reference: string, purpose: string, origin: string): Promise<LegacyResult> {
  if (reference && (!purpose || purpose === "listing")) return { redirect: await finishListingPaymentRedirect(reference, origin) };
  return { status: 400, body: { error: "payment reference is required" } };
}
