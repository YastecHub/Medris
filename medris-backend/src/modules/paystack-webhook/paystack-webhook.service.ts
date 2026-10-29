import { REFUND_TRANSFER_PREFIX, applyRefundTransferEvent } from "../buyer-wallet/buyer-wallet.service.js";
import { notifyPayoutSent } from "../vendor-payouts/vendor-payouts.service.js";
import crypto from "node:crypto";
import { requireEnv } from "../../config/env.js";
import type { DataContext } from "../../database/context.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { PaymentsRepository } from "../../database/repositories/orders.repository.js";
import { PaymentClaimsRepository } from "../../database/repositories/payment-claims.repository.js";
import { PaystackLedgerRepository, type LedgerTransaction } from "../../database/repositories/paystack-ledger.repository.js";
import {
  PaystackUnavailable,
  PaystackUnknownOutcome,
  getPaystackClient,
  verifyWebhookSignature,
  type PaystackTransactionData,
} from "../../integrations/paystack/index.js";
import type { ServiceResult } from "../../shared/types/service.js";
import { PaymentClaimsService } from "../payment-claims/payment-claims.service.js";
import { settleReference } from "../payments/settlement.service.js";
import { MONTHLY_LISTING_KOBO, settleListingPaymentFromWebhook } from "../vendor-payments/listing-payment.service.js";
import { canMovePayout, canMoveRefund } from "./paystack-state.js";

const REPAIRABLE = ["pending", "confirmed", "payment_unresolved", "handed_over"];

type Tx = Parameters<Parameters<DataContext["asService"]>[0]>[0];
type Obj = Record<string, unknown>;

interface PaystackEvent {
  event?: string;
  data?: Obj;
}

/**
 * The one place Paystack tells Levromart what happened (issue #94).
 *
 *  - the signature is checked on the raw body before anything is parsed;
 *  - every event is recorded in paystack_events, and handled once (a repeat answers 200 and does nothing);
 *  - for `charge.success` the amount is never taken from the event: Paystack is asked (verify), and the amount
 *    and currency are compared with what we recorded for that payment;
 *  - records only move forward (see paystack-state.ts), so late or repeated events cannot undo a newer state;
 *  - a verify that cannot finish leaves the event unprocessed; the reconciliation job (below) settles it later.
 */
export class PaystackWebhookService {
  constructor(private readonly db: () => DataContext) {}

  /* ---------------------------------------------------------------- webhook */

  async handle(rawBody: string, signature: string | undefined): Promise<ServiceResult> {
    if (!verifyWebhookSignature(rawBody, signature, requireEnv("PAYSTACK_SECRET_KEY"))) return { status: 401, body: { error: "Invalid signature" } };
    let event: PaystackEvent;
    try {
      event = JSON.parse(rawBody) as PaystackEvent;
    } catch {
      return { status: 400, body: { error: "Invalid JSON" } };
    }
    const name = String(event.event ?? "");
    const data = (event.data ?? {}) as Obj;
    const key = eventKey(name, data, rawBody);
    const reference = referenceOf(name, data);

    // Ask Paystack before opening the database transaction: never hold a transaction open during a network call.
    let verified: PaystackTransactionData | null = null;
    let verifyProblem: string | null = null;
    if (name === "charge.success" && reference) {
      try {
        verified = await getPaystackClient().verifyTransaction(reference);
      } catch (err) {
        if (err instanceof PaystackUnknownOutcome || err instanceof PaystackUnavailable) verifyProblem = "verify_unavailable";
        else verifyProblem = "verify_rejected";
      }
    }

    try {
      const outcome = await this.db().asService(async (tx) => {
        const ledger = new PaystackLedgerRepository(tx);
        await ledger.lockEvent(key);
        const row = await ledger.recordEvent(key, name, reference);
        if (row.processed_at && !retryable(row, name)) return { result: "duplicate" };
        if (verifyProblem) {
          await ledger.finishEvent(row.id, verifyProblem, "Could not confirm the payment with Paystack yet.");
          return { result: verifyProblem };
        }
        const result = await this.apply(tx, ledger, name, data, verified, Boolean(row.processed_at));
        await ledger.finishEvent(row.id, result);
        return { result };
      });
      return { status: 200, body: { received: true, result: outcome.result } };
    } catch (err) {
      // Not recorded as processed: Paystack will send it again. Keep the reason so an admin can see it.
      const message = err instanceof Error ? err.message : "unknown error";
      console.error("[paystack-webhook]", message);
      await this.db()
        .asService(async (tx) => {
          const ledger = new PaystackLedgerRepository(tx);
          const row = await ledger.recordEvent(key, name, reference);
          if (!row.processed_at) await ledger.finishEvent(row.id, "error", message.slice(0, 300));
        })
        .catch(() => undefined);
      return { status: 500, body: { error: "Could not process the event" } };
    }
  }

