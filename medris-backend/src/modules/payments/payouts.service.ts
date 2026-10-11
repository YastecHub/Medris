import { SupabaseAdmin } from "../../integrations/supabase.js";
import { createRefund, createTransfer, createTransferRecipient } from "../../integrations/paystack.js";

/**
 * Legacy card-payment payouts (orders whose payout_status is not
 * "not_applicable"): releasing held money to the vendor and refunds.
 */

interface PayoutVendor {
  id: string;
  commission_pct?: number | null;
  bank_code?: string | null;
  account_number?: string | null;
  account_name?: string | null;
  transfer_recipient_code?: string | null;
}

/** Paystack transfer recipient for the vendor's bank account, created once and cached on the vendor row. */
export async function getOrCreateTransferRecipient(vendor: PayoutVendor): Promise<string> {
  if (vendor.transfer_recipient_code) return vendor.transfer_recipient_code;
  const { res, json } = await createTransferRecipient({
    type: "nuban",
    // Passed through as stored (missing values are simply omitted from the JSON, as before).
    name: vendor.account_name as string,
    account_number: vendor.account_number as string,
    bank_code: vendor.bank_code as string,
    currency: "NGN",
  });
  if (!res.ok || !json.status) throw new Error(json.message || "Could not register the vendor's bank account for payout.");
  const recipientCode = String(json.data?.recipient_code);
  await SupabaseAdmin.fromEnv().patch(`vendors?id=eq.${vendor.id}`, { transfer_recipient_code: recipientCode });
  return recipientCode;
}

export interface ReleaseResult {
  transferred: boolean;
  reason?: string;
  amount?: number;
}

/**
 * Moves held escrow money to the vendor's bank account and marks the order
 * released/completed. Commission stays on the platform balance; any deposit
 * passes through to the vendor in full.
 */
export async function releaseOrderPayout(orderId: string): Promise<ReleaseResult> {
  const db = SupabaseAdmin.fromEnv();
  const order = await db.first<{ id: string; payout_status: string; vendor?: PayoutVendor }>(
    `orders?id=eq.${orderId}&select=id,payout_status,vendor:vendors(id,commission_pct,bank_code,account_number,account_name,transfer_recipient_code)`,
  );
  if (!order) throw new Error("order not found");
  if (order.payout_status !== "held") return { transferred: false, reason: `payout_status is ${order.payout_status}, nothing to release` };

  const payments = await db.select<{ payment_type: string; amount: number }>(`payments?order_id=eq.${orderId}&status=eq.paid&select=payment_type,amount`);
  const feeAmount = (payments || [])
    .filter((p) => p.payment_type === "sale_price" || p.payment_type === "rental_fee")
    .reduce((s, p) => s + Number(p.amount), 0);
  const depositAmount = (payments || []).filter((p) => p.payment_type === "deposit").reduce((s, p) => s + Number(p.amount), 0);
  if (feeAmount <= 0) return { transferred: false, reason: "no paid fee found for this order" };

  if (!order.vendor?.bank_code || !order.vendor?.account_number) throw new Error("Vendor has no payout bank account on file yet.");
  const commissionPct = Number(order.vendor.commission_pct ?? 3);
  const payoutAmount = feeAmount * (1 - commissionPct / 100) + depositAmount;
  const recipientCode = await getOrCreateTransferRecipient(order.vendor);

  const { res, json } = await createTransfer({
    source: "balance",
    amount: Math.round(payoutAmount * 100),
    recipient: recipientCode,
    reason: "Levromart order payout",
    reference: `payout_${orderId}_${Date.now()}`,
  });
  if (!res.ok || !json.status) {
    // Newer Paystack business accounts may require OTP approval on transfers;
    // Paystack's message says so when that is the cause.
    throw new Error(json.message || "Paystack transfer failed");
  }

  await db.patch(`orders?id=eq.${orderId}`, {
    payout_status: "released",
    payout_released_at: new Date().toISOString(),
    payout_transfer_code: json.data?.transfer_code || json.data?.reference || null,
    status: "completed",
  });
  return { transferred: true, amount: payoutAmount };
}

/**
 * Refunds the buyer's original charge in full. For a "released" (split)
 * order the refund comes out of the platform's own Paystack balance.
 */
export async function refundOrderPayout(orderId: string): Promise<{ refunded: true }> {
  const db = SupabaseAdmin.fromEnv();
  const order = await db.first<{ id: string; payout_status: string | null }>(`orders?id=eq.${orderId}&select=id,payout_status`);
  if (!order) throw new Error("order not found");
  if (order.payout_status === "refunded") throw new Error(`Can't refund, this order was already refunded.`);

  const payment = await db.first<{ provider_reference: string }>(`payments?order_id=eq.${orderId}&status=eq.paid&select=provider_reference&limit=1`);
  if (!payment) throw new Error("No paid payment found for this order.");

  const { res, json } = await createRefund(payment.provider_reference);
  if (!res.ok || !json.status) throw new Error(json.message || "Paystack refund failed");

  await db.patch(`orders?id=eq.${orderId}`, { payout_status: "refunded", status: "cancelled" });
  return { refunded: true };
}
