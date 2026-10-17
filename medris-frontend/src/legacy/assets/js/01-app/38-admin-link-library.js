// ---------- ADMIN LINK LIBRARY ----------
// One private, searchable source of truth for internal carousel destination URLs.
// These are generated from the current origin/pathname so admins never need to
// hand-edit links when the app is moved between domains/environments.
const ADMIN_LINK_LIBRARY_ENTRIES = [
  { label: "Browse Everything", description: "Open the main marketplace catalogue.", url: () => buildLevromartDeepLink("home", {}, "browse") },
  { label: "Cart", description: "Open the shopping cart.", url: () => buildLevromartDeepLink("cart") },
  { label: "Featured Products", description: "Open the homepage product discovery area.", url: () => buildLevromartDeepLink("home", {}, "products") },
  { label: "Vendor Leaderboard", description: "Open the weekly vendor leaderboard.", url: () => buildLevromartDeepLink("leaderboard") },
  { label: "Apply to be a Vendor", description: "Open the vendor application form.", url: () => buildLevromartDeepLink("vendorApply") },
  { label: "Messages", description: "Open the messages inbox.", url: () => buildLevromartDeepLink("messages") },
  { label: "My Shop", description: "Open the vendor's shop management area.", url: () => buildLevromartDeepLink("vendorDashboard") },
  { label: "Notifications", description: "Open the notifications panel.", url: () => buildLevromartDeepLink("notifications") },
  { label: "Orders", description: "Open the appropriate orders area for the signed-in account.", url: () => buildLevromartDeepLink("orders") },
  { label: "Packages", description: "Open the homepage packages catalogue.", url: () => buildLevromartDeepLink("home", {}, "packages") },
  { label: "Profile", description: "Open the signed-in user's profile panel.", url: () => buildLevromartDeepLink("profile") },
  { label: "Request an Item", description: "Open the customer request flow.", url: () => buildLevromartDeepLink("requestEquipment") },
  { label: "Services", description: "Open the homepage services catalogue.", url: () => buildLevromartDeepLink("home", {}, "services") },
  { label: "Settings", description: "Open application settings.", url: () => buildLevromartDeepLink("settings") },
  { label: "Support Request", description: "Open the support request page.", url: () => buildLevromartDeepLink("supportRequest") },
  { label: "Top Rated Vendors", description: "Open the vendor directory/map.", url: () => buildLevromartDeepLink("vendors") },
  { label: "Vendor Directory / Map", description: "Open Vendors with the map as the default view.", url: () => buildLevromartDeepLink("vendors", { map: "1" }) },
  { label: "Wishlist", description: "Open the saved-items wishlist.", url: () => buildLevromartDeepLink("wishlist") },
  { label: "Admin Panel", description: "Open the admin vendor-approval dashboard.", url: () => buildLevromartDeepLink("adminPanel") },
  { label: "Admin Carousel", description: "Open carousel management.", url: () => buildLevromartDeepLink("adminCarousel") },
  { label: "Admin Link Library", description: "Open the admin destination-link library.", url: () => buildLevromartDeepLink("adminLinkLibrary") },
  { label: "People", description: "Open the admin people directory.", url: () => buildLevromartDeepLink("adminPeople") },
  { label: "Finance", description: "Open admin finance tools.", url: () => buildLevromartDeepLink("adminFinance") },
  { label: "Disputes", description: "Open admin disputes.", url: () => buildLevromartDeepLink("adminDisputes") },
  { label: "Feedback", description: "Open admin feedback and suggestions.", url: () => buildLevromartDeepLink("adminFeedback") },
  { label: "Vendor Support", description: "Open vendor-support tools.", url: () => buildLevromartDeepLink("vendorSuggestionsInbox") },
];

function buildLevromartDeepLink(view, params = {}, section = "") {
  const u = new URL(location.href);
  u.search = "";
  u.hash = "";
  if (view === "notifications" || view === "profile") {
    u.searchParams.set("levro", view);
  } else if (view === "orders") {
    u.searchParams.set("levro", "orders");
  } else {
    u.searchParams.set("levro", view);
    Object.entries(params || {}).forEach(([k,v]) => { if (v != null && v !== "") u.searchParams.set(k, String(v)); });
  }
  if (section) u.searchParams.set("section", section);
  return u.toString();
}