  /* ------------------------------------------------------------ event types */

  private async apply(tx: Tx, ledger: PaystackLedgerRepository, name: string, data: Obj, verified: PaystackTransactionData | null, alerted = false): Promise<string> {
    switch (name) {
      case "charge.success":
        return this.chargeSuccess(tx, ledger, verified, data, alerted);
      case "transfer.success":
        return this.transferEvent(tx, ledger, data, "success");
      case "transfer.failed":
        return this.transferEvent(tx, ledger, data, "failed");
      case "transfer.reversed":
        return this.transferEvent(tx, ledger, data, "reversed");
      case "refund.processed":
        return this.refundEvent(tx, ledger, data, "processed");
      case "refund.failed":
        return this.refundEvent(tx, ledger, data, "failed");
      case "charge.dispute.create":
      case "charge.dispute.remind":
      case "charge.dispute.resolve":
        return this.disputeEvent(tx, ledger, name, data);
      default:
        return "ignored: unknown event";
    }
  }

  /**
   * A payment Paystack says succeeded (`verified` is Paystack's own answer, not the event's). `alerted`: this payment was
   * already held back for its amount, so admins are not told again each time it is looked at.
   */
  private async chargeSuccess(tx: Tx, ledger: PaystackLedgerRepository, verified: PaystackTransactionData | null, event: Obj, alerted = false): Promise<string> {
    const reference = String(verified?.reference ?? event.reference ?? "");
    if (!verified || !reference) return "ignored: no reference";
    if (verified.status !== "success") return `ignored: paystack says ${String(verified.status)}`;

    const recorded = await ledger.transactionByReference(reference);
    if (recorded) {
      const mismatch = amountProblem(recorded, verified);
      if (mismatch) {
        if (alerted) return "amount_mismatch";
        await new NotificationWriter(tx).notifyAdmins(
          "Payment amount does not match",
          `Paystack reports ${mismatch} for payment ${reference}. The order was not settled. Please check it in the Paystack dashboard.`,
          null,
          { reference },
          null,
        );
        return "amount_mismatch";
      }
      const first = await ledger.markTransactionSuccess(reference, {
        paystackId: typeof verified.id === "number" ? verified.id : null,
        channel: typeof verified.channel === "string" ? verified.channel : null,
        paidAt: typeof verified.paid_at === "string" ? verified.paid_at : null,
      });
      if (!first) return "duplicate: already settled";
    }
    if (recorded?.order_id && (recorded.purpose === "order_payment" || recorded.purpose === "order_balance")) {
      await restoreCardPaymentRow(tx, recorded.order_id, reference, verified);
    }
    await this.settle(tx, reference, verified);
    // an order payment started in the app: move the order on and tell both sides, like a confirmed transfer
    if (recorded?.order_id && (recorded.purpose === "order_payment" || recorded.purpose === "order_balance")) {
      await new PaymentClaimsService(this.db).applyConfirmedCardPayment(tx, recorded.order_id, reference);
    }
    return recorded ? "settled" : "settled (legacy reference)";
  }

  /** The same routing the old webhook used: a ₦999 listing, otherwise commission, billing or an order payment. */
  private async settle(db: Tx, reference: string, tx: PaystackTransactionData): Promise<void> {
    const metadata = (tx.metadata ?? {}) as Obj;
    if (
      metadata.purpose === "levromart_listing_monthly" &&
      metadata.listing_id &&
      metadata.vendor_id &&
      (metadata.kind === "product" || metadata.kind === "package") &&
      tx.status === "success" &&
      Number(tx.amount) === MONTHLY_LISTING_KOBO
    ) {
      await settleListingPaymentFromWebhook(reference, metadata, db);
    } else {
      await settleReference(reference, tx, db);
    }
  }

