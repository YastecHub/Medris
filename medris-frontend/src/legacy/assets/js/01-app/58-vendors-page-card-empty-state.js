// ---------- VENDORS PAGE: card + empty state ----------
// Centred initials for vendors without a logo. Absolutely positioned so iOS Safari
// cannot push the letters down (percentage heights inside aspect-ratio boxes).
function vdInitialsHtml(name, key) {
  let hue = 150;
  try { hue = stableAvatarHue(key || name); } catch (_) {}
  return `<span class="vd-initials" style="--av-h:${hue}" aria-hidden="true"><span>${esc(initials(String(name || "V")))}</span></span>`;
}
// Square / tall logos are shown whole on a soft tint instead of being cropped and blown up.
function vdImgLoad(img) {
  if (img.naturalWidth && img.naturalHeight && img.naturalWidth / img.naturalHeight < 1.2) img.classList.add("vd-logo-fit");
}
function vdImgFail(img) {
  const html = vdInitialsHtml(img.dataset.n || "", img.dataset.k || "");
  img.insertAdjacentHTML("afterend", html);
  img.remove();
}
function vendorDirectoryCardHtml(v) {
  const id = String(v?.id || "");
  const name = v?.business_name || "Vendor";
  const sectorName = v?.sector_name || (Array.isArray(sectors) ? sectors.find((s) => String(s.id) === String(v?.sector_id))?.name : "") || "";
  const count = Number(v?.follower_count ?? window.__followerCountMemo?.get(id)?.n ?? 0);
  const km = typeof vendorDistanceKm === "function" ? vendorDistanceKm(v) : null;
  const dist = km == null ? "" : km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`;
  const showFollow = !(typeof isOwnVendorId === "function" && isOwnVendorId(v?.id));
  const recent = window.__vendorCardFollowRecent?.get(id);
  const following = recent && Date.now() - recent.at < 15000 ? !!recent.following : !!(session && window.followedVendorSet?.().has(id));
  const rating = Number(v?.avg_rating || 0), reviews = Number(v?.review_count || 0);
  const open = `navigate('storefront',{vendorId:'${esc(id)}'})`;
  // Aura luxe hub: show her initials instead of her uploaded logo (her request).
  const hideLogo = /^aura\s+lux/i.test(String(name).trim());
  const media = v?.logo_url && !hideLogo
    ? `<img src="${esc(v.logo_url)}" alt="" loading="lazy" decoding="async" draggable="false" data-n="${esc(name)}" data-k="${esc(id)}" onerror="vdImgFail(this)">`
    : vdInitialsHtml(name, id);
  return `<div class="vd-card" data-vendor-id="${esc(id)}" onclick="${open}" role="link" tabindex="0" aria-label="${esc(name)}" onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();${open};}">
    <div class="vd-cover">${media}<span data-vt="${esc(id)}" class="vd-verified" title="Verified vendor" aria-label="Verified vendor"><i class="fa-solid fa-check"></i></span></div>
    <div class="vd-body">
      <strong class="vd-name">${esc(name)}</strong>
      <span class="vd-loc"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${esc(v?.city || "Online")}${dist ? ` <b>·</b> ${esc(dist)}` : ""}</span>
      ${sectorName ? `<span class="vd-cat"><i class="fa-solid fa-layer-group" aria-hidden="true"></i> ${esc(sectorName)}</span>` : ""}
      ${showFollow ? `<button type="button" class="vendor-card-follow-btn vd-follow${following ? " following" : ""}" data-vendor-id="${esc(id)}" onclick="event.stopPropagation();toggleVendorCardFollow('${esc(id)}',event)">${following ? "Following" : "Follow"}</button>` : ""}
      <div class="vd-meta"><span class="vd-followers" role="button" tabindex="0" onclick="event.stopPropagation();openFollowerNetwork('${esc(id)}')"><i class="fa-solid fa-user-group" aria-hidden="true"></i> <span class="vendor-follower-count">${count.toLocaleString()}</span> follower${count === 1 ? "" : "s"}</span><span class="vd-rating"><i class="fa-solid fa-star" aria-hidden="true"></i> ${rating.toFixed(1)}${reviews ? ` <small>(${reviews})</small>` : ""}</span></div>
    </div>
  </div>`;
}

/* ---- Vendors page: cover-banner cards, dynamic category chips, three-dot menu ---- */
function vendorPageCardHtml(v, feat) {
  feat = feat === true;
  const id = String(v?.id || "");
  const name = v?.business_name || "Vendor";
  const sector = v?.sector_name || (Array.isArray(sectors) ? sectors.find((x) => String(x.id) === String(v?.sector_id))?.name : "") || "";
  const km = typeof vendorDistanceKm === "function" ? vendorDistanceKm(v) : null;
  const dist = km == null ? "" : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  const showFollow = !(typeof isOwnVendorId === "function" && isOwnVendorId(v?.id));
  const recent = window.__vendorCardFollowRecent?.get(id);
  const following = recent && Date.now() - recent.at < 15000 ? !!recent.following : !!(session && window.followedVendorSet?.().has(id));
  const rating = Number(v?.avg_rating || 0), reviews = Number(v?.review_count || 0);
  const open = `navigate('storefront',{vendorId:'${esc(id)}'})`;
  const hideLogo = /^aura\s+lux/i.test(String(name).trim());
  const logo = v?.logo_url && !hideLogo
    ? `<img src="${esc(v.logo_url)}" alt="" loading="lazy" decoding="async" draggable="false" data-n="${esc(name)}" data-k="${esc(id)}" onerror="vdImgFail(this)">`
    : vdInitialsHtml(name, id);
 const coverSrc = v?.cover_url || v?.cover_image_url || "";
  let hue = 150; { const k = String(id || name); let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0; hue = h % 360; }
  const BRAND = [["#19c486", "#0b6b47"], ["#6a3df0", "#4b2e83"], ["#ffc83d", "#ff9a3d"], ["#2f7df6", "#6a3df0"], ["#f2594a", "#c2379f"], ["#0f9d6a", "#4b2e83"]];
  const bc = BRAND[hue % BRAND.length];
  const tint = `style="background:radial-gradient(circle at 85% 0%,rgba(255,255,255,.28),transparent 55%),linear-gradient(135deg,${bc[0]},${bc[1]})"`;
  const banner = coverSrc
    ? `<img src="${esc(coverSrc)}" alt="" loading="lazy" decoding="async" draggable="false" onerror="this.remove()">`
    : "";
  const tags = [sector, ...(v?.categories || [])].filter(Boolean);
  const uniq = []; tags.forEach((t) => { if (!uniq.some((u) => u.toLowerCase() === String(t).toLowerCase())) uniq.push(t); });
  let tag = String(uniq[0] || "").trim();
  { const first = tag.split(/[.!?;\n]/)[0].trim() || tag; tag = first.length > 22 ? first.slice(0, 21).trimEnd() + "…" : (first.length < tag.length ? first + "…" : first); }
  const menuBtn = feat ? "" : `<button type="button" class="vc2-more" aria-label="More options" aria-haspopup="menu" onclick="event.stopPropagation();vc2OpenMenu(this,'${esc(id)}')"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></button>`;
  return `<div class="vc2 vc2-feat" data-vendor-id="${esc(id)}" onclick="${open}" role="link" tabindex="0" aria-label="${esc(name)}" onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();${open};}">
    <div class="vc2-banner" ${tint}>${banner}</div>
    ${menuBtn}
    <div class="vc2-logo">${logo}</div>
    <div class="vc2-body">
      <strong class="vc2-name">${esc(name)}</strong>
      <span class="vc2-meta"><span class="vc2-star"><i class="fa-solid fa-star" aria-hidden="true"></i> ${rating.toFixed(1)}${reviews ? ` <small>(${reviews})</small>` : ""}</span><b>·</b><span class="vc2-where">${esc(v?.city || "Online")}${dist ? ` · ${esc(dist)}` : ""}</span></span>
      <span class="vc2-tags">${tag ? `<em>${esc(tag)}</em>` : ""}</span>
    </div>
    <div class="vc2-actions">
      ${showFollow ? `<button type="button" class="vendor-card-follow-btn vd-follow vc2-follow${following ? " following" : ""}" data-vendor-id="${esc(id)}" onclick="event.stopPropagation();toggleVendorCardFollow('${esc(id)}',event)"><span>${following ? "Following" : "Follow"}</span></button>` : `<span class="vc2-own">Your shop</span>`}
    </div>
  </div>`;
}
function vc2OutClose(e) { if (e && e.type !== "scroll" && e.target && e.target.closest && e.target.closest("#vc2Menu")) return; vc2CloseMenu(); }
function vc2CloseMenu() { document.getElementById("vc2Menu")?.remove(); ["pointerdown", "touchstart", "scroll", "wheel", "resize"].forEach((t) => window.removeEventListener(t, vc2OutClose, true)); }
function vc2OpenMenu(btn, vendorId) {
  const had = document.getElementById("vc2Menu"); vc2CloseMenu(); if (had && had.dataset.for === vendorId) return;
  const r = btn.getBoundingClientRect();
  const m = document.createElement("div");
  m.id = "vc2Menu"; m.className = "vc2-menu"; m.dataset.for = vendorId; m.setAttribute("role", "menu");
  m.innerHTML = `<button type="button" role="menuitem" data-a="open"><i class="fa-solid fa-store"></i> View shop</button><button type="button" role="menuitem" data-a="share"><i class="fa-solid fa-share-nodes"></i> Share shop</button>`;
  m.style.top = Math.min(r.bottom + 6, window.innerHeight - 110) + "px";
  m.style.right = Math.max(8, window.innerWidth - r.right) + "px";
  m.onclick = (e) => { e.stopPropagation(); const a = e.target.closest("button")?.dataset.a; vc2CloseMenu(); if (a === "open") navigate("storefront", { vendorId }); else if (a === "share") openStorefrontShare(vendorId); };
  document.body.appendChild(m);
  setTimeout(() => ["pointerdown", "touchstart", "scroll", "wheel", "resize"].forEach((t) => window.addEventListener(t, vc2OutClose, { capture: true, passive: true })), 0);
}
// "All categories" picture: a small lilac badge with four tiles (same round picture style as the category pictures).
const LV_ALL_CATS_ART = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9b8ff"/><stop offset="1" stop-color="#7c5cf0"/></linearGradient></defs><circle cx="32" cy="32" r="32" fill="url(#g)"/><rect x="15" y="15" width="15" height="15" rx="4.5" fill="#fff"/><rect x="34" y="15" width="15" height="15" rx="4.5" fill="#fff" opacity=".7"/><rect x="15" y="34" width="15" height="15" rx="4.5" fill="#fff" opacity=".7"/><rect x="34" y="34" width="15" height="15" rx="4.5" fill="#fff"/></svg>');

function renderVendorCatChips() {
  const host = byId("vendorCatChips"); if (!host) return;
  const vendors = Array.isArray(window.__allVendors) ? window.__allVendors : [];
  const used = new Map();
  vendors.forEach((v) => { if (v.sector_id != null) used.set(String(v.sector_id), (used.get(String(v.sector_id)) || 0) + 1); });
  const list = (Array.isArray(sectors) ? sectors : []).filter((s) => used.has(String(s.id)));
  const sel = String(byId("vendorSectorFilter")?.value || "");
  if (!list.length) { host.innerHTML = ""; host.hidden = true; return; }
  host.hidden = false;
  list.sort((a, b) => used.get(String(b.id)) - used.get(String(a.id)) || String(a.name).localeCompare(String(b.name)));
  // Use the exact same illustrated category artwork as the Home category rail.
  // The Vendors rail is only a presentation change; the existing sector filter
  // and click behavior remain unchanged.
  const allArt = levroSectorArt({name:"All"});
  host.innerHTML = `<button type="button" class="vd-chip vd-chip-all${sel === "" ? " active" : ""}" aria-pressed="${sel === ""}" onclick="vendorCatChipPick('')"><span class="vd-chip-art"><img src="${LV_ALL_CATS_ART}" alt="" aria-hidden="true" decoding="async"></span><span>All categories</span></button>` + list.map((s) => { const art = levroSectorArt(s); return `<button type="button" class="vd-chip${sel === String(s.id) ? " active" : ""}" style="--cc:${esc(levroSectorColor(s))}" aria-pressed="${sel === String(s.id)}" onclick="vendorCatChipPick('${esc(s.id)}')"><span class="vd-chip-art"><img src="${art}" alt="" aria-hidden="true" loading="lazy" decoding="async"></span><span>${esc(s.name)}</span></button>`; }).join("");
}
function vendorCatChipPick(id) {
  const el = byId("vendorSectorFilter"); if (!el) return;
  el.value = String(id || "");
  filterVendorsDirectory();
}
function vendorDirectorySkeletonHtml() {
  return Array.from({ length: 6 }, () => `<div class="vd-card vd-skel" aria-hidden="true"><div class="vd-cover"></div><div class="vd-body"><span class="vd-skel-line"></span><span class="vd-skel-line vd-w60"></span><span class="vd-skel-line vd-w40"></span></div></div>`).join("");
}
function vendorDirectoryEmptyHtml(filtered) {
  return `<div class="vd-empty" aria-live="polite"><span class="vd-empty-ico"><i class="fa-solid fa-store"></i></span><strong>No vendors found</strong><p>Try changing your filters or search area.</p>${filtered ? `<button type="button" class="vd-clear" onclick="clearVendorsDirectoryFilters()">Clear filters</button>` : ""}</div>`;
}
function clearVendorsDirectoryFilters() {
  const input = byId("vendorSearchInput"); if (input) input.value = "";
  ["vendorSectorFilter", "vendorCityFilter", "vendorCategoryFilter"].forEach((id) => { const el = byId(id); if (el) el.value = ""; });
  setVendorsListingFilter("all");
}

function setVendorsListingFilter(filter) {
  vendorsListingFilter = ["all", "buy", "rent", "both"].includes(filter) ? filter : "all";
  document.querySelectorAll("#vendorsListingTabs [data-filter]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === vendorsListingFilter);
  });
  filterVendorsDirectory();
}

function toggleVendorsFilters(force) {
  const panel = byId("vendorsFiltersPanel");
  if (!panel) return;
  const next = typeof force === "boolean" ? force : panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !next);
  const btn = byId("vendorsFiltersToggle");
  if (btn) {
    btn.setAttribute("aria-expanded", String(next));
    btn.classList.toggle("active", next);
  }
}

function renderVendorsDirectory() {
  let html = `<div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
    <h2 style="margin:0;"><i class="fa-solid fa-store"></i> All vendors</h2>
    <div class="flex" style="gap:0.5rem;">
      <button class="btn btn-sm btn-outline active" id="vendorsViewListBtn" onclick="switchVendorsView('list')" title="List view" aria-label="List view" aria-pressed="true"><i class="fa-solid fa-grip"></i></button>
      <button class="btn btn-sm btn-outline" id="vendorsViewMapBtn" onclick="switchVendorsView('map')" title="Map view" aria-label="Map view" aria-pressed="false"><i class="fa-solid fa-map-location-dot"></i></button>
    </div>
  </div>`;
  html += `<div class="vendor-listing-tabs" id="vendorsListingTabs" role="tablist" aria-label="Vendor type">
    <button type="button" class="vendor-listing-tab active" data-filter="all" onclick="setVendorsListingFilter('all')">All vendors</button>
    <button type="button" class="vendor-listing-tab" data-filter="buy" onclick="setVendorsListingFilter('buy')">Buy</button>
    <button type="button" class="vendor-listing-tab" data-filter="rent" onclick="setVendorsListingFilter('rent')">Rent</button>
    <button type="button" class="vendor-listing-tab" data-filter="both" onclick="setVendorsListingFilter('both')">Buy &amp; Rent</button>
  </div>
  <div class="vendors-directory-toolbar vendors-directory-controls">
    <button type="button" class="btn btn-sm btn-outline vendors-filters-toggle" id="vendorsFiltersToggle" aria-expanded="false" onclick="toggleVendorsFilters()" aria-label="Filter">${window.LV_FILTER_SVG}</button>
  </div>
  <div class="vendors-directory-search">
    <input type="text" id="vendorSearchInput" placeholder="Search vendors or products…" oninput="filterVendorsDirectory()" autocomplete="off" aria-label="Search vendors or products" />
  </div>
  <div class="vendors-filters-panel hidden" id="vendorsFiltersPanel"><div class="lm-sheet-head"><strong>Filter vendors</strong><button type="button" class="lm-x" onclick="toggleVendorsFilters(false)" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
    <div class="vendors-filter-grid">
      <label>Sector<select id="vendorSectorFilter" onchange="filterVendorsDirectory()"><option value="">All sectors</option></select></label>
      <label>City<select id="vendorCityFilter" onchange="filterVendorsDirectory()"><option value="">All cities</option></select></label>
      <label>Category<select id="vendorCategoryFilter" onchange="filterVendorsDirectory()"><option value="">Known for: anything</option></select></label>
    </div>
  </div>`;
  html += `<div class="grid" id="vendorsGrid"><p class="muted">Loading…</p></div>`;
  html += `<div id="vendorsMapWrap" class="hidden">
    <div class="vmap-card">
      <div id="vendorsMap" style="background:var(--border);position:relative;isolation:isolate;z-index:0;"></div>
      <p id="vendorsMapStatus" class="vmap-status"></p>
    </div>
  </div>`;
  setTimeout(async () => {
    try {
      // cards from the last visit appear at once; the fresh list then replaces them only if something changed
      if (Array.isArray(window.__allVendors) && window.__allVendors.length) { try { filterVendorsDirectory(); } catch (_) {} }
      await loadVendorsDirectory();
      if (buyerDistanceAutoEnabled) scheduleAutomaticLocationRefresh();
      else updateVendorsLocationUI();
    } catch (err) {
      console.warn("[Levromart] Vendor directory failed:", err);
      const grid = byId("vendorsGrid");
      if (grid) grid.innerHTML = errorStateHtml(err);
      updateVendorsLocationUI();
    }
  }, 0);
  return html;
}

async function attachVendorFollowerCounts(vendors) {
  const rows = Array.isArray(vendors) ? vendors : [];
  if (!rows.length || typeof sb === "undefined") return rows;
  try {
    const ids = [...new Set(rows.map(v => v?.id).filter(Boolean))];
    if (!ids.length) return rows;
    // Remember counts for 3 minutes so the same vendors are not re-counted on every render.
    const memo = (window.__followerCountMemo ||= new Map());
    const stale = ids.filter((id) => { const h = memo.get(String(id)); return !h || Date.now() - h.at > 600000; });
    if (stale.length) {
      const { data, error } = await sb.rpc("get_vendor_follower_counts", { p_vendor_ids: stale });
      if (error) throw error;
      (data || []).forEach((r) => memo.set(String(r.vendor_id), { n: Number(r.follower_count || 0), at: Date.now() }));
      stale.forEach((id) => { if (!memo.has(String(id))) memo.set(String(id), { n: 0, at: Date.now() }); });
    }
    const counts = new Map(ids.map((id) => [String(id), memo.get(String(id))?.n ?? 0]));
    return rows.map(v => ({ ...v, follower_count: counts.get(String(v.id)) ?? 0 }));
  } catch (err) {
    console.warn("[Levromart] Could not hydrate vendor follower counts:", err);
    return rows.map(v => ({ ...v, follower_count: Number(v?.follower_count || 0) }));
  }
}

async function loadVendorsDirectory() {
  // Vendor discovery must remain usable even when an optional enrichment
  // query (products, packages, sectors, follower counts) is temporarily slow
  // or unavailable. The vendor list itself is the primary page content.
  // the extra lists (products, packages) are asked for at the same moment as the vendors, not one after the other
  const __enrichStart = Promise.allSettled([
    sb.from("products").select("vendor_id, name, description, listing_type, is_service, category:categories(name)").eq("status", "active"),
    sb.from("vendor_packages").select("vendor_id, name, description").eq("status", "active"),
  ]);
  const vendorResult = await sb.from("vendors")
    .select("id, business_name, city, avg_rating, review_count, sector_id, logo_url, cover_url, cover_image_url, lat, lng")
    .eq("verification_status", "verified")
    .eq("is_active", true)
    .order("business_name");

  if (vendorResult.error) {
    // Keep the last successful directory in memory instead of replacing a
    // usable vendor page with a generic error block during a transient retry.
    if (Array.isArray(window.__allVendors) && window.__allVendors.length) {
      window.__filteredVendors = vendorDirectorySortList
        ? vendorDirectorySortList(window.__allVendors)
        : window.__allVendors;
      renderVendorDirectoryCards?.();
      return window.__allVendors;
    }
    throw vendorResult.error;
  }

  const vendors = vendorResult.data || [];

  // These enrichments are useful for search/filtering but must never prevent
  // the verified vendor directory from rendering.
  // show the cards straight away from the vendor list itself; search words, categories and counts fill in right after
  if (!(Array.isArray(window.__allVendors) && window.__allVendors.length)) {
    window.__allVendors = vendors.map((v) => ({ ...v, categories: [], searchText: String(v.business_name || "").toLowerCase(), canBuy: true, canRent: false, follower_count: 0 }));
    try { filterVendorsDirectory(); } catch (_) {}
  }
  const [[productsRes, packagesRes], sectorsRes] = await Promise.all([
    __enrichStart,
    Promise.allSettled([sectors.length ? Promise.resolve({ data: sectors, error: null }) : levroData.catalogue.sectors("sort_order")]).then((r) => r[0]),
  ]);

  const products = productsRes.status === "fulfilled" && !productsRes.value?.error ? (productsRes.value.data || []) : [];
  const vendorPackages = packagesRes.status === "fulfilled" && !packagesRes.value?.error ? (packagesRes.value.data || []) : [];
  const sectorsData = sectorsRes.status === "fulfilled" && !sectorsRes.value?.error ? (sectorsRes.value.data || []) : [];
  if (!sectors.length && sectorsData.length) sectors = sectorsData;

  const catsByVendor = {};
  const productTextByVendor = {};
  const capabilitiesByVendor = {};
  products.forEach((p) => {
    const cap = (capabilitiesByVendor[p.vendor_id] ||= { canBuy: false, canRent: false });
    if (["sale", "both"].includes(p.listing_type)) cap.canBuy = true;
    if (["rent", "both"].includes(p.listing_type)) cap.canRent = true;
    const name = p.category?.name;
    if (name) (catsByVendor[p.vendor_id] ||= new Set()).add(name);
    (productTextByVendor[p.vendor_id] ||= []).push(p.name, p.description, name);
  });
  vendorPackages.forEach((pkg) => {
    (productTextByVendor[pkg.vendor_id] ||= []).push(pkg.name, pkg.description, "package", "bundle");
  });

  window.__allVendors = await attachVendorFollowerCounts(vendors.map((v) => ({
    ...v,
    categories: [...(catsByVendor[v.id] || [])],
    searchText: [v.business_name, ...(productTextByVendor[v.id] || [])].filter(Boolean).join(" ").toLowerCase(),
    canBuy: !!capabilitiesByVendor[v.id]?.canBuy,
    canRent: !!capabilitiesByVendor[v.id]?.canRent,
  })));

  const sectorSel = byId("vendorSectorFilter");
  if (sectorSel) {
    // Deliberately does NOT pre-select whatever sector was last tapped on
    // Home -- that's independent, page-local state on Home's own category
    // rail, not a filter the Vendors directory should silently inherit. A
    // vendor arriving here from a Home sector with few/no verified vendors
    // would otherwise land on what looks like a broken, empty page with no
    // visible reason why.
    sectorSel.innerHTML = '<option value="">All sectors</option>' + sectors.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  }
  const citySel = byId("vendorCityFilter");
  if (citySel) {
    const cities = [...new Set(vendors.map((v) => v.city).filter(Boolean))].sort();
    citySel.innerHTML = '<option value="">All cities</option>' + cities.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }
  const catSel = byId("vendorCategoryFilter");
  if (catSel) {
    const allCats = [...new Set(Object.values(catsByVendor).flatMap((s) => [...s]))].sort();
    catSel.innerHTML = '<option value="">Known for: anything</option>' + allCats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }
  filterVendorsDirectory();
  enhanceSelectsIn(byId("app"));
  return window.__allVendors;
}
function filterVendorsDirectory() {
  const search = (byId("vendorSearchInput")?.value || "").trim().toLowerCase();
  const sectorId = byId("vendorSectorFilter")?.value || "";
  const city = byId("vendorCityFilter")?.value || "";
  const category = byId("vendorCategoryFilter")?.value || "";
  let list = window.__allVendors || [];
  if (vendorsListingFilter === "buy") list = list.filter((v) => v.canBuy);
  if (vendorsListingFilter === "rent") list = list.filter((v) => v.canRent);
  if (vendorsListingFilter === "both") list = list.filter((v) => v.canBuy && v.canRent);
  if (search) list = list.filter((v) => (v.searchText || "").includes(search));
  if (sectorId) list = list.filter((v) => v.sector_id === sectorId);
  if (city) list = list.filter((v) => v.city === city);
  if (category) list = list.filter((v) => v.categories.includes(category));
  if (buyerLocation) {
    list = [...list].sort((a, b) => {
      const da = a.lat != null ? haversineKm(buyerLocation.lat, buyerLocation.lng, a.lat, a.lng) : Infinity;
      const db = b.lat != null ? haversineKm(buyerLocation.lat, buyerLocation.lng, b.lat, b.lng) : Infinity;
      return da - db;
    });
  } else {
    list = deterministicHourlyShuffle(list, `vendors-directory:${vendorsListingFilter}:${sectorId}:${city}:${category}:${search}`);
  }
  window.__filteredVendors = list;
  const grid = byId("vendorsGrid");
  if (grid) {
    const __gridHtml = list.length ? list.map(vendorCardHtml).join("") : '<div class="empty-state">No vendors match that search.</div>';
    if (grid.__lvHtml !== __gridHtml) { grid.innerHTML = __gridHtml; grid.__lvHtml = __gridHtml; }   // unchanged list: leave the cards alone
  }
  if (vendorsViewMode === "map") renderVendorsMap();
}

async function showDistancesInVendorsList() {
  // First use is an explicit one-time opt-in. After success the preference is
  // persisted, so this control disappears on future refreshes unless the
  // browser/device location permission has been revoked.
  if (!buyerDistanceAutoEnabled) {
    showLocationPrompt("first-use");
    return false;
  }
  return enableAutomaticDistances();
}

function updateVendorsLocationUI() {
  // Distances are intentionally unobtrusive: when automatic location is enabled
  // the vendor cards own their distance chips. Do not render a status/banner here.
  const el = byId("vendorsLocationAction");
  if (el) el.remove();
}

let vendorsViewMode = "list";
let vendorsMap = null;
let vendorsMapMarkers = [];
function switchVendorsView(mode) {
  mode = mode === "map" ? "map" : "list";
  vendorsViewMode = mode;
  const listBtn = byId("vendorsViewListBtn");
  const mapBtn = byId("vendorsViewMapBtn");
  listBtn?.classList.toggle("active", mode === "list");
  mapBtn?.classList.toggle("active", mode === "map");
  listBtn?.setAttribute("aria-pressed", String(mode === "list"));
  mapBtn?.setAttribute("aria-pressed", String(mode === "map"));
  byId("vendorsGrid")?.classList.toggle("hidden", mode !== "list");
  byId("vendorsMapWrap")?.classList.toggle("hidden", mode !== "map");
  // renderVendorsMap() loads Leaflet and builds the map asynchronously.
  // Returning that promise lets a caller that actually needs the map ready
  // (the tour's onEnter, in particular) await it instead of moving on
  // while it's still mid-flight -- which is exactly what let the tour
  // race ahead to a later step and then have this step's map try to
  // attach to a #vendorsMap element that had already been torn down,
  // throwing Leaflet's "Map container not found".
  if (mode === "map") return renderVendorsMap();
}

function addVendorsMapRecenterControl(map) {
  if (map.__levroRecenterControl) return;
  const RecenterControl = window.L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const btn = window.L.DomUtil.create("button", "vendors-map-recenter-control");
      btn.type = "button";
      btn.title = "Recenter on my location";
      btn.setAttribute("aria-label", "Recenter map on my location");
      btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i>';
      window.L.DomEvent.disableClickPropagation(btn);
      window.L.DomEvent.on(btn, "click", async (e) => {
        window.L.DomEvent.stop(e);
        btn.classList.add("is-loading");
        try {
          let loc = buyerLocation;
          if (!loc) loc = await requestCustomerLocation(true);
          else if (buyerDistanceAutoEnabled) loc = await requestCustomerLocation(true);
          if (loc) {
            map.setView([loc.lat, loc.lng], Math.max(map.getZoom(), 13), { animate: true, duration: 0.45 });
          }
        } catch (err) {
          showToast(err?.message || "Unable to get your location.", "error");
        } finally {
          btn.classList.remove("is-loading");
        }
      });
      return btn;
    }
  });
  map.addControl(new RecenterControl());
  map.__levroRecenterControl = true;
}

async function renderVendorsMap() {
  const mapEl = byId("vendorsMap");
  const statusEl = byId("vendorsMapStatus");
  if (!mapEl) return;
  try {
    await loadLeaflet();
  } catch (err) {
    mapEl.innerHTML = `<p class="muted" style="padding:1rem;">${esc(err.message)}</p>`;
    return;
  }

  let center = [6.5244, 3.3792]; // Lagos, used until/unless we know better
  let zoom = 11;
  if (buyerLocation) {
    center = [buyerLocation.lat, buyerLocation.lng];
    zoom = 13;
    if (statusEl) statusEl.textContent = "Showing vendors near you, closest first.";
  } else if (statusEl) {
    statusEl.textContent = buyerDistanceAutoEnabled && locationSharingEnabled
      ? "Loading vendors near you…"
      : "Showing all vendors on the map. Tap the location button to find you.";
  }

  const list = (window.__filteredVendors || []).filter((v) => v.lat != null && v.lng != null && lvVendorVisible(v.id));   // campus view: only vendors that serve the chosen campus

  if (!vendorsMap) {
    vendorsMap = window.L.map("vendorsMap", { attributionControl: true, zoomControl: true, zoomControlOptions: { position: "topleft" }, zoomSnap: 0.5, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, inertia: true }).setView(center, zoom);
    // Remove the "Leaflet" attribution prefix but retain the required OSM credit.
    vendorsMap.attributionControl.setPrefix(false);
    addBasemapTileLayer(vendorsMap);
    addVendorsMapRecenterControl(vendorsMap);
    requestAnimationFrame(() => requestAnimationFrame(() => vendorsMap?.invalidateSize(true)));
    setTimeout(() => vendorsMap?.invalidateSize(true), 120);
  } else {
    // Do not reset the user's map position every time filters/location refresh.
    // The recenter control is the explicit way to jump back to the customer.
    const refreshMapSize = () => {
      if (!vendorsMap || byId("vendorsMapWrap")?.classList.contains("hidden")) return;
      vendorsMap.invalidateSize(true);
    };
    requestAnimationFrame(() => { requestAnimationFrame(refreshMapSize); });
    setTimeout(refreshMapSize, 80);
    setTimeout(refreshMapSize, 300);
  }

  vendorsMapMarkers.forEach((m) => vendorsMap.removeLayer(m));
  vendorsMapMarkers = [];

  if (buyerLocation) {
    const primaryColor = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#3fb97f";
    const me = window.L.marker([buyerLocation.lat, buyerLocation.lng], { icon: window.L.divIcon({ className: "vmp-me", html: '<span class="vmp-me-pulse"></span><span class="vmp-me-dot"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 500 }).addTo(vendorsMap);
    me.bindPopup("You are here");
    vendorsMapMarkers.push(me);
  }

  list.forEach((v) => {
    const dist = buyerLocation ? formatDistanceKm(haversineKm(buyerLocation.lat, buyerLocation.lng, v.lat, v.lng)) : "";
    const marker = window.L.marker([v.lat, v.lng], { icon: vendorDirectoryMapIcon(v), riseOnHover: true }).addTo(vendorsMap);
    marker._levromartVendorId = v.id;
    const vendorName = esc(v.business_name || "Vendor");
    const vendorLogo = v.logo_url
      ? `<img class="vendor-map-popup-avatar" src="${esc(v.logo_url)}" alt="" loading="lazy" draggable="false" onerror="this.classList.add('is-broken');this.style.display='none';" />`
      : avatarFallbackHtml(v.business_name || "Vendor", "38px", "vendor-map-popup-avatar vendor-map-popup-avatar-fallback", v.business_name || "Vendor");
    const popupMeta = `${`★ ${Number(v.avg_rating ?? 0).toFixed(1)} (${Number(v.review_count ?? 0)})`}${dist ? ` · ${dist}` : ""}`;
    marker.bindPopup(`<div class="vendor-map-popup"><div class="vendor-map-popup-head">${vendorLogo}<div class="vendor-map-popup-copy"><strong>${vendorName}</strong>${popupMeta ? `<span>${esc(popupMeta)}</span>` : ""}</div></div><a class="vendor-map-popup-link" href="#" onclick="navigate('storefront',{vendorId:'${v.id}'});return false;">View storefront</a></div>`);
    marker.on("click", () => { try { window.traceVendorRoute?.(v); } catch (_) {} });
    vendorsMapMarkers.push(marker);
  });

  const pendingFocusId=window.__pendingVendorMapFocusId;
  if(pendingFocusId){
    window.__pendingVendorMapFocusId=null;
    setTimeout(()=>{try{window.focusVendorOnMap?.(pendingFocusId);}catch(_){ }},120);
  }

  if (statusEl && list.length === 0) statusEl.textContent = "None of the vendors matching your filters have set a shop location yet.";
  if (!buyerLocation && buyerDistanceAutoEnabled && locationSharingEnabled && vendorsMap) {
    requestCustomerLocation(true).then((loc)=>{
      if (!loc || currentView !== "vendors" || !vendorsMap) return;
      if (statusEl) statusEl.textContent = "Showing vendors near you, closest first.";
      renderVendorsMap().catch(()=>{});
    }).catch(()=>{ if(statusEl) statusEl.textContent = "Showing all vendors on the map. Tap the location button to try again."; });
  }

  if (list.length > 1 && !buyerLocation && vendorsMap && vendorsMapMarkers.length) {
    const vendorLayers = vendorsMapMarkers.filter((m) => m && typeof m.getLatLng === "function");
    if (vendorLayers.length > 1) {
      const bounds = window.L.latLngBounds(vendorLayers.map((m) => m.getLatLng()));
      if (bounds.isValid()) vendorsMap.fitBounds(bounds.pad(0.12), { animate: false, maxZoom: 15 });
    }
  }
}

