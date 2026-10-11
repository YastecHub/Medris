// ---------- TOASTS + CONFIRM DIALOG (replace native alert/confirm) ----------
// A raw browser/JS error ("TypeError: Load failed", "Failed to fetch") is
// meaningless to a buyer and reads as the app being broken -- dozens of
// catch blocks across the app pass error.message straight through here, so
// this is the one place that can catch all of them and swap in something a
// person actually understands, while the real error still goes to console
// for anyone debugging.
function sanitizeToastMessage(message, type) {
  const raw = String(message ?? "").trim();
  const looksTechnical = !raw
    || /^(TypeError|ReferenceError|SyntaxError|RangeError|Error|DOMException|AbortError)\s*:/i.test(raw)
    || /load failed|failed to fetch|network\s*error|networkerror|is not defined|is not a function|cannot read propert|undefined is not|null is not/i.test(raw);
  if (!looksTechnical) return raw;
  if (raw) console.warn("[Levromart] Technical error shown to user, sanitized:", raw);
  return type === "error" ? "Something went wrong. Check your connection and try again." : raw || "Something went wrong.";
}
// Distinct icon + colour per notification type, replacing the generic "i".
function notificationSystemIconHtml(n) {
  const T = String(n?.type || ""), title = String(n?.title || "");
  const G = "#3fb97f", B = "#2563eb", R = "#dc2626", A = "#d97706", V = "#7c3aed", GR = "#64748b";
  const map = {
    order_placed: ["fa-bag-shopping", G], new_order: ["fa-cart-plus", G],
    order_cancelled_by_vendor: ["fa-ban", R], request_cancelled: ["fa-ban", R],
    order_reminder: ["fa-clock", A], order_note: ["fa-note-sticky", B], order_updated: ["fa-pen-to-square", B],
    payment_received: ["fa-money-bill-wave", "#16a34a"], payment_confirmed: ["fa-circle-check", "#16a34a"],
    manual_payment_reported: ["fa-hand-holding-dollar", V], service_payment_reported: ["fa-hand-holding-dollar", V],
    payment_unresolved_24h: ["fa-hourglass-half", R], new_dispute: ["fa-scale-balanced", R],
    new_message: ["fa-message", B], incoming_call: ["fa-phone-volume", G], missed_call: ["fa-phone-slash", R], admin_alert: ["fa-shield-halved", V], admin_action_alert: ["fa-shield-halved", V],
    admin_inventory_product_deleted: ["fa-trash-can", R],
    vendor_approved: ["fa-store", "#16a34a"], vendor_rejected: ["fa-store-slash", R], vendor_deleted: ["fa-store-slash", R],
    vendor_renamed: ["fa-signature", B], new_vendor: ["fa-store", B], vendor_application_submitted: ["fa-file-signature", B],
    new_review: ["fa-star", "#f59e0b"], new_request: ["fa-hand", V], new_offer: ["fa-handshake", B],
    offer_accepted: ["fa-circle-check", "#16a34a"], offer_declined: ["fa-circle-xmark", R],
    service_offer_new: ["fa-handshake", B], service_offer_countered: ["fa-right-left", A],
    service_offer_accepted: ["fa-circle-check", "#16a34a"], service_offer_completed: ["fa-flag-checkered", "#16a34a"],
    monthly_listing_approved: ["fa-calendar-check", "#16a34a"], monthly_listing_submitted: ["fa-calendar-plus", B],
    account_suspended: ["fa-user-lock", R], account_unsuspended: ["fa-user-check", "#16a34a"],
    appeal_submitted: ["fa-envelope-open-text", A], password_reset_request: ["fa-key", A], promoted_admin: ["fa-user-shield", V],
    stock_alert: ["fa-box-open", A], product_wishlisted: ["fa-heart", R], product_comment: ["fa-comment", B],
    comment_liked: ["fa-thumbs-up", B], comment_reply: ["fa-reply", B], vendor_follow: ["fa-user-plus", B],
    vendor_follow_update: ["fa-bullhorn", G], points: ["fa-trophy", A], points_winner: ["fa-crown", A],
  };
  let hit = map[T];
  if (T === "order_status_changed") {
    hit = /cancel/i.test(title) ? ["fa-ban", R] : /complet/i.test(title) ? ["fa-circle-check", "#16a34a"]
      : /confirm/i.test(title) ? ["fa-clipboard-check", "#16a34a"] : /hand|deliver/i.test(title) ? ["fa-truck-fast", B]
      : /return/i.test(title) ? ["fa-rotate-left", A] : /unresolved/i.test(title) ? ["fa-hourglass-half", V] : /dispute/i.test(title) ? ["fa-scale-balanced", R] : ["fa-arrows-rotate", B];
  }
  if (!hit) hit = ["fa-bell", GR];
  return `<span class="notification-system-icon notif-type-icon" style="--nti:${hit[1]}"><i class="fa-solid ${hit[0]}"></i></span>`;
}
function showToast(message, type = "info") {
  playSound(type === "error" ? "error" : "notify");
  const wrap = byId("toastStack");
  if (!wrap) return;
  const __friendly = window.__levroClassifyBackendError ? window.__levroClassifyBackendError(message) : null;
  const displayMessage = __friendly ? __friendly.text : sanitizeToastMessage(message, type);
  const icon = __friendly ? __friendly.icon : type === "error" ? "fa-circle-exclamation" : type === "success" ? "fa-circle-check" : "fa-circle-info";
  let el = window.__activeToast;
  if (!el || !el.isConnected) {
    el = document.createElement("div");
    el.className = "toast";
    wrap.replaceChildren(el);
    window.__activeToast = el;
  } else {
    clearTimeout(window.__activeToastTimer);
    clearTimeout(window.__activeToastRemoveTimer);
    el.classList.remove("show");
  }
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${esc(displayMessage)}</span>`;
  requestAnimationFrame(() => el.classList.add("show"));
  window.__activeToastTimer = setTimeout(() => {
    el.classList.remove("show");
    window.__activeToastRemoveTimer = setTimeout(() => {
      if (el === window.__activeToast) window.__activeToast = null;
      el.remove();
    }, 300);
  }, __friendly ? 5200 : type === "error" ? 3600 : 2400);
}
// Shown the instant we're back from Paystack, before verify-payment even
// starts - otherwise there's a gap of a few seconds where the page just
// looks stuck instead of clearly "still working on it."
function showVerifyingPaymentScreen() {
  const app = byId("app");
  if (app) app.innerHTML = `<div class="empty-state">${brandSpinnerHtml("Confirming your payment…")}<p class="muted" style="font-size:0.85rem;">This only takes a moment. Please don't close this page.</p></div>`;
}

