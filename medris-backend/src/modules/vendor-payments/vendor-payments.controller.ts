import { Router, type Request, type Response } from "express";
import { json, readJsonBody, requestOrigin } from "../../lib/http.js";
import { respond } from "../../shared/legacy.js";
import { listingPaymentReturn, runVendorPaymentAction } from "./vendor-payments.service.js";

/** /api/vendor-payments (also /api/listing-payments) - contract: vendor-payments.routes.ts. */
function vendorPaymentsEntry(req: Request, res: Response): Promise<void> | void {
  const errors = { log: "[vendor-payments]" };
  if (req.method === "GET") {
    const reference = String(req.query.reference || "").trim();
    const purpose = String(req.query.purpose || "").trim();
    return respond(res, () => listingPaymentReturn(reference, purpose, requestOrigin(req)), errors);
  }
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  return respond(res, async () => runVendorPaymentAction(await readJsonBody(req), requestOrigin(req)), errors);
}

export const vendorPaymentsController = Router().all("/vendor-payments", vendorPaymentsEntry).all("/listing-payments", vendorPaymentsEntry);