  private async transferEvent(tx: Tx, ledger: PaystackLedgerRepository, data: Obj, to: "success" | "failed" | "reversed"): Promise<string> {
    const reference = String(data.reference ?? "");
    if (reference.startsWith(REFUND_TRANSFER_PREFIX)) {
      const done = await applyRefundTransferEvent(tx, reference, to, String(data.reason ?? data.message ?? `Transfer ${to}`).slice(0, 300));
      return done ?? "ignored: no refund withdrawal with that reference";
    }
    const payout = reference ? await ledger.payoutByReference(reference) : null;
    if (!payout) return "ignored: no payout with that reference";
    if (payout.status === to) return "duplicate: already " + to;
    if (!canMovePayout(payout.status, to)) return `ignored: out of order (${payout.status} -> ${to})`;
    await ledger.setPayout(payout.id, to, to === "success" ? null : String(data.reason ?? data.message ?? `Transfer ${to}`).slice(0, 300));
    if (to === "success") await notifyPayoutSent(tx, payout.id);
    if (to !== "success") {
      await new NotificationWriter(tx).notifyAdmins(
        to === "failed" ? "Vendor payout failed" : "Vendor payout reversed",
        `Payout ${reference} ${to}. Check it and release or hold it again.`,
        "orderDetail",
        { orderId: payout.order_id },
        null,
      );
    }
    return to;
  }

  private async refundEvent(tx: Tx, ledger: PaystackLedgerRepository, data: Obj, to: "processed" | "failed"): Promise<string> {
    const transactionReference = String(data.transaction_reference ?? (data.transaction as Obj | undefined)?.reference ?? "");
    const refund = transactionReference ? await ledger.refundForTransaction(transactionReference) : null;
    if (!refund) return "ignored: no refund recorded for that payment";
    if (refund.status === to) return "duplicate: already " + to;
    if (!canMoveRefund(refund.status, to)) return `ignored: out of order (${refund.status} -> ${to})`;
    await ledger.setRefund(refund.id, to, data.id != null ? String(data.id) : null);
    if (to === "failed") {
      await new NotificationWriter(tx).notifyAdmins("Refund failed", `Paystack could not complete the refund for payment ${transactionReference}.`, "orderDetail", { orderId: refund.order_id }, null);
    }
    return to;
  }

  private async disputeEvent(tx: Tx, ledger: PaystackLedgerRepository, name: string, data: Obj): Promise<string> {
    const reference = String((data.transaction as Obj | undefined)?.reference ?? data.transaction_reference ?? "");
    const recorded = reference ? await ledger.transactionByReference(reference) : null;
    const orderId = recorded?.order_id ?? null;
    const notify = new NotificationWriter(tx);
    if (name === "charge.dispute.resolve") {
      await notify.notifyAdmins("Card dispute resolved", `Paystack resolved the dispute on payment ${reference} (${String(data.resolution ?? data.status ?? "see dashboard")}).`, orderId ? "orderDetail" : null, orderId ? { orderId } : null, null);
      return "recorded";
    }
    let held = 0;
    if (name === "charge.dispute.create" && orderId) held = await ledger.holdPendingPayouts(orderId, "Paystack card dispute");
    const deadline = data.due_at ?? data.dueAt;
    await notify.notifyAdmins(
      name === "charge.dispute.create" ? "Card dispute opened" : "Card dispute reminder",
      `A card dispute is open on payment ${reference}${deadline ? `. Answer by ${String(deadline)}` : ""}. Upload evidence in the Paystack dashboard.`,
      orderId ? "orderDetail" : null,
      orderId ? { orderId } : null,
      null,
    );
    return held ? `recorded, ${held} payout(s) on hold` : "recorded";
  }

  /* --------------------------------------------------------- reconciliation */

