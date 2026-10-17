import crypto from "node:crypto";
import type { DataContext } from "../../database/context.js";
import { NotifyRepository } from "../../database/repositories/messaging.repository.js";
import { UsersRepository } from "../../database/repositories/users.repository.js";
import { VendorsRepository } from "../../database/repositories/vendors.repository.js";
import { sendNotificationEmail } from "../../integrations/email.js";
import { configureVapid, pushServiceKind, sendWebPush, type PushTarget } from "../../integrations/web-push.js";
import { appOrigin, iconOrigin, requireEnv } from "../../config/env.js";

/**
 * Turns a row of the `notifications` table into an e-mail (Resend) and a
 * web push to every device the user subscribed. Called by a single Postgres
 * trigger for every new notification (ported from api/notify.js).
 */

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body?: string | null;
  target_view?: string | null;
  target_params?: Record<string, unknown> | null;
  vendor_id?: string | null;
  actor_name?: string | null;
  actor_avatar_url?: string | null;
  reminder?: boolean;
}

/** Per-call, per-callee token (HMAC with the service key) that lets the service worker decline a call without a login. */
export function callToken(secret: string, callId: string, calleeId: string): string {
  return crypto.createHmac("sha256", secret).update(`call:${callId}:${calleeId}`).digest("hex");
}

/** Deep link into the app for a notification. */
export function notificationUrl(n: Pick<NotificationRow, "target_view" | "target_params">): string {
  return `${appOrigin()}/?nview=${encodeURIComponent(n.target_view || "home")}&nparams=${encodeURIComponent(JSON.stringify(n.target_params || {}))}`;
}

/** Calls are time-critical and points alerts are frequent: push + in-app only, never e-mailed. */
export function isPushOnlyType(type: string): boolean {
  return type === "incoming_call" || type === "missed_call" || type === "points" || type === "rank_change";
}

export async function sendNotificationEmailFor(data: DataContext, n: NotificationRow) {
  const u = await data.asService((tx) => new UsersRepository(tx).emailAndName(n.user_id));
  if (!u?.email) return { sent: false, reason: "no email on file" };
  const resendKey = process.env.RESEND_API_KEY || "";
  if (!resendKey) return { sent: false, reason: "RESEND_API_KEY not configured" };
  const result = await sendNotificationEmail(resendKey, { to: u.email, name: u.name, title: n.title, body: n.body ?? undefined, link: notificationUrl(n) });
  return { sent: result.ok, status: result.status, error: result.error };
}

// The picture on a notification is composed on the fly by /api/notif-icon: the
// person's or shop's photo (or initials), or an event icon, with the small
// Levromart mark at the bottom-right, like WhatsApp and Instagram.
const TYPE_ICON: [RegExp, string][] = [
  [/payment|paid|payout|refund|commission/, "payment"],
  [/order|offer|request|reminder/, "order"],
  [/follow/, "follow"],
  [/wishlist|favou?rite|like/, "heart"],
  [/review|comment|rating|points|rank_change/, "review"],
  [/admin|vendor_(approved|application|deleted|renamed)|dispute/, "admin"],
  [/message/, "message"],
];
const isHttps = (u: unknown): boolean => /^https:\/\//.test(String(u || ""));

export function composeIcon({ u, n, k }: { u?: unknown; n?: unknown; k?: string }): string {
  return (
    `${iconOrigin()}/api/notif-icon?` +
    [u && `u=${encodeURIComponent(String(u))}`, n && `n=${encodeURIComponent(String(n).slice(0, 60))}`, k && `k=${k}`].filter(Boolean).join("&")
  );
}

/** Event icon for a notification type, as a composed picture (or the plain app icon when no rule matches). */
export function iconForType(type: string): string {
  const hit = TYPE_ICON.find(([re]) => re.test(String(type || "").toLowerCase()));
  return hit ? composeIcon({ k: hit[1] }) : "/levromart-notification-icon.png";
}

