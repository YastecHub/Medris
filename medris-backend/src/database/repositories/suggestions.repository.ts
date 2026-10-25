import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonReturning, jsonRow, jsonRows } from "../json.js";
import type { Suggestion } from "../../modules/suggestions/suggestions.schemas.js";

/** The suggestion box (suggestions): to a shop or to Levromart. */
export class SuggestionsRepository {
  constructor(private readonly db: Executor) {}

  async create(senderId: string | null, targetType: string, targetVendorId: string | null, message: string, anonymous: boolean): Promise<string> {
    const [row] = await jsonReturning<{ id: string }>(
      this.db,
      sql`insert into public.suggestions (sender_id, target_type, target_vendor_id, message, is_anonymous)
          values (${senderId}::uuid, ${targetType}, ${targetVendorId}::uuid, trim(${message}), ${anonymous}) returning id`,
    );
    return row!.id;
  }

  /** Suggestions for one target, newest first; the sender's name is hidden when anonymous. */
  list(target: { vendorId: string } | "platform"): Promise<Suggestion[]> {
    const where = target === "platform" ? sql`s.target_type = 'platform'` : sql`s.target_type = 'vendor' and s.target_vendor_id = ${target.vendorId}`;
    return jsonRows<Suggestion>(
      this.db,
      sql`select s.id, case when s.is_anonymous then null else u.name end as sender_name, s.is_anonymous, s.message, s.status, s.created_at, s.reply_message, s.replied_at
          from public.suggestions s left join public.users u on u.id = s.sender_id
          where ${where}
          order by s.created_at desc`,
    );
  }

  find(id: string): Promise<{ id: string; target_type: string; target_vendor_id: string | null; sender_id: string | null; message: string; reply_message: string | null } | null> {
    return jsonRow(this.db, sql`select id, target_type, target_vendor_id, sender_id, message, reply_message from public.suggestions where id = ${id} for update`);
  }

  async markRead(id: string): Promise<void> {
    await this.db.execute(sql`update public.suggestions set status = 'read' where id = ${id}`);
  }

  async setReply(id: string, message: string, byUserId: string): Promise<void> {
    await this.db.execute(sql`update public.suggestions set reply_message = ${message}, replied_at = now(), replied_by = ${byUserId}::uuid, status = 'read' where id = ${id}`);
  }

  /** The shop's name for a suggestion's notification. */
  async shopName(vendorId: string): Promise<string | null> {
    const row = await jsonRow<{ business_name: string | null }>(this.db, sql`select business_name from public.vendors where id = ${vendorId}`);
    return row?.business_name ?? null;
  }
}
