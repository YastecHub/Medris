// ---------- ACCOUNT INTEGRITY ----------
// A deleted-and-recreated Supabase Auth account gets a new UUID even when the
// email address is identical. All buyer-owned tables use that UUID as a
// foreign key, so make sure the public.users anchor exists before any write.
let buyerProfileRepairPromise = null;
async function ensureCustomerProfile(errorEl = null) {
  if (!session?.user?.id) return false;
  if (buyerProfileRepairPromise) return buyerProfileRepairPromise;

  buyerProfileRepairPromise = (async () => {
    const userId = session.user.id;
    const { data: existing, error: readError } = await sb.from("users").select("id").eq("id", userId).maybeSingle();
    if (readError) {
      console.warn("Could not check buyer profile:", readError);
    }
    if (existing?.id) return true;

    // Primary repair path. This uses the authenticated access token on the
    // server, so the server can safely reconstruct the row from auth.users.
    try {
      const response = await fetch("/api/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ensure-profile", accessToken: session.access_token })
      });
      if (response.ok) {
        const { data: repaired } = await sb.from("users").select("id").eq("id", userId).maybeSingle();
        if (repaired?.id) return true;
      }
    } catch (e) {
      console.warn("Profile repair request failed:", e);
    }

    // Fallback for deployments where the server route is older/missing. The
    // RLS policy should allow an authenticated user to create/update only its
    // own profile row. This also makes the app self-healing for recreated IDs.
    try {
      const u = session.user || {};
      const meta = u.user_metadata || {};
      const recovered = {
        id: userId,
        name: meta.name || meta.full_name || u.email?.split("@")[0] || "Levromart user",
        email: (u.email || meta.email || "").includes("@accounts.levromart.app") ? null : (u.email || meta.email || null),
        phone: meta.phone || "",
        city: meta.city || "Lagos",
        role: meta.role === "vendor" ? "vendor" : "buyer",
        role_selected: true,
        has_password: true,
        avatar_url: meta.avatar_url || meta.picture || ""
      };
      const { data: restored } = await sb.from("users").upsert(recovered, { onConflict: "id" }).select("id").maybeSingle();
      if (restored?.id) return true;
    } catch (e) {
      console.warn("Client profile repair failed:", e);
    }

    if (errorEl) {
      errorEl.textContent = "Your account profile needs to be repaired. Please refresh the app and try again.";
      errorEl.classList.remove("hidden");
    }
    return false;
  })().finally(() => {
    buyerProfileRepairPromise = null;
  });

  return buyerProfileRepairPromise;
}

// Brand logo - embedded inline (data URI) so the whole app stays one file.
const LEVROMART_LOGO_LEFT = "{{inline-asset:levromart-logo-left.webp}}";
const LEVROMART_LOGO_CIRCLE = "{{inline-asset:levromart-splash-img.webp}}";

const LEVROMART_LOGO_RIGHT = "{{inline-asset:levromart-logo-right.webp}}";
const MEDRIS_LOGO = "{{inline-asset:medris-logo.webp}}";
function setLogoMask(el, url) {
  if (!el) return;
  const val = `url("${url}")`;
  el.style.webkitMaskImage = val;
  el.style.maskImage = val;
}
setLogoMask(document.getElementById("brandLogoLeft"), LEVROMART_LOGO_LEFT);
const brandLogoCircleEl = document.getElementById("brandLogoCircle");
if (brandLogoCircleEl) brandLogoCircleEl.src = LEVROMART_LOGO_CIRCLE;
// Branded loading indicator -- the logo sits still in the middle while two
// arcs chase each other around it, used anywhere the app is waiting on
// something (page navigation, payment confirmation) instead of plain
// "Loading…" text.
function brandSpinnerHtml(label) {
  return `<div class="brand-spinner-wrap"><div style="text-align:center;">
    <div class="brand-spinner">
      <img class="brand-spinner-logo" src="${LEVROMART_LOGO_CIRCLE}" alt="" />
      <svg class="brand-spinner-ring" viewBox="0 0 50 50">
        <circle class="brand-spinner-arc brand-spinner-arc-2" cx="25" cy="25" r="21"></circle>
        <circle class="brand-spinner-arc brand-spinner-arc-1" cx="25" cy="25" r="21"></circle>
      </svg>
    </div>
    ${label ? `<p class="muted" style="margin-top:0.9rem;">${esc(label)}</p>` : ""}
  </div></div>`;
}
setLogoMask(document.getElementById("brandLogoRight"), LEVROMART_LOGO_RIGHT);
document.getElementById("loginModalLogo").src = "{{inline-asset:levromart-splash-img.webp}}";
document.getElementById("aiChatFabLogo").src = MEDRIS_LOGO;
document.getElementById("tourLeviLogo").src = MEDRIS_LOGO;
document.getElementById("aiChatHeaderLogo").src = MEDRIS_LOGO;
// The favicon (and app icon, for search engines and browser tabs) uses the
// branded /icon-192.png set in the <head> instead -- MEDRIS_LOGO is a
// transparent glyph meant to sit on top of the app's own background, which
// looks washed out as a small tab icon against a plain white/dark backdrop.
document.getElementById("installModalLogo").src = MEDRIS_LOGO;

