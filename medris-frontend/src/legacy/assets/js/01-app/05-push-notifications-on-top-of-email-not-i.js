// ---------- PUSH NOTIFICATIONS (on top of email, not instead of) ----------
// Public VAPID key - safe to expose client-side, same reasoning as the
// Supabase anon key above. The matching private key lives only in Vercel
// (VAPID_PRIVATE_KEY), used by api/notify-push.js to actually send.
const VAPID_PUBLIC_KEY = "{{env:VITE_VAPID_PUBLIC_KEY}}";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}
function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
function maybeShowNotifPrompt() {
  if (!session || !pushSupported()) return;
  if (Notification.permission === "granted") { byId("notifPromptModal")?.classList.add("hidden"); return; }
  // Asked again every time the app is opened or someone logs in, until notifications are on. Once they are on, never again.
  const stamp = String(session.user?.id || "");
  if (window.__notifPromptShownFor === stamp) return;
  const installModal = byId("installPromptModal");
  if (installModal && !installModal.classList.contains("hidden")) return;
  const prompt = byId("notifPromptModal");
  if (!prompt) return;
  const btn = prompt.querySelector(".install-modal-actions .btn:not(.btn-outline)");
  const body = prompt.querySelector("p");
  if (Notification.permission === "denied") {
    if (body) body.textContent = "Notifications are blocked for Levromart. Open your browser/site settings to allow them.";
    if (btn) { btn.textContent = "Open notification settings"; btn.onclick = () => { showToast("Open your browser's site settings and allow notifications for Levromart, then try again.", "info"); }; }
  }
  window.__notifPromptShownFor = stamp;
  prompt.classList.remove("hidden");
  trackModalOpened("notifPromptModal");
}
function dismissNotifPrompt() {
  byId("notifPromptModal")?.classList.add("hidden");
  localStorage.setItem("medris-notif-dismissed", "1");
  if (dismissibleModalId === "notifPromptModal") dismissibleModalId = null;
  setTimeout(maybeShowTour, 400);
}
async function syncPushSubscription(registration) {
  if (!session || !pushSupported()) return null;
  const reg = registration || await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const raw = sub.toJSON();
  if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) return null;
  const { error } = await sb.from("push_subscriptions").upsert(
    { user_id: session.user.id, endpoint: raw.endpoint, p256dh: raw.keys.p256dh, auth_key: raw.keys.auth },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
  return sub;
}

async function refreshPushSubscription() {
  if (!session || !pushSupported() || Notification.permission !== "granted") return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // Permission is on but the browser dropped the subscription (Android does this after
    // updates, cleared data or long idle): quietly subscribe again so pushes keep arriving.
    if (!sub && !(isIos() && !isStandalone())) {
      try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }); } catch (_) { return null; }
    }
    if (!sub) return null;
    await syncPushSubscription(reg);
    return sub;
  } catch (_) {
    return null;
  }
}
