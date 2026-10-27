import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonRow, jsonRows } from "../json.js";

export interface RefundOrder {
  id: string;
  buyer_id: string;
  vendor_id: string;
  status: string;
  buyer_name: string | null;
  vendor_user_id: string | null;
}
export interface PaidPayment {
  reference: string;
  net_kobo: string;
  refunded_kobo: string;
}
export interface RefundWork {
  id: string;
  order_id: string;
  transaction_reference: string;
  amount_kobo: string;
  buyer_id: string;
  vendor_user_id: string | null;
  reason: string | null;
}

/** Refund rows and the numbers a refund is worked out from (migration 0008). Service role only. */
export class PaystackRefundsRepository {
  constructor(private readonly db: Executor) {}

  /** Locks the order, so a refund, a cancellation and a payout of one order are handled one after the other. */
  lockOrder(orderId: string): Promise<RefundOrder | null> {
    return jsonRow<RefundOrder>(
      this.db,
      sql`select o.id, o.buyer_id, o.vendor_id, o.status::text as status, b.name as buyer_name, v.user_id as vendor_user_id
          from public.orders o join public.vendors v on v.id = o.vendor_id left join public.users b on b.id = o.buyer_id
          where o.id = ${orderId} for update of o`,
    );
  }

  /** The order's payout, locked, with its state: once it is on its way or sent, the money is the vendor's. */
  payoutState(orderId: string): Promise<{ id: string; status: string } | null> {
    return jsonRow(this.db, sql`select id, status from public.vendor_payouts where order_id = ${orderId} for update`);
  }

  /** Each Paystack card payment on the order (newest first): what it paid for the order, and how much of that is already refunded or being refunded. */
  paidPayments(orderId: string): Promise<PaidPayment[]> {
    return jsonRows<PaidPayment>(
      this.db,
      sql`select p.provider_reference as reference, round(sum(p.amount) * 100)::text as net_kobo,
                 coalesce((select sum(r.amount_kobo) from public.paystack_refunds r where r.transaction_reference = p.provider_reference and r.status <> 'failed'), 0)::text as refunded_kobo
          from public.payments p join public.paystack_transactions t on t.reference = p.provider_reference and t.status in ('success', 'partially_refunded')
          where p.order_id = ${orderId} and p.status = 'paid' and p.method = 'card' and p.provider_reference like 'lvm\_ord\_%'
          group by p.provider_reference order by max(p.created_at) desc`,
    );
  }

  async openRefund(orderId: string): Promise<{ id: string } | null> {
    return jsonRow(this.db, sql`select id from public.paystack_refunds where order_id = ${orderId} and status in ('pending', 'processing') limit 1`);
  }

  async nextAttempt(orderId: string): Promise<number> {
    const r = await jsonRow<{ n: number }>(this.db, sql`select coalesce(max(attempt), 0)::int + 1 as n from public.paystack_refunds where order_id = ${orderId}`);
    return r?.n ?? 1;
  }

  async insert(orderId: string, reference: string, attempt: number, amountKobo: number, reason: string, adminId: string): Promise<void> {
    await this.db.execute(sql`
      insert into public.paystack_refunds (transaction_reference, order_id, attempt, amount_kobo, reason, requested_by, source)
      values (${reference}, ${orderId}, ${attempt}, ${amountKobo}, ${reason}, ${adminId}, 'admin')`);
  }

  /** The refund waiting to be sent. `skip locked`: two workers never take the same one. */
  nextPending(): Promise<RefundWork | null> {
    return jsonRow<RefundWork>(
      this.db,
      sql`select r.id, r.order_id, r.transaction_reference, r.amount_kobo::text as amount_kobo, r.reason, o.buyer_id, v.user_id as vendor_user_id
          from public.paystack_refunds r join public.orders o on o.id = r.order_id join public.vendors v on v.id = o.vendor_id
          where r.status = 'pending' order by r.created_at limit 1 for update of r skip locked`,
    );
  }

  async markProcessing(id: string): Promise<void> {
    await this.db.execute(sql`update public.paystack_refunds set status = 'processing', last_error = null where id = ${id}`);
  }

  /** Paystack accepted the refund: keep its id, so the refund is never mistaken for one that was not sent. */
  async markSent(id: string, paystackRefundId: string | null): Promise<void> {
    await this.db.execute(sql`update public.paystack_refunds set paystack_refund_id = coalesce(${paystackRefundId}, paystack_refund_id) where id = ${id}`);
  }

  /**
   * Refunds left "processing" for a while without a Paystack refund id: either Paystack never got them (a job that stopped
   * half-way) or its answer was lost. Only those whose payment has a Paystack id can be checked with Paystack.
   */
  unconfirmedProcessing(olderThanMinutes: number, limit: number): Promise<{ id: string; transaction_reference: string; amount_kobo: string; paystack_transaction_id: string }[]> {
    return jsonRows(
      this.db,
      sql`select r.id, r.transaction_reference, r.amount_kobo::text as amount_kobo, t.paystack_transaction_id::text as paystack_transaction_id
          from public.paystack_refunds r join public.paystack_transactions t on t.reference = r.transaction_reference
          where r.status = 'processing' and r.paystack_refund_id is null and t.paystack_transaction_id is not null
            and r.updated_at < now() - make_interval(mins => ${olderThanMinutes})
          order by r.updated_at limit ${limit}`,
    );
  }

  /** Locks every refund row of one payment and returns the Paystack refund ids already matched to one of them. */
  async lockPaymentRefunds(transactionReference: string): Promise<{ id: string; status: string; paystack_refund_id: string | null }[]> {
    return jsonRows(this.db, sql`select id, status, paystack_refund_id from public.paystack_refunds where transaction_reference = ${transactionReference} order by attempt for update`);
  }

  /** Paystack has no refund for it: it never left, so it goes back in the queue (sent once, by the next run). */
  async requeueUnsent(id: string): Promise<void> {
    await this.db.execute(sql`update public.paystack_refunds set status = 'pending', last_error = null where id = ${id} and status = 'processing' and paystack_refund_id is null`);
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db.execute(sql`update public.paystack_refunds set status = 'failed', last_error = ${error.slice(0, 300)} where id = ${id}`);
  }

  async note(id: string, error: string): Promise<void> {
    await this.db.execute(sql`update public.paystack_refunds set last_error = ${error.slice(0, 300)} where id = ${id}`);
  }

  async holdPayout(orderId: string, reason: string): Promise<void> {
    await this.db.execute(sql`update public.vendor_payouts set status = 'on_hold', hold_reason = ${reason} where order_id = ${orderId} and status = 'pending'`);
  }

  async logAdminAction(adminId: string, action: string, orderId: string): Promise<void> {
    await this.db.execute(sql`
      insert into public.admin_actions (admin_id, admin_name, action, target_type, target_id, target_label)
      select ${adminId}, u.name, ${action}, 'order', ${orderId}, 'Paystack refund' from public.users u where u.id = ${adminId}`);
  }
}