  /**
   * For a webhook that never arrived: asks Paystack about payments left "initialized" for more than 15 minutes
   * and payouts left "processing" for more than 30, and settles them the way the webhook would have (same event
   * key, so a webhook that arrives later is a duplicate). Safe to run as often as you like.
   */
  async reconcile(minAgeMinutes = 15): Promise<{ payments: number; payouts: number; settled: number; problems: number }> {
    const stalePayments = await this.db().asService((tx) => new PaystackLedgerRepository(tx).staleInitializedTransactions(minAgeMinutes, 50));
    const stalePayouts = await this.db().asService((tx) => new PaystackLedgerRepository(tx).staleProcessingPayouts(30, 50));
    let settled = 0;
    let problems = 0;
    const client = getPaystackClient();

    for (const { reference } of stalePayments) {
      try {
        const v = await client.verifyTransaction(reference);
        if (v.status === "success") {
          const body = JSON.stringify({ event: "charge.success", data: { ...v } });
          const result = await this.processVerifiedCharge(eventKey("charge.success", v as Obj, body), reference, v);
          if (result.startsWith("settled")) settled++;
        } else if (v.status === "failed" || v.status === "abandoned") {
          await this.db().asService((tx) => new PaystackLedgerRepository(tx).setTransactionStatus(reference, v.status as string, ["initialized", "abandoned"]));
        }
      } catch {
        problems++; // unknown outcome: it stays initialized and is looked at again next time
      }
    }

    // order payments Paystack has, recorded as settled, whose order was never marked paid: repaired once each
    for (const { reference } of await this.db().asService((tx) => new PaystackLedgerRepository(tx).settledOrderPaymentsNotApplied(14, 20))) {
      try {
        const v = await client.verifyTransaction(reference);
        if (v.status === "success" && (await this.repairOrderPayment(reference, v))) settled++;
      } catch {
        problems++;
      }
    }

    for (const { transfer_reference } of stalePayouts) {
      try {
        const t = await client.verifyTransfer(transfer_reference);
        const to = t.status === "success" || t.status === "failed" || t.status === "reversed" ? t.status : null;
        if (!to) continue;
        const body = JSON.stringify({ event: `transfer.${to}`, data: { reference: transfer_reference } });
        await this.processEvent(`transfer.${to}`, { reference: transfer_reference }, body, null);
        settled++;
      } catch {
        problems++;
      }
    }
    return { payments: stalePayments.length, payouts: stalePayouts.length, settled, problems };
  }

  /**
   * Used when the buyer returns from Paystack (issue #95): asks Paystack and, when the payment succeeded, settles it through
   * the same steps and the same event key as the webhook, so whichever comes first wins and the other is a duplicate.
   * Throws a Paystack error when Paystack cannot be asked right now.
   */
  async confirmByReference(reference: string): Promise<{ paystackStatus: string; result: string | null }> {
    const v = await getPaystackClient().verifyTransaction(reference);
    if (v.status === "success") {
      const result = await this.processVerifiedCharge(eventKey("charge.success", v as Obj, JSON.stringify({ event: "charge.success", data: v })), reference, v);
      if (result.startsWith("duplicate")) return { paystackStatus: "success", result: (await this.repairOrderPayment(reference, v)) ?? result };
      return { paystackStatus: "success", result };
    }
    if (v.status === "failed" || v.status === "abandoned") {
      await this.db().asService((tx) => new PaystackLedgerRepository(tx).setTransactionStatus(reference, v.status as string, ["initialized", "abandoned"]));
    }
    return { paystackStatus: String(v.status ?? "unknown"), result: null };
  }

  /**
   * Paystack has the money and it was recorded as settled, but the order's payment row was never marked paid (the order still
   * shows "Confirmed" and asks to be paid): mark it paid and move the order on now, once. Null when nothing needed doing.
   */
  async repairOrderPayment(reference: string, verified: PaystackTransactionData): Promise<string | null> {
    return this.db().asService(async (tx) => {
      const t = await new PaystackLedgerRepository(tx).transactionByReference(reference);
      if (!t || t.status !== "success" || !t.order_id || (t.purpose !== "order_payment" && t.purpose !== "order_balance")) return null;
      await new PaystackLedgerRepository(tx).lockTransaction(reference);   // one repair at a time
      // only an order still waiting for its money: never bring a cancelled or finished order back
      if (!REPAIRABLE.includes(String(await new PaystackLedgerRepository(tx).orderStatus(t.order_id)))) return null;
      const claims = new PaymentClaimsRepository(tx);
      if (await claims.referencePaid(reference)) return null;
      await restoreCardPaymentRow(tx, t.order_id, reference, verified);
      if (!(await claims.paymentTypeByReference(reference))) return null;
      await new PaymentsRepository(tx).markPaidByReference(reference, new Date().toISOString());
      await new PaymentClaimsService(this.db).applyConfirmedCardPayment(tx, t.order_id, reference);
      return "settled (repaired)";
    });
  }

