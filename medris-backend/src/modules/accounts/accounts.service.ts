import { SupabaseAdmin, type AuthUser } from "../../integrations/supabase.js";
import { requireEnv } from "../../config/env.js";
import { normalizePhone, phoneAlias } from "../../lib/format.js";
import type { ServiceResult } from "../../types/service.js";

/**
 * Account lifecycle: existence checks, registration, profile repair and
 * account deletion. Ported from api/delete-account.js.
 */


interface PublicUserRow {
  id: string;
  email: string | null;
  phone: string | null;
}

async function readJson<T>(response: Response, fallback: T): Promise<T> {
  return (await response.json().catch(() => fallback)) as T;
}

async function findAuthUserByEmail(db: SupabaseAdmin, wantedEmail: string): Promise<AuthUser | null> {
  const target = String(wantedEmail || "").trim().toLowerCase();
  if (!target) return null;
  for (let page = 1; page <= 20; page++) {
    const response = await db.authAdmin(`users?page=${page}&per_page=1000`);
    if (!response.ok) return null;
    const data = await readJson<{ users?: AuthUser[] } | AuthUser[]>(response, {});
    const users = Array.isArray(data) ? data : data.users || [];
    const match = users.find((user) => String(user?.email || "").trim().toLowerCase() === target);
    if (match) return match;
    if (users.length < 1000) break;
  }
  return null;
}

