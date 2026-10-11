import { getDataContext } from "../../database/index.js";
import { BillingRepository, type ListingRow, type ListingTable } from "../../database/repositories/billing.repository.js";
import { UsersRepository } from "../../database/repositories/users.repository.js";
import { VendorsRepository } from "../../database/repositories/vendors.repository.js";
import { isUuid } from "../../lib/format.js";
import { identityFromAccessToken } from "../auth/caller.js";
import { initializeTransaction, verifyTransaction, type PaystackTransaction } from "../../integrations/paystack.js";
import { requireEnv } from "../../config/env.js";
import { addOneCalendarMonth } from "../../lib/format.js";
import type { ServiceResult } from "../../shared/types/service.js";

/**
 * The individual ₦999-per-month listing activation paid by card through
 * Paystack (products and packages on the "monthly" billing model).
 *
 * Every confirmation path (Paystack redirect, browser retry, webhook) is
 * idempotent: a listing already active and paid up is never extended twice.
 */

export const MONTHLY_LISTING_NAIRA = 999;
export const MONTHLY_LISTING_KOBO = MONTHLY_LISTING_NAIRA * 100;

type ListingKind = "product" | "package";

function tableFor(kind: ListingKind): ListingTable {
  return kind === "product" ? "products" : "vendor_packages";
}

function isPaidUp(listing: Pick<ListingRow, "billing_status" | "billing_paid_until">): boolean {
  return (
    listing.billing_status === "active" &&
    !!listing.billing_paid_until &&
    new Date(listing.billing_paid_until).getTime() > Date.now()
  );
}

/* ------------------------------------------------------------ Paystack check */

type VerifyOutcome =
  | { ok: true; tx: PaystackTransaction }
  | { ok: false; reason: string; message: string; paystackStatus?: string; httpStatus?: number };

export async function paystackVerifyListing(reference: string): Promise<VerifyOutcome> {
  const { res, json } = await verifyTransaction(reference, "lenient");
  const tx = json?.data;
  if (!res.ok || !json?.status) {
    return { ok: false, reason: "verification", message: json?.message || "Paystack verification failed.", paystackStatus: tx?.status || "unknown" };
  }
  if (tx?.status !== "success") {
    return { ok: false, reason: "pending", message: "Paystack has not confirmed this ₦999 listing payment yet.", paystackStatus: tx?.status || "pending" };
  }
  if (Number(tx.amount) !== MONTHLY_LISTING_KOBO) {
    return { ok: false, reason: "amount", message: "The verified Paystack amount is not ₦999.", paystackStatus: tx.status };
  }
  return { ok: true, tx };
}

/* ----------------------------------------------------------- activation core */

async function findListingForReference(reference: string, tx: PaystackTransaction, expectedListingId?: string) {
  const data = getDataContext();
  const metadata = (tx?.metadata || {}) as Record<string, unknown>;
  const kind: ListingKind | null = metadata?.kind === "package" ? "package" : metadata?.kind === "product" ? "product" : null;
  let listingId = metadata?.listing_id ? String(metadata.listing_id) : null;
  const vendorId = metadata?.vendor_id ? String(metadata.vendor_id) : null;
  if (expectedListingId) listingId = String(expectedListingId);

  const tables: ListingTable[] = kind ? [tableFor(kind)] : ["products", "vendor_packages"];
  for (const table of tables) {
    // A malformed id simply matches nothing (PostgREST answered with an error, read as "no rows").
    if (listingId && !isUuid(listingId)) continue;
    const listing = await data
      .asService((db) => new BillingRepository(db).listing(table, listingId ? { id: listingId } : { reference }))
      .catch(() => null);
    if (listing) {
      const inferredKind: ListingKind = table === "products" ? "product" : "package";
      if (metadata?.kind && metadata.kind !== inferredKind) continue;
      if (vendorId && String(listing.vendor_id) !== vendorId) continue;
      return { table, kind: inferredKind, listing, vendorId: String(listing.vendor_id) };
    }
  }
  return null;
}

