import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { CancellationsRepository } from "../../database/repositories/cancellations.repository.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors/app-error.js";

const orderLink = (orderId: string) => ({ targetView: "orderDetail", targetParams: { orderId } });

/**
 * Cancelling an order that has been paid for (migration 0018).
 *   - The buyer may cancel until the order is completed (also while it is out for delivery). A paid order becomes a refund request that the shop or an admin decides; everything paid for the order (not Paystack's fee) goes back when approved.
 *   - A shop cannot cancel a paid order itself. It asks, an admin decides; approving cancels the order and refunds the buyer.
 * The refund itself is queued by the database the moment the order becomes cancelled (migration 0008), whoever cancelled it.
 */
export class CancellationsService {
  constructor(private readonly db: () => DataContext) {}

  /**
   * The buyer cancels before the order is out for delivery. An order that was not paid is cancelled at once. A paid order
   * becomes a refund request: the shop and the admins are told, the shop may refund or decline, and an admin can refund the
   * buyer whatever the shop says (nothing is refunded by itself, so a cancelled order cannot be turned into a refund claim later).
   */
  async buyerCancel(me: Identity | null, orderId: string, reasonInput: string | null = null) {
    if (!me) throw forbidden("Please log in to continue.");
    return this.db().onBehalfOf(me, async (tx) => {
      const repo = new CancellationsRepository(tx);
      const o = await repo.order(orderId);
      if (!o) throw notFound("Order not found.");
      if (o.buyer_id !== me.userId) throw forbidden("Only the buyer can cancel this order.");
      if (!["pending", "confirmed", "handed_over"].includes(o.status)) throw badRequest("This order can no longer be cancelled: it is completed or already closed. If something is wrong, report an issue from the order page.");
      const notify = new NotificationWriter(tx);
      if (o.paid) {
        // a refund can only be asked for within 24 hours of the order: Paystack cannot investigate money after it has been sent on
        // after 24 hours Paystack may no longer be able to return the money by itself: the request is still taken, and the shop or an admin decides how it is paid back (the note below tells them)
        if (await repo.open(orderId)) throw conflict("You have already asked for a refund on this order.");
        const reason = ((reasonInput ?? "").trim() || "The buyer wants to cancel and be refunded.") + (o.refund_window_over ? " (asked more than 24 hours after the order was placed)" : "") + (o.status === "handed_over" ? " (the order is already out for delivery)" : "");
        const id = await repo.insert(orderId, me.userId, reason.slice(0, 500), "buyer");
        await notify.create({ userId: o.vendor_user_id, type: "refund_requested", title: "Refund request", body: "The buyer cancelled this paid order and asked for a refund. Refund them, or tell them why not.", ...orderLink(orderId), actorId: me.userId });
        await notify.notifyAdmins("Refund request", `A buyer asked for a refund on a paid order from ${o.business_name ?? "a shop"}: ${reason.slice(0, 120)}`, "adminPayments", { tab: "todo" }, me.userId);
        return { cancelled: false, requested: true, requestId: id };
      }
      await repo.setCancelled(orderId);
      await notify.create({ userId: o.vendor_user_id, type: "order_cancelled", title: "Order cancelled", body: "The buyer cancelled this order.", ...orderLink(orderId), actorId: me.userId });
      const refunded = await repo.queuedRefundKobo(orderId);
      return { cancelled: true, refunded: refunded > 0, refundedAmount: refunded / 100 };
    });
  }

  /** The shop asks Levromart to cancel an order that has already been paid for. */
  async request(me: Identity | null, orderId: string, reasonInput: string | null) {
    if (!me) throw forbidden("Please log in to continue.");
    const reason = (reasonInput ?? "").trim();
    if (reason.length < 3) throw badRequest("Please tell us why you need to cancel this order.");
    return this.db().onBehalfOf(me, async (tx) => {
      const repo = new CancellationsRepository(tx);
      const o = await repo.order(orderId);
      if (!o) throw notFound("Order not found.");
      if (o.vendor_user_id !== me.userId) throw forbidden("Only the shop can ask to cancel this order.");
      if (!o.paid) throw badRequest("This order has not been paid for, so you can cancel it yourself.");
      if (o.status !== "confirmed") throw badRequest("This order can no longer be cancelled: it is already out for delivery or finished.");
      if (await repo.open(orderId)) throw conflict("You have already asked Levromart to cancel this order.");
      const id = await repo.insert(orderId, me.userId, reason);
      await new NotificationWriter(tx).notifyAdmins("Cancellation request", `${o.business_name ?? "A shop"} asked to cancel a paid order: ${reason.slice(0, 120)}`, "adminPayments", { tab: "cancellations" }, me.userId);
      return { id, status: "requested" };
    });
  }

