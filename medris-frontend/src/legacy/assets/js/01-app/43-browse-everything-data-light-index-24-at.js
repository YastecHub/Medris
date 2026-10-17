// ---------- BROWSE EVERYTHING DATA (light index + 24-at-a-time rows) ----------
const productRowCache = new Map();
async function fetchProductsByIds(ids) {
  const want = [...new Set((ids || []).map(String))];
  if (!want.length) return [];
  const missing = want.filter((id) => !productRowCache.has(id));
  if (missing.length) {
    const { data, error } = await sb.from("products").select(PRODUCT_LIST_SELECT).in("id", missing)
      .eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true);
    if (!error) (data || []).forEach((p) => productRowCache.set(String(p.id), p));
  }
  if (productRowCache.size > 600) [...productRowCache.keys()].slice(0, 200).forEach((k) => productRowCache.delete(k));
  return want.map((id) => productRowCache.get(id)).filter(Boolean);
}
// Campus view: the Home campus bar can narrow Browse to one campus's vendors.
async function loadBrowseIndex(activeSector, activeCategory) {
  const idx = await loadBrowseIndexRaw(activeSector, activeCategory);
  const view = (typeof window.lvViewCampus === "function") ? window.lvViewCampus() : "all";
  if (!Array.isArray(idx) || !view || view === "all") return idx;
  // strictly the chosen campus: a vendor shows only on its own home campus
  return idx.filter((x) => x.campus_id === view);
}
async function loadBrowseIndexRaw(activeSector, activeCategory) {
  const slot = Math.floor(Date.now() / 600000);
  const key = `levro-browse-idx3:${slot}:${activeSector?.id || "all"}:${activeCategory?.id || "all"}`;
  window.__homeBrowseIdxMem = window.__homeBrowseIdxMem || new Map();
  if (window.__homeBrowseIdxMem.has(key)) return window.__homeBrowseIdxMem.get(key);
  // A category is a subset of the full catalogue index we already hold -- no request needed.
  if (activeCategory && Array.isArray(window.__homeFullIndex)) {
    const subset = deterministicBrowseVisibilityShuffle(window.__homeFullIndex.filter((x) => String(x.category_id) === String(activeCategory.id)), `browse:all`);
    window.__homeBrowseIdxMem.set(key, subset);
    return subset;
  }
  try { const saved = JSON.parse(sessionStorage.getItem(key) || "null"); if (Array.isArray(saved)) { window.__homeBrowseIdxMem.set(key, saved); return saved; } } catch (_) {}
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 20000; offset += pageSize) {
    let q = sb.from("products")
      .select(`id, vendor_id, category_id, is_service, category:categories${activeSector ? "!inner" : ""}(sector_id), vendor:vendors!inner(id, campus_id, operating_scope, operating_campuses)`)
      .eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true);
    if (activeSector) q = q.eq("category.sector_id", activeSector.id);
    if (activeCategory) q = q.eq("category_id", activeCategory.id);
    const { data, error } = await q.order("id").range(offset, offset + pageSize - 1);
    if (error) return null;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  const slim = rows.map((r) => ({ id: r.id, vendor_id: r.vendor_id, campus_id: r.vendor?.campus_id || null, ops_scope: r.vendor?.operating_scope || "one", ops: r.vendor?.operating_campuses || [], category_id: r.category_id, is_service: !!r.is_service, category: { sector_id: r.category?.sector_id || null } }));
  const rotated = deterministicBrowseVisibilityShuffle(slim, `browse:${activeSector?.id || "all"}`);
  window.__homeBrowseIdxMem.set(key, rotated);
  try { Object.keys(sessionStorage).filter((k) => k.startsWith("levro-browse-idx") && k !== key).forEach((k) => sessionStorage.removeItem(k)); sessionStorage.setItem(key, JSON.stringify(rotated)); } catch (_) {}
  return rotated;
}
// Browse Everything renders a page at a time and loads the next one as you
// scroll near the end (the list is already in memory; this keeps the DOM small).
const BROWSE_GRID_PAGE = 24;
let browseGridObserver = null;
function paintBrowseGrid(grid, list) {
  browseGridObserver?.disconnect(); browseGridObserver = null;
  let shown = Math.min(BROWSE_GRID_PAGE, list.length);
  grid.innerHTML = list.slice(0, shown).map(productCardHtml).join("");
  if (shown >= list.length) return;
  if (!("IntersectionObserver" in window)) { grid.insertAdjacentHTML("beforeend", list.slice(shown).map(productCardHtml).join("")); return; }
  const sentinel = document.createElement("div");
  sentinel.className = "browse-sentinel";
  sentinel.style.cssText = "grid-column:1/-1;height:1px";
  grid.appendChild(sentinel);
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    if (!sentinel.isConnected) { io.disconnect(); return; }
    const next = list.slice(shown, shown + BROWSE_GRID_PAGE);
    shown += next.length;
    sentinel.insertAdjacentHTML("beforebegin", next.map(productCardHtml).join(""));
    if (shown >= list.length) { io.disconnect(); sentinel.remove(); return; }
    io.unobserve(sentinel); io.observe(sentinel);   // still on screen? load the next page too
  }, { rootMargin: "700px 0px" });
  browseGridObserver = io;
  io.observe(sentinel);
}
// Pages of Browse Everything load on demand: loadMore() resolves to the next rows
// (empty = no more). The old grid is replaced as a whole when the filters change.
function paintBrowsePaged(grid, firstRows, loadMore, hasMore, generation) {
  browseGridObserver?.disconnect(); browseGridObserver = null;
  grid.innerHTML = firstRows.map(productCardHtml).join("");
  if (!hasMore()) return;
  const sentinel = document.createElement("div");
  sentinel.className = "browse-sentinel";
  sentinel.style.cssText = "grid-column:1/-1;height:1px";
  grid.appendChild(sentinel);
  let loading = false;
  const io = new IntersectionObserver(async (entries) => {
    if (loading || !entries.some((e) => e.isIntersecting)) return;
    if (!sentinel.isConnected || generation !== homeFilterGeneration) { io.disconnect(); return; }
    loading = true;
    let next = [];
    try { next = await loadMore(); } catch (_) {}
    loading = false;
    if (!sentinel.isConnected || generation !== homeFilterGeneration) { io.disconnect(); return; }
    if (next.length) sentinel.insertAdjacentHTML("beforebegin", next.map(productCardHtml).join(""));
    if (!hasMore()) { io.disconnect(); sentinel.remove(); return; }
    io.unobserve(sentinel); io.observe(sentinel);
  }, { rootMargin: "700px 0px" });
  browseGridObserver = io;
  io.observe(sentinel);
}
async function filterHomeProducts() {
  const generation = ++homeFilterGeneration;
  const search = byId("searchInput")?.value.trim() || "";
  const listing = byId("filterListing")?.value || "";
  const catId = byId("filterCategory")?.value || "";
  const grid = byId("productGrid");
  if (!grid) return;
  if (homeListingTab === "packages") {
    renderHomePackageTab().catch(() => {});
    return;
  }

  renderHomePackageSearch(search).catch(() => {});
  const wantService = homeListingTab === "services";
  const extraCategory = catId && String(catId) !== String(currentHomeCategoryId || "");

  // Offline / first paint: whatever is already on the device.
  const localCatalog = Array.isArray(window.__homeBrowseCatalog) && window.__homeBrowseCatalog.length
    ? window.__homeBrowseCatalog
    : (getOfflineHomeCache()?.browseProducts || []);
  const localFiltered = offlineFilterProducts(localCatalog, search, listing, extraCategory ? catId : "", currentSectorId)
    .filter(p => wantService ? !!p.is_service : !p.is_service);
  const hasLocalCatalogue = localCatalog.length > 0;
  if (browserLooksOffline()) {
    if (localFiltered.length) paintBrowseGrid(grid, localFiltered);
    else grid.innerHTML = hasLocalCatalogue
      ? `<div class="empty-state">No ${homeListingTab} match these filters.</div>`
      : `<div class="empty-state" style="grid-column:1/-1;"><i class="fa-solid fa-wifi-slash" style="display:block;font-size:1.5rem;margin-bottom:.5rem;"></i>No saved products match these filters while you're offline.</div>`;
    return;
  }

  const index = Array.isArray(window.__homeBrowseIndex) ? window.__homeBrowseIndex : null;
  const plain = !search && !listing && !extraCategory;

  // A) Plain browse: follow the rotated catalogue order, 24 products at a time.
  const nearSort = window.__browseSort === "near" && !!buyerLocation && !!index;
  if (nearSort && plain) {
    const nl = await nearBrowseLoader(index, wantService, null, "", "");
    const firstNear = await nl.loadMore();
    if (generation !== homeFilterGeneration || !byId("productGrid")) return;
    if (!firstNear.length) { grid.innerHTML = `<div class="empty-state">No ${homeListingTab} match these filters.</div>`; return; }
    paintBrowsePaged(grid, firstNear, nl.loadMore, nl.more, generation);
    return;
  }
  if (plain && index) {
    const order = index.filter((x) => !!x.is_service === wantService).map((x) => x.id);
    let offset = 0;
    const loadMore = async () => { const ids = order.slice(offset, offset + BROWSE_GRID_PAGE); offset += ids.length; return fetchProductsByIds(ids); };
    const first = await loadMore();
    if (generation !== homeFilterGeneration || !byId("productGrid")) return;
    if (!first.length) { grid.innerHTML = `<div class="empty-state">No ${homeListingTab} match these filters.</div>`; return; }
    paintBrowsePaged(grid, first, loadMore, () => offset < order.length, generation);
    return;
  }

  // Quick paint from what is on the device while the filtered request runs.
  if (hasLocalCatalogue && localFiltered.length) paintBrowseGrid(grid, localFiltered);

  // B) Text search: the search function returns the matching ids (best match first).
  let matchingIds = null;
  if (search) {
    try {
      const { data: idRows, error: searchError } = await sb.rpc("search_product_ids", { p_query: search });
      if (generation !== homeFilterGeneration || !byId("productGrid")) return;
      if (searchError) throw searchError;
      matchingIds = (idRows || []).map((r) => r.id);
      if (matchingIds.length === 0) {
        if (localFiltered.length) return;
        const fallback = await fetchFallbackProducts();
        if (generation !== homeFilterGeneration) return;
        grid.innerHTML = noResultsWithFallbackHtml(`No product named "${search}" yet - but here's what's available:`, fallback);
        return;
      }
    } catch (err) {
      console.warn("[Levromart] Home product search lookup failed; preserving local browse data:", err);
      return;
    }
  }

  if (nearSort) {
    const nl = await nearBrowseLoader(index, wantService, matchingIds, extraCategory ? catId : "", listing);
    const firstNear = await nl.loadMore();
    if (generation !== homeFilterGeneration || !byId("productGrid")) return;
    if (!firstNear.length) { grid.innerHTML = `<div class="empty-state">No ${homeListingTab} match these filters.</div>`; return; }
    paintBrowsePaged(grid, firstNear, nl.loadMore, nl.more, generation);
    return;
  }
  // C) Filters (and search results): the server does the filtering, a page at a time.
  const buildQuery = (idSlice) => {
    let q = sb.from("products").select(PRODUCT_LIST_SELECT)
      .eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true)
      .eq("is_service", wantService);
    if (idSlice) q = q.in("id", idSlice);
    if (listing === "rent") q = q.in("listing_type", ["rent", "both"]);
    if (listing === "sale") q = q.in("listing_type", ["sale", "both"]);
    if (catId) q = q.eq("category_id", catId);
    else if (currentHomeCategoryId) q = q.eq("category_id", currentHomeCategoryId);
    if (currentSectorId) q = q.eq("category.sector_id", currentSectorId);
    return q;
  };
  let offset = 0, more = true;
  const loadMore = async () => {
    if (matchingIds) {
      // Search results: walk the best-match-first id list a slice at a time.
      while (offset < matchingIds.length) {
        const ids = matchingIds.slice(offset, offset + BROWSE_GRID_PAGE);
        offset += ids.length;
        const { data, error } = await buildQuery(ids).range(0, BROWSE_GRID_PAGE - 1);
        if (error) throw error;
        const rows = (data || []).slice().sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        if (rows.length) { more = offset < matchingIds.length; return rows; }
      }
      more = false;
      return [];
    }
    const { data, error } = await buildQuery().order("created_at", { ascending: false }).range(offset, offset + BROWSE_GRID_PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    offset += rows.length;
    more = rows.length >= BROWSE_GRID_PAGE;
    return rows;
  };
  let first;
  try { first = await loadMore(); } catch (err) {
    console.warn("[Levromart] Home browse query failed; preserving local browse data:", err);
    if (!hasLocalCatalogue) {
      const fallback = await fetchFallbackProducts();
      if (generation !== homeFilterGeneration) return;
      grid.innerHTML = noResultsWithFallbackHtml("The marketplace is taking a moment to load - here's what's available:", fallback);
    }
    return;
  }
  if (generation !== homeFilterGeneration || !byId("productGrid")) return;
  if (!first.length) {
    if (localFiltered.length) return;
    const fallback = await fetchFallbackProducts();
    if (generation !== homeFilterGeneration) return;
    grid.innerHTML = noResultsWithFallbackHtml(search ? `No exact match for "${search}" with these filters - but here's what's available:` : "No products match these filters - but here's what's available:", fallback);
    return;
  }
  paintBrowsePaged(grid, first, loadMore, () => more, generation);
}

