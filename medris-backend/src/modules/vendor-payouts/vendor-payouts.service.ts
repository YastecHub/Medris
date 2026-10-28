import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { VendorPayoutsRepository, type PayoutWork } from "../../database/repositories/vendor-payouts.repository.js";
import { PaystackRejected, PaystackUnavailable, PaystackUnknownOutcome, getPaystackClient, koboToNaira } from "../../integrations/paystack/index.js";
import { conflict, forbidden, notFound } from "../../shared/errors/app-error.js";

type Tx = Parameters<Parameters<DataContext["asService"]>[0]>[0];

const MAX_ATTEMPTS = 3;
/** How long an empty Paystack balance is left alone before the payout is tried again. */
const BALANCE_WAIT_MS = 6 * 60 * 60 * 1000;
const NOT_YET_MS = 10 * 60 * 1000;
const naira = (kobo: number | string) => "₦" + koboToNaira(Number(kobo)).toLocaleString("en-NG", { maximumFractionDigits: 2 });
const orderLink = (orderId: string) => ({ targetView: "orderDetail", targetParams: { orderId } });

/** Tells the vendor their money was sent. Used by the worker and by the Paystack `transfer.success` webhook. */
export async function notifyPayoutSent(tx: Tx, payoutId: string): Promise<void> {
  const p = await new VendorPayoutsRepository(tx).detail(payoutId);
  if (!p?.vendor_user_id) return;
  await new NotificationWriter(tx).create({
    userId: p.vendor_user_id,
    type: "payout_sent",
    title: "Payout sent",
    body: `${naira(p.amount_kobo)} was sent to your bank account.`,
    ...orderLink(p.order_id),
    actorId: null,
  });
}

/**
 * Paying vendors (issue #98). When a Paystack-paid order completes, the database queues a `pending` payout (migration 0007).
 * This worker sends each one to the vendor's verified bank account, exactly once:
 *   - the row is claimed with `for update skip locked` and flipped to `processing` in its own transaction, so a second worker
 *     cannot take it, and the Paystack call is made after that transaction ends (never inside one);
 *   - the transfer carries the payout's own stable reference, which Paystack also refuses to use twice;
 *   - a timeout is never retried blindly: the transfer is looked up by reference first.
 */
export class VendorPayoutsService {
  constructor(private readonly db: () => DataContext) {}

  /** The scheduled job: sends what is waiting and retries what failed. Returns how many it touched. */
  async run(limit = 25): Promise<{ sent: number; held: number; retried: number; left: number }> {
    const out = { sent: 0, held: 0, retried: 0, left: 0 };
    for (let i = 0; i < limit; i++) {
      const step = await this.db().asService(async (tx) => {
        const repo = new VendorPayoutsRepository(tx);
        const retry = await repo.nextRetryable();
        if (retry) return { kind: "retry" as const, payout: retry, ...(await this.requeueFailed(tx, repo, retry)) };
        const next = await repo.nextPending();
        if (!next) return { kind: "none" as const };
        return { kind: "send" as const, payout: next, ...(await this.claim(tx, repo, next)) };
      });
      if (step.kind === "none") break;
      if (step.kind === "retry") {
        out.retried++;
        continue;
      }
      if (step.hold) {
        out.held++;
        continue;
      }
      if (step.send) {
        const settled = await this.transfer(step.payout, step.send);
        if (settled) out.sent++;
        else out.left++;
      }
    }
    return out;
  }

  /** A failed transfer: wait, then try again under a new reference (Paystack will not reuse a failed one); after 3 tries an admin decides. */
  private async requeueFailed(tx: Tx, repo: VendorPayoutsRepository, p: PayoutWork): Promise<Record<string, never>> {
    if (p.attempts >= MAX_ATTEMPTS) {
      await repo.hold(p.id, `The transfer failed ${p.attempts} times. Check the vendor's account, then release it.`);
      await new NotificationWriter(tx).notifyAdmins("Vendor payout needs you", "A payout failed 3 times and is on hold.", "orderDetail", { orderId: p.order_id }, null);
      return {};
    }
    await repo.requeue(p.id, { reference: `${p.transfer_reference.slice(0, 39)}_${p.attempts + 1}` });
    return {};
  }

