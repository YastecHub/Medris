import { and, count, eq } from "drizzle-orm";
import type { Executor } from "../client.js";
import { callFunction } from "../rpc.js";
import { vendorFollows } from "../schema/index.js";

/** Shops a user follows (vendor_follows). Follow/unfollow rules live in toggle_vendor_follow(). */
export class FollowsRepository {
  constructor(private readonly db: Executor) {}

  /** Followed vendor ids (the app caps the list at 2000). */
  async vendorIds(followerId: string, limit = 2000): Promise<string[]> {
    const rows = await this.db.select({ id: vendorFollows.vendorId }).from(vendorFollows).where(eq(vendorFollows.followerId, followerId)).limit(limit);
    return rows.map((r) => r.id);
  }

  async count(followerId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(vendorFollows).where(eq(vendorFollows.followerId, followerId));
    return Number(row?.n ?? 0);
  }

  async isFollowing(followerId: string, vendorId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: vendorFollows.id })
      .from(vendorFollows)
      .where(and(eq(vendorFollows.followerId, followerId), eq(vendorFollows.vendorId, vendorId)))
      .limit(1);
    return rows.length > 0;
  }

  /** toggle_vendor_follow(p_vendor_id, p_following): follows or unfollows and sends the follow notifications. */
  setFollowing(vendorId: string, following: boolean): Promise<unknown> {
    return callFunction(this.db, "toggle_vendor_follow", { p_vendor_id: vendorId, p_following: following });
  }

  async unfollow(followerId: string, vendorId: string): Promise<number> {
    const rows = await this.db
      .delete(vendorFollows)
      .where(and(eq(vendorFollows.followerId, followerId), eq(vendorFollows.vendorId, vendorId)))
      .returning({ id: vendorFollows.id });
    return rows.length;
  }
}
