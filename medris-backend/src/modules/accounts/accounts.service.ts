import crypto from "node:crypto";
import { getDataContext } from "../../database/index.js";
import { passwordMatches } from "../../integrations/password-check.js";
import { BusinessLinksRepository, type BusinessLink } from "../../database/repositories/business-links.repository.js";
import { OrdersRepository } from "../../database/repositories/orders.repository.js";
import { UsersRepository } from "../../database/repositories/users.repository.js";
import { VendorsRepository } from "../../database/repositories/vendors.repository.js";
import { findPgError } from "../../database/errors.js";
import { SupabaseAuthAdmin, SupabaseAuthError, fetchAuthUser } from "../../integrations/supabase-auth.js";
import { normalizePhone, phoneAlias } from "../../lib/format.js";
import { identityFromAccessToken } from "../auth/caller.js";
import type { ServiceResult } from "../../shared/types/service.js";
import { AppError } from "../../shared/errors/app-error.js";
import { AccountService } from "../account/account.service.js";

/**
 * Account lifecycle: existence checks, registration, profile repair and
 * account deletion. Ported from api/delete-account.js.
 *
 * Profiles (public.users) and everything else in the database go through the
 * backend's data layer; login accounts (auth.users) are still created and
 * deleted through Supabase Auth's admin API, and files through Supabase
 * Storage - the two remaining Supabase services (docs/SUPABASE_AUDIT.md).
 */

async function publicUserBy(column: "email" | "phone", value: string) {
  return getDataContext().asService((tx) => new UsersRepository(tx).findByContact(column, value));
}

/* ------------------------------------------------------------------ exists */

/**
 * Deletion happens only for a request with no action (what the app's "Delete
 * account" screen sends) or an explicit "delete". Any other unknown action is
 * rejected instead of deleting the account.
 */
const DELETE_ACTIONS = new Set(["", "delete", "delete-account"]);

/** POST /api/delete-account (and its aliases): `action` picks what to do. */
export function handleAccountAction(body: Record<string, unknown>): Promise<ServiceResult> {
  const action = String(body.action || "").toLowerCase();
  if (action === "account-exists" || action === "check-email") return accountExists(body);
  if (action === "register") return registerAccount(body);
  if (action === "ensure-profile") return ensureProfile(body);
  if (action === "create-business") return createBusiness(body);
  if (action === "list-businesses") return listBusinesses(body);
  if (action === "switch-business") return switchBusiness(body);
  if (action === "delete-business") return deleteBusiness(body);
  if (action === "pause-business") return setBusinessPaused(body);
  if (DELETE_ACTIONS.has(action)) return deleteAccount(body);
  return Promise.resolve({ status: 400, body: { error: "Unknown account action." } });
}

