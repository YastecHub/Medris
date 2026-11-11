import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";
import { ConversationsRepository } from "../../database/repositories/conversations.repository.js";
import { OrderActionsRepository, type OrderRow } from "../../database/repositories/order-actions.repository.js";
import { sqlTrim } from "../../lib/sql-text.js";
import { badRequest, forbidden, notFound, unauthenticated } from "../../shared/errors/app-error.js";
import { OrderViewsRepository, type OrderListFilter } from "../../database/repositories/order-views.repository.js";

const chars = (s: string) => [...s].length;
const leftChars = (s: string, n: number) => [...s].slice(0, n).join("");

/**
 * What happens to an order after checkout. Every change runs on the caller's behalf, so the order
 * triggers (notifications, stock, points, commission) see who did it, as they did before.
 */
export class OrderActionsService {
  constructor(private readonly db: () => DataContext) {}

  /**
   * Replaces: public.transition_order_status(uuid, order_status) - the vendor moves an order on
   * (confirm, hand over / out for delivery once paid, complete, cancel, rental returned); the buyer may only cancel before hand-over or return
   * a rental. Completing needs the payments verified.
   */
  async transition(me: Identity | null, orderId: string, status: string): Promise<{ done: true }> {
    if (!me) throw forbidden("not authorized");
    await this.db().onBehalfOf(me, async (tx) => {
      const orders = new OrderActionsRepository(tx);
      await orders.castStatus(status);
      const o = await orders.order(orderId);
      if (!o) throw notFound("order not found");
      const isVendor = o.vendor_user_id === me.userId || (await orders.teamCan(me.userId, o.vendor_id, "orders"));
      if (!isVendor && o.buyer_id !== me.userId) throw forbidden("not authorized");
      if (
        !isVendor &&
        !(
          (o.status === "pending" && status === "cancelled") ||
          (o.status === "confirmed" && status === "cancelled") ||
          (o.status === "handed_over" && status === "returned" && o.order_type === "rental")
        )
      ) {
        throw forbidden("buyers may only cancel eligible orders or return handed-over rentals");
      }
      if (
        isVendor &&
        !(
          (o.status === "pending" && ["confirmed", "cancelled"].includes(status)) ||
          (o.status === "confirmed" && ["completed", "cancelled", "handed_over"].includes(status)) ||
          (o.status === "handed_over" && status === "returned" && o.order_type === "rental") ||
          (o.status === "handed_over" && status === "completed" && o.delivery_method === "delivery")
        )
      ) {
        throw badRequest(`invalid status transition from ${o.status} to ${status}`);
      }
      if (status === "handed_over") {
        // out for delivery / handed over: only once the money is in
        const feePaid = await orders.hasPaid(orderId, ["sale_price", "rental_fee"]);
        const depositOk = o.delivery_method === "delivery" && o.payment_timing === "pay_after" ? await orders.hasPaid(orderId, ["delivery_deposit_20"]) : true;
        if (!feePaid || !depositOk) throw badRequest("The payment must be confirmed before the order can be marked out for delivery.");
      }
      if (status === "completed") {
        const feePaid = await orders.hasPaid(orderId, ["sale_price", "rental_fee"]);
        if (o.delivery_method === "delivery") {
          const depositPaid = await orders.hasPaid(orderId, ["delivery_deposit_20"]);
          if (!depositPaid || !feePaid) throw badRequest("Required delivery payments must be verified before this order can be completed.");
          if (!isVendor) throw forbidden("Only the vendor can complete a delivery order after required payment is verified.");
        } else if (o.order_type === "sale" || o.order_type === "rental") {
          if (!feePaid) throw badRequest("The required sale/rental payment must be verified before this order can be completed.");
          if (!isVendor) throw forbidden("Only the vendor can complete this order after payment is verified.");
        }
      }
      await orders.setStatus(orderId, status);
    });
    return { done: true };
  }

