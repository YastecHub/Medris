import type { Identity } from "../../database/context.js";
import { getDataContext } from "../../database/index.js";
import { findPgError } from "../../database/errors.js";
import { OrdersRepository, PaymentsRepository } from "../../database/repositories/orders.repository.js";
import { UsersRepository } from "../../database/repositories/users.repository.js";
import { errorMessage } from "../../lib/http.js";
import { identityFromAccessToken } from "../auth/caller.js";
import { refundOrderPayout, releaseOrderPayout } from "../payments/payouts.service.js";
import type { ServiceResult } from "../../shared/types/service.js";

/**
 * Money-moving order actions for card-paid orders (ported from
 * api/order-payout-action.js). Status changes go through the database
 * functions as the caller (DataContext.asUser), so Postgres re-checks
 * ownership exactly as when the caller's token went to Supabase.
 *
 *  release        buyer (or admin) confirms receipt -> complete + pay out held money
 *  refund         admin only: refund the buyer's original charge
 *  mark-manual    admin only: record a held payout as paid outside Paystack
 *  buyer-cancel   buyer, while "confirmed", within 5 h of paying -> cancel + refund
 *  vendor-decline vendor, while "pending"/"confirmed" -> cancel + refund (no time window)
 */

const BUYER_CANCEL_WINDOW_HOURS = 5;

interface Body {
  orderId?: string;
  accessToken?: string;
  reason?: string;
}

async function callerRole(userId: string): Promise<string | null> {
  return getDataContext().asService((tx) => new UsersRepository(tx).roleOf(userId));
}

/** An order state change run as the user; the database's refusal message is passed back like PostgREST's `message`. */
async function asUserOrderChange(me: Identity, change: (orders: OrdersRepository) => Promise<void>): Promise<{ ok: boolean; message?: string }> {
  try {
    await getDataContext().asUser(me, (tx) => change(new OrdersRepository(tx)));
    return { ok: true };
  } catch (err) {
    const pg = findPgError(err);
    if (!pg) throw err;
    return { ok: false, message: pg.message };
  }
}

/** POST /api/order-payout-action: `action` picks the change; no action (or an unknown one) releases, as before. */
export function runPayoutAction(body: Body & { action?: string }): Promise<ServiceResult> {
  switch (body.action) {
    case "refund":
      return refund(body);
    case "mark-manual":
      return markManual(body);
    case "buyer-cancel":
      return buyerCancel(body);
    case "vendor-decline":
      return vendorDecline(body);
    default:
      return release(body);
  }
}

export async function release({ orderId, accessToken }: Body): Promise<ServiceResult> {
  if (!orderId || !accessToken) return { status: 400, body: { error: "orderId and accessToken are required" } };
  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const order = await getDataContext().asService((tx) => new OrdersRepository(tx).basic(orderId));
  if (!order) return { status: 404, body: { error: "Order not found" } };
  const role = await callerRole(me.userId);
  if (order.buyer_id !== me.userId && role !== "admin") return { status: 403, body: { error: "Only the buyer (or an admin) can confirm this order." } };

  if (order.status !== "completed") {
    const t = await asUserOrderChange(me, (orders) => orders.transitionStatus(orderId, "completed"));
    if (!t.ok) return { status: 400, body: { error: t.message || "Could not complete this order." } };
  }

  // The confirmation itself succeeded. A failed bank transfer is a payout
  // problem for an admin to chase, not a failed confirmation for the buyer.
  try {
    const result = await releaseOrderPayout(orderId);
    return { status: 200, body: { status: "completed", ...result } };
  } catch (payoutErr) {
    return { status: 200, body: { status: "completed", transferred: false, payoutError: errorMessage(payoutErr) } };
  }
}

export async function refund({ orderId, accessToken }: Body): Promise<ServiceResult> {
  if (!orderId || !accessToken) return { status: 400, body: { error: "orderId and accessToken are required" } };
  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };
  if ((await callerRole(me.userId)) !== "admin") return { status: 403, body: { error: "Admins only." } };
  return { status: 200, body: { ...(await refundOrderPayout(orderId)) } };
}

