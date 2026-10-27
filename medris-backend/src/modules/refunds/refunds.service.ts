import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { BuyerWalletRepository } from "../../database/repositories/buyer-wallet.repository.js";
import { PaystackRefundsRepository } from "../../database/repositories/paystack-refunds.repository.js";
import { PaystackRejected, PaystackUnavailable, PaystackUnknownOutcome, getPaystackClient, koboToNaira, nairaToKobo } from "../../integrations/paystack/index.js";
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors/app-error.js";

type Tx = Parameters<Parameters<DataContext["asService"]>[0]>[0];

const naira = (kobo: number | string) => "₦" + koboToNaira(Number(kobo)).toLocaleString("en-NG", { maximumFractionDigits: 2 });
/** A payout in these states has left, or is leaving, Levromart: the money is no longer ours to give back. */
const PAID_OUT = ["processing", "success", "paid_manually"];

/**
 * Giving money back (issue #99). What can be refunded is what the buyer paid for the order through Paystack (Paystack's own
 * fee, which the buyer paid on top, is not refunded), minus refunds already made or under way, and nothing at all once the
 * vendor's payout has left. Everything is decided with the order row locked, so a refund and a payout (or two refunds)
 * can never take the same money. Paystack is called after that transaction ends, by `run()`.
 */
export class RefundsService {
  constructor(private readonly db: () => DataContext) {}

  /** Admin: refund an order (everything still refundable, or `amountNaira`). Queues the refund; the worker asks Paystack. */
  async refundOrder(me: Identity, orderId: string, input: { amountNaira?: number; reason: string }) {
    return this.db().asService(async (tx) => {
      if (!(await new AccessRepository(tx).isAdmin(me.userId))) throw forbidden("Only admins can refund an order.");
      const repo = new PaystackRefundsRepository(tx);
      const order = await repo.lockOrder(orderId);
      if (!order) throw notFound("Order not found.");
      const payout = await repo.payoutState(orderId);
      if (payout && PAID_OUT.includes(payout.status)) {
        throw conflict("The vendor has already been paid for this order. Getting money back from a vendor is done by hand: contact the vendor.");
      }
      if (await repo.openRefund(orderId)) throw conflict("A refund for this order is already under way.");

      const payments = await repo.paidPayments(orderId);
      const room = payments.map((p) => ({ reference: p.reference, left: Number(p.net_kobo) - Number(p.refunded_kobo) }));
      const refundable = room.reduce((s, p) => s + Math.max(0, p.left), 0);
      if (refundable <= 0) throw badRequest("Nothing is left to refund on this order.");
      const wanted = input.amountNaira == null ? refundable : nairaToKobo(input.amountNaira);
      if (!Number.isInteger(wanted) || wanted <= 0) throw badRequest("Enter an amount greater than zero.");
      if (wanted > refundable) throw badRequest(`You can refund at most ${naira(refundable)} on this order.`);

      let attempt = await repo.nextAttempt(orderId);
      let remaining = wanted;
      for (const p of room) {
        if (remaining <= 0) break;
        const part = Math.min(remaining, Math.max(0, p.left));
        if (part <= 0) continue;
        await repo.insert(orderId, p.reference, attempt++, part, input.reason, me.userId);
        remaining -= part;
      }
      // a payout that has not left yet must not include the money that is going back
      if (wanted === refundable) await repo.holdPayout(orderId, "The order is being fully refunded.");
      await repo.logAdminAction(me.userId, `Refunded ${naira(wanted)} through Paystack: ${input.reason}`.slice(0, 200), orderId);
      return { orderId, amount: koboToNaira(wanted), status: "pending" as const };
    });
  }

  /**
   * The scheduled job: asks Paystack to refund each queued refund, once.
   *
   * Claiming a refund and putting it in the buyer's refunds wallet happen in one transaction, and the wallet step runs in a
   * savepoint: if the wallet cannot be used (for example its tables are missing), the refund goes back onto the card as before,
   * instead of being left "processing" without ever reaching Paystack.
   */
  async run(limit = 25): Promise<{ started: number; failed: number; requeued: number }> {
    const out = { started: 0, failed: 0, requeued: 0 };
    out.requeued = await this.recoverUnconfirmed().catch((err) => {
      console.error("[paystack-refunds] could not check unconfirmed refunds:", err instanceof Error ? err.message : err);
      return 0;
    });
    for (let i = 0; i < limit; i++) {
      const step = await this.db().asService(async (tx) => {
        const repo = new PaystackRefundsRepository(tx);
        const next = await repo.nextPending();
        if (!next) return null;
        // a buyer with a refunds wallet gets the money there; everyone else gets it back on the card
        const toWallet = await tx
          .transaction((sp) => new BuyerWalletRepository(sp).creditRefund({ id: next.id, order_id: next.order_id, buyer_id: next.buyer_id, amount_kobo: next.amount_kobo }))
          .catch((err: unknown) => {
            console.error("[paystack-refunds] refunds wallet not usable, refunding to the card:", err instanceof Error ? err.message : err);
            return false;
          });
        if (toWallet) {
          await new NotificationWriter(tx).create({ userId: next.buyer_id, type: "refund_in_wallet", title: "Refund added to your wallet", body: `${naira(next.amount_kobo)} is in your refunds wallet. Open your wallet to withdraw it.`, targetView: "buyerProfile", actorId: null });
          return { work: next, toWallet: true };
        }
        // claim: flip to `processing` and commit before the call, so a second worker cannot send the same refund
        await repo.markProcessing(next.id);
        return { work: next, toWallet: false };
      });
      if (!step) break;
      if (step.toWallet) {
        out.started++;
        continue;
      }
      const work = step.work;
      try {
        const sent = await getPaystackClient().createRefund({ transaction: work.transaction_reference, amountKobo: Number(work.amount_kobo) });
        await this.db().asService(async (tx) => {
          await new PaystackRefundsRepository(tx).markSent(work.id, sent?.id != null ? String(sent.id) : null);
          await this.tellPeople(tx, work);
        });
        out.started++;
      } catch (err) {
        out.failed++;
        await this.db().asService((tx) => this.onError(tx, work, err));
      }
    }
    return out;
  }

