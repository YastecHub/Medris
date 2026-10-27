import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonReturning, jsonRow, jsonRows } from "../json.js";
import { payoutCommissionKobo } from "./vendor-payouts.repository.js";

/** The marker on a payout row that is waiting for the shop to withdraw it (migration 0017). */
export const WAITING_REASON = "Waiting for the vendor to withdraw";

export interface Bucket {
  payout_id: string;
  order_id: string;
  paid_at: string | null;
  net_kobo: string;
  disputed: boolean;
}
export interface WithdrawalRow {
  id: string;
  vendor_id: string;
  business_name: string | null;
  vendor_user_id: string | null;
  status: string;
  kind: string;
  order_ids: string[];
  amount_kobo: string;
  has_dispute: boolean;
  reject_reason: string | null;
  decided_at: string | null;
  created_at: string;
}

/** Withdrawals (migration 0017): the money waiting per order, and the requests for it. Service role only. */
export class WithdrawalsRepository {
  constructor(private readonly db: Executor) {}

  /** The shop's money that is waiting to be withdrawn, one row per completed order (what was paid, minus commission, minus refunds). */
  buckets(vendorId: string): Promise<Bucket[]> {
    return jsonRows<Bucket>(
      this.db,
      sql`select p.id as payout_id, p.order_id,
                 (select max(pay.paid_at) from public.payments pay where pay.order_id = p.order_id and pay.status = 'paid' and pay.method = 'card' and pay.provider_reference like 'lvm\_ord\_%') as paid_at,
                 greatest(0,
                   coalesce((select round(sum(pay.amount) * 100) from public.payments pay where pay.order_id = p.order_id and pay.status = 'paid' and pay.method = 'card' and pay.provider_reference like 'lvm\_ord\_%' and pay.payment_type::text <> 'deposit'), 0)
                   - ${payoutCommissionKobo(sql`p.order_id`)}
                   - coalesce((select sum(r.amount_kobo) from public.paystack_refunds r where r.order_id = p.order_id and r.status <> 'failed'), 0)
                 )::text as net_kobo,
                 exists (select 1 from public.disputes d where d.order_id = p.order_id and d.status = 'open') as disputed
          from public.vendor_payouts p join public.orders o on o.id = p.order_id
          where p.vendor_id = ${vendorId} and p.status = 'on_hold' and p.hold_reason = ${WAITING_REASON} and p.withdrawal_id is null
            and o.status::text in ('completed', 'disputed')
          order by p.created_at
          for update of p`,
    );
  }

  /** Orders of this shop that have an open dispute (any order, paid or not). */
  disputedOrders(vendorId: string): Promise<{ order_id: string }[]> {
    return jsonRows(this.db, sql`select distinct d.order_id from public.disputes d join public.orders o on o.id = d.order_id where o.vendor_id = ${vendorId} and d.status = 'open'`);
  }

  openRequest(vendorId: string): Promise<WithdrawalRow | null> {
    return jsonRow<WithdrawalRow>(
      this.db,
      sql`select w.id, w.vendor_id, null::text as business_name, null::uuid as vendor_user_id, w.status, w.kind, w.order_ids, w.amount_kobo::text as amount_kobo, w.has_dispute, w.reject_reason, w.decided_at, w.created_at
          from public.withdrawal_requests w where w.vendor_id = ${vendorId} and w.status = 'requested' for update`,
    );
  }

  recent(vendorId: string, limit = 15): Promise<WithdrawalRow[]> {
    return jsonRows<WithdrawalRow>(
      this.db,
      sql`select w.id, w.vendor_id, null::text as business_name, null::uuid as vendor_user_id, w.status, w.kind, w.order_ids, w.amount_kobo::text as amount_kobo, w.has_dispute, w.reject_reason, w.decided_at, w.created_at
          from public.withdrawal_requests w where w.vendor_id = ${vendorId} order by w.created_at desc limit ${limit}`,
    );
  }

  async insertRequest(vendorId: string, kind: "instant" | "approval", orderIds: string[], amountKobo: number, hasDispute: boolean): Promise<string> {
    const status = kind === "instant" ? "approved" : "requested";
    const [row] = await jsonReturning<{ id: string }>(
      this.db,
      sql`insert into public.withdrawal_requests (vendor_id, status, kind, order_ids, amount_kobo, has_dispute, decided_at)
          values (${vendorId}, ${status}, ${kind}, ${sql.raw(`'{${orderIds.join(",")}}'`)}::uuid[], ${amountKobo}, ${hasDispute}, ${kind === "instant" ? sql`now()` : sql`null`}) returning id`,
    );
    return row!.id;
  }

  /** How many requests under `belowKobo` this shop made in the last 24 hours (a limit against spamming small requests). */
  async smallRequestsToday(vendorId: string, belowKobo: number): Promise<number> {
    const row = await jsonRow<{ n: number }>(this.db, sql`select count(*)::int as n from public.withdrawal_requests where vendor_id = ${vendorId} and amount_kobo < ${belowKobo} and created_at > now() - interval '24 hours'`);
    return row?.n ?? 0;
  }

  async attach(requestId: string, payoutIds: string[]): Promise<void> {
    if (!payoutIds.length) return;
    await this.db.execute(sql`update public.vendor_payouts set withdrawal_id = ${requestId} where id in (${sql.join(payoutIds.map((x) => sql`${x}::uuid`), sql`, `)})`);
  }

