import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonRow } from "../json.js";

/** What each database change switches on, in plain words (for the admin banner). */
const CHECKS: { version: string; what: string; sql: ReturnType<typeof sql> }[] = [
  { version: "0014", what: "Paying for an order through the app marks it paid", sql: sql`select exists (select 1 from pg_proc where proname = 'apply_card_payment_to_order') as ok` },
  { version: "0016", what: "Replies to suggestions", sql: sql`select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'suggestions' and column_name = 'reply_message') as ok` },
  { version: "0017", what: "Vendor withdrawals and the approval queue", sql: sql`select to_regclass('public.withdrawal_requests') is not null as ok` },
  { version: "0018", what: "Cancel requests for paid orders", sql: sql`select to_regclass('public.cancellation_requests') is not null as ok` },
  { version: "0019", what: "The customers' refunds wallet and refund bank account", sql: sql`select to_regclass('public.buyer_payout_accounts') is not null and to_regclass('public.refund_credits') is not null as ok` },
  { version: "0020", what: "Verifying students without a matric number; who asked for a new school", sql: sql`select exists (select 1 from pg_proc p where p.proname = 'admin_campus_submissions' and pg_get_function_result(p.oid) like '%submitter_name%') as ok` },
  { version: "0021", what: "Suspending products", sql: sql`select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'suspended_reason') as ok` },
  { version: "0023", what: "Shops changing their own referral code", sql: sql`select to_regclass('public.vendor_referral_code_history') is not null as ok` },
  { version: "0024", what: "Commission on card orders taken from the payout (never asked of the shop twice)", sql: sql`select exists (select 1 from pg_proc where proname = 'record_order_completion_commission' and prosrc like '%v_card_payment%') as ok` },
  { version: "0025", what: "Points for a sale by size (20 / 50 / 100)", sql: sql`select exists (select 1 from pg_proc where proname = 'points_award_order' and prosrc like '%> 5000%') as ok` },
  { version: "0026", what: "Points for comments on a shop's products", sql: sql`select exists (select 1 from pg_trigger where tgname = 'trg_points_comment') as ok` },
  { version: "0027", what: "Any comment (emojis too) counts for points", sql: sql`select exists (select 1 from pg_proc where proname = 'trg_points_comment' and prosrc not like '%v_letters%') as ok` },
  { version: "0028", what: "Only a person's first 3 comments a week earn points (across all shops)", sql: sql`select exists (select 1 from pg_proc where proname = 'trg_points_comment' and prosrc like '%already earned points with 3 comments%') as ok` },
];

/** Asks the database which of the checked changes are missing (migration 0014 onward). */
export class SetupStatusRepository {
  constructor(private readonly tx: Executor) {}

  async missing(): Promise<{ version: string; what: string }[]> {
    const missing: { version: string; what: string }[] = [];
    for (const c of CHECKS) {
      const row = await jsonRow<{ ok: boolean }>(this.tx, c.sql).catch(() => null);
      if (!row?.ok) missing.push({ version: c.version, what: c.what });
    }
    return missing;
  }
}
