import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { SetupStatusRepository } from "../../database/repositories/setup-status.repository.js";
import { forbidden } from "../../shared/errors/app-error.js";

/** For admins: which database changes the live database still needs (so a missing one is seen at once, not guessed at). */
export class SetupStatusService {
  constructor(private readonly db: () => DataContext) {}

  async status(me: Identity | null) {
    if (!me) throw forbidden("Admin access required.");
    return this.db().asService(async (tx) => {
      if (!(await new AccessRepository(tx).isAdmin(me.userId))) throw forbidden("Admin access required.");
      return { missing: await new SetupStatusRepository(tx).missing() };
    });
  }
}