async function publicUserBy(db: SupabaseAdmin, column: "email" | "phone", value: string): Promise<PublicUserRow | null> {
  const response = await db.rest(`users?${column}=eq.${encodeURIComponent(value)}&select=id,email,phone`, { headers: db.jsonHeaders() });
  if (!response.ok) return null;
  const rows = await readJson<PublicUserRow[]>(response, []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

/* ------------------------------------------------------------------ exists */

export async function accountExists(body: Record<string, unknown>): Promise<ServiceResult> {
  const email = String(body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { status: 400, body: { error: "A valid email address is required." } };
  }
  const db = SupabaseAdmin.fromEnv();
  const profile = await publicUserBy(db, "email", email);
  const authUser = await findAuthUserByEmail(db, email);
  return {
    status: 200,
    body: { exists: Boolean(profile || authUser), hasPublicProfile: Boolean(profile), hasAuthAccount: Boolean(authUser) },
  };
}

/* ---------------------------------------------------------------- register */

/** Email is optional, phone is required, no confirmation e-mail is sent. */
export async function registerAccount(body: Record<string, unknown>): Promise<ServiceResult> {
  const cleanEmail = String(body?.email || "").trim().toLowerCase();
  const cleanName = String(body?.name || "").trim();
  const cleanPhone = String(body?.phone || "").trim();
  const normalizedPhone = normalizePhone(cleanPhone);
  const role = body?.role;
  const password = String(body?.password || "");
  const city = String(body?.city || "").trim();
  const referralCode = String(body?.referral_code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

  if (!cleanName) return { status: 400, body: { error: "Full name is required." } };
  if (!normalizedPhone || normalizedPhone.length < 10) return { status: 400, body: { error: "A valid phone number is required." } };
  if (password.length < 8) return { status: 400, body: { error: "Password must be at least 8 characters." } };
  if (role !== "buyer" && role !== "vendor") return { status: 400, body: { error: "Invalid account type." } };
  if (cleanEmail && !cleanEmail.includes("@")) return { status: 400, body: { error: "Enter a valid email address or leave email blank." } };

  // Choosing "vendor" at sign-up is only an application intent. users.role can
  // never be 'vendor' before a vendor application is reviewed and verified.
  const authoritativeRole = role === "vendor" ? "buyer" : role;
  const db = SupabaseAdmin.fromEnv();

  if (await publicUserBy(db, "phone", cleanPhone)) {
    return { status: 409, body: { error: "An account with that phone number already exists. Please log in instead." } };
  }
  if (cleanEmail) {
    const existingProfile = await publicUserBy(db, "email", cleanEmail);
    const existingAuth = await findAuthUserByEmail(db, cleanEmail);
    if (existingProfile || existingAuth) {
      return { status: 409, body: { error: "A user with this email address has already been registered. Please log in instead." } };
    }
  }

  // Phone-only accounts get a private synthetic login e-mail that never receives mail.
  const authEmail = cleanEmail || phoneAlias(cleanPhone);

  const createResponse = await db.authAdmin("users", {
    method: "POST",
    body: JSON.stringify({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: {
        name: cleanName,
        phone: cleanPhone,
        city,
        role: authoritativeRole,
        requested_role: role,
        email_optional: !cleanEmail,
        ...(referralCode ? { referral_code: referralCode } : {}),
      },
    }),
  });
  const created = await readJson<Record<string, unknown>>(createResponse, {});
  if (!createResponse.ok || !created?.id) {
    return {
      status: createResponse.status || 400,
      body: { error: created?.msg || created?.message || created?.error_description || "Could not create the account." },
    };
  }
  const userId = String(created.id);

  const profileResponse = await db.rest("users", {
    method: "POST",
    headers: db.jsonHeaders("resolution=ignore-duplicates,return=minimal"),
    body: JSON.stringify({
      id: userId,
      name: cleanName,
      email: cleanEmail || null,
      phone: cleanPhone,
      city,
      role: authoritativeRole,
      role_selected: true,
      has_password: true,
    }),
  });

  if (!profileResponse.ok && profileResponse.status !== 409) {
    await db.authAdmin(`users/${userId}`, { method: "DELETE" }).catch(() => undefined);
    const detail = await profileResponse.text().catch(() => "");
    return { status: 500, body: { error: detail || "Could not create the account profile." } };
  }

  // A referral code typed at sign-up is applied right away. A database trigger
  // normally does it already; this is the harmless-to-repeat safety net.
  let referral: unknown = null;
  if (referralCode) {
    try {
      const rr = await db.rpc("apply_referral_internal", { p_uid: userId, p_code: referralCode, p_skip_customer: role === "vendor" });
      referral = await readJson(rr, {});
    } catch {
      /* best effort */
    }
  }

  return { status: 201, body: { created: true, userId, loginEmail: authEmail, referral } };
}

/* ------------------------------------------------------------ ensure profile */

/**
 * Re-creates a missing public.users row for the signed-in account (for
 * example after an Auth account was deleted and re-created with a new id).
 * Never deletes anything and never grants a role above "buyer".
 *
 * Previously the browser's "ensure-profile" request fell through to account
 * deletion because api/delete-account.js had no branch for it.
 */
export async function ensureProfile(body: Record<string, unknown>): Promise<ServiceResult> {
  const accessToken = String(body?.accessToken || "");
  if (!accessToken) return { status: 400, body: { error: "accessToken is required." } };

  const url = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  const db = SupabaseAdmin.fromEnv();

  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` } });
  const me = await readJson<AuthUser | null>(userResponse, null);
  if (!userResponse.ok || !me?.id) return { status: 401, body: { error: "Invalid or expired session. Please log in again." } };

  const existingResponse = await db.rest(`users?id=eq.${encodeURIComponent(me.id)}&select=id`);
  if (!existingResponse.ok) return { status: 502, body: { error: "Could not check the account profile." } };
  const existing = await readJson<{ id: string }[]>(existingResponse, []);
  if (Array.isArray(existing) && existing.length) return { status: 200, body: { ok: true, created: false } };

  const meta = (me.user_metadata || {}) as Record<string, unknown>;
  const email = String(me.email || meta.email || "");
  const provider = String((me.app_metadata as Record<string, unknown> | null | undefined)?.provider || "");
  const insert = await db.rest("users", {
    method: "POST",
    headers: db.jsonHeaders("resolution=ignore-duplicates,return=minimal"),
    body: JSON.stringify({
      id: me.id,
      name: String(meta.name || meta.full_name || (email ? email.split("@")[0] : "") || "Levromart user"),
      email: email && !email.includes("@accounts.levromart.app") ? email : null,
      phone: String(meta.phone || ""),
      city: String(meta.city || "Lagos"),
      role: "buyer",
      role_selected: true,
      has_password: provider === "" || provider === "email",
      avatar_url: String(meta.avatar_url || meta.picture || ""),
    }),
  });
  if (!insert.ok && insert.status !== 409) {
    const detail = await insert.text().catch(() => "");
    return { status: 500, body: { error: detail || "Could not repair the account profile." } };
  }
  return { status: 200, body: { ok: true, created: true } };
}

/* ------------------------------------------------------------------ delete */

export async function deleteAccount(body: Record<string, unknown>): Promise<ServiceResult> {
  const accessToken = body?.accessToken;
  if (!accessToken) return { status: 400, body: { error: "accessToken is required." } };

  const url = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  const db = SupabaseAdmin.fromEnv();

  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${String(accessToken)}` } });
  const me = await readJson<AuthUser | null>(userResponse, null);
  if (!userResponse.ok || !me?.id) return { status: 401, body: { error: "Invalid or expired session. Please log in again." } };
  const uid = me.id;

  const vendorResponse = await db.rest(`vendors?user_id=eq.${encodeURIComponent(uid)}&select=id`, { headers: db.jsonHeaders() });
  const vendorRows = vendorResponse.ok ? await readJson<{ id: string }[]>(vendorResponse, []) : [];
  const vendorIds = (Array.isArray(vendorRows) ? vendorRows : []).map((row) => row.id).filter(Boolean);

  if (vendorIds.length) {
    const ids = vendorIds.join(",");
    const ordersResponse = await db.rest(`orders?vendor_id=in.(${ids})&status=not.in.(completed,cancelled)&select=id,status`, { headers: db.jsonHeaders() });
    const activeOrders = ordersResponse.ok ? await readJson<unknown[]>(ordersResponse, []) : [];
    if (Array.isArray(activeOrders) && activeOrders.length) {
      return {
        status: 400,
        body: { error: `You cannot delete your vendor account while ${activeOrders.length} order(s) are still active. Complete or cancel every active order first.` },
      };
    }
    const commissionResponse = await db.rest(`commission_charges?vendor_id=in.(${ids})&status=eq.owed&select=amount`, { headers: db.jsonHeaders() });
    if (commissionResponse.ok) {
      const charges = await readJson<{ amount?: number }[]>(commissionResponse, []);
      const owed = (Array.isArray(charges) ? charges : []).reduce((sum, row) => sum + Number(row?.amount || 0), 0);
      if (owed > 0) {
        return { status: 400, body: { error: `You have ₦${owed.toLocaleString()} in unsettled commission. Clear it before deleting your vendor account.` } };
      }
    }
  }

  // Capture conversations before the SQL wipe so their storage attachments can be removed too.
  let conversationIds: string[] = [];
  const conversationFilter = vendorIds.length ? `or=(buyer_id.eq.${uid},vendor_id.in.(${vendorIds.join(",")}))` : `buyer_id=eq.${uid}`;
  const conversationResponse = await db.rest(`conversations?${conversationFilter}&select=id`, { headers: db.jsonHeaders() });
  if (conversationResponse.ok) {
    const rows = await readJson<{ id: string }[]>(conversationResponse, []);
    conversationIds = (Array.isArray(rows) ? rows : []).map((row) => row.id).filter(Boolean);
  }

  // The SQL function performs the FK-safe deletion of public tables.
  const deleteResponse = await db.rest("rpc/delete_my_account", {
    method: "POST",
    headers: db.jsonHeaders(),
    body: JSON.stringify({ p_user_id: uid }),
  });
  const deleteBody = await readJson<Record<string, unknown>>(deleteResponse, {});
  if (!deleteResponse.ok) {
    return {
      status: 500,
      body: {
        error:
          deleteBody?.message ||
          deleteBody?.hint ||
          deleteBody?.details ||
          "Account data could not be fully deleted. Run the updated delete_my_account SQL function in Supabase first.",
      },
    };
  }

  const listStorage = async (bucket: string, prefix: string): Promise<{ name: string }[]> => {
    if (!prefix) return [];
    const response = await db.storage(`object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
    });
    if (!response.ok) return [];
    const rows = await readJson<{ name?: string }[]>(response, []);
    return (Array.isArray(rows) ? rows : []).filter((row): row is { name: string } => !!row?.name && !String(row.name).endsWith("/"));
  };
  const removeStorage = async (bucket: string, names: string[]): Promise<void> => {
    if (!names.length) return;
    const response = await db.storage("object/remove", {
      method: "POST",
      body: JSON.stringify(names.map((name) => ({ bucket_id: bucket, name }))),
    });
    if (!response.ok) throw new Error(`Could not delete files from ${bucket}.`);
  };

  const storageTargets: [string, string[]][] = [
    ["avatars", [uid]],
    ["vendor-docs", [uid]],
    ["vendor-logos", vendorIds],
    ["product-photos", vendorIds],
    ["chat-attachments", conversationIds.map((id) => `conv/${id}`)],
  ];
  for (const [bucket, prefixes] of storageTargets) {
    for (const prefix of prefixes) {
      const objects = await listStorage(bucket, prefix);
      await removeStorage(bucket, objects.map((object) => object.name));
    }
  }

  // Hard-delete the Auth identity (cascades its sessions and refresh tokens).
  const authDeleteResponse = await db.authAdmin(`users/${uid}`, { method: "DELETE" });
  if (!authDeleteResponse.ok) {
    const detail = await authDeleteResponse.text().catch(() => "");
    return { status: 500, body: { error: detail || "Marketplace data was deleted, but the authentication account could not be removed." } };
  }
  return { status: 200, body: { deleted: true } };
}