export type ActivationOutcome =
  | { ok: true; kind: ListingKind; listingId: string; paidUntil: string; alreadyActive?: boolean }
  | { ok: false; reason: string; message: string; paystackStatus?: string; httpStatus?: number };

export async function verifyAndActivateListing(
  reference: string,
  authUserId: string | null,
  options: { expectedListingId?: string } = {},
): Promise<ActivationOutcome> {
  const verified = await paystackVerifyListing(reference);
  if (!verified.ok) return verified;

  const tx = verified.tx;
  const found = await findListingForReference(reference, tx, options.expectedListingId);
  if (!found) return { ok: false, reason: "listing", message: "The successful Paystack payment is not linked to a pending monthly listing." };

  const { table, kind, listing, vendorId } = found;
  const metadata = (tx?.metadata || {}) as Record<string, unknown>;
  const data = getDataContext();

  if (authUserId) {
    const ownerId = await data.asService((db) => new VendorsRepository(db).ownerOf(vendorId)).catch(() => null);
    if (!ownerId || String(ownerId) !== String(authUserId)) {
      return { ok: false, reason: "owner", httpStatus: 403, message: "This payment does not belong to your vendor listing." };
    }
  }
  if (metadata?.listing_id && String(metadata.listing_id) !== String(listing.id)) {
    return { ok: false, reason: "listing", message: "The Paystack payment is linked to a different listing." };
  }
  if (metadata?.vendor_id && String(metadata.vendor_id) !== String(vendorId)) {
    return { ok: false, reason: "vendor", message: "The Paystack payment is linked to a different vendor." };
  }
  if (listing.billing_model !== "monthly") {
    return { ok: false, reason: "billing", message: "This listing is not configured for monthly activation." };
  }

  // Idempotent: a webhook/callback/browser retry can safely confirm the same payment.
  if (isPaidUp(listing)) return { ok: true, kind, listingId: listing.id, paidUntil: String(listing.billing_paid_until), alreadyActive: true };

  // A pending payment's reference must still belong to this listing.
  if (String(listing.billing_reference || "") !== String(reference)) {
    return { ok: false, reason: "reference", message: "The Paystack payment was successful, but its listing reference no longer matches. No new charge was made." };
  }

  const now = new Date();
  const currentPaid = listing.billing_paid_until ? new Date(listing.billing_paid_until) : null;
  const base = currentPaid && currentPaid.getTime() > now.getTime() ? currentPaid : now;
  const paidUntil = addOneCalendarMonth(base).toISOString();

  try {
    await data.asService((db) =>
      new BillingRepository(db).updateListing(
        table,
        { id: listing.id, vendorId, reference },
        { status: "active", billingStatus: "active", billingPaidUntil: paidUntil, billingReference: null },
      ),
    );
  } catch (err) {
    console.error("[vendor-payments] listing activation update failed", err);
    return { ok: false, reason: "activation", message: "Paystack confirmed the payment, but the listing could not be activated yet. Do not pay again." };
  }

  await markIntentPaid(reference);
  return { ok: true, kind, listingId: listing.id, paidUntil };
}

/** Marks the optional listing_payment_intents row paid; failures are ignored. */
async function markIntentPaid(reference: string): Promise<void> {
  try {
    await getDataContext().asService((db) => new BillingRepository(db).markListingIntentPaid(reference, new Date().toISOString()));
  } catch {
    /* reconciliation record only */
  }
}

