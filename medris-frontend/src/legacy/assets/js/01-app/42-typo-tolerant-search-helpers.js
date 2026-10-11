// ---------- typo-tolerant search helpers ----------
function lvNorm(x){ return String(x||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim(); }
function lvLev(a,b){
  if(a===b) return 0; const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
  let prev=Array.from({length:n+1},(_,j)=>j);
  for(let i=1;i<=m;i++){ const cur=[i]; for(let j=1;j<=n;j++){ cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1)); } prev=cur; }
  return prev[n];
}
function lvFuzzyScore(q,name){
  q=lvNorm(q); const n=lvNorm(name); if(!q||!n) return null;
  if(n.includes(q)) return 0;
  const maxd=q.length<=3?0:q.length<=5?1:q.length<=8?2:3;
  let best=99;
  for(const w of n.split(" ")){ if(!w) continue; best=Math.min(best,lvLev(q,w),lvLev(q,w.slice(0,q.length+1))); }
  if(best<=maxd) return 1+best;
  if(q.length>=4){
    const flat=n.replace(/ /g,""); let i=0; for(const c of flat){ if(c===q[i]) i++; if(i===q.length) break; }
    if(i===q.length) return 6;
    const cnt={}; for(const c of flat) cnt[c]=(cnt[c]||0)+1;
    let ok=true; for(const c of q.replace(/ /g,"")){ if(!cnt[c]){ ok=false; break; } cnt[c]--; }
    if(ok) return 7;
  }
  return null;
}
async function lvFuzzyNameIndex(kind){
  window.__lvFuzzyIdx=window.__lvFuzzyIdx||{};
  const hit=window.__lvFuzzyIdx[kind];
  if(hit&&Date.now()-hit.at<600000) return hit.rows;
  let rows=[];
  if(kind==="products"){
    const r=await sb.from("products").select("id,name,vendor:vendors!inner(id)").eq("status","active").eq("vendor.verification_status","verified").eq("vendor.is_active",true).range(0,2999);
    rows=(r.data||[]).map(x=>({id:x.id,name:x.name}));
  }else{
    const r=await sb.from("vendors").select("id,business_name").eq("verification_status","verified").eq("is_active",true).range(0,2999);
    rows=(r.data||[]).map(x=>({id:x.id,name:x.business_name}));
  }
  window.__lvFuzzyIdx[kind]={at:Date.now(),rows};
  return rows;
}
async function lvMergeFuzzyProducts(term,existing,kind){
  const have=new Set(existing.map(r=>String(r.id)));
  const idx=await lvFuzzyNameIndex("products");
  const hits=idx.map(x=>({id:x.id,s:lvFuzzyScore(term,x.name)})).filter(x=>x.s!=null&&!have.has(String(x.id))).sort((a,b)=>a.s-b.s).slice(0,12);
  if(!hits.length) return existing;
  const r=await sb.from("products").select("id,name,photos,sale_price,discount_price,rental_rate,rental_rate_unit,is_service,listing_type,service_price_unit,vendor_id,vendor:vendors(business_name,lat,lng,avg_rating,review_count)").in("id",hits.map(h=>h.id)).eq("status","active");
  const byId_=new Map((r.data||[]).map(x=>[String(x.id),x]));
  const extra=hits.map(h=>byId_.get(String(h.id))).filter(Boolean).filter(p=>kind==="products"?!p.is_service:kind==="services"?!!p.is_service:true).map(p=>({...p,vendor_business_name:p.vendor?.business_name,vendor_lat:p.vendor?.lat,vendor_lng:p.vendor?.lng,vendor_avg_rating:p.vendor?.avg_rating,vendor_review_count:p.vendor?.review_count}));
  return [...existing,...extra];
}
async function lvMergeFuzzyVendors(term,existing){
  const have=new Set(existing.map(v=>String(v.id)));
  const idx=await lvFuzzyNameIndex("vendors");
  const hits=idx.map(x=>({id:x.id,s:lvFuzzyScore(term,x.name)})).filter(x=>x.s!=null&&!have.has(String(x.id))).sort((a,b)=>a.s-b.s).slice(0,8);
  if(!hits.length) return existing;
  const r=await sb.from("vendors").select("id,business_name,logo_url,city,lat,lng,avg_rating,review_count,sector_id").in("id",hits.map(h=>h.id)).eq("verification_status","verified").eq("is_active",true);
  const m=new Map((r.data||[]).map(x=>[String(x.id),x]));
  return [...existing,...hits.map(h=>m.get(String(h.id))).filter(Boolean)];
}
async function runSearchPageQuery(term, saveToHistory) {
  term = String(term || "").trim();
  if (!term) return;
  const mySeq = ++searchPageSeq;
  // Abort whatever the previous keystroke's still-in-flight request was --
  // on a slow/high-latency connection, letting superseded requests keep
  // running just competes with this one for bandwidth and connection slots,
  // making the result the user actually wants arrive even later.
  searchPageAbortController?.abort();
  const controller = new AbortController();
  searchPageAbortController = controller;
  const historyBlock = byId("searchPageHistoryBlock");
  if (historyBlock) historyBlock.hidden = true;
  if (saveToHistory) writeSearchHistory(term);
  const kind = searchPageFilter;
  const wantProducts = kind === "all" || kind === "products" || kind === "services";
  const wantVendors = kind === "all" || kind === "vendors";
  const wantPackages = kind === "all" || kind === "packages";
  let fullRows = [], vends = [], packageRows = [];
  const enc = term.toLowerCase();
  const resultsEl = byId("searchPageResults");
  if (resultsEl && !resultsEl.querySelector(".search-page-section:not(.sr-skel)")) {
    resultsEl.querySelectorAll(".search-page-empty, .search-page-error, .sr-skel").forEach((el) => el.remove());
    resultsEl.insertAdjacentHTML("beforeend", searchSkeletonHtml());
  }
  try {
    // Only the entity types the active tab needs are requested. A single RPC
    // returns full product+vendor fields (no second hydration round trip);
    // Products/Services ask for a wider page and keep their own kind.
    [fullRows, vends, packageRows] = await Promise.all([
      wantProducts ? searchCached(`p2:${kind === "all" ? 20 : 60}:${enc}`, async () => {
        const args = { p_query: term, p_limit: kind === "all" ? 20 : 60 };
        return sb.rpc("search_products_full_v2", args).abortSignal(controller.signal);
      }, controller.signal, true) : [],
      wantVendors ? searchCached(`v2:${kind === "all" ? 6 : 30}:${enc}`, async () => {
        // Vendors match by shop name AND by what they sell: a search for a product or service also surfaces the shops offering it.
        const limit = kind === "all" ? 6 : 30;
        const vendorCols = "id,business_name,logo_url,city,lat,lng,avg_rating,review_count,sector_id";
        const byName = await sb.from("vendors").select(vendorCols).eq("verification_status", "verified").eq("is_active", true).ilike("business_name", `%${term}%`).limit(limit).abortSignal(controller.signal);
        if (byName.error) return byName;
        const prodRes = await sb.rpc("search_products_full_v2", { p_query: term, p_limit: 40 }).abortSignal(controller.signal);
        const known = new Set((byName.data || []).map((v) => String(v.id)));
        const ids = [...new Set((prodRes.data || []).map((r) => r.vendor_id).filter(Boolean).map(String))].filter((id) => !known.has(id)).slice(0, limit);
        let extra = [];
        if (ids.length) {
          const r = await sb.from("vendors").select(vendorCols).in("id", ids).eq("verification_status", "verified").eq("is_active", true).abortSignal(controller.signal);
          extra = r.data || [];
        }
        return { data: [...(byName.data || []), ...extra].slice(0, limit), error: null };
      }, controller.signal, true) : [],
      wantPackages ? searchCached(`k:${kind === "all" ? 6 : 30}:${enc}`, () => sb.from("vendor_packages").select("id,name,price,photos,items:package_items(quantity),vendor:vendors!inner(id,business_name,verification_status,is_active,lat,lng,avg_rating,review_count)").eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true).or(`name.ilike.%${term}%,description.ilike.%${term}%`).limit(kind === "all" ? 6 : 30).abortSignal(controller.signal), controller.signal, true) : [],
    ]);
  } catch (err) {
    if (controller.signal.aborted) return; // superseded by a newer keystroke
    if (mySeq !== searchPageSeq) return;
    const box = byId("searchPageResults");
    if (box) {
      box.querySelectorAll(".search-page-section, .search-page-empty, .search-page-error").forEach((el) => el.remove());
      box.insertAdjacentHTML("beforeend", `<div class="search-page-error" role="alert"><i class="fa-solid fa-triangle-exclamation"></i><strong>Couldn't search right now.</strong><p>Check your connection and try again.</p><button type="button" class="vl-add sr-retry" onclick="runSearchPageQuery(${JSON.stringify(term).replace(/"/g, "&quot;")},false)"><i class="fa-solid fa-rotate-right"></i> Try again</button></div>`);
    }
    return;
  }
  if (mySeq !== searchPageSeq) return;
  let productRows = (fullRows || []).filter((r) => kind === "products" ? !r.is_service : kind === "services" ? !!r.is_service : true).slice(0, kind === "all" ? 20 : 30);
  // Typo-tolerant fallback: a search with few exact hits also lists names that nearly match ("togernu" finds "tigernut").
  if (wantProducts && productRows.length < 4 && term.length >= 3) {
    try { productRows = await lvMergeFuzzyProducts(term, productRows, kind); } catch (_) {}
    if (mySeq !== searchPageSeq) return;
  }
  if (wantVendors && (vends || []).length < 2 && term.length >= 3) {
    try { vends = await lvMergeFuzzyVendors(term, vends || []); } catch (_) {}
    if (mySeq !== searchPageSeq) return;
  }
  // Keep the server's relevance order (best name match first); never re-sort by price.
  const prods = productRows.map((r) => ({
    id: r.id, name: r.name, photos: r.photos, sale_price: r.sale_price, discount_price: r.discount_price,
    rental_rate: r.rental_rate, rental_rate_unit: r.rental_rate_unit, is_service: r.is_service,
    listing_type: r.listing_type, service_price_unit: r.service_price_unit,
    vendor: { id: r.vendor_id, business_name: r.vendor_business_name, lat: r.vendor_lat, lng: r.vendor_lng, avg_rating: r.vendor_avg_rating, review_count: r.vendor_review_count },
  }));
  const vendList = buyerLocation ? [...(vends || [])].sort((a, b) => {
    const da = searchResultDistanceKm(a), db = searchResultDistanceKm(b);
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  }) : (vends || []);
  const packageList = sortSearchResultsByPriceThenDistance(packageRows || [], (pkg) => pkg.price ?? null);

  const results = byId("searchPageResults");
  if (!results) return;
  // Follower counts for the vendors shown (memoised for 3 minutes, one RPC at most).
  const vendListHydrated = vendList.length ? await attachVendorFollowerCounts(vendList) : [];
  if (mySeq !== searchPageSeq) return;
  document.querySelectorAll(".search-page-section, .search-page-empty, .search-page-error").forEach((el) => el.remove());

  const single = kind !== "all";
  const sections = [
    prods.length ? { title: single ? "" : `Products (${prods.length})`, rows: prods.map(searchProductRowHtml) } : null,
    vendList.length ? { title: single ? "" : `Vendors (${vendList.length})`, rows: vendListHydrated.map(searchVendorRowHtml) } : null,
    packageList.length ? { title: single ? "" : `Packages (${packageList.length})`, rows: packageList.map(searchPackageRowHtml) } : null,
  ].filter(Boolean);

  if (!sections.length) {
    // A dead end here (an empty screen with nothing to tap) is worse than an
    // honest "no exact match" note followed by something -- so this always
    // falls through to the same popularity-ranked list the page opens with,
    // clearly labeled as not a match rather than dressed up as one.
    const popularFallback = kind === "all" || kind === "products";
    const noun = { all: "results", products: "products", vendors: "vendors", services: "services", packages: "packages" }[kind];
    results.insertAdjacentHTML("beforeend", `<div class="search-page-empty"><i class="fa-solid fa-magnifying-glass"></i><strong>No results found</strong><p>No ${noun} match "${esc(term)}". Try another search or browse our marketplace.</p><div class="search-empty-actions"><button type="button" class="vl-add sr-retry" onclick="navigate('vendors')"><i class="fa-solid fa-store"></i> Browse vendors</button><button type="button" class="sr-secondary" onclick="navigate('home')"><i class="fa-solid fa-table-cells-large"></i> Browse categories</button></div>${popularFallback ? `<p class="search-empty-note">Here's what's popular right now.</p>` : ""}</div>`);
    // Never a dead end: first try related listings (shorter stem of the words typed), then fall back to what is popular.
    if (!(await renderRelatedSuggestions(term, mySeq))) { if (mySeq === searchPageSeq) await renderSearchPageSuggestions(term); }
  } else {
    results.insertAdjacentHTML("beforeend", sections.map((s) => `<div class="search-page-section">${s.title ? `<h3>${esc(s.title)}</h3>` : ""}${s.rows.join("")}</div>`).join(""));
  }

  // Distances are only shown once we actually have the buyer's position.
  // Kick off (or reuse) that request in the background and quietly re-run
  // this exact query once it resolves, rather than blocking the first paint
  // on a GPS fix.
  if (!buyerLocation) {
    getCustomerLocation().then(() => { if (mySeq === searchPageSeq) runSearchPageQuery(term, false); }).catch(() => {});
  }
}

