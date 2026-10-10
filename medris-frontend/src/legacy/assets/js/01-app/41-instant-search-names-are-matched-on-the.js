// ---------- instant search: names are matched on the phone while you type; the server answer follows and replaces them ----------
async function lvLoadSearchIndex() {
  const hit = window.__lvSearchIdx;
  if (hit && Date.now() - hit.at < 600000) return hit.rows;
  if (window.__lvSearchIdxLoading) return window.__lvSearchIdxLoading;
  window.__lvSearchIdxLoading = (async () => {
    const rows = [];
    try {
      for (let off = 0; off < 6000; off += 1000) {
        const r = await sb.from("products").select("id,name,photos,sale_price,discount_price,rental_rate,rental_rate_unit,is_service,listing_type,service_price_unit,vendor_id,vendor:vendors!inner(business_name,lat,lng,avg_rating,review_count)").eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true).order("id").range(off, off + 999);
        if (r.error) break;
        (r.data || []).forEach((p) => rows.push({ id: p.id, name: p.name, n: lvNorm(p.name), photos: p.photos, sale_price: p.sale_price, discount_price: p.discount_price, rental_rate: p.rental_rate, rental_rate_unit: p.rental_rate_unit, is_service: p.is_service, listing_type: p.listing_type, service_price_unit: p.service_price_unit, vendor_id: p.vendor_id, vendor_business_name: p.vendor?.business_name, vendor_lat: p.vendor?.lat, vendor_lng: p.vendor?.lng, vendor_avg_rating: p.vendor?.avg_rating, vendor_review_count: p.vendor?.review_count }));
        if (!r.data || r.data.length < 1000) break;
      }
    } catch (_) {}
    if (rows.length) window.__lvSearchIdx = { at: Date.now(), rows };
    window.__lvSearchIdxLoading = null;
    return rows;
  })();
  return window.__lvSearchIdxLoading;
}
function lvInstantSearch(term) {
  const kind = searchPageFilter;
  if (!(kind === "all" || kind === "products" || kind === "services")) return;
  const idx = window.__lvSearchIdx;
  if (!idx) { lvLoadSearchIndex().then(() => { if ((byId("searchPageInput")?.value || "").trim() === term) { try { lvInstantSearch(term); } catch (_) {} } }); return; }
  const q = lvNorm(term); if (!q) return;
  const hits = [];
  for (const r of idx.rows) {
    if (kind === "products" && r.is_service) continue;
    if (kind === "services" && !r.is_service) continue;
    let sc = null;
    if (r.n.startsWith(q)) sc = 0;
    else if (r.n.includes(" " + q)) sc = 1;
    else if (r.n.includes(q)) sc = 2;
    if (sc != null) hits.push([sc, r.n.length, r]);
  }
  if (!hits.length && q.length >= 3) {
    for (const r of idx.rows) {
      if (kind === "products" && r.is_service) continue;
      if (kind === "services" && !r.is_service) continue;
      const f = lvFuzzyScore(q, r.name); if (f != null) hits.push([3 + f, r.n.length, r]);
    }
  }
  if (!hits.length) return;
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rows = hits.slice(0, kind === "all" ? 20 : 30).map((h) => h[2]);
  const prods = rows.map((r) => ({ id: r.id, name: r.name, photos: r.photos, sale_price: r.sale_price, discount_price: r.discount_price, rental_rate: r.rental_rate, rental_rate_unit: r.rental_rate_unit, is_service: r.is_service, listing_type: r.listing_type, service_price_unit: r.service_price_unit, vendor: { id: r.vendor_id, business_name: r.vendor_business_name, lat: r.vendor_lat, lng: r.vendor_lng, avg_rating: r.vendor_avg_rating, review_count: r.vendor_review_count } }));
  const results = byId("searchPageResults"); if (!results) return;
  const hb = byId("searchPageHistoryBlock"); if (hb) hb.hidden = true;
  document.querySelectorAll(".search-page-section, .search-page-empty, .search-page-error, .sr-skel").forEach((el) => el.remove());
  const single = kind !== "all";
  results.insertAdjacentHTML("beforeend", `<div class="search-page-section">${single ? "" : `<h3>Products (${prods.length})</h3>`}${prods.map(searchProductRowHtml).join("")}</div>`);
}
setTimeout(() => { try { if (typeof sb !== "undefined") lvLoadSearchIndex(); } catch (_) {} }, 4000);
function scheduleSearchPageQuery() {
  const input = byId("searchPageInput");
  const term = input?.value.trim() || "";
  byId("searchPageClearBtn")?.classList.toggle("hidden", !term);
  clearTimeout(searchPageTimer);
  if (!term) { clearSearchPageInput(); return; }
  try { lvInstantSearch(term); } catch (_) {}
  // Short enough to feel like results are appearing as you type, but long
  // enough that a normal typing cadence doesn't fire a full search for
  // every half-typed word -- each one of those on a slow connection just
  // queues up and delays the query for what was actually typed.
  searchPageTimer = setTimeout(() => runSearchPageQuery(term, false), 90);
}
// Search-result distance/price ordering: closest+cheapest listings should be
// the first thing a buyer sees, so results are sorted cheapest-first with
// distance as the tie-breaker (items missing a usable value sort last rather
// than crashing the comparison).
function searchResultDistanceKm(vendorLatLng) {
  if (!buyerLocation || vendorLatLng?.lat == null || vendorLatLng?.lng == null) return null;
  return haversineKm(buyerLocation.lat, buyerLocation.lng, vendorLatLng.lat, vendorLatLng.lng);
}
function searchResultEffectivePrice(p) {
  if (p.is_service) return p.price ?? null;
  if (p.sale_price != null) {
    return p.discount_price != null && p.discount_price > 0 && p.discount_price < p.sale_price ? p.discount_price : p.sale_price;
  }
  return p.rental_rate ?? p.price ?? null;
}
function sortSearchResultsByPriceThenDistance(rows, priceOf) {
  return [...rows].sort((a, b) => {
    const pa = priceOf(a), pb = priceOf(b);
    if (pa != null && pb != null && pa !== pb) return pa - pb;
    if (pa == null && pb != null) return 1;
    if (pa != null && pb == null) return -1;
    const da = searchResultDistanceKm(a.vendor || a), db = searchResultDistanceKm(b.vendor || b);
    if (da != null && db != null && da !== db) return da - db;
    if (da == null && db != null) return 1;
    if (da != null && db == null) return -1;
    return 0;
  });
}
function searchDistanceMetaHtml(vendorLatLng) {
  const km = searchResultDistanceKm(vendorLatLng);
  return km == null ? "" : ` · <span class="search-result-distance dt${lvDistTier(km)}"><i class="fa-solid fa-location-dot"></i> ${esc(formatDistanceKm(km))}</span>`;
}
function searchRatingHtml(avg, count) {
  const a = Number(avg || 0), n = Number(count || 0);
  return n > 0 && a > 0 ? `<span class="sr-rating"><i class="fa-solid fa-star" aria-hidden="true"></i> ${a.toFixed(1)} <small>(${n})</small></span>` : "";
}
function searchRowOpen(onclick) {
  return `onclick="${onclick}" role="link" tabindex="0" onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();${onclick}}"`;
}
function searchThumbHtml(src, icon, round) {
  return `<span class="sr-thumb${round ? " sr-thumb-round" : ""}">${src ? `<img src="${esc(lvThumb(src, 100))}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'fa-solid ${icon}'}))">` : `<i class="fa-solid ${icon}" aria-hidden="true"></i>`}</span>`;
}
function searchProductRowHtml(p) {
  const hasDiscount = p.discount_price != null && Number(p.discount_price) > 0 && Number(p.discount_price) < Number(p.sale_price ?? Infinity);
  const unit = p.rental_rate_unit ? `/${esc(p.rental_rate_unit)}` : "";
  const price = p.is_service
    ? (p.sale_price != null ? naira(p.sale_price) + servicePriceSuffix(p) : "")
    : p.sale_price != null ? naira(hasDiscount ? p.discount_price : p.sale_price)
    : p.rental_rate != null ? `${naira(p.rental_rate)}${unit}` : "";
  const v = p.vendor || {};
  if (v.id && !lvVendorVisible(v.id)) return "";
  // Long-pressing a row shows a quick preview without navigating away -- cache the
  // full row object so that preview can be built instantly from what's already fetched.
  (window.__searchResultProducts ||= new Map()).set(String(p.id), p);
  const hasVariety = Array.isArray(p.photos) && p.photos.length > 1;
  const canCart = !p.is_service && v.id && ["sale", "both"].includes(String(p.listing_type || "")) && !isOwnVendorId(v.id) && profile?.role !== "admin";
  const typeLabel = p.is_service ? "Service" : String(p.listing_type || "") === "rent" ? "Rental" : "Product";
  return `<div class="search-result-row sr-row" data-product-id="${esc(p.id)}" data-vendor-id="${esc(v.id || p.vendor_id || "")}" ${searchRowOpen(`navigate('productDetail',{productId:'${esc(p.id)}'})`)} aria-label="${esc(p.name)}">
    ${searchThumbHtml(p.photos?.[0], p.is_service ? "fa-hand-holding-heart" : "fa-camera")}
    <div class="sr-main"><strong class="sr-name">${esc(p.name)}${hasVariety ? ` <i class="fa-solid fa-layer-group product-variety-indicator" title="Multiple varieties available"></i>` : ""}</strong>
      <span class="sr-vendor"><span class="sr-vendor-name">${esc(v.business_name || "")}</span><i data-vt="${esc(v.id)}" class="fa-solid fa-circle-check sr-verified" aria-label="Verified vendor"></i>${searchDistanceMetaHtml(v)}</span>
      <span class="sr-meta"><em class="sr-type${p.is_service ? " sr-type-service" : ""}">${typeLabel}</em>${searchRatingHtml(v.avg_rating, v.review_count)}</span></div>
    <div class="sr-side">${price ? `<b class="sr-price">${price}</b>` : ""}${canCart ? `<button type="button" class="sr-cart" onclick="quickAddToCart(event,'${esc(p.id)}',this,'${esc(v.id)}')" title="Add to cart" aria-label="Add ${esc(p.name)} to cart"><i class="fa-solid fa-cart-plus"></i></button>` : ""}</div>
  </div>`;
}
function searchVendorRowHtml(v) {
  const name = v.business_name || "Vendor";
  const sectorName = v.sector_name || (Array.isArray(sectors) ? sectors.find((s) => String(s.id) === String(v.sector_id))?.name : "") || "";
  if (v.id && !lvVendorVisible(v.id)) return "";
  const count = Number(v.follower_count || 0);
  const own = isOwnVendorId(v.id);
  const recent = window.__vendorCardFollowRecent?.get(String(v.id));
  const following = recent && Date.now() - recent.at < 15000 ? !!recent.following : !!(session && window.followedVendorSet?.().has(String(v.id)));
  const loc = [v.city, null].filter(Boolean).map(esc).join("");
  return `<div class="search-result-row sr-row sr-vendor-row" data-vendor-id="${esc(v.id)}" ${searchRowOpen(`navigate('storefront',{vendorId:'${esc(v.id)}'})`)} aria-label="${esc(name)}">
    <span class="sr-thumb sr-thumb-round">${v.logo_url ? `<img src="${esc(v.logo_url)}" alt="" loading="lazy" decoding="async" data-n="${esc(name)}" data-k="${esc(v.id)}" onerror="vdImgFail(this)">` : vdInitialsHtml(name, v.id)}</span>
    <div class="sr-main"><strong class="sr-name">${esc(name)} <i data-vt="${esc(v.id)}" class="fa-solid fa-circle-check sr-verified" aria-label="Verified vendor"></i></strong>
      <span class="sr-vendor"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${loc || "Online"}${searchDistanceMetaHtml(v).replace(/<i class="fa-solid fa-location-dot"><\/i> /, "")}</span>
      <span class="sr-meta"><em class="sr-type">Vendor</em>${sectorName ? `<span class="sr-sector">${esc(sectorName)}</span>` : ""}</span>
      <span class="sr-meta">${searchRatingHtml(v.avg_rating, v.review_count)}<span class="sr-followers"><i class="fa-solid fa-user-group" aria-hidden="true"></i> <span class="vendor-follower-count">${count.toLocaleString()}</span> follower${count === 1 ? "" : "s"}</span></span></div>
    <div class="sr-side">${own ? "" : `<button type="button" class="vendor-card-follow-btn sr-follow${following ? " following" : ""}" data-vendor-id="${esc(v.id)}" onclick="event.stopPropagation();toggleVendorCardFollow('${esc(v.id)}',event)">${following ? "Following" : "Follow"}</button>`}</div>
  </div>`;
}
function searchPackageRowHtml(pkg) {
  const v = pkg.vendor || {};
  if (v.id && !lvVendorVisible(v.id)) return "";
  const n = Array.isArray(pkg.items) ? pkg.items.length : 0;
  return `<div class="search-result-row sr-row" data-vendor-id="${esc(v.id || "")}" ${searchRowOpen(`navigate('packageDetail',{packageId:'${esc(pkg.id)}'})`)} aria-label="${esc(pkg.name)}">
    ${searchThumbHtml(pkg.photos?.[0], "fa-box-open")}
    <div class="sr-main"><strong class="sr-name">${esc(pkg.name)}</strong>
      <span class="sr-vendor"><span class="sr-vendor-name">${esc(v.business_name || "")}</span><i data-vt="${esc(v.id)}" class="fa-solid fa-circle-check sr-verified" aria-label="Verified vendor"></i>${searchDistanceMetaHtml(v)}</span>
      <span class="sr-meta"><em class="sr-type sr-type-package">Package</em>${n ? `<span class="sr-sector">${n} item${n === 1 ? "" : "s"}</span>` : ""}${searchRatingHtml(v.avg_rating, v.review_count)}</span></div>
    <div class="sr-side"><b class="sr-price">${naira(pkg.price)}</b></div>
  </div>`;
}
function searchSkeletonHtml() {
  return `<div class="search-page-section sr-skel" aria-hidden="true">${Array.from({ length: 5 }, () => `<div class="sr-row"><span class="sr-thumb"></span><div class="sr-main"><span class="sr-skel-line sr-w70"></span><span class="sr-skel-line sr-w50"></span><span class="sr-skel-line sr-w40"></span></div></div>`).join("")}</div>`;
}
// Long-pressing a search result row shows a quick preview (photo, name,
// price, vendor, distance) without leaving the search page -- tapping the
// backdrop dismisses it and returns to the results exactly as they were.
let searchLongPressSuppressClick = false;
function bindSearchResultLongPress(wrap) {
  if (!wrap || wrap.dataset.longPressBound === "1") return;
  wrap.dataset.longPressBound = "1";
  let timer = null, sx = 0, sy = 0, moved = false, row = null;
  const MOVE_TOLERANCE = 14, LONG_PRESS_MS = 460;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } row?.classList.remove("search-result-long-pressing"); row = null; };
  wrap.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    row = e.target.closest?.(".search-result-row[data-product-id]");
    if (!row) return;
    sx = e.clientX || 0; sy = e.clientY || 0; moved = false;
    timer = setTimeout(() => {
      if (moved || !row) return;
      if (navigator.vibrate) navigator.vibrate(12);
      searchLongPressSuppressClick = true;
      setTimeout(() => { searchLongPressSuppressClick = false; }, 300);
      openSearchResultPreview(row.dataset.productId, row);
      row.classList.remove("search-result-long-pressing");
      timer = null;
    }, LONG_PRESS_MS);
    row.classList.add("search-result-long-pressing");
  }, { passive: true });
  wrap.addEventListener("pointermove", (e) => {
    if (!timer) return;
    if (Math.abs((e.clientX || 0) - sx) > MOVE_TOLERANCE || Math.abs((e.clientY || 0) - sy) > MOVE_TOLERANCE) { moved = true; clear(); }
  }, { passive: true });
  wrap.addEventListener("pointerup", clear, { passive: true });
  wrap.addEventListener("pointercancel", clear, { passive: true });
  wrap.addEventListener("click", (e) => { if (searchLongPressSuppressClick) { e.preventDefault(); e.stopPropagation(); } }, true);
  wrap.addEventListener("contextmenu", (e) => { if (e.target.closest(".search-result-row[data-product-id]")) e.preventDefault(); });
}
function openSearchResultPreview(productId, rowEl) {
  closeSearchResultPreview();
  const p = window.__searchResultProducts?.get(String(productId));
  if (!p) { if (productId) navigate("productDetail", { productId }); return; }
  const img = p.photos?.[0];
  const price = p.is_service ? "" : p.sale_price != null
    ? naira(p.discount_price != null && p.discount_price > 0 && p.discount_price < p.sale_price ? p.discount_price : p.sale_price)
    : p.rental_rate != null ? `${naira(p.rental_rate)}/${p.rental_rate_unit}` : "";
  const backdrop = document.createElement("div");
  backdrop.className = "search-preview-backdrop";
  backdrop.onclick = (e) => { if (e.target === backdrop) closeSearchResultPreview(); };
  backdrop.innerHTML = `<div class="search-preview-sheet">
    <button type="button" class="search-preview-close" onclick="closeSearchResultPreview()" aria-label="Close preview"><i class="fa-solid fa-xmark"></i></button>
    <div class="search-preview-media">${img ? `<img src="${esc(lvThumb(img, 120))}" alt="" loading="lazy" decoding="async">` : `<i class="fa-solid fa-camera"></i>`}</div>
    <div class="search-preview-body">
      <strong class="search-preview-name">${esc(p.name)}</strong>
      <span class="muted">${esc(p.vendor?.business_name || "")}${searchDistanceMetaHtml(p.vendor)}</span>
      ${price ? `<span class="search-preview-price">${price}</span>` : ""}
      <button type="button" class="btn" style="width:100%;justify-content:center;margin-top:.7rem;" onclick="navigate('productDetail',{productId:'${esc(p.id)}'})"><i class="fa-solid fa-arrow-right"></i> View full details</button>
    </div>
  </div>`;
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("open"));
}
function closeSearchResultPreview() {
  document.querySelectorAll(".search-preview-backdrop").forEach((el) => el.remove());
}
// Nothing typed yet doesn't have to mean nothing shown -- surface the most
// popular active listings (view_count) so the page never opens to a blank
// screen. Same price-then-distance ordering as an actual search.
let searchSuggestionsLoaded = false;
// Two modes: with no argument, this is the page's own empty-input default
// (only ever shows while the box is empty). With forceWithTerm, it's the
// "no real matches" fallback from runSearchPageQuery -- a search must never
// dead-end on a bare "no results" screen, so a typed query that matched
// nothing still gets a popularity-ranked list underneath the honest "no
// matches" note, rather than nothing at all.
async function renderSearchPageSuggestions(forceWithTerm) {
  const results = byId("searchPageResults");
  if (!results) return;
  const stillCurrent = () => {
    const t = byId("searchPageInput")?.value.trim() || "";
    return forceWithTerm ? t === forceWithTerm : !t;
  };
  if (!stillCurrent()) return;
  // Pull a wider pool than what's actually shown, then run it through the
  // same fairness shuffle Browse Everything uses (a new arrangement every
  // 10 minutes) instead of always ranking by raw view_count -- otherwise
  // the same already-popular handful of listings owns this slot forever,
  // and everything else never gets a turn at it.
  const { data } = await sb.from("products")
    .select("id,name,photos,sale_price,discount_price,rental_rate,rental_rate_unit,is_service,listing_type,service_price_unit,category:categories(sector_id),vendor:vendors!inner(id,business_name,verification_status,is_active,lat,lng,avg_rating,review_count)")
    .eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true)
    .order("view_count", { ascending: false }).limit(60);
  if (!stillCurrent()) return; // typing moved on while this was in flight
  const pool = deterministicBrowseVisibilityShuffle(data || [], "search-suggestions").slice(0, 12);
  const prods = sortSearchResultsByPriceThenDistance(pool, searchResultEffectivePrice);
  if (!prods.length) return;
  searchSuggestionsLoaded = true;
  // Forced mode keeps the "no matches" note in place above the fallback
  // list; the default empty-input mode has no such note to preserve.
  document.querySelectorAll(forceWithTerm ? ".search-page-section" : ".search-page-section, .search-page-empty").forEach((el) => el.remove());
  results.insertAdjacentHTML("beforeend", `<div class="search-page-section"><h3>${forceWithTerm ? "Popular right now" : "Suggested for you"}</h3>${prods.map(searchProductRowHtml).join("")}</div>`);
  if (!buyerLocation) {
    getCustomerLocation().then(() => { if (stillCurrent()) renderSearchPageSuggestions(forceWithTerm); }).catch(() => {});
  }
}
async function renderRelatedSuggestions(term, seq) {
  try {
    const words = String(term).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const stems = [...new Set(words.flatMap((w) => [w.replace(/(es|s)$/, ""), w.slice(0, Math.max(3, Math.ceil(w.length * 0.6)))]))].filter((w) => w.length > 2);
    for (const q of stems) {
      if (seq !== searchPageSeq) return false;
      const { data, error } = await sb.rpc("search_products_full_v2", { p_query: q, p_limit: 12 });
      if (error || !data?.length) continue;
      if (seq !== searchPageSeq) return false;
      const prods = sortSearchResultsByPriceThenDistance(data.map((r) => ({
        id: r.id, name: r.name, photos: r.photos, sale_price: r.sale_price, discount_price: r.discount_price, rental_rate: r.rental_rate, rental_rate_unit: r.rental_rate_unit,
        is_service: r.is_service, listing_type: r.listing_type, service_price_unit: r.service_price_unit,
        vendor: { id: r.vendor_id, business_name: r.vendor_business_name, lat: r.vendor_lat, lng: r.vendor_lng, avg_rating: r.vendor_avg_rating, review_count: r.vendor_review_count },
      })), searchResultEffectivePrice);
      byId("searchPageResults")?.insertAdjacentHTML("beforeend", `<div class="search-page-section"><h3>You might be looking for</h3>${prods.map(searchProductRowHtml).join("")}</div>`);
      return true;
    }
  } catch (_) {}
  return false;
}
let searchPageAbortController = null;

