import type { FollowsResponse } from "../../contracts/v1.js";
import type { DataContext, Identity } from "../../database/context.js";
import { FollowsRepository } from "../../database/repositories/follows.repository.js";

/** Shops a user follows. Runs as the user; toggle_vendor_follow() enforces the follow rules. */
export class FollowsService {
  constructor(private readonly db: () => DataContext) {}

  list(me: Identity): Promise<FollowsResponse> {
    return this.db().asUser(me, async (tx) => {
      const repo = new FollowsRepository(tx);
      const vendorIds = await repo.vendorIds(me.userId);
      return { vendorIds, count: await repo.count(me.userId) };
    });
  }

  async isFollowing(me: Identity, vendorId: string): Promise<{ following: boolean }> {
    const following = await this.db().asUser(me, (tx) => new FollowsRepository(tx).isFollowing(me.userId, vendorId));
    return { following };
  }

  async setFollowing(me: Identity, vendorId: string, following: boolean): Promise<{ following: boolean; result: unknown }> {
    const result = await this.db().asUser(me, (tx) => new FollowsRepository(tx).setFollowing(vendorId, following));
    return { following, result };
  }

  async unfollow(me: Identity, vendorId: string): Promise<{ following: false; removed: number }> {
    const removed = await this.db().asUser(me, (tx) => new FollowsRepository(tx).unfollow(me.userId, vendorId));
    return { following: false, removed };
  }
}
