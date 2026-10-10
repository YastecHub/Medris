import { Hono, type Context } from "hono";
import { errorMessage, json, readJsonBody, requestOrigin } from "../../lib/http.js";
import { consumeListingPayment, finishListingPaymentRedirect, startListingPayment, verifyListingPayment } from "./listing-payment.service.js";
import { createSubaccount, payCommission, setupMonthlyBilling } from "./vendor-billing.service.js";
import { migrateFile, optimizeFile, presignUpload } from "./media.service.js";
import type { ServiceResult } from "../../types/service.js";

/**
 * /api/vendor-payments (also served as /api/listing-payments)
 *   GET  ?reference=...[&purpose=listing] -> Paystack return for a ₦999 listing payment (302 back to the app)
 *   POST { action, ... }                  -> see ACTIONS below
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

async function vendorPaymentsEntry(c: Context): Promise<Response> {
  try {
    if (c.req.method === "GET") {
      const reference = String(c.req.query("reference") || "").trim();
      const purpose = String(c.req.query("purpose") || "").trim();
      if (reference && (!purpose || purpose === "listing")) {
        return c.redirect(await finishListingPaymentRedirect(reference, requestOrigin(c)), 302);
      }
      return json(c, 400, { error: "payment reference is required" });
    }
    if (c.req.method !== "POST") return json(c, 405, { error: "Method not allowed" });

    const body = await readJsonBody(c);
    const action = String(body.action);
    const handler = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
    if (!handler) return json(c, 400, { error: "Unknown payment action" });
    const result = await handler(body, requestOrigin(c));
    return json(c, result.status, result.body);
  } catch (err) {
    console.error("[vendor-payments]", err);
    return json(c, 500, { error: errorMessage(err) || "Server error" });
  }
}

export const vendorPaymentsRoutes = new Hono().all("/vendor-payments", vendorPaymentsEntry).all("/listing-payments", vendorPaymentsEntry);