  /** Releases the payouts of a request to the sending queue (the worker sends them within a minute). Returns how many. */
  async releasePayouts(requestId: string, exceptDisputed: boolean): Promise<number> {
    const rows = await jsonReturning(
      this.db,
      sql`update public.vendor_payouts p set status = 'pending', hold_reason = null, next_attempt_at = null
          where p.withdrawal_id = ${requestId} and p.status = 'on_hold'
            and (${!exceptDisputed} or not exists (select 1 from public.disputes d where d.order_id = p.order_id and d.status = 'open'))
          returning p.id`,
    );
    return rows.length;
  }

  /** A rejected request puts its money back in the shop's waiting pile. */
  async detach(requestId: string): Promise<void> {
    await this.db.execute(sql`update public.vendor_payouts set withdrawal_id = null where withdrawal_id = ${requestId} and status = 'on_hold'`);
  }

  byId(id: string): Promise<WithdrawalRow | null> {
    return jsonRow<WithdrawalRow>(
      this.db,
      sql`select w.id, w.vendor_id, v.business_name, v.user_id as vendor_user_id, w.status, w.kind, w.order_ids, w.amount_kobo::text as amount_kobo, w.has_dispute, w.reject_reason, w.decided_at, w.created_at
          from public.withdrawal_requests w join public.vendors v on v.id = w.vendor_id where w.id = ${id} for update of w`,
    );
  }

  async decide(id: string, status: "approved" | "rejected", adminId: string, reason: string | null): Promise<void> {
    await this.db.execute(sql`update public.withdrawal_requests set status = ${status}, decided_by = ${adminId}::uuid, decided_at = now(), reject_reason = ${reason} where id = ${id}`);
  }

  /** Requests for the admin screen, with what the admin must see before approving: open disputes and how long the shop has been around. */
  adminList(status: string | null, limit: number): Promise<(WithdrawalRow & { disputes: number; dispute_orders: string[]; account_name: string | null; bank_name: string | null; shop_since: string; account_changed_at: string | null })[]> {
    return jsonRows(
      this.db,
      sql`select w.id, w.vendor_id, v.business_name, v.user_id as vendor_user_id, w.status, w.kind, w.order_ids, w.amount_kobo::text as amount_kobo, w.has_dispute, w.reject_reason, w.decided_at, w.created_at,
                 (select count(*)::int from public.disputes d join public.orders o on o.id = d.order_id where o.vendor_id = w.vendor_id and d.status = 'open') as disputes,
                 coalesce((select array_agg(distinct d.order_id) from public.disputes d join public.orders o on o.id = d.order_id where o.vendor_id = w.vendor_id and d.status = 'open'), '{}') as dispute_orders,
                 v.account_name, v.bank_name, v.created_at as shop_since,
                 case when v.payout_verified_at is not null and v.payout_verified_at > w.created_at - interval '24 hours' then v.payout_verified_at end as account_changed_at
          from public.withdrawal_requests w join public.vendors v on v.id = w.vendor_id
          where (${status}::text is null or w.status = ${status})
          order by (w.status = 'requested') desc, w.created_at desc limit ${limit}`,
    );
  }

  /** The shop, with what a withdrawal needs to know about its bank account. */
  vendor(userId: string): Promise<{ id: string; user_id: string; business_name: string | null; recipient_code: string | null; payout_verified_at: string | null; verified_age_hours: number | null } | null> {
    return jsonRow(
      this.db,
      sql`select id, user_id, business_name, transfer_recipient_code as recipient_code, payout_verified_at,
                 (extract(epoch from (now() - payout_verified_at)) / 3600)::float as verified_age_hours
          from public.vendors where user_id = ${userId} and deleted_at is null limit 1`,
    );
  }

  vendorById(id: string): Promise<{ verified_age_hours: number | null } | null> {
    return jsonRow(this.db, sql`select (extract(epoch from (now() - payout_verified_at)) / 3600)::float as verified_age_hours from public.vendors where id = ${id}`);
  }

  /** Reopening a dispute: what is there, and is the money already gone? */
  dispute(id: string): Promise<{ id: string; order_id: string; status: string; admin_notes: string | null; order_status: string; vendor_user_id: string | null; buyer_id: string; sent: boolean } | null> {
    return jsonRow(
      this.db,
      sql`select d.id, d.order_id, d.status::text as status, d.admin_notes, o.status::text as order_status, v.user_id as vendor_user_id, o.buyer_id,
                 exists (select 1 from public.vendor_payouts p where p.order_id = o.id and p.status in ('processing', 'success', 'paid_manually')) as sent
          from public.disputes d join public.orders o on o.id = d.order_id join public.vendors v on v.id = o.vendor_id where d.id = ${id} for update of d`,
    );
  }

  async reopen(id: string, orderId: string, note: string): Promise<void> {
    await this.db.execute(sql`update public.disputes set status = 'open', admin_notes = coalesce(admin_notes, '') || case when coalesce(admin_notes, '') = '' then '' else E'\n' end || ${note} where id = ${id}`);
    await this.db.execute(sql`update public.orders set status = 'disputed'::public.order_status where id = ${orderId} and status in ('completed', 'confirmed', 'handed_over')`);
    await this.db.execute(sql`update public.vendor_payouts set status = 'on_hold', hold_reason = ${WAITING_REASON}, withdrawal_id = null where order_id = ${orderId} and status = 'pending'`);
  }

  async logAdminAction(adminId: string, action: string, targetType: string, targetId: string, label: string): Promise<void> {
    await this.db.execute(sql`
      insert into public.admin_actions (admin_id, admin_name, action, target_type, target_id, target_label)
      select ${adminId}, u.name, ${action}, ${targetType}, ${targetId}, ${label} from public.users u where u.id = ${adminId}`);
  }
}
