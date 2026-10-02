// POST { notificationId }, header x-webhook-secret -> { email, push }
// Called by a single Postgres trigger (net.http_post) every time a row is
// inserted into `notifications` — see migration medris_035/036/046/065.
// This is what makes every in-app notification also become an email and a
// push, without each client action having to remember to trigger either.
// Merged from the old separate notify-email.js / notify-push.js into one
// function that fires both channels per call (Vercel's Hobby plan caps
// deployments at 12 serverless functions, and the DB only needs to make
// one webhook call per notification now instead of two).

const webpush = require("web-push");
const crypto = require("crypto");
const { readBody, env, sendNotificationEmail } = require("./_util");

// Per-call, per-callee token (HMAC with the service key, never sent anywhere else).
function callToken(secret, callId, calleeId) {
  return crypto.createHmac("sha256", secret).update(`call:${callId}:${calleeId}`).digest("hex");
}

const VAPID_PUBLIC_KEY = "BJ7h-JVsXaOpYXY5st5L7esSDOPjhRROincFPTT013a1ZY3U62WIKPAoFEDzBgFB8g3H2DBNX1iRw8GzdPWR88k";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));

    // "Decline" button on an incoming-call notification, pressed while the app is
    // closed. The service worker has no login, so it sends the one-time token that
    // was minted for this exact call + callee when the push was created.
    if (body.action === "decline-call") {
      const SUPABASE_URL = env("SUPABASE_URL");
      const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
      const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
      const callId = String(body.callId || "");
      if (!/^[0-9a-f-]{36}$/i.test(callId)) { res.status(400).json({ error: "bad call id" }); return; }
      const [call] = await (await fetch(`${SUPABASE_URL}/rest/v1/voice_calls?id=eq.${callId}&select=id,callee_id,status`, { headers: svc })).json();
      if (!call || !callToken(SERVICE_KEY, call.id, call.callee_id) || callToken(SERVICE_KEY, call.id, call.callee_id) !== String(body.token || "")) {
        res.status(401).json({ error: "Unauthorized" }); return;
      }
      if (call.status === "ringing") {
        await fetch(`${SUPABASE_URL}/rest/v1/voice_calls?id=eq.${callId}&status=eq.ringing`, {
          method: "PATCH", headers: { ...svc, Prefer: "return=minimal" },
          body: JSON.stringify({ status: "declined", ended_at: new Date().toISOString() }),
        });
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (req.headers["x-webhook-secret"] !== env("EMAIL_WEBHOOK_SECRET")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { notificationId } = body;

    if (!notificationId) {
      res.status(400).json({ error: "notificationId required" });
      return;
    }

    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

    const svcHeaders = {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`
    };

    const nRes = await fetch(
      `${SUPABASE_URL}/rest/v1/notifications?id=eq.${notificationId}&select=*`,
      { headers: svcHeaders }
    );

    const [n] = await nRes.json();

    if (!n) {
      res.status(200).json({
        email: {
          sent: false,
          reason: "notification not found"
        },
        push: {
          sent: 0
        }
      });
      return;
    }

    // The caller's app asks for the call alert to be repeated while it is still ringing.
    if (body.ringAgain) {
      const callId = n.type === "incoming_call" && n.target_params && n.target_params.callId;
      const [call] = callId ? await (await fetch(`${SUPABASE_URL}/rest/v1/voice_calls?id=eq.${callId}&select=status,created_at`, { headers: svcHeaders })).json() : [];
      if (!call || call.status !== "ringing" || Date.now() - new Date(call.created_at).getTime() > 50000) {
        res.status(200).json({ push: { sent: 0 }, skipped: "not ringing" });
        return;
      }
      res.status(200).json({ push: await sendPush(SUPABASE_URL, svcHeaders, n) });
      return;
    }

    // Calls are time-critical and pointless in an inbox: push only, no email.
    const callType = n.type === "incoming_call" || n.type === "missed_call";
    const [email, push] = await Promise.all([
      callType ? Promise.resolve({ sent: false, reason: "not emailed" }) : sendEmail(SUPABASE_URL, svcHeaders, n),
      sendPush(SUPABASE_URL, svcHeaders, n),
    ]);

    res.status(200).json({ email, push });
  } catch (err) {
    res.status(500).json({
      error: err.message || "Server error"
    });
  }
};

async function sendEmail(SUPABASE_URL, svcHeaders, n) {
  const uRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${n.user_id}&select=email,name`,
    { headers: svcHeaders }
  );

  const [u] = await uRes.json();

  if (!u?.email) {
    return {
      sent: false,
      reason: "no email on file"
    };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

  if (!RESEND_API_KEY) {
    return {
      sent: false,
      reason: "RESEND_API_KEY not configured"
    };
  }

  const origin = "https://levromart.vercel.app";

  const link =
    `${origin}/?nview=${encodeURIComponent(n.target_view || "home")}` +
    `&nparams=${encodeURIComponent(JSON.stringify(n.target_params || {}))}`;

  const result = await sendNotificationEmail(RESEND_API_KEY, {
    to: u.email,
    name: u.name,
    title: n.title,
    body: n.body,
    link
  });

  return {
    sent: result.ok,
    status: result.status,
    error: result.error
  };
}

// Which picture goes on the notification: the person (or shop) it is about, like WhatsApp,
// otherwise a Levromart icon for the kind of event. The small status-bar badge stays the app mark.
const TYPE_ICON = [
  [/payment|paid|payout|refund|commission/, "payment"],
  [/order|offer|request|reminder/, "order"],
  [/follow/, "follow"],
  [/wishlist|favou?rite|like/, "heart"],
  [/review|comment|rating/, "review"],
  [/admin|vendor_(approved|application|deleted|renamed)|dispute/, "admin"],
  [/message/, "message"],
];
const isHttps = (u) => /^https:\/\//.test(String(u || ""));
async function pickNotificationIcon(SUPABASE_URL, svcHeaders, n) {
  const tp = n.target_params || {};
  const person = tp.callerAvatar || tp.senderAvatar;
  if (isHttps(person)) return String(person);
  if (n.vendor_id) {
    try {
      const [v] = await (await fetch(`${SUPABASE_URL}/rest/v1/vendors?id=eq.${n.vendor_id}&select=logo_url,user_id`, { headers: svcHeaders })).json();
      if (v && v.user_id !== n.user_id && isHttps(v.logo_url)) return v.logo_url;
    } catch (_) {}
  }
  if (isHttps(n.actor_avatar_url)) return n.actor_avatar_url;
  const type = String(n.type || "").toLowerCase();
  const hit = TYPE_ICON.find(([re]) => re.test(type));
  return hit ? `/notif-icons/${hit[1]}.png` : "/levromart-notification-icon.png";
}

async function sendPush(SUPABASE_URL, svcHeaders, n) {
  const subsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${n.user_id}&select=*`,
    { headers: svcHeaders }
  );

  const subs = await subsRes.json();

  if (!subs || subs.length === 0) {
    return {
      sent: 0,
      reason: "no push subscriptions"
    };
  }

  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

  if (!VAPID_PRIVATE_KEY) {
    return {
      sent: 0,
      reason: "VAPID_PRIVATE_KEY not configured"
    };
  }

  webpush.setVapidDetails(
    "mailto:support@levromart.app",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );

  const origin = "https://levromart.vercel.app";

  const url =
    `${origin}/?nview=${encodeURIComponent(n.target_view || "home")}` +
    `&nparams=${encodeURIComponent(JSON.stringify(n.target_params || {}))}`;

  // Keep both the classic service-worker payload and the iOS 18.4+
  // Declarative Web Push shape. This makes the notification user-visible
  // even if the Home Screen web app is closed and the service worker cannot
  // be started in time. Older browsers simply use the classic fields.
  // An incoming call stays on screen until it is tapped (or the caller gives up),
  // and the push expires after 45s so a stale "ringing" never shows up late.
  const isIncomingCall = n.type === "incoming_call";
  const callId = isIncomingCall ? (n.target_params && n.target_params.callId) : null;
  const iconUrl = await pickNotificationIcon(SUPABASE_URL, svcHeaders, n);
  const callActions = isIncomingCall ? [
    { action: "answer", title: "Answer" },
    { action: "decline", title: "Decline" }
  ] : undefined;
  const declineToken = callId ? callToken(env("SUPABASE_SERVICE_ROLE_KEY"), callId, n.user_id) : undefined;
  const payload = JSON.stringify({
    actions: callActions,
    call: callId ? { id: callId, token: declineToken } : undefined,
    title: n.title,
    body: n.body,
    url,
    target_view: n.target_view || "home",
    target_params: n.target_params || {},
    requireInteraction: isIncomingCall,
    tag: isIncomingCall ? "levromart-incoming-call" : `levromart-${n.id}`,
    icon: iconUrl,
    badge: '/levromart-badge.png',
    silent: false,
    web_push: 8030,
    notification: {
      title: n.title,
      body: n.body,
      icon: iconUrl,
      badge: '/levromart-badge.png',
      silent: false,
      tag: isIncomingCall ? "levromart-incoming-call" : `levromart-${n.id}`,
      renotify: true,
      requireInteraction: isIncomingCall,
      actions: callActions,
      navigate: url
    }
  });

  let sent = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: {
              p256dh: s.p256dh,
              auth: s.auth_key
            }
          },
          payload,
          { urgency: 'high', TTL: isIncomingCall ? 45 : 86400 }
        );

        sent++;
      } catch (err) {
        // 404/410 = the browser unsubscribed or the subscription expired.
        // Clean it up.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await fetch(
            `${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${s.id}`,
            {
              method: "DELETE",
              headers: svcHeaders
            }
          );
        }
      }
    })
  );

  return { sent };
}