  /** Decides what to do with a pending payout, inside the claiming transaction. */
  private async claim(tx: Tx, repo: VendorPayoutsRepository, p: PayoutWork): Promise<{ hold?: true; send?: { amountKobo: number; recipientCode: string } }> {
    const notify = new NotificationWriter(tx);
    if (!p.recipient_code || !p.payout_verified_at) {
      await repo.hold(p.id, "The vendor has no verified payout account.");
      if (p.vendor_user_id) {
        await notify.create({ userId: p.vendor_user_id, type: "payout_on_hold", title: "Add your payout account", body: "You have money waiting. Add and verify your bank account so we can send it.", targetView: "vendorEditProfile", targetParams: null, actorId: null });
      }
      return { hold: true };
    }
    if (await repo.hasOpenDispute(p.order_id)) {
      await repo.hold(p.id, "There is an open dispute on this order.");
      return { hold: true };
    }
    const paid = await repo.paidKobo(p.order_id);
    const commission = await repo.commissionKobo(p.order_id);
    const refunded = await repo.refundedKobo(p.order_id);
    const amount = paid - commission - refunded;
    if (amount <= 0) {
      await repo.hold(p.id, "Nothing is left to pay out after commission and refunds.");
      await notify.notifyAdmins("Payout is ₦0", "A payout has nothing left after commission and refunds. Check the order.", "orderDetail", { orderId: p.order_id }, null);
      return { hold: true };
    }
    await repo.markProcessing(p.id, amount, commission, p.recipient_code);
    await repo.settleCommission(p.order_id);
    return { send: { amountKobo: amount, recipientCode: p.recipient_code } };
  }

  /** The Paystack call, outside any transaction. Returns true when the money is known to be sent. */
  private async transfer(p: PayoutWork, send: { amountKobo: number; recipientCode: string }): Promise<boolean> {
    try {
      const t = await getPaystackClient().initiateTransfer({
        amountKobo: send.amountKobo,
        recipientCode: send.recipientCode,
        reference: p.transfer_reference,
        reason: `Levromart order ${p.order_id.slice(0, 8)}`,
      });
      if (String(t.status).toLowerCase() === "success") {
        await this.db().asService(async (tx) => {
          await new VendorPayoutsRepository(tx).succeed(p.id, t.transfer_code ?? null);
          await notifyPayoutSent(tx, p.id);
        });
        return true;
      }
      if (String(t.status).toLowerCase() === "otp") {
        // Paystack is waiting for a one-time code before it sends this money: it will not move until transfer OTP is switched off
        await this.db().asService(async (tx) => {
          const repo = new VendorPayoutsRepository(tx);
          if (!(await repo.otpAlertedToday())) {
            await new NotificationWriter(tx).notifyAdmins("Paystack is holding vendor payouts", "Paystack is asking for a confirmation code before it sends a payout, so payouts will stay \"on its way\". In the Paystack dashboard open Settings, then Preferences or Transfers, and switch off \"Confirm transfers before sending\" (transfer OTP). Then the waiting payouts go through.", "adminPayments", { tab: "payouts" }, null);
          }
        });
      }
      // "pending" / "otp": Paystack will tell us with transfer.success / transfer.failed (the reconcile job asks if it does not)
      return false;
    } catch (err) {
      if (err instanceof PaystackUnknownOutcome) return this.lookUp(p);
      if (err instanceof PaystackUnavailable) {
        await this.db().asService((tx) => new VendorPayoutsRepository(tx).requeue(p.id, { at: new Date(Date.now() + NOT_YET_MS), error: "Paystack was not available", giveBackAttempt: true }));
        return false;
      }
      if (err instanceof PaystackRejected && /balance|insufficient/i.test(err.message)) {
        await this.balanceTooLow(p);
        return false;
      }
      const message = err instanceof PaystackRejected ? err.message : "Unexpected error";
      await this.db().asService((tx) => new VendorPayoutsRepository(tx).fail(p.id, message));
      return false;
    }
  }

  /** After a timeout: did the transfer happen? Never send again until this is known. */
  private async lookUp(p: PayoutWork): Promise<boolean> {
    try {
      const v = await getPaystackClient().verifyTransfer(p.transfer_reference);
      const status = String(v.status).toLowerCase();
      if (status === "success") {
        await this.db().asService(async (tx) => {
          await new VendorPayoutsRepository(tx).succeed(p.id, v.transfer_code ?? null);
          await notifyPayoutSent(tx, p.id);
        });
        return true;
      }
      if (status === "failed" || status === "reversed") {
        await this.db().asService((tx) => new VendorPayoutsRepository(tx).fail(p.id, `Transfer ${status}`));
      }
      return false; // pending/otp/received: still on its way
    } catch (err) {
      if (err instanceof PaystackRejected && err.status === 404) {
        // Paystack has no such transfer, so the request never arrived: safe to queue it again with the same reference
        await this.db().asService((tx) => new VendorPayoutsRepository(tx).requeue(p.id, { at: new Date(Date.now() + NOT_YET_MS), giveBackAttempt: true }));
      }
      // any other answer: leave it `processing`; the reconcile job looks it up again
      return false;
    }
  }

