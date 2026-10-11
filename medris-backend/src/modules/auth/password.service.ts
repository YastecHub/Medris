import bcrypt from "bcryptjs";
import type { DataContext } from "../../database/context.js";
import { AuthAccountsRepository } from "../../database/repositories/users.repository.js";
import { phoneAlias } from "../../lib/format.js";

/**
 * Password sign-in against the accounts that already exist.
 *
 * Supabase Auth stores bcrypt hashes in auth.users.encrypted_password (bcrypt
 * is a standard, portable format). Checking them here means existing users keep
 * their passwords when sign-in moves to the backend - no reset, no re-hashing,
 * no data copied. Phone-only accounts sign in with their phone number, which
 * maps to the same private login e-mail /api/register gave them.
 *
 * Supabase Auth remains the place passwords are set or changed (sign-up,
 * "forgot password", admin-approved manual reset) until those flows move too.
 */

// A real bcrypt hash, compared against when the account does not exist so the
// response time does not reveal whether an e-mail address is registered.
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8DPrDGo2Rn8sUdl2YUSwDu7fhyl2bC";

export type PasswordCheck = { ok: true; userId: string } | { ok: false; reason: "invalid" | "banned" | "unconfirmed" };

export function loginEmailFor(identifier: string): string {
  const value = identifier.trim();
  return value.includes("@") ? value.toLowerCase() : phoneAlias(value);
}

export async function checkPassword(data: DataContext, identifier: string, password: string, now: Date = new Date()): Promise<PasswordCheck> {
  const email = loginEmailFor(identifier);
  const account = email ? await data.asAuthReader((tx) => new AuthAccountsRepository(tx).findByEmail(email)) : null;
  const hash = account?.encryptedPassword && account.encryptedPassword.startsWith("$2") ? account.encryptedPassword : null;
  const matches = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  if (!account || !hash || !matches) return { ok: false, reason: "invalid" };
  if (account.bannedUntil && new Date(account.bannedUntil).getTime() > now.getTime()) return { ok: false, reason: "banned" };
  if (!account.emailConfirmedAt) return { ok: false, reason: "unconfirmed" };
  return { ok: true, userId: account.id };
}