export async function markManual({ orderId, accessToken }: Body): Promise<ServiceResult> {
  if (!orderId || !accessToken) return { status: 400, body: { error: "orderId and accessToken are required" } };
  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };
  if ((await callerRole(me.userId)) !== "admin") return { status: 403, body: { error: "Admins only." } };

  const data = getDataContext();
  const order = await data.asService((tx) => new OrdersRepository(tx).payoutStatus(orderId));
  if (!order) return { status: 404, body: { error: "Order not found" } };
  if (order.payout_status !== "held") return { status: 400, body: { error: `Payout status is "${order.payout_status}", not held, nothing to mark.` } };

  await data.asService((tx) => new OrdersRepository(tx).update(orderId, { payoutStatus: "paid_manual", payoutReleasedAt: new Date().toISOString() }));
  return { status: 200, body: { marked: true } };
}

export async function buyerCancel({ orderId, accessToken }: Body): Promise<ServiceResult> {
  if (!orderId || !accessToken) return { status: 400, body: { error: "orderId and accessToken are required" } };
  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const data = getDataContext();
  const order = await data.asService((tx) => new OrdersRepository(tx).basic(orderId));
  if (!order) return { status: 404, body: { error: "Order not found" } };
  if (order.buyer_id !== me.userId) return { status: 403, body: { error: "Only the buyer can cancel this order." } };
  if (order.status !== "confirmed") return { status: 400, body: { error: "This order can't be cancelled here anymore, the vendor has already handed it over." } };

  // Check the refund window BEFORE cancelling, so an order is never left
  // cancelled with the buyer's money stuck.
  const paidPayment = await data.asService((tx) => new PaymentsRepository(tx).firstPaid(orderId, ["sale_price", "rental_fee"]));
  if (paidPayment) {
    const paidAt = new Date((paidPayment.paid_at || paidPayment.created_at) as string).getTime();
    if ((Date.now() - paidAt) / 3600000 > BUYER_CANCEL_WINDOW_HOURS) {
      return { status: 400, body: { error: "The 5-hour self-serve cancellation window has passed. Report an issue from the order page instead." } };
    }
  }

  const t = await asUserOrderChange(me, (orders) => orders.transitionStatus(orderId, "cancelled"));
  if (!t.ok) return { status: 400, body: { error: t.message || "Could not cancel this order." } };
  if (!paidPayment) return { status: 200, body: { cancelled: true, refunded: false } };

  try {
    return { status: 200, body: { cancelled: true, ...(await refundOrderPayout(orderId)) } };
  } catch (refundErr) {
    return { status: 200, body: { cancelled: true, refunded: false, refundError: errorMessage(refundErr) } };
  }
}

export async function vendorDecline({ orderId, accessToken, reason }: Body): Promise<ServiceResult> {
  if (!orderId || !accessToken) return { status: 400, body: { error: "orderId and accessToken are required" } };
  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const data = getDataContext();
  const order = await data.asService((tx) => new OrdersRepository(tx).withVendorOwner(orderId));
  if (!order) return { status: 404, body: { error: "Order not found" } };
  if (order.vendor?.user_id !== me.userId) return { status: 403, body: { error: "Only the vendor can decline this order." } };
  if (!["pending", "confirmed"].includes(order.status)) return { status: 400, body: { error: "This order can no longer be declined or cancelled here." } };

  const paidPayment = await data.asService((tx) => new PaymentsRepository(tx).firstPaid(orderId, ["sale_price", "rental_fee", "delivery_deposit_20"]));

  const declined = await asUserOrderChange(me, (orders) => orders.vendorDecline(orderId, reason || null));
  if (!declined.ok) return { status: 400, body: { error: declined.message || "Could not decline this order." } };
  if (!paidPayment) return { status: 200, body: { cancelled: true, refunded: false } };

  try {
    return { status: 200, body: { cancelled: true, ...(await refundOrderPayout(orderId)) } };
  } catch (refundErr) {
    return { status: 200, body: { cancelled: true, refunded: false, refundError: errorMessage(refundErr) } };
  }
}