  /**
   * Refunds left "processing" for over 30 minutes with no Paystack refund id (the job stopped half-way, or Paystack's answer
   * was lost): Paystack is asked which refunds it has for that payment. One with the same amount that is not yet matched to
   * another row is this refund (its id is kept); if there is none, the money never left and the refund goes back in the queue.
   * When Paystack cannot be asked, nothing changes. Returns how many went back in the queue.
   */
  async recoverUnconfirmed(olderThanMinutes = 30, limit = 10): Promise<number> {
    const stuck = await this.db().asService((tx) => new PaystackRefundsRepository(tx).unconfirmedProcessing(olderThanMinutes, limit));
    let requeued = 0;
    for (const r of stuck) {
      let found: { id: number | string; amount: number }[];
      try {
        found = await getPaystackClient().listRefunds(r.paystack_transaction_id);
      } catch {
        continue; // Paystack could not be asked: look again on the next run
      }
      const back = await this.db().asService(async (tx) => {
        const repo = new PaystackRefundsRepository(tx);
        const rows = await repo.lockPaymentRefunds(r.transaction_reference);
        const me = rows.find((x) => x.id === r.id);
        if (!me || me.status !== "processing" || me.paystack_refund_id) return false; // settled meanwhile
        const taken = new Set(rows.map((x) => x.paystack_refund_id).filter(Boolean) as string[]);
        const match = (found ?? []).find((f) => !taken.has(String(f.id)) && Number(f.amount) === Number(r.amount_kobo));
        if (match) {
          await repo.markSent(r.id, String(match.id));
          return false;
        }
        await repo.requeueUnsent(r.id);
        return true;
      });
      if (back) requeued++;
    }
    return requeued;
  }

  private async tellPeople(tx: Tx, w: { order_id: string; buyer_id: string; vendor_user_id: string | null; amount_kobo: string }): Promise<void> {
    const notify = new NotificationWriter(tx);
    await notify.create({
      userId: w.buyer_id,
      type: "refund_started",
      title: "Refund started",
      body: `${naira(w.amount_kobo)} is on its way back to you. Banks can take a few days.`,
      targetView: "orderDetail",
      targetParams: { orderId: w.order_id },
      actorId: null,
    });
    if (w.vendor_user_id) {
      await notify.create({ userId: w.vendor_user_id, type: "order_refunded", title: "Order refunded", body: `${naira(w.amount_kobo)} was refunded to the buyer for this order.`, targetView: "orderDetail", targetParams: { orderId: w.order_id }, actorId: null });
    }
  }

  /** Paystack said no: the refund is failed and an admin is told. Paystack not answering: never sent again by itself (it may have gone through). */
  private async onError(tx: Tx, w: { id: string; order_id: string; transaction_reference: string }, err: unknown): Promise<void> {
    const repo = new PaystackRefundsRepository(tx);
    const notify = new NotificationWriter(tx);
    if (err instanceof PaystackRejected || err instanceof PaystackUnavailable) {
      const message = err instanceof PaystackRejected ? err.message : "Paystack was not available";
      await repo.markFailed(w.id, message);
      await notify.notifyAdmins("Refund failed", `Paystack could not refund payment ${w.transaction_reference}: ${message}`, "orderDetail", { orderId: w.order_id }, null);
      return;
    }
    const unknown = err instanceof PaystackUnknownOutcome;
    await repo.note(w.id, unknown ? "Paystack did not answer: check the refund in the Paystack dashboard before trying again." : "Unexpected error");
    await notify.notifyAdmins("Check a refund", `Paystack did not answer when asked to refund payment ${w.transaction_reference}. Look at it in the Paystack dashboard; it may have gone through.`, "orderDetail", { orderId: w.order_id }, null);
  }
}