const PRODUCT_LIST_SELECT = "id, name, category_id, listing_type, sale_price, discount_price, rental_rate, rental_rate_unit, photos, quantity_available, condition, is_service, service_price_unit, payment_timing, payment_deposit_percent, delivery_fee, delivery_fee_mode, delivery_fee_per_km, vendor:vendors!inner(id, business_name, verification_status, logo_url, delivery_fee, delivery_fee_mode, delivery_fee_per_km, lat, lng), category:categories(sector_id)";

// Used whenever a search/filter comes up empty - instead of a dead end,
// show what IS available so the customer isn't stuck looking at nothing.
async function fetchFallbackProducts(excludeIds) {
  if (browserLooksOffline()) {
    const cache = getOfflineHomeCache();
    return offlineFilterProducts(cache?.browseProducts || [], "", "", "", currentSectorId).filter(p => !excludeIds?.includes(p.id)).slice(0, 8);
  }
  let q = sb
    .from("products")
    .select(PRODUCT_LIST_SELECT)
    .eq("status", "active")
    .eq("vendor.verification_status", "verified")
    .eq("vendor.is_active", true);
  if (currentSectorId) q = q.eq("category.sector_id", currentSectorId);
  if (excludeIds?.length) q = q.not("id", "in", `(${excludeIds.join(",")})`);
  const { data } = await q.order("created_at", { ascending: false }).limit(8);
  return data || [];
}

