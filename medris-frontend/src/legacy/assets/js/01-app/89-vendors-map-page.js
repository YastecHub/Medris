// ---------- VENDORS MAP PAGE: a whole screen for the map (search, categories, grouped pins, vendor cards, map styles) ----------
let vmpMap = null, vmpTiles = null, vmpLayer = null, vmpMe = null;
let vmpAll = [], vmpQuery = "", vmpSector = "", vmpSelected = "", vmpStyle = "";
const VMP_STYLES = {
  streets: { label: "Map", icon: "fa-route", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", sub: "abc", attr: "© OpenStreetMap contributors", max: 19 },
  night: { label: "Night", icon: "fa-moon", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", sub: "abc", attr: "© OpenStreetMap contributors", max: 19 },
  satellite: { label: "Satellite", icon: "fa-satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", sub: "", attr: "Imagery © Esri", max: 19 },
};
function vmpNorm(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim(); }
function vmpDistKm(v) { return buyerLocation && v.lat != null ? haversineKm(buyerLocation.lat, buyerLocation.lng, v.lat, v.lng) : null; }
function vmpDistText(km) { return km == null ? "" : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`; }
function vmpSectorOf(v) { return v?.sector_name || (Array.isArray(sectors) ? sectors.find((s) => String(s.id) === String(v?.sector_id))?.name : "") || ""; }
function vmpVisible() {
  const q = vmpNorm(vmpQuery);
  return vmpAll.filter((v) => (!vmpSector || vmpSectorOf(v) === vmpSector) && (!q || vmpNorm(`${v.business_name} ${vmpSectorOf(v)} ${v.city || ""}`).includes(q)));
}
function vmpTheme() { const t = document.documentElement.dataset.theme; return t === "dark" || t === "black" ? "night" : "streets"; }

function renderVendorsMapPage() {
  const mascot = window.lvMascotSvg || '<i class="fa-solid fa-robot"></i>';
  setTimeout(() => initVendorsMapPage(), 0);
  return `<div class="vmpage" id="vmPage">
    <div id="vmpMap" aria-label="Map of vendors"></div>
    <div class="vmp-top">
      <div class="vmp-bar">
        <button type="button" class="vmp-back" aria-label="Back to vendors" onclick="navigate('vendors')"><i class="fa-solid fa-chevron-left"></i></button>
        <i class="fa-solid fa-magnifying-glass vmp-bar-ic" aria-hidden="true"></i>
        <input id="vmpQ" type="search" autocomplete="off" placeholder="Search vendors on the map" oninput="vmpSearch(this.value)" onfocus="vmpSearch(this.value)" onkeydown="if(event.key==='Enter')vmpPickFirst()" />
        <button type="button" class="vmp-clear hidden" id="vmpClear" aria-label="Clear search" onclick="vmpSearch('',true)"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="vmp-sugg hidden" id="vmpSugg"></div>
      <div class="vmp-chips" id="vmpChips"></div>
    </div>
    <div class="vmp-fabs">
      <button type="button" class="vmp-fab" aria-label="Zoom in" onclick="vmpMap&&vmpMap.zoomIn()"><i class="fa-solid fa-plus"></i></button>
      <button type="button" class="vmp-fab" aria-label="Zoom out" onclick="vmpMap&&vmpMap.zoomOut()"><i class="fa-solid fa-minus"></i></button>
      <button type="button" class="vmp-fab vmp-fab-gap" id="vmpLocate" aria-label="My location" onclick="vmpLocate()"><i class="fa-solid fa-location-crosshairs"></i></button>
      <button type="button" class="vmp-fab" aria-label="Map style" onclick="vmpToggleStyles()"><i class="fa-solid fa-layer-group"></i></button>
      <div class="vmp-styles hidden" id="vmpStyles"></div>
    </div>
    <div class="vmp-bottom">
      <div class="vmp-buddy"><div class="vmp-buddy-m" aria-hidden="true">${mascot}</div><div class="vmp-buddy-b" id="vmpBuddy">Hi! Tap a pin or search a vendor, I'll show you the way.</div></div>
      <div class="vmp-rail" id="vmpRail"></div>
    </div>
  </div>`;
}

function vmpLayout() {
  const page = byId("vmPage"); if (!page) return;
  const nav = byId("bottomNav");
  const top = Math.max(0, page.getBoundingClientRect().top);
  let bottom = 0;
  if (nav && getComputedStyle(nav).display !== "none") {
    const r = nav.getBoundingClientRect();
    if (r.width >= window.innerWidth * 0.5) bottom = Math.max(0, window.innerHeight - r.top);
  }
  page.style.height = `${Math.max(320, window.innerHeight - top - bottom)}px`;
  vmpMap?.invalidateSize(true);
}

async function initVendorsMapPage(tries = 0) {
  const el = byId("vmpMap");
  if (!el) { if (tries < 30) setTimeout(() => initVendorsMapPage(tries + 1), 50); return; }
  if (el.__vmpInit) return; el.__vmpInit = true;
  vmpDestroy(true);
  vmpLayout();
  window.addEventListener("resize", vmpLayout);
  document.querySelectorAll("#bottomNav .bottom-nav-item").forEach((b) => b.classList.toggle("active", /vendors/i.test(b.textContent)));
  try { await loadLeaflet(); } catch (err) { el.innerHTML = `<p class="muted" style="padding:1rem;">${esc(err.message)}</p>`; return; }
  let vendors = [];
  try { vendors = (await loadVendorsDirectory()) || []; } catch (_) {}
  vmpAll = vendors.filter((v) => v.lat != null && v.lng != null && (typeof lvVendorVisible !== "function" || lvVendorVisible(v.id)));
  if (!byId("vmpMap")) return;
  let center = [6.5244, 3.3792], zoom = 11;
  if (buyerLocation) { center = [buyerLocation.lat, buyerLocation.lng]; zoom = 13; }
  vmpMap = window.L.map("vmpMap", { zoomControl: false, attributionControl: true, zoomSnap: 0.5, zoomDelta: 0.5, inertia: true, worldCopyJump: true }).setView(center, zoom);
  vmpMap.attributionControl.setPrefix(false);
  // The map always opens in the light "Map" style; only a style the person picked themselves is remembered.
  let st = ""; try { st = localStorage.getItem("levromart-vmp-style-v2") || ""; } catch (_) {}
  vmpSetStyle(VMP_STYLES[st] ? st : "streets", false);
  vmpLayer = window.L.layerGroup().addTo(vmpMap);
  vmpMap.on("zoomend moveend", () => { vmpDrawPins(); vmpDrawRail(); });
  vmpMap.on("click", () => { vmpClearRoute(); vmpHideSugg(); byId("vmpStyles")?.classList.add("hidden"); });
  vmpDrawChips();
  vmpDrawMe();
  vmpLayout();
  vmpMap.invalidateSize(false);
  const first = () => {
    if (!vmpMap) return;
    vmpMap.invalidateSize(false);
    if (vmpMap.getSize().y > 0 && vmpAll.length > 1 && !buyerLocation) vmpFitAll(); else { vmpDrawPins(); vmpDrawRail(); }
  };
  first();
  // The page can be laid out a moment after the map is created (route transition): follow its size, and fit once it has one.
  let fitted = vmpMap.getSize().y > 0;
  if (window.ResizeObserver) new ResizeObserver(() => {
    if (!vmpMap) return;
    vmpMap.invalidateSize(false);
    if (!fitted && vmpMap.getSize().y > 0) { fitted = true; if (!buyerLocation && !vmpSelected && vmpAll.length > 1) vmpFitAll(); else { vmpDrawPins(); vmpDrawRail(); } }
  }).observe(el);
  const focus = window.__pendingVendorMapFocusId;
  if (focus) { window.__pendingVendorMapFocusId = null; setTimeout(() => vmpSelect(focus, true), 200); }
  if (!buyerLocation && buyerDistanceAutoEnabled && locationSharingEnabled) {
    requestCustomerLocation(true).then((loc) => { if (loc && vmpMap) { vmpDrawMe(); vmpDrawRail(); vmpMap.flyTo([loc.lat, loc.lng], 13, { duration: 0.8 }); } }).catch(() => {});
  }
}
function vmpDestroy(keepListener) {
  try { vmpMap?.remove(); } catch (_) {}
  try { vmpClearRoute(); } catch (_) {}
  vmpMap = null; vmpTiles = null; vmpLayer = null; vmpMe = null; vmpSelected = ""; vmpQuery = ""; vmpSector = "";
  if (!keepListener) window.removeEventListener("resize", vmpLayout);
}
function vmpSetStyle(key, remember = true) {
  const s = VMP_STYLES[key] || VMP_STYLES.streets; vmpStyle = key;
  if (remember) { try { localStorage.setItem("levromart-vmp-style-v2", key); } catch (_) {} }
  if (vmpTiles) vmpMap.removeLayer(vmpTiles);
  vmpTiles = window.L.tileLayer(s.url, { attribution: s.attr, maxZoom: s.max, subdomains: s.sub || "abc", updateWhenIdle: false, keepBuffer: 4, detectRetina: true }).addTo(vmpMap);
  byId("vmPage")?.setAttribute("data-style", key);
  const box = byId("vmpStyles");
  if (box) box.innerHTML = Object.entries(VMP_STYLES).map(([k, v]) => `<button type="button" class="${k === key ? "on" : ""}" onclick="vmpSetStyle('${k}');vmpToggleStyles()"><i class="fa-solid ${v.icon}"></i><span>${v.label}</span></button>`).join("");
}
function vmpToggleStyles() { byId("vmpStyles")?.classList.toggle("hidden"); }
function vmpDrawChips() {
  const box = byId("vmpChips"); if (!box) return;
  const names = [...new Set(vmpAll.map(vmpSectorOf).filter(Boolean))].slice(0, 12);
  const chip = (label, val) => `<button type="button" class="vmp-chip${vmpSector === val ? " on" : ""}" onclick="vmpSetSector(${JSON.stringify(val).replace(/"/g, "&quot;")})">${esc(label)}</button>`;
  box.innerHTML = chip("All vendors", "") + names.map((n) => chip(n, n)).join("");
}
function vmpSetSector(v) { vmpSector = v; vmpDrawChips(); vmpDrawPins(); vmpDrawRail(); const list = vmpVisible(); if (list.length > 1) vmpFit(list); }
function vmpFit(list) {
  if (!vmpMap || !list.length) return;
  const b = window.L.latLngBounds(list.map((v) => [v.lat, v.lng]));
  if (b.isValid()) vmpMap.fitBounds(b.pad(0.18), { animate: true, maxZoom: 15, paddingBottomRight: [0, 120] });
}
function vmpFitAll() { vmpFit(vmpAll); }
function vmpDrawMe() {
  if (!vmpMap || !buyerLocation) return;
  if (vmpMe) vmpMap.removeLayer(vmpMe);
  vmpMe = window.L.marker([buyerLocation.lat, buyerLocation.lng], { icon: window.L.divIcon({ className: "vmp-me", html: '<span class="vmp-me-pulse"></span><span class="vmp-me-dot"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 800, interactive: false }).addTo(vmpMap);
}
function vmpDrawPins() {
  if (!vmpMap || !vmpLayer) return;
  vmpLayer.clearLayers();
  const list = vmpVisible(), z = vmpMap.getZoom(), cell = 62, grid = new Map();
  list.forEach((v) => {
    if (z >= 16 || v.id === vmpSelected) { grid.set("v" + v.id, [v]); return; }
    const p = vmpMap.project([v.lat, v.lng], z), k = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    (grid.get(k) || grid.set(k, []).get(k)).push(v);
  });
  grid.forEach((vs) => {
    if (vs.length === 1) {
      const v = vs[0];
      const m = window.L.marker([v.lat, v.lng], { icon: vendorDirectoryMapIcon(v), riseOnHover: true, zIndexOffset: v.id === vmpSelected ? 700 : 0 }).addTo(vmpLayer);
      m.on("click", (e) => { window.L.DomEvent.stopPropagation(e); vmpSelect(v.id, false); });
      if (v.id === vmpSelected) m.getElement()?.classList.add("vmp-sel");
      return;
    }
    const lat = vs.reduce((n, v) => n + Number(v.lat), 0) / vs.length, lng = vs.reduce((n, v) => n + Number(v.lng), 0) / vs.length;
    const m = window.L.marker([lat, lng], { icon: window.L.divIcon({ className: "vmp-cl", html: `<div class="vmp-cl-b"><b>${vs.length}</b></div>`, iconSize: [46, 46], iconAnchor: [23, 23] }) }).addTo(vmpLayer);
    m.on("click", (e) => { window.L.DomEvent.stopPropagation(e); vmpMap.fitBounds(window.L.latLngBounds(vs.map((v) => [v.lat, v.lng])).pad(0.5), { maxZoom: 17, animate: true }); });
  });
  window.dispatchEvent(new Event("scroll"));
}
function vmpCardHtml(v) {
  const id = String(v.id), km = vmpDistKm(v), sector = vmpSectorOf(v);
  const media = v.logo_url ? `<img src="${esc(v.logo_url)}" alt="" loading="lazy" draggable="false" data-n="${esc(v.business_name || "")}" data-k="${esc(id)}" onerror="vdImgFail(this)">` : vdInitialsHtml(v.business_name || "Vendor", id);
  const meta = [sector, v.city, vmpDistText(km)].filter(Boolean).map(esc).join(" · ");
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(v.lat + "," + v.lng)}`;
  return `<div class="vmp-card${id === vmpSelected ? " on" : ""}" data-vid="${esc(id)}" onclick="vmpSelect('${esc(id)}',true)">
    <div class="vmp-card-top"><div class="vmp-card-logo">${media}</div>
      <div class="vmp-card-copy"><strong class="vmp-card-name"><span class="vmp-nm">${esc(v.business_name || "Vendor")}</span><i data-vt="${esc(id)}" class="fa-solid fa-circle-check vendor-inline-verified" aria-label="Verified vendor"></i></strong><span>${meta}</span><em><i class="fa-solid fa-star"></i> ${Number(v.avg_rating || 0).toFixed(1)} <small>(${Number(v.review_count || 0)})</small></em></div></div>
    <div class="vmp-card-act"><button type="button" onclick="event.stopPropagation();navigate('storefront',{vendorId:'${esc(id)}'})"><i class="fa-solid fa-store"></i> View shop</button><a href="${dir}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i class="fa-solid fa-diamond-turn-right"></i> Directions</a></div>
  </div>`;
}
function vmpDrawRail() {
  const box = byId("vmpRail"); if (!box || !vmpMap) return;
  const b = vmpMap.getBounds();
  let list = vmpVisible().filter((v) => b.contains([v.lat, v.lng]));
  if (vmpSelected) { const s = vmpAll.find((v) => v.id === vmpSelected); if (s && !list.includes(s)) list.unshift(s); }
  list.sort((a, c) => (a.id === vmpSelected ? -1 : c.id === vmpSelected ? 1 : (vmpDistKm(a) ?? 0) - (vmpDistKm(c) ?? 0)));
  list = list.slice(0, 24);
  box.innerHTML = list.length ? list.map(vmpCardHtml).join("") : '<div class="vmp-empty"><i class="fa-solid fa-map-pin"></i> No vendors in this part of the map. Zoom out or drag to explore.</div>';
  const n = vmpVisible().length;
  const buddy = byId("vmpBuddy");
  if (buddy && !vmpSelected) buddy.textContent = n ? `${n} vendor${n === 1 ? "" : "s"} on the map${vmpQuery || vmpSector ? " for this search" : ""}. Tap a pin to meet them.` : "No vendors match that. Try another word.";
}

/* Green route from you to the picked vendor, traced in as an animation (the old directory map did this; this map lost it) */
let vmpRoute = null, vmpRouteTimer = null, vmpRouteSeq = 0;
function vmpClearRoute() {
  clearTimeout(vmpRouteTimer); vmpRouteSeq++;
  if (vmpRoute && vmpMap) { try { [vmpRoute.glow, vmpRoute.core, vmpRoute.a, vmpRoute.b].forEach((l) => l && vmpMap.removeLayer(l)); } catch (_) {} }
  vmpRoute = null;
}
async function vmpTrace(v) {
  vmpClearRoute();
  if (!vmpMap || !v || v.lat == null || v.lng == null || !buyerLocation) return;
  const seq = vmpRouteSeq;
  let coords = [[Number(buyerLocation.lat), Number(buyerLocation.lng)], [Number(v.lat), Number(v.lng)]];
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${buyerLocation.lng},${buyerLocation.lat};${v.lng},${v.lat}?overview=full&geometries=geojson`;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 5500);
    const res = await fetch(url, { signal: ctl.signal }); clearTimeout(timer);
    const route = (await res.json())?.routes?.[0]?.geometry?.coordinates;
    if (Array.isArray(route) && route.length > 1) coords = route.map((c) => [Number(c[1]), Number(c[0])]);
  } catch (_) { /* straight line */ }
  if (seq !== vmpRouteSeq || !vmpMap) return;
  const L = window.L, calm = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const glow = L.polyline(coords, { color: "#39ff88", weight: 8, opacity: 0.14, lineCap: "round", lineJoin: "round", interactive: false }).addTo(vmpMap);
  const core = L.polyline(calm ? coords : [], { color: "#19c486", weight: 3.6, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false }).addTo(vmpMap);
  const a = L.circleMarker(coords[0], { radius: 7, color: "#fff", weight: 2, fillColor: "#19c486", fillOpacity: 1, interactive: false }).addTo(vmpMap);
  const b = L.circleMarker(coords[coords.length - 1], { radius: 8, color: "#fff", weight: 2, fillColor: "#19c486", fillOpacity: 1, interactive: false }).addTo(vmpMap);
  vmpRoute = { glow, core, a, b };
  try { vmpMap.fitBounds(L.latLngBounds(coords).pad(0.25), { animate: true, maxZoom: 16, paddingBottomRight: [0, 150] }); } catch (_) {}
  if (calm) return;
  let i = 1, drawing = true;
  const step = () => {
    if (seq !== vmpRouteSeq || !vmpRoute) return;
    if (drawing) {
      core.setLatLngs(coords.slice(0, Math.min(coords.length, i)));
      i += Math.max(1, Math.ceil(coords.length / 28));
      if (i >= coords.length) { core.setLatLngs(coords); drawing = false; vmpRouteTimer = setTimeout(step, 1400); } else vmpRouteTimer = setTimeout(step, 36);
    } else { drawing = true; i = 1; core.setLatLngs([]); vmpRouteTimer = setTimeout(step, 500); }
  };
  step();
}
function vmpSelect(id, fly) {
  const v = vmpAll.find((x) => String(x.id) === String(id)); if (!v || !vmpMap) return;
  vmpSelected = v.id;
  const km = vmpDistKm(v);
  const buddy = byId("vmpBuddy");
  if (buddy) buddy.textContent = `${v.business_name || "This vendor"}${km != null ? ` is ${vmpDistText(km)} from you` : " is here"}. Tap View shop to see their things.`;
  vmpHideSugg();
  const target = vmpMap.getZoom() < 15 ? 15 : vmpMap.getZoom();
  if (buyerLocation) { vmpTrace(v); } else if (fly) vmpMap.flyTo([v.lat, v.lng], target, { duration: 0.7 }); else vmpMap.panTo([v.lat, v.lng], { animate: true });
  vmpDrawPins(); vmpDrawRail();
  setTimeout(() => byId("vmpRail")?.querySelector(".vmp-card.on")?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }), 60);
}
function vmpHideSugg() { byId("vmpSugg")?.classList.add("hidden"); }
function vmpSearch(q, clear) {
  vmpQuery = q || "";
  const inp = byId("vmpQ"); if (clear && inp) { inp.value = ""; inp.focus(); }
  byId("vmpClear")?.classList.toggle("hidden", !vmpQuery);
  const box = byId("vmpSugg"); if (!box) return;
  vmpDrawPins(); vmpDrawRail();
  if (!vmpQuery.trim()) { box.classList.add("hidden"); return; }
  const hits = vmpVisible().slice(0, 6);
  box.innerHTML = hits.length ? hits.map((v) => `<button type="button" onclick="vmpSelect('${esc(String(v.id))}',true)"><span class="vmp-sg-logo">${v.logo_url ? `<img src="${esc(v.logo_url)}" alt="" onerror="this.remove()">` : vdInitialsHtml(v.business_name || "V", v.id)}</span><span class="vmp-sg-copy"><strong><span class="vmp-nm">${esc(v.business_name || "Vendor")}</span><i data-vt="${esc(String(v.id))}" class="fa-solid fa-circle-check vendor-inline-verified" aria-label="Verified vendor"></i></strong><small>${esc([vmpSectorOf(v), v.city].filter(Boolean).join(" · "))}</small></span><i class="fa-solid fa-location-arrow"></i></button>`).join("") : '<div class="vmp-sg-none">No vendor found</div>';
  box.classList.remove("hidden");
  if (hits.length > 1) vmpFit(hits);
}
function vmpPickFirst() { const v = vmpVisible()[0]; if (v) vmpSelect(v.id, true); }
async function vmpLocate() {
  const btn = byId("vmpLocate"); btn?.classList.add("is-loading");
  try {
    const loc = await requestCustomerLocation(true);
    if (loc) { vmpDrawMe(); vmpMap?.flyTo([loc.lat, loc.lng], Math.max(vmpMap.getZoom(), 14), { duration: 0.8 }); vmpDrawRail(); }
  } catch (err) { showToast(err?.message || "Unable to get your location.", "error"); }
  finally { btn?.classList.remove("is-loading"); }
}
