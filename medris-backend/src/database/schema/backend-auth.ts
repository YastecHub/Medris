import { sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./types.js";

/**
 * Backend-managed browser sessions (created by migration
 * 0002_backend_auth_sessions.sql, which has NOT been applied to production).
 * Only the SHA-256 hash of the session token is stored.
 */
export const backendSessions = pgTable("backend_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  authMethod: text("auth_method").notNull(),
  createdAt: timestamptz("created_at").notNull().default(sql`now()`),
  lastSeenAt: timestamptz("last_seen_at").notNull().default(sql`now()`),
  expiresAt: timestamptz("expires_at").notNull(),
  revokedAt: timestamptz("revoked_at"),
  userAgent: text("user_agent"),
  ipHash: text("ip_hash"),
});
