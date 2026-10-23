import crypto from "node:crypto";
import type { DataContext, Identity } from "../../database/context.js";
import { BillingRepository } from "../../database/repositories/billing.repository.js";
import { CommissionRepository } from "../../database/repositories/commission.repository.js";
import { PaystackLedgerRepository } from "../../database/repositories/paystack-ledger.repository.js";
import { VendorFeesRepository } from "../../database/repositories/vendor-fees.repository.js";
import { VendorsRepository } from "../../database/repositories/vendors.repository.js";
import { PaystackRejected, PaystackUnavailable, PaystackUnknownOutcome, getPaystackClient, koboToNaira, nairaToKobo } from "../../integrations/paystack/index.js";
import { badRequest, conflict, featureDisabled, forbidden, notFound, serviceUnavailable } from "../../shared/errors/app-error.js";
import { MONTHLY_LISTING_NAIRA } from "../vendor-payments/listing-payment.service.js";
import { PaystackWebhookService } from "../paystack-webhook/paystack-webhook.service.js";

type ListingKind = "product" | "package";
/** An attempt whose Paystack link was made less than this long ago is handed out again instead of starting a new one. */
const REUSE_SECONDS = 25 * 60;
/** An attempt that has no link yet is still being set up for this long (a second tap must wait). */
const SETTING_UP_SECONDS = 90;

interface Started {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
  amountNaira: number;
}

function paidUp(l: { billing_status?: string | null; billing_paid_until?: string | null }): boolean {
  return l.billing_status === "active" && !!l.billing_paid_until && new Date(l.billing_paid_until).getTime() > Date.now();
}

/**
 * Levromart's own fees through Paystack (issue #100): a vendor's owed commission and the ₦999 monthly listing fee.
 * They run on the same client, ledger and webhook as order payments. The amounts are exactly what the old flows charged
 * (no Paystack fee is added on top: that is a decision for the founder), and the webhook settles them with the same code
 * as before (`settleReference` for commission, `settleListingPaymentFromWebhook` for listings), so the outcome is identical.
 */
export class VendorFeesService {
  constructor(
    private readonly db: () => DataContext,
    private readonly enabled: boolean,
  ) {}

  /** Pay all owed commission by card. A double tap gets the same link back. */
  async initializeCommission(me: Identity, appOrigin: string): Promise<Started> {
    if (!this.enabled) throw featureDisabled("Paystack checkout");
    const step = await this.db().asService(async (tx) => {
      const fees = new VendorFeesRepository(tx);
      const shop = await fees.ownShop(me.userId);
      if (!shop) throw notFound("You do not have a shop yet.");
      await fees.lock("commission:" + shop.id);
      const commission = new CommissionRepository(tx);
      const owed = await commission.owedRounded(shop.id);
      if (!(Number(owed) > 0)) throw badRequest("No commission currently owed.");
      const amountKobo = nairaToKobo(Number(owed));

      const ledger = new PaystackLedgerRepository(tx);
      for (const open of await fees.openAttempts("commission", shop.id, null)) {
        if (BigInt(open.amount_kobo) === BigInt(amountKobo) && open.authorization?.authorization_url && open.age_seconds < REUSE_SECONDS) {
          return { reuse: { reference: open.reference, authorization: open.authorization, amountKobo }, fresh: null };
        }
        if (!open.authorization && open.age_seconds < SETTING_UP_SECONDS) throw conflict("Your payment is being set up. Please try again in a moment.");
        await ledger.setTransactionStatus(open.reference, "abandoned", ["initialized"]);
      }
      const reference = `commission_${crypto.randomUUID().replace(/-/g, "")}`;
      await commission.createSettlement(shop.id, owed, reference);
      await fees.insertAttempt({ reference, purpose: "commission", vendorId: shop.id, payerUserId: me.userId, amountKobo });
      const email = me.email ?? (await fees.email(me.userId))?.email ?? null;
      return { reuse: null, fresh: { reference, amountKobo, email, vendorId: shop.id } };
    });
    if (step.reuse) return started(step.reuse.reference, step.reuse.authorization.authorization_url ?? "", step.reuse.authorization.access_code ?? "", step.reuse.amountKobo);
    const f = step.fresh!;
    if (!f.email) {
      await this.abandon(f.reference);
      throw badRequest("Add an email address to your account before paying.");
    }
    return this.startOnPaystack(f.reference, {
      email: f.email,
      amountKobo: f.amountKobo,
      reference: f.reference,
      callbackUrl: `${appOrigin}/?commissionPaid=1&reference=${encodeURIComponent(f.reference)}`,
      metadata: { purpose: "levromart_commission", vendor_id: f.vendorId, user_id: me.userId },
    });
  }

