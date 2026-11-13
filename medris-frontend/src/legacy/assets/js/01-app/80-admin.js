// ---------- ADMIN ----------
function isSuperAdmin() {
  return !!session?.user?.id && profile?.role === "admin" && profile?.is_super_admin === true;
}

const SUPER_ADMIN_ONLY_VIEWS = new Set([
  "adminPeople",
  "adminPanel",
  "adminMonthlyListings",
  "adminPasswordResets",
  "adminLog",
  "adminInventory",
  "adminUsers",
  "adminPayments",
  "adminWalletHistory",
  "adminR2Migration",
  "adminR2Optimize"
]);
// Login logs are the one exception: sub-admins can see them, only Reset
// Password / Inventory / everything else in this set is super-admin-only.

function openAdminNavSheet() {
  if (byId("adminNavSheet")) return;
  const seenTabs = new Set();
  const tabs = [...document.querySelectorAll(".admin-dash-tabs [data-admin-view]")].filter((b) => !b.classList.contains("hidden") && b.style.display !== "none" && !seenTabs.has(b.dataset.adminView) && seenTabs.add(b.dataset.adminView));
  // the sections, grouped by what they are for (each page appears once)
  const GROUPS = [["Money", ["adminPayments", "adminMonthlyListings", "adminDisputes"]], ["People", ["adminPeople", "adminPanel", "adminUsers"]], ["Messages and support", ["adminSupportRequests", "adminFeedback", "adminConversations"]], ["Records", ["adminLog", "adminAuthLogs"]], ["Content and storage", ["adminInventory", "adminCarousel", "adminR2Migration", "adminR2Optimize"]]];
  const itemHtml = (b) => `<button type="button" class="admin-nav-item${b.classList.contains("active") ? " active" : ""}${(b.querySelector(".dash-tab-dot:not(.hidden)") && /[1-9]/.test(b.querySelector(".dash-tab-dot:not(.hidden)").textContent)) ? " has-alert" : ""}" data-v="${esc(b.dataset.adminView)}">${b.innerHTML}</button>`;
  const used = new Set();
  let gridsHtml = GROUPS.map(([title, views]) => { const bs = views.map((v) => tabs.find((b) => b.dataset.adminView === v)).filter(Boolean); bs.forEach((b) => used.add(b)); return bs.length ? `<div class="admin-nav-grp">${esc(title)}</div><div class="admin-nav-grid">${bs.map(itemHtml).join("")}</div>` : ""; }).join("");
  const rest = tabs.filter((b) => !used.has(b)); if (rest.length) gridsHtml += `<div class="admin-nav-grp">More</div><div class="admin-nav-grid">${rest.map(itemHtml).join("")}</div>`;
  const wrap = document.createElement("div");
  wrap.id = "adminNavSheet"; wrap.className = "cc-backdrop";
  wrap.innerHTML = `<div class="cc-sheet admin-nav-sheet" role="dialog" aria-modal="true"><button type="button" class="cc-x" aria-label="Close" data-cc="close"><i class="fa-solid fa-xmark"></i></button><h3 style="margin:.2rem 0 .8rem;text-align:left;">Go to</h3>${gridsHtml}</div>`;
  document.body.appendChild(wrap);
  // red badges on the sections that are waiting for the admin: open disputes stay counted until every one is resolved
  const BADGES = { adminDisputes: Number(window.__adminDisputeCount || 0), adminPayments: Number(window.__lvPayPending || 0) };
  wrap.querySelectorAll(".admin-nav-item").forEach((it) => {
    const n = BADGES[it.dataset.v]; if (!n) return;
    it.style.position = "relative";
    it.insertAdjacentHTML("beforeend", `<i class="lv-nav-badge">${n > 9 ? "9+" : n}</i>`);
  });
  requestAnimationFrame(() => wrap.classList.add("open"));
  const close = () => { wrap.classList.remove("open"); setTimeout(() => wrap.remove(), 180); };
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.closest('[data-cc="close"]')) return close();
    const it = e.target.closest(".admin-nav-item"); if (it) { close(); navigate(it.dataset.v); }
  });
}
// the two storage tools live under one "Storage" section: Migration and Image size
function lvR2Tabs(active) {
  const t = (v, l) => `<button type="button" class="lv-r2-tab${v === active ? " on" : ""}" onclick="navigate('${v}')">${l}</button>`;
  return `<div class="lv-r2-tabs" role="tablist">${t("adminR2Migration", "Migration")}${t("adminR2Optimize", "Image size")}</div>`;
}
function adminNavHtml(active) {
  if (active === "adminCampuses") active = "adminPanel";
  if (active === "adminR2Optimize") active = "adminR2Migration";   // one Storage section with two tabs inside   // one Vendors section: applications and students/campuses live together
  const items = [
    ["adminPeople", "fa-users", "People"],
    ["adminPanel", "fa-user-check", "Vendors"],
    ["adminMonthlyListings", "fa-receipt", "Monthly listings"],
    ["adminDisputes", "fa-scale-balanced", "Disputes"],
    ["adminPayments", "fa-credit-card", "Payments"],
    ["adminSupportRequests", "fa-headset", "Support"],
    ["adminInventory", "fa-boxes-stacked", "Inventory"],
    ["adminFeedback", "fa-comment-medical", "Feedback"],
    ["adminLog", "fa-clock-rotate-left", "Admin log"],
    ["adminAuthLogs", "fa-right-to-bracket", "Login logs"],
    ["adminConversations", "fa-comments", "Conversations"],
    ["adminUsers", "fa-user-shield", "Admins"],
    ["adminCarousel", "fa-images", "Carousel"],
    ["adminR2Migration", "fa-cloud-arrow-up", "Storage"],
  ].filter(([view]) => isSuperAdmin() || !SUPER_ADMIN_ONLY_VIEWS.has(view));
  const cur = items.find(([v]) => v === active) || items[0];
  const picker = `<button type="button" class="admin-nav-pick" onclick="openAdminNavSheet()"><span class="admin-nav-pick-ico"><i class="fa-solid ${cur[1]}"></i></span><span class="admin-nav-pick-txt"><small>Admin section</small><b>${cur[2]}</b></span>${active!=="adminPayments"?`<span class="dash-tab-dot lv-pay-badge ap-pick-badge ${Number(window.__lvPayPending||0)?"":"hidden"}">${Number(window.__lvPayPending||0)>9?"9+":Number(window.__lvPayPending||0)}</span>`:""}<i class="fa-solid fa-chevron-down"></i></button>`;
  return picker + `<div class="dash-tabs admin-dash-tabs" hidden><div class="admin-dash-tabs-inner">${items.map(([view, icon, label]) => `<button class="dash-tab ${view === active ? "active" : ""}" data-admin-view="${view}" onclick="navigate('${view}')"><i class="fa-solid ${icon}"></i> ${label}${view === "adminFeedback" && unreadSuggestionCount > 0 ? `<span class="dash-tab-dot">${unreadSuggestionCount > 9 ? "9+" : unreadSuggestionCount}</span>` : view === "adminMonthlyListings" ? `<span class="dash-tab-dot monthly-listings-admin-badge ${Number(window.__monthlyPendingCount||0)?'':'hidden'}">${Number(window.__monthlyPendingCount || 0) > 9 ? "9+" : Number(window.__monthlyPendingCount || 0)}</span>` : view === "adminPayments" ? `<span class="dash-tab-dot lv-pay-badge ${Number(window.__lvPayPending||0)?'':'hidden'}">${Number(window.__lvPayPending || 0) > 9 ? "9+" : Number(window.__lvPayPending || 0)}</span>` : view === "adminPanel" ? `<span class="dash-tab-dot locked-vendors-admin-badge ${Number(window.__lockedVendorCount||0)?'':'hidden'}">${Number(window.__lockedVendorCount || 0) > 9 ? "9+" : Number(window.__lockedVendorCount || 0)}</span>` : ""}</button>`).join("")}</div></div>`;
}

