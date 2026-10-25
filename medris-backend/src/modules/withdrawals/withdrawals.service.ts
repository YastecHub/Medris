import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { WithdrawalsRepository } from "../../database/repositories/withdrawals.repository.js";
import { koboToNaira } from "../../integrations/paystack/index.js";
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors/app-error.js";

/** The smallest amount a shop can withdraw at once (a bank transfer costs Levromart a few naira). */
export const MIN_WITHDRAWAL_KOBO = 100_000;
/** Money paid for at least this long ago is sent the moment the shop asks; newer money waits for an admin. */
export const INSTANT_AFTER_MS = 48 * 60 * 60 * 1000;
/** After the bank account is changed, withdrawals wait this long (a stolen login cannot empty the wallet at once). */
export const BANK_CHANGE_WAIT_HOURS = 24;

const naira = (kobo: number | string) => "₦" + koboToNaira(Number(kobo)).toLocaleString("en-NG", { maximumFractionDigits: 2 });

/**
 * Withdrawals (migration 0017). Completed orders leave their money "waiting" (a payout row on hold); the shop asks for it:
 *   - money paid 48 hours ago or more, with no open dispute, is released to the sending queue straight away;
 *   - newer money becomes a request that an admin approves or rejects (a rejection always carries a reason);
 *   - an order with an open dispute is never released - the rest of the shop's money is unaffected.
 */
export class WithdrawalsService {
  constructor(private readonly db: () => DataContext) {}

  /** What the wallet shows: how much can go now, how much needs approval, how much a dispute holds, and the history. */
  async summary(me: Identity | null) {
    if (!me) throw forbidden("Please log in to continue.");
    return this.db().onBehalfOf(me, async (tx) => {
      const repo = new WithdrawalsRepository(tx);
      const vendor = await repo.vendor(me.userId);
      if (!vendor) throw forbidden("Only shops can withdraw.");
      const plan = await this.plan(repo, vendor.id);
      return {
        min_kobo: MIN_WITHDRAWAL_KOBO,
        instant_kobo: plan.instant.total,
        approval_kobo: plan.approval.total,
        held_kobo: plan.held.total,
        has_dispute: plan.disputedOrders.length > 0,
        disputed_order_ids: plan.disputedOrders,
        blocked: this.blocked(vendor),
        open_request: await repo.openRequest(vendor.id),
        recent: await repo.recent(vendor.id),
      };
    });
  }

  /** The shop taps Withdraw. */
  async request(me: Identity | null) {
    if (!me) throw forbidden("Please log in to continue.");
    return this.db().onBehalfOf(me, async (tx) => {
      const repo = new WithdrawalsRepository(tx);
      const vendor = await repo.vendor(me.userId);
      if (!vendor) throw forbidden("Only shops can withdraw.");
      const blocked = this.blocked(vendor);
      if (blocked) throw badRequest(blocked);
      const plan = await this.plan(repo, vendor.id);
      const open = await repo.openRequest(vendor.id);
      const canInstant = plan.instant.total >= MIN_WITHDRAWAL_KOBO;
      const canAsk = !open && plan.approval.total >= MIN_WITHDRAWAL_KOBO;
      if (!canInstant && !canAsk) {
        if (open) throw conflict("You already have a withdrawal waiting for approval.");
        throw badRequest(`The smallest withdrawal is ${naira(MIN_WITHDRAWAL_KOBO)}. You have ${naira(plan.instant.total + plan.approval.total)} ready.`);
      }
      const notify = new NotificationWriter(tx);
      const hasDispute = plan.disputedOrders.length > 0;
      let sent = 0;
      let asked = 0;
      if (canInstant) {
        const id = await repo.insertRequest(vendor.id, "instant", plan.instant.orderIds, plan.instant.total, hasDispute);
        await repo.attach(id, plan.instant.payoutIds);
        await repo.releasePayouts(id, true);
        await repo.detach(id);
        sent = plan.instant.total;
      }
      if (canAsk) {
        const id = await repo.insertRequest(vendor.id, "approval", plan.approval.orderIds, plan.approval.total, hasDispute);
        await repo.attach(id, plan.approval.payoutIds);
        asked = plan.approval.total;
        await notify.notifyAdmins(
          "Withdrawal request",
          `${vendor.business_name ?? "A shop"} asked to withdraw ${naira(asked)}${hasDispute ? " (has a disputed order)" : ""}.`,
          "adminPayments",
          { tab: "withdrawals" },
          me.userId,
        );
      }
      return { sent_kobo: sent, requested_kobo: asked, held_kobo: plan.held.total, has_dispute: hasDispute };
    });
  }

  /** Admin screen: requests, newest first, pending ones on top. */
  async adminList(me: Identity | null, status: string | null) {
    if (!me) throw forbidden("Admin access required.");
    return this.db().onBehalfOf(me, async (tx) => {
      if (!(await new AccessRepository(tx).isAdmin(me.userId))) throw forbidden("Admin access required.");
      return new WithdrawalsRepository(tx).adminList(status, 100);
    });
  }

