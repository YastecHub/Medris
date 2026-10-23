import { defineRoute } from "../../shared/http/route.js";
import { z } from "../../shared/openapi/zod.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { requireUser } from "../../middleware/auth.js";
import { commonErrors, dataResponse, errorResponses, jsonBody } from "../../shared/openapi/schemas.js";
import { signedIn } from "../../shared/openapi/security.js";

/** Vendors' payout accounts, verified by Paystack (issue #97). */

const tags = ["Payout accounts"];
const resolveLimit = rateLimit({ name: "payout-resolve", limit: 30, windowMs: 3_600_000 });
const saveLimit = rateLimit({ name: "payout-save", limit: 5, windowMs: 3_600_000 });
const account = z.object({ bankCode: z.string().min(2).max(20), accountNumber: z.string().regex(/^\d{10}$/, "An account number has 10 digits.") });

const Bank = z.object({ name: z.string(), code: z.string() }).openapi("PaystackBank");
const Saved = z
  .object({ bankName: z.string().nullable(), accountName: z.string().nullable(), accountLast4: z.string().nullable(), verified: z.boolean(), verifiedAt: z.string().nullish() })
  .openapi("PayoutAccount", { description: "Never includes the full account number." });

export const banks = defineRoute({
  method: "get",
  path: "/payments/banks",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Nigerian banks (from Paystack, kept for 24 hours)",
  responses: { 200: dataResponse(z.array(Bank), "Banks, A to Z."), ...errorResponses(400, 401, 503), ...commonErrors },
});

export const resolveAccount = defineRoute({
  method: "post",
  path: "/payments/bank-account/resolve",
  tags,
  security: signedIn,
  middleware: [requireUser, resolveLimit] as const,
  summary: "Whose account is this? (Paystack's answer, for the owner to confirm)",
  request: { body: jsonBody(account.openapi("ResolveAccountRequest")) },
  responses: {
    200: dataResponse(z.object({ accountName: z.string(), bankName: z.string(), accountLast4: z.string() }).openapi("ResolvedAccount"), "The name on the account."),
    ...errorResponses(400, 401, 415, 429, 503),
    ...commonErrors,
  },
});

export const saveMyAccount = defineRoute({
  method: "put",
  path: "/shops/mine/payout-account",
  tags,
  security: signedIn,
  middleware: [requireUser, saveLimit] as const,
  summary: "Save the shop's payout account (the name must be confirmed)",
  description:
    "Checks the account with Paystack again, requires the name the owner confirmed to match, creates the transfer recipient and saves it. " +
    "A change after an earlier account is notified to the vendor and to admins. 5 attempts per hour. The full account number is never returned.",
  request: { body: jsonBody(account.extend({ confirmedAccountName: z.string().min(2).max(200) }).openapi("SavePayoutAccountRequest")) },
  responses: { 200: dataResponse(Saved, "Saved and verified."), ...errorResponses(400, 401, 404, 415, 429, 503), ...commonErrors },
});

export const myAccount = defineRoute({
  method: "get",
  path: "/shops/mine/payout-account",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "The shop's payout account (last 4 digits only)",
  responses: { 200: dataResponse(Saved, "The account and whether it is verified."), ...errorResponses(401, 404), ...commonErrors },
});

export const unverifiedShops = defineRoute({
  method: "get",
  path: "/admin/payout-accounts/unverified",
  tags,
  security: signedIn,
  middleware: [requireUser] as const,
  summary: "Shops without a verified payout account (admins)",
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }) },
  responses: {
    200: dataResponse(
      z.object({ total: z.number().int(), shops: z.array(z.object({ vendor_id: z.string(), business_name: z.string().nullable(), verification_status: z.string().nullable(), has_bank_details: z.boolean() })) }).openapi("UnverifiedPayoutAccounts"),
      "The shops, oldest first.",
    ),
    ...errorResponses(400, 401, 403),
    ...commonErrors,
  },
});