  /** Pay the ₦999 monthly fee of one listing by card. */
  async initializeListing(me: Identity, kind: ListingKind, listingId: string, appOrigin: string): Promise<Started | { alreadyActive: true; paidUntil: string | null }> {
    if (!this.enabled) throw featureDisabled("Paystack checkout");
    const table = kind === "product" ? "products" : "vendor_packages";
    const amountKobo = nairaToKobo(MONTHLY_LISTING_NAIRA);

    // 1. an earlier attempt that is still open: ask Paystack first, so a payment that already went through is never charged twice
    const stale = await this.db().asService(async (tx) => {
      const listing = await new BillingRepository(tx).listing(table, { id: listingId }, true);
      if (!listing) throw notFound("Listing not found.");
      const open = await new VendorFeesRepository(tx).openAttempts("listing_fee", listing.vendor_id, listing.id);
      return open.filter((o) => !(o.authorization?.authorization_url && o.age_seconds < REUSE_SECONDS));
    });
    for (const o of stale) {
      try {
        await new PaystackWebhookService(this.db).confirmByReference(o.reference);
      } catch {
        /* Paystack cannot be asked right now: the old attempt is replaced below only if it is still open */
      }
    }

    const step = await this.db().asService(async (tx) => {
      const fees = new VendorFeesRepository(tx);
      const billing = new BillingRepository(tx);
      const listing = await billing.listing(table, { id: listingId }, true);
      if (!listing) throw notFound("Listing not found.");
      const ownerId = await new VendorsRepository(tx).ownerOf(listing.vendor_id);
      if (!ownerId || String(ownerId) !== me.userId) throw forbidden("You can only pay for your own listing.");
      if (listing.billing_model !== "monthly") throw badRequest("This listing is not using monthly billing.");
      await fees.lock("listing:" + listing.id);
      if (paidUp(listing)) return { already: listing.billing_paid_until ?? null, reuse: null, fresh: null };

      const ledger = new PaystackLedgerRepository(tx);
      for (const open of await fees.openAttempts("listing_fee", listing.vendor_id, listing.id)) {
        if (open.authorization?.authorization_url && open.age_seconds < REUSE_SECONDS) {
          return { already: null, reuse: { reference: open.reference, authorization: open.authorization }, fresh: null };
        }
        if (!open.authorization && open.age_seconds < SETTING_UP_SECONDS) throw conflict("Your payment is being set up. Please try again in a moment.");
        await ledger.setTransactionStatus(open.reference, "abandoned", ["initialized"]);
      }
      const reference = `levro_listing_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
      // as before: the listing waits for payment (paused) and remembers the reference; the webhook activates it
      await billing.updateListing(table, { id: listing.id, vendorId: listing.vendor_id }, { billingStatus: "pending_payment", billingReference: reference, status: "paused" });
      await billing.insertListingIntent({ reference, userId: me.userId, vendorId: listing.vendor_id, listingId: listing.id, kind, amountNaira: MONTHLY_LISTING_NAIRA }).catch(() => undefined);
      await fees.insertAttempt({ reference, purpose: "listing_fee", vendorId: listing.vendor_id, listingId: listing.id, listingKind: kind, payerUserId: me.userId, amountKobo });
      const email = me.email ?? (await fees.email(me.userId))?.email ?? null;
      return { already: null, reuse: null, fresh: { reference, email, vendorId: listing.vendor_id, before: { billingStatus: listing.billing_status, status: listing.status } } };
    });

    if (step.already !== null) return { alreadyActive: true, paidUntil: step.already };
    if (step.reuse) return started(step.reuse.reference, step.reuse.authorization.authorization_url ?? "", step.reuse.authorization.access_code ?? "", amountKobo);
    const f = step.fresh!;
    const undo = async () => {
      await this.abandon(f.reference);
      await this.db()
        .asService((tx) =>
          new BillingRepository(tx).updateListing(table, { id: listingId, vendorId: f.vendorId }, { billingStatus: f.before.billingStatus || "pending_payment", billingReference: null, status: f.before.status || "paused" }),
        )
        .catch(() => undefined);
    };
    if (!f.email) {
      await undo();
      throw badRequest("Add an email address to your account before paying for a listing.");
    }
    try {
      return await this.startOnPaystack(f.reference, {
        email: f.email,
        amountKobo,
        reference: f.reference,
        callbackUrl: `${appOrigin}/?listingPayment=return&listingPaid=1&reference=${encodeURIComponent(f.reference)}&kind=${kind}&id=${encodeURIComponent(listingId)}`,
        metadata: { purpose: "levromart_listing_monthly", kind, listing_id: listingId, vendor_id: f.vendorId, user_id: me.userId, amount_naira: MONTHLY_LISTING_NAIRA },
      });
    } catch (err) {
      await undo();
      throw err;
    }
  }

  /* ------------------------------------------------------------------ helpers */

  private async startOnPaystack(reference: string, input: Parameters<ReturnType<typeof getPaystackClient>["initializeTransaction"]>[0]): Promise<Started> {
    try {
      const s = await getPaystackClient().initializeTransaction(input);
      await this.db().asService((tx) => new PaystackLedgerRepository(tx).storeAuthorization(reference, { authorization_url: s.authorization_url, access_code: s.access_code }));
      return started(reference, s.authorization_url, s.access_code, input.amountKobo);
    } catch (err) {
      if (err instanceof PaystackRejected) {
        await this.abandon(reference);
        throw badRequest(err.message);
      }
      if (err instanceof PaystackUnknownOutcome || err instanceof PaystackUnavailable) {
        await this.abandon(reference);
        throw serviceUnavailable("Paystack could not be reached. Please try again in a moment.");
      }
      throw err;
    }
  }

  private async abandon(reference: string): Promise<void> {
    await this.db()
      .asService((tx) => new PaystackLedgerRepository(tx).setTransactionStatus(reference, "abandoned", ["initialized"]))
      .catch(() => undefined);
  }
}

function started(reference: string, authorizationUrl: string, accessCode: string, amountKobo: number): Started {
  return { authorizationUrl, accessCode, reference, amountNaira: koboToNaira(amountKobo) };
}

