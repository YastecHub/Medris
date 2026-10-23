import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonRow, jsonRows } from "../json.js";
import type { OpenAttempt } from "./paystack-ledger.repository.js";

/** The ledger side of Levromart's own fees: the ₦999 listing fee and commission (issue #100). Service role only. */
export class VendorFeesRepository {
  constructor(private readonly db: Executor) {}

  /** Taken first, so two taps of "Pay" for the same thing are handled one after the other. */
  async lock(key: string): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"vendor_fee:" + key}, 0))`);
  }

  /** The open attempts for one listing fee (`listingId`) or for a vendor's commission. */
  openAttempts(purpose: "listing_fee" | "commission", vendorId: string, listingId: string | null): Promise<OpenAttempt[]> {
    return jsonRows<OpenAttempt>(
      this.db,
      sql`select id, reference, purpose, order_id, vendor_id, amount_kobo::text as amount_kobo, currency, status, created_at,
                 extract(epoch from (now() - created_at))::int as age_seconds, raw_last_event -> 'initialize' as authorization
          from public.paystack_transactions
          where purpose = ${purpose} and status = 'initialized' and vendor_id = ${vendorId}
            and (${listingId}::uuid is null or listing_id = ${listingId}::uuid)
          for update`,
    );
  }

  async insertAttempt(a: { reference: string; purpose: "listing_fee" | "commission"; vendorId: string; payerUserId: string; amountKobo: number; listingId?: string; listingKind?: "product" | "package" }): Promise<void> {
    await this.db.execute(sql`
      insert into public.paystack_transactions (reference, purpose, vendor_id, listing_id, listing_kind, payer_user_id, amount_kobo)
      values (${a.reference}, ${a.purpose}, ${a.vendorId}, ${a.listingId ?? null}, ${a.listingKind ?? null}, ${a.payerUserId}, ${a.amountKobo})`);
  }

  ownShop(userId: string): Promise<{ id: string; business_name: string | null } | null> {
    return jsonRow(this.db, sql`select id, business_name from public.vendors where user_id = ${userId} and deleted_at is null limit 1`);
  }

  email(userId: string): Promise<{ email: string | null } | null> {
    return jsonRow(this.db, sql`select email from public.users where id = ${userId}`);
  }
}