function noResultsWithFallbackHtml(message, fallback) {
  const notice = `<div class="empty-state" style="grid-column:1/-1;padding:1.5rem 1rem;">${esc(message)}</div>`;
  if (!fallback.length) return `<div class="empty-state">No products found. Vendors, start listing!</div>`;
  return notice + fallback.map(productCardHtml).join("");
}

let homeSearchTimer = null;
function scheduleHomeSearch() {
  clearTimeout(homeSearchTimer);
  homeSearchTimer = setTimeout(() => filterHomeProducts(), 160);
}

async function searchHomePackages(term) {
  const q = String(term || "").trim();
  if (!q) return [];
  if (browserLooksOffline()) {
    const needle = q.toLowerCase();
    const cache = getOfflineHomeCache();
    return (cache?.packages || []).filter(pkg => `${pkg.name || ""} ${pkg.description || ""} ${(pkg.items || []).map(it => it.product?.name || "").join(" ")}`.toLowerCase().includes(needle)).slice(0, 8);
  }
  const [{ data: direct }, { data: itemMatches }] = await Promise.all([
    sb.from("vendor_packages").select("id, vendor_id, name, description, price, photos, created_at, vendor:vendors!inner(id,business_name,logo_url,delivery_fee,verification_status,is_active), items:package_items(quantity, product:products(id,name,category_id,photos,category:categories(name,sector_id)))")
      .eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true)
      .or(`name.ilike.%${q}%,description.ilike.%${q}%`).limit(8),
    sb.from("package_items").select("package_id, product:products!inner(name,description)").ilike("product.name", `%${q}%`).limit(30),
  ]);
  const ids = [...new Set([...(direct || []).map((p) => p.id), ...(itemMatches || []).map((r) => r.package_id)])].slice(0, 8);
  if (!ids.length) return [];
  const directById = new Map((direct || []).map((p) => [p.id, p]));
  const missing = ids.filter((id) => !directById.has(id));
  if (missing.length) {
    const { data } = await sb.from("vendor_packages").select("id, vendor_id, name, description, price, photos, created_at, vendor:vendors!inner(id,business_name,logo_url,delivery_fee,verification_status,is_active), items:package_items(quantity, product:products(id,name,category_id,photos,category:categories(name,sector_id)))")
      .eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true).in("id", missing);
    (data || []).forEach((p) => directById.set(p.id, p));
  }
  return ids.map((id) => directById.get(id)).filter(Boolean);
}

