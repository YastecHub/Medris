import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { WalletPinService } from "../wallet/wallet-pin.service.js";
import { WithdrawalsRepository } from "../../database/repositories/withdrawals.repository.js";
import { koboToNaira } from "../../integrations/paystack/index.js";
import { creditWalletEarnings } from "../wallet/wallet.service.js";
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors/app-error.js";

/** Paystack does not send less than this (₦100). Below it, money is never sent at once: the shop can still ask, and an admin decides. */
export const MIN_WITHDRAWAL_KOBO = 10_000;
/** Money paid for at least this long ago is sent the moment the shop asks; newer money waits for an admin. */
export const INSTANT_AFTER_MS = 24 * 60 * 60 * 1000;
/** A shop can ask for amounts under the minimum this many times in 24 hours (stops spamming). */
export const SMALL_REQUESTS_PER_DAY = 3;

const naira = (kobo: number | string) => "₦" + koboToNaira(Number(kobo)).toLocaleString("en-NG", { maximumFractionDigits: 2 });

/**
 * Withdrawals (migration 0017). Completed orders leave their money "waiting" (a payout row on hold); the shop asks for it:
 *   - money paid 24 hours ago or more, with no open dispute, is released to the sending queue straight away;
 *   - newer money becomes a request that an admin approves or rejects (a rejection always carries a reason);
 *   - an order with an open dispute is never released - the rest of the shop's money is unaffected.
 */
export class WithdrawalsService {
  private readonly pins: WalletPinService;
  constructor(
    private readonly db: () => DataContext,
    pins?: WalletPinService,
  ) {
    this.pins = pins ?? new WalletPinService(db);
  }

  /** What the wallet shows: how much can go now, how much needs approval, how much a dispute holds, and the history. */
  async summary(me: Identity | null) {
    if (!me) throw forbidden("Please log in to continue.");
    return this.db().onBehalfOf(me, async (tx) => {
      const repo = new WithdrawalsRepository(tx);
      const vendor = await repo.vendor(me.userId);
      if (!vendor) throw forbidden("Only shops can withdraw.");
      const plan = await this.plan(repo, vendor.id);
      const toWallet = await this.plan(repo, vendor.id, true);
      return {
        to_wallet_now_kobo: toWallet.instant.total,
        to_wallet_approval_kobo: toWallet.approval.total,
        open_wallet_request: await repo.openRequest(vendor.id, "wallet"),
        bank_wait_hours: null as number | null, // no waiting after a bank change any more: the PIN is the safeguard
        min_kobo: MIN_WITHDRAWAL_KOBO,
        instant_kobo: plan.instant.total,
        approval_kobo: plan.approval.total,
        held_kobo: plan.held.total,
        has_dispute: plan.disputedOrders.length > 0,
        disputed_order_ids: plan.disputedOrders,
        blocked: this.blocked(vendor),
        recent_bank_change: null as number | null,
        open_request: await repo.openRequest(vendor.id),
        recent: await repo.recent(vendor.id),
      };
    });
  }

  /**
   * The shop moves its earnings into its Levromart wallet (`wallet`, the usual way) or sends them straight to the bank (`bank`).
   * Either way: money paid 24 hours ago or more, with no open dispute, goes at once; newer money needs an admin's approval.
   * To the bank only: nothing for 24 hours after the bank account was added or changed, and the first withdrawal after
   * that is always checked by an admin.
   */
  async request(me: Identity | null, destination: string | null = "bank", pin?: string | null) {
    if (!me) throw forbidden("Please log in to continue.");
    await this.pins.require(me.userId, pin);
    if (destination === "wallet") return this.toWallet(me);
    return this.db().onBehalfOf(me, async (tx) => {
      const repo = new WithdrawalsRepository(tx);
      const vendor = await repo.vendor(me.userId);
      if (!vendor) throw forbidden("Only shops can withdraw.");
      const blocked = this.blocked(vendor);
      if (blocked) throw badRequest(blocked);
      // the PIN is the safeguard now: changing the bank account does not hold a withdrawal back. Only money paid in the last
      // 24 hours waits for an admin (see plan()).
      const firstAfterChange = false;
      const plan = await this.plan(repo, vendor.id, false, false);
      const open = await repo.openRequest(vendor.id);
      const canInstant = plan.instant.total >= MIN_WITHDRAWAL_KOBO;
      // anything that cannot be sent at once (new money, a small amount, a recently changed bank account) is asked of an admin
      const asking = canInstant ? plan.approval : { total: plan.approval.total + plan.instant.total, orderIds: [...plan.approval.orderIds, ...plan.instant.orderIds], payoutIds: [...plan.approval.payoutIds, ...plan.instant.payoutIds] };
      const canAsk = !open && asking.total > 0;
      if (canAsk && !canInstant && asking.total < MIN_WITHDRAWAL_KOBO && (await repo.smallRequestsToday(vendor.id, MIN_WITHDRAWAL_KOBO)) >= SMALL_REQUESTS_PER_DAY) {
        throw badRequest(`You can ask for an amount under ${naira(MIN_WITHDRAWAL_KOBO)} only ${SMALL_REQUESTS_PER_DAY} times a day. Wait until you have more, or try again tomorrow.`);
      }
      if (!canInstant && !canAsk) {
        if (open) throw conflict("You already have a withdrawal waiting for approval.");
        throw badRequest("There is no money ready to withdraw yet.");
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
        const id = await repo.insertRequest(vendor.id, "approval", asking.orderIds, asking.total, hasDispute);
        await repo.attach(id, asking.payoutIds);
        asked = asking.total;
        await notify.notifyAdmins(
          "Withdrawal request",
          `${vendor.business_name ?? "A shop"} asked to withdraw ${naira(asked)}${hasDispute ? " (has a disputed order)" : ""}${firstAfterChange ? " (first withdrawal to a new or changed bank account)" : ""}.`,
          "adminPayments",
          { tab: "withdrawals" },
          me.userId,
        );
      }
      return { sent_kobo: sent, requested_kobo: asked, held_kobo: plan.held.total, has_dispute: hasDispute };
    });
  }