  /** Admin approves (the money is released to the sending queue) or rejects (a reason is required and the vendor sees it). */
  async decide(me: Identity | null, requestId: string, decision: string, reason: string | null) {
    if (!me) throw forbidden("Admin access required.");
    if (decision !== "approve" && decision !== "reject") throw badRequest("Decision must be approve or reject.");
    const why = (reason ?? "").trim();
    if (decision === "reject" && why.length < 3) throw badRequest("Please write the reason for rejecting this withdrawal. The shop will see it.");
    return this.db().onBehalfOf(me, async (tx) => {
      if (!(await new AccessRepository(tx).isAdmin(me.userId))) throw forbidden("Admin access required.");
      const repo = new WithdrawalsRepository(tx);
      const w = await repo.byId(requestId);
      if (!w) throw notFound("Withdrawal request not found.");
      if (w.status !== "requested") throw conflict("This request was already decided.");
      const notify = new NotificationWriter(tx);
      if (decision === "approve") {
        const released = await repo.releasePayouts(requestId, true);
        await repo.detach(requestId);
        await repo.decide(requestId, "approved", me.userId, null);
        await notify.create({
          userId: w.vendor_user_id,
          type: "withdrawal_approved",
          title: "Withdrawal approved",
          body: released ? `${naira(w.amount_kobo)} is being sent to your bank account.` : "Your withdrawal was approved, but every order in it has an open dispute, so nothing was sent yet.",
          targetView: "vendorWallet",
          actorId: me.userId,
        });
        await repo.logAdminAction(me.userId, "approve_withdrawal", "vendor", w.vendor_id, w.business_name ?? "");
        return { status: "approved", released };
      }
      await repo.detach(requestId);
      await repo.decide(requestId, "rejected", me.userId, why);
      await notify.create({
        userId: w.vendor_user_id,
        type: "withdrawal_rejected",
        title: "Withdrawal not approved",
        body: `Your withdrawal of ${naira(w.amount_kobo)} was not approved: ${why}`,
        targetView: "vendorWallet",
        actorId: me.userId,
      });
      await repo.logAdminAction(me.userId, "reject_withdrawal", "vendor", w.vendor_id, w.business_name ?? "");
      return { status: "rejected", released: 0 };
    });
  }

  /** Admin brings a resolved dispute back to open, unless the order's money has already left. */
  async reopenDispute(me: Identity | null, disputeId: string, note: string | null) {
    if (!me) throw forbidden("Admin access required.");
    return this.db().onBehalfOf(me, async (tx) => {
      if (!(await new AccessRepository(tx).isAdmin(me.userId))) throw forbidden("Admin access required.");
      const repo = new WithdrawalsRepository(tx);
      const d = await repo.dispute(disputeId);
      if (!d) throw notFound("Dispute not found.");
      if (d.status !== "resolved") throw conflict("This dispute is already open.");
      if (d.sent) throw conflict("The money for this order has already been sent to the shop, so the dispute cannot be reopened. Use a refund or talk to the shop.");
      await repo.reopen(disputeId, d.order_id, `Reopened by admin${note?.trim() ? `: ${note.trim()}` : "."}`);
      const notify = new NotificationWriter(tx);
      for (const userId of [d.buyer_id, d.vendor_user_id]) {
        await notify.create({ userId, type: "dispute_reopened", title: "Dispute reopened", body: "An admin reopened the dispute on this order.", targetView: "orderDetail", targetParams: { orderId: d.order_id }, actorId: me.userId });
      }
      await repo.logAdminAction(me.userId, "reopen_dispute", "order", d.order_id, "");
      return { done: true };
    });
  }

  /** Why this shop cannot withdraw right now (null when it can). */
  private blocked(v: { recipient_code: string | null; payout_verified_at: string | null; verified_age_hours: number | null }): string | null {
    if (!v.recipient_code || !v.payout_verified_at) return "Add and verify your bank account before you withdraw.";
    const wait = BANK_CHANGE_WAIT_HOURS - (v.verified_age_hours ?? BANK_CHANGE_WAIT_HOURS);
    if (wait > 0) return `You changed your bank account recently. For your safety, withdrawals open again in ${Math.ceil(wait)} hour${Math.ceil(wait) === 1 ? "" : "s"}.`;
    return null;
  }

  private async plan(repo: WithdrawalsRepository, vendorId: string) {
    const buckets = await repo.buckets(vendorId);
    const cutoff = Date.now() - INSTANT_AFTER_MS;
    const group = () => ({ total: 0, orderIds: [] as string[], payoutIds: [] as string[] });
    const instant = group();
    const approval = group();
    const held = group();
    for (const b of buckets) {
      const amount = Number(b.net_kobo);
      if (amount <= 0) continue;
      const g = b.disputed ? held : b.paid_at && new Date(b.paid_at).getTime() <= cutoff ? instant : approval;
      g.total += amount;
      g.orderIds.push(b.order_id);
      g.payoutIds.push(b.payout_id);
    }
    const disputedOrders = (await repo.disputedOrders(vendorId)).map((r) => r.order_id);
    return { instant, approval, held, disputedOrders };
  }
}
