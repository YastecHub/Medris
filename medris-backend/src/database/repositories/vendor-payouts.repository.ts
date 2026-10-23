import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonReturning, jsonRow, jsonRows } from "../json.js";

export interface PayoutWork {
  id: string;
  order_id: string;
  vendor_id: string;
  transfer_reference: string;
  status: string;
  attempts: number;
  recipient_code: string | null;
  payout_verified_at: string | null;
  vendor_user_id: string | null;
  business_name: string | null;
}
export interface PayoutRow {
  id: string;
  order_id: string;
  vendor_id: string;
  business_name: string | null;
  amount_kobo: string;
  commission_kobo: string;
  status: string;
  hold_reason: string | null;
  attempts: number;
  last_error: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

const WORK = sql`
  select p.id, p.order_id, p.vendor_id, p.transfer_reference, p.status, p.attempts,
         v.transfer_recipient_code as recipient_code, v.payout_verified_at, v.user_id as vendor_user_id, v.business_name
  from public.vendor_payouts p join public.vendors v on v.id = p.vendor_id`;

/** The payout queue (migration 0007) and the numbers a payout is worked out from. Service role only. */
export class VendorPayoutsRepository {
  constructor(private readonly db: Executor) {}

  /** The next payout waiting to be sent. `skip locked`: two workers never take the same one. */
  nextPending(): Promise<PayoutWork | null> {
    return jsonRow<PayoutWork>(
      this.db,
      sql`${WORK} where p.status = 'pending' and (p.next_attempt_at is null or p.next_attempt_at <= now())
          order by p.created_at limit 1 for update of p skip locked`,
    );
  }

  /** The next failed payout whose waiting time is over. */
  nextRetryable(): Promise<PayoutWork | null> {
    return jsonRow<PayoutWork>(
      this.db,
      sql`${WORK} where p.status = 'failed' and p.updated_at <= now() - (case when p.attempts <= 1 then interval '10 minutes' else interval '1 hour' end)
          order by p.updated_at limit 1 for update of p skip locked`,
    );
  }

  byId(id: string): Promise<PayoutWork | null> {
    return jsonRow<PayoutWork>(this.db, sql`${WORK} where p.id = ${id} for update of p`);
  }

  hasOpenDispute(orderId: string): Promise<boolean> {
    return jsonRow<{ n: number }>(this.db, sql`select count(*)::int as n from public.disputes where order_id = ${orderId} and status = 'open'`).then((r) => (r?.n ?? 0) > 0);
  }

  /** Paid through Paystack for this order, in kobo (the order amount; the buyer's fee is not part of it). Refundable rental deposits are not the vendor's. */
  async paidKobo(orderId: string): Promise<number> {
    const r = await jsonRow<{ k: string }>(
      this.db,
      sql`select coalesce(round(sum(amount) * 100), 0)::text as k from public.payments
          where order_id = ${orderId} and status = 'paid' and method = 'card' and provider_reference like 'lvm\_ord\_%' and payment_type::text <> 'deposit'`,
    );
    return Number(r?.k ?? 0);
  }

  /** The platform's commission on the order (a waived one is not taken), in kobo. */
  async commissionKobo(orderId: string): Promise<number> {
    const r = await jsonRow<{ k: string }>(this.db, sql`select coalesce(round(sum(amount) * 100), 0)::text as k from public.commission_charges where order_id = ${orderId} and status <> 'waived'`);
    return Number(r?.k ?? 0);
  }

  /** Refunds made or under way on the order, in kobo (a failed refund did not leave Levromart). */
  async refundedKobo(orderId: string): Promise<number> {
    const r = await jsonRow<{ k: string }>(this.db, sql`select coalesce(sum(amount_kobo), 0)::text as k from public.paystack_refunds where order_id = ${orderId} and status <> 'failed'`);
    return Number(r?.k ?? 0);
  }

  /** The commission is taken out of the payout, so the vendor no longer owes it separately. */
  async settleCommission(orderId: string): Promise<void> {
    await this.db.execute(sql`update public.commission_charges set status = 'paid', paid_at = now() where order_id = ${orderId} and status = 'owed'`);
  }

  async markProcessing(id: string, amountKobo: number, commissionKobo: number, recipientCode: string): Promise<void> {
    await this.db.execute(sql`
      update public.vendor_payouts
      set status = 'processing', amount_kobo = ${amountKobo}, commission_kobo = ${commissionKobo}, recipient_code = ${recipientCode},
          attempts = attempts + 1, hold_reason = null, last_error = null
      where id = ${id}`);
  }

  async hold(id: string, reason: string): Promise<void> {
    await this.db.execute(sql`update public.vendor_payouts set status = 'on_hold', hold_reason = ${reason} where id = ${id}`);
  }

