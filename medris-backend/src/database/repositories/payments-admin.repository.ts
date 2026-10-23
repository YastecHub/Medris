import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonRow, jsonRows } from "../json.js";

export interface Page {
  limit: number;
  offset: number;
}
export interface TxFilter {
  status?: string;
  purpose?: string;
  vendorId?: string;
  orderId?: string;
  from?: string;
  to?: string;
}
export interface Totals {
  collected_kobo: string;
  refunded_kobo: string;
  paid_out_kobo: string;
  commission_kobo: string;
}
export interface Health {
  stuck_payouts: number;
  held_payouts: number;
  failed_payouts: number;
  stuck_refunds: number;
  open_payments: number;
  last_report_at: string | null;
  last_report_problems: number | null;
}
export interface LedgerPaid {
  reference: string;
  amount_kobo: string;
  status: string;
  purpose: string;
}

/** Read-only views over the Paystack ledger for the admin Payments area, and the reconciliation reports (issue #101). */
export class PaymentsAdminRepository {
  constructor(private readonly db: Executor) {}

  transactions(f: TxFilter, page: Page) {
    return jsonRows(
      this.db,
      sql`select t.id, t.reference, t.purpose, t.status, t.amount_kobo::text as amount_kobo, t.order_id, t.vendor_id, v.business_name, t.channel, t.paid_at, t.created_at
          from public.paystack_transactions t left join public.vendors v on v.id = t.vendor_id
          where (${f.status ?? null}::text is null or t.status = ${f.status ?? null})
            and (${f.purpose ?? null}::text is null or t.purpose = ${f.purpose ?? null})
            and (${f.vendorId ?? null}::uuid is null or t.vendor_id = ${f.vendorId ?? null}::uuid)
            and (${f.orderId ?? null}::uuid is null or t.order_id = ${f.orderId ?? null}::uuid)
            and (${f.from ?? null}::timestamptz is null or t.created_at >= ${f.from ?? null}::timestamptz)
            and (${f.to ?? null}::timestamptz is null or t.created_at < ${f.to ?? null}::timestamptz)
          order by t.created_at desc limit ${page.limit} offset ${page.offset}`,
    );
  }

  refunds(f: TxFilter, page: Page) {
    return jsonRows(
      this.db,
      sql`select r.id, r.order_id, r.transaction_reference, r.attempt, r.amount_kobo::text as amount_kobo, r.status, r.reason, r.source, r.last_error, r.created_at, r.updated_at
          from public.paystack_refunds r join public.orders o on o.id = r.order_id
          where (${f.status ?? null}::text is null or r.status = ${f.status ?? null})
            and (${f.vendorId ?? null}::uuid is null or o.vendor_id = ${f.vendorId ?? null}::uuid)
            and (${f.orderId ?? null}::uuid is null or r.order_id = ${f.orderId ?? null}::uuid)
            and (${f.from ?? null}::timestamptz is null or r.created_at >= ${f.from ?? null}::timestamptz)
            and (${f.to ?? null}::timestamptz is null or r.created_at < ${f.to ?? null}::timestamptz)
          order by r.created_at desc limit ${page.limit} offset ${page.offset}`,
    );
  }

  /** Money in the last `since` (a Postgres interval such as '1 day'): what came in, went back, went out, and Levromart's commission. */
  async totals(since: "day" | "week" | "month"): Promise<Totals> {
    const days = since === "day" ? 1 : since === "week" ? 7 : 30;
    const r = await jsonRow<Totals>(
      this.db,
      sql`select
            (select coalesce(sum(amount_kobo), 0) from public.paystack_transactions
              where status in ('success', 'partially_refunded', 'refunded') and purpose in ('order_payment', 'order_balance') and paid_at >= now() - make_interval(days => ${days}))::text as collected_kobo,
            (select coalesce(sum(amount_kobo), 0) from public.paystack_refunds
              where status in ('processing', 'processed') and created_at >= now() - make_interval(days => ${days}))::text as refunded_kobo,
            (select coalesce(sum(amount_kobo), 0) from public.vendor_payouts
              where status in ('success', 'paid_manually') and updated_at >= now() - make_interval(days => ${days}))::text as paid_out_kobo,
            (select coalesce(sum(commission_kobo), 0) from public.vendor_payouts
              where status in ('success', 'paid_manually') and updated_at >= now() - make_interval(days => ${days}))::text as commission_kobo`,
    );
    return r as Totals;
  }

  async health(): Promise<Health> {
    const r = await jsonRow<Health>(
      this.db,
      sql`select
            (select count(*) from public.vendor_payouts where status = 'processing' and updated_at < now() - interval '30 minutes')::int as stuck_payouts,
            (select count(*) from public.vendor_payouts where status = 'on_hold')::int as held_payouts,
            (select count(*) from public.vendor_payouts where status in ('failed', 'reversed'))::int as failed_payouts,
            (select count(*) from public.paystack_refunds where status = 'processing' and updated_at < now() - interval '30 minutes')::int as stuck_refunds,
            (select count(*) from public.paystack_transactions where status = 'initialized' and created_at < now() - interval '1 hour' and created_at > now() - interval '2 days')::int as open_payments,
            (select created_at from public.paystack_reconciliation_reports order by created_at desc limit 1) as last_report_at,
            (select problems from public.paystack_reconciliation_reports order by created_at desc limit 1) as last_report_problems`,
    );
    return r as Health;
  }

  reports(limit: number) {
    return jsonRows(this.db, sql`select id, window_start, window_end, problems, report, created_at from public.paystack_reconciliation_reports order by window_start desc limit ${limit}`);
  }

  async saveReport(start: string, end: string, problems: number, report: unknown): Promise<void> {
    await this.db.execute(sql`
      insert into public.paystack_reconciliation_reports (window_start, window_end, problems, report)
      values (${start}, ${end}, ${problems}, ${JSON.stringify(report)}::jsonb)
      on conflict (window_start, window_end) do update set problems = excluded.problems, report = excluded.report, created_at = now()`);
  }

  /** What the ledger says was paid between two moments, and (for amounts) the references in a given list. */
  paidBetween(start: string, end: string): Promise<LedgerPaid[]> {
    return jsonRows<LedgerPaid>(
      this.db,
      sql`select reference, amount_kobo::text as amount_kobo, status, purpose from public.paystack_transactions
          where status in ('success', 'partially_refunded', 'refunded') and paid_at >= ${start}::timestamptz and paid_at < ${end}::timestamptz`,
    );
  }

  byReferences(references: string[]): Promise<LedgerPaid[]> {
    if (!references.length) return Promise.resolve([]);
    return jsonRows<LedgerPaid>(this.db, sql`select reference, amount_kobo::text as amount_kobo, status, purpose from public.paystack_transactions where reference in (${sql.join(references.map((r) => sql`${r}`), sql`, `)})`);
  }

  stuckTransfers() {
    return jsonRows(
      this.db,
      sql`select id, order_id, transfer_reference, amount_kobo::text as amount_kobo, updated_at from public.vendor_payouts where status = 'processing' and updated_at < now() - interval '60 minutes' limit 100`,
    );
  }

  stuckRefunds() {
    return jsonRows(
      this.db,
      sql`select id, order_id, transaction_reference, amount_kobo::text as amount_kobo, updated_at from public.paystack_refunds where status = 'processing' and updated_at < now() - interval '60 minutes' limit 100`,
    );
  }
}
