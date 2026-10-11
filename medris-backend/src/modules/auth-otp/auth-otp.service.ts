import crypto from "node:crypto";
import { getDataContext } from "../../database/index.js";
import { AdminOtpRepository } from "../../database/repositories/messaging.repository.js";
import { UsersRepository } from "../../database/repositories/users.repository.js";
import { sendNotificationEmail } from "../../integrations/email.js";
import { SupabaseAuthAdmin } from "../../integrations/supabase-auth.js";
import { identityFromAccessToken } from "../auth/caller.js";
import type { ServiceResult } from "../../shared/types/service.js";

/**
 * Admin login one-time codes and password setting (ported from api/auth-otp.js).
 *
 * Email OTP is restricted to admin accounts and re-required every 7 days
 * (users.otp_verified_at). Buyers and vendors never need it.
 */

const OTP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;

/** POST /api/auth-otp: `action` "verify" | "set-password"; anything else sends a code. */
export function handleAuthOtp(body: Record<string, unknown>): Promise<ServiceResult> {
  if (body.action === "verify") return verifyOtp(body);
  if (body.action === "set-password") return setPassword(body);
  return sendOtp(body);
}

export async function sendOtp(body: Record<string, unknown>): Promise<ServiceResult> {
  const accessToken = body.accessToken as string | undefined;
  if (!accessToken) return { status: 400, body: { error: "accessToken is required" } };

  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };
  const data = getDataContext();

  const u = await data.asService((tx) => new UsersRepository(tx).otpProfile(me.userId));
  if (!u) return { status: 200, body: { ok: true, otpRequired: false } };
  if (u.role !== "admin") return { status: 200, body: { ok: true, otpRequired: false } };

  const lastVerified = u.otp_verified_at ? new Date(u.otp_verified_at).getTime() : 0;
  if (Date.now() - lastVerified < OTP_INTERVAL_MS) return { status: 200, body: { ok: true, otpRequired: false } };

  const code = String(crypto.randomInt(100000, 1000000));
  await data.asService((tx) => new AdminOtpRepository(tx).create(me.userId, code, new Date(Date.now() + OTP_TTL_MS).toISOString()));

  const resendKey = process.env.RESEND_API_KEY || "";
  if (resendKey) {
    await sendNotificationEmail(resendKey, {
      to: u.email ?? undefined,
      name: u.name,
      title: "Your Levromart admin login code",
      body: `Your one-time code is ${code}. It expires in 10 minutes. If this wasn't you, change your password immediately.`,
    });
  }
  return { status: 200, body: { ok: true, otpRequired: true } };
}

export async function verifyOtp(body: Record<string, unknown>): Promise<ServiceResult> {
  const accessToken = body.accessToken as string | undefined;
  const code = body.code;
  if (!accessToken || !code) return { status: 400, body: { error: "accessToken and code are required" } };

  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };
  const data = getDataContext();

  const role = await data.asService((tx) => new UsersRepository(tx).roleOf(me.userId));
  if (role !== "admin") return { status: 403, body: { error: "OTP verification is only available to admin accounts." } };

  const otp = await data.asService((tx) => new AdminOtpRepository(tx).latestUnused(me.userId));
  if (!otp || otp.code !== String(code).trim() || new Date(otp.expires_at) < new Date()) {
    return { status: 200, body: { ok: false, error: "That code is incorrect or has expired." } };
  }

  const now = new Date().toISOString();
  await data.asService(async (tx) => {
    await new AdminOtpRepository(tx).markUsed(otp.id, now);
    await new UsersRepository(tx).markOtpVerified(me.userId, now);
  });
  return { status: 200, body: { ok: true } };
}

/**
 * Sets a password through the Auth admin API. OAuth-only accounts can hit a
 * Supabase "new password must differ" misfire with the client-side call; the
 * admin API sets the password directly.
 */
export async function setPassword(body: Record<string, unknown>): Promise<ServiceResult> {
  const accessToken = body.accessToken as string | undefined;
  const password = body.password;
  if (!accessToken || !password) return { status: 400, body: { error: "accessToken and password are required" } };
  if (String(password).length < 8) return { status: 400, body: { error: "Password must be at least 8 characters." } };

  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const result = await SupabaseAuthAdmin.fromEnv().setPassword(me.userId, String(password));
  if (!result.ok) return { status: 400, body: { error: result.message || "Could not set password." } };
  await getDataContext().asService((tx) => new UsersRepository(tx).markHasPassword(me.userId));
  return { status: 200, body: { ok: true } };
}
