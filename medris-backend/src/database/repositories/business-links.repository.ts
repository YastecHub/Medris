import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonReturning, jsonRow, jsonRows } from "../json.js";

export interface BusinessLink {
  owner_id: string;
  business_user_id: string;
  label: string | null;
}

/**
 * One person, several businesses (migration 0064): each extra business is its own Levromart account linked to its owner
 * in business_links. Used by the account endpoint's business actions (run as service_role after the service has
 * checked who is asking).
 */
export class BusinessLinksRepository {
  constructor(private readonly db: Executor) {}

  /** Links where the person is the owner or the business. */
  linksOf(userId: string): Promise<BusinessLink[]> {
    return jsonRows(this.db, sql`select owner_id, business_user_id, label from public.business_links where owner_id = ${userId} or business_user_id = ${userId}`);
  }

  /** The new business's profile and its link to the owner (one transaction with the caller's). */
  async createBusiness(input: { businessUserId: string; ownerId: string; name: string; city: string }): Promise<void> {
    await this.db.execute(sql`insert into public.users (id, name, email, phone, city, role, role_selected, has_password)
                              values (${input.businessUserId}, ${input.name}, null, null, ${input.city}, 'buyer', true, true) on conflict (id) do nothing`);
    await this.db.execute(sql`insert into public.business_links (business_user_id, owner_id, label) values (${input.businessUserId}, ${input.ownerId}, ${input.name})`);
  }

  /** A business account may use its owner's phone number (migration 0066). */
  async markBusinessAccount(userId: string): Promise<void> {
    await this.db.execute(sql`update public.users set is_business_account = true where id = ${userId}`);
  }

  profiles(ids: string[]): Promise<{ id: string; name: string | null; avatar_url: string | null; phone: string | null }[]> {
    if (!ids.length) return Promise.resolve([]);
    return jsonRows(this.db, sql`select id, name, avatar_url, phone from public.users where id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  }

  shops(ids: string[]): Promise<{ user_id: string; business_name: string | null; logo_url: string | null; verification_status: string; whatsapp_number: string | null; city: string | null; cac_number: string | null; is_active: boolean }[]> {
    if (!ids.length) return Promise.resolve([]);
    return jsonRows(
      this.db,
      sql`select user_id, business_name, logo_url, verification_status, whatsapp_number, city, cac_number, is_active from public.vendors
          where user_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) and deleted_at is null`,
    );
  }

  /** Unread notifications per account (a badge in the account switcher). */
  unread(ids: string[]): Promise<{ user_id: string; n: number }[]> {
    if (!ids.length) return Promise.resolve([]);
    return jsonRows(
      this.db,
      sql`select user_id, least(count(*), 1000)::int as n from public.notifications
          where user_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) and read = false and deleted_at is null group by user_id`,
    );
  }

  /** Pauses or resumes a business's shop; how many shops changed. */
  async setShopActive(userId: string, active: boolean): Promise<number> {
    return (await jsonReturning(this.db, sql`update public.vendors set is_active = ${active} where user_id = ${userId} and deleted_at is null returning id`)).length;
  }

  async unlink(businessUserId: string): Promise<void> {
    await this.db.execute(sql`delete from public.business_links where business_user_id = ${businessUserId}`);
  }

  /** Money in the person's wallet (kobo) and whether a withdrawal is still on its way to the bank. */
  wallet(userId: string): Promise<{ kobo: number; pending: boolean } | null> {
    return jsonRow(
      this.db,
      sql`select coalesce((select balance_kobo from public.wallet_accounts where user_id = ${userId}), 0)::bigint as kobo,
                 exists (select 1 from public.wallet_withdrawals where user_id = ${userId} and status in ('requested', 'processing')) as pending`,
    );
  }
}