  /** Back in the queue, to be tried again at `at` (default: now). `giveBackAttempt` for a try that never reached the bank. */
  async requeue(id: string, opts: { at?: Date; error?: string | null; reference?: string; giveBackAttempt?: boolean } = {}): Promise<void> {
    await this.db.execute(sql`
      update public.vendor_payouts
      set status = 'pending', hold_reason = null, next_attempt_at = ${opts.at ? opts.at.toISOString() : null},
          last_error = coalesce(${opts.error ?? null}, last_error),
          transfer_reference = coalesce(${opts.reference ?? null}, transfer_reference),
          attempts = greatest(0, attempts - ${opts.giveBackAttempt ? 1 : 0})
      where id = ${id}`);
  }

  async fail(id: string, error: string): Promise<void> {
    await this.db.execute(sql`update public.vendor_payouts set status = 'failed', last_error = ${error.slice(0, 300)} where id = ${id}`);
  }

  async succeed(id: string, transferCode: string | null): Promise<void> {
    await this.db.execute(sql`update public.vendor_payouts set status = 'success', paystack_transfer_code = coalesce(${transferCode}, paystack_transfer_code), last_error = null where id = ${id}`);
  }

  async markManual(id: string, adminId: string, note: string): Promise<void> {
    await this.db.execute(sql`update public.vendor_payouts set status = 'paid_manually', settled_by = ${adminId}, note = ${note}, hold_reason = null where id = ${id}`);
  }

  /** Has an admin already been told about the empty balance in the last day? */
  async balanceAlertedToday(): Promise<boolean> {
    const r = await jsonRow<{ n: number }>(
      this.db,
      sql`select count(*)::int as n from public.notifications where title = 'Top up the Paystack balance' and created_at > now() - interval '24 hours'`,
    );
    return (r?.n ?? 0) > 0;
  }

  async logAdminAction(adminId: string, action: string, payoutId: string, label: string): Promise<void> {
    await this.db.execute(sql`
      insert into public.admin_actions (admin_id, admin_name, action, target_type, target_id, target_label)
      select ${adminId}, u.name, ${action}, 'vendor_payout', ${payoutId}, ${label} from public.users u where u.id = ${adminId}`);
  }

  /** The payout, with what the vendor needs to be told. */
  detail(id: string): Promise<{ order_id: string; amount_kobo: string; vendor_user_id: string | null } | null> {
    return jsonRow(
      this.db,
      sql`select p.order_id, p.amount_kobo::text as amount_kobo, v.user_id as vendor_user_id from public.vendor_payouts p join public.vendors v on v.id = p.vendor_id where p.id = ${id}`,
    );
  }

  forShop(userId: string, limit: number, offset: number): Promise<PayoutRow[]> {
    return jsonRows<PayoutRow>(
      this.db,
      sql`select p.id, p.order_id, p.vendor_id, v.business_name, p.amount_kobo::text as amount_kobo, p.commission_kobo::text as commission_kobo, p.status,
                 case when p.status = 'on_hold' then p.hold_reason end as hold_reason, p.attempts, null::text as last_error, p.note, p.created_at, p.updated_at
          from public.vendor_payouts p join public.vendors v on v.id = p.vendor_id
          where v.user_id = ${userId} order by p.created_at desc limit ${limit} offset ${offset}`,
    );
  }

  all(status: string | null, limit: number, offset: number, f: { vendorId?: string; orderId?: string; from?: string; to?: string } = {}): Promise<PayoutRow[]> {
    return jsonRows<PayoutRow>(
      this.db,
      sql`select p.id, p.order_id, p.vendor_id, v.business_name, p.amount_kobo::text as amount_kobo, p.commission_kobo::text as commission_kobo, p.status,
                 p.hold_reason, p.attempts, p.last_error, p.note, p.created_at, p.updated_at
          from public.vendor_payouts p join public.vendors v on v.id = p.vendor_id
          where (${status}::text is null or p.status = ${status})
            and (${f.vendorId ?? null}::uuid is null or p.vendor_id = ${f.vendorId ?? null}::uuid)
            and (${f.orderId ?? null}::uuid is null or p.order_id = ${f.orderId ?? null}::uuid)
            and (${f.from ?? null}::timestamptz is null or p.created_at >= ${f.from ?? null}::timestamptz)
            and (${f.to ?? null}::timestamptz is null or p.created_at < ${f.to ?? null}::timestamptz)
          order by p.created_at desc limit ${limit} offset ${offset}`,
    );
  }

  async release(id: string): Promise<boolean> {
    const rows = await jsonReturning(
      this.db,
      // a transfer Paystack already failed or reversed cannot be sent again under the same reference: a held one never left, so it keeps its own
      sql`update public.vendor_payouts
          set status = 'pending', hold_reason = null, next_attempt_at = null, attempts = 0,
              transfer_reference = case when status in ('failed', 'reversed') then left(transfer_reference, 39) || '_' || substr(md5(random()::text), 1, 6) else transfer_reference end
          where id = ${id} and status in ('on_hold', 'failed', 'reversed') returning id`,
    );
    return rows.length > 0;
  }
}
