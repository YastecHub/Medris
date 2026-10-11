import type { NotificationRowV1 } from "../../contracts/v1.js";
import type { DataContext, Identity } from "../../database/context.js";
import { NotificationsRepository, type RecentUnreadNotification } from "../../database/repositories/notifications.repository.js";

const THIRTY_DAYS_MS = 30 * 86_400_000;

export type MarkReadInput = { all: true } | { ids: string[]; read: boolean };

/** Reading and marking the signed-in user's notifications (runs as the user). */
export class NotificationsService {
  constructor(
    private readonly db: () => DataContext,
    private readonly now: () => number = Date.now,
  ) {}

  /** Unread ones plus read ones from the last 30 days unless `readSince` says otherwise. */
  panel(me: Identity, options: { readSince?: string; limit: number }): Promise<NotificationRowV1[]> {
    const since = options.readSince ?? new Date(this.now() - THIRTY_DAYS_MS).toISOString();
    return this.db().asUser(me, (tx) => new NotificationsRepository(tx).listForPanel(me.userId, since, options.limit));
  }

  async unreadCount(me: Identity, filter: { type?: string; after?: string }): Promise<{ count: number }> {
    const count = await this.db().asUser(me, (tx) => new NotificationsRepository(tx).unreadCount(me.userId, filter));
    return { count };
  }

  recentUnread(me: Identity, limit: number): Promise<RecentUnreadNotification[]> {
    return this.db().asUser(me, (tx) => new NotificationsRepository(tx).recentUnread(me.userId, limit));
  }

  async markRead(me: Identity, input: MarkReadInput): Promise<{ updated: number }> {
    const updated = await this.db().asUser(me, (tx) => {
      const repo = new NotificationsRepository(tx);
      return "all" in input ? repo.markAllRead(me.userId) : repo.setRead(me.userId, input.ids, input.read);
    });
    return { updated };
  }
}
