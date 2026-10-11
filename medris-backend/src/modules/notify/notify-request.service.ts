import crypto from "node:crypto";
import { requireEnv } from "../../config/env.js";
import { getDataContext } from "../../database/index.js";
import { NotifyRepository } from "../../database/repositories/messaging.repository.js";
import { hasWebhookSecret } from "../../middleware/cron-auth.js";
import type { ServiceResult } from "../../shared/types/service.js";
import { identityFromAccessToken } from "../auth/caller.js";
import { callToken, isPushOnlyType, sendNotificationEmailFor, sendPush, type NotificationRow } from "./notify.service.js";

/**
 * POST /api/notify
 *   { action: "test-push", accessToken }          Settings "send a test call alert"
 *   { action: "decline-call", callId, token }     "Decline" pressed on a call notification (no login)
 *   x-webhook-secret + { reminders: [...] }       batched reminders from the database (push only)
 *   x-webhook-secret + { notificationId, ringAgain? } one notification -> e-mail + push
 */

export interface NotifyBody {
  action?: string;
  accessToken?: string;
  callId?: string;
  token?: string;
  reminders?: { user_id?: string; kind?: string; title?: string; body?: string; view?: string; params?: Record<string, unknown> }[];
  notificationId?: string;
  ringAgain?: boolean;
}

const CALL_ID = /^[0-9a-f-]{36}$/i;
const RING_AGAIN_WINDOW_MS = 50_000;
const MAX_REMINDERS = 500;

/** Constant-time comparison for the call-decline token. */
function sameToken(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function handleNotify(body: NotifyBody, webhookSecret: string | undefined): Promise<ServiceResult> {
  if (body.action === "test-push") return testPush(body);
  if (body.action === "decline-call") return declineCall(body);

  if (!hasWebhookSecret(webhookSecret, requireEnv("EMAIL_WEBHOOK_SECRET"))) return { status: 401, body: { error: "Unauthorized" } };
  if (Array.isArray(body.reminders)) return sendReminders(body.reminders);
  return deliverNotification(body);
}

async function testPush(body: NotifyBody): Promise<ServiceResult> {
  const me = await identityFromAccessToken(String(body.accessToken || ""));
  if (!me) return { status: 401, body: { error: "Please log in again." } };
  const out = await sendPush(getDataContext(), {
    id: "test",
    user_id: me.userId,
    type: "incoming_call",
    title: "Test call from Levromart",
    body: "If you can see this with the app closed, call alerts work on this phone.",
    target_view: "home",
    target_params: { callerName: "Levromart" },
  });
  return { status: 200, body: out as unknown as Record<string, unknown> };
}

async function declineCall(body: NotifyBody): Promise<ServiceResult> {
  const callId = String(body.callId || "");
  if (!CALL_ID.test(callId)) return { status: 400, body: { error: "bad call id" } };
  const data = getDataContext();
  const call = await data.asService((tx) => new NotifyRepository(tx).call(callId));
  if (!call || !sameToken(callToken(requireEnv("SUPABASE_SERVICE_ROLE_KEY"), call.id, call.callee_id), String(body.token || ""))) {
    return { status: 401, body: { error: "Unauthorized" } };
  }
  if (call.status === "ringing") {
    await data.asService((tx) => new NotifyRepository(tx).declineIfRinging(callId, new Date().toISOString()));
  }
  return { status: 200, body: { ok: true } };
}

async function sendReminders(reminders: NonNullable<NotifyBody["reminders"]>): Promise<ServiceResult> {
  const data = getDataContext();
  let sent = 0;
  for (const r of reminders.slice(0, MAX_REMINDERS)) {
    if (!r || !r.user_id) continue;
    const out = await sendPush(data, {
      id: `reminder-${r.kind || "x"}-${r.user_id}`,
      user_id: r.user_id,
      type: r.kind === "orders" ? "order_reminder" : "new_message",
      title: String(r.title || "Levromart"),
      body: String(r.body || ""),
      target_view: r.view || "home",
      target_params: r.params || {},
      reminder: true,
    }).catch(() => ({ sent: 0 }));
    sent += out.sent || 0;
  }
  return { status: 200, body: { reminders: reminders.length, sent } };
}

async function deliverNotification(body: NotifyBody): Promise<ServiceResult> {
  const { notificationId } = body;
  if (!notificationId) return { status: 400, body: { error: "notificationId required" } };
  const notFound = { status: 200, body: { email: { sent: false, reason: "notification not found" }, push: { sent: 0 } } };
  if (!CALL_ID.test(String(notificationId))) return notFound;

  const data = getDataContext();
  const n = (await data.asService((tx) => new NotifyRepository(tx).notification(String(notificationId)))) as NotificationRow | null;
  if (!n) return notFound;

  // The caller's app asks for the call alert to be repeated while it is still ringing.
  if (body.ringAgain) {
    const callId = n.type === "incoming_call" && n.target_params && (n.target_params.callId as string | undefined);
    const call = callId && CALL_ID.test(callId) ? await data.asService((tx) => new NotifyRepository(tx).call(callId)) : null;
    if (!call || call.status !== "ringing" || Date.now() - new Date(call.created_at).getTime() > RING_AGAIN_WINDOW_MS) {
      return { status: 200, body: { push: { sent: 0 }, skipped: "not ringing" } };
    }
    return { status: 200, body: { push: await sendPush(data, n) } };
  }

  const [email, push] = await Promise.all([
    isPushOnlyType(n.type) ? Promise.resolve({ sent: false, reason: "not emailed" }) : sendNotificationEmailFor(data, n),
    sendPush(data, n),
  ]);
  return { status: 200, body: { email, push } };
}
