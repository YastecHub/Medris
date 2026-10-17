import { sql } from "drizzle-orm";
import { boolean, pgSchema, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz, userRole } from "./types.js";

/**
 * Drizzle definitions describe only the columns the backend reads or writes.
 * The live tables have more; listing a column here that the database does not
 * have would break every query on the table, so add columns as code needs
 * them (regenerate a full definition with `npm run db:introspect`).
 */

/** public.users: the application profile, same id as auth.users. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull().default(""),
  email: text("email"),
  phone: text("phone"),
  role: userRole("role").notNull().default("buyer"),
  city: text("city"),
  avatarUrl: text("avatar_url"),
  roleSelected: boolean("role_selected").notNull().default(true),
  hasPassword: boolean("has_password").notNull().default(false),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  suspendedAt: timestamptz("suspended_at"),
  otpVerifiedAt: timestamptz("otp_verified_at").notNull().default(sql`now()`),
  createdAt: timestamptz("created_at").notNull().default(sql`now()`),
});

/** One-time admin login codes (no client access; verified by /api/auth-otp). */
export const adminLoginOtps = pgTable("admin_login_otps", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamptz("expires_at").notNull(),
  usedAt: timestamptz("used_at"),
  createdAt: timestamptz("created_at").notNull().default(sql`now()`),
});

/* ------------------------------------------------------------------ auth.* */

/**
 * Supabase Auth's tables. Read-only for the backend: used to verify existing
 * passwords (bcrypt hashes) and to link Google identities to existing accounts
 * when backend-managed sessions are enabled. Never written by this code.
 */
export const authSchema = pgSchema("auth");

export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email"),
  phone: text("phone"),
  encryptedPassword: text("encrypted_password"),
  emailConfirmedAt: timestamptz("email_confirmed_at"),
  bannedUntil: timestamptz("banned_until"),
  deletedAt: timestamptz("deleted_at"),
});

export const authIdentities = authSchema.table("identities", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  provider: text("provider").notNull(),
  providerId: text("provider_id").notNull(),
});
