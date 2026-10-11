// ---------- Call & message alerts check (Settings) ----------
async function levroPushStatus() {
  if (!pushSupported()) return { ok: false, text: "This browser can't receive alerts when the app is closed." };
  if (Notification.permission === "denied") return { ok: false, text: "Alerts are blocked for Levromart. Allow notifications in your browser's site settings, then tap the button." };
  if (Notification.permission !== "granted") return { ok: false, text: "Alerts are off. Tap the button to turn them on." };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? { ok: true, text: "Alerts are on for this phone." } : { ok: false, text: "Alerts are allowed but this phone isn't registered yet. Tap the button to fix it." };
  } catch (_) { return { ok: false, text: "Couldn't check alerts on this phone." }; }
}
async function levroTestPush(btn) {
  if (!session) { showLogin(); return; }
  if (!pushSupported()) { showToast("This browser can't receive alerts when the app is closed.", "error"); return; }
  const label = btn?.innerHTML; if (btn) { btn.disabled = true; btn.textContent = "Working…"; }
  try {
    if (Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { showToast("Alerts are blocked. Allow notifications in your browser's site settings.", "info"); return; }
    }
    if (isIos() && !isStandalone()) { showToast("On iPhone, add Levromart to your Home Screen first.", "info"); return; }
    const reg = await navigator.serviceWorker.ready;
    // Start from a fresh registration so a stale one can't swallow the alert.
    const old = await reg.pushManager.getSubscription();
    if (old) { try { await old.unsubscribe(); } catch (_) {} }
    await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    await syncPushSubscription(reg);
    const { data: { session: fresh } } = await sb.auth.getSession();
    const res = await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test-push", accessToken: fresh?.access_token || session.access_token }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "The test could not be sent.");
    const n = out.sent || 0;
    showToast(n ? `Test alert sent to ${n} device${n === 1 ? "" : "s"}. Lock your phone and wait a few seconds.` : "No device accepted the alert. Open Settings on this phone and try again.", n ? "success" : "error");
  } catch (err) {
    showToast(err?.message || "Couldn't run the check.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = label; }
    levroPaintPushStatus();
  }
}
async function levroPaintPushStatus() {
  const el = byId("pushCheckStatus"); if (!el) return;
  const st = await levroPushStatus();
  el.textContent = st.text; el.classList.toggle("push-ok", st.ok);
}
async function enablePushNotifications() {
  if (!pushSupported()) { showToast("Push notifications are not supported on this browser.", "error"); return; }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      byId("notifPromptModal")?.classList.add("hidden");
      try { localStorage.setItem("levromart-notif-prompt-v2", JSON.stringify({ deniedUntil: Date.now() + 24*60*60*1000 })); } catch (_) {}
      if (permission === "denied") showToast("Notifications are blocked. Allow them from your browser/site settings when ready.", "info");
      return;
    }
    if (isIos() && !isStandalone()) {
      showToast("On iPhone, add Levromart to your Home Screen first, then turn notifications on.", "info");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    await syncPushSubscription(reg);
    try { localStorage.removeItem("levromart-notif-prompt-v2"); localStorage.removeItem("medris-notif-dismissed"); } catch (_) {}
    byId("notifPromptModal")?.classList.add("hidden");
    if (dismissibleModalId === "notifPromptModal") dismissibleModalId = null;
    showToast("Notifications turned on.", "success");
  } catch (err) {
    showToast(err?.message || "Couldn't turn on notifications on this device.", "error");
  }
}