export async function accountExists(body: Record<string, unknown>): Promise<ServiceResult> {
  const email = String(body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { status: 400, body: { error: "A valid email address is required." } };
  }
  const profile = await publicUserBy("email", email);
  const authUser = await SupabaseAuthAdmin.fromEnv().findUserByEmail(email);
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
  const authAdmin = SupabaseAuthAdmin.fromEnv();
  const data = getDataContext();

  if (await publicUserBy("phone", cleanPhone)) {
    return { status: 409, body: { error: "An account with that phone number already exists. Please log in instead." } };
  }
  if (cleanEmail) {
    const existingProfile = await publicUserBy("email", cleanEmail);
    const existingAuth = await authAdmin.findUserByEmail(cleanEmail);
    if (existingProfile || existingAuth) {
      return { status: 409, body: { error: "A user with this email address has already been registered. Please log in instead." } };
    }
  }

  // Phone-only accounts get a private synthetic login e-mail that never receives mail.
  const authEmail = cleanEmail || phoneAlias(cleanPhone);

  let userId: string;
  try {
    const created = await authAdmin.createUser({
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
    });
    userId = String(created.id);
  } catch (err) {
    if (err instanceof SupabaseAuthError) return { status: err.status || 400, body: { error: err.message } };
    throw err;
  }

  // The sign-up trigger normally creates the profile already; this insert only fills a gap.
  try {
    await data.asService((tx) =>
      new UsersRepository(tx).insertIgnoringDuplicates({
        id: userId,
        name: cleanName,
        email: cleanEmail || null,
        phone: cleanPhone,
        city,
        role: authoritativeRole,
        roleSelected: true,
        hasPassword: true,
      }),
    );
  } catch (err) {
    await authAdmin.deleteUser(userId).catch(() => undefined);
    return { status: 500, body: { error: findPgError(err)?.message || "Could not create the account profile." } };
  }

  // A referral code typed at sign-up is applied right away. A database trigger
  // normally does it already; this is the harmless-to-repeat safety net.
  let referral: unknown = null;
  if (referralCode) {
    try {
      referral = await data.asService((tx) => new UsersRepository(tx).applyReferral(userId, referralCode, role === "vendor"));
    } catch (err) {
      // PostgREST answered a failed call with its error body; keep reporting that shape.
      const pg = findPgError(err);
      referral = pg ? { code: pg.code, message: pg.message, details: pg.detail ?? null, hint: pg.hint ?? null } : {};
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

  const identity = await identityFromAccessToken(accessToken);
  if (!identity) return { status: 401, body: { error: "Invalid or expired session. Please log in again." } };
  const data = getDataContext();

  let exists: boolean;
  try {
    exists = await data.asService((tx) => new UsersRepository(tx).exists(identity.userId));
  } catch {
    return { status: 502, body: { error: "Could not check the account profile." } };
  }
  if (exists) return { status: 200, body: { ok: true, created: false } };

  // Profile details come from the Supabase Auth account (its metadata), fetched only in this rare repair path.
  const { user: me } = await fetchAuthUser(accessToken);
  if (!me?.id || me.id !== identity.userId) return { status: 401, body: { error: "Invalid or expired session. Please log in again." } };
  const meta = (me.user_metadata || {}) as Record<string, unknown>;
  const email = String(me.email || meta.email || "");
  const provider = String((me.app_metadata as Record<string, unknown> | null | undefined)?.provider || "");
  try {
    await data.asService((tx) =>
      new UsersRepository(tx).insertIgnoringDuplicates({
        id: me.id,
        name: String(meta.name || meta.full_name || (email ? email.split("@")[0] : "") || "Levromart user"),
        email: email && !email.includes("@accounts.levromart.app") ? email : null,
        phone: String(meta.phone || ""),
        city: String(meta.city || "Lagos"),
        role: "buyer",
        roleSelected: true,
        hasPassword: provider === "" || provider === "email",
        avatarUrl: String(meta.avatar_url || meta.picture || ""),
      }),
    );
  } catch (err) {
    return { status: 500, body: { error: findPgError(err)?.message || "Could not repair the account profile." } };
  }
  return { status: 200, body: { ok: true, created: true } };
}

/* ------------------------------------------------------------------ delete */

export async function deleteAccount(body: Record<string, unknown>): Promise<ServiceResult> {
  const accessToken = body?.accessToken;
  if (!accessToken) return { status: 400, body: { error: "accessToken is required." } };

  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid or expired session. Please log in again." } };
  const uid = me.userId;
  const data = getDataContext();

  const vendorIds = await data.asService((tx) => new VendorsRepository(tx).idsOwnedBy(uid)).catch(() => [] as string[]);

  if (vendorIds.length) {
    const activeOrders = await data.asService((tx) => new OrdersRepository(tx).activeForVendors(vendorIds)).catch(() => []);
    if (activeOrders.length) {
      return {
        status: 400,
        body: { error: `You cannot delete your vendor account while ${activeOrders.length} order(s) are still active. Complete or cancel every active order first.` },
      };
    }
    const owed = await data.asService((tx) => new VendorsRepository(tx).owedCommission(vendorIds)).catch(() => 0);
    if (owed > 0) {
      return { status: 400, body: { error: `You have ₦${owed.toLocaleString()} in unsettled commission. Clear it before deleting your vendor account.` } };
    }
  }


  // Money in the Levromart wallet (or on its way to the bank) belongs to the person: it must be withdrawn or used first,
  // or it would be lost (migration 0033; skipped when the wallet tables do not exist).
  const wallet = await data.asService((tx) => new BusinessLinksRepository(tx).wallet(uid)).catch(() => null);
  if (wallet && Number(wallet.kobo) > 0) {
    return { status: 400, body: { error: `You still have ₦${(Number(wallet.kobo) / 100).toLocaleString()} in your Levromart wallet. Withdraw it or use it before deleting your account.` } };
  }
  if (wallet?.pending) {
    return { status: 400, body: { error: "A withdrawal from your wallet is still on its way. Please wait until it reaches your bank, then try again." } };
  }

  // The port of delete_my_account() performs the FK-safe deletion of public tables. It only
  // deletes the caller's own account (or any, for an admin), as the SQL function did.
  try {
    await new AccountService(() => data).deleteAccountData(me, uid);
  } catch (err) {
    if (err instanceof AppError && err.status < 500) return { status: 500, body: { error: err.message } };
    const pg = findPgError(err);
    return {
      status: 500,
      body: { error: pg?.message || pg?.hint || pg?.detail || "Account data could not be fully deleted. Run the updated delete_my_account SQL function in Supabase first." },
    };
  }

  // Files are kept and the login is locked instead of erased, so a deleted account can be put back
  // (migration 0044 keeps a copy of every deleted row: public.restore_deleted_account).
  const locked = await SupabaseAuthAdmin.fromEnv().banUser(uid);
  if (!locked.ok) {
    return { status: 500, body: { error: locked.detail || "Marketplace data was deleted, but the login could not be closed." } };
  }
  return { status: 200, body: { deleted: true } };
}

/* -------------------------------------------------------------- businesses */
/*
 * One person can run several businesses from one login (migration 0064). Each extra business is its own Levromart
 * account - its own earnings, bank details, verification and billing - with a private login the owner never types,
 * linked to the owner in business_links. Switching hands the app a session for the other account. Ported from
 * api/delete-account.js.
 */

const MAX_BUSINESSES = 5;
const UUID = /^[0-9a-f-]{36}$/i;

const withLinks = <T>(work: (repo: BusinessLinksRepository) => Promise<T>): Promise<T> => getDataContext().asService((tx) => work(new BusinessLinksRepository(tx)));

/** The businesses the person owns, or the owner of the business account they are in. */
async function linksFor(userId: string): Promise<{ asOwner: BusinessLink[]; asBusiness: BusinessLink | null }> {
  const list = await withLinks((r) => r.linksOf(userId));
  return { asOwner: list.filter((l) => l.owner_id === userId), asBusiness: list.find((l) => l.business_user_id === userId) ?? null };
}

/** A fresh session for another account; only after the caller has been checked against business_links. */
async function sessionFor(userId: string): Promise<{ access_token: string; refresh_token: string }> {
  const admin = SupabaseAuthAdmin.fromEnv();
  const user = await admin.getUser(userId);
  if (!user?.email) throw new SupabaseAuthError("Could not open that business account.", 502);
  return admin.sessionFor(String(user.email), process.env.SUPABASE_ANON_KEY ?? "");
}

async function signedIn(body: Record<string, unknown>) {
  const token = String(body?.accessToken || "");
  return token ? identityFromAccessToken(token) : null;
}

export async function createBusiness(body: Record<string, unknown>): Promise<ServiceResult> {
  const me = await signedIn(body);
  if (!me) return { status: 401, body: { error: "Please log in again." } };
  const name = String(body?.name || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) return { status: 400, body: { error: "Enter the business name (2 to 80 characters)." } };
  const links = await linksFor(me.userId);
  if (links.asBusiness) return { status: 403, body: { error: "Switch to your main account to add another business." } };
  if (links.asOwner.length >= MAX_BUSINESSES) return { status: 400, body: { error: `You can have up to ${MAX_BUSINESSES} businesses.` } };

  const admin = SupabaseAuthAdmin.fromEnv();
  let created: { id: string };
  try {
    created = await admin.createUser({
      email: `biz.${crypto.randomUUID()}@accounts.levromart.app`,
      password: crypto.randomBytes(36).toString("base64url"),
      email_confirm: true,
      user_metadata: { name, role: "buyer", requested_role: "vendor", email_optional: true, business_of: me.userId },
    });
  } catch (err) {
    return { status: 400, body: { error: err instanceof Error ? err.message : "Could not create the business." } };
  }
  const undo = () => admin.deleteUser(created.id).catch(() => undefined);
  const city = String(body?.city || "").trim();
  try {
    await withLinks((r) => r.createBusiness({ businessUserId: created.id, ownerId: me.userId, name, city }));
  } catch {
    await undo();
    return { status: 500, body: { error: "Could not link the business to your account." } };
  }
  // A business account may use its owner's phone number (migration 0066); harmless if that column is missing.
  await withLinks((r) => r.markBusinessAccount(created.id)).catch(() => undefined);
  try {
    return { status: 201, body: { created: true, userId: created.id, name, session: await sessionFor(created.id) } };
  } catch {
    return { status: 502, body: { error: "The business was created. Please use Switch business to open it.", userId: created.id } };
  }
}

export async function listBusinesses(body: Record<string, unknown>): Promise<ServiceResult> {
  const me = await signedIn(body);
  if (!me) return { status: 401, body: { error: "Please log in again." } };
  const links = await linksFor(me.userId);
  const ids = links.asBusiness ? [links.asBusiness.owner_id] : links.asOwner.map((l) => l.business_user_id);
  if (!ids.length) return { status: 200, body: { isBusiness: false, businesses: [], max: MAX_BUSINESSES } };
  const [users, vendors, unreadRows] = await Promise.all([withLinks((r) => r.profiles(ids)), withLinks((r) => r.shops(ids)), withLinks((r) => r.unread(ids))]);
  const unread = new Map(unreadRows.map((r) => [r.user_id, Number(r.n)]));
  const businesses = ids.map((id) => {
    const u = users.find((x) => x.id === id);
    const v = vendors.find((x) => x.user_id === id);
    return { userId: id, name: v?.business_name || u?.name || "Business", logo: v?.logo_url || u?.avatar_url || null, status: v ? v.verification_status : "setup_needed", paused: !!v && v.is_active === false, unread: unread.get(id) ?? 0 };
  });
  const payload: Record<string, unknown> = { isBusiness: !!links.asBusiness, businesses, max: MAX_BUSINESSES };
  if (links.asBusiness) {
    // the owner's contact details, so a business's shop application can be pre-filled
    const ownerId = links.asBusiness.owner_id;
    const ou = users.find((x) => x.id === ownerId);
    const ov = vendors.find((x) => x.user_id === ownerId);
    payload.owner = { name: ov?.business_name || ou?.name || "", phone: ou?.phone || "", whatsapp: ov?.whatsapp_number || "", city: ov?.city || "", cac: ov?.cac_number || "" };
  }
  return { status: 200, body: payload };
}

export async function switchBusiness(body: Record<string, unknown>): Promise<ServiceResult> {
  const me = await signedIn(body);
  if (!me) return { status: 401, body: { error: "Please log in again." } };
  const target = String(body?.targetUserId || "");
  if (!UUID.test(target) || target === me.userId) return { status: 400, body: { error: "Choose a business to open." } };
  const links = await linksFor(me.userId);
  // the owner may open any of their businesses; a business account may only go back to its owner
  const allowed = links.asBusiness ? links.asBusiness.owner_id === target : links.asOwner.some((l) => l.business_user_id === target);
  if (!allowed) return { status: 403, body: { error: "You can't open that account." } };
  try {
    return { status: 200, body: { session: await sessionFor(target) } };
  } catch (err) {
    return { status: 502, body: { error: err instanceof Error ? err.message : "Could not open that business." } };
  }
}

/** The owner pauses (or resumes) one of their businesses: customers cannot find or order from a paused shop. */
export async function setBusinessPaused(body: Record<string, unknown>): Promise<ServiceResult> {
  const me = await signedIn(body);
  if (!me) return { status: 401, body: { error: "Please log in again." } };
  const target = String(body?.targetUserId || "");
  if (!UUID.test(target)) return { status: 400, body: { error: "Choose a business." } };
  const links = await linksFor(me.userId);
  if (links.asBusiness || !links.asOwner.some((l) => l.business_user_id === target)) {
    return { status: 403, body: { error: "You can only pause your own businesses from your main account." } };
  }
  const paused = body?.paused === true;
  const changed = await withLinks((r) => r.setShopActive(target, !paused));
  if (!changed) return { status: 400, body: { error: "This business has no shop to pause yet." } };
  return { status: 200, body: { paused } };
}

/**
 * The owner deletes one of their businesses with their own password. Everything that stops an account deletion
 * (active orders, unsettled commission, money in the wallet) also stops this.
 */
export async function deleteBusiness(body: Record<string, unknown>): Promise<ServiceResult> {
  const me = await signedIn(body);
  if (!me) return { status: 401, body: { error: "Please log in again." } };
  const target = String(body?.targetUserId || "");
  const password = String(body?.password || "");
  if (!UUID.test(target) || target === me.userId) return { status: 400, body: { error: "Choose a business to delete." } };
  if (!password) return { status: 400, body: { error: "Enter your password to confirm." } };
  const links = await linksFor(me.userId);
  if (links.asBusiness || !links.asOwner.some((l) => l.business_user_id === target)) {
    return { status: 403, body: { error: "You can only delete your own businesses from your main account." } };
  }
  if (!me.email) return { status: 400, body: { error: "This account has no password to confirm with." } };
  let ok = false;
  try {
    ok = await passwordMatches(me.userId, me.email, password);
  } catch {
    return { status: 503, body: { error: "We couldn't check your password right now. Please try again." } };
  }
  if (!ok) return { status: 403, body: { error: "That password is not correct." } };
  let session: { access_token: string };
  try {
    session = await sessionFor(target);
  } catch (err) {
    return { status: 502, body: { error: err instanceof Error ? err.message : "Could not open that business." } };
  }
  const result = await deleteAccount({ accessToken: session.access_token });
  if (result.status === 200 && (result.body as { deleted?: boolean } | null)?.deleted) {
    await withLinks((r) => r.unlink(target)).catch(() => undefined);
  }
  return result;
}