export async function pickNotificationIcon(data: DataContext, n: NotificationRow): Promise<string> {
  const tp = (n.target_params || {}) as Record<string, unknown>;
  const person = tp.callerAvatar || tp.senderAvatar;
  if (isHttps(person)) return composeIcon({ u: person, n: tp.callerName || tp.senderName || n.actor_name });
  if (tp.callerName || tp.senderName) return composeIcon({ n: tp.callerName || tp.senderName });
  if (n.vendor_id) {
    try {
      const v = await data.asService((tx) => new VendorsRepository(tx).brand(n.vendor_id!));
      if (v && v.user_id !== n.user_id && (isHttps(v.logo_url) || v.business_name)) {
        return composeIcon({ u: isHttps(v.logo_url) ? v.logo_url : "", n: v.business_name });
      }
    } catch {
      /* fall through */
    }
  }
  if (isHttps(n.actor_avatar_url) || n.actor_name) return composeIcon({ u: isHttps(n.actor_avatar_url) ? n.actor_avatar_url : "", n: n.actor_name });
  return iconForType(n.type);
}

export interface PushOutcome {
  sent: number;
  reason?: string;
  results?: { kind: string; ok: boolean; status?: number }[];
}

/** The key behind call-decline tokens: the service-role key, as before, so links already sent keep working. */
function callTokenSecret(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export async function sendPush(data: DataContext, n: NotificationRow): Promise<PushOutcome> {
  // While the app is open on screen everything shows in-app, so no system
  // push (calls still ring). The page heartbeats every ~20 s.
  if (n.type !== "incoming_call") {
    try {
      const since = new Date(Date.now() - 45000).toISOString();
      if (await data.asService((tx) => new NotifyRepository(tx).appOpenSince(n.user_id, since))) return { sent: 0, reason: "user is in the app" };
    } catch {
      /* fall through and push */
    }
  }

  let subs: (PushTarget & { id: string; created_at?: string })[] | null = await data.asService((tx) => new NotifyRepository(tx).pushSubscriptions(n.user_id));
  if (n.reminder && Array.isArray(subs) && subs.length > 1) {
    // Reminders repeat often: one per push service (newest first) so a phone with the app and a browser tab doesn't buzz twice.
    const seen = new Set<string>();
    subs = subs
      .slice()
      .sort((x, y) => String(y.created_at || "").localeCompare(String(x.created_at || "")))
      .filter((s) => {
        const k = pushServiceKind(s.endpoint);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }
  if (!subs || subs.length === 0) return { sent: 0, reason: "no push subscriptions" };

  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
  if (!vapidPrivateKey) return { sent: 0, reason: "VAPID_PRIVATE_KEY not configured" };
  configureVapid(vapidPrivateKey);

  const url = notificationUrl(n);
  // Both the classic service-worker payload and the iOS 18.4+ Declarative Web
  // Push shape. An incoming call stays on screen until tapped, and expires
  // after 45 s so a stale "ringing" never shows up late.
  const isIncomingCall = n.type === "incoming_call";
  const callId = isIncomingCall ? (n.target_params?.callId as string | undefined) : null;
  const iconUrl = await pickNotificationIcon(data, n);
  const callActions = isIncomingCall
    ? [
        { action: "answer", title: "Answer" },
        { action: "decline", title: "Decline" },
      ]
    : undefined;
  const declineToken = callId ? callToken(callTokenSecret(), callId, n.user_id) : undefined;
  const tag = isIncomingCall ? "levromart-incoming-call" : `levromart-${n.id}`;
  const payload = JSON.stringify({
    actions: callActions,
    call: callId ? { id: callId, token: declineToken } : undefined,
    title: n.title,
    body: n.body,
    url,
    target_view: n.target_view || "home",
    target_params: n.target_params || {},
    requireInteraction: isIncomingCall,
    reminder: !!n.reminder,
    tag,
    icon: iconUrl,
    badge: "/levromart-badge.png",
    silent: false,
    web_push: 8030,
    notification: {
      title: n.title,
      body: n.body,
      icon: iconUrl,
      badge: "/levromart-badge.png",
      silent: false,
      tag,
      renotify: true,
      requireInteraction: isIncomingCall,
      actions: callActions,
      navigate: url,
    },
  });

  let sent = 0;
  const results: { kind: string; ok: boolean; status?: number }[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sendWebPush(s, payload, { urgency: "high", TTL: isIncomingCall ? 45 : n.reminder ? 60 : 86400 });
        sent++;
        results.push({ kind: pushServiceKind(s.endpoint), ok: true });
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        results.push({ kind: pushServiceKind(s.endpoint), ok: false, status: statusCode || 0 });
        // 404/410: the browser unsubscribed or the subscription expired.
        if (statusCode === 404 || statusCode === 410) await data.asService((tx) => new NotifyRepository(tx).deletePushSubscription(s.id));
      }
    }),
  );
  return { sent, results };
}
