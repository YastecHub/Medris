import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonReturning, jsonRow, jsonRows } from "../json.js";

export interface OwnShop {
  id: string;
  business_name: string | null;
  bank_code: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  transfer_recipient_code: string | null;
  payout_verified_at: string | null;
  payout_account_last4: string | null;
}

/** A vendor's verified payout account (migration 0006). Service role only: the service checks who is asking. */
export class PayoutAccountsRepository {
  constructor(private readonly db: Executor) {}

  /** The caller's own live shop, locked for the change. */
  ownShop(userId: string): Promise<OwnShop | null> {
    return jsonRow<OwnShop>(
      this.db,
      sql`select id, business_name, bank_code, bank_name, account_name, account_number, transfer_recipient_code, payout_verified_at, payout_account_last4
          from public.vendors where user_id = ${userId} and deleted_at is null limit 1 for update`,
    );
  }

  async save(vendorId: string, a: { bankCode: string; bankName: string; accountNumber: string; accountName: string; recipientCode: string }): Promise<void> {
    await this.db.execute(sql`
      update public.vendors
      set bank_code = ${a.bankCode}, bank_name = ${a.bankName}, account_number = ${a.accountNumber}, account_name = ${a.accountName},
          transfer_recipient_code = ${a.recipientCode}, payout_account_last4 = ${a.accountNumber.slice(-4)}, payout_verified_at = now()
      where id = ${vendorId}`);
  }

  /** Live shops (not deleted) whose payout account has not been verified, oldest first. */
  unverified(limit: number, offset: number): Promise<{ vendor_id: string; business_name: string | null; verification_status: string | null; has_bank_details: boolean }[]> {
    return jsonRows(
      this.db,
      sql`select id as vendor_id, business_name, verification_status::text as verification_status,
                 (nullif(trim(coalesce(account_number, '')), '') is not null) as has_bank_details
          from public.vendors where deleted_at is null and payout_verified_at is null
          order by created_at limit ${limit} offset ${offset}`,
    );
  }

  async countUnverified(): Promise<number> {
    const row = await jsonRow<{ n: number }>(this.db, sql`select count(*)::int as n from public.vendors where deleted_at is null and payout_verified_at is null`);
    return row?.n ?? 0;
  }

  async markUnverified(vendorId: string): Promise<number> {
    return (await jsonReturning(this.db, sql`update public.vendors set payout_verified_at = null where id = ${vendorId} returning id`)).length;
  }
}
