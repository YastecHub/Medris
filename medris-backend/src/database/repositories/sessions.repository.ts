import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Executor } from "../client.js";
import { backendSessions, users } from "../schema/index.js";

export interface StoredSession {
  id: string;
  userId: string;
  authMethod: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  email: string | null;
}

/**
 * public.backend_sessions (migration 0002). Rows are looked up by the SHA-256
 * of the session token; the token itself is never stored. Service role only
 * (RLS on, no policies).
 */
export class SessionsRepository {
  constructor(private readonly db: Executor) {}

  async insert(values: {
    userId: string;
    tokenHash: string;
    authMethod: string;
    createdAt: string;
    expiresAt: string;
    userAgent: string | null;
    ipHash: string | null;
  }): Promise<string> {
    const [row] = await this.db
      .insert(backendSessions)
      .values({ ...values, lastSeenAt: values.createdAt })
      .returning({ id: backendSessions.id });
    return row!.id;
  }

  /** The session with this token hash and the account's e-mail. */
  async findByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    const [row] = await this.db
      .select({
        id: backendSessions.id,
        userId: backendSessions.userId,
        authMethod: backendSessions.authMethod,
        lastSeenAt: backendSessions.lastSeenAt,
        expiresAt: backendSessions.expiresAt,
        revokedAt: backendSessions.revokedAt,
        email: users.email,
      })
      .from(backendSessions)
      .leftJoin(users, eq(users.id, backendSessions.userId))
      .where(eq(backendSessions.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async touch(id: string, at: string): Promise<void> {
    await this.db.update(backendSessions).set({ lastSeenAt: at }).where(eq(backendSessions.id, id));
  }

  async revokeByTokenHash(tokenHash: string, at: string): Promise<void> {
    await this.db
      .update(backendSessions)
      .set({ revokedAt: at })
      .where(and(eq(backendSessions.tokenHash, tokenHash), isNull(backendSessions.revokedAt)));
  }

  async revokeAllForUser(userId: string, at: string): Promise<number> {
    const rows = await this.db
      .update(backendSessions)
      .set({ revokedAt: at })
      .where(and(eq(backendSessions.userId, userId), isNull(backendSessions.revokedAt)))
      .returning({ id: backendSessions.id });
    return rows.length;
  }

  /** Deletes sessions that expired or were revoked before `cutoff`. */
  async deleteEndedBefore(cutoff: string): Promise<number> {
    const rows = await this.db
      .delete(backendSessions)
      .where(or(lt(backendSessions.expiresAt, cutoff), lt(backendSessions.revokedAt, cutoff)))
      .returning({ id: backendSessions.id });
    return rows.length;
  }
}
