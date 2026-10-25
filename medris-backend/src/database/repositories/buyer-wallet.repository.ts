import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonReturning, jsonRow, jsonRows } from "../json.js";

export interface BuyerAccount {
  user_id: string;
  bank_code: string;
  bank_name: string;
  account_name: string;
  account_last4: string;
  transfer_recipient_code: string;
  verified_at: string;
  verified_age_hours: number;
}
export interface Credit {
  id: string;
  order_id: string | null;
  amount_kobo: string;
  status: string;
  created_at: string;
}
export interface RefundWithdrawal {
  id: string;
  buyer_id: string;
  amount_kobo: string;
  status: string;
  transfer_reference: string;
  last_error: string | null;
  created_at: string;
}

/** The buyer's refunds wallet (migration 0019). Service role only. */
export class BuyerWalletRepository {
  constructor(private readonly db: Executor) {}

  account(userId: string): Promise<BuyerAccount | null> {
    return jsonRow<BuyerAccount>(
      this.db,
      sql`select user_id, bank_code, bank_name, account_name, account_last4, transfer_recipient_code, verified_at, (extract(epoch from (now() - verified_at)) / 3600)::float as verified_age_hours
          from public.buyer_payout_accounts where user_id = ${userId}`,
    );
  }

  async saveAccount(userId: string, a: { bankCode: string; bankName: string; accountName: string; last4: string; recipientCode: string }): Promise<void> {
    await this.db.execute(sql`
      insert into public.buyer_payout_accounts (user_id, bank_code, bank_name, account_name, account_last4, transfer_recipient_code, verified_at)
      values (${userId}, ${a.bankCode}, ${a.bankName}, ${a.accountName}, ${a.last4}, ${a.recipientCode}, now())
      on conflict (user_id) do update set bank_code = excluded.bank_code, bank_name = excluded.bank_name, account_name = excluded.account_name,
        account_last4 = excluded.account_last4, transfer_recipient_code = excluded.transfer_recipient_code, verified_at = now()`);
  }

  /** The refund waiting to be paid goes into the wallet (when the buyer has an account) instead of back onto the card. Returns true when it did. */
  async creditRefund(refund: { id: string; order_id: string; buyer_id: string; amount_kobo: string }): Promise<boolean> {
    if (!(await this.account(refund.buyer_id))) return false;
    await this.db.execute(sql`
      insert into public.refund_credits (buyer_id, order_id, refund_id, amount_kobo) values (${refund.buyer_id}, ${refund.order_id}, ${refund.id}, ${refund.amount_kobo})
      on conflict (refund_id) do nothing`);
    await this.db.execute(sql`update public.paystack_refunds set status = 'processed', last_error = null where id = ${refund.id}`);
    return true;
  }

  /** Locks and returns the credits that can be withdrawn. */
  availableCredits(userId: string): Promise<Credit[]> {
    return jsonRows<Credit>(this.db, sql`select id, order_id, amount_kobo::text as amount_kobo, status, created_at from public.refund_credits where buyer_id = ${userId} and status = 'available' order by created_at for update`);
  }

  async totals(userId: string): Promise<{ available: string; processing: string }> {
    const r = await jsonRow<{ a: string; p: string }>(this.db, sql`select coalesce(sum(amount_kobo) filter (where status = 'available'), 0)::text as a, coalesce(sum(amount_kobo) filter (where status = 'processing'), 0)::text as p from public.refund_credits where buyer_id = ${userId}`);
    return { available: r?.a ?? "0", processing: r?.p ?? "0" };
  }

  recentCredits(userId: string): Promise<Credit[]> {
    return jsonRows<Credit>(this.db, sql`select id, order_id, amount_kobo::text as amount_kobo, status, created_at from public.refund_credits where buyer_id = ${userId} order by created_at desc limit 30`);
  }

  recentWithdrawals(userId: string): Promise<RefundWithdrawal[]> {
    return jsonRows<RefundWithdrawal>(this.db, sql`select id, buyer_id, amount_kobo::text as amount_kobo, status, transfer_reference, last_error, created_at from public.refund_withdrawals where buyer_id = ${userId} order by created_at desc limit 20`);
  }

  async insertWithdrawal(userId: string, amountKobo: number, reference: string): Promise<string> {
    const [row] = await jsonReturning<{ id: string }>(this.db, sql`insert into public.refund_withdrawals (buyer_id, amount_kobo, transfer_reference) values (${userId}, ${amountKobo}, ${reference}) returning id`);
    return row!.id;
  }

  async attach(withdrawalId: string, creditIds: string[]): Promise<void> {
    if (!creditIds.length) return;
    await this.db.execute(sql`update public.refund_credits set status = 'processing', withdrawal_id = ${withdrawalId} where id in (${sql.join(creditIds.map((x) => sql`${x}::uuid`), sql`, `)})`);
  }

  byReference(reference: string): Promise<RefundWithdrawal | null> {
    return jsonRow<RefundWithdrawal>(this.db, sql`select id, buyer_id, amount_kobo::text as amount_kobo, status, transfer_reference, last_error, created_at from public.refund_withdrawals where transfer_reference = ${reference} for update`);
  }

  /** The transfer's outcome: success finishes it, failure puts the money back in the wallet. */
  async settle(id: string, status: "success" | "failed" | "reversed", detail: { code?: string | null; error?: string | null } = {}): Promise<void> {
    await this.db.execute(sql`update public.refund_withdrawals set status = ${status}, transfer_code = coalesce(${detail.code ?? null}, transfer_code), last_error = ${detail.error ?? null} where id = ${id}`);
    if (status === "success") await this.db.execute(sql`update public.refund_credits set status = 'sent' where withdrawal_id = ${id}`);
    else await this.db.execute(sql`update public.refund_credits set status = 'available', withdrawal_id = null where withdrawal_id = ${id}`);
  }
}
