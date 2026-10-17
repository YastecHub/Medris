import type { ServiceResult } from "../../shared/types/service.js";
import { getDataContext } from "../../database/index.js";
import { NotifyRepository } from "../../database/repositories/messaging.repository.js";
import { OrdersRepository } from "../../database/repositories/orders.repository.js";

/**
 * 30-minute order reminder sweep (triggered by GitHub Actions, see
 * .github/workflows/order-reminders.yml). Nudges whoever needs to act on an
 * order stuck in confirmed / handed_over / returned for more than 2 hours.
 * Pending orders are handled by the database job remind_unattended_orders().
 */

const GRACE_MINUTES = 120; // don't nag a brand-new order in its first 2 hours
const REPEAT_MINUTES = 30;

export interface ReminderOrder {
  id: string;
  order_type: string;
  status: string;
  delivery_method: string;
  buyer_id: string | null;
  vendor?: { id: string; business_name?: string; user_id?: string } | null;
  payments?: { payment_type?: string | null; status?: string | null }[] | null;
}

export interface Reminder {
  userId: string;
  title: string;
  body: string;
}

export function remindersForOrder(o: ReminderOrder): Reminder[] {
  const isRental = o.order_type === "rental";
  const isPickup = o.delivery_method === "pickup";
  const vendorUserId = o.vendor?.user_id;
  const handoverVerb = isPickup ? "picked up by" : "delivered to";
  const handoverVerbBuyer = isPickup ? "pick up" : "receive delivery of";
  const out: Reminder[] = [];
  // Fully paid (delivery: deposit + balance; pickup: the full payment): the vendor has nothing left to chase,
  // it is up to the buyer to confirm receipt, so no "not yet handed over" reminders go to the vendor.
  const feeType = o.order_type === "sale" ? "sale_price" : "rental_fee";
  const paid = (type: string) =>
    (Array.isArray(o.payments) ? o.payments : []).some((p) => String(p.payment_type || "").trim().toLowerCase() === type && p.status === "paid");
  const fullyPaid = o.delivery_method === "delivery" ? paid("delivery_deposit_20") && paid(feeType) : paid(feeType);

  if (o.status === "pending") {
    if (vendorUserId) out.push({ userId: vendorUserId, title: "Order awaiting your confirmation", body: `You still have an order that hasn't been confirmed yet. Buyers are waiting — please accept or decline it.` });
    return out;
  }
  if (o.status === "confirmed") {
    if (vendorUserId && !fullyPaid) out.push({ userId: vendorUserId, title: "Order not yet handed over", body: `An order still hasn't been ${handoverVerb.replace(" to", "")} the buyer. Please arrange ${isPickup ? "pickup" : "delivery"} when you can.` });
    if (o.buyer_id) out.push({ userId: o.buyer_id, title: "Your order hasn't arrived yet", body: `Your order hasn't been ${isPickup ? "picked up" : "delivered"} yet. If it's taking too long, you can message the vendor from the order page.` });
    return out;
  }
  if (o.status === "handed_over") {
    if (isRental) {
      if (o.buyer_id) out.push({ userId: o.buyer_id, title: "Rental still with you", body: `Don't forget to return the rented item and mark it returned when you're done.` });
    } else if (o.buyer_id) {
      out.push({ userId: o.buyer_id, title: "Confirm you received your order", body: `Please confirm you've ${handoverVerbBuyer.startsWith("receive") ? "received" : "picked up"} your order so we can release payment to the vendor.` });
    }
    return out;
  }
  if (o.status === "returned") {
    if (vendorUserId) out.push({ userId: vendorUserId, title: "Rental return awaiting your confirmation", body: `A buyer marked a rental as returned. Please confirm to complete the order.` });
  }
  return out;
}

export async function runOrderReminderSweep(): Promise<{ checked: number; reminded: number }> {
  const data = getDataContext();
  const graceCutoff = new Date(Date.now() - GRACE_MINUTES * 60000).toISOString();
  const repeatCutoff = new Date(Date.now() - REPEAT_MINUTES * 60000).toISOString();

  const due = (await data.asService((tx) => new OrdersRepository(tx).dueForReminders(graceCutoff, repeatCutoff))) as unknown as ReminderOrder[];

  let reminded = 0;
  for (const o of due) {
    const notifs = remindersForOrder(o);
    if (notifs.length === 0) continue;
    // One transaction per order: its reminders and the "last reminded" stamp land together.
    await data.asService(async (tx) => {
      const notify = new NotifyRepository(tx);
      for (const n of notifs) {
        await notify.insertNotification({ userId: n.userId, type: "order_reminder", title: n.title, body: n.body, targetView: "orderDetail", targetParams: { orderId: o.id } });
      }
      await new OrdersRepository(tx).update(o.id, { lastReminderSentAt: new Date().toISOString() });
    });
    reminded++;
  }
  // Chats are never deleted: a finished order's conversation just drops out of the lists.
  return { checked: due.length, reminded };
}

/** ANY /api/order-reminders (cron): the sweep's counts. */
export async function runOrderReminders(): Promise<ServiceResult> {
  return { status: 200, body: await runOrderReminderSweep() };
}