  /** Paystack's balance is too low: wait (no retry storm) and tell the admins at most once a day. */
  private async balanceTooLow(p: PayoutWork): Promise<void> {
    await this.db().asService(async (tx) => {
      const repo = new VendorPayoutsRepository(tx);
      await repo.requeue(p.id, { at: new Date(Date.now() + BALANCE_WAIT_MS), error: "Paystack balance too low", giveBackAttempt: true });
      if (!(await repo.balanceAlertedToday())) {
        await new NotificationWriter(tx).notifyAdmins("Top up the Paystack balance", "Vendor payouts are waiting because the Paystack balance is too low. They will be tried again automatically.", null, null, null);
      }
    });
  }

  /* ------------------------------------------------------------------ people */

  /** The shop's own payouts (for the earnings page). */
  async mine(me: Identity, page: { limit: number; offset: number }) {
    return this.db().asService(async (tx) => {
      const rows = await new VendorPayoutsRepository(tx).forShop(me.userId, page.limit, page.offset);
      return rows.map((r) => ({ id: r.id, orderId: r.order_id, amount: koboToNaira(Number(r.amount_kobo)), commission: koboToNaira(Number(r.commission_kobo)), status: r.status, holdReason: r.hold_reason, createdAt: r.created_at, updatedAt: r.updated_at }));
    });
  }

  async list(me: Identity, input: { status?: string; vendorId?: string; orderId?: string; from?: string; to?: string; limit: number; offset: number }) {
    return this.db().asService(async (tx) => {
      await this.requireAdmin(tx, me);
      const rows = await new VendorPayoutsRepository(tx).all(input.status ?? null, input.limit, input.offset, input);
      return rows.map((r) => ({ ...r, amount: koboToNaira(Number(r.amount_kobo)), commission: koboToNaira(Number(r.commission_kobo)) }));
    });
  }

  /** "Release now": a held, failed or reversed payout goes back in the queue (the worker sends it on its next run). */
  async release(me: Identity, id: string) {
    return this.db().asService(async (tx) => {
      await this.requireAdmin(tx, me);
      const repo = new VendorPayoutsRepository(tx);
      const p = await repo.byId(id);
      if (!p) throw notFound("Payout not found.");
      if (!(await repo.release(id))) throw conflict(`A payout that is ${p.status.replace("_", " ")} cannot be released.`);
      await repo.logAdminAction(me.userId, "Released vendor payout", id, p.business_name ?? "");
      return { id, status: "pending" };
    });
  }

  async hold(me: Identity, id: string, reason: string) {
    return this.db().asService(async (tx) => {
      await this.requireAdmin(tx, me);
      const repo = new VendorPayoutsRepository(tx);
      const p = await repo.byId(id);
      if (!p) throw notFound("Payout not found.");
      if (!["pending", "failed"].includes(p.status)) throw conflict(`A payout that is ${p.status.replace("_", " ")} cannot be put on hold.`);
      await repo.hold(id, reason);
      await repo.logAdminAction(me.userId, `Held vendor payout: ${reason}`.slice(0, 200), id, p.business_name ?? "");
      return { id, status: "on_hold" };
    });
  }

  /** "Mark as paid manually": the admin paid the vendor outside Paystack. No Paystack call; who and why are recorded. */
  async markManual(me: Identity, id: string, note: string) {
    return this.db().asService(async (tx) => {
      await this.requireAdmin(tx, me);
      const repo = new VendorPayoutsRepository(tx);
      const p = await repo.byId(id);
      if (!p) throw notFound("Payout not found.");
      if (!["pending", "on_hold", "failed", "reversed"].includes(p.status)) throw conflict(`A payout that is ${p.status.replace("_", " ")} cannot be marked as paid by hand.`);
      await repo.markManual(id, me.userId, note);
      await repo.logAdminAction(me.userId, `Marked vendor payout as paid manually: ${note}`.slice(0, 200), id, p.business_name ?? "");
      if (p.vendor_user_id) {
        await new NotificationWriter(tx).create({ userId: p.vendor_user_id, type: "payout_sent", title: "Payout sent", body: "Levromart paid you for this order directly.", ...orderLink(p.order_id), actorId: me.userId });
      }
      return { id, status: "paid_manually" };
    });
  }

  private async requireAdmin(tx: Tx, me: Identity): Promise<void> {
    if (!(await new AccessRepository(tx).isAdmin(me.userId))) throw forbidden("Only admins can do this.");
  }
}