function hydrateProductVariantIndicatorsInView(){
  // A variety indicator is intentionally tied to multiple listing photos.
  // productCardHtml() already renders this synchronously from p.photos when
  // it has that data; this pass is the backfill for any card rendered
  // without it, using the photo cache populated elsewhere. It sits right
  // next to the price now (icon only, no label) rather than under the
  // removed delivery-summary line.
  const nodes=[...document.querySelectorAll('.product-card-wrap[data-product-id]')];
  if(!nodes.length)return;
  nodes.forEach(node=>{
    const photos=Array.isArray((window.__productPhotoCache||{})[node.dataset.productId])
      ? (window.__productPhotoCache||{})[node.dataset.productId]
      : null;
    const img=node.querySelector('.product-img');
    const photoCount=photos ? photos.length : Number(img?.querySelectorAll('img').length||0);
    const priceEl=node.querySelector('.product-card-compact-price');
    if(!priceEl)return;
    let el=priceEl.querySelector('.product-variety-indicator');
    if(photoCount>1){
      if(!el){el=document.createElement('i');el.className='fa-solid fa-layer-group product-variety-indicator';el.title='Multiple varieties available';el.setAttribute('aria-label','Multiple varieties available');priceEl.appendChild(el);}
    }else if(el)el.remove();
  });
}
function lvInitials(name){
  const w=String(name||"").replace(/[^\p{L}\p{N} ]/gu," ").trim().split(/\s+/).filter(Boolean);
  if(!w.length) return "?";
  return ((w[0][0]||"")+(w.length>1?(w[1][0]||""):(w[0][1]||""))).toUpperCase();
}
function lvInitialsTileHtml(name, isService){
  let h=0; const n=String(name||"Levromart"); for(let i=0;i<n.length;i++) h=(h*31+n.charCodeAt(i))%360;
  const ini=lvInitials(n);
  // A service without a photo (or a name to take letters from) gets an embossed service glyph instead of a bare letter or "?".
  if(isService||ini==="?") return `<span class="img-initials img-embossed" style="--ih:${h}" aria-label="${esc(n)}"><i class="fa-solid ${isService?"fa-bell-concierge":"fa-store"}" aria-hidden="true"></i></span>`;
  return `<span class="img-initials" style="--ih:${h}" aria-label="${esc(n)}">${esc(ini)}</span>`;
}
function productCardHtml(p) {
  const img = p.photos?.[0];
  const commissionService = !!p.is_service && p.billing_model !== "monthly";
  try { (window.__productPhotoCache ||= {})[p.id] = Array.isArray(p.photos) ? p.photos : []; } catch (_) {}
  const isFav = favoriteIds.has(p.id);
  const ownListing = isOwnVendorId(p.vendor?.id);
  const canQuickAdd = !ownListing && !p.is_service && (p.listing_type === "sale" || p.listing_type === "both") && profile?.role !== "admin";
  const actionHtml = p.is_service
    ? `<span class="card-service-btn" title="Service listing" aria-label="Service listing"><i class="fa-solid fa-bell-concierge"></i></span>`
    : canQuickAdd
      ? `<button type="button" class="card-cart-btn" onclick="quickAddToCart(event,'${p.id}',this,'${p.vendor?.id || ""}')" title="Add to cart" aria-label="Add ${esc(p.name)} to cart"><i class="fa-solid fa-cart-plus"></i></button>`
      : ownListing
        ? `<span class="badge own-listing-badge" title="You can't buy your own listing"><i class="fa-solid fa-store"></i> Your listing</span>`
        : "";
  // Product cards everywhere (trending, browse everything, search, category
  // browse) show only the photo, name and price, plus a quick-add button --
  // no vendor row, availability, delivery summary or comment icon. All of
  // that detail (delivery type/distance, quantity available, payment
  // before/after delivery, etc.) still shows in full on the product detail
  // page once it's opened -- it's just not cluttering the card itself.
  const hasDiscount = p.discount_price != null && Number(p.discount_price) > 0 && Number(p.discount_price) < Number(p.sale_price ?? Infinity);
  const priceHtml = commissionService ? "" : p.sale_price != null
    ? (hasDiscount
        ? `<span class="product-old-price">${naira(p.sale_price)}</span> <span class="product-current-price">${naira(p.discount_price)}</span>`
        : naira(p.sale_price))
    : p.rental_rate != null ? `${naira(p.rental_rate)}/${p.rental_rate_unit}` : "";
  // A product with more than one photo is treated as having varieties (the
  // established proxy this app already uses elsewhere, avoiding a
  // per-card query against product_variants just to show an icon). Icon
  // only, no "Variety" label text -- it just needs to sit next to the price
  // as a quiet signal that there's a choice to make once the card is opened.
  const hasVariety = Array.isArray(p.photos) && p.photos.length > 1;
  const varietyIconHtml = hasVariety ? `<i class="fa-solid fa-layer-group product-variety-indicator" title="Multiple varieties available" aria-label="Multiple varieties available"></i>` : "";
  // A product with no photo of its own falls back to the vendor's logo
  // filling the whole image slot, rather than a bare "No image" icon --
  // every card ends up with an actual picture in it.
  const noImageFallback = p.is_service
    ? lvInitialsTileHtml(p.vendor?.business_name || p.name, true)
    : p.vendor?.logo_url
    ? `<img src="${esc(p.vendor.logo_url)}" alt="${esc(p.vendor.business_name || "Vendor")}" loading="lazy" decoding="async" draggable="false" onerror="this.outerHTML=lvInitialsTileHtml(this.alt)">`
    : lvInitialsTileHtml(p.vendor?.business_name || p.name);
  // "Buy price" + the flat delivery fee, added up for you, so the number on
  // the card is what you'd actually pay with delivery -- not just the item
  // price with the delivery cost left to discover later. Distance-priced
  // delivery has no fixed number to add here (it depends on where the buyer
  // is), so that case is left off the card rather than showing a guess.
  const cardItemPrice = hasDiscount ? Number(p.discount_price) : Number(p.sale_price);
  const deliveryMode = String(p.delivery_fee_mode ?? p.vendor?.delivery_fee_mode ?? "free").toLowerCase();
  const deliveryFlatFee = Number(p.delivery_fee ?? p.vendor?.delivery_fee ?? 0) || 0;
  // Always render this line, even when it has nothing to show (rental,
  // service, or distance-priced delivery) -- letting it appear only on
  // some cards was exactly what made cards in the same row end up
  // different heights again, the same bug fixed earlier this session for
  // a different reason.
  // Every product card carries this line (free delivery included). Distance-priced delivery depends on where the
  // buyer is, so it shows the item price plus "+ distance fee" rather than guessing a number.
  // One plain figure: item price plus delivery. Distance pricing uses the same km x rate rule as checkout once the
  // buyer's location is known (until then it is just the item price).
  const cardPerKm = Number(p.delivery_fee_per_km ?? p.vendor?.delivery_fee_per_km ?? 0) || 0;
  // null = distance-priced and the buyer's location is not known yet, so no honest total can be shown (the rate is shown instead).
  const cardDeliveryFee = deliveryMode === "free" ? 0
    : deliveryMode === "distance"
      ? (cardPerKm <= 0 ? 0
        : (p.vendor?.lat == null || p.vendor?.lng == null) ? deliveryFlatFee
        : buyerLocation ? distanceDeliveryFee(cardPerKm, haversineKm(buyerLocation.lat, buyerLocation.lng, Number(p.vendor.lat), Number(p.vendor.lng))) : null)
      : deliveryFlatFee;
  let distHtml = "";
  try {
    if (buyerLocation && p.vendor?.lat != null && p.vendor?.lng != null) {
      const km = haversineKm(buyerLocation.lat, buyerLocation.lng, Number(p.vendor.lat), Number(p.vendor.lng));
      if (Number.isFinite(km)) distHtml = `<div class="product-card-dist dt${lvDistTier(km)}" title="${lvDistTitle(km)}"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${km < 1 ? Math.max(50, Math.round(km * 10) * 100) + " m" : km.toFixed(1) + " km"}</div>`;
    }
  } catch (_) {}
  const totalHtml = (!commissionService && !p.is_service && p.sale_price != null)
    ? (cardDeliveryFee == null
      ? `<div class="product-card-total-line" title="Delivery fee"><i class="fa-solid fa-truck" aria-hidden="true"></i><span class="product-card-total-label">Delivery</span><strong>${naira(cardPerKm)}/km</strong></div>`
      : `<div class="product-card-total-line" title="Total with delivery"><i class="fa-solid fa-truck" aria-hidden="true"></i><span class="product-card-total-label">Total</span><strong>${naira(cardItemPrice + cardDeliveryFee)}</strong></div>`)
    : (p.is_service ? `<div class="product-card-total-line card-svc-cta"><i class="fa-solid fa-comments-dollar" aria-hidden="true"></i><span class="product-card-total-label">Name your price</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></div>` : `<div class="product-card-total-line" style="visibility:hidden;">&nbsp;</div>`);
  // The wishlist management page keeps the explicit heart button -- that's
  // the one place removing something is the whole point of being there, and
  // a double-tap-to-remove gesture would be far less discoverable than a
  // button when the user is specifically managing saved items. Every other
  // card (trending, browse, search, category) drops the persistent icon in
  // favor of a double-tap on the photo, Instagram-style.
  const showFavBtn = p._cardContext === "wishlist";
  return `<div class="product-card-wrap product-card-compact" data-product-id="${esc(p.id)}" data-vendor-id="${esc(p.vendor?.id || p.vendor_id || "")}">
    ${showFavBtn ? `<button class="fav-btn ${isFav ? "active" : ""}" onclick="toggleFavorite(event,'${p.id}')" title="Save to wishlist">${isFav ? "<i class='fa-solid fa-heart'></i>" : "<i class='fa-regular fa-heart'></i>"}</button>` : ""}
    <div class="card" style="cursor:pointer;" onclick="${showFavBtn ? `navigate('productDetail',{productId:'${p.id}'})` : `handleProductImageTap(event,'${p.id}')`}">
      <div class="product-img">${img ? `<img src="${esc(lvThumb(img, 280))}" alt="${esc(p.name)}" loading="lazy" decoding="async" draggable="false">` : noImageFallback}${showFavBtn ? "" : `<span class="product-wish-bounce"><i class="fa-solid fa-heart"></i></span>`}</div>
      <h4><span class="pc-title-row"><span class="pc-vlogo-wrap">${p.vendor?.logo_url ? `<img class="pc-vlogo" src="${esc(p.vendor.logo_url)}" alt="" loading="lazy" decoding="async" draggable="false">` : `<span class="pc-vlogo pc-vlogo-txt">${esc(String(p.vendor?.business_name || "?").trim().charAt(0).toUpperCase())}</span>`}</span><span class="pc-name">${esc(p.name)}</span></span></h4>
      <div class="product-card-compact-footer">
        ${priceHtml ? `<span class="product-card-compact-price">${priceHtml}${varietyIconHtml}</span>` : "<span></span>"}
      </div>
      <div class="product-card-meta">${commissionService ? `<span class="card-svc-tag"><i class="fa-solid fa-handshake"></i> Negotiable</span>` : (distHtml || "<span></span>")}${actionHtml}</div>
      ${totalHtml}
    </div>
  </div>`;
}
// Double-tap on a card's photo toggles the wishlist instead of a
// persistent heart button (the button remains on the Wishlist page
// itself, where removing is the whole point of being there). A single
// tap still opens the product -- it just waits a beat to see whether a
// second tap follows before committing to navigation, the same tradeoff
// every double-tap-to-like gesture makes.
const __productImageTapState = new Map();
function handleProductImageTap(evt, productId) {
  // Buttons inside the card (add to cart, etc.) keep their own behaviour.
  if (evt.target?.closest?.("button, a, .card-cart-btn")) return;
  evt.stopPropagation();
  const now = Date.now();
  const DOUBLE_TAP_MS = 320;
  const state = __productImageTapState.get(productId);
  if (state?.lastTap && now - state.lastTap < DOUBLE_TAP_MS) {
    clearTimeout(state.timer);
    __productImageTapState.delete(productId);
    toggleFavoriteViaDoubleTap(evt.currentTarget, productId);
    return;
  }
  const timer = setTimeout(() => {
    __productImageTapState.delete(productId);
    navigate("productDetail", { productId });
  }, DOUBLE_TAP_MS);
  __productImageTapState.set(productId, { lastTap: now, timer });
}
async function toggleFavoriteViaDoubleTap(imgContainer, productId) {
  if (!session) { showLogin(); return; }
  if (favoriteMutations.has(productId)) return;
  favoriteMutations.add(productId);
  const wasFav = favoriteIds.has(productId);
  // Play the heart the instant the double tap is detected, not after the
  // network round trip -- waiting for that first meant the animation
  // showed up hundreds of milliseconds (or more, on a slow connection)
  // after the tap, by which point it read as "nothing happened" next to
  // the browser's instant tap-highlight flash. Roll back quietly on
  // failure instead.
  if (wasFav) favoriteIds.delete(productId); else favoriteIds.add(productId);
  playProductWishBounce(imgContainer, !wasFav);
  // The bounce animation alone wasn't a reliable enough confirmation (easy
  // to miss, or silently not render) -- a toast says outright what just
  // happened regardless of whether the animation is visible.
  showToast(wasFav ? "Removed from wishlist." : "Added to your wishlist \u2764", "success");
  try {
    const { error } = wasFav
      ? await levroData.favorites.removeProduct(session.user.id, productId)
      : await levroData.favorites.addProduct(session.user.id, productId);
    if (error) throw error;
    await hydrateProductLikeCountsInView();
  } catch (err) {
    if (wasFav) favoriteIds.add(productId); else favoriteIds.delete(productId);
    showToast(err.message || "Could not update wishlist.", "error");
  } finally {
    favoriteMutations.delete(productId);
  }
}
function playProductWishBounce(imgContainer, added) {
  const bounce = imgContainer?.querySelector?.(".product-wish-bounce");
  if (!bounce) return;
  bounce.querySelector("i").className = added ? "fa-solid fa-heart" : "fa-regular fa-heart";
  bounce.classList.remove("added", "removed");
  void bounce.offsetWidth;
  bounce.classList.add(added ? "added" : "removed");
}