/** Webhook path: activates the listing named in the Paystack metadata. Throws on mismatch (-> 500, Paystack retries). */
export async function settleListingPaymentFromWebhook(reference: string, metadata: Record<string, unknown>): Promise<void> {
  const data = getDataContext();
  const table: ListingTable = metadata.kind === "product" ? "products" : "vendor_packages";
  const listingId = String(metadata.listing_id);
  const vendorId = String(metadata.vendor_id);

  const listing =
    isUuid(listingId) && isUuid(vendorId)
      ? await data.asService((db) => new BillingRepository(db).listing(table, { id: listingId, vendorId })).catch(() => null)
      : null;

  if (!listing || listing.billing_model !== "monthly") throw new Error("Monthly listing not found for Paystack reference.");
  if (isPaidUp(listing)) return;
  if (String(listing.billing_reference || "") !== String(reference)) {
    throw new Error("Paystack reference does not match the listing's pending activation.");
  }

  const now = new Date();
  const baseDate = listing.billing_paid_until && new Date(listing.billing_paid_until).getTime() > now.getTime() ? new Date(listing.billing_paid_until) : now;
  try {
    await data.asService((db) =>
      new BillingRepository(db).updateListing(
        table,
        { id: listingId, vendorId, reference },
        { status: "active", billingStatus: "active", billingPaidUntil: addOneCalendarMonth(baseDate).toISOString(), billingReference: null },
      ),
    );
  } catch {
    throw new Error("Could not activate the paid listing.");
  }
  await markIntentPaid(reference);
}

/* ------------------------------------------------------------- start payment */

