// ---------- HOME (marketplace browse) ----------
let currentSectorId = null;
let currentHomeCategoryId = null;
let sectors = [];

async function renderHome() {
  const cachedHome = getOfflineHomeCache();
  if (browserLooksOffline()) {
    // Home already has its own graceful offline experience (a cached
    // browseable copy, or a clear "come back once you're online" notice) --
    // the full-screen offline takeover would only get in the way here.
    hideLevromartOfflineOverlay?.();
    if (cachedHome) return renderOfflineHomeFromCache(cachedHome);
    return `<div class="offline-browse-notice"><i class="fa-solid fa-wifi-slash"></i><span>You're offline. Connect once to load Levromart's marketplace, then the app will keep a browseable copy available for your next offline visit.</span></div><div class="empty-state"><i class="fa-solid fa-shop" style="display:block;font-size:1.8rem;margin-bottom:.55rem;"></i>Levromart is ready. Your marketplace will appear here after the first online load.</div>`;
  }
  const cachedCats = levroCacheGet("categories", 10 * 60 * 1000);
  const [{ data: categories }, { data: sectorsData }] = await Promise.all([
    cachedCats ? Promise.resolve({ data: cachedCats }) : levroData.catalogue.categories(),
    sectors.length ? Promise.resolve({ data: sectors }) : levroData.catalogue.sectors("sort_order"),
  ]);
  if (!cachedCats && categories?.length) levroCacheSet("categories", categories);
  window.__categories = categories || [];
  if (!sectors.length) sectors = sectorsData || [];

  const activeSector = sectors.find((s) => s.id === currentSectorId) || null;
  const activeCategory = (categories || []).find((c) => String(c.id) === String(currentHomeCategoryId)) || null;
  const subCats = (categories || []).filter(c => c.parent_category_id && (!activeSector || String(c.sector_id) === String(activeSector.id)));

  let vendorQuery = sb.from("products").select("id, name, category_id, listing_type, sale_price, discount_price, rental_rate, rental_rate_unit, photos, quantity_available, condition, is_service, service_price_unit, payment_timing, payment_deposit_percent, delivery_fee, delivery_fee_mode, delivery_fee_per_km, view_count, vendor:vendors!inner(id, business_name, verification_status, logo_url, delivery_fee, delivery_fee_mode, delivery_fee_per_km, lat, lng), category:categories(sector_id)")
    .eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true);
  if (activeSector) vendorQuery = vendorQuery.eq("category.sector_id", activeSector.id);
  if (activeCategory) vendorQuery = vendorQuery.eq("category_id", activeCategory.id);
  let topVendorsQuery = sb.from("vendors").select("id, business_name, city, avg_rating, review_count, logo_url, cover_url, bio, sector_id, lat, lng").eq("verification_status", "verified").eq("is_active",true).is("deleted_at",null);
  if (activeSector) topVendorsQuery = topVendorsQuery.eq("sector_id", activeSector.id);
  const recentPhotosQuery = sb.from("products")
    .select("id, name, photos, created_at, vendor:vendors!inner(verification_status, is_active)")
    .eq("status", "active")
    .eq("vendor.verification_status", "verified")
    .eq("vendor.is_active", true);
  // Browse Everything must not be permanently dominated by the newest or
  // most-viewed listings. Load the full eligible catalogue in pages so the
  // 10-minute visibility rotation can give older/less-viewed products a turn.
  const browseCatalogQuery = sb.from("products")
    .select(PRODUCT_LIST_SELECT)
    .eq("status", "active")
    .eq("vendor.verification_status", "verified")
    .eq("vendor.is_active", true);
  // Keep the package relation query aligned with the known-working storefront
  // implementation. Do not request product.category_id here: package_items ->
  // products already supplies the product/category data needed by package cards,
  // and an invalid nested column must never make the entire Home package tab empty.
  const packageQuery = sb.from("vendor_packages")
    .select("id, vendor_id, name, description, price, photos, created_at, vendor:vendors!inner(id,business_name,logo_url,delivery_fee,verification_status,is_active), items:package_items(quantity, product:products(id,name,category_id,photos,category:categories(name,sector_id)))")
    .eq("status", "active")
    .eq("vendor.verification_status", "verified")
    .eq("vendor.is_active", true)
    .order("created_at", { ascending: false })
    .limit(activeSector || activeCategory ? 100 : 16);

  // Keep the initial marketplace paint to one parallel batch. Packages are
  // first-class marketplace listings now, so they load alongside products
  // rather than causing a second visible page refresh.
  //
  // Both loaders below page through the ENTIRE eligible catalogue (every
  // active product, every verified vendor) so the fairness rotation further
  // down has the full set to rotate through -- unavoidably heavy, but there
  // is no reason to pay that cost again on every single tap back to Home in
  // the same short browsing session. A brief in-memory cache, keyed by the
  // active sector/category filter, skips straight to the last full fetch
  // when it's still fresh.
  window.__homeCatalogCache = window.__homeCatalogCache || new Map();
  const HOME_CATALOG_CACHE_MS = 90 * 1000;
  const getCachedCatalog = (key) => {
    const hit = window.__homeCatalogCache.get(key);
    return hit && Date.now() - hit.at < HOME_CATALOG_CACHE_MS ? hit.data : null;
  };
  const setCachedCatalog = (key, data) => window.__homeCatalogCache.set(key, { data, at: Date.now() });
  const VENDOR_COLS = "id, business_name, city, avg_rating, review_count, logo_url, bio, sector_id, lat, lng";
  const loadTopVendors = async () => {
    const cacheKey = `vendors:${activeSector?.id || "all"}:${activeCategory?.id || "all"}`;
    const cached = getCachedCatalog(cacheKey);
    if (cached) return { data: cached };
    let rows = [];
    if (activeCategory) {
      // Only the vendors that really sell in this category.
      let ids;
      if (Array.isArray(window.__homeFullIndex)) {
        ids = [...new Set(window.__homeFullIndex.filter((x) => String(x.category_id) === String(activeCategory.id)).map((x) => x.vendor_id).filter(Boolean))];
      } else {
        const { data: sellers, error: sellersError } = await sb.from("products")
          .select("vendor_id, vendor:vendors!inner(id)")
          .eq("status", "active").eq("category_id", activeCategory.id)
          .eq("vendor.verification_status", "verified").eq("vendor.is_active", true).limit(1000);
        if (sellersError) return { data: null, error: sellersError };
        ids = [...new Set((sellers || []).map((r) => r.vendor_id).filter(Boolean))];
      }
      if (ids.length) {
        const { data, error } = await sb.from("vendors").select(VENDOR_COLS).in("id", ids).eq("verification_status", "verified").eq("is_active", true).is("deleted_at", null);
        if (error) return { data: null, error };
        rows = data || [];
      }
    } else {
      // The strip only shows a handful; the 40 best-rated are plenty (it used to download every vendor).
      const { data, error } = await topVendorsQuery.order("avg_rating", { ascending: false }).order("id").limit(40);
      if (error) return { data: null, error };
      rows = data || [];
    }
    const uniqueRows = [...new Map(rows.map(v => [String(v.id), v])).values()];
    const result = await attachVendorFollowerCounts(uniqueRows);
    setCachedCatalog(cacheKey, result);
    return { data: result };
  };
  // Browse Everything: only a light index (id + vendor + category, ~100 bytes each) of the whole
  // eligible catalogue is fetched, so the 10-minute fairness rotation still covers every
  // listing. Full product rows are then loaded 24 at a time as the shopper scrolls.
  const loadBrowseFirstPage = async () => {
    const index = await loadBrowseIndex(activeSector, activeCategory);
    if (!index) return { data: null, error: new Error("catalogue index failed") };
    const ids = index.filter((x) => !x.is_service).slice(0, BROWSE_GRID_PAGE).map((x) => x.id);
    const rows = await fetchProductsByIds(ids);
    return { data: rows, index };
  };
  const [{ data: trending, error: trendingError }, { data: topVendors }, { data: recentProducts }, { data: packages }, { data: browseProducts, index: browseIndex }] = await Promise.all([
    vendorQuery.order("view_count", { ascending: false }).limit(40),
    loadTopVendors(),
    recentPhotosQuery.order("created_at", { ascending: false }).limit(3),
    packageQuery,
    loadBrowseFirstPage(),
  ]);
  window.__homeBrowseIndex = Array.isArray(browseIndex) ? browseIndex : (window.__homeBrowseIndex || null);
  if (!activeSector && !activeCategory && Array.isArray(browseIndex)) window.__homeFullIndex = browseIndex;
  // Never discard a previously good Browse Everything catalogue just because
  // this refresh returned null/empty data for a moment. The homepage is
  // cache-first: a successful catalogue already on this device remains the
  // source of truth until a genuinely non-empty refresh replaces it.
  const previousBrowseCatalog = Array.isArray(window.__homeBrowseCatalog) ? window.__homeBrowseCatalog : [];
  const cachedBrowseCatalog = Array.isArray(cachedHome?.browseProducts) ? cachedHome.browseProducts : [];
  const knownGoodBrowseCatalog = previousBrowseCatalog.length ? previousBrowseCatalog : cachedBrowseCatalog;
  const stableBrowseProducts = Array.isArray(browseProducts) && browseProducts.length
    ? browseProducts
    : knownGoodBrowseCatalog;
  // Already in rotation order (the index is shuffled once per 10-minute slot).
  const rotatedBrowseProducts = stableBrowseProducts;
  window.__homeBrowseCatalog = rotatedBrowseProducts;
  window.__homeBrowseRotationKey = Math.floor(Date.now() / 600000);
  // Which sectors actually have a real, buyable listing right now -- the
  // "Shop by Category" rail should only ever offer a tap that leads
  // somewhere, not a sector nobody has listed anything under yet.
  const activeSectorIds = await (async () => {
    const cacheKey = "active-sector-ids:" + ((typeof window.lvViewCampus === "function") ? window.lvViewCampus() : "all");
    const cached = getCachedCatalog(cacheKey);
    if (cached) return cached;
    let ids;
    if ((!activeSector && !activeCategory) || Array.isArray(window.__homeFullIndex)) {
      // The full catalogue index is already on hand (this load or an earlier one) -- reuse
      // it instead of scanning the whole product table again.
      const idxRows = (!activeSector && !activeCategory) ? (Array.isArray(browseIndex) && browseIndex.length ? browseIndex : stableBrowseProducts) : window.__homeFullIndex;
      ids = new Set(idxRows.map(p => p.category?.sector_id).filter(Boolean).map(String));
      ids.categoryIds = new Set(idxRows.map(p => p.category_id).filter(Boolean).map(String));
    } else {
      const rows = [];
      const pageSize = 500;
      try {
        for (let offset = 0; ; offset += pageSize) {
          const { data, error } = await sb.from("products")
            .select("category_id, category:categories!inner(sector_id), vendor:vendors!inner(verification_status,is_active)")
            .eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true)
            .range(offset, offset + pageSize - 1);
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < pageSize) break;
        }
        ids = new Set(rows.map(r => r.category?.sector_id).filter(Boolean).map(String));
        ids.categoryIds = new Set(rows.map(r => r.category_id).filter(Boolean).map(String));
      } catch (err) {
        console.warn("[Levromart] Could not compute sectors with listings:", err);
        return null;
      }
    }
    setCachedCatalog(cacheKey, ids);
    return ids;
  })();
  // Categories that actually have a live listing right now (a lookup that
  // failed keeps the last verified list, never every category).
  const railCategories = activeSectorIds?.categoryIds
    ? (categories || []).filter((c) => c.parent_category_id && activeSectorIds.categoryIds.has(String(c.id)))
    : (window.__levroRailCategories || []);
  if (activeSectorIds?.categoryIds) window.__levroRailCategories = railCategories;
  window.__levroAllCategories = categories || window.__levroAllCategories || [];
  const homepageCarouselSlides = await loadHomepageCarouselSlides();
  // Keep an all-category catalogue locally. The active category is applied
  // instantly on-device when a category chip is tapped, so the offline cache
  // must not be overwritten with only the currently selected category.
  const cachedTrending = trendingError ? (cachedHome?.trending || [])
    : [...new Map([...(cachedHome?.trending || []).filter(p =>
        (activeSector && String(p.category?.sector_id) !== String(activeSector.id)) ||
        (activeCategory && String(p.category_id) !== String(activeCategory.id))),
        ...(trending || [])].map(p => [String(p.id), p])).values()]
      .sort((a,b) => Number(b.view_count || 0) - Number(a.view_count || 0));
  const cacheBase = cachedHome || {};
  const safeBrowseForCache = !activeCategory && rotatedBrowseProducts.length ? rotatedBrowseProducts : (cacheBase.browseProducts || []);
  const safeTrendingForCache = cachedTrending.length ? cachedTrending : (cacheBase.trending || []);
  const safeTopVendorsForCache = Array.isArray(topVendors) && topVendors.length ? topVendors : (cacheBase.topVendors || []);
  const safeRecentForCache = Array.isArray(recentProducts) && recentProducts.length ? recentProducts : (cacheBase.recentProducts || []);
  const safePackagesForCache = Array.isArray(packages) && packages.length ? packages : (cacheBase.packages || []);
  writeOfflineHomeCache({
    categories: Array.isArray(categories) && categories.length ? categories : (cacheBase.categories || []),
    sectors: Array.isArray(sectors) && sectors.length ? sectors : (cacheBase.sectors || sectorsData || []),
    categoriesWithListings: railCategories,
    trending: safeTrendingForCache,
    browseProducts: safeBrowseForCache,
    topVendors: safeTopVendorsForCache,
    recentProducts: safeRecentForCache,
    packages: safePackagesForCache,
    carouselSlides: Array.isArray(homepageCarouselSlides) && homepageCarouselSlides.length ? homepageCarouselSlides : (cacheBase.carouselSlides || [])
  });

  const allHomePackages = packages || [];
  window.__allHomePackages = allHomePackages;
  const scopedPackages = activeCategory
    ? allHomePackages.filter(pkg => (pkg.items || []).some(it => String(it.product?.category_id) === String(activeCategory.id)))
    : activeSector
      ? allHomePackages.filter(pkg => (pkg.items || []).some(it => String(it.product?.category?.sector_id) === String(activeSector.id)))
      : allHomePackages;
  window.__homePackages = scopedPackages;
  const recommendedPackages = [...scopedPackages].sort((a, b) => {
    const score = (pkg) => (pkg.items || []).reduce((sum, it) => sum + (favoriteIds.has(it.product?.id) ? 10 : 0), 0);
    return score(b) - score(a);
  }).slice(0, 6);
  const hasPersonalPackageMatch = recommendedPackages.some((pkg) => (pkg.items || []).some((it) => favoriteIds.has(it.product?.id)));

  // null means the lookup itself failed (e.g. offline mid-request): keep the
  // last list that was verified against real listings (or none) -- never
  // every sector, since categories nobody has listed under must not show.
  let html = "";
  if (railCategories.length) html += homeCategoryRailHtml(railCategories);
  html += `<div class="hero levro-home-hero">
    ${renderHomepageCarouselHtml(homepageCarouselSlides)}
  </div>`;

  let svcRows = [];
  try {
    let sq = sb.from("products").select(PRODUCT_LIST_SELECT).eq("status", "active").eq("is_service", true).eq("vendor.verification_status", "verified").eq("vendor.is_active", true);
    if (activeCategory) sq = sq.eq("category_id", activeCategory.id);
    const { data: sd } = await sq.order("view_count", { ascending: false }).limit(12);
    svcRows = sd || [];
  } catch (_) {}
  html += homeQuickActionsHtml();

  if (trendingError) html += `<h3 class="section-title"><i class="fa-solid fa-fire"></i> Trending now</h3><p class="muted">Trending listings couldn’t load. Please try again.</p>`;
  if (trending && trending.length) {
    const trendingProducts = deterministicHourlyShuffle(trending.filter(p => !p.is_service),"trending-products");
    if (trendingProducts.length) html += `<h3 class="section-title"><span><i class='fa-solid fa-fire'></i> Trending now${activeCategory ? ` · ${esc(activeCategory.name)}` : activeSector ? ` · ${esc(activeSector.name)}` : ""}</span><a class="section-title-link" onclick="scrollToBrowse('')">See all <i class="fa-solid fa-arrow-right"></i></a></h3><div class="hscroll trending-scroll">${trendingProducts.map(p=>productCardHtml({...p,_cardContext:"trending"})).join("")}</div>`;

  }

  const trendingServices = (() => { const seen = new Set(); return [...(trending || []), ...svcRows, ...(browseProducts || [])].filter(p => p && p.is_service && !seen.has(p.id) && seen.add(p.id)).slice(0, 12); })();
  // only when the services row below exists, so this strip never ends up right next to the sell/rent strip
  if (trendingServices.length && typeof lvHomeBand3 === "function") html += lvHomeBand3();
  if (trendingServices.length) html += `<h3 class="section-title"><i class='fa-solid fa-hand-holding-heart'></i> Trending services${activeCategory ? ` · ${esc(activeCategory.name)}` : activeSector ? ` · ${esc(activeSector.name)}` : ""}</h3><div class="hscroll trending-scroll service-trending-scroll">${trendingServices.map(p=>productCardHtml({...p,_cardContext:"trending"})).join("")}</div>`;
  if (typeof lvHomeBand2 === "function") html += lvHomeBand2();
  const scopedTopVendors = topVendors;
  if (scopedTopVendors && scopedTopVendors.length) {
    const shuffledTopVendors = deterministicHourlyShuffle(scopedTopVendors,"top-rated-vendors");
    html += `<h3 class="section-title"><span><i class='fa-solid fa-medal'></i> Featured Vendors</span><a class="section-title-link" onclick="navigate('vendors').then(()=>setTimeout(()=>switchVendorsView('list'),0))">See all <i class="fa-solid fa-arrow-right"></i></a></h3><div class="hscroll top-rated-vendors-scroll" id="topRatedVendors">${shuffledTopVendors.map((x) => vendorPageCardHtml(x, true)).join("")}</div>`;
  }

  if (recommendedPackages.length) {
    html += `<h3 class="section-title"><span><i class='fa-solid fa-box-open'></i> ${hasPersonalPackageMatch ? "Recommended packages for you" : "Special packages"}</span></h3><div class="hscroll package-recommendation-strip">${recommendedPackages.map((pkg) => packageCardHtml(pkg, pkg.vendor?.delivery_fee)).join("")}</div>`;
  }

  if (typeof lvHomeBand === "function") html += lvHomeBand();
  html += `<h3 class="section-title" id="browseSection"><i class="fa-solid fa-shop"></i> Browse ${activeCategory ? esc(activeCategory.name) : activeSector ? `all ${esc(activeSector.name)}` : "everything"}</h3>`;
  html += `<div class="catalog-type-tabs home-catalog-type-tabs" role="tablist" aria-label="Browse products, services and packages"><button type="button" class="catalog-type-tab ${homeListingTab === "products" ? "active" : ""}" data-tab="products" onclick="switchHomeListingTab('products')"><i class="fa-solid fa-box"></i> Products</button><button type="button" class="catalog-type-tab ${homeListingTab === "services" ? "active" : ""}" data-tab="services" onclick="switchHomeListingTab('services')"><i class="fa-solid fa-hand-holding-heart"></i> Services</button><button type="button" class="catalog-type-tab ${homeListingTab === "packages" ? "active" : ""}" data-tab="packages" onclick="switchHomeListingTab('packages')"><i class="fa-solid fa-box-open"></i> Packages</button></div>`;
  html += `<div class="browse-filter-toolbar">
    <button type="button" class="browse-filter-trigger" id="browseFilterTrigger" aria-expanded="false" onclick="toggleBrowseFilters()">${window.LV_FILTER_SVG}<i class="fa-solid fa-chevron-down browse-filter-chevron" aria-hidden="true"></i></button>
    <input type="search" id="searchInput" placeholder="Search marketplace…" oninput="scheduleHomeSearch()" autocomplete="off" aria-label="Search products, packages, or services" />
    <div class="browse-filter-panel hidden" id="browseFilterPanel">
      <div class="browse-filter-panel-head"><strong>Filter browse</strong><button type="button" class="icon-btn" onclick="toggleBrowseFilters()" aria-label="Close filters"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="browse-filter-row-group">
        <button type="button" class="browse-filter-subtrigger" onclick="toggleBrowseSubmenu('listing')"><span>Type</span><strong id="browseListingLabel">All types</strong><i class="fa-solid fa-chevron-down"></i></button>
        <div class="browse-filter-submenu hidden" id="browseListingSubmenu">
          <button type="button" data-value="" onclick="chooseBrowseListing('', 'All types')">All types</button>
          <button type="button" data-value="rent" onclick="chooseBrowseListing('rent', 'Rent')">Rent</button>
          <button type="button" data-value="sale" onclick="chooseBrowseListing('sale', 'Buy')">Buy</button>
        </div>
      </div>
      <div class="browse-filter-row-group">
        <button type="button" class="browse-filter-subtrigger" onclick="toggleBrowseSubmenu('category')"><span>Category</span><strong id="browseCategoryLabel">${esc(activeCategory?.name || "All categories")}</strong><i class="fa-solid fa-chevron-down"></i></button>
        <div class="browse-filter-submenu browse-category-submenu hidden" id="browseCategorySubmenu">
          <input type="search" id="filterCategorySearch" placeholder="Search categories…" oninput="filterBrowseCategoryOptions()" autocomplete="off" />
          <div id="browseCategoryOptions">${subCats.map((c) => `<button type="button" data-value="${c.id}" data-label="${esc(c.name)}" onclick="chooseBrowseCategory('${c.id}','${esc(c.name).replace(/'/g, '&#39;')}')">${esc(c.name)}</button>`).join("")}</div>
          <button type="button" data-value="" data-label="All categories" onclick="chooseBrowseCategory('','All categories')">All categories</button>
        </div>
      </div>
      <div class="browse-filter-row-group">
        <button type="button" class="browse-filter-subtrigger" onclick="toggleBrowseSubmenu('sort')"><span>Sort</span><strong id="browseSortLabel">${window.__browseSort==='near'?'Closest to me':'Recommended'}</strong><i class="fa-solid fa-chevron-down"></i></button>
        <div class="browse-filter-submenu hidden" id="browseSortSubmenu">
          <button type="button" onclick="chooseBrowseSort('','Recommended')">Recommended</button>
          <button type="button" onclick="chooseBrowseSort('near','Closest to me')"><i class="fa-solid fa-location-crosshairs"></i> Closest to me</button>
        </div>
      </div>
      <button type="button" class="browse-filter-clear" onclick="clearBrowseFilters()">Clear filters</button>
    </div>
    <select id="filterListing" class="visually-hidden-select" onchange="filterHomeProducts()"><option value="">All types</option><option value="rent">Rent</option><option value="sale">Buy</option></select>
    <select id="filterCategory" class="visually-hidden-select" onchange="filterHomeProducts()"><option value="">All categories</option>${subCats.map((c) => `<option value="${c.id}" ${activeCategory && String(activeCategory.id) === String(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
  </div>`;
  html += `<div class="grid" id="productGrid"><p class="muted">Loading…</p></div>`;
  html += `<div id="packageSearchResults" class="hidden" style="margin-top:1.3rem;"></div>`;
  setTimeout(filterHomeProducts, 0);
  return html;
}

function paintHomeFromLocalCatalog(showOfflineNotice = false) {
  const cache = getOfflineHomeCache();
  if (!cache) return false;
  const app = byId("app");
  const rendered = renderOfflineHomeFromCache(cache, { showOfflineNotice });
  if (!rendered || !app) return false;
  // Repainting the cached homepage is intentionally silent. It must never
  // yank a user back to the top while they are browsing the catalogue --
  // and tapping a category chip in the rail itself must not snap that
  // rail's own horizontal scroll back to the start either (the same class
  // of bug already fixed for the vendor map rail).
  const previousScrollY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
  const previousCatRailScroll = byId("app")?.querySelector(".levro-home-cat-rail")?.scrollLeft || 0;
  app.innerHTML = rendered;
  try { initHomepageCarousel(); } catch (_) {}
  const catRail = app.querySelector(".levro-home-cat-rail");
  if (catRail) catRail.scrollLeft = previousCatRailScroll;
  syncLeviFabVisibility();
  updateHeaderNavActive();
  clearAutoScrollTimers();
  document.querySelectorAll("#app .cat-row, #app .hscroll").forEach(el => setupAutoScroll(el));
  requestAnimationFrame(() => {
    if (Math.abs((window.scrollY || document.documentElement.scrollTop || 0) - previousScrollY) > 1) {
      window.scrollTo({ top: previousScrollY, behavior: "auto" });
    }
    if (catRail && Math.abs(catRail.scrollLeft - previousCatRailScroll) > 1) {
      catRail.scrollLeft = previousCatRailScroll;
    }
  });
  return true;
}

async function refreshHomeCategorySelection() {
  if (browserLooksOffline()) return;
  const categoryId = currentHomeCategoryId;
  const sectorId = currentSectorId;
  try {
    let productQuery = sb.from("products")
      .select(PRODUCT_LIST_SELECT + ",view_count,created_at")
      .eq("status", "active")
      .eq("vendor.verification_status", "verified")
      .eq("vendor.is_active", true)
      .order("view_count", { ascending: false })
      .limit(40);
    if (categoryId) productQuery = productQuery.eq("category_id", categoryId);
    else if (sectorId) productQuery = productQuery.eq("category.sector_id", sectorId);

    const { data: freshProducts } = await productQuery;
    if (categoryId !== currentHomeCategoryId || sectorId !== currentSectorId) return;

    const cacheNow = getOfflineHomeCache() || { categories: window.__categories || [], sectors, trending: [], browseProducts: [], topVendors: [], recentProducts: [], packages: [] };
    const merged = new Map((cacheNow.browseProducts || []).map(p => [String(p.id), p]));
    (freshProducts || []).forEach(p => merged.set(String(p.id), p));
    const nextBrowse = [...merged.values()];
    const nextTrending = (freshProducts || []).slice().sort((a,b) => Number(b.view_count || 0) - Number(a.view_count || 0)).slice(0, 20);

    // Keep all previously cached packages, but make sure packages containing
    // products in the selected category/sector can be surfaced immediately.
    let nextPackages = cacheNow.packages || [];
    if (categoryId || sectorId) {
      const packageRows = await sb.from("vendor_packages")
        .select("id, vendor_id, name, description, price, photos, created_at, vendor:vendors!inner(id, business_name, logo_url, delivery_fee, verification_status, is_active), items:package_items(quantity, product:products(id, name, category_id, photos, category:categories(name, sector_id)))")
        .eq("status", "active")
        .eq("vendor.verification_status", "verified")
        .eq("vendor.is_active", true)
        .order("created_at", { ascending: false })
        .limit(40);
      if (packageRows.data) nextPackages = packageRows.data;
    }

    writeOfflineHomeCache({ ...cacheNow, browseProducts: nextBrowse, trending: nextTrending, packages: nextPackages });

    // Repaint the visible rails from the fresh result without ever showing a
    // loading screen. filterHomeProducts() will fill the lower browse grid.
    paintHomeFromLocalCatalog(false);
  } catch (e) {
    // The cached category view is already usable; a failed refresh must not
    // interrupt browsing.
  }
}

// Tapping Home (the bottom-nav tab or the header logo) should always land
// on the unfiltered marketplace, not silently keep whatever sector/category
// chip was last tapped -- that filter is meant to last only while still
// browsing Home, not survive a deliberate "take me back to Home".
function resetHomeFilters() {
  currentSectorId = null;
  currentHomeCategoryId = null;
}
function switchSector(sectorId) {
  currentSectorId = sectorId;
  currentHomeCategoryId = null;
  // Category/sector browsing is cache-first both online and offline. The
  // selected rail changes immediately; online data is refreshed silently.
  const painted = paintHomeFromLocalCatalog(false);
  if (!painted) navigate("home", {}, false);
  else refreshHomeCategorySelection();
}

function deterministicBrowseVisibilityShuffle(list, seedSource){
  const arr=Array.isArray(list)?list.slice():[];
  const slot=Math.floor(Date.now()/600000); // new arrangement every 10 minutes
  const seed=String(seedSource||'levromart')+':'+slot;
  let h=2166136261;
  for(let i=0;i<seed.length;i++){h^=seed.charCodeAt(i);h=Math.imul(h,16777619);}
  const rand=()=>{h+=0x6D2B79F5;let t=h;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
  const shuffle=(a)=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};

  // First mix sectors, then mix vendors within each sector. This prevents
  // Browse Everything from becoming a wall of one vendor/category and gives
  // the whole eligible catalogue a fair turn at the top, middle and bottom.
  const sectorBuckets=new Map();
  for(const p of arr){
    const sector=String(p?.category?.sector_id||p?.sector_id||'__other__');
    if(!sectorBuckets.has(sector))sectorBuckets.set(sector,[]);
    sectorBuckets.get(sector).push(p);
  }
  const sectorEntries=shuffle([...sectorBuckets.entries()]);
  const sectorVendorQueues=sectorEntries.map(([sector,items])=>{
    const vendors=new Map();
    for(const p of items){
      const vendor=String(p?.vendor?.id||p?.vendor_id||'__unknown_vendor__');
      if(!vendors.has(vendor))vendors.set(vendor,[]);
      vendors.get(vendor).push(p);
    }
    const vendorQueues=shuffle([...vendors.values()]).map(shuffle);
    const mixed=[];
    let remaining=true;
    while(remaining){
      remaining=false;
      shuffle(vendorQueues);
      for(const q of vendorQueues){
        if(q.length){mixed.push(q.shift());remaining=true;}
      }
    }
    return mixed;
  });

  const out=[];
  let remaining=true;
  while(remaining){
    remaining=false;
    shuffle(sectorVendorQueues);
    for(const q of sectorVendorQueues){
      if(q.length){out.push(q.shift());remaining=true;}
    }
  }
  return out;
}

// Trending Now historically used the same helper name. Keep it available so
// its existing behaviour and layout remain untouched.
function deterministicHourlyShuffle(list, seedSource){
  const arr=Array.isArray(list)?list.slice():[];
  const hour=Math.floor(Date.now()/3600000);
  const seed=String(seedSource||'levromart')+':'+hour;
  let h=2166136261; for(let i=0;i<seed.length;i++){h^=seed.charCodeAt(i);h=Math.imul(h,16777619);}
  const rand=()=>{h+=0x6D2B79F5;let t=h;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
  for(let i=arr.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}
  return arr;
}



function scrollToBrowse(listingType) {
  const sel = byId("filterListing");
  if (sel) { sel.value = listingType; filterHomeProducts(); }
  byId("browseSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
// The rail filters by SECTOR, not by the categories table's top-level rows --
// products are tagged with a fine-grained (usually leaf) category, and
// filtering by a bare top-level category id never matched anything real,
// so tapping a chip looked completely broken. Sectors are the broad,
// vendor-facing grouping (Food & Drinks, Electronics, Fashion, ...) that
// the existing switchSector()/activeSector plumbing already filters
// trending + browse by correctly, and each sector already stores its own
// icon in the database instead of needing a guess from its name.
// Six quick-action cards: icon, title, one-line description, arrow. Kept
// as one shared function so the two places Home can render from (the live
// path and the offline-cache fast-repaint path) can never drift apart.
function homeQuickActionsHtml() {
  const actions = [
    { key: "products", icon: "fa-bag-shopping", tone: "mint", title: "Shop Products", desc: "Local vendors" },
    { key: "services", icon: "fa-screwdriver-wrench", tone: "peach", title: "Book Services", desc: "Trusted providers" },
    { key: "rent", icon: "fa-key", tone: "lavender", title: "Rent Items", desc: "No need to buy" },
    { key: "vendors", icon: "fa-store", tone: "pink", title: "All Vendors", desc: "Discover nearby" },
    { key: "request", icon: "fa-hand", tone: "aqua", title: "Request Item", desc: "Let vendors find it" },
    { key: "chat", icon: "fa-comment-dots", tone: "blue", title: "Chat Directly", desc: "Get quick answers" },
  ];
  return `<section class="levro-home-quick-actions" aria-label="Quick actions">${actions.map((a) => `<button type="button" class="levro-quick-action levro-quick-${a.tone}" onclick="openHomeQuickAction('${a.key}')"><span class="levro-quick-icon">${typeof lvIllus === "function" ? lvIllus(({products:"bag",services:"tools",rent:"key",vendors:"store",request:"hand",chat:"chat"})[a.key] || "box", 34) : `<i class="fa-solid ${a.icon}"></i>`}</span><span class="levro-quick-body"><strong class="levro-quick-title">${a.title}</strong><span class="levro-quick-desc">${a.desc}</span></span><span class="levro-quick-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i></span></button>`).join("")}</section>`;
}
// Icon comes from the sector's own database row. Rows saved with the generic
// placeholder (or none) fall back to a keyword match on the name, then to a
// neutral shapes icon, so a brand-new vendor-created category never breaks.
const LEVRO_SECTOR_ICON_HINTS = [
  [/scarf|scarves|headwrap|ribbon/, "fa-ribbon", "#f43f5e"], [/women|dress|gown|lady|ladies/, "fa-person-dress", "#ec4899"], [/(^|\W)men|suit|male/, "fa-user-tie", "#2563eb"],
  [/jewel|ring|necklace|earring|watch|gem/, "fa-gem", "#06b6d4"], [/fragrance|perfume|scent|cologne/, "fa-spray-can-sparkles", "#d946ef"],
  [/shawarma|burger|meal|pizza|fast ?food/, "fa-burger", "#f97316"], [/yogurt|yoghurt|dairy|milk|ice ?cream/, "fa-ice-cream", "#fb7185"],
  [/shoe|sneaker|footwear|sandal/, "fa-shoe-prints", "#a855f7"], [/bag|handbag|purse/, "fa-bag-shopping", "#e11d48"],
  [/food|grocer|restaurant|cater|snack|bak/, "fa-utensils", "#f97316"], [/drink|beverage|juice|water|wine/, "fa-mug-hot", "#b45309"],
  [/fashion|cloth|wear|tailor|fabric/, "fa-shirt", "#ec4899"], [/beauty|cosmetic|skin|hair|spa|wellness|makeup/, "fa-wand-magic-sparkles", "#d946ef"],
  [/iphone|phone|mobile|tablet|telecom/, "fa-mobile-screen-button", "#3b82f6"], [/electronic|gadget|tv|audio|generator|power|lamp/, "fa-microchip", "#6366f1"],
  [/comput|laptop|tech|software/, "fa-laptop", "#0ea5e9"], [/health|pharm|medic|glucometer|pressure/, "fa-kit-medical", "#ef4444"],
  [/home|furniture|decor|living|kitchen|appliance|bottle/, "fa-couch", "#a16207"], [/auto|car|vehicle/, "fa-car", "#0d9488"],
  [/book|stationery|education|school/, "fa-book", "#7c3aed"], [/sport|fitness|gym/, "fa-dumbbell", "#16a34a"],
  [/art|craft|handmade|tattoo/, "fa-palette", "#f59e0b"], [/baby|kid|toy/, "fa-baby", "#f472b6"],
  [/service|repair|clean|laundry/, "fa-screwdriver-wrench", "#0891b2"], [/event|entertain|music|media|photo/, "fa-camera", "#8b5cf6"],
  [/agri|farm|pet/, "fa-seedling", "#65a30d"], [/build|construct|hardware|tool|industrial/, "fa-helmet-safety", "#ea580c"], [/gift/, "fa-gift", "#e11d48"],
];
const LEVRO_SECTOR_FALLBACK_COLORS = ["#2563eb", "#16a34a", "#e11d48", "#f59e0b", "#7c3aed", "#0d9488", "#db2777", "#0891b2"];
function levroSectorHint(sector) {
  const name = String(sector?.name || "").toLowerCase();
  return LEVRO_SECTOR_ICON_HINTS.find(([re]) => re.test(name)) || null;
}
// Icon: the sector's own database icon, else a keyword match on its name, else
// a neutral shapes icon. Colour: keyword match, else a stable colour picked
// from the name -- so a brand-new vendor-created category is never gray/blank.
function levroSectorIconClass(sector) {
  const own = String(sector?.icon || "").trim();
  if (/^fa-[a-z0-9-]+$/.test(own) && own !== "fa-shapes") return own;
  return levroSectorHint(sector)?.[1] || "fa-shapes";
}

/*
 * HOME CATEGORY ART
 * Small, colorful vector illustrations instead of large photographic thumbnails.
 * The artwork is intentionally between "real" and "cartoon": simple layered
 * shapes, soft gradients and clear silhouettes that stay legible at tiny sizes.
 * It is self-contained so the category rail does not depend on an image CDN.
 */
function levroCategoryArtKey(sector) {
  const name = String(sector?.name || "").toLowerCase();
  if (/scarf|scarves|headwrap|ribbon/.test(name)) return "scarf";
  if (/women|dress|gown|lady|ladies/.test(name)) return "dress";
  if (/(^|\W)men|suit|male/.test(name)) return "mens";
  if (/jewel|ring|necklace|earring|watch|gem/.test(name)) return "jewelry";
  if (/fragrance|perfume|scent|cologne/.test(name)) return "perfume";
  if (/shawarma|burger|meal|pizza|fast ?food|food|grocer|restaurant|cater|snack|bak/.test(name)) return "food";
  if (/yogurt|yoghurt|dairy|milk|ice ?cream/.test(name)) return "yogurt";
  if (/shoe|sneaker|footwear|sandal/.test(name)) return "shoe";
  if (/bag|handbag|purse/.test(name)) return "bag";
  if (/drink|beverage|juice|water|wine/.test(name)) return "drink";
  if (/beauty|cosmetic|skin|hair|spa|wellness|makeup/.test(name)) return "beauty";
  if (/iphone|phone|mobile|tablet|telecom/.test(name)) return "phone";
  if (/electronic|gadget|tv|audio|generator|power|lamp/.test(name)) return "electronics";
  if (/comput|laptop|tech|software/.test(name)) return "laptop";
  if (/health|pharm|medic|glucometer|pressure/.test(name)) return "health";
  if (/home|furniture|decor|living|kitchen|appliance|bottle/.test(name)) return "home";
  if (/auto|car|vehicle/.test(name)) return "car";
  if (/book|stationery|education|school/.test(name)) return "books";
  if (/sport|fitness|gym/.test(name)) return "sport";
  if (/art|craft|handmade|tattoo/.test(name)) return "art";
  if (/baby|kid|toy/.test(name)) return "baby";
  if (/service|repair|clean|laundry/.test(name)) return "service";
  if (/event|entertain|music|media|photo/.test(name)) return "event";
  if (/agri|farm|pet/.test(name)) return "farm";
  if (/build|construct|hardware|tool|industrial/.test(name)) return "tools";
  if (/gift/.test(name)) return "gift";
  if (/cloth|apparel|accessor|garment|hat|cap\b|belt|sock|thrift|vintage|wear|outfit/.test(name)) return "clothes";
  if (/deliver|logistic|courier|transport|ride|dispatch|moving/.test(name)) return "delivery";
  if (/print|design|graphic|brand|photograph/.test(name)) return "art";
  if (/tutor|lesson|class|training|course/.test(name)) return "books";
  if (/^all\b|everything|all categories/.test(name)) return "all";
  if (/campus|school|universit|hostel|student/.test(name)) return "campus";
  if (/vendor|shop|store|market/.test(name)) return "shop";
  return "default";
}

function levroCategoryArtSvg(key) {
  const arts = {
    scarf: `<path d="M20 31c7-5 13-7 20-5l12 5-5 12-11-5-9 11-8-6 9-12z" fill="#21b7a4"/><path d="M31 26l12 6-7 7-12-5z" fill="#f6c453"/><circle cx="50" cy="25" r="7" fill="#ff6f91"/>`,
    dress: `<path d="M34 18h12l3 12 9 18c1 3-2 6-5 6H25c-3 0-6-3-5-6l9-18 3-12z" fill="#ff6fae"/><path d="M34 18h12l2 8H32z" fill="#ffb3d0"/><circle cx="40" cy="13" r="5" fill="#ffd3b6"/>`,
    mens: `<path d="M27 19l9-6h8l9 6 6 29H21z" fill="#4b7bec"/><path d="M36 13l4 7 4-7 5 5-5 10h-8l-5-10z" fill="#f5f7fb"/><path d="M40 19l-4 9h8z" fill="#1f3f9c"/>`,
    jewelry: `<circle cx="40" cy="37" r="18" fill="none" stroke="#f5c64d" stroke-width="5"/><circle cx="40" cy="18" r="7" fill="#8bd9ff"/><circle cx="40" cy="18" r="4" fill="#fff2a8"/><path d="M25 49c5 4 10 6 15 6s10-2 15-6" fill="none" stroke="#ff8fba" stroke-width="4" stroke-linecap="round"/>`,
    perfume: `<rect x="27" y="25" width="26" height="27" rx="7" fill="#d98cff"/><rect x="33" y="17" width="14" height="9" rx="3" fill="#7e68e8"/><rect x="36" y="12" width="8" height="6" rx="2" fill="#f6c453"/><circle cx="46" cy="38" r="5" fill="#f4e4ff" opacity=".8"/>`,
    food: `<path d="M18 34h44l-4 14H22z" fill="#ffb347"/><path d="M21 31c3-8 11-11 19-6 8-5 16-2 19 6z" fill="#ff6b57"/><rect x="23" y="40" width="34" height="5" rx="2.5" fill="#79c267"/><rect x="22" y="48" width="36" height="5" rx="2.5" fill="#8b4b3e"/>`,
    yogurt: `<path d="M26 25h28l-3 28H29z" fill="#7ad7e9"/><path d="M24 24h32l-3-7H27z" fill="#fff5fb"/><circle cx="40" cy="37" r="7" fill="#ff7da7"/><path d="M34 48h12" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
    shoe: `<path d="M17 42c8 2 13 1 18-5l8-11 8 9 8 7c3 3 2 9-3 10H20c-5 0-7-7-3-10z" fill="#ff5d67"/><path d="M35 37l10 7h13" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M24 49h34" stroke="#6c4bff" stroke-width="4" stroke-linecap="round"/>`,
    bag: `<path d="M22 27h36l-3 28H25z" fill="#9b73e8"/><path d="M30 29c0-11 20-11 20 0" fill="none" stroke="#f6c453" stroke-width="5" stroke-linecap="round"/><path d="M35 42h10" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
    drink: `<path d="M28 20h24l-3 34H31z" fill="#ff8a5b"/><path d="M34 17h12" stroke="#7bd389" stroke-width="4" stroke-linecap="round"/><path d="M48 15c4-6 6-8 7-12" stroke="#58b8ff" stroke-width="3" stroke-linecap="round"/><circle cx="40" cy="34" r="6" fill="#ffd166"/>`,
    beauty: `<rect x="25" y="25" width="30" height="28" rx="9" fill="#ff9fc5"/><rect x="31" y="17" width="18" height="9" rx="3" fill="#8f7cf5"/><path d="M35 38c3-5 7-5 10 0-2 7-8 8-10 0z" fill="#fff3a8"/><circle cx="48" cy="21" r="2" fill="#fff"/>`,
    phone: `<rect x="27" y="13" width="26" height="42" rx="6" fill="#5f86ff"/><rect x="31" y="19" width="18" height="29" rx="3" fill="#c7f1ff"/><circle cx="40" cy="51" r="2.5" fill="#fff"/><circle cx="46" cy="17" r="2" fill="#d9e3ff"/>`,
    electronics: `<rect x="17" y="24" width="46" height="27" rx="6" fill="#6e7bf2"/><rect x="23" y="29" width="34" height="16" rx="3" fill="#b9f2ff"/><path d="M31 57h18" stroke="#f6c453" stroke-width="5" stroke-linecap="round"/>`,
    laptop: `<rect x="21" y="16" width="38" height="28" rx="4" fill="#5d8dff"/><rect x="26" y="21" width="28" height="18" rx="2" fill="#d5f7ff"/><path d="M16 48h48l-6 7H22z" fill="#8d6ce8"/>`,
    health: `<rect x="23" y="19" width="34" height="35" rx="7" fill="#62c9a5"/><path d="M40 26v21M30 36h20" stroke="#fff" stroke-width="6" stroke-linecap="round"/><circle cx="50" cy="24" r="5" fill="#ff7188"/>`,
    home: `<path d="M17 34l23-20 23 20" fill="#ff9a62"/><path d="M23 32h34v23H23z" fill="#ffcf70"/><rect x="36" y="41" width="8" height="14" rx="2" fill="#8c6de0"/><circle cx="28" cy="39" r="4" fill="#fff2a8"/>`,
    car: `<path d="M20 38l6-13h28l7 13 5 3v10H14V41z" fill="#4f8cff"/><circle cx="25" cy="50" r="6" fill="#27364d"/><circle cx="55" cy="50" r="6" fill="#27364d"/><path d="M29 27h20l5 10H24z" fill="#bcecff"/>`,
    books: `<rect x="20" y="22" width="12" height="31" rx="2" fill="#ff6f91"/><rect x="32" y="17" width="13" height="36" rx="2" fill="#6f8dff"/><rect x="45" y="25" width="12" height="28" rx="2" fill="#64cfa4"/><path d="M20 53h37" stroke="#f6c453" stroke-width="4"/>`,
    sport: `<circle cx="40" cy="37" r="19" fill="#f6c453"/><path d="M22 37h36M40 18c7 6 7 31 0 38M28 23c8 5 16 5 24 0M28 51c8-5 16-5 24 0" fill="none" stroke="#fff" stroke-width="3"/>`,
    art: `<path d="M20 47c-4-12 6-27 21-29 14-2 22 7 18 18-4 11-17 2-20 10-3 8-16 9-19 1z" fill="#f08adf"/><circle cx="30" cy="31" r="4" fill="#5d8dff"/><circle cx="43" cy="27" r="4" fill="#ffd166"/><circle cx="51" cy="36" r="4" fill="#67d4a2"/>`,
    baby: `<circle cx="40" cy="28" r="11" fill="#ffd0b5"/><path d="M27 51c2-13 24-13 26 0z" fill="#7fd8e8"/><path d="M31 24c2-10 16-12 20-1-5-3-14-3-20 1z" fill="#8e6ce3"/><circle cx="36" cy="29" r="2" fill="#26334a"/><circle cx="44" cy="29" r="2" fill="#26334a"/>`,
    service: `<path d="M24 48l23-23" stroke="#5f86ff" stroke-width="8" stroke-linecap="round"/><path d="M45 19l8 8M50 18l4 4" stroke="#ff8a5b" stroke-width="5" stroke-linecap="round"/><circle cx="24" cy="48" r="8" fill="#67d4a2"/>`,
    event: `<path d="M20 49c4-18 14-29 20-29s16 11 20 29z" fill="#8e6ce3"/><circle cx="30" cy="38" r="5" fill="#ffd166"/><circle cx="50" cy="38" r="5" fill="#ff6f91"/><path d="M40 20v30" stroke="#fff" stroke-width="3"/>`,
    farm: `<path d="M17 48c7-16 15-24 23-24s16 8 23 24z" fill="#67c982"/><path d="M40 24v30" stroke="#7b5b43" stroke-width="5"/><circle cx="26" cy="34" r="7" fill="#ffd166"/><path d="M21 53h38" stroke="#5f86ff" stroke-width="4" stroke-linecap="round"/>`,
    tools: `<path d="M25 22l28 28" stroke="#6d7cf0" stroke-width="8" stroke-linecap="round"/><path d="M51 20l-5 5 7 7 5-5z" fill="#ff8a5b"/><circle cx="25" cy="48" r="9" fill="#67d4a2"/>`,
    gift: `<rect x="21" y="28" width="38" height="27" rx="4" fill="#ff6f91"/><path d="M40 28v27M21 37h38" stroke="#ffd166" stroke-width="5"/><path d="M40 28c-11 0-13-12-6-13 5-1 8 6 6 13zM40 28c11 0 13-12 6-13-5-1-8 6-6 13z" fill="#67d4a2"/>`,
    clothes: `<path d="M40 16c4 0 6 3 5 6-1 2-5 3-5 7" fill="none" stroke="#9aa6b8" stroke-width="3.5" stroke-linecap="round"/><path d="M14 52L40 33l26 19c2 2 1 5-2 5H16c-3 0-4-3-2-5z" fill="#ff7bac"/><path d="M26 49h28" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".75"/><circle cx="40" cy="45" r="3" fill="#ffd166"/>`,
    delivery: `<rect x="12" y="26" width="34" height="24" rx="4" fill="#5f86ff"/><path d="M46 33h12l8 9v8H46z" fill="#ffb347"/><circle cx="26" cy="52" r="6" fill="#27364d"/><circle cx="56" cy="52" r="6" fill="#27364d"/><circle cx="26" cy="52" r="2.4" fill="#fff"/><circle cx="56" cy="52" r="2.4" fill="#fff"/><path d="M50 36h6l4 6H50z" fill="#d9f2ff"/>`,
    all: `<rect x="14" y="14" width="23" height="23" rx="7" fill="#ff7bac"/><rect x="43" y="14" width="23" height="23" rx="7" fill="#5f86ff"/><rect x="14" y="43" width="23" height="23" rx="7" fill="#f6c453"/><rect x="43" y="43" width="23" height="23" rx="7" fill="#43c59e"/>`,
    campus: `<path d="M40 14L10 29l30 15 30-15z" fill="#5f6ff0"/><path d="M22 37v13c0 5 8 9 18 9s18-4 18-9V37L40 45z" fill="#8f7cf5"/><path d="M66 31v18" stroke="#f6c453" stroke-width="3.5" stroke-linecap="round"/><circle cx="66" cy="52" r="4" fill="#f6c453"/>`,
    shop: `<path d="M13 30l5-14h44l5 14z" fill="#ff7a5c"/><path d="M13 30c0 5 4 7 9 7s9-2 9-7c0 5 4 7 9 7s9-2 9-7c0 5 4 7 9 7s9-2 9-7z" fill="#ffb347"/><rect x="18" y="37" width="44" height="24" rx="2" fill="#fff4de"/><rect x="33" y="44" width="14" height="17" rx="2" fill="#5f86ff"/>`,
    default: `<path d="M20 30h40l-4 26H24z" fill="#7d8cff"/><path d="M29 31c0-12 22-12 22 0" fill="none" stroke="#f6c453" stroke-width="5" stroke-linecap="round"/><rect x="33" y="40" width="14" height="4" rx="2" fill="#fff" opacity=".85"/>`
  };
  const palettes = {
    scarf:["#e8fbf5","#d9f2ff"], dress:["#fff0f7","#efe6ff"], mens:["#edf3ff","#e5f4ff"],
    jewelry:["#fff8df","#ffe8f1"], perfume:["#f6edff","#e9f6ff"], food:["#fff2dc","#ffe9e5"],
    yogurt:["#e9fbff","#fff0f7"], shoe:["#fff0ee","#efeaff"], bag:["#f2ecff","#fff0f6"],
    drink:["#fff0e7","#e8fbf5"], beauty:["#fff0f7","#f0ebff"], phone:["#eaf0ff","#e9fbff"],
    electronics:["#eef0ff","#e7fbff"], laptop:["#eaf1ff","#f2ecff"], health:["#e7fbf4","#eaf4ff"],
    home:["#fff1dc","#fff8e8"], car:["#eaf2ff","#e8fbf5"], books:["#fff0f5","#eaf0ff"],
    sport:["#fff7d9","#e8f8ff"], art:["#fff0fa","#fff8df"], baby:["#eafcff","#f5edff"],
    service:["#eaf1ff","#e8fbf5"], event:["#f0ebff","#fff0f7"], farm:["#eaf9e8","#fff7dc"],
    tools:["#edf0ff","#fff0e7"], gift:["#fff0f5","#fff8df"], clothes:["#fff0f6","#f0ebff"], delivery:["#eaf1ff","#fff4e0"], all:["#fff0f6","#eaf1ff"], campus:["#edf0ff","#f4edff"], shop:["#fff0e8","#fff8e0"], default:["#edf0ff","#e9fbf5"]
  };
  const [a,b] = palettes[key] || palettes.default;
  /*
   * Transparent artwork: the pill itself supplies the surface/background.
   * Keeping the SVG transparent prevents the old white/pastel square from
   * appearing around the illustration in dark and pure-black themes.
   */
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" role="img" aria-hidden="true">${arts[key] || arts.default}</svg>`;
}

function levroSectorArt(sector) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(levroCategoryArtSvg(levroCategoryArtKey(sector)))}`;
}

function levroSectorColor(sector) {
  const hint = levroSectorHint(sector);
  if (hint) return hint[2];
  const name = String(sector?.name || sector?.id || "");
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return LEVRO_SECTOR_FALLBACK_COLORS[h % LEVRO_SECTOR_FALLBACK_COLORS.length];
}
// Shuffled once per session (not per render) so the row doesn't jump around
// when the home view repaints; categories first seen later get their own slot.
function levroStableSectorOrder(list) {
  const rank = window.__levroSectorRank || (window.__levroSectorRank = new Map());
  list.forEach((s) => { const k = String(s.id); if (!rank.has(k)) rank.set(k, Math.random()); });
  return list.slice().sort((a, b) => rank.get(String(a.id)) - rank.get(String(b.id)));
}
// Campus view: true unless the vendor is known to be outside the campus being viewed (unknown -> shown, the page-level
// scope pass hides it once the vendor list has loaded).
function lvVendorVisible(vendorId) {
  try { return typeof window.lvVendorInScope === "function" ? window.lvVendorInScope(vendorId) !== false : true; } catch (_) { return true; }
}
function homeCategoryRailHtml(categoryList) {
  // "All" always comes first and clears the category filter.
  const allActive = !currentHomeCategoryId && !currentSectorId;
  const allChip = `<button type="button" class="levro-home-cat-chip levro-home-cat-all ${allActive ? "active" : ""}" style="--cat-color:var(--primary)" onclick="clearHomeCategoryFilter()"><span class="levro-home-cat-thumb"><img src="${levroSectorArt({name:"All"})}" alt="" loading="eager" decoding="async"></span><span class="levro-home-cat-label">All</span></button>`;
  const chips = levroStableSectorOrder(categoryList).map((c) => {
    const active = String(currentHomeCategoryId || "") === String(c.id);
    const art = levroSectorArt(c);
    return `<button type="button" class="levro-home-cat-chip ${active ? "active" : ""}" data-cat="${esc(c.id)}" style="--cat-color:${levroSectorColor(c)}" onclick="toggleHomeCategoryFilter('${esc(c.id)}')"><span class="levro-home-cat-thumb"><img src="${art}" alt="" loading="lazy" decoding="async"></span><span class="levro-home-cat-label">${esc(c.name)}</span></button>`;
  }).join("");
  return `<div class="levro-home-cat-rail hscroll" aria-label="Browse categories">${allChip}${chips}</div>`;
}
// A category tap re-renders Home against the database for that category, so
// Trending, Featured Vendors, Services, Packages and Browse Everything all
// show only what belongs to it; tapping it again (or All) returns to normal.
let homeCategoryBusy = false;
async function applyHomeCategory(catId) {
  if (homeCategoryBusy) return;          // ignore extra taps while a category is loading
  homeCategoryBusy = true;
  window.__levroRailScroll = byId("app")?.querySelector(".levro-home-cat-rail")?.scrollLeft || 0;
  currentHomeCategoryId = catId || null;
  currentSectorId = null;
  // Instant feedback: highlight the tapped pill and dim what is about to be replaced.
  document.querySelectorAll("#app .levro-home-cat-chip").forEach((c) => c.classList.toggle("active", catId ? c.dataset.cat === String(catId) : c.classList.contains("levro-home-cat-all")));
  const content = byId("app");
  content?.classList.add("home-switching");
  try {
    if (browserLooksOffline() && paintHomeFromLocalCatalog(false)) return;
    window.__levroCategorySwitch = true;   // don't flash the previous page's cached copy
    await navigate("home", {}, false);
  } finally {
    window.__levroCategorySwitch = false;
    content?.classList.remove("home-switching");
    homeCategoryBusy = false;
  }
}
function toggleHomeCategoryFilter(catId) {
  applyHomeCategory(String(currentHomeCategoryId || "") === String(catId) ? null : catId);
}
function clearHomeCategoryFilter() { applyHomeCategory(null); }