// Color-codes the rating itself (not just a flat badge) so a strong vendor
// literally reads as "green" and a weak one as "red" at a glance, scanning
// down a list of cards - matches the 1-5 star scale users already know.
function ratingBadgeClass(rating) {
  const r = Number(rating);
  return "rating-gold";
}
function vendorDistanceKm(v){
  const values=[buyerLocation?.lat,buyerLocation?.lng,v?.lat,v?.lng];if(values.some(x=>x==null||x===''||!Number.isFinite(Number(x))))return null;
  const [a,b,c,d]=values.map(Number);if(Math.abs(a)>90||Math.abs(c)>90||Math.abs(b)>180||Math.abs(d)>180)return null;
  return haversineKm(a,b,c,d);
}
function vendorDistanceHtml(v){const km=vendorDistanceKm(v);return km==null?'':`<span class="vendor-distance dt${lvDistTier(km)}"><i class="fa-solid fa-location-dot"></i> ${km<1?Math.round(km*1000)+' m':km.toFixed(1)+' km'} away</span>`;}
function storefrontDistanceHtml(v){const km=vendorDistanceKm(v);if(km==null)return '';const label=km<1?Math.round(km*1000)+' m':km.toFixed(1)+' km';return `<button type="button" class="storefront-distance-link dt${lvDistTier(km)}" onclick="event.stopPropagation();openVendorDistanceMap('${esc(v?.id||'')}')" title="View route to this vendor on the map" aria-label="${esc(label)} away. View route on map"><i class="fa-solid fa-route"></i> ${esc(label)} away</button>`;}
function vendorCardHtml(v) {
  const name = v?.business_name || "Vendor";
  const avatar = v?.logo_url || v?.user_avatar_url || "";
  const sectorName = v?.sector_name || v?.sector?.name || (Array.isArray(sectors) ? sectors.find(sec => String(sec.id) === String(v?.sector_id))?.name : "") || "";
  const followerCount = Number(v?.follower_count || 0);
  return `<div class="vendor-card homepage-vendor-card" onclick="navigate('storefront',{vendorId:'${esc(v?.id || "")}'});" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();navigate('storefront',{vendorId:'${esc(v?.id || "")}'});}">
    ${avatar ? profileAvatarHtml(avatar, name, "3.05rem", { extraClass: "vendor-home-avatar", lightbox: false, stableKey: v?.id || name }) : avatarFallbackHtml(name, "3.05rem", "vendor-home-avatar vendor-home-avatar-fallback", name)}
    <div class="vendor-home-copy">
      <strong>${esc(name)} <i data-vt="${esc(v.id)}" class="fa-solid fa-circle-check vendor-inline-verified" aria-label="Verified vendor" title="Verified vendor"></i></strong>
      <span class="vendor-home-city"><i class="fa-solid fa-location-dot"></i> ${esc(v?.city || "Online")}</span>${vendorDistanceHtml(v)}
      <div class="vendor-home-meta"><span class="badge success"><i class='fa-solid fa-circle-check'></i> Verified</span><span class="badge ${ratingBadgeClass(Number(v?.avg_rating ?? 0))}"><i class="fa-solid fa-star"></i> ${Number(v?.avg_rating ?? 0).toFixed(1)} · ${Number(v?.review_count ?? 0)} reviews</span></div>
      <span class="vendor-home-known"><i class="fa-solid fa-layer-group"></i> ${esc(sectorName || "Sector not listed")}</span>
      <div class="vendor-card-footer"><span class="badge vendor-follower-badge"><i class="fa-solid fa-user-group"></i> <span class="vendor-follower-count">${followerCount.toLocaleString()}</span> follower${followerCount===1?'':'s'}</span><span class="vendor-home-storefront-label">View storefront <i class="fa-solid fa-arrow-right"></i></span></div>
    </div>
  </div>`;
}

const favoriteMutations=new Set();
async function toggleFavorite(evt,productId){
  evt.stopPropagation();if(!session){showLogin();return;}if(favoriteMutations.has(productId))return;
  favoriteMutations.add(productId);const btn=evt.currentTarget;btn.disabled=true;
  try{const old=favoriteIds.has(productId),{error}=old?await levroData.favorites.removeProduct(session.user.id,productId):await levroData.favorites.addProduct(session.user.id,productId);if(error)throw error;
    if(old)favoriteIds.delete(productId);else favoriteIds.add(productId);
    btn.innerHTML=old?"<i class='fa-regular fa-heart'></i>":"<i class='fa-solid fa-heart'></i>";btn.classList.toggle('active',!old);await hydrateProductLikeCountsInView();
  }catch(err){showToast(err.message||'Could not update like.','error');}finally{favoriteMutations.delete(productId);btn.disabled=false;}
}