  private processVerifiedCharge(key: string, reference: string, verified: PaystackTransactionData): Promise<string> {
    return this.processEvent("charge.success", { reference }, "", verified, key);
  }

  /** The same steps as handle(), after the signature and the verify call. */
  private processEvent(name: string, data: Obj, rawBody: string, verified: PaystackTransactionData | null, keyOverride?: string): Promise<string> {
    const key = keyOverride ?? eventKey(name, data, rawBody);
    return this.db().asService(async (tx) => {
      const ledger = new PaystackLedgerRepository(tx);
      await ledger.lockEvent(key);
      const row = await ledger.recordEvent(key, name, referenceOf(name, data));
      if (row.processed_at && !retryable(row, name)) return "duplicate";
      const result = await this.apply(tx, ledger, name, data, verified, Boolean(row.processed_at));
      await ledger.finishEvent(row.id, result);
      return result;
    });
  }
}

/* ---------------------------------------------------------------- helpers */

/** Paystack's own id for the thing the event is about, so the same event always gets the same key. */
export function eventKey(name: string, data: Obj, rawBody: string): string {
  const id = data.id ?? data.transfer_code ?? data.reference;
  const basis = id != null ? `${name}:${String(id)}` : `${name}:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
  return basis;
}

function referenceOf(name: string, data: Obj): string | null {
  if (name.startsWith("charge.dispute")) return String((data.transaction as Obj | undefined)?.reference ?? data.transaction_reference ?? "") || null;
  if (name.startsWith("refund.")) return String(data.transaction_reference ?? (data.transaction as Obj | undefined)?.reference ?? "") || null;
  return data.reference != null ? String(data.reference) : null;
}

/** null when Paystack's amount and currency are what we recorded; otherwise a short description of the difference. */
/**
 * The buyer paid through an older link of the same order (they tapped Pay again later, which set that attempt aside and
 * removed its payment row): put the row back from what the checkout told Paystack, so the order is updated with it. The
 * newer attempt for the same payment, still waiting, is removed so the order no longer asks to be paid.
 */
async function restoreCardPaymentRow(tx: Tx, orderId: string, reference: string, verified: PaystackTransactionData): Promise<void> {
  const claims = new PaymentClaimsRepository(tx);
  if (await claims.paymentTypeByReference(reference)) return;
  const metadata = (verified.metadata ?? {}) as Obj;
  const type = typeof metadata.payment_type === "string" ? metadata.payment_type : null;
  const netKobo = Number(metadata.net_kobo);
  if (!type || !Number.isInteger(netKobo) || netKobo <= 0) return;
  await claims.insertCardPayment(orderId, type, (netKobo / 100).toFixed(2), reference);
  await claims.deleteOtherPendingCard(orderId, type, reference);
}

/**
 * A payment held back for its amount is looked at again (by the webhook, the buyer's "Check my payment" and the
 * every-minute job) instead of answering "duplicate" for ever: it settles once the amount is accepted.
 */
function retryable(row: { result: string | null }, name: string): boolean {
  return name === "charge.success" && row.result === "amount_mismatch";
}

/**
 * Whether Paystack took less than the order needs. Paystack adds its own charge on top when the dashboard is set to pass
 * fees to the customer, so `amount` can be more than we asked for: the order is still fully paid. Only a smaller amount,
 * or another currency, holds the payment back.
 */
function amountProblem(recorded: LedgerTransaction, verified: PaystackTransactionData): string | null {
  const paid = Number(verified.amount);
  if (!Number.isInteger(paid) || BigInt(paid) < BigInt(recorded.amount_kobo)) return `${String(verified.amount)} kobo instead of ${recorded.amount_kobo} kobo`;
  if (verified.currency && verified.currency !== recorded.currency) return `currency ${String(verified.currency)} instead of ${recorded.currency}`;
  return null;
}
