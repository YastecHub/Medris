import type { MeResponse } from "../../contracts/v1.js";
import type { DataContext, Identity } from "../../database/context.js";
import { UsersRepository } from "../../database/repositories/users.repository.js";
import { notFound } from "../../shared/errors/app-error.js";

/** Account profiles (public.users). */
export class UsersService {
  constructor(private readonly db: () => DataContext) {}

  async me(me: Identity): Promise<MeResponse> {
    const profile = await this.db().asUser(me, (tx) => new UsersRepository(tx).findById(me.userId));
    if (!profile) throw notFound("Account profile not found.");
    return profile;
  }

  /** The caller's role, read as the caller (null when signed out or without a profile). */
  async roleOf(identity: Identity | null): Promise<string | null> {
    if (!identity) return null;
    return this.db().asUser(identity, (tx) => new UsersRepository(tx).roleOf(identity.userId));
  }
}
