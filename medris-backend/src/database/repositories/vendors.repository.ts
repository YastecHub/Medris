import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonRow } from "../json.js";
import { commissionCharges, conversations, vendors } from "../schema/index.js";

/** Vendor rows for the original endpoints. */
export class VendorsRepository {
  constructor(private readonly db: Executor) {}

  async idsOwnedBy(userId: string): Promise<string[]> {
    const rows = await this.db.select({ id: vendors.id }).from(vendors).where(eq(vendors.userId, userId));
    return rows.map((r) => r.id);
  }

  async ownerOf(vendorId: string): Promise<string | null> {
    const [row] = await this.db.select({ userId: vendors.userId }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
    return row?.userId ?? null;
  }

  /** The caller's first vendor row (run as the user: RLS applies). */
  async firstOwnedBy(userId: string): Promise<{ id: string; business_name: string; commission_pct: number | null; billing_model: string } | null> {
    return jsonRow(this.db, sql`
      select id, business_name, commission_pct, billing_model from public.vendors where user_id = ${userId} limit 1`);
  }

  /** Logo, name and owner for a notification picture. */
  async brand(vendorId: string): Promise<{ logo_url: string | null; business_name: string; user_id: string } | null> {
    const [row] = await this.db
      .select({ logo_url: vendors.logoUrl, business_name: vendors.businessName, user_id: vendors.userId })
      .from(vendors)
      .where(eq(vendors.id, vendorId))
      .limit(1);
    return row ?? null;
  }

  async update(vendorId: string, values: Partial<typeof vendors.$inferInsert>): Promise<void> {
    await this.db.update(vendors).set(values).where(eq(vendors.id, vendorId));
  }

  async owedCommission(vendorIds: string[]): Promise<number> {
    if (!vendorIds.length) return 0;
    const rows = await this.db
      .select({ amount: commissionCharges.amount })
      .from(commissionCharges)
      .where(and(inArray(commissionCharges.vendorId, vendorIds), eq(commissionCharges.status, "owed")));
    return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  }

  /** Conversations the user takes part in, as buyer or through one of their shops. */
  async conversationIds(userId: string, vendorIds: string[]): Promise<string[]> {
    const condition = vendorIds.length
      ? sql`${conversations.buyerId} = ${userId} or ${inArray(conversations.vendorId, vendorIds)}`
      : eq(conversations.buyerId, userId);
    const rows = await this.db.select({ id: conversations.id }).from(conversations).where(condition);
    return rows.map((r) => r.id);
  }

  async activeNotDeletedOwnedBy(userId: string): Promise<{ id: string }[]> {
    return this.db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.userId, userId), isNull(vendors.deletedAt)));
  }
}
