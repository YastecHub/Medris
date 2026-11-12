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
    try { lvPushTipsOnce(); } catch (_) {}
  } catch (err) {
    showToast(err?.message || "Couldn't turn on notifications on this device.", "error");
  }
}


// ---------- "Make alerts pop up at the top" (Android) ----------
// Android decides how a web alert is shown from the phone's own notification settings for the app, which a website cannot change.
// These are the settings that make alerts arrive reliably and pop up on screen, even when Levromart is closed.
function lvIsAndroid() { return /Android/i.test(navigator.userAgent || ""); }
function lvPushTips() {
  document.getElementById("lvPushTips")?.remove();
  const steps = [
    ["fa-mobile-screen", "Install Levromart", "In the browser menu choose \"Add to Home screen\" / \"Install app\", and open Levromart from that icon."],
    ["fa-bell", "Allow notifications", "Tap Allow when Levromart asks, or turn it on in your phone's site settings."],
    ["fa-arrow-up-right-from-square", "Set it to pop up", "Phone Settings > Apps > Levromart (or Chrome) > Notifications > choose \"Urgent\" / \"Pop on screen\" and allow sound."],
    ["fa-battery-full", "Don't let the phone sleep it", "Phone Settings > Apps > Levromart (or Chrome) > Battery > choose \"Unrestricted\"."],
    ["fa-moon", "Do Not Disturb", "Allow Levromart in your Do Not Disturb exceptions so alerts still come through."]
  ];
  const el = document.createElement("div"); el.id = "lvPushTips"; el.className = "tm-page";
  el.innerHTML = '<div class="tm-wrap"><div class="tm-top"><button type="button" class="tm-back" data-x aria-label="Close"><i class="fa-solid fa-chevron-left"></i></button><div><h2 class="tm-title">Alerts that pop up</h2><p class="tm-sub">So you never miss an order or a message</p></div></div>' +
    steps.map((s, i) => '<div class="tm-card tm-row"><div class="tm-av" style="background:rgba(31,138,91,.14);color:#1f8a5b"><i class="fa-solid ' + s[0] + '"></i></div><div class="tm-grow"><div class="tm-name">' + (i + 1) + ". " + s[1] + '</div><div class="tm-sub" style="white-space:normal">' + s[2] + '</div></div></div>').join("") +
    '<button type="button" class="tm-btn block" id="lvPushTest"><i class="fa-regular fa-paper-plane"></i> Send me a test alert</button></div>';
  document.body.appendChild(el);
  el.querySelector("[data-x]").onclick = () => el.remove();
  byId("lvPushTest").onclick = function () { levroTestPush(this); };
}
// shown once, right after alerts are turned on, on Android
const lvPushTipsOnce = () => { try { if (lvIsAndroid() && !localStorage.getItem("lv-push-tips-seen")) { localStorage.setItem("lv-push-tips-seen", "1"); setTimeout(lvPushTips, 1200); } } catch (_) {} };
