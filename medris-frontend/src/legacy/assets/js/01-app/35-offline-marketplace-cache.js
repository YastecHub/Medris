// ---------- OFFLINE MARKETPLACE CACHE ----------
// Levromart remains a usable browse experience after a previous online visit.
// The service worker keeps the app shell/assets available offline, while this
// small catalogue cache keeps the last useful marketplace data on-device.
const OFFLINE_HOME_CACHE_KEY = "levromart-offline-home-v2";
const OFFLINE_HOME_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
let offlineCatalog = null;
function readOfflineHomeCache() {
  try {
    const raw = localStorage.getItem(OFFLINE_HOME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.savedAt || (Date.now() - parsed.savedAt) > OFFLINE_HOME_CACHE_MAX_AGE) return null;
    return parsed.data || null;
  } catch (e) { return null; }
}
function writeOfflineHomeCache(data) {
  try {
    const compact = {
      categories: data.categories || [],
      sectors: data.sectors || [],
      trending: data.trending || [],
      browseProducts: data.browseProducts || [],
      topVendors: data.topVendors || [],
      recentProducts: data.recentProducts || [],
      packages: data.packages || [],
      carouselSlides: data.carouselSlides || [],
      categoriesWithListings: data.categoriesWithListings || []
    };
    localStorage.setItem(OFFLINE_HOME_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: compact }));
    offlineCatalog = compact;
  } catch (e) {
    // Storage can be full/private-mode restricted. Offline support should
    // never make the normal online marketplace fail.
  }
}
function getOfflineHomeCache() { return offlineCatalog || readOfflineHomeCache(); }
let __levroOfflineEventSeen = false;
function browserLooksOffline() { return __levroOfflineEventSeen && navigator.onLine === false; }
function offlineHomeNotice() {
  return `<div class="offline-browse-notice" role="status"><i class="fa-solid fa-wifi-slash"></i><span>You're offline. Showing the latest Levromart marketplace saved on this device. You can still browse what was previously loaded.</span></div>`;
}
function offlineFilterProducts(products, search, listing, catId, sectorId) {
  const q = String(search || "").trim().toLowerCase();
  const cats = new Map((window.__categories || []).map(c => [String(c.id), c]));
  let out = (products || []).filter(p => {
    const cat = cats.get(String(p.category_id));
    if (sectorId && String(cat?.sector_id) !== String(sectorId)) return false;
    if (catId && String(p.category_id) !== String(catId)) return false;
    if (listing === "rent" && !["rent", "both"].includes(p.listing_type)) return false;
    if (listing === "sale" && !["sale", "both"].includes(p.listing_type)) return false;
    if (q && !`${p.name || ""} ${cat?.name || ""} ${p.vendor?.business_name || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return out;
}
function renderOfflineHomeFromCache(cache, options = {}) {
  if (!cache) return null;
  const categories = cache.categories || [];
  const cachedSectors = cache.sectors || [];
  if (!sectors.length) sectors = cachedSectors;
  window.__categories = categories;
  const activeSector = sectors.find(s => String(s.id) === String(currentSectorId)) || null;
  const activeCategory = categories.find(c => String(c.id) === String(currentHomeCategoryId)) || null;
  const subCats = categories.filter(c => c.parent_category_id && (!activeSector || String(c.sector_id) === String(activeSector.id)));
  const inScope = p => { const cat = categories.find(c => String(c.id) === String(p.category_id)); return (!activeSector || String(cat?.sector_id) === String(activeSector.id)) && (!activeCategory || String(p.category_id) === String(activeCategory.id)); };
  const trending = (cache.trending || []).filter(inScope);
  const packages = (cache.packages || []).filter(pkg => (!activeSector || (pkg.items || []).some(it => String((categories.find(c => String(c.id) === String(it.product?.category_id)) || {}).sector_id) === String(activeSector.id))) && (!activeCategory || (pkg.items || []).some(it => String(it.product?.category_id) === String(activeCategory.id)))).slice(0, 8);
  const topVendors = cache.topVendors || [];
  window.__allHomePackages = cache.packages || [];
  window.__homePackages = packages;
  const recommendedPackages = [...packages].sort((a,b) => {
    const score = pkg => (pkg.items || []).reduce((sum,it) => sum + (favoriteIds.has(it.product?.id) ? 10 : 0), 0);
    return score(b) - score(a);
  }).slice(0, 6);
  const hasPersonalPackageMatch = recommendedPackages.some(pkg => (pkg.items || []).some(it => favoriteIds.has(it.product?.id)));
  const offlineCarousel = Array.isArray(cache.carouselSlides) && cache.carouselSlides.length
    ? cache.carouselSlides
    : INITIAL_HOME_CAROUSEL_SLIDES.slice();
  let html = options.showOfflineNotice === false ? "" : offlineHomeNotice();
  // Categories sit above the promotions. Cached from the last live load
  // (renderHome) so the fast local repaint on every category tap doesn't have
  // to guess; with no cached list yet it shows no categories rather than
  // every sector, because only categories that actually have listings belong.
  const railCategories = Array.isArray(cache.categoriesWithListings) && cache.categoriesWithListings.length ? cache.categoriesWithListings : (window.__levroRailCategories || []);
  if (railCategories.length) html += homeCategoryRailHtml(railCategories);
  html += `<div class="hero levro-home-hero">${renderHomepageCarouselHtml(offlineCarousel)}</div>`;
  html += homeQuickActionsHtml();
  const trendingProducts = deterministicHourlyShuffle((trending || []).filter(p => !p.is_service),"trending-products");
  const trendingServices = deterministicHourlyShuffle((() => { const seen = new Set(); return [...(trending || []), ...(cache.browseProducts || []).filter(inScope)].filter(p => p && p.is_service && !seen.has(p.id) && seen.add(p.id)).slice(0, 12); })(),"trending-services");
  if (trendingProducts.length) html += `<h3 class="section-title"><span><i class='fa-solid fa-fire'></i> Trending now${activeCategory ? ` · ${esc(activeCategory.name)}` : activeSector ? ` · ${esc(activeSector.name)}` : ""}</span><a class="section-title-link" onclick="scrollToBrowse('')">See all <i class="fa-solid fa-arrow-right"></i></a></h3><div class="hscroll trending-scroll">${trendingProducts.map(p=>productCardHtml({...p,_cardContext:"trending"})).join("")}</div>`;
  if (typeof lvHomeBand3 === "function") html += lvHomeBand3();
  if (trendingServices.length) html += `<h3 class="section-title"><i class='fa-solid fa-hand-holding-heart'></i> Trending services${activeCategory ? ` · ${esc(activeCategory.name)}` : activeSector ? ` · ${esc(activeSector.name)}` : ""}</h3><div class="hscroll trending-scroll service-trending-scroll">${trendingServices.map(p=>productCardHtml({...p,_cardContext:"trending"})).join("")}</div>`;
  if (typeof lvHomeBand2 === "function") html += lvHomeBand2();
  if (topVendors.length) { const shuffledTopVendors = deterministicHourlyShuffle(topVendors,"top-rated-vendors"); html += `<h3 class="section-title"><span><i class='fa-solid fa-medal'></i> Featured Vendors</span><a class="section-title-link" onclick="navigate('vendors').then(()=>setTimeout(()=>switchVendorsView('list'),0))">See all <i class="fa-solid fa-arrow-right"></i></a></h3><div class="hscroll top-rated-vendors-scroll" id="topRatedVendors">${shuffledTopVendors.map((x) => vendorPageCardHtml(x, true)).join("")}</div>`; }
  if (recommendedPackages.length) html += `<h3 class="section-title"><span><i class='fa-solid fa-box-open'></i> ${hasPersonalPackageMatch ? "Recommended packages for you" : "Special packages"}</span></h3><div class="hscroll package-recommendation-strip">${recommendedPackages.map(pkg => packageCardHtml(pkg, pkg.vendor?.delivery_fee)).join("")}</div>`;
  window.__homeBrowseCatalog = Array.isArray(cache.browseProducts) ? cache.browseProducts : [];
  if (typeof lvHomeBand === "function") html += lvHomeBand();
  html += `<h3 class="section-title" id="browseSection"><i class='fa-solid fa-shop'></i> Browse ${activeCategory ? esc(activeCategory.name) : activeSector ? `all ${esc(activeSector.name)}` : "everything"}</h3><div class="browse-filter-toolbar"><input type="text" id="searchInput" placeholder="Search marketplace…" oninput="scheduleHomeSearch()" /><button type="button" class="browse-filter-trigger" id="browseFilterTrigger" aria-expanded="false" onclick="toggleBrowseFilters()">${window.LV_FILTER_SVG}<i class="fa-solid fa-chevron-down browse-filter-chevron" aria-hidden="true"></i></button><div class="browse-filter-panel hidden" id="browseFilterPanel"><div class="browse-filter-panel-head"><strong>Filter browse</strong><button type="button" class="icon-btn" onclick="toggleBrowseFilters()" aria-label="Close filters"><i class="fa-solid fa-xmark"></i></button></div><div class="browse-filter-row-group"><button type="button" class="browse-filter-subtrigger" onclick="toggleBrowseSubmenu('listing')"><span>Type</span><strong id="browseListingLabel">${esc("All types")}</strong><i class="fa-solid fa-chevron-down"></i></button><div class="browse-filter-submenu hidden" id="browseListingSubmenu"><button type="button" onclick="chooseBrowseListing('', 'All types')">All types</button><button type="button" onclick="chooseBrowseListing('rent', 'Rent')">Rent</button><button type="button" onclick="chooseBrowseListing('sale', 'Buy')">Buy</button></div></div><div class="browse-filter-row-group"><button type="button" class="browse-filter-subtrigger" onclick="toggleBrowseSubmenu('category')"><span>Category</span><strong id="browseCategoryLabel">${esc(activeCategory?.name || 'All categories')}</strong><i class="fa-solid fa-chevron-down"></i></button><div class="browse-filter-submenu browse-category-submenu hidden" id="browseCategorySubmenu"><input type="search" id="filterCategorySearch" placeholder="Search categories…" oninput="filterBrowseCategoryOptions()" autocomplete="off" /><div id="browseCategoryOptions">${subCats.map(c => `<button type="button" data-value="${c.id}" data-label="${esc(c.name)}" onclick="chooseBrowseCategory('${c.id}','${esc(c.name).replace("'","&#39;")}')">${esc(c.name)}</button>`).join("")}</div><button type="button" onclick="chooseBrowseCategory('','All categories')">All categories</button></div></div><button type="button" class="browse-filter-clear" onclick="clearBrowseFilters()">Clear filters</button></div><select id="filterListing" class="visually-hidden-select" onchange="filterHomeProducts()"><option value="">All types</option><option value="rent">Rent</option><option value="sale">Buy</option></select><select id="filterCategory" class="visually-hidden-select" onchange="filterHomeProducts()"><option value="">All categories</option>${subCats.map(c => `<option value="${c.id}" ${activeCategory?.id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div><div class="grid" id="productGrid"></div><div id="packageSearchResults" class="hidden" style="margin-top:1.3rem;"></div>`;
  setTimeout(filterHomeProducts, 0);
  return html;
}