export async function startListingPayment(body: Record<string, unknown>, origin: string): Promise<ServiceResult> {
  requireEnv("PAYSTACK_SECRET_KEY");

  if (!body?.accessToken || !body?.kind || !body?.id) return { status: 400, body: { error: "A listing and signed-in session are required." } };
  if (!["product", "package"].includes(String(body.kind))) return { status: 400, body: { error: "Invalid listing type." } };
  const kind = body.kind as ListingKind;

  const identity = await identityFromAccessToken(String(body.accessToken));
  if (!identity) return { status: 401, body: { error: "Your session expired. Please log in again." } };
  const me = { id: identity.userId, email: identity.email };

  const data = getDataContext();
  const table = tableFor(kind);
  const listingId = String(body.id);
  const listing = isUuid(listingId) ? await data.asService((db) => new BillingRepository(db).listing(table, { id: listingId }, true)).catch(() => null) : null;
  if (!listing) return { status: 404, body: { error: "Listing not found." } };

  const ownerId = await data.asService((db) => new VendorsRepository(db).ownerOf(listing.vendor_id)).catch(() => null);
  if (!ownerId || String(ownerId) !== String(me.id)) return { status: 403, body: { error: "You can only pay for your own listing." } };
  if (listing.billing_model !== "monthly") return { status: 400, body: { error: "This listing is not using monthly billing." } };

  // Already paid and still within its billing period.
  if (isPaidUp(listing)) return { status: 200, body: { alreadyActive: true } };

  const user = await data.asService((db) => new UsersRepository(db).emailAndName(me.id)).catch(() => null);
  const email = user?.email || me.email;
  if (!email) return { status: 400, body: { error: "Add an email address to your account before paying for a listing." } };

  // A listing already waiting on a reference: verify that exact transaction
  // first. A successful one is activated; a pending one is never replaced, so
  // the vendor cannot be charged twice.
  if (listing.billing_status === "pending_payment" && listing.billing_reference) {
    const existingCheck = await paystackVerifyListing(listing.billing_reference);
    if (existingCheck.ok) {
      const settled = await verifyAndActivateListing(listing.billing_reference, me.id, { expectedListingId: listing.id });
      if (settled.ok) return { status: 200, body: { alreadyActive: true, paidUntil: settled.paidUntil } };
    } else if (["pending", "ongoing", "queued"].includes(String(existingCheck.paystackStatus))) {
      return {
        status: 409,
        body: {
          error: "This listing already has a Paystack payment being processed. Please wait a moment and try again; you will not be charged twice.",
          reference: listing.billing_reference,
        },
      };
    }
    // Failed/abandoned/unknown old references may be replaced safely.
  }

  const reference = `levro_listing_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const match = { id: listing.id, vendorId: listing.vendor_id };

  // Mark the listing as awaiting payment before sending the vendor to Paystack.
  try {
    await data.asService((db) => new BillingRepository(db).updateListing(table, match, { billingStatus: "pending_payment", billingReference: reference, status: "paused" }));
  } catch {
    return { status: 500, body: { error: "Could not prepare the listing for payment." } };
  }

  // Server-side intent record for reconciliation. Its own transaction: a
  // failure here never affects the payment. (The previous code omitted the
  // required user_id, so this record was never actually written.)
  try {
    await data.asService((db) =>
      new BillingRepository(db).insertListingIntent({ reference, userId: me.id, vendorId: listing.vendor_id, listingId: listing.id, kind, amountNaira: MONTHLY_LISTING_NAIRA }),
    );
  } catch {
    /* reconciliation record only */
  }

  const { res: initRes, json: initJson } = await initializeTransaction(
    {
      email,
      amount: MONTHLY_LISTING_KOBO,
      currency: "NGN",
      reference,
      callback_url: `${origin}/api/vendor-payments?purpose=listing&reference=${encodeURIComponent(reference)}`,
      metadata: {
        purpose: "levromart_listing_monthly",
        kind,
        listing_id: listing.id,
        vendor_id: listing.vendor_id,
        user_id: me.id,
        amount_naira: MONTHLY_LISTING_NAIRA,
      },
    },
    "lenient",
  );

  if (!initRes.ok || !initJson.status || !initJson.data?.authorization_url) {
    // Payment could not be started: restore the previous listing state.
    await data
      .asService((db) =>
        new BillingRepository(db).updateListing(table, match, { billingStatus: listing.billing_status || "pending_payment", billingReference: null, status: listing.status || "paused" }),
      )
      .catch(() => undefined);
    return { status: 502, body: { error: initJson.message || "Paystack could not start the listing payment." } };
  }

  return { status: 200, body: { authorization_url: initJson.data.authorization_url, reference, amount: MONTHLY_LISTING_NAIRA } };
}

/* ------------------------------------------------- browser confirmation paths */

/** Paystack redirect target (GET). Always answers with a redirect back into the app. */
export async function finishListingPaymentRedirect(reference: string, base: string): Promise<string> {
  try {
    const result = await verifyAndActivateListing(reference, null);
    if (!result.ok) {
      return `${base}/?listingPayment=failed&reference=${encodeURIComponent(reference)}&reason=${encodeURIComponent(result.reason || "verification")}`;
    }
    return `${base}/?listingPayment=return&listingPaid=1&reference=${encodeURIComponent(reference)}&kind=${encodeURIComponent(result.kind)}&id=${encodeURIComponent(result.listingId)}`;
  } catch (err) {
    console.error("[vendor-payments callback]", err);
    return `${base}/?listingPayment=failed&reference=${encodeURIComponent(reference)}&reason=server`;
  }
}

export async function verifyListingPayment(body: Record<string, unknown>): Promise<ServiceResult> {
  if (!body?.reference || !body?.accessToken) return { status: 400, body: { error: "reference and accessToken are required" } };
  const me = await identityFromAccessToken(String(body.accessToken));
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const result = await verifyAndActivateListing(String(body.reference), me.userId);
  if (!result.ok) {
    return {
      status: result.httpStatus || 400,
      body: { error: result.message || "Paystack has not confirmed this ₦999 listing payment yet.", status: result.paystackStatus || "pending" },
    };
  }
  return { status: 200, body: { status: "success", kind: result.kind, listingId: result.listingId, paidUntil: result.paidUntil } };
}

/** Legacy paid-draft flow: consumes a payment only after Paystack reports success. */
export async function consumeListingPayment(body: Record<string, unknown>): Promise<ServiceResult> {
  if (!body?.reference || !body?.listingId || !body?.accessToken) {
    return { status: 400, body: { error: "reference, listingId and accessToken are required" } };
  }
  const me = await identityFromAccessToken(String(body.accessToken));
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const result = await verifyAndActivateListing(String(body.reference), me.userId, { expectedListingId: String(body.listingId) });
  if (!result.ok) return { status: result.httpStatus || 400, body: { error: result.message || "Payment could not be verified." } };
  return { status: 200, body: { status: "success", listingId: result.listingId, paidUntil: result.paidUntil } };
}