  /** Replaces: public.buyer_confirm_received(uuid) - the buyer confirms they got it; the order completes. */
  async confirmReceived(me: Identity | null, orderId: string): Promise<{ success: true }> {
    if (!me) throw forbidden("Authentication required.");
    await this.db().onBehalfOf(me, async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const o = await orders.order(orderId);
      if (!o) throw notFound("Order not found.");
      if (o.buyer_id !== me.userId) throw forbidden("Only the buyer can confirm receipt.");
      // Once the money is in, the buyer may confirm at any time, even before the shop has marked the order out for delivery
      // (so nobody is left waiting): migration-free change from the original, which also needed the delivery clock to be running.
      if (!["confirmed", "handed_over"].includes(o.status) || (o.awaiting_confirmation_since == null && o.status !== "confirmed")) throw badRequest("This order is not waiting for your confirmation.");
      const fee = await orders.hasPaid(orderId, ["sale_price", "rental_fee"]);
      const deposit = o.delivery_method === "delivery" && o.payment_timing === "pay_after" ? await orders.hasPaid(orderId, ["delivery_deposit_20"]) : true;
      if (!fee || !deposit) throw badRequest("All required payments must be confirmed first.");
      await orders.complete(orderId);
    });
    return { success: true };
  }

  /** Replaces: public.vendor_decline_order(uuid, text) - before hand-over, with an optional reason the buyer sees. */
  async decline(me: Identity | null, orderId: string, reason: string | null | undefined): Promise<{ done: true }> {
    const work = async (orders: OrderActionsRepository, notify: NotificationWriter) => {
      const o = await orders.order(orderId);
      if (!o) throw notFound("order not found");
      if (!me || (o.vendor_user_id !== me.userId && !(await orders.teamCan(me.userId, o.vendor_id, "orders")))) throw forbidden("not authorized");
      if (!["pending", "confirmed"].includes(o.status)) throw badRequest("This order can no longer be declined or cancelled here.");
      const why = sqlTrim(reason ?? "");
      await orders.decline(orderId, why === "" ? null : why);
      await notify.create({
        userId: o.buyer_id,
        type: "order_cancelled_by_vendor",
        title: "Order declined",
        body: why === "" ? "The vendor declined your order." : `The vendor declined your order: ${sqlTrim(reason!)}`,
        targetView: "orderDetail",
        targetParams: { orderId },
        actorId: null,
      });
    };
    await this.run(me, (tx) => work(new OrderActionsRepository(tx), new NotificationWriter(tx)));
    return { done: true };
  }

  /** Replaces: public.add_order_note(uuid, text) - a short note between buyer and vendor (10 each per order, while it is open). */
  async addNote(me: Identity | null, orderId: string, bodyInput: string | null | undefined): Promise<{ id: string }> {
    if (!me) throw forbidden("Authentication required.");
    const body = (bodyInput ?? "").replace(/^ +| +$/g, "");
    if (chars(body) < 1 || chars(body) > 500) throw badRequest("Notes must be between 1 and 500 characters.");
    return this.db().onBehalfOf(me, async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const o = await orders.order(orderId, false);
      if (!o) throw badRequest("Order not found.");
      const isBuyer = o.buyer_id === me.userId;
      if (!isBuyer && o.vendor_user_id !== me.userId && !(await orders.teamCan(me.userId, o.vendor_id, "orders"))) throw forbidden("Not your order.");
      if (["completed", "cancelled"].includes(o.status)) throw badRequest("This order is closed, so notes can no longer be sent.");
      if ((await orders.notesBy(orderId, me.userId)) >= 10) throw badRequest("You have reached the note limit for this order.");
      const id = await orders.addNote(orderId, me.userId, body);
      await new NotificationWriter(tx).create({
        userId: isBuyer ? o.vendor_user_id : o.buyer_id,
        type: "order_note",
        title: isBuyer ? "Note on an order" : "Vendor replied to your note",
        body: leftChars(body, 80),
        targetView: "orderDetail",
        targetParams: { orderId },
        actorId: null,
      });
      return { id };
    });
  }

  /**
   * Replaces: public.edit_pending_order(uuid, jsonb, text, text, text) - the buyer changes quantities
   * (stock follows), the note and delivery details while the vendor has not confirmed yet.
   */
  async editPending(
    me: Identity | null,
    orderId: string,
    items: unknown,
    note: string | null,
    address: string | null,
    phone: string | null,
  ): Promise<{ done: true }> {
    if (!me) throw unauthenticated("must be signed in");
    if (!Array.isArray(items) || items.length === 0) throw badRequest("Your order must contain at least one item.");
    await this.db().onBehalfOf(me, async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const o = await orders.order(orderId);
      if (!o) throw notFound("Order not found.");
      if (o.buyer_id !== me.userId) throw forbidden("You can only edit your own orders.");
      if (o.status !== "pending") throw badRequest("This order can only be edited while it is waiting for vendor confirmation.");
      if (o.package_id != null) throw badRequest("Package orders cannot be edited after checkout.");
      if (!["sale", "rental"].includes(o.order_type)) throw badRequest("This order type cannot be edited.");
      if (!o.vendor_user_id) throw badRequest("Vendor account could not be found.");
      const kept: { quantity: number; unit_price: number }[] = [];
      for (const line of await orders.linesForEdit(orderId)) {
        const wanted = await orders.requestedQuantity(items, line.id);
        if (wanted < 0) throw badRequest("Quantity cannot be negative.");
        if (line.quantity_available != null && wanted > line.quantity + line.quantity_available) throw badRequest(`Not enough stock available for ${line.name}.`);
        await orders.takeStock(line.product_id, wanted - line.quantity);
        await orders.setLineQuantity(line.id, wanted);
        if (wanted !== 0) kept.push({ quantity: wanted, unit_price: line.unit_price });
      }
      if (await orders.hasForeignLine(orderId, items)) throw badRequest("One of the selected order items is no longer part of this order.");
      const total = await orders.itemsTotal(kept);
      if (Number(total) <= 0 || !(await orders.hasLines(orderId))) throw badRequest("Your order must contain at least one item.");
      await orders.saveEdit(orderId, total, note, address, phone);
      await new NotificationWriter(tx).create({
        userId: o.vendor_user_id,
        type: "order_updated",
        title: "Order updated",
        body: `A customer edited order #${orderId.replace(/-/g, "").slice(0, 8)}. Please review the updated items before confirming.`,
        targetView: "orderDetail",
        targetParams: { orderId, source: "sales" },
        actorId: me.userId,
      });
    });
    return { done: true };
  }

  /** Replaces: public.get_order_buyer_contact(uuid) - the buyer's name for the vendor once the order is accepted; admins also see the phone. */
  async buyerContact(me: Identity | null, orderId: string): Promise<{ name: string | null; phone: string | null }[]> {
    return this.db().asService(async (tx) => {
      const admin = await new AccessRepository(tx).isAdmin(me?.userId);
      return new OrderActionsRepository(tx).buyerContact(orderId, me?.userId ?? null, admin);
    });
  }

  /** New: the buyer's picture for the shop, shown with the name once the order is accepted. */
  async buyerAvatar(me: Identity | null, orderId: string): Promise<{ avatar_url: string | null }[]> {
    return this.db().asService(async (tx) => {
      const admin = await new AccessRepository(tx).isAdmin(me?.userId);
      return new OrderActionsRepository(tx).buyerAvatar(orderId, me?.userId ?? null, admin);
    });
  }

  /** Replaces: public.get_orders_buyer_names(uuid[]) */
  async buyerNames(me: Identity | null, orderIds: string[]): Promise<{ order_id: string; name: string | null }[]> {
    return this.db().asService(async (tx) => {
      const admin = await new AccessRepository(tx).isAdmin(me?.userId);
      return new OrderActionsRepository(tx).buyerNames(orderIds, me?.userId ?? null, admin);
    });
  }

  // ---- the shop's team ----

  /** The owner's team list. */
  async teamList(me: Identity | null): Promise<unknown[]> {
    if (!me) throw forbidden("Authentication required.");
    return this.db().asService(async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const shop = await orders.ownShopId(me.userId);
      return shop ? orders.teamOf(shop) : [];
    });
  }

  /** The owner adds a person who already has a Levromart account, by e-mail or phone, as a manager or staff member. */
  async teamAdd(me: Identity | null, identifier: string | null, role: string | null): Promise<{ user_id: string; name: string | null }> {
    if (!me) throw forbidden("Authentication required.");
    if (role !== "manager" && role !== "staff") throw badRequest("Choose manager or staff.");
    const who = (identifier ?? "").trim();
    if (who.length < 5 || who.length > 120) throw badRequest("Enter their e-mail or phone number.");
    return this.db().asService(async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const shop = await orders.ownShopId(me.userId);
      if (!shop) throw forbidden("Only a shop owner can manage a team.");
      const person = await orders.findAccount(who);
      if (!person) throw badRequest("We couldn't find a Levromart account with that e-mail or phone. Ask them to sign up first.");
      if (person.id === me.userId) throw badRequest("You already own this shop.");
      if ((await orders.teamCount(shop)) >= 10) throw badRequest("A shop can have up to 10 team members.");
      await orders.addMember(shop, person.id, role, me.userId);
      return { user_id: person.id, name: person.name };
    });
  }

  async teamRemove(me: Identity | null, userId: string): Promise<{ removed: number }> {
    if (!me) throw forbidden("Authentication required.");
    return this.db().asService(async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const shop = await orders.ownShopId(me.userId);
      if (!shop) throw forbidden("Only a shop owner can manage a team.");
      return { removed: await orders.removeMember(shop, userId) };
    });
  }

  /** The shops the caller works for as a team member. */
  async myTeams(me: Identity | null): Promise<unknown[]> {
    if (!me) return [];
    return this.db().asService((tx) => new OrderActionsRepository(tx).myTeams(me.userId));
  }

  /** The shop's orders for a team member's workspace (needs the "orders" permission). */
  async teamOrders(me: Identity | null, vendorId: string, activeOnly: boolean): Promise<unknown[]> {
    if (!me) throw forbidden("Authentication required.");
    return this.db().asService(async (tx) => {
      const orders = new OrderActionsRepository(tx);
      if (!(await orders.teamCan(me.userId, vendorId, "orders"))) throw forbidden("You are not on this shop's team.");
      return orders.teamOrders(vendorId, activeOnly);
    });
  }

  /** The shop's chats for a team member (needs the "chat" permission). */
  async teamChats(me: Identity | null, vendorId: string): Promise<unknown[]> {
    if (!me) throw forbidden("Authentication required.");
    return this.db().asService(async (tx) => {
      const orders = new OrderActionsRepository(tx);
      if (!(await orders.teamCan(me.userId, vendorId, "chat"))) throw forbidden("You are not on this shop's team.");
      return orders.teamChats(vendorId);
    });
  }

  async teamMessages(me: Identity | null, conversationId: string): Promise<unknown[]> {
    if (!me) throw forbidden("Authentication required.");
    return this.db().asService(async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const c = await orders.conversationVendor(conversationId);
      if (!c || !(await orders.teamCan(me.userId, c.vendor_id, "chat"))) throw forbidden("You are not on this shop's team.");
      return orders.teamMessages(conversationId, c.buyer_id);
    });
  }

  /** A team member answers a customer; the customer sees the shop (the database trigger names the shop, not the member). */
  async teamSend(me: Identity | null, conversationId: string, body: string | null): Promise<{ id: string }> {
    if (!me) throw forbidden("Authentication required.");
    const text = (body ?? "").trim();
    if (text.length < 1 || text.length > 2000) throw badRequest("A message must be between 1 and 2000 characters.");
    return this.db().asService(async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const c = await orders.conversationVendor(conversationId);
      if (!c || !(await orders.teamCan(me.userId, c.vendor_id, "chat"))) throw forbidden("You are not on this shop's team.");
      if (!(await new ConversationsRepository(tx).isOpen(me.userId, conversationId))) throw badRequest("This chat is closed right now.");
      return { id: await orders.insertTeamMessage(conversationId, me.userId, text) };
    });
  }

  /** Replaces: public.send_order_reminder(uuid) - the buyer nudges the vendor about a pending order (the buyer stays anonymous). */
  async remind(me: Identity | null, orderId: string): Promise<{ id: string }> {
    if (!me) throw forbidden("Authentication required.");
    return this.db().onBehalfOf(me, async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const o = await orders.remindableOrderOf(orderId, me.userId);
      if (!o) throw badRequest("This order no longer needs a reminder.");
      if (o.recent) throw badRequest("You already sent a reminder a moment ago. Please wait 2 minutes before sending another.");
      const owner = await orders.liveVendorOwner(o.vendor_id);
      if (!owner) throw badRequest("Vendor not found.");
      const id = await orders.notify({
        userId: owner,
        type: "order_reminder",
        title: "Order reminder",
        // The customer stays anonymous while the order is pending; once it is accepted the shop sees the name.
        body: ((who) =>
          o.status === "pending"
            ? "A customer is waiting for you to accept or decline their order."
            : o.status === "confirmed"
              ? `${who} is waiting for you to get their order ready and hand it over.`
              : `${who} is waiting for their order to arrive. Please update the delivery.`)(o.buyer_name?.trim() ? o.buyer_name.trim() : "A customer"),
        targetParams: { orderId: o.id, vendorId: o.vendor_id },
        vendorId: o.vendor_id,
        category: "order",
      });
      return { id };
    });
  }

  /** The shop reminds the customer about an accepted order that waits on them (to pay, or to confirm they got it). */
  async remindCustomer(me: Identity | null, orderId: string): Promise<{ id: string }> {
    if (!me) throw forbidden("Authentication required.");
    return this.db().onBehalfOf(me, async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const o = await orders.vendorRemindableOrderOf(orderId, me.userId);
      if (!o) throw badRequest("This order does not need a reminder right now.");
      if (o.recent) throw badRequest("You already sent a reminder a moment ago. Please wait 2 minutes before sending another.");
      const id = await orders.notify({
        userId: o.buyer_id,
        type: "order_reminder_customer",
        title: "Order reminder",
        body:
          o.status === "confirmed"
            ? `${o.vendor_name?.trim() || "The shop"} is waiting for you on your order. Please pay or follow up with them.`
            : `Your order from ${o.vendor_name?.trim() || "the shop"} is on its way. Please confirm when you have received it.`,
        targetParams: { orderId: o.id },
        category: "order",
      });
      return { id };
    });
  }

  /** The shop asks a customer (of a cancelled or completed order whose chat has closed) for permission to message them. */
  async requestCustomerChat(me: Identity | null, orderId: string): Promise<{ id: string }> {
    if (!me) throw forbidden("Authentication required.");
    return this.db().onBehalfOf(me, async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const o = await orders.order(orderId, false);
      if (!o) throw notFound("Order not found.");
      if (o.vendor_user_id !== me.userId && !(await orders.teamCan(me.userId, o.vendor_id, "chat"))) throw forbidden("Only the shop can ask to message this customer.");
      if (!["cancelled", "completed"].includes(o.status)) throw badRequest("The chat for this order is still open.");
      if (await orders.chatOpen(o.buyer_id, o.vendor_id)) throw badRequest("You can already message this customer.");
      if (await orders.recentChatRequest(o.buyer_id, o.vendor_id)) throw badRequest("You already asked this customer in the last 24 hours.");
      const id = await orders.notify({
        userId: o.buyer_id,
        type: "chat_request",
        title: `${o.vendor_name ?? "A shop"} wants to message you`,
        body: "Allow them to message you for the next 24 hours? You can say no.",
        targetParams: { orderId: o.id, vendorId: o.vendor_id },
        vendorId: o.vendor_id,
        category: "order",
      });
      return { id };
    });
  }

  /** The customer answers a shop's message request: allow (24 hours of chat) or decline. */
  async answerChatRequest(me: Identity | null, vendorId: string, accept: boolean): Promise<{ allowed: boolean }> {
    if (!me) throw forbidden("Authentication required.");
    return this.db().onBehalfOf(me, async (tx) => {
      const orders = new OrderActionsRepository(tx);
      if (!(await orders.openChatRequest(me.userId, vendorId))) throw badRequest("There is no message request to answer.");
      const owner = await orders.liveVendorOwner(vendorId);
      if (accept) await orders.grantChat(me.userId, vendorId);
      if (owner) {
        await orders.notify({
          userId: owner,
          type: accept ? "chat_request_allowed" : "chat_request_declined",
          title: accept ? "A customer allowed you to message them" : "A customer declined your message request",
          body: accept ? "You can message them for the next 24 hours." : "They preferred not to chat.",
          targetParams: {},
          vendorId,
          category: "order",
        });
      }
      return { allowed: accept };
    });
  }

  /** One tap: remind every shop that still has an order of yours waiting. Orders reminded in the last 2 minutes are skipped. */
  async remindAll(me: Identity | null): Promise<{ reminded: number; skipped: number }> {
    if (!me) throw forbidden("Authentication required.");
    const ids = await this.db().onBehalfOf(me, (tx) => new OrderActionsRepository(tx).remindableOrderIds(me.userId));
    let reminded = 0;
    for (const id of ids) {
      try {
        await this.remind(me, id);
        reminded++;
      } catch {
        /* reminded a moment ago, or no longer needs one */
      }
    }
    return { reminded, skipped: ids.length - reminded };
  }

  /** Replaces: public.set_order_buyer_location(uuid, double precision, double precision) - where to deliver a pending delivery order. */
  async setLocation(me: Identity | null, orderId: string, lat: number | null, lng: number | null): Promise<{ done: true }> {
    if (!me) throw unauthenticated("must be signed in");
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw badRequest("invalid location");
    await this.db().onBehalfOf(me, async (tx) => {
      if (!(await new OrderActionsRepository(tx).setBuyerLocation(orderId, me.userId, lat, lng))) {
        throw badRequest("Only your pending delivery orders can store a delivery location.");
      }
    });
    return { done: true };
  }

  /**
   * Replaces: public.vendor_suggest_order_quantity(uuid, jsonb, text) - the vendor can supply less than
   * was ordered and suggests the quantities; the buyer decides.
   */
  async suggestQuantity(me: Identity | null, orderId: string, items: unknown, noteInput: string | null): Promise<{ order_id: string; summary: string }> {
    if (!me) throw forbidden("You must be logged in.");
    if (!Array.isArray(items) || items.length === 0) throw badRequest("Enter the quantity you can supply.");
    return this.db().onBehalfOf(me, async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const o = await orders.order(orderId);
      if (!o) throw notFound("Order not found.");
      if (o.vendor_user_id !== me.userId && !(await orders.teamCan(me.userId, o.vendor_id, "orders"))) throw forbidden("Only the vendor can suggest a quantity.");
      if (o.status !== "pending") throw badRequest("You can only suggest a quantity while the order is pending.");
      if (o.order_type !== "sale" || o.package_id != null) throw badRequest("A quantity can only be suggested on product orders.");
      if (await orders.anyPaid(orderId)) throw badRequest("This order has already been paid for.");
      const lines: { id: string; name: string; requested: number; suggested: number }[] = [];
      let changed = false;
      let left = false;
      let summary = "";
      for (const line of await orders.linesByName(orderId)) {
        const suggested = (await orders.suggestedQuantity(items, line.id)) ?? line.quantity;
        if (suggested < 0 || suggested > line.quantity) throw badRequest("You can only suggest the same or a smaller quantity than was ordered.");
        if (suggested !== line.quantity) changed = true;
        if (suggested > 0) left = true;
        lines.push({ id: line.id, name: line.name, requested: line.quantity, suggested });
        summary += `${summary === "" ? "" : ", "}${suggested} of ${line.quantity} ${line.name}`;
      }
      if (!changed) throw badRequest("Change at least one quantity first.");
      if (!left) throw badRequest("Suggest at least one item, or use Decline to refuse the whole order.");
      const note = leftChars(sqlTrim(noteInput ?? ""), 300);
      await orders.saveProposal(orderId, lines, note === "" ? null : note);
      await orders.notify({
        userId: o.buyer_id,
        type: "order_quantity_suggestion",
        title: "The vendor suggested a different quantity",
        body: `${o.vendor_name ?? "The vendor"} can supply ${summary}. Open your order to accept it or keep your original order.`,
        targetParams: { orderId },
        vendorId: o.vendor_id,
        category: "order",
        metadata: { order_id: orderId, kind: "order_quantity_suggestion" },
      });
      return { order_id: orderId, summary };
    });
  }

  /** Replaces: public.buyer_respond_quantity_proposal(uuid, boolean) - the buyer takes the suggested quantities (new total) or keeps the order. */
  async respondToProposal(me: Identity | null, orderId: string, accept: boolean): Promise<{ order_id: string; accepted: boolean }> {
    if (!me) throw forbidden("You must be logged in.");
    return this.db().onBehalfOf(me, async (tx) => {
      const orders = new OrderActionsRepository(tx);
      const o = await orders.order(orderId);
      if (!o) throw notFound("Order not found.");
      if (o.buyer_id !== me.userId) throw forbidden("This is not your order.");
      if (o.quantity_proposal == null) throw badRequest("There is no suggestion to respond to.");
      // The original also cleared the suggestion here, but raising the error undid that; nothing is written.
      if (o.status !== "pending") throw badRequest("This order has already moved on.");
      const name = await orders.displayName(me.userId);
      if (accept) {
        for (const line of o.quantity_proposal.items ?? []) {
          const old = await orders.lockLine(orderId, line.id);
          if (old == null) continue;
          const suggested = Number(line.suggested);
          if (suggested < 0 || suggested > old) continue;
          await orders.setLineQuantity(line.id, suggested);
        }
        if (!(await orders.hasLines(orderId))) throw badRequest("The suggestion would leave your order empty.");
        await orders.reprice(orderId);
      } else {
        await orders.clearProposal(orderId);
      }
      await orders.notify({
        userId: o.vendor_user_id,
        type: "order_quantity_response",
        title: accept ? "Customer accepted your suggested quantity" : "Customer kept the original quantity",
        body: accept
          ? `${name} accepted the quantity you suggested. The order is updated and ready for you to confirm.`
          : `${name} kept the original quantity. You can still confirm or decline the order.`,
        targetParams: { orderId },
        actorId: me.userId,
        actorName: name,
        vendorId: o.vendor_id,
        category: "order",
        metadata: { order_id: orderId, kind: "order_quantity_response" },
      });
      return { order_id: orderId, accepted: accept };
    });
  }

  private run<T>(me: Identity | null, work: (tx: Parameters<Parameters<DataContext["asService"]>[0]>[0]) => Promise<T>): Promise<T> {
    return me ? this.db().onBehalfOf(me, work) : this.db().asService(work);
  }

  /** An order's notes, oldest first (up to 60). Replaces the app's select on order_notes; runs as the user, so only the buyer and the shop see them. */
  notes(me: Identity, orderId: string): Promise<{ id: string; sender_id: string; body: string; created_at: string }[]> {
    return this.db().asUser(me, (tx) => new OrderActionsRepository(tx).notes(orderId));
  }

  /** An order's payments (type, status, amount). Replaces the app's selects on payments; runs as the user. */
  payments(me: Identity, orderId: string): Promise<{ id: string; payment_type: string; status: string; amount: number }[]> {
    return this.db().asUser(me, (tx) => new OrderActionsRepository(tx).payments(orderId));
  }

  /** The order page (and every narrower read of one order). Replaces the app's selects of one order; runs as the user. */
  orderDetail(me: Identity, orderId: string): Promise<Record<string, unknown> | null> {
    return this.db().asUser(me, (tx) => new OrderViewsRepository(tx).detail(orderId));
  }

  /** The order lists, with the screen's filters. Replaces the app's list selects on orders; runs as the user. */
  orderList(me: Identity, filter: OrderListFilter): Promise<Record<string, unknown>[]> {
    return this.db().asUser(me, (tx) => new OrderViewsRepository(tx).list(me.userId, filter));
  }

  /** The order badges and profile numbers. */
  orderCounts(me: Identity, vendorId: string | null, since: string | null): Promise<Record<string, unknown>> {
    return this.db().asUser(me, (tx) => new OrderViewsRepository(tx).counts(me.userId, vendorId, since));
  }

  /** Whether the buyer has a completed order with the shop (as the caller sees it). */
  async completedBetween(me: Identity, buyerId: string, vendorId: string): Promise<{ completed: boolean }> {
    return { completed: await this.db().asUser(me, (tx) => new OrderViewsRepository(tx).completedBetween(buyerId, vendorId)) };
  }
}

export type { OrderRow };
