/**
 * What Paystack may move a record from and to. Events can arrive twice or out of order, so a record only ever moves
 * forward along these rules; anything else is ignored (and recorded as "ignored: out of order").
 */

export type PayoutStatus = "pending" | "processing" | "success" | "failed" | "reversed" | "on_hold";
const PAYOUT_NEXT: Record<PayoutStatus, readonly PayoutStatus[]> = {
  pending: ["processing", "success", "failed", "reversed", "on_hold"],
  processing: ["success", "failed", "reversed", "on_hold"],
  // money sent, then taken back by the bank: the later truth wins
  success: ["reversed"],
  failed: [],
  reversed: [],
  on_hold: ["pending", "processing", "success", "failed", "reversed"],
};
export function canMovePayout(from: string, to: string): boolean {
  return (PAYOUT_NEXT[from as PayoutStatus] ?? []).includes(to as PayoutStatus);
}

export type TransactionStatus = "initialized" | "success" | "failed" | "abandoned" | "refunded" | "partially_refunded";
const TX_NEXT: Record<TransactionStatus, readonly TransactionStatus[]> = {
  initialized: ["success", "failed", "abandoned"],
  failed: ["success"], // a later successful retry of the same reference
  abandoned: ["success"],
  success: ["refunded", "partially_refunded"],
  partially_refunded: ["refunded"],
  refunded: [],
};
export function canMoveTransaction(from: string, to: string): boolean {
  return (TX_NEXT[from as TransactionStatus] ?? []).includes(to as TransactionStatus);
}

export type RefundStatus = "pending" | "processing" | "processed" | "failed";
const REFUND_NEXT: Record<RefundStatus, readonly RefundStatus[]> = {
  pending: ["processing", "processed", "failed"],
  processing: ["processed", "failed"],
  failed: ["processed"], // Paystack retried and it went through
  processed: [],
};
export function canMoveRefund(from: string, to: string): boolean {
  return (REFUND_NEXT[from as RefundStatus] ?? []).includes(to as RefundStatus);
}