  /** The shop takes back a request that is still waiting for Levromart: its money goes back to the shop's waiting pile. */
  async cancel(me: Identity | null, requestId: string) {
    if (!me) throw forbidden("Please log in to continue.");
    return this.db().onBehalfOf(me, async (tx) => {
      const repo = new WithdrawalsRepository(tx);
      const vendor = await repo.vendor(me.userId);
      if (!vendor) throw forbidden("Only shops can do this.");
      const w = await repo.byId(requestId);
      if (!w || w.vendor_id !== vendor.id) throw notFound("Request not found.");
      if (w.status !== "requested") throw conflict("This request was already decided, so it cannot be cancelled.");
      await repo.detach(requestId);
      await repo.decide(requestId, "rejected", me.userId, "Cancelled by the shop");
      return { status: "cancelled" };
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
      if (decision === "approve" && w.destination === "wallet") {
        const moved = await creditWalletEarnings(tx, w.vendor_user_id ?? "", await repo.attachedBuckets(requestId));
        await repo.detach(requestId);
        await repo.decide(requestId, "approved", me.userId, null);
        await notify.create({ userId: w.vendor_user_id, type: "withdrawal_approved", title: "Moved to your wallet", body: moved ? `${naira(moved)} of your earnings is now in your Levromart wallet.` : "Approved, but every order in it has an open dispute, so nothing was moved yet.", targetView: "levroWallet", actorId: me.userId });
        await repo.logAdminAction(me.userId, "approve_move_to_wallet", "vendor", w.vendor_id, w.business_name ?? "");
        return { status: "approved", released: moved ? 1 : 0 };
      }
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
  private blocked(v: { recipient_code: string | null; payout_verified_at: string | null }): string | null {
    if (!v.recipient_code || !v.payout_verified_at) return "Add and verify your bank account before you withdraw.";
    return null;
  }

  /** Moves the shop's earnings into the owner's wallet: money 24 hours old or more at once, newer money after an admin approves. */
  private async toWallet(me: Identity) {
    return this.db().onBehalfOf(me, async (tx) => {
      const repo = new WithdrawalsRepository(tx);
      const vendor = await repo.vendor(me.userId);
      if (!vendor) throw forbidden("Only shops have earnings to move.");
      const plan = await this.plan(repo, vendor.id, true);
      const open = await repo.openRequest(vendor.id, "wallet");
      const notify = new NotificationWriter(tx);
      let moved = 0;
      let asked = 0;
      if (plan.instant.total > 0) {
        const buckets = (await repo.buckets(vendor.id)).filter((b) => plan.instant.payoutIds.includes(b.payout_id));
        const id = await repo.insertRequest(vendor.id, "instant", plan.instant.orderIds, plan.instant.total, false, "wallet");
        moved = await creditWalletEarnings(tx, me.userId, buckets.map((b) => ({ payout_id: b.payout_id, order_id: b.order_id, net_kobo: b.net_kobo, commission_kobo: Number(b.commission_kobo) })));
        void id;
      }
      if (!open && plan.approval.total > 0) {
        const id = await repo.insertRequest(vendor.id, "approval", plan.approval.orderIds, plan.approval.total, plan.disputedOrders.length > 0, "wallet");
        await repo.attach(id, plan.approval.payoutIds);
        asked = plan.approval.total;
        await notify.notifyAdmins("Move to wallet request", `${vendor.business_name ?? "A shop"} asked to move ${naira(asked)} of earnings paid less than 24 hours ago into its wallet.`, "adminPayments", { tab: "todo" }, me.userId);
      }
      if (!moved && !asked) {
        if (open && plan.approval.total > 0) throw conflict("You already have a request waiting for approval.");
        throw badRequest("There are no earnings ready to move yet.");
      }
      return { sent_kobo: moved, requested_kobo: asked, held_kobo: plan.held.total, has_dispute: plan.disputedOrders.length > 0 };
    });
  }


  private async plan(repo: WithdrawalsRepository, vendorId: string, toWallet = false, firstAfterChange = false) {
    const buckets = await repo.buckets(vendorId);
    const recent = !toWallet && firstAfterChange;
    const cutoff = Date.now() - INSTANT_AFTER_MS;
    const group = () => ({ total: 0, orderIds: [] as string[], payoutIds: [] as string[] });
    const instant = group();
    const approval = group();
    const held = group();
    for (const b of buckets) {
      const amount = Number(b.net_kobo);
      if (amount <= 0) continue;
      const g = b.disputed ? held : !recent && b.paid_at && new Date(b.paid_at).getTime() <= cutoff ? instant : approval;
      g.total += amount;
      g.orderIds.push(b.order_id);
      g.payoutIds.push(b.payout_id);
    }
    const disputedOrders = (await repo.disputedOrders(vendorId)).map((r) => r.order_id);
    return { instant, approval, held, disputedOrders };
  }
}
