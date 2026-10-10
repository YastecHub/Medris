import { Hono } from "hono";
import { SupabaseAdmin, lookupUser } from "../../integrations/supabase.js";
import { requireEnv } from "../../config/env.js";
import { errorMessage, json, methodNotAllowed, readJsonBody } from "../../lib/http.js";
import { hasWebhookSecret } from "../../middleware/cron-auth.js";
import { callToken, isPushOnlyType, sendNotificationEmailFor, sendPush, type NotificationRow } from "./notify.service.js";

/**
 * POST /api/notify
 *   { action: "test-push", accessToken }          Settings "send a test call alert"
 *   { action: "decline-call", callId, token }     "Decline" pressed on a call notification (no login)
 *   header x-webhook-secret + { reminders: [...] } batched reminders from the database (push only)
 *   header x-webhook-secret + { notificationId, ringAgain? } one notification -> e-mail + push
 */

interface NotifyBody {
  action?: string;
  accessToken?: string;
  callId?: string;
  token?: string;
  reminders?: { user_id?: string; kind?: string; title?: string; body?: string; view?: string; params?: Record<string, unknown> }[];
  notificationId?: string;
  ringAgain?: boolean;
}

export const notifyRoutes = new Hono().all("/notify", async (c) => {
  if (c.req.method !== "POST") return methodNotAllowed(c);
  try {
    const body = await readJsonBody<NotifyBody>(c);

    if (body.action === "test-push") {
      const db = SupabaseAdmin.fromEnv();
      const { user: me } = await lookupUser(String(body.accessToken || ""), "service");
      if (!me) return json(c, 401, { error: "Please log in again." });
      const out = await sendPush(db, {
        id: "test",
        user_id: me.id,
        type: "incoming_call",
        title: "Test call from Levromart",
        body: "If you can see this with the app closed, call alerts work on this phone.",
        target_view: "home",
        target_params: { callerName: "Levromart" },
      });
      return json(c, 200, out);
    }

    if (body.action === "decline-call") {
      const db = SupabaseAdmin.fromEnv();
      const callId = String(body.callId || "");
      if (!/^[0-9a-f-]{36}$/i.test(callId)) return json(c, 400, { error: "bad call id" });
      const call = await db.first<{ id: string; callee_id: string; status: string }>(`voice_calls?id=eq.${callId}&select=id,callee_id,status`);
      if (!call || callToken(db.key, call.id, call.callee_id) !== String(body.token || "")) return json(c, 401, { error: "Unauthorized" });
      if (call.status === "ringing") {
        await db.patch(`voice_calls?id=eq.${callId}&status=eq.ringing`, { status: "declined", ended_at: new Date().toISOString() });
      }
      return json(c, 200, { ok: true });
    }

    if (!hasWebhookSecret(c.req.header("x-webhook-secret"), requireEnv("EMAIL_WEBHOOK_SECRET"))) {
      return json(c, 401, { error: "Unauthorized" });
    }

    if (Array.isArray(body.reminders)) {
      const db = SupabaseAdmin.fromEnv();
      let sent = 0;
      for (const r of body.reminders.slice(0, 500)) {
        if (!r || !r.user_id) continue;
        const out = await sendPush(db, {
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
      return json(c, 200, { reminders: body.reminders.length, sent });
    }

    const { notificationId } = body;
    if (!notificationId) return json(c, 400, { error: "notificationId required" });

    const db = SupabaseAdmin.fromEnv();
    const n = await db.first<NotificationRow>(`notifications?id=eq.${notificationId}&select=*`);
    if (!n) return json(c, 200, { email: { sent: false, reason: "notification not found" }, push: { sent: 0 } });

    // The caller's app asks for the call alert to be repeated while it is still ringing.
    if (body.ringAgain) {
      const callId = n.type === "incoming_call" && n.target_params && (n.target_params.callId as string | undefined);
      const call = callId ? await db.first<{ status: string; created_at: string }>(`voice_calls?id=eq.${callId}&select=status,created_at`) : undefined;
      if (!call || call.status !== "ringing" || Date.now() - new Date(call.created_at).getTime() > 50000) {
        return json(c, 200, { push: { sent: 0 }, skipped: "not ringing" });
      }
      return json(c, 200, { push: await sendPush(db, n) });
    }

    const [email, push] = await Promise.all([
      isPushOnlyType(n.type) ? Promise.resolve({ sent: false, reason: "not emailed" }) : sendNotificationEmailFor(db, n),
      sendPush(db, n),
    ]);
    return json(c, 200, { email, push });
  } catch (err) {
    return json(c, 500, { error: errorMessage(err) || "Server error" });
  }
});