async function renderHomePackageSearch(term) {
  const wrap = byId("packageSearchResults");
  if (!wrap) return;
  const q = String(term || "").trim();
  if (!q) { wrap.classList.add("hidden"); wrap.innerHTML = ""; return; }
  wrap.classList.remove("hidden");
  wrap.innerHTML = `<h3 class="section-title"><span><i class="fa-solid fa-box-open"></i> Package matches</span></h3><p class="muted">Searching packages…</p>`;
  const packages = await searchHomePackages(q);
  if (byId("searchInput")?.value.trim() !== q) return;
  wrap.innerHTML = packages.length
    ? `<h3 class="section-title"><span><i class="fa-solid fa-box-open"></i> Package matches</span></h3><div class="grid">${packages.map((pkg) => packageCardHtml(pkg, pkg.vendor?.delivery_fee)).join("")}</div>`
    : `<h3 class="section-title"><span><i class="fa-solid fa-box-open"></i> Package matches</span></h3><div class="empty-state">No package matches for “${esc(q)}”.</div>`;
}

function switchHomeListingTab(tab) {
  homeListingTab = ["products", "services", "packages"].includes(tab) ? tab : "products";
  document.querySelectorAll(".home-catalog-type-tabs .catalog-type-tab").forEach((b) => {
    const key = b.dataset.tab || b.textContent.trim().toLowerCase();
    b.classList.toggle("active", key === homeListingTab);
  });
  const grid = byId("productGrid");
  const packageResults = byId("packageSearchResults");
  const listingFilter = byId("filterListing");
  const categoryFilter = byId("filterCategory");
  if (homeListingTab === "packages") {
    if (listingFilter) listingFilter.style.display = "none";
    if (categoryFilter) categoryFilter.style.display = "none";
    if (packageResults) { packageResults.classList.add("hidden"); packageResults.innerHTML = ""; }
    if (grid) grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fa-solid fa-spinner fa-spin"></i> Loading packages…</div>`;
    renderHomePackageTab().catch((err) => {
      console.warn("[Levromart] Home package tab failed:", err);
      if (grid) grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fa-solid fa-box-open" style="display:block;font-size:1.5rem;margin-bottom:.5rem;"></i>Unable to load packages right now. Please try again.</div>`;
    });
  } else {
    if (listingFilter) listingFilter.style.display = "";
    if (categoryFilter) categoryFilter.style.display = "";
    if (browseFilterTrigger) browseFilterTrigger.style.display = "";
    syncBrowseFilterLabels();
    filterHomeProducts();
  }
}

