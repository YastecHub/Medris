import crypto from "node:crypto";
import type { AppConfig } from "../../config/app-config.js";
import type { DataContext, Identity } from "../../database/context.js";
import { SessionsRepository } from "../../database/repositories/sessions.repository.js";
import { featureDisabled } from "../../shared/errors/app-error.js";

/**
 * Backend-managed browser sessions (AUTH_BACKEND_SESSIONS=true).
 *
 * - The browser holds a random 256-bit token in an HttpOnly cookie; the
 *   database stores only its SHA-256 hash, so a database leak does not leak
 *   usable sessions.
 * - Absolute lifetime AUTH_SESSION_TTL_DAYS, idle timeout
 *   AUTH_SESSION_IDLE_DAYS; activity extends the idle window (at most one
 *   write per hour per session).
 * - Logout revokes the row; "log out everywhere" revokes every row of the user.
 * - The user id is the existing auth.users / public.users id, so every RLS
 *   policy and database function keeps working unchanged (DataContext.asUser).
 *
 * Off by default: the table comes from migration 0002, which has not been
 * applied to production. With the flag off, resolve() is never called and
 * create() refuses.
 */

export type AuthMethodName = "password" | "google";

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

export interface CreatedSession {
  token: string;
  sessionId: string;
  expiresAt: string;
}

export interface SessionService {
  readonly enabled: boolean;
  create(userId: string, method: AuthMethodName, meta?: SessionMeta): Promise<CreatedSession>;
  resolve(token: string): Promise<Identity | null>;
  revoke(token: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<number>;
}

const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashIp(ip: string | null | undefined): string | null {
  return ip ? crypto.createHash("sha256").update(`medris-ip:${ip}`).digest("hex").slice(0, 32) : null;
}

export function createSessionService(config: AppConfig, data: () => DataContext, now: () => Date = () => new Date()): SessionService {
  const enabled = config.auth.backendSessions;
  const ttlMs = config.auth.sessionTtlDays * 86_400_000;
  const idleMs = config.auth.sessionIdleDays * 86_400_000;

  return {
    enabled,

    async create(userId, method, meta = {}) {
      if (!enabled) throw featureDisabled("Backend sessions");
      const token = crypto.randomBytes(32).toString("base64url");
      const created = now();
      const expiresAt = new Date(created.getTime() + ttlMs).toISOString();
      const sessionId = await data().asService((tx) =>
        new SessionsRepository(tx).insert({
          userId,
          tokenHash: hashToken(token),
          authMethod: method,
          createdAt: created.toISOString(),
          expiresAt,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
          ipHash: hashIp(meta.ip),
        }),
      );
      return { token, sessionId, expiresAt };
    },

    async resolve(token) {
      if (!enabled || !token || token.length > 200) return null;
      const current = now();
      return data().asService(async (tx) => {
        const repo = new SessionsRepository(tx);
        const row = await repo.findByTokenHash(hashToken(token));
        if (!row || row.revokedAt) return null;
        if (new Date(row.expiresAt).getTime() <= current.getTime()) return null;
        if (current.getTime() - new Date(row.lastSeenAt).getTime() > idleMs) return null;
        if (current.getTime() - new Date(row.lastSeenAt).getTime() > TOUCH_INTERVAL_MS) {
          await repo.touch(row.id, current.toISOString());
        }
        return {
          userId: row.userId,
          email: row.email,
          claims: {
            sub: row.userId,
            role: "authenticated",
            aud: "authenticated",
            email: row.email ?? undefined,
            session_id: row.id,
            amr: [{ method: row.authMethod }],
          },
          source: "backend-session" as const,
          sessionId: row.id,
        };
      });
    },

    async revoke(token) {
      if (!enabled || !token) return;
      await data().asService((tx) => new SessionsRepository(tx).revokeByTokenHash(hashToken(token), now().toISOString()));
    },

    async revokeAllForUser(userId) {
      if (!enabled) return 0;
      return data().asService((tx) => new SessionsRepository(tx).revokeAllForUser(userId, now().toISOString()));
    },
  };
}

/** Housekeeping for the daily cron: drop sessions that ended more than 30 days ago. */
export async function purgeEndedSessions(data: DataContext, at: Date = new Date()): Promise<number> {
  const cutoff = new Date(at.getTime() - 30 * 86_400_000).toISOString();
  return data.asService((tx) => new SessionsRepository(tx).deleteEndedBefore(cutoff));
}
