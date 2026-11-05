import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonReturning, jsonRow, jsonRows } from "../json.js";

export interface PlatformAccount {
  bank_code: string;
  bank_name: string | null;
  account_name: string;
  account_last4: string;
  recipient_code: string;
  changed_at: string;
  age_hours: number;
}

export interface PlatformWithdrawal {
  id: string;
  amount_kobo: string;
  status: string;
  transfer_reference: string;
  bank_name: string | null;
  account_last4: string | null;
  requested_by: string | null;
}

/** Levromart's own wallet (migration 0035): the commission ledger, its bank account and its withdrawals. */
export class PlatformWalletRepository {
  constructor(private readonly db: Executor) {}

  /** One withdrawal at a time: every change of Levromart's balance takes this lock first (until the transaction ends). */
  async lock(): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtext('levromart_platform_wallet'))`);
  }

  async balanceKobo(): Promise<number> {
    const r = await jsonRow<{ k: string }>(this.db, sql`select coalesce(sum(amount_kobo), 0)::text as k from public.platform_wallet_entries`);
    return Number(r?.k ?? 0);
  }

  /** Commission (net of commission taken back) over the last `days` days; null = all time. */
  async commissionKobo(days: number | null): Promise<number> {
    const since = days == null ? sql`true` : sql`created_at >= now() - make_interval(days => ${days})`;
    const r = await jsonRow<{ k: string }>(
      this.db,
      sql`select coalesce(sum(amount_kobo), 0)::text as k from public.platform_wallet_entries where kind in ('commission', 'commission_reversed') and ${since}`,
    );
    return Number(r?.k ?? 0);
  }

  /** Levromart's share of a wallet payment, transfer or withdrawal (migration 0037); a negative one takes a fee back. Each reference counts once. */
  async addFee(f: { amountKobo: number; reference: string; note: string; vendorId?: string | null; orderId?: string | null }): Promise<void> {
    await this.db.execute(sql`
      insert into public.platform_wallet_entries (kind, amount_kobo, reference, note, vendor_id, order_id)
      values (${f.amountKobo > 0 ? "transaction_fee" : "transaction_fee_return"}, ${f.amountKobo}, ${f.reference}, ${f.note}, ${f.vendorId ?? null}::uuid, ${f.orderId ?? null}::uuid)
      on conflict do nothing`);
  }

  /** Fees from wallet payments, transfers and withdrawals over the last `days` days (net of fees given back); null = all time. */
  async transactionFeesKobo(days: number | null): Promise<number> {
    const since = days == null ? sql`true` : sql`created_at >= now() - make_interval(days => ${days})`;
    const r = await jsonRow<{ k: string }>(this.db, sql`select coalesce(sum(amount_kobo), 0)::text as k from public.platform_wallet_entries where kind in ('transaction_fee', 'transaction_fee_return') and ${since}`);
    return Number(r?.k ?? 0);
  }

  /** Monthly listing fees (migration 0036, after Paystack's fee) over the last `days` days; null = all time. */
  async listingFeesKobo(days: number | null): Promise<number> {
    const since = days == null ? sql`true` : sql`created_at >= now() - make_interval(days => ${days})`;
    const r = await jsonRow<{ k: string }>(this.db, sql`select coalesce(sum(amount_kobo), 0)::text as k from public.platform_wallet_entries where kind = 'listing_fee' and ${since}`);
    return Number(r?.k ?? 0);
  }

  async withdrawnKobo(): Promise<number> {
    const r = await jsonRow<{ k: string }>(this.db, sql`select coalesce(-sum(amount_kobo), 0)::text as k from public.platform_wallet_entries where kind in ('withdrawal', 'withdrawal_return')`);
    return Number(r?.k ?? 0);
  }

  /** Newest first, with the shop, the order and (for withdrawals) the bank it went to. */
  entries(before: string | null, limit: number) {
    const older = before ? sql`e.created_at < ${before}::timestamptz` : sql`true`;
    return jsonRows<Record<string, unknown>>(
      this.db,
      sql`select e.id, e.kind, e.amount_kobo::text as amount_kobo, e.note, e.created_at, e.order_id,
                 v.business_name as shop_name, w.bank_name, w.account_last4, w.status as withdrawal_status, w.recipient_code
            from public.platform_wallet_entries e
            left join public.vendors v on v.id = e.vendor_id
            left join public.platform_withdrawals w on w.id = e.withdrawal_id
           where ${older}
           order by e.created_at desc, e.id desc
           limit ${limit}`,
    );
  }

  /**
   * One line of Levromart's wallet with everything behind it, for the admin's detail sheet: the order (buyer, shop,
   * total), the transfer (from whom to whom), the person's withdrawal, or Levromart's own withdrawal (bank, who asked).
   */
  entry(id: string) {
    return jsonRow<Record<string, unknown>>(
      this.db,
      sql`select e.id, e.kind, e.amount_kobo::text as amount_kobo, e.note, e.reference, e.created_at, e.order_id,
                 v.id as vendor_id, v.business_name as shop_name, sw.handle as shop_handle, v.logo_url as shop_avatar,
                 o.total_amount::text as order_total, o.delivery_fee::text as order_delivery_fee, o.status::text as order_status, o.created_at as order_created_at,
                 ob.name as buyer_name, ob.email as buyer_email, bw.handle as buyer_handle, ob.avatar_url as buyer_avatar,
                 t.id as transfer_id, t.amount_kobo::text as transfer_amount_kobo, t.note as transfer_note, t.created_at as transfer_created_at,
                 fu.name as from_name, fw.handle as from_handle, fu.avatar_url as from_avatar, tu.name as to_name, tw.handle as to_handle, tu.avatar_url as to_avatar,
                 ww.id as user_withdrawal_id, ww.amount_kobo::text as user_withdrawal_amount_kobo, ww.status as user_withdrawal_status,
                 ww.bank_name as user_withdrawal_bank, ww.account_name as user_withdrawal_account_name, ww.account_last4 as user_withdrawal_last4,
                 wu.name as user_withdrawal_name, wwa.handle as user_withdrawal_handle, wu.avatar_url as user_withdrawal_avatar,
                 w.id as withdrawal_id, w.amount_kobo::text as withdrawal_amount_kobo, w.status as withdrawal_status, w.bank_name, w.account_name,
                 w.account_last4, w.transfer_reference, w.last_error, ru.name as requested_by_name
            from public.platform_wallet_entries e
            left join public.vendors v on v.id = e.vendor_id
            left join public.wallet_accounts sw on sw.user_id = v.user_id
            left join public.orders o on o.id = e.order_id
            left join public.users ob on ob.id = o.buyer_id
            left join public.wallet_accounts bw on bw.user_id = o.buyer_id
            left join public.wallet_transfers t on e.reference like 'fee:transfer:%' and t.id::text = split_part(e.reference, ':', 3)
            left join public.users fu on fu.id = t.from_user
            left join public.wallet_accounts fw on fw.user_id = t.from_user
            left join public.users tu on tu.id = t.to_user
            left join public.wallet_accounts tw on tw.user_id = t.to_user
            left join public.wallet_withdrawals ww on (e.reference like 'fee:withdrawal:%' or e.reference like 'fee_return:withdrawal:%') and ww.id::text = split_part(e.reference, ':', 3)
            left join public.users wu on wu.id = ww.user_id
            left join public.wallet_accounts wwa on wwa.user_id = ww.user_id
            left join public.platform_withdrawals w on w.id = e.withdrawal_id
            left join public.users ru on ru.id = w.requested_by
           where e.id = ${id}::uuid`,
    );
  }

  account(): Promise<PlatformAccount | null> {
    return jsonRow<PlatformAccount>(
      this.db,
      sql`select bank_code, bank_name, account_name, account_last4, recipient_code, changed_at,
                 extract(epoch from (now() - changed_at)) / 3600 as age_hours
            from public.platform_payout_account where id`,
    );
  }

  async saveAccount(a: { bankCode: string; bankName: string; accountName: string; last4: string; recipientCode: string; by: string }): Promise<void> {
    await this.db.execute(sql`
      insert into public.platform_payout_account (id, bank_code, bank_name, account_name, account_last4, recipient_code, set_by, changed_at)
      values (true, ${a.bankCode}, ${a.bankName}, ${a.accountName}, ${a.last4}, ${a.recipientCode}, ${a.by}, now())
      on conflict (id) do update set bank_code = excluded.bank_code, bank_name = excluded.bank_name, account_name = excluded.account_name,
        account_last4 = excluded.account_last4, recipient_code = excluded.recipient_code, set_by = excluded.set_by, changed_at = now()`);
  }

  async withdrawalsToday(): Promise<number> {
    const r = await jsonRow<{ n: number }>(this.db, sql`select count(*)::int as n from public.platform_withdrawals where created_at >= now() - interval '24 hours' and status <> 'failed'`);
    return r?.n ?? 0;
  }

  async insertWithdrawal(w: { amountKobo: number; reference: string; account: PlatformAccount; by: string }): Promise<string> {
    const [row] = await jsonReturning<{ id: string }>(
      this.db,
      sql`insert into public.platform_withdrawals (amount_kobo, transfer_reference, recipient_code, bank_name, account_name, account_last4, requested_by)
          values (${w.amountKobo}, ${w.reference}, ${w.account.recipient_code}, ${w.account.bank_name}, ${w.account.account_name}, ${w.account.account_last4}, ${w.by})
          returning id`,
    );
    return row!.id;
  }

  async addEntry(e: { kind: "withdrawal" | "withdrawal_return"; amountKobo: number; withdrawalId: string; reference: string; note: string }): Promise<boolean> {
    const rows = await jsonReturning<{ id: string }>(
      this.db,
      sql`insert into public.platform_wallet_entries (kind, amount_kobo, withdrawal_id, reference, note)
          values (${e.kind}, ${e.amountKobo}, ${e.withdrawalId}, ${e.reference}, ${e.note})
          on conflict do nothing returning id`,
    );
    return rows.length > 0;
  }

  withdrawalByReference(reference: string): Promise<PlatformWithdrawal | null> {
    return jsonRow<PlatformWithdrawal>(
      this.db,
      sql`select id, amount_kobo::text as amount_kobo, status, transfer_reference, bank_name, account_last4, requested_by
            from public.platform_withdrawals where transfer_reference = ${reference} for update`,
    );
  }

  async setWithdrawal(id: string, status: string, error: string | null, code: string | null): Promise<void> {
    await this.db.execute(sql`
      update public.platform_withdrawals set status = ${status}, last_error = coalesce(${error}, last_error), transfer_code = coalesce(${code}, transfer_code)
       where id = ${id}`);
  }

  recentWithdrawals(limit = 10) {
    return jsonRows<Record<string, unknown>>(
      this.db,
      sql`select w.id, w.amount_kobo::text as amount_kobo, w.status, w.bank_name, w.account_last4, w.last_error, w.created_at, u.name as requested_by_name
            from public.platform_withdrawals w left join public.users u on u.id = w.requested_by
           order by w.created_at desc limit ${limit}`,
    );
  }

  async logAdminAction(adminId: string, action: string, label: string): Promise<void> {
    await this.db.execute(sql`
      insert into public.admin_actions (admin_id, admin_name, action, target_type, target_id, target_label)
      select ${adminId}, u.name, ${action}, 'platform', ${adminId}, ${label} from public.users u where u.id = ${adminId}`);
  }
}
