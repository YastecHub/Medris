import crypto from "node:crypto";
import { SupabaseAdmin, lookupUser } from "../../integrations/supabase.js";
import { sendNotificationEmail } from "../../integrations/email.js";
import type { ServiceResult } from "../../types/service.js";

/**
 * Admin login one-time codes and password setting (ported from api/auth-otp.js).
 *
 * Email OTP is restricted to admin accounts and re-required every 7 days
 * (users.otp_verified_at). Buyers and vendors never need it.
 */

const OTP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;

export async function sendOtp(body: Record<string, unknown>): Promise<ServiceResult> {
  const accessToken = body.accessToken as string | undefined;
  if (!accessToken) return { status: 400, body: { error: "accessToken is required" } };

  const db = SupabaseAdmin.fromEnv();
  const { user: me } = await lookupUser(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const u = await db.first<{ name?: string; email?: string; role?: string; otp_verified_at?: string | null }>(
    `users?id=eq.${me.id}&select=name,email,role,otp_verified_at`,
  );
  if (!u) return { status: 200, body: { ok: true, otpRequired: false } };
  if (u.role !== "admin") return { status: 200, body: { ok: true, otpRequired: false } };

  const lastVerified = u.otp_verified_at ? new Date(u.otp_verified_at).getTime() : 0;
  if (Date.now() - lastVerified < OTP_INTERVAL_MS) return { status: 200, body: { ok: true, otpRequired: false } };

  const code = String(crypto.randomInt(100000, 1000000));
  await db.insert("admin_login_otps", { user_id: me.id, code, expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString() });

  const resendKey = process.env.RESEND_API_KEY || "";
  if (resendKey) {
    await sendNotificationEmail(resendKey, {
      to: u.email,
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

  const db = SupabaseAdmin.fromEnv();
  const { user: me } = await lookupUser(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const userRes = await db.rest(`users?id=eq.${me.id}&select=role`);
  const [userRow] = userRes.ok ? ((await userRes.json()) as { role?: string }[]) : [];
  if (!userRow || userRow.role !== "admin") {
    return { status: 403, body: { error: "OTP verification is only available to admin accounts." } };
  }

  const otp = await db.first<{ id: string; code: string; expires_at: string }>(
    `admin_login_otps?user_id=eq.${me.id}&used_at=is.null&order=created_at.desc&limit=1&select=id,code,expires_at`,
  );
  if (!otp || otp.code !== String(code).trim() || new Date(otp.expires_at) < new Date()) {
    return { status: 200, body: { ok: false, error: "That code is incorrect or has expired." } };
  }

  const now = new Date().toISOString();
  await Promise.all([
    db.patch(`admin_login_otps?id=eq.${otp.id}`, { used_at: now }),
    db.patch(`users?id=eq.${me.id}`, { otp_verified_at: now }),
  ]);
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

  const db = SupabaseAdmin.fromEnv();
  const { user: me } = await lookupUser(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const setRes = await db.authAdmin(`users/${me.id}`, { method: "PUT", body: JSON.stringify({ password }) });
  const setJson = (await setRes.json()) as Record<string, string | undefined>;
  if (!setRes.ok) {
    return { status: 400, body: { error: setJson.msg || setJson.error_description || setJson.message || "Could not set password." } };
  }
  await db.patch(`users?id=eq.${me.id}`, { has_password: true });
  return { status: 200, body: { ok: true } };
}
