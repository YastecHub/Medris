import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonRow, jsonRows } from "../json.js";
import { adminLoginOtps, appPresence, notifications, pushSubscriptions, voiceCalls } from "../schema/index.js";

/** What /api/notify and the reminder jobs read and write (run as service_role). */
export class NotifyRepository {
  constructor(private readonly db: Executor) {}

  /** A notification with every column (`select=*`). */
  notification(id: string): Promise<Record<string, unknown> | null> {
    return jsonRow(this.db, sql`select * from public.notifications where id = ${id}`);
  }

  async insertNotification(values: { userId: string; type: string; title: string; body: string; targetView: string; targetParams: Record<string, unknown> }): Promise<void> {
    await this.db.insert(notifications).values(values);
  }

  /** The daily clean-up: read notifications older than the cutoff. */
  async deleteReadBefore(cutoff: string): Promise<number> {
    const rows = await this.db
      .delete(notifications)
      .where(and(eq(notifications.read, true), lt(notifications.createdAt, cutoff)))
      .returning({ id: notifications.id });
    return rows.length;
  }

  async appOpenSince(userId: string, since: string): Promise<boolean> {
    const rows = await this.db.select({ id: appPresence.userId }).from(appPresence).where(and(eq(appPresence.userId, userId), gte(appPresence.seenAt, since))).limit(1);
    return rows.length > 0;
  }

  /** Every push subscription of the user (all columns). */
  pushSubscriptions(userId: string): Promise<{ id: string; endpoint: string; p256dh: string; auth_key: string; created_at?: string }[]> {
    return jsonRows(this.db, sql`select * from public.push_subscriptions where user_id = ${userId}`);
  }

  async deletePushSubscription(id: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  async call(id: string): Promise<{ id: string; callee_id: string; status: string; created_at: string } | null> {
    const [row] = await this.db
      .select({ id: voiceCalls.id, callee_id: voiceCalls.calleeId, status: voiceCalls.status, created_at: voiceCalls.createdAt })
      .from(voiceCalls)
      .where(eq(voiceCalls.id, id))
      .limit(1);
    return row ?? null;
  }

  async declineIfRinging(id: string, at: string): Promise<void> {
    await this.db.update(voiceCalls).set({ status: "declined", endedAt: at }).where(and(eq(voiceCalls.id, id), eq(voiceCalls.status, "ringing")));
  }
}

/** Admin login one-time codes. */
export class AdminOtpRepository {
  constructor(private readonly db: Executor) {}

  async create(userId: string, code: string, expiresAt: string): Promise<void> {
    await this.db.insert(adminLoginOtps).values({ userId, code, expiresAt });
  }

  latestUnused(userId: string): Promise<{ id: string; code: string; expires_at: string } | null> {
    return jsonRow(this.db, sql`
      select id, code, expires_at from public.admin_login_otps
      where user_id = ${userId} and used_at is null order by created_at desc limit 1`);
  }

  async markUsed(id: string, at: string): Promise<void> {
    await this.db.update(adminLoginOtps).set({ usedAt: at }).where(eq(adminLoginOtps.id, id));
  }
}