async function loadHomePackagesForTab() {
  const allCached = Array.isArray(window.__allHomePackages) ? window.__allHomePackages : null;
  if (allCached) return allCached;
  const cached = getOfflineHomeCache()?.packages || [];
  if (cached.length && browserLooksOffline()) {
    window.__allHomePackages = cached;
    window.__homePackages = cached;
    return cached;
  }
  const { data, error } = await sb.from("vendor_packages")
    .select("id, vendor_id, name, description, price, photos, created_at, vendor:vendors!inner(id,business_name,logo_url,delivery_fee,verification_status,is_active), items:package_items(quantity, product:products(id,name,category_id,photos,category:categories(name,sector_id)))")
    .eq("status", "active")
    .eq("vendor.verification_status", "verified")
    .eq("vendor.is_active", true)
    .order("created_at", { ascending:false })
    .limit(50);
  if (error) throw error;
  window.__allHomePackages = data || [];
  window.__homePackages = window.__allHomePackages;
  return window.__allHomePackages;
}

async function renderHomePackageTab() {
  const grid = byId("productGrid");
  if (!grid || homeListingTab !== "packages") return;
  const q = (byId("searchInput")?.value || "").trim().toLowerCase();
  const all = await loadHomePackagesForTab();
  if (homeListingTab !== "packages") return;
  const shown = q ? all.filter(pkg => {
    const text = [pkg.name, pkg.description, ...(pkg.items || []).map(it => it.product?.name || "")].join(" ").toLowerCase();
    return text.includes(q);
  }) : all;
  grid.innerHTML = shown.length
    ? shown.map(pkg => packageCardHtml(pkg, pkg.vendor?.delivery_fee)).join("")
    : `<div class="empty-state" style="grid-column:1/-1;"><i class="fa-solid fa-box-open" style="display:block;font-size:1.5rem;margin-bottom:.5rem;"></i>No packages${q ? ` match “${esc(q)}”` : " available"}.</div>`;
}
function toggleBrowseFilters(force){
  const panel=byId("browseFilterPanel"), trigger=byId("browseFilterTrigger");
  if(!panel||!trigger)return;
  const open = typeof force === "boolean" ? force : panel.classList.contains("hidden");
  panel.classList.toggle("hidden",!open);
  trigger.setAttribute("aria-expanded",String(open));
  trigger.classList.toggle("active",open);
  if(!open){ ["listing","category"].forEach(k=>byId(`browse${k.charAt(0).toUpperCase()+k.slice(1)}Submenu`)?.classList.add("hidden")); }
}
function toggleBrowseSubmenu(kind){
  const id=kind==="listing"?"browseListingSubmenu":kind==="sort"?"browseSortSubmenu":"browseCategorySubmenu";
  const el=byId(id); if(!el)return;
  el.classList.toggle("hidden");
  if(kind==="category" && !el.classList.contains("hidden")) setTimeout(()=>byId("filterCategorySearch")?.focus(),40);
}
function syncBrowseFilterLabels(){
  const listing=byId("filterListing")?.value||"";
  const cat=byId("filterCategory")?.value||"";
  const l=byId("browseListingLabel"); if(l) l.textContent=listing==="rent"?"Rent":listing==="sale"?"Buy":"All types";
  const c=byId("browseCategoryLabel");
  if(c){ const selected=byId("filterCategory")?.options?.[byId("filterCategory")?.selectedIndex||0]; c.textContent=selected?.textContent||"All categories"; }
}
async function ensureVendorCoords(){
  if(window.__vendorCoords)return window.__vendorCoords;
  const map=new Map();
  try{
    for(let off=0;off<20000;off+=1000){
      const {data,error}=await sb.from("vendors").select("id,lat,lng").eq("verification_status","verified").eq("is_active",true).order("id").range(off,off+999);
      if(error)break;
      (data||[]).forEach(v=>{ if(v.lat!=null&&v.lng!=null&&Number.isFinite(Number(v.lat))&&Number.isFinite(Number(v.lng))) map.set(String(v.id),{lat:Number(v.lat),lng:Number(v.lng)}); });
      if(!data||data.length<1000)break;
    }
  }catch(_){}
  window.__vendorCoords=map;
  return map;
}
async function chooseBrowseSort(value,label){
  byId("browseSortSubmenu")?.classList.add("hidden");
  if(value==="near"){
    try{ if(!buyerLocation) await requestCustomerLocation(true); }catch(_){}
    if(!buyerLocation){ showToast?.("Turn on location to sort by closest to you."); return; }
  }
  window.__browseSort=value;
  const l=byId("browseSortLabel"); if(l) l.textContent=label;
  filterHomeProducts();
}
// Closest-first paging: order the catalogue index by vendor distance, then load full rows a page at a time.
async function nearBrowseLoader(index, wantService, matchingIds, catId, listing){
  const coords=await ensureVendorCoords();
  const allow=matchingIds?new Set(matchingIds):null;
  let list=index.filter(x=>!!x.is_service===wantService&&(!catId||String(x.category_id)===String(catId))&&(!allow||allow.has(x.id)));
  const dist=x=>{const c=coords.get(String(x.vendor_id));return c?haversineKm(buyerLocation.lat,buyerLocation.lng,c.lat,c.lng):Infinity};
  list=list.map(x=>({id:x.id,d:dist(x)})).sort((a,b)=>a.d-b.d);
  let offset=0;
  const keep=p=>listing==="rent"?["rent","both"].includes(p.listing_type):listing==="sale"?["sale","both"].includes(p.listing_type):true;
  const loadMore=async()=>{
    while(offset<list.length){
      const ids=list.slice(offset,offset+BROWSE_GRID_PAGE).map(x=>x.id); offset+=ids.length;
      const rows=(await fetchProductsByIds(ids)).filter(keep);
      if(rows.length) return rows;
    }
    return [];
  };
  return { loadMore, more:()=>offset<list.length };
}
function chooseBrowseListing(value,label){
  const select=byId("filterListing"); if(!select)return;
  select.value=value; syncBrowseFilterLabels();
  byId("browseListingSubmenu")?.classList.add("hidden");
  filterHomeProducts();
}
function chooseBrowseCategory(value,label){
  const select=byId("filterCategory"); if(!select)return;
  select.value=value; syncBrowseFilterLabels();
  const input=byId("filterCategorySearch"); if(input) input.value="";
  filterBrowseCategoryOptions();
  byId("browseCategorySubmenu")?.classList.add("hidden");
  filterHomeProducts();
}
function clearBrowseFilters(){
  const l=byId("filterListing"),c=byId("filterCategory"),s=byId("searchInput");
  if(l)l.value=""; if(c)c.value=""; if(s)s.value=""; window.__browseSort=""; { const sl=byId("browseSortLabel"); if(sl) sl.textContent="Recommended"; }
  const catSearch=byId("filterCategorySearch"); if(catSearch)catSearch.value="";
  syncBrowseFilterLabels(); filterBrowseCategoryOptions(); filterHomeProducts(); toggleBrowseFilters();
}

function filterBrowseCategoryOptions() {
  const input = byId("filterCategorySearch");
  const select = byId("filterCategory");
  const optionsWrap = byId("browseCategoryOptions");
  if (!input || !select || !optionsWrap) return;
  if (!select._allCategoryOptions) select._allCategoryOptions = [...select.options].map(o => ({ value:o.value, label:o.textContent }));
  const q = String(input.value || "").trim().toLowerCase();
  const currentValue = String(select.value || "");
  const filtered = select._allCategoryOptions.filter((o, i) => i === 0 || !q || String(o.label).toLowerCase().includes(q));
  optionsWrap.innerHTML = filtered.slice(1).map(o => `<button type="button" data-value="${esc(o.value)}" data-label="${esc(o.label)}" onclick="chooseBrowseCategory('${String(o.value).replace(/'/g,'\&#39;')}','${String(o.label).replace(/'/g,'\&#39;')}')">${esc(o.label)}</button>`).join("");
  select.value = filtered.some(o => String(o.value) === currentValue) ? currentValue : currentValue && !filtered.some(o=>String(o.value)===currentValue) ? "" : currentValue;
  syncBrowseFilterLabels();
}

let homeFilterGeneration = 0;