  /** The shop answers a buyer's refund request: refund (the order is cancelled and the buyer's money goes back) or decline (an admin decides). */
  async vendorDecide(me: Identity | null, id: string, decision: string, reasonInput: string | null) {
    if (!me) throw forbidden("Please log in to continue.");
    if (decision !== "refund" && decision !== "decline") throw badRequest("Decision must be refund or decline.");
    const why = (reasonInput ?? "").trim();
    if (decision === "decline" && why.length < 3) throw badRequest("Please tell the buyer why you are not refunding.");
    return this.db().onBehalfOf(me, async (tx) => {
      const repo = new CancellationsRepository(tx);
      const c = await repo.byId(id);
      if (!c || c.requester_role !== "buyer") throw notFound("Refund request not found.");
      if (c.vendor_user_id !== me.userId) throw forbidden("Only the shop can answer this request.");
      if (c.status !== "requested") throw conflict("This request was already decided.");
      const notify = new NotificationWriter(tx);
      if (decision === "decline") {
        if (c.vendor_decision === "declined") throw conflict("You already declined this request.");
        await repo.vendorDeclined(id, why.slice(0, 500));
        await notify.create({ userId: c.buyer_id ?? "", type: "refund_declined", title: "The shop did not refund yet", body: `The shop said: ${why.slice(0, 200)}. Levromart will look at your request and decide.`, ...orderLink(c.order_id), actorId: me.userId });
        await notify.notifyAdmins("Refund request declined by the shop", `The shop declined a buyer's refund request: ${why.slice(0, 120)}`, "adminPayments", { tab: "todo" }, me.userId);
        return { status: "requested", vendor_decision: "declined" };
      }
      const o = await repo.order(c.order_id);
      if (!o || !["pending", "confirmed", "handed_over"].includes(o.status)) throw conflict("This order is no longer open, so it cannot be cancelled this way.");
      await repo.setCancelled(c.order_id);
      const refunded = await repo.queuedRefundKobo(c.order_id);
      await repo.decide(id, "approved", me.userId, null);
      await notify.create({ userId: c.buyer_id ?? "", type: "order_cancelled", title: "Refund on its way", body: refunded > 0 ? "The shop agreed. Your order was cancelled and your money is being refunded." : "The shop agreed and your order was cancelled.", ...orderLink(c.order_id), actorId: me.userId });
      return { status: "approved", refunded: refunded / 100 };
    });
  }

  /** The newest cancellation / refund request on an order, for the buyer, the shop and the admins. */
  async forOrder(me: Identity | null, orderId: string) {
    if (!me) throw forbidden("Please log in to continue.");
    return this.db().onBehalfOf(me, async (tx) => {
      const repo = new CancellationsRepository(tx);
      const c = await repo.latestForOrder(orderId);
      if (!c) return null;
      const admin = await new AccessRepository(tx).isAdmin(me.userId);
      if (!admin && me.userId !== c.buyer_id && me.userId !== c.vendor_user_id) throw forbidden("This request is not yours.");
      return c;
    });
  }

  async adminList(me: Identity | null, status: string | null) {
    if (!me) throw forbidden("Admin access required.");
    return this.db().onBehalfOf(me, async (tx) => {
      if (!(await new AccessRepository(tx).isAdmin(me.userId))) throw forbidden("Admin access required.");
      return new CancellationsRepository(tx).list(status, 100);
    });
  }

  /** Approving cancels the order and refunds the buyer; rejecting needs a reason the shop sees. */
  async decide(me: Identity | null, id: string, decision: string, reasonInput: string | null) {
    if (!me) throw forbidden("Admin access required.");
    if (decision !== "approve" && decision !== "reject") throw badRequest("Decision must be approve or reject.");
    const why = (reasonInput ?? "").trim();
    if (decision === "reject" && why.length < 3) throw badRequest("Please write the reason. The shop will see it.");
    return this.db().onBehalfOf(me, async (tx) => {
      if (!(await new AccessRepository(tx).isAdmin(me.userId))) throw forbidden("Admin access required.");
      const repo = new CancellationsRepository(tx);
      const c = await repo.byId(id);
      if (!c) throw notFound("Request not found.");
      if (c.status !== "requested") throw conflict("This request was already decided.");
      const notify = new NotificationWriter(tx);
      if (decision === "reject") {
        await repo.decide(id, "rejected", me.userId, why);
        await notify.create({ userId: c.vendor_user_id, type: "cancellation_rejected", title: "Cancellation not approved", body: `Levromart did not cancel this order: ${why}`, ...orderLink(c.order_id), actorId: me.userId });
        await repo.logAdminAction(me.userId, "Rejected a cancellation request", c.order_id);
        return { status: "rejected", refunded: 0 };
      }
      const o = await repo.order(c.order_id);
      // an admin can cancel and refund at any point: confirmed, out for delivery, disputed, even completed (only an order that is already cancelled has nothing left to do)
      if (!o || o.status === "cancelled") throw conflict("This order is already cancelled.");
      await repo.setCancelled(c.order_id);
      const refunded = await repo.queuedRefundKobo(c.order_id);
      await repo.decide(id, "approved", me.userId, null);
      await notify.create({ userId: c.vendor_user_id, type: "cancellation_approved", title: "Order cancelled", body: "Levromart cancelled this order and refunded the buyer.", ...orderLink(c.order_id), actorId: me.userId });
      await notify.create({ userId: c.buyer_id, type: "order_cancelled", title: "Order cancelled", body: refunded > 0 ? "The shop could not complete your order. It was cancelled and your money is being refunded." : "The shop could not complete your order, so it was cancelled.", ...orderLink(c.order_id), actorId: me.userId });
      await repo.logAdminAction(me.userId, "Approved a cancellation request", c.order_id);
      return { status: "approved", refunded: refunded / 100 };
    });
  }
}