function showConfirmDialog(message, opts = {}) {
  return new Promise((resolve) => {
    const modal = byId("confirmModal");
    byId("confirmModalTitle").textContent = opts.title || "Please confirm";
    const msgEl = byId("confirmModalMsg");
    if (opts.html) msgEl.innerHTML = message;
    else msgEl.textContent = message;
    const okBtn = byId("confirmModalOk");
    const cancelBtn = byId("confirmModalCancel");
    okBtn.textContent = opts.okLabel || "Confirm";
    okBtn.className = opts.danger ? "btn btn-danger" : "btn";
    modal.classList.toggle("confirm-drawer", !!opts.html);
    modal.classList.remove("hidden");
    try { msgEl.scrollTop = 0; } catch (_) {}
    const cleanup = (result) => {
      modal.classList.add("hidden");
      setTimeout(() => modal.classList.remove("confirm-drawer"), 260);
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}
// Same idea as showConfirmDialog but collects a short piece of text (e.g. a
// mandatory reason) instead of a plain yes/no. Resolves the typed text, or
// null if cancelled.
function showTextPromptDialog(title, message, opts = {}) {
  return new Promise((resolve) => {
    const modal = byId("textPromptModal");
    byId("textPromptModalTitle").textContent = title || "Please confirm";
    byId("textPromptModalMsg").textContent = message || "";
    const input = byId("textPromptModalInput");
    input.value = "";
    input.placeholder = opts.placeholder || "";
    const okBtn = byId("textPromptModalOk");
    const cancelBtn = byId("textPromptModalCancel");
    okBtn.textContent = opts.okLabel || "Confirm";
    okBtn.className = opts.danger ? "btn btn-sm btn-danger" : "btn btn-sm";
    modal.classList.remove("hidden");
    const cleanup = (result) => {
      modal.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(input.value);
    const onCancel = () => cleanup(null);
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}
function syncLevromartLinkPreviewMeta(view = currentView, params = currentViewParams || {}) {
  const setMeta = (selector, content) => { const el=document.querySelector(selector); if(el && content) el.setAttribute('content', content); };
  const origin = location.origin || 'https://levromart.vercel.app';
  const productId = params?.productId || params?.product_id;
  const product = window.__lastRenderedProductPreview;
  const isProduct = view === 'productDetail' && productId && product?.id === productId;
  const title = isProduct ? `${product.name} | Levromart` : 'Levromart';
  const description = isProduct ? (String(product.description || '').trim().slice(0, 180) || 'Shop this product on Levromart.') : 'Rent or buy from verified vendors across Lagos: healthcare equipment, food, electronics, and more.';
  const image = isProduct && product.photos?.[0] ? product.photos[0] : 'https://pub-bc905d4e70404264a256cb3069953205.r2.dev/homepage-carousel/slides/f1b015da-408c-450d-93fb-0d9517b49e3e.png';
  const url = isProduct ? `${origin}${location.pathname}?product=${encodeURIComponent(productId)}` : `${origin}${location.pathname}`;
  setMeta('meta[property="og:title"]', title); setMeta('meta[property="og:description"]', description); setMeta('meta[property="og:url"]', url); setMeta('meta[property="og:image"]', image);
  setMeta('meta[name="twitter:title"]', title); setMeta('meta[name="twitter:description"]', description); setMeta('meta[name="twitter:image"]', image);
}
window.syncLevromartLinkPreviewMeta = syncLevromartLinkPreviewMeta;

function greetingWord() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function initials(name, email) {
  // NFKC folds fancy "script"/bold/full-width lookalike letters (common in
  // shop names) back to plain ones, and matching whole letters/digits keeps
  // us from slicing an emoji or surrogate pair in half (which showed as "?").
  const raw = String(name || email || "").trim();
  let s = raw;
  try { s = raw.normalize("NFKC"); } catch (_) {}
  const words = s.split(/\s+/).map((w) => (w.match(/[\p{L}\p{N}]/u) || [""])[0]).filter(Boolean);
  const ini = (words[0] || "") + (words[1] || "");
  if (ini) return ini.toUpperCase();
  const first = Array.from(raw)[0];
  return first ? first.toUpperCase() : "U";
}

function stableAvatarHue(value) {
  const text = String(value || "user");
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}
function avatarFallbackHtml(name, size = "2.6rem", extraClass = "", label = "", stableKey = "") {
  const safeName = String(name || "User").trim() || "User";
  const title = label || safeName;
  const initialsText = initials(safeName);
  const hue = stableAvatarHue(stableKey || safeName);
  return `<span class="avatar-circle avatar-fallback ${extraClass}" title="${esc(title)}" aria-label="${esc(title)}" style="width:${size};height:${size};--av-h:${hue};"><span aria-hidden="true">${esc(initialsText)}</span></span>`;
}
function profileAvatarHtml(url, name, size = "2.6rem", opts = {}) {
  const safeName = String(name || "User").trim() || "User";
  if (url) {
    const clickable = opts.lightbox ? ` role="button" tabindex="0" onclick="event.stopPropagation();openProfileImageLightbox('${esc(url)}','${esc(safeName)}',event)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();openProfileImageLightbox('${esc(url)}','${esc(safeName)}',event)}"` : "";
    return `<img src="${esc(url)}" class="avatar-circle ${opts.extraClass || ""}" style="width:${size};height:${size};object-fit:cover;" alt="${esc(safeName)}" data-lvimg onload="this.classList.add('lv-ld')" draggable="false" loading="lazy" decoding="async"${clickable} onerror="this.replaceWith(document.createRange().createContextualFragment(avatarFallbackHtml('${esc(safeName)}','${esc(size)}','${esc(opts.extraClass || "")}','${esc(safeName)}')))" />`;
  }
  return avatarFallbackHtml(safeName, size, opts.extraClass || "", safeName, opts.stableKey || safeName);
}
// Uploads a blob straight to R2 via a short-lived presigned URL (issued by
// /api/vendor-payments' r2-presign-upload action -- a dedicated /api/r2-upload
// file would have pushed this project's Vercel function count to 13, over
// the Hobby plan's 12-function cap, so it lives in the same router as every
// other payment/storage action here) instead of Supabase Storage --
// product photos, avatars, vendor logos, and the homepage carousel only.
// `key` must start with one of those four folder names; the server rejects
// anything else. Returns the final public URL to store on the row, same
// shape as the old sb.storage.from(...).getPublicUrl(...).data.publicUrl
// call it replaces.
async function uploadToR2(blob, key, contentType) {
  const type = contentType || blob.type || "application/octet-stream";
  const folder = String(key).split("/")[0];
  const rest = String(key).split("/").slice(1).join("/");
  // Same file, second route: Supabase Storage (the host the app already talks to). Used when the R2 upload route is slow
  // or blocked on a person's network, so photo uploads still go through instead of silently doing nothing.
  const viaSupabase = async () => {
    const p = sb.storage.from(folder).upload(rest, blob, { contentType: type, upsert: true, cacheControl: "31536000" });
    const r = await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Upload timed out. Check your connection and try again.")), 60000))]);
    if (r && r.error) throw new Error(r.error.message || "Upload failed.");
    const g = sb.storage.from(folder).getPublicUrl(rest);
    if (!g?.data?.publicUrl) throw new Error("Upload failed.");
    return g.data.publicUrl;
  };
  const canFallback = ["avatars", "vendor-logos", "product-photos", "homepage-carousel"].includes(folder) && !rest.startsWith("verification/");
  let r2Bad = false; try { r2Bad = sessionStorage.getItem("lv-r2-bad") === "1"; } catch (_) {}
  if (canFallback && r2Bad) { try { return await viaSupabase(); } catch (_) { /* fall through to R2 */ } }
  try {
    const tmo = (ms) => { try { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; } catch (_) { return undefined; } };
    const presignRes = await fetch("/api/vendor-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "r2-presign-upload", accessToken: session.access_token, key, contentType: type }),
      signal: tmo(15000),
    });
    const presignJson = await presignRes.json().catch(() => ({}));
    if (!presignRes.ok) throw new Error(presignJson.error || "Could not start the upload.");
    // The presigned URL was signed with this exact Cache-Control included, so the
    // PUT must send the same header back or the signature won't validate.
    const putHeaders = { "Content-Type": type };
    if (presignJson.cacheControl) putHeaders["Cache-Control"] = presignJson.cacheControl;
    const putMs = Math.max(25000, Math.round((blob.size || 0) / 25) );
    const putRes = await fetch(presignJson.uploadUrl, { method: "PUT", headers: putHeaders, body: blob, signal: tmo(putMs) });
    if (!putRes.ok) throw new Error("Upload to storage failed. Please try again.");
    try { sessionStorage.removeItem("lv-r2-bad"); } catch (_) {}
    return presignJson.publicUrl;
  } catch (err) {
    if (!canFallback) throw err;
    try { sessionStorage.setItem("lv-r2-bad", "1"); } catch (_) {}
    try { return await viaSupabase(); }
    catch (e2) { throw new Error((e2 && e2.message) || (err && err.message) || "Upload failed. Please try again."); }
  }
}

async function uploadCarouselImage(blob, storagePath, contentType) {
  const type = contentType || blob.type || "application/octet-stream";
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const url = await uploadToR2(blob, `homepage-carousel/${storagePath}`, type);
      if (url) return { url, storagePath, backend: "r2" };
    } catch (e) {
      lastError = e;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  try {
    const { error } = await sb.storage.from("homepage-carousel").upload(
      storagePath,
      blob,
      { cacheControl: "31536000", contentType: type, upsert: false }
    );
    if (error) throw error;
    const { data } = sb.storage.from("homepage-carousel").getPublicUrl(storagePath);
    if (!data?.publicUrl) throw new Error("Could not create the carousel image URL.");
    return { url: data.publicUrl, storagePath, backend: "supabase" };
  } catch (fallbackError) {
    const a = lastError?.message ? `R2: ${lastError.message}` : "";
    const b = fallbackError?.message ? `Supabase: ${fallbackError.message}` : "";
    throw new Error([a, b].filter(Boolean).join(" | ") || "Could not upload the carousel image.");
  }
}
function yearsSince(dateStr) {
  if (!dateStr) return null;
  const years = (Date.now() - new Date(dateStr).getTime()) / (365.25 * 24 * 3600 * 1000);
  if (years < 1) return "New this year";
  return `${Math.floor(years)}+ year${Math.floor(years) === 1 ? "" : "s"} on Levromart`;
}
const CATEGORY_ICONS = [
  // exact/near-exact matches for Levromart's real category names, most specific first
  [/blood pressure/i, "fa-gauge-high"],
  [/glucometer|glucose/i, "fa-droplet"],
  [/pulse oximeter|oximeter/i, "fa-wave-square"],
  [/thermometer|temperature/i, "fa-thermometer-half"],
  [/stethoscope/i, "fa-stethoscope"],
  [/nebulizer|inhaler/i, "fa-lungs"],
  [/suction/i, "fa-wind"],
  [/hospital bed|\bbed\b/i, "fa-bed-pulse"],
  [/wheelchair|mobility|crutch/i, "fa-wheelchair"],
  [/ecg|ekg|cardiac|electrocardio/i, "fa-heart-pulse"],
  [/ultrasound|x-ray|scan|imaging|diagnostic/i, "fa-x-ray"],
  [/monitor/i, "fa-display"],
  [/oxygen|ventilat|respirat/i, "fa-lungs"],
  [/surgical|surgery|theatre/i, "fa-syringe"],
  [/lab|laboratory/i, "fa-flask"],
  [/dental/i, "fa-tooth"],
  [/physio|rehab/i, "fa-dumbbell"],
  [/sterili|autoclave/i, "fa-pump-soap"],
  [/first aid|emergency/i, "fa-truck-medical"],
  [/basic tools?/i, "fa-toolbox"],
  [/clinical equipment/i, "fa-house-medical"],
  [/premium/i, "fa-star"],
  // other sectors
  [/rice|grain|produce|grocer/i, "fa-carrot"],
  [/snack/i, "fa-cookie-bite"],
  [/drink|juice|beverage/i, "fa-mug-hot"],
  [/meal|baked|bread/i, "fa-bread-slice"],
  [/phone|smartphone/i, "fa-mobile-screen-button"],
  [/charger|cable/i, "fa-plug"],
  [/laptop|computer/i, "fa-laptop"],
  [/television|\btv\b/i, "fa-tv"],
  [/generator|power/i, "fa-bolt"],
  [/sofa|chair|furniture/i, "fa-couch"],
  [/cookware|kitchen/i, "fa-utensils"],
  [/fridge|freezer/i, "fa-snowflake"],
  [/air condition|\bfan\b/i, "fa-fan"],
  [/wear|cloth/i, "fa-shirt"],
  [/footwear|shoe/i, "fa-shoe-prints"],
  [/skincare|makeup|beauty/i, "fa-spa"],
  [/catering/i, "fa-utensils"],
  [/photograph|video/i, "fa-camera"],
  [/repair|maintenance/i, "fa-screwdriver-wrench"],
  [/cleaning/i, "fa-broom"],
];