function copyAdminLinkFromRow(button) {
  const row = button?.closest?.(".admin-link-row");
  const input = row?.querySelector?.(".admin-link-url");
  if (!input) return false;
  return copyAdminLink(input.value, button, input);
}
async function copyAdminLink(url, button, sourceInput = null) {
  if (!isCarouselAdmin()) return false;
  const text = String(url || "");
  if (!text) return false;
  const done = () => {
    const old = button?.innerHTML;
    if (button) { button.innerHTML = '<i class="fa-solid fa-check"></i> Copied'; button.disabled = true; }
    showToast("Link copied to clipboard.", "success");
    setTimeout(() => {
      if (button) { button.innerHTML = old || '<i class="fa-solid fa-copy"></i> Copy'; button.disabled = false; }
    }, 1400);
    return true;
  };
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return done();
    }
  } catch (_) {}
  try {
    let input = sourceInput;
    let temporary = false;
    if (!input) {
      input = document.createElement("textarea");
      temporary = true;
      input.value = text;
      input.setAttribute("readonly","");
      Object.assign(input.style,{position:"fixed",left:"-9999px",top:"0",opacity:"0"});
      document.body.appendChild(input);
    }
    input.focus();
    input.select();
    input.setSelectionRange(0,input.value.length);
    let copied = false;
    try { copied = !!document.execCommand("copy"); } catch (_) {}
    if (temporary) input.remove();
    if (copied) return done();
  } catch (_) {}
  try { sourceInput?.focus(); sourceInput?.select(); sourceInput?.setSelectionRange(0,sourceInput.value.length); } catch (_) {}
  showToast("The link is ready to select and copy.", "info");
  return false;
}

function handleAdminDeepLinkClick(event, href) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  try {
    const u = new URL(href, window.location.origin);
    const deepView = u.searchParams.get("levro");
    const section = u.searchParams.get("section") || "";
    if (!deepView) return false;
    const params = {};
    u.searchParams.forEach((value,key)=>{ if(key!=="levro" && key!=="section") params[key]=value; });
    if (deepView === "profile") { closeAllPanels(); openProfileOrShop(); return false; }
    if (deepView === "notifications") { closeAllPanels(); lastNotificationReturnView = currentView || "home"; navigate("notifications", {}, true); return false; }
    if (deepView === "home") {
      Promise.resolve(navigate("home", {}, true)).then(()=>{
        requestAnimationFrame(()=>{
          const target =
            section === "vendors" ? document.querySelector("#app .top-rated-vendors-scroll") :
            document.querySelector("#app #browseSection");
          target?.scrollIntoView({behavior:"smooth",block:"start"});
        });
      }).catch(()=>{});
      return false;
    }
    const routes = new Set([
      "cart","messages","vendorDashboard","vendorProducts","vendorPackages","vendorOrders",
      "vendorEditProfile","vendorRequests","settings","supportRequest","vendors","leaderboard","vendorApply","wishlist",
      "adminPanel","adminCarousel","adminLinkLibrary","adminInventory","adminPeople","adminFinance","adminCampuses",
      "adminDisputes","adminSupportRequests","adminFeedback","adminUsers","adminLog",
      "vendorSuggestionsInbox","requestEquipment","buyerOrders","orderHistory","productDetail","packageDetail","storefront"
    ]);
    if (!routes.has(deepView)) return false;
    if (!session && !["vendors","productDetail","packageDetail","storefront"].includes(deepView)) { showLogin(); return false; }
    Promise.resolve(navigate(deepView, params, true)).then(()=>{
      if(deepView==="vendors" && params.map==="1") setTimeout(()=>{try{switchVendorsView("map")}catch(_){}},120);
    }).catch(()=>{});
  } catch (_) {}
  return false;
}

