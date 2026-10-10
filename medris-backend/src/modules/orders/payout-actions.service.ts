import { SupabaseAdmin, SupabaseUserClient, lookupUser } from "../../integrations/supabase.js";
import { errorMessage } from "../../lib/http.js";
import { refundOrderPayout, releaseOrderPayout } from "../payments/payouts.service.js";
import type { ServiceResult } from "../../types/service.js";

/**
 * Money-moving order actions for card-paid orders (ported from
 * api/order-payout-action.js). Status changes go through the database
 * functions with the caller's own token, so Postgres re-checks ownership.
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

async function callerRole(db: SupabaseAdmin, userId: string): Promise<string | undefined> {
  return (await db.first<{ role?: string }>(`users?id=eq.${userId}&select=role`))?.role;
}

async function transition(accessToken: string, orderId: string, status: "completed" | "cancelled"): Promise<{ ok: boolean; message?: string }> {
  const rpcRes = await SupabaseUserClient.fromEnv(accessToken).rpc("transition_order_status", { p_order_id: orderId, p_new_status: status });
  if (rpcRes.ok) return { ok: true };
  const rpcJson = (await rpcRes.json().catch(() => ({}))) as { message?: string };
  return { ok: false, message: rpcJson.message };
}

export async function release({ orderId, accessToken }: Body): Promise<ServiceResult> {
  if (!orderId || !accessToken) return { status: 400, body: { error: "orderId and accessToken are required" } };
  const db = SupabaseAdmin.fromEnv();
  const { user: me } = await lookupUser(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const order = await db.first<{ id: string; status: string; buyer_id: string }>(`orders?id=eq.${orderId}&select=id,status,order_type,buyer_id`);
  if (!order) return { status: 404, body: { error: "Order not found" } };
  const role = await callerRole(db, me.id);
  if (order.buyer_id !== me.id && role !== "admin") return { status: 403, body: { error: "Only the buyer (or an admin) can confirm this order." } };

  if (order.status !== "completed") {
    const t = await transition(accessToken, orderId, "completed");
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
  const db = SupabaseAdmin.fromEnv();
  const { user: me } = await lookupUser(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };
  if ((await callerRole(db, me.id)) !== "admin") return { status: 403, body: { error: "Admins only." } };
  return { status: 200, body: { ...(await refundOrderPayout(orderId)) } };
}

export async function markManual({ orderId, accessToken }: Body): Promise<ServiceResult> {
  if (!orderId || !accessToken) return { status: 400, body: { error: "orderId and accessToken are required" } };
  const db = SupabaseAdmin.fromEnv();
  const { user: me } = await lookupUser(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };
  if ((await callerRole(db, me.id)) !== "admin") return { status: 403, body: { error: "Admins only." } };

  const order = await db.first<{ id: string; payout_status: string }>(`orders?id=eq.${orderId}&select=id,payout_status`);
  if (!order) return { status: 404, body: { error: "Order not found" } };
  if (order.payout_status !== "held") return { status: 400, body: { error: `Payout status is "${order.payout_status}", not held, nothing to mark.` } };

  await db.patch(`orders?id=eq.${orderId}`, { payout_status: "paid_manual", payout_released_at: new Date().toISOString() });
  return { status: 200, body: { marked: true } };
}

export async function buyerCancel({ orderId, accessToken }: Body): Promise<ServiceResult> {
  if (!orderId || !accessToken) return { status: 400, body: { error: "orderId and accessToken are required" } };
  const db = SupabaseAdmin.fromEnv();
  const { user: me } = await lookupUser(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const order = await db.first<{ id: string; status: string; buyer_id: string }>(`orders?id=eq.${orderId}&select=id,status,buyer_id`);
  if (!order) return { status: 404, body: { error: "Order not found" } };
  if (order.buyer_id !== me.id) return { status: 403, body: { error: "Only the buyer can cancel this order." } };
  if (order.status !== "confirmed") return { status: 400, body: { error: "This order can't be cancelled here anymore, the vendor has already handed it over." } };

  // Check the refund window BEFORE cancelling, so an order is never left
  // cancelled with the buyer's money stuck.
  const paidPayment = await db.first<{ paid_at?: string; created_at?: string }>(
    `payments?order_id=eq.${orderId}&payment_type=in.(sale_price,rental_fee)&status=eq.paid&limit=1`,
  );
  if (paidPayment) {
    const paidAt = new Date((paidPayment.paid_at || paidPayment.created_at) as string).getTime();
    if ((Date.now() - paidAt) / 3600000 > BUYER_CANCEL_WINDOW_HOURS) {
      return { status: 400, body: { error: "The 5-hour self-serve cancellation window has passed. Report an issue from the order page instead." } };
    }
  }

  const t = await transition(accessToken, orderId, "cancelled");
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
  const db = SupabaseAdmin.fromEnv();
  const { user: me } = await lookupUser(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const order = await db.first<{ id: string; status: string; vendor?: { user_id?: string } }>(`orders?id=eq.${orderId}&select=id,status,vendor:vendors(user_id)`);
  if (!order) return { status: 404, body: { error: "Order not found" } };
  if (order.vendor?.user_id !== me.id) return { status: 403, body: { error: "Only the vendor can decline this order." } };
  if (!["pending", "confirmed"].includes(order.status)) return { status: 400, body: { error: "This order can no longer be declined or cancelled here." } };

  const paidPayment = await db.first(
    `payments?order_id=eq.${orderId}&payment_type=in.(sale_price,rental_fee,delivery_deposit_20)&status=eq.paid&limit=1`,
  );

  const rpcRes = await SupabaseUserClient.fromEnv(accessToken).rpc("vendor_decline_order", { p_order_id: orderId, p_reason: reason || null });
  if (!rpcRes.ok) {
    const rpcJson = (await rpcRes.json().catch(() => ({}))) as { message?: string };
    return { status: 400, body: { error: rpcJson.message || "Could not decline this order." } };
  }
  if (!paidPayment) return { status: 200, body: { cancelled: true, refunded: false } };

  try {
    return { status: 200, body: { cancelled: true, ...(await refundOrderPayout(orderId)) } };
  } catch (refundErr) {
    return { status: 200, body: { cancelled: true, refunded: false, refundError: errorMessage(refundErr) } };
  }
}
