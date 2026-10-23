import { defineRoute } from "../../shared/http/route.js";
import { z } from "../../shared/openapi/zod.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { requireUser } from "../../middleware/auth.js";
import { commonErrors, dataResponse, errorResponses } from "../../shared/openapi/schemas.js";
import { signedIn } from "../../shared/openapi/security.js";

/** Levromart's own fees through Paystack: owed commission and the ₦999 monthly listing fee (issue #100). */

const tags = ["Vendor fees"];
const startLimit = rateLimit({ name: "vendor-fee-initialize", limit: 20, windowMs: 60_000 });
const Started = z
  .object({ authorizationUrl: z.string(), accessCode: z.string(), reference: z.string(), amountNaira: z.number() })
  .openapi("VendorFeeStarted");
const AlreadyActive = z.object({ alreadyActive: z.literal(true), paidUntil: z.string().nullable() }).openapi("ListingAlreadyActive");

export const payCommission = defineRoute({
  method: "post",
  path: "/shops/mine/commission/paystack/initialize",
  tags,
  security: signedIn,
  middleware: [requireUser, startLimit] as const,
  summary: "Pay all owed commission with Paystack",
  description: "The amount is what the database says is owed. A double tap returns the same payment link. Check progress with `GET /payments/paystack/{reference}`; paying unlocks the shop the same way as before.",
  responses: { 200: dataResponse(Started, "Send the vendor to `authorizationUrl`."), ...errorResponses(400, 401, 404, 429, 503), ...commonErrors },
});

export const payListing = defineRoute({
  method: "post",
  path: "/listings/{kind}/{listingId}/paystack/initialize",
  tags,
  security: signedIn,
  middleware: [requireUser, startLimit] as const,
  summary: "Pay the ₦999 monthly fee of a listing with Paystack",
  description: "Only the shop's owner, only for a listing on monthly billing. A listing that is already paid up is not charged again.",
  request: { params: z.object({ kind: z.enum(["product", "package"]), listingId: z.string().uuid() }) },
  responses: { 200: dataResponse(z.union([Started, AlreadyActive]).openapi("ListingFeeStarted"), "A payment link, or `alreadyActive`."), ...errorResponses(400, 401, 403, 404, 429, 503), ...commonErrors },
});