function renderAdminLinkLibrary() {
  if (!isCarouselAdmin()) return '<div class="empty-state">Access denied.</div>';
  const entries = ADMIN_LINK_LIBRARY_ENTRIES.map(e => ({...e, resolvedUrl: e.url()})).sort((a,b) => a.label.localeCompare(b.label));
  const rows = entries.map((e) => `<div class="admin-link-row" data-admin-link-label="${esc(e.label.toLowerCase())}">
    <div class="admin-link-copy"><strong>${esc(e.label)}</strong><small>${esc(e.description)}</small><div class="admin-link-url-wrap"><input class="admin-link-url" type="url" readonly value="${esc(e.resolvedUrl)}" aria-label="${esc(e.label)} URL" onclick="this.select()" onfocus="this.select()"><a class="admin-link-open" href="${esc(e.resolvedUrl)}" onclick="return handleAdminDeepLinkClick(event,this.href)" aria-label="Open ${esc(e.label)}"><i class="fa-solid fa-arrow-up-right-from-square"></i></a></div></div>
    <button type="button" class="btn btn-sm admin-link-copy-btn" onclick="copyAdminLinkFromRow(this)"><i class="fa-solid fa-copy"></i> Copy</button>
  </div>`).join("");
  return `<div class="instant-page-shell admin-link-library">
    <div><h2 style="margin-bottom:.25rem;"><i class="fa-solid fa-link"></i> Link Library</h2><p class="muted" style="margin:0;">Admin-only destination links for carousel banners and other promotional artwork. Copy a link and paste it into the carousel's Link URL field.</p></div>
    <div class="card" style="padding:0 1rem;">
      <div class="admin-link-library-search"><div class="field-wrap"><i class="fa-solid fa-magnifying-glass"></i><input id="adminLinkLibrarySearch" type="search" placeholder="Search links…" autocomplete="off" oninput="filterAdminLinkLibrary()"></div></div>
      <div id="adminLinkLibraryCount" class="admin-link-library-count" style="padding:.15rem 0 .4rem;">${entries.length} links</div>
      <div id="adminLinkLibraryRows">${rows}</div>
      <div id="adminLinkLibraryEmpty" class="admin-link-empty hidden">No matching links.</div>
    </div>
    <div class="flex" style="justify-content:flex-start;gap:.55rem;flex-wrap:wrap;">
      <button class="btn btn-sm btn-outline" onclick="copyAllAdminLinks()"><i class="fa-solid fa-copy"></i> Copy all links</button>
      <button class="btn btn-sm btn-outline" onclick="navigate('adminCarousel')"><i class="fa-solid fa-images"></i> Carousel manager</button>
    </div>
  </div>`;
}

function filterAdminLinkLibrary() {
  const q = String(byId("adminLinkLibrarySearch")?.value || "").trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll("#adminLinkLibraryRows .admin-link-row").forEach(row => {
    const match = !q || String(row.dataset.adminLinkLabel || "").includes(q);
    row.classList.toggle("hidden", !match); if (match) visible++;
  });
  const count = byId("adminLinkLibraryCount"); if (count) count.textContent = `${visible} link${visible === 1 ? "" : "s"}`;
  byId("adminLinkLibraryEmpty")?.classList.toggle("hidden", visible !== 0);
}

async function copyAllAdminLinks() {
  if (!isCarouselAdmin()) return;
  const links = ADMIN_LINK_LIBRARY_ENTRIES.map(e => `${e.label}: ${e.url()}`).sort((a,b) => a.localeCompare(b));
  await copyAdminLink(links.join("\n"), null);
}

