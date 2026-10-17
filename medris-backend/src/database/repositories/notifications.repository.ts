import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { NotificationRowV1 } from "../../contracts/v1.js";
import type { Executor } from "../client.js";
import { rowsOf } from "../client.js";
import { notifications } from "../schema/index.js";

export interface RecentUnreadNotification {
  id: string;
  type: string;
  created_at: string;
  target_params: unknown;
}

/** In-app notifications of one user (creation happens in database triggers). */
export class NotificationsRepository {
  constructor(private readonly db: Executor) {}

  /**
   * The notification panel: every unread notification plus read ones newer
   * than `readSince`, newest first, all columns (as `select("*")` returned).
   */
  async listForPanel(userId: string, readSince: string, limit: number): Promise<NotificationRowV1[]> {
    const result = await this.db.execute(sql`
      select coalesce(json_agg(to_json(n) order by n.created_at desc), '[]'::json) as rows
      from (
        select * from public.notifications
        where user_id = ${userId} and deleted_at is null and (read = false or created_at >= ${readSince}::timestamptz)
        order by created_at desc
        limit ${limit}
      ) n`);
    return rowsOf<{ rows: NotificationRowV1[] }>(result)[0]?.rows ?? [];
  }

  /** Latest unread notifications (id, type, created_at, target_params) for the sound/vibration catch-up. */
  async recentUnread(userId: string, limit: number): Promise<RecentUnreadNotification[]> {
    const result = await this.db.execute(sql`
      select coalesce(json_agg(json_build_object('id', n.id, 'type', n.type, 'created_at', n.created_at, 'target_params', n.target_params) order by n.created_at desc), '[]'::json) as rows
      from (
        select id, type, created_at, target_params from public.notifications
        where user_id = ${userId} and read = false
        order by created_at desc limit ${limit}
      ) n`);
    return rowsOf<{ rows: RecentUnreadNotification[] }>(result)[0]?.rows ?? [];
  }

  /** The badge: unread, not archived, not deleted. Optionally one type, newer than a moment. */
  async unreadCount(userId: string, filter: { type?: string; after?: string } = {}): Promise<number> {
    const conditions = [
      eq(notifications.userId, userId),
      eq(notifications.archived, false),
      eq(notifications.read, false),
      isNull(notifications.deletedAt),
    ];
    if (filter.type) conditions.push(eq(notifications.type, filter.type));
    if (filter.after) conditions.push(gt(notifications.createdAt, filter.after));
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(...conditions));
    return Number(row?.n ?? 0);
  }

  async setRead(userId: string, ids: string[], read: boolean): Promise<number> {
    if (!ids.length) return 0;
    const rows = await this.db
      .update(notifications)
      .set({ read })
      .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)))
      .returning({ id: notifications.id });
    return rows.length;
  }

  async markAllRead(userId: string): Promise<number> {
    const rows = await this.db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false), isNull(notifications.deletedAt)))
      .returning({ id: notifications.id });
    return rows.length;
  }
}