// Admin-only carousel management. All image mutations go through the existing
// homepage-carousel Supabase Storage bucket and the homepage_carousel_slides table.
function carouselStoragePathForUpload(file) {
  const ext = (String(file?.name || "jpg").split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `slides/${crypto.randomUUID()}.${ext || "jpg"}`;
}
function isCarouselAdmin() { return !!session?.user?.id && profile?.role === "admin"; }

async function renderAdminCarousel() {
  if (!isCarouselAdmin()) return '<div class="empty-state">Access denied.</div>';
  const { data: slides, error } = await sb.from("homepage_carousel_slides")
    .select("id,storage_path,image_url,link_url,alt_text,sort_order,is_active,created_at,updated_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  let html = `<h2><i class="fa-solid fa-images"></i> Homepage carousel</h2>${adminNavHtml("adminCarousel")}`;
  if (error) html += errorStateHtml(error);
  html += `<div class="card admin-carousel-manager">
    <div><h3 style="margin:0 0 .25rem;">Manage promotional banners</h3><p class="muted" style="margin:0;">Tap a banner to view its details. Drag the handle to change the order. Replacing an image keeps the banner in the same position.</p></div>
    <div class="admin-carousel-add">
      <h4 style="margin:0 0 .7rem;"><i class="fa-solid fa-cloud-arrow-up"></i> Add a new banner</h4>
      <div class="admin-carousel-form-grid">
        <label class="admin-carousel-file full">Banner image<input type="file" id="adminCarouselNewFile" accept="image/jpeg,image/png,image/webp,image/gif" /></label>
        <div><label>Alt text</label><input id="adminCarouselNewAlt" maxlength="180" placeholder="Describe this banner" /></div>
        <div><label>Display order</label><input id="adminCarouselNewOrder" type="number" min="0" step="1" value="100" /></div>
        <div class="full"><label>Optional link URL</label><input id="adminCarouselNewLink" type="url" placeholder="https://… (optional)" /></div>
      </div>
      <div class="flex" style="justify-content:flex-end;margin-top:.4rem;"><button class="btn" id="adminCarouselAddBtn" onclick="addAdminCarouselSlide()"><i class="fa-solid fa-plus"></i> Add banner</button></div>
    </div>
    <div class="flex" style="justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;">
      <strong>${(slides || []).length} saved banner${(slides || []).length === 1 ? "" : "s"}</strong>
      <button class="btn btn-sm btn-outline" onclick="publishBundledCarouselSlides()"><i class="fa-solid fa-cloud-arrow-up"></i> Publish the 6 bundled banners</button>
    </div>
  </div>`;

  if (!slides?.length) {
    html += `<div class="card empty-state"><i class="fa-solid fa-images" style="display:block;font-size:2rem;margin-bottom:.6rem;"></i>No database banners yet. The six bundled Levromart banners are currently shown on the homepage. Publish them here to make them fully editable from this page.</div>`;
  } else {
    html += `<div class="admin-carousel-list" id="adminCarouselList">`;
    html += slides.map((s, i) => {
      const sid = esc(s.id);
      const title = esc(s.alt_text || `Banner ${i + 1}`);
      return `<div class="admin-carousel-item" draggable="true" data-carousel-admin-id="${sid}">
        <div class="admin-carousel-summary" onclick="toggleAdminCarouselDetails('${sid}',event)">
          <button type="button" class="admin-carousel-drag" title="Drag to reorder" aria-label="Drag to reorder" onclick="event.stopPropagation()"><i class="fa-solid fa-grip-vertical"></i></button>
          <div class="admin-carousel-thumb"><img src="${esc(s.image_url || "")}" alt="${title}" loading="lazy" onerror="this.style.opacity='.25'"></div>
          <div class="admin-carousel-summary-copy">
            <h4>${title}</h4>
            <p>Order ${Number(s.sort_order ?? 0)} · ${s.storage_path ? "Stored image" : "Bundled asset"}</p>
          </div>
          <span class="admin-carousel-status">${s.is_active ? "Active" : "Hidden"}</span>
          <i class="fa-solid fa-chevron-down admin-carousel-chevron" aria-hidden="true"></i>
        </div>
        <div class="admin-carousel-details">
          <div class="admin-carousel-meta">
            <label>Alt text<input id="adminCarouselAlt_${sid}" maxlength="180" value="${esc(s.alt_text || "")}" /></label>
            <label>Link URL<input id="adminCarouselLink_${sid}" type="url" value="${esc(s.link_url || "")}" placeholder="Optional" /></label>
            <label>Display order<input id="adminCarouselOrder_${sid}" type="number" min="0" step="1" value="${Number(s.sort_order ?? 0)}" /></label>
            <div class="admin-carousel-actions">
              <button class="btn btn-sm" onclick="saveAdminCarouselSlide('${sid}')"><i class="fa-solid fa-floppy-disk"></i> Save</button>
              <label class="btn btn-sm btn-outline" style="cursor:pointer;margin:0;"><i class="fa-solid fa-image"></i> Replace image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none" onchange="replaceAdminCarouselImage(event,'${sid}')"></label>
              <button class="btn btn-sm btn-outline" onclick="toggleAdminCarouselSlide('${sid}',${!s.is_active})"><i class="fa-solid ${s.is_active ? "fa-eye-slash" : "fa-eye"}"></i> ${s.is_active ? "Hide" : "Show"}</button>
              <button class="btn btn-sm btn-danger" onclick="deleteAdminCarouselSlide('${sid}')"><i class="fa-solid fa-trash"></i> Delete</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join("");
    html += `</div>`;
  }

  setTimeout(() => initAdminCarouselDragDrop(), 0);
  return html;
}

function toggleAdminCarouselDetails(id, event) {
  if (event?.target?.closest?.(".admin-carousel-drag")) return;
  const card = document.querySelector(`.admin-carousel-item[data-carousel-admin-id="${CSS.escape(String(id))}"]`);
  if (card) card.classList.toggle("open");
}

let adminCarouselDraggedId = null;

function initAdminCarouselDragDrop() {
  const list = byId("adminCarouselList");
  if (!list || list.dataset.dragReady === "1") return;
  list.dataset.dragReady = "1";

  list.querySelectorAll(".admin-carousel-item").forEach(card => {
    card.addEventListener("dragstart", (e) => {
      adminCarouselDraggedId = card.dataset.carouselAdminId;
      card.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", adminCarouselDraggedId);
      }
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      list.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target"));
      adminCarouselDraggedId = null;
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (card.dataset.carouselAdminId !== adminCarouselDraggedId) card.classList.add("drop-target");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
    card.addEventListener("drop", async (e) => {
      e.preventDefault();
      card.classList.remove("drop-target");
      const dragged = list.querySelector(`.admin-carousel-item[data-carousel-admin-id="${CSS.escape(String(adminCarouselDraggedId || ""))}"]`);
      if (!dragged || dragged === card) return;
      const rect = card.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      list.insertBefore(dragged, before ? card : card.nextSibling);
      await persistAdminCarouselOrder();
    });
  });
}

async function persistAdminCarouselOrder() {
  if (!isCarouselAdmin()) return;
  const list = byId("adminCarouselList");
  if (!list) return;
  const cards = [...list.querySelectorAll(".admin-carousel-item")];
  const updates = cards.map((card, index) => ({ id: card.dataset.carouselAdminId, sort_order: (index + 1) * 10 }));
  try {
    for (const row of updates) {
      const { error } = await sb.from("homepage_carousel_slides")
        .update({ sort_order: row.sort_order, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) throw error;
    }
    levroCacheClear("carousel");
    cards.forEach((card, index) => {
      const order = (index + 1) * 10;
      const input = card.querySelector('input[id^="adminCarouselOrder_"]');
      if (input) input.value = String(order);
      const summary = card.querySelector(".admin-carousel-summary-copy p");
      if (summary) {
        const kind = summary.textContent.includes("Stored image") ? "Stored image" : "Bundled asset";
        summary.textContent = `Order ${order} · ${kind}`;
      }
    });
    showToast("Carousel order updated.", "success");
  } catch (e) {
    console.error(e);
    showToast(e?.message || "Could not save carousel order.", "error");
  }
}

async function addAdminCarouselSlide() {
  if (!isCarouselAdmin()) return;
  const file = byId("adminCarouselNewFile")?.files?.[0];
  if (!file) { showToast("Choose a banner image first.", "error"); return; }
  if (!file.type?.startsWith("image/")) { showToast("Please choose an image file.", "error"); return; }
  const btn = byId("adminCarouselAddBtn"); if (btn) btn.disabled = true;
  try {
    const path = `homepage-carousel/${carouselStoragePathForUpload(file)}`;
    let uploadBlob = file;
    try { if (typeof window.compressImage === "function") uploadBlob = await window.compressImage(file, { maxWidth: 1920, maxHeight: 1080 }); } catch (_) {}
    const publicUrl = await uploadToR2(uploadBlob, path, uploadBlob.type || file.type);
    const payload = { storage_path: path, image_url: publicUrl, alt_text: String(byId("adminCarouselNewAlt")?.value || file.name).trim().slice(0,180), link_url: String(byId("adminCarouselNewLink")?.value || "").trim() || null, sort_order: Math.max(0, Number(byId("adminCarouselNewOrder")?.value || 100)), is_active: true, created_by: session.user.id };
    levroCacheClear("carousel"); const { error } = await sb.from("homepage_carousel_slides").insert(payload);
    if (error) throw error;
    showToast("Banner added.", "success");
    navigate("adminCarousel", {}, { replace: true });
  } catch (e) { console.error(e); showToast(e?.message || "Could not add banner.", "error"); }
  finally { if (btn) btn.disabled = false; }
}

async function saveAdminCarouselSlide(id) {
  if (!isCarouselAdmin()) return;
  const alt_text = String(byId(`adminCarouselAlt_${id}`)?.value || "").trim().slice(0,180) || null;
  const link_url = String(byId(`adminCarouselLink_${id}`)?.value || "").trim() || null;
  const sort_order = Math.max(0, Number(byId(`adminCarouselOrder_${id}`)?.value || 0));
  levroCacheClear("carousel"); const { error } = await sb.from("homepage_carousel_slides").update({ alt_text, link_url, sort_order, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) { showToast(error.message, "error"); return; }
  showToast("Banner updated.", "success");
  navigate("adminCarousel", {}, { replace: true });
}

async function toggleAdminCarouselSlide(id, active) {
  if (!isCarouselAdmin()) return;
  levroCacheClear("carousel"); const { error } = await sb.from("homepage_carousel_slides").update({ is_active: !!active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) { showToast(error.message, "error"); return; }
  showToast(active ? "Banner is now visible." : "Banner hidden.", "success");
  navigate("adminCarousel", {}, { replace: true });
}

async function replaceAdminCarouselImage(event, id) {
  if (!isCarouselAdmin()) return;
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  if (!file.type?.startsWith("image/")) {
    showToast("Please choose an image file.", "error");
    return;
  }

  const card = document.querySelector(`.admin-carousel-item[data-carousel-admin-id="${CSS.escape(String(id))}"]`);
  card?.classList.add("admin-carousel-uploading");
  if (input) input.disabled = true;

  try {
    let uploadBlob = file;
    try {
      if (typeof window.compressImage === "function") {
        uploadBlob = await window.compressImage(file, { maxWidth: 1920, maxHeight: 1080 });
      }
    } catch (_) {}

    const storagePath = carouselStoragePathForUpload(file);
    const uploaded = await uploadCarouselImage(uploadBlob, storagePath, uploadBlob.type || file.type);

    const { error: updateError } = await sb.from("homepage_carousel_slides")
      .update({
        storage_path: uploaded.storagePath,
        image_url: `${uploaded.url}${uploaded.url.includes("?") ? "&" : "?"}v=${Date.now()}`,
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    if (updateError) throw updateError;

    levroCacheClear("carousel");
    showToast("Banner image replaced.", "success");
    navigate("adminCarousel", {}, { replace: true });
  } catch (e) {
    console.error("[Levromart] Carousel replacement failed:", e);
    showToast(String(e?.message || "").trim() || "Could not replace the banner image. Please try again.", "error");
  } finally {
    if (input) input.disabled = false;
    card?.classList.remove("admin-carousel-uploading");
    if (input) input.value = "";
  }
}

async function deleteAdminCarouselSlide(id) {
  if (!isCarouselAdmin()) return;
  if (!(await showConfirmDialog("Delete this homepage banner permanently?", { title: "Delete banner", okLabel: "Delete", danger: true }))) return;
  try {
    const { data: row, error: readError } = await sb.from("homepage_carousel_slides").select("storage_path").eq("id", id).maybeSingle();
    if (readError) throw readError;
    levroCacheClear("carousel"); const { error } = await sb.from("homepage_carousel_slides").delete().eq("id", id);
    if (error) throw error;
    if (row?.storage_path) {
      try { await sb.storage.from("homepage-carousel").remove([row.storage_path]); } catch (_) {}
    }
    showToast("Banner deleted.", "success");
    navigate("adminCarousel", {}, { replace: true });
  } catch (e) { console.error(e); showToast(e?.message || "Could not delete banner.", "error"); }
}

async function publishBundledCarouselSlides() {
  if (!isCarouselAdmin()) return;
  const { data: existing, error: readError } = await sb.from("homepage_carousel_slides").select("image_url");
  if (readError) { showToast(readError.message, "error"); return; }
  const existingUrls = new Set((existing || []).map(x => x.image_url));
  const rows = INITIAL_HOME_CAROUSEL_SLIDES.filter(s => !existingUrls.has(s.image_url)).map(s => ({ image_url:s.image_url, storage_path:null, alt_text:s.alt_text, sort_order:s.sort_order, is_active:true, created_by:session.user.id }));
  if (!rows.length) { showToast("The bundled banners are already published.", "info"); return; }
  const { error } = await sb.from("homepage_carousel_slides").insert(rows);
  if (error) { showToast(error.message, "error"); return; }
  showToast(`${rows.length} bundled banner${rows.length === 1 ? "" : "s"} published.`, "success");
  navigate("adminCarousel", {}, { replace: true });
}

