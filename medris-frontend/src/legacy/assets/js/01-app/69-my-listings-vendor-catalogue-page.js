// ---------- MY LISTINGS (vendor catalogue page) ----------
// One card system for products, services and packages. Presentation only: every button
// below calls the same handler it always did.
function vlPrice(p) {
  if (p.is_service) return p.sale_price != null ? naira(p.sale_price) + servicePriceSuffix(p) : "";
  const lt = String(p.listing_type || "sale");
  const sale = p.discount_price != null && Number(p.discount_price) > 0 && Number(p.discount_price) < Number(p.sale_price ?? Infinity) ? p.discount_price : p.sale_price;
  if (lt === "rent" && p.rental_rate != null) return `${naira(p.rental_rate)}<small>/${esc(p.rental_rate_unit || "day")}</small>`;
  if (sale != null) return naira(sale);
  if (p.rental_rate != null) return `${naira(p.rental_rate)}<small>/${esc(p.rental_rate_unit || "day")}</small>`;
  return "";
}
function vlPriceValue(p) {
  const lt = String(p.listing_type || "sale");
  if (lt === "rent" && p.rental_rate != null) return Number(p.rental_rate);
  const sale = p.discount_price != null && Number(p.discount_price) > 0 && Number(p.discount_price) < Number(p.sale_price ?? Infinity) ? p.discount_price : p.sale_price;
  return Number(sale ?? p.rental_rate ?? 0) || 0;
}
function vlStatusPill(status) {
  const s = String(status || "active");
  const tone = s === "active" ? "ok" : s === "paused" ? "warn" : s === "removed" ? "bad" : "muted";
  return `<span class="vl-status vl-status-${tone}"><i aria-hidden="true"></i>${esc(s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()))}</span>`;
}
function vlBtn(cls, icon, label, onclick, extra = "") {
  return `<button type="button" class="vl-btn ${cls}" ${onclick ? `onclick="event.stopPropagation();${onclick}"` : ""} ${extra}><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span></button>`;
}
function vlImage(src, alt, icon) {
  return src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" draggable="false" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'vl-img-empty',innerHTML:'<i class=&quot;fa-solid ${icon}&quot;></i>'}))">`
    : `<span class="vl-img-empty"><i class="fa-solid ${icon}"></i></span>`;
}
function vlMenuItem(icon, label, onclick, extra = "") {
  return `<button type="button" role="menuitem" ${onclick ? `onclick="event.stopPropagation();vlCloseMenus();${onclick}"` : ""} ${extra}><i class="fa-solid ${icon}" aria-hidden="true"></i> ${label}</button>`;
}
function vlMenu(items) {
  return `<div class="vl-more-wrap"><button type="button" class="vl-card-more" aria-haspopup="menu" aria-expanded="false" aria-label="More actions" onclick="event.stopPropagation();vlToggleMenu(this)"><i class="fa-solid fa-ellipsis-vertical"></i></button><div class="vl-menu hidden" role="menu">${items.join("")}</div></div>`;
}
function vlToggleMenu(btn) {
  const menu = btn.nextElementSibling;
  const open = menu.classList.contains("hidden");
  vlCloseMenus();
  if (open) { menu.classList.remove("hidden"); btn.setAttribute("aria-expanded", "true"); btn.closest(".vl-card")?.classList.add("vl-menu-open"); }
}
function vlCloseMenus() {
  document.querySelectorAll(".vl-menu").forEach((m) => m.classList.add("hidden"));
  document.querySelectorAll(".vl-card-more").forEach((b) => b.setAttribute("aria-expanded", "false"));
  document.querySelectorAll(".vl-menu-open").forEach((c) => c.classList.remove("vl-menu-open"));
}
document.addEventListener("click", (e) => { if (!e.target.closest?.(".vl-more-wrap")) vlCloseMenus(); });
function vlProductCardHtml(p, ctx) {
  const catName = p.category?.name || "Uncategorized";
  const hasPendingOrder = ctx.pendingProductIds.has(p.id);
  const lt = String(p.listing_type || "sale");
  const typeLabel = p.is_service ? "Service" : lt === "rent" ? "Rental" : lt === "both" ? "Buy & Rent" : "Product";
  const variants = Array.isArray(p.variants) ? p.variants.length : 0;
  const stock = p.is_service ? "" : p.track_quantity === false ? "" : variants ? `${variants} variet${variants === 1 ? "y" : "ies"}` : `Stock: ${Number(p.quantity_available ?? 0)}`;
  const views = Number(p.view_count || 0), orders = Number(ctx.ordersByProduct?.[p.id] || 0);
  const pid = esc(p.id), name = esc(p.name);
  const items = [vlMenuItem("fa-copy", "Duplicate", `openDuplicateProductModal('${pid}')`)];
  if (p.status === "active") items.push(vlMenuItem("fa-pause", "Pause listing", `setProductStatus('${pid}','paused')`));
  else if (p.status === "paused") {
    if (p.billing_model === "monthly") {
      if (listingActivationValid(p)) items.push(vlMenuItem("fa-play", "Resume listing", `setProductStatus('${pid}','active')`));
      else if (ctx.pendingMonthlyProductIds.has(String(p.id))) items.push(vlMenuItem("fa-clock", "Receipt submitted", "", "disabled"));
      else items.push(vlMenuItem("fa-receipt", p.billing_status === "pending_payment" ? "Submit ₦999 receipt" : "Renew ₦999", `startListingMonthlyPayment('product','${pid}')`));
    } else items.push(vlMenuItem("fa-play", "Activate listing", `setProductStatus('${pid}','active')`));
  }
  const delBtn = `<button type="button" class="vl-btn vl-btn-delete" onclick="event.stopPropagation();removeProduct('${pid}')" ${hasPendingOrder ? `disabled title="Can't remove: this product has a pending order" aria-label="Delete ${name} (unavailable: pending order)"` : `aria-label="Delete ${name}"`}><i class="fa-solid fa-trash" aria-hidden="true"></i><span>Delete</span></button>`;
  return `<article class="vl-card" data-vp-created="${esc(p.created_at || "")}" data-vp-kind="${p.is_service ? "services" : "products"}" data-vp-name="${esc((p.name || "").toLowerCase())}" data-vp-cat="${esc(catName.toLowerCase())}" data-vp-status="${esc(p.status || "")}" data-vp-mode="${p.is_service ? "" : lt}" data-vp-price="${vlPriceValue(p)}" onclick="showVendorProductDetails('${pid}')" role="button" tabindex="0" aria-label="Open ${name}" onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();showVendorProductDetails('${pid}');}">
    <div class="vl-media">${vlImage(p.photos?.[0], p.name, p.is_service ? "fa-hand-holding-heart" : "fa-camera")}</div>
    <div class="vl-body"><div class="vl-top"><h4 class="vl-name">${name}</h4>${vlStatusPill(p.status)}${vlMenu(items)}</div>
      <b class="vl-price">${vlPrice(p)}</b>
      <span class="vl-meta"><span class="vl-kind"><i class="fa-solid ${p.is_service ? "fa-hand-holding-heart" : "fa-box"}" aria-hidden="true"></i> ${typeLabel}</span><span><i class="fa-solid fa-chart-simple" aria-hidden="true"></i> ${views.toLocaleString()} view${views === 1 ? "" : "s"}</span><span><i class="fa-solid fa-cart-shopping" aria-hidden="true"></i> ${orders.toLocaleString()} order${orders === 1 ? "" : "s"}</span>${stock ? `<span>${esc(stock)}</span>` : ""}</span>
      <div class="vl-actions">${vlBtn("vl-btn-edit", "fa-pen", "Edit", `openEditProductModal('${pid}')`, `aria-label="Edit ${name}"`)}${vlBtn("vl-btn-view", "fa-eye", "View", `navigate('productDetail',{productId:'${pid}'})`, `aria-label="View ${name}"`)}${delBtn}</div></div>
  </article>`;
}
function vlPackageCardHtml(pkg, pendingIds) {
  const pid = esc(pkg.id), name = esc(pkg.name);
  const items = pkg.items || [];
  const menu = [];
  if (pkg.status === "active") menu.push(vlMenuItem("fa-pause", "Pause listing", `setPackageStatus('${pid}','paused')`));
  else if (pkg.billing_model === "monthly") {
    if (pendingIds.has(String(pkg.id))) menu.push(vlMenuItem("fa-clock", "Receipt submitted", "", "disabled"));
    else menu.push(vlMenuItem("fa-receipt", pkg.billing_status === "pending_payment" ? "Submit ₦999 receipt" : "Renew ₦999", `startListingMonthlyPayment('package','${pid}')`));
  } else menu.push(vlMenuItem("fa-play", "Activate listing", `setPackageStatus('${pid}','active')`));
  return `<article class="vl-card vl-card-pkg" data-vp-created="${esc(pkg.created_at || "")}" data-vp-kind="packages" data-vp-name="${esc((pkg.name || "").toLowerCase())}" data-vp-cat="package" data-vp-status="${esc(pkg.status || "")}" data-vp-mode="" data-vp-price="${Number(pkg.price || 0)}" onclick="navigate('packageDetail',{packageId:'${pid}'})" role="button" tabindex="0" aria-label="Open ${name}" onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();navigate('packageDetail',{packageId:'${pid}'});}">
    <div class="vl-media">${vlImage(Array.isArray(pkg.photos) ? pkg.photos[0] : null, pkg.name, "fa-box-open")}</div>
    <div class="vl-body"><div class="vl-top"><h4 class="vl-name">${name}</h4>${vlStatusPill(pkg.status)}${vlMenu(menu)}</div>
      <b class="vl-price">${naira(pkg.price)}</b>
      <span class="vl-meta"><span class="vl-kind"><i class="fa-solid fa-box-open" aria-hidden="true"></i> Package</span><span>${items.length} item${items.length === 1 ? "" : "s"}</span></span>
      <div class="vl-actions">${vlBtn("vl-btn-edit", "fa-pen", "Edit", `openEditPackageModal('${pid}')`, `aria-label="Edit ${name}"`)}${vlBtn("vl-btn-view", "fa-eye", "View", `navigate('packageDetail',{packageId:'${pid}'})`, `aria-label="View ${name}"`)}${vlBtn("vl-btn-delete", "fa-trash", "Delete", `deletePackage('${pid}')`, `aria-label="Delete ${name}"`)}</div></div>
  </article>`;
}
async function vlFetchPackages(vendorId) {
  try {
    const [{ data: packages, error }, { data: subs }] = await Promise.all([
      sb.from("vendor_packages").select("*, items:package_items(quantity, product:products(name))").eq("vendor_id", vendorId).order("created_at", { ascending: false }),
      sb.from("monthly_listing_submissions").select("listing_id,status").eq("vendor_id", vendorId).eq("kind", "package").order("submitted_at", { ascending: false }).limit(100),
    ]);
    return { packages: packages || [], error: error || null, pendingIds: new Set((subs || []).filter((x) => x.status === "pending").map((x) => String(x.listing_id))) };
  } catch (error) { return { packages: [], error, pendingIds: new Set() }; }
}
function vlSkeletonHtml() {
  return `<div class="vl-page vl-skel" aria-hidden="true"><div class="vl-skel-line vl-skel-w40"></div><div class="vl-skel-line vl-skel-title"></div><div class="vl-skel-tabs"><span></span><span></span><span></span></div><div class="vl-grid">${Array.from({ length: 4 }, () => `<div class="vl-card"><div class="vl-media vl-skel-block"></div><div class="vl-body"><div class="vl-skel-line vl-skel-w80"></div><div class="vl-skel-line vl-skel-w50"></div></div></div>`).join("")}</div></div>`;
}
const VL_LABELS = { all: "listings", products: "products", services: "services", packages: "packages" };
function vlRefreshEmpty() {
  const empty = byId("vlEmpty");
  if (!empty) return;
  const tab = document.querySelector("#vendorProductsTypeTabs .active")?.dataset.tab || "products";
  const cards = [...document.querySelectorAll("#app .vl-card")].filter((c) => tab === "all" || c.dataset.vpKind === tab);
  const visible = cards.filter((c) => !c.classList.contains("vl-filtered"));
  const cnt = byId("vlCount"); if (cnt) cnt.textContent = `(${visible.length})`;
  empty.classList.toggle("hidden", visible.length > 0);
  if (visible.length) return;
  if (!cards.length) {
    const noun = { all: "listings", products: "products", services: "services", packages: "packages" }[tab];
    const cta = tab === "packages" ? ["Add Package", "openAddPackageModal()"] : tab === "services" ? ["Add Service", "openAddProductModal()"] : [tab === "all" ? "Add Listing" : "Add Product", "openAddProductModal()"];
    empty.innerHTML = `<span class="vl-empty-ico"><i class="fa-solid ${tab === "packages" ? "fa-box-open" : tab === "services" ? "fa-hand-holding-heart" : "fa-box"}"></i></span><strong>No ${noun} yet.</strong><p>Add your first ${tab === "all" ? "listing" : noun.replace(/s$/, "")} to start selling on LevroMart.</p><button type="button" class="vl-add" onclick="${cta[1]}"><i class="fa-solid fa-plus"></i> ${cta[0]}</button>`;
  } else {
    empty.innerHTML = `<span class="vl-empty-ico"><i class="fa-solid fa-magnifying-glass"></i></span><strong>No listings found.</strong><p>Try a different search or filter.</p>`;
  }
}
function vlSyncSelectLabels() {
  const f = byId("vendorProductFilter"), s = byId("vendorProductSort");
  const fl = byId("vlFilterLabel"), sl = byId("vlSortLabel");
  if (f && fl) fl.textContent = f.value === "all" ? "Filter" : f.selectedOptions[0]?.textContent || "Filter";
  f?.closest(".vl-select")?.classList.toggle("is-set", !!f && f.value !== "all");
  if (s && sl) sl.textContent = s.selectedOptions[0]?.textContent || "Sort";
}

async function renderVendorProducts() {
  if (!session || profile?.role === "admin" || (profile?.role !== "vendor" && !vendor)) return '<div class="empty-state">Access denied.</div>';
  const { data: v } = await sb.from("vendors").select("*").eq("user_id", session.user.id).is("deleted_at", null).maybeSingle();
  if (!v) { navigate("vendorApply"); return '<p class="muted">Redirecting…</p>'; }
  vendor = v;

  const [{ data: allVendorProducts, error: productsError }, { data: orderItems }, { data: regionRows }, { data: monthlyProductSubmissions }, pkgResult] = await Promise.all([
    sb.from("products").select("*, category:categories(name)").eq("vendor_id", v.id).order("created_at", { ascending: false }),
    sb.from("order_items").select("product_id, quantity, unit_price, order:orders!inner(status, vendor_id)").eq("order.vendor_id", v.id),
    sb.rpc("get_vendor_product_regions", { p_vendor_id: v.id }),
    sb.from("monthly_listing_submissions").select("listing_id,status,submitted_at,review_note").eq("vendor_id", v.id).order("submitted_at", { ascending: false }).limit(100),
    vlFetchPackages(v.id),
  ]);
  // A failed query must never look like "no listings".
  if (productsError) return `<div class="vl-page"><div class="vl-empty"><span class="vl-empty-ico"><i class="fa-solid fa-triangle-exclamation"></i></span><strong>Couldn't load your listings.</strong><p>Please check your connection and try again.</p><button type="button" class="vl-add" onclick="navigate('vendorProducts',{},false)"><i class="fa-solid fa-rotate-right"></i> Try Again</button></div></div>`;
  const pendingMonthlyProductIds = new Set((monthlyProductSubmissions || []).filter(x => x.status === "pending").map(x => String(x.listing_id)));
  const products = (allVendorProducts || []).filter((p) => p.status !== "removed");
  const removedProducts = (allVendorProducts || []).filter((p) => p.status === "removed");
  // Load all varieties for the vendor's current listings in one query so the
  // My Products page can show the same saved variety state as the editor.
  const productIds = products.map(p => p.id).filter(Boolean);
  const { data: vendorProductVariants } = productIds.length
    ? await sb.from("product_variants").select("*").in("product_id", productIds).order("sort_order", { ascending: true }).order("created_at", { ascending: true })
    : { data: [] };
  const variantsByProduct = {};
  (vendorProductVariants || []).forEach(vr => { (variantsByProduct[vr.product_id] ||= []).push(vr); });
  products.forEach(p => { p.variants = variantsByProduct[p.id] || []; });
  // Already sorted order_count desc per product by the RPC -- [0] of each
  // group is that product's single busiest region.
  const regionsByProduct = {};
  (regionRows || []).forEach((r) => { (regionsByProduct[r.product_id] ||= []).push(r); });
  window.__vendorProductRegions = regionsByProduct;
  const { data: favCountRows } = (products || []).length
    ? await sb.rpc("get_favorite_counts", { p_product_ids: products.map((p) => p.id) })
    : { data: [] };
  const favCountByProduct = {};
  (favCountRows || []).forEach((r) => { favCountByProduct[r.product_id] = r.count; });
  const revenueByProduct = {};
  const ordersByProduct = {};
  const pendingProductIds = new Set();
  const PENDING_ORDER_STATUSES = new Set(["pending", "confirmed", "handed_over", "returned", "disputed"]);
  (orderItems || []).forEach((oi) => {
    ordersByProduct[oi.product_id] = (ordersByProduct[oi.product_id] || 0) + 1;
    if (oi.order?.status === "completed") revenueByProduct[oi.product_id] = (revenueByProduct[oi.product_id] || 0) + oi.quantity * oi.unit_price;
    if (PENDING_ORDER_STATUSES.has(oi.order?.status)) pendingProductIds.add(oi.product_id);
  });
  window.__vendorPendingProductIds = pendingProductIds;

  const vlProducts = products.filter((x) => !x.is_service).length;
  const vlServices = products.filter((x) => x.is_service).length;
  const vlPackages = pkgResult.packages.length;
  let html = `<div class="vl-page"><div class="vl-head">
    <div class="vl-head-top"><span class="vl-eyebrow"><i class="fa-solid fa-store"></i> Seller dashboard</span></div>
    <div class="vl-head-row"><div class="vl-head-copy"><h2>My Listings</h2><p>Manage your products, services and packages in one place.</p></div>
      </div>
  </div>
  <button type="button" class="vl-add vl-add-wide" onclick="openAddProductModal()"><i class="fa-solid fa-plus"></i> Add Listing</button>`;
  if (v.verification_status !== "verified") html += `<p class="vl-note"><i class="fa-solid fa-circle-info"></i> Listings won't appear publicly until your vendor account is verified.</p>`;

  const vlTab = (tab, icon, label, n) => `<button type="button" data-tab="${tab}" role="tab" onclick="switchVendorListingTab('${tab}')"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span><em>${n}</em></button>`;
  html += `<div class="vl-tabs" id="vendorProductsTypeTabs" role="tablist" aria-label="Listing type">${vlTab("all", "fa-table-cells-large", "All Listings", vlProducts + vlServices + vlPackages)}${vlTab("products", "fa-box", "Products", vlProducts)}${vlTab("services", "fa-hand-holding-heart", "Services", vlServices)}${vlTab("packages", "fa-box-open", "Packages", vlPackages)}</div>
  <div class="vl-discarded"><span class="vl-discarded-ico"><i class="fa-solid fa-trash-can"></i></span><div><strong>Discarded items${removedProducts.length ? ` (${removedProducts.length})` : ""}</strong><p>Products removed from your live catalogue stay here when order history prevents permanent deletion.</p></div><button type="button" onclick="toggleVendorDiscarded(event,true)" aria-label="View discarded items">View <i class="fa-solid fa-chevron-right"></i></button></div>`;

  html += `<div id="vendorDiscardedPanel" class="vendor-discarded-panel hidden">
    <div class="vendor-discarded-head"><div><strong>Discarded items</strong><span class="muted">Products removed from your live catalogue stay here when order history prevents permanent deletion.</span></div><button type="button" class="icon-btn" aria-label="Close discarded items" onclick="toggleVendorDiscarded(event,false)"><i class="fa-solid fa-xmark"></i></button></div>
    ${removedProducts.length ? `<div class="vendor-discarded-bulkbar"><label><input type="checkbox" id="discardedSelectAll" onchange="toggleAllDiscardedItems(this.checked)"> <span>Select all</span></label><span id="discardedSelectedCount" class="muted">0 selected</span><button type="button" class="btn btn-sm btn-danger" id="discardedBulkDeleteBtn" disabled onclick="deleteSelectedDiscardedItems()"><i class="fa-solid fa-trash-can"></i> Delete selected</button></div><div class="vendor-discarded-grid">${removedProducts.map((p) => { const img=p.photos?.[0]; const expired=p.billing_model==='monthly' && (!p.billing_paid_until || new Date(p.billing_paid_until).getTime()<=Date.now()); return `<div class="vendor-discarded-card" data-discarded-id="${esc(p.id)}" data-discarded-name="${esc((p.name||'').toLowerCase())}"><label class="discarded-select"><input type="checkbox" class="discarded-item-check" value="${esc(p.id)}" onchange="updateDiscardedSelection()" aria-label="Select ${esc(p.name)}"></label><div class="product-img">${img ? `<img src="${esc(lvThumb(img, 280))}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fa-solid fa-box-open"></i>`}</div><div class="vendor-discarded-copy"><strong>${esc(p.name)}</strong><span>${p.billing_model==='monthly' ? (expired ? 'Monthly listing expired' : 'Monthly listing paid') : 'Commission listing'} · removed</span><div class="vendor-discarded-actions"><button type="button" class="btn btn-sm" onclick="restoreProduct('${p.id}')"><i class="fa-solid fa-rotate-left"></i> Restore</button><button type="button" class="btn btn-sm btn-danger" onclick="deleteProductCompletely('${p.id}')"><i class="fa-solid fa-trash-can"></i> Delete permanently</button></div></div></div>`; }).join('')}</div>` : `<div class="empty-state" style="margin:0;">No discarded products.</div>`}
  </div>`;

  const packageSection = "";
  html += `<div class="vl-tools">
    <h3 class="vl-listtitle">Your listings <span id="vlCount"></span></h3>
    <label class="vl-select vl-select-filter"><i class="fa-solid fa-filter" aria-hidden="true"></i><span id="vlFilterLabel">Filter</span><i class="fa-solid fa-chevron-down vl-chev" aria-hidden="true"></i>
      <select id="vendorProductFilter" aria-label="Filter listings" onchange="vlOnFilterChange()"><option value="all">All listings</option><option value="active">Active</option><option value="paused">Paused</option><option value="sale">Buy</option><option value="rent">Rent</option><option value="removed">Removed (${removedProducts.length})</option></select></label>
    <label class="vl-select vl-select-sort"><i class="fa-solid fa-arrow-up-wide-short" aria-hidden="true"></i><span id="vlSortLabel">Newest first</span><i class="fa-solid fa-chevron-down vl-chev" aria-hidden="true"></i>
      <select id="vendorProductSort" aria-label="Sort listings" onchange="filterVendorProducts()"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="price_low">Price: Low to High</option><option value="price_high">Price: High to Low</option><option value="az">Name A–Z</option><option value="za">Name Z–A</option></select></label>
  </div>
  <label class="vl-search vl-search-row"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" id="vendorProductSearch" placeholder="Search your listings..." autocomplete="off" enterkeyhint="search" aria-label="Search your listings" oninput="filterVendorProducts()" /></label>`;

  if (vendorProductsView === "table" && products && products.length > 0) {
    const totalRevenue = Object.values(revenueByProduct).reduce((s, n) => s + n, 0);
    const totalUnits = products.reduce((s, p) => s + p.quantity_total, 0);
    html += `<div class="accordion-section" style="max-width:600px;margin-bottom:1rem;">
      <button class="accordion-trigger" onclick="toggleAccordion(this)"><span><i class="fa-solid fa-chart-simple"></i> Summary</span><i class="fa-solid fa-chevron-down accordion-chevron"></i></button>
      <div class="accordion-body">
        <table class="order-stats-table">
          <tr><td>Products</td><td>${products.length}</td></tr>
          <tr><td>Total units</td><td>${totalUnits}</td></tr>
          <tr><td>Revenue (completed)</td><td>${naira(totalRevenue)}</td></tr>
        </table>
      </div>
    </div>`;
    html += `<div class="table-wrap" style="max-height:26rem;overflow-y:auto;"><table class="data-table"><thead><tr>
      <th>Product</th><th>Category</th><th>Varieties</th><th>Price</th><th>Qty avail / total</th><th>Views</th><th>Saved</th><th>Revenue</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody>`;
    products.forEach((p, i) => {
      const topRegion = regionsByProduct[p.id]?.[0];
      html += `<tr onclick="event.stopPropagation();openEditProductModal('${p.id}')" style="cursor:pointer;" data-vp-created="${esc(p.created_at || "")}" data-vp-kind="${p.is_service ? "services" : "products"}" data-vp-name="${esc((p.name || "").toLowerCase())}" data-vp-cat="${esc((p.category?.name || "").toLowerCase())}">
        <td>${esc(p.name)}</td>
        <td>${esc(p.category?.name || "Uncategorized")}</td>
        <td>${p.variants?.length || 0}</td>
        <td>${p.sale_price != null ? naira(p.sale_price) + servicePriceSuffix(p) : ""}${p.sale_price != null && p.rental_rate != null ? " / " : ""}${p.rental_rate != null ? naira(p.rental_rate) + "/" + p.rental_rate_unit : ""}</td>
        <td>${p.is_service ? "-" : p.track_quantity === false ? "Untracked" : (p.variants?.length ? "Per variety" : `${p.quantity_available} / ${p.quantity_total}`)}</td>
        <td>${p.view_count || 0}</td>
        <td>${favCountByProduct[p.id] ?? 0}</td>
        <td>${naira(revenueByProduct[p.id] || 0)}</td>
        <td><span class="badge ${p.status === "active" ? "success" : p.status === "paused" ? "warning" : "danger"}">${esc(p.status)}</span></td>
        <td><div class="vendor-product-table-actions">
          <button type="button" class="btn btn-sm" onclick="event.stopPropagation();openEditProductModal('${p.id}')" title="Edit listing"><i class="fa-solid fa-pen"></i><span class="sr-only">Edit</span></button>
          <button type="button" class="btn btn-sm btn-outline" onclick="event.stopPropagation();openDuplicateProductModal('${p.id}')" title="Duplicate listing"><i class="fa-solid fa-copy"></i><span class="sr-only">Duplicate</span></button>
        </div></td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    return html + packageSection;
  }

  html += `<div class="vl-grid" id="vlGrid">`;
  const vendorProductDetailsMap = {};
  products.forEach((p) => {
      const catName = p.category?.name || "Uncategorized";
      const img = p.photos?.[0];
      const favCount = favCountByProduct[p.id] ?? 0;
      const hasPendingOrder = pendingProductIds.has(p.id);
      const topRegion = regionsByProduct[p.id]?.[0];
      // Everything below used to sit directly on the card face (status,
      // views/saved/revenue, varieties, best-selling region, pending-order
      // warning) and made a grid of listings unreadable. It's still all
      // here -- just moved behind a tap on the card into a details popup,
      // so the surface only shows the photo, name and the action buttons.
      vendorProductDetailsMap[p.id] = { name: p.name, html: `
        <p class="muted">${p.is_service ? "Service" : `${p.listing_type} · ${p.track_quantity === false ? "always available" : `${p.quantity_available}/${p.quantity_total} available`}`} · ${p.status}${p.billing_model === "monthly" && p.billing_paid_until ? listingExpiryMarkup(p) : ""}</p>
        ${p.billing_model === "monthly" && pendingMonthlyProductIds.has(String(p.id)) ? `<p class="muted monthly-vendor-pending-note"><i class="fa-solid fa-clock"></i> Receipt submitted · awaiting admin approval</p>` : p.billing_model === "monthly" && p.billing_status === "cancelled" ? `<p class="muted monthly-vendor-rejected-note"><i class="fa-solid fa-circle-exclamation"></i> Monthly listing deactivated. Submit a new ₦999 receipt to restore it.</p>` : ""}
        <p class="muted"><i class='fa-solid fa-eye'></i> ${p.view_count || 0} views · <i class='fa-solid fa-heart'></i> ${favCount} saved · <i class="fa-solid fa-sack-dollar"></i> ${naira(revenueByProduct[p.id] || 0)}</p>
        ${Array.isArray(p.variants) && p.variants.length ? `<p class="muted vendor-product-variety-summary"><i class="fa-solid fa-layer-group"></i> ${p.variants.length} variet${p.variants.length===1?'y':'ies'} · ${p.variants.slice(0,3).map(v=>esc(v.name)).join(', ')}${p.variants.length>3?'…':''}</p>` : ''}
        ${topRegion ? `<p class="muted"><i class="fa-solid fa-map-location-dot"></i> Sells best in <a href="#" onclick="event.stopPropagation();showProductRegions('${p.id}','${esc(p.name).replace(/'/g, "\\'")}');return false;">${esc(topRegion.city)} (${topRegion.order_count} order${topRegion.order_count === 1 ? "" : "s"})</a></p>` : ""}
        ${hasPendingOrder ? `<p class="muted" style="color:var(--danger,#dc2626);"><i class="fa-solid fa-circle-exclamation"></i> Has a pending order, can't be removed until it's cleared</p>` : ""}
      ` };
      html += vlProductCardHtml(p, { pendingProductIds, pendingMonthlyProductIds, ordersByProduct });
    });
  pkgResult.packages.forEach((pkg) => { html += vlPackageCardHtml(pkg, pkgResult.pendingIds); });
  html += `</div><div class="vl-empty hidden" id="vlEmpty" role="status"></div>${pkgResult.error ? `<p class="vl-note vl-note-bad"><i class="fa-solid fa-triangle-exclamation"></i> Couldn't load your packages. <a href="#" onclick="navigate('vendorProducts',{},false);return false;">Try again</a></p>` : ""}</div>`;

  window.__vendorProductCardDetails = vendorProductDetailsMap;
  return html + packageSection;
}
function showVendorProductDetails(productId){
  const d = (window.__vendorProductCardDetails || {})[productId];
  if (!d) return;
  byId("vendorProductDetailsTitle").textContent = d.name;
  byId("vendorProductDetailsBody").innerHTML = d.html;
  const viewBtn = byId("vendorProductDetailsViewBtn");
  if (viewBtn) viewBtn.onclick = () => { byId("vendorProductDetailsModal").classList.add("hidden"); navigate("productDetail", { productId }); };
  byId("vendorProductDetailsModal").classList.remove("hidden");
}

function showProductRegions(productId, productName) {
  const rows = window.__vendorProductRegions?.[productId] || [];
  byId("productRegionsTitle").textContent = productName;
  const maxCount = Math.max(...rows.map((r) => r.order_count), 1);
  byId("productRegionsBody").innerHTML = rows.length
    ? rows.map((r) => `<div style="margin:0.5rem 0;">
        <div class="flex" style="justify-content:space-between;font-size:0.85rem;"><span>${esc(r.city)}</span><span class="muted">${r.order_count} order${r.order_count === 1 ? "" : "s"} · ${r.total_units} unit${r.total_units === 1 ? "" : "s"}</span></div>
        <div style="height:0.4rem;background:var(--border);border-radius:999px;overflow:hidden;margin-top:0.2rem;"><div style="height:100%;width:${(r.order_count / maxCount) * 100}%;background:var(--primary);"></div></div>
      </div>`).join("")
    : `<p class="muted">No orders yet for this product.</p>`;
  byId("productRegionsModal").classList.remove("hidden");
}
function vlOnFilterChange() {
  const f = byId("vendorProductFilter");
  if (f?.value === "removed") {
    // "Removed" lives in the Discarded items panel; show it and fall back to the previous filter.
    f.value = f.dataset.prev || "all";
    toggleVendorDiscarded(null, true);
  } else if (f) f.dataset.prev = f.value;
  filterVendorProducts();
}
function filterVendorProducts() {
  const q = (byId("vendorProductSearch")?.value || "").trim().toLowerCase();
  const sort = byId("vendorProductSort")?.value || "newest";
  const filter = byId("vendorProductFilter")?.value || "all";
  const compare = (a, b) => {
    const da = a.dataset, db = b.dataset;
    if (sort === "newest") return (Date.parse(db.vpCreated) || 0) - (Date.parse(da.vpCreated) || 0);
    if (sort === "oldest") return (Date.parse(da.vpCreated) || 0) - (Date.parse(db.vpCreated) || 0);
    if (sort === "price_low") return (Number(da.vpPrice) || 0) - (Number(db.vpPrice) || 0);
    if (sort === "price_high") return (Number(db.vpPrice) || 0) - (Number(da.vpPrice) || 0);
    return (sort === "za" ? -1 : 1) * String(da.vpName || "").trim().localeCompare(String(db.vpName || "").trim(), undefined, { sensitivity: "base", numeric: true });
  };
  const okFilter = (el) => {
    if (filter === "all") return true;
    if (filter === "active" || filter === "paused") return el.dataset.vpStatus === filter;
    if (filter === "sale") return ["sale", "both"].includes(el.dataset.vpMode);
    if (filter === "rent") return ["rent", "both"].includes(el.dataset.vpMode);
    return true;
  };
  // Search / filter use their own class so they never fight the tab switcher's "hidden".
  document.querySelectorAll("#app [data-vp-name]").forEach((el) => {
    const matches = (!q || el.dataset.vpName.includes(q) || (el.dataset.vpCat || "").includes(q)) && okFilter(el);
    el.classList.toggle("vl-filtered", !matches);
  });
  // Reorder within the existing DOM rather than rebuilding the page.
  const grid = byId("vlGrid");
  if (grid) { const frag = document.createDocumentFragment(); [...grid.querySelectorAll(".vl-card")].sort(compare).forEach((el) => frag.appendChild(el)); grid.appendChild(frag); }
  vlSyncSelectLabels();
  vlRefreshEmpty();
}

function switchVendorListingTab(tab) {
  tab = String(tab || "products");
  if (!["all", "products", "services", "packages"].includes(tab)) tab = "products";
  document.querySelectorAll("#vendorProductsTypeTabs [data-tab]").forEach((btn) => { const on = btn.dataset.tab === tab; btn.classList.toggle("active", on); btn.setAttribute("aria-selected", String(on)); });
  document.querySelectorAll("#app [data-vp-kind]").forEach((el) => el.classList.toggle("hidden", tab !== "all" && el.dataset.vpKind !== tab));
  try { localStorage.setItem("levromart-vendor-listing-tab", tab); } catch (_) {}
  vlSyncSelectLabels();
  vlRefreshEmpty();
}

async function openAddProductModal() {
  editingProductId = null;
  duplicatingProductId = null;
  await showProductModal();
}
async function openEditProductModal(productId) {
  // Editing an existing listing must always start from the database. A stale
  // autosave from a previous edit must never replace the saved varieties or
  // saved photos that the vendor is trying to edit.
  try {
    const key = typeof draftKey === "function" ? draftKey("product", productId) : null;
    if (key && typeof cancelDraftTimer === "function") cancelDraftTimer(key);
    if (key) { try { localStorage.removeItem(key); } catch (_) {} }
  } catch (_) {}
  editingProductId = productId;
  duplicatingProductId = null;
  await showProductModal();
}

async function openDuplicateProductModal(productId) {
  if (!vendor?.id) { showToast("Your vendor profile is unavailable. Please sign in again.", "error"); return; }
  try {
    const [{ data: source, error: sourceError }, { data: sourceVariants, error: variantsError }, { data: engagement }] = await Promise.all([
      sb.from("products").select("*").eq("id", productId).eq("vendor_id", vendor.id).maybeSingle(),
      sb.from("product_variants").select("*").eq("product_id", productId).order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
      sb.from("product_engagement_settings").select("like_visibility,allow_comments,comment_audience").eq("product_id", productId).maybeSingle()
    ]);
    if (sourceError) throw sourceError;
    if (!source) throw new Error("That listing could not be found.");
    if (variantsError) throw variantsError;

    // This is a new-listing editor. Nothing is written until Save is pressed.
    duplicatingProductId = productId;
    editingProductId = null;
    await showProductModal();

    byId("productModalTitle").textContent = source.is_service ? "Duplicate Service" : "Duplicate Product";
    const notice = byId("productDuplicateNotice");
    if (notice) {
      notice.innerHTML = `<i class="fa-solid fa-copy"></i><span><strong>New listing from ${esc(source.name || "this listing")}</strong><small>Your original listing stays unchanged. The varieties, pricing setup, photos and listing settings have been copied for you to edit.</small></span>`;
      notice.classList.remove("hidden");
    }

    byId("prodName").value = `Copy of ${source.name || "listing"}`;
    byId("prodDesc").value = stripProductVariantMeta(source.description || "");
    byId("prodCondition").value = source.condition || "new";
    byId("prodListingType").value = source.listing_type || "sale";
    byId("prodSalePrice").value = source.sale_price ?? "";
    byId("prodDiscountPrice").value = source.discount_price ?? "";
    byId("prodRentalRate").value = source.rental_rate ?? "";
    byId("prodRateUnit").value = source.rental_rate_unit || "day";
    byId("prodDeposit").value = source.deposit_amount ?? "";
    byId("prodTrackQuantity").checked = source.track_quantity !== false;
    byId("prodQtyTotal").value = source.track_quantity === false ? 1 : (source.quantity_total ?? 1);
    toggleProdQuantityField();
    byId("prodIsService").checked = !!source.is_service;
    byId("prodServiceUnit").value = source.service_price_unit || "flat";
    byId("prodBillingModel").value = source.billing_model || "commission";
    byId("prodDeliveryMode").value = source.delivery_fee_mode || "free";
    byId("prodDeliveryFee").value = source.delivery_fee ?? 0;
    byId("prodDeliveryPerKm").value = source.delivery_fee_per_km ?? 0;
    if (byId("prodPaymentTiming")) byId("prodPaymentTiming").value = source.payment_timing === "pay_after" ? "pay_after" : "pay_before";
    if (byId("prodPaymentDepositPercent")) byId("prodPaymentDepositPercent").value = Math.max(1, Math.min(99, Number(source.payment_deposit_percent ?? 20) || 20));
    byId("prodLikeVisibility").value = engagement?.like_visibility || "everyone";
    byId("prodAllowComments").checked = engagement?.allow_comments !== false;
    byId("prodCommentAudience").value = engagement?.comment_audience || "everyone";

    window.__existingPhotos = Array.isArray(source.photos) ? [...source.photos] : [];
    window.__newProductPhotoFiles = [];
    window.__replaceDisplayPicture = false;
    window.__displayPictureWasReplaced = false;
    renderExistingPhotos();

    // Fresh local identities ensure the source variety rows can never be updated.
    // The existing RPC creates the real variety rows when the new product is saved.
    window.__productVariants = (Array.isArray(sourceVariants) ? sourceVariants : []).map((v, index) => ({
      ...v,
      id: undefined,
      _localKey: `duplicate-${crypto.randomUUID()}`,
      _imageFile: undefined,
      _previewUrl: v.photo_url || "",
      sort_order: index
    }));
    window.__productVariantPhotoFiles = {};

    const currentCat = productModalCategories.find((c) => c.id === source.category_id);
    const sectorSelect = byId("prodSector");
    sectorSelect.value = currentCat?.sector_id || vendor.sector_id || productModalSectors[0]?.id || "";
    sectorSelect.dispatchEvent(new Event("change", { bubbles: true }));
    loadProdCategoriesForSector(source.category_id || "");
    updateProductFormFields();
    updateProductSaveButtonLabel();
    updateProductDeliveryFields();
    updateProductPaymentTimingHint();
    syncProductEngagementSettingsUI();
    renderProductDisplayPicture();
    renderProductVariantPricing();
    enhanceSelectsIn(byId("productModal"));

    requestAnimationFrame(() => {
      renderProductVariantPricing();
      byId("prodName")?.focus({ preventScroll: true });
      try { byId("prodName")?.select(); } catch (_) {}
    });
  } catch (err) {
    duplicatingProductId = null;
    editingProductId = null;
    showToast(err?.message || "Could not prepare this listing for duplication.", "error");
  }
}

// A vendor can list products under any sector, not just the one they
// registered under (e.g. a mostly-healthcare vendor who also sells
// clothing) - so the modal offers every sector's category tree, not just
// vendor.sector_id's. The product's own category_id is all that's stored;
// its "sector" is just whatever sector that category belongs to.
let productModalCategories = [];
let productModalSectors = [];
async function warmProductModalRefs(force) {
  const ref = window.__prodRefs;
  if (ref?.promise && !force) return ref.promise;
  const promise = (async () => {
    try {
      const needVendor = vendor?.id && (vendor.delivery_fee_mode === undefined || vendor.delivery_fee === undefined);
      const [vd, cats, secs] = await Promise.all([
        needVendor ? sb.from("vendors").select("id, sector_id, delivery_fee, delivery_fee_mode, delivery_fee_per_km").eq("id", vendor.id).maybeSingle() : Promise.resolve({ data: null }),
        levroData.catalogue.categories(),
        sectors.length ? Promise.resolve({ data: sectors }) : levroData.catalogue.sectors("sort_order"),
      ]);
      if (vd?.data) vendor = { ...vendor, ...vd.data };
      if (!sectors.length) sectors = secs?.data || [];
      window.__prodRefs.categories = cats?.data || [];
    } catch (_) { window.__prodRefs = null; }
  })();
  window.__prodRefs = { promise, categories: [] };
  return promise;
}
async function showProductModal() {
  // Categories, sectors and the vendor's delivery defaults are loaded once and reused, so the
  // Add / Edit card opens instantly. warmProductModalRefs() fetches them in the background.
  await warmProductModalRefs();
  productModalCategories = window.__prodRefs?.categories || [];
  productModalSectors = sectors;

  const sectorSelect = byId("prodSector");
  sectorSelect.innerHTML = productModalSectors.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("") + '<option value="__other__">＋ Other (not listed)</option>';

  byId("productError").classList.add("hidden");
  byId("productDuplicateNotice")?.classList.add("hidden");
  if (byId("productDuplicateNotice")) byId("productDuplicateNotice").innerHTML = "";
  byId("prodExistingPhotos").innerHTML = "";
  byId("prodNewPhotoPreviews").innerHTML = "";
  byId("prodPhotoFiles").value = "";
  window.__newProductPhotoFiles = [];
  byId("prodCategoryOther").value = "";
  byId("prodCategoryOther").classList.add("hidden");
  byId("prodSectorOther").value = "";
  byId("prodSectorOther").classList.add("hidden");
  window.__existingPhotos = [];
  window.__productVariants = [];
  // Photo selections are scoped to this modal session. Never let a previous
  // edit leak a File object or preview into the next product.
  window.__productVariantPhotoFiles = {};
  window.__replaceDisplayPicture = false;
  window.__displayPictureWasReplaced = false;
  renderProductVariantPricing();

  let presetCategoryId = "";
  if (editingProductId) {
    const { data: p } = await sb.from("products").select("*").eq("id", editingProductId).single();
    const { data: engagement } = await sb.from("product_engagement_settings").select("like_visibility,allow_comments,comment_audience").eq("product_id",editingProductId).maybeSingle();
    // For the editor, read the actual product_variants rows first. This avoids
    // relying on a JSONB RPC representation for the primary UI path. If RLS or
    // an older deployment blocks the direct read, fall back to the ownership-
    // checked RPC. Either way the editor receives a plain array.
    let { data: productVariants, error: productVariantsError } = await sb.from("product_variants")
      .select("*").eq("product_id", editingProductId)
      .order("sort_order", {ascending:true}).order("created_at", {ascending:true});
    const normalizeVariants = (value) => {
      if (Array.isArray(value)) return value;
      if (typeof value === "string") { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; } }
      if (value && typeof value === "object") {
        for (const key of ["variants", "data", "result", "items"]) {
          if (Array.isArray(value[key])) return value[key];
          if (typeof value[key] === "string") { try { const parsed = JSON.parse(value[key]); if (Array.isArray(parsed)) return parsed; } catch (_) {} }
        }
      }
      return [];
    };
    productVariants = normalizeVariants(productVariants);
    if (productVariantsError || !productVariants.length) {
      const rpc = await sb.rpc("get_owned_product_variants", { p_product_id: editingProductId });
      const rpcVariants = normalizeVariants(rpc.data);
      if (!rpc.error && rpcVariants.length) { productVariants = rpcVariants; productVariantsError = null; }
      else if (productVariantsError && rpc.error) productVariantsError = rpc.error;
    }
    window.__productVariants = Array.isArray(productVariants) ? productVariants : [];
    // Existing-listing edits are database-authoritative. Never run the draft
    // restoration observer for this modal instance.
    const productModalRoot = byId("productModal");
    productModalRoot.dataset.serverLoadedAt = String(Date.now());
    productModalRoot.dataset.draftRestored = "1";
    byId("productModalTitle").textContent = "Edit Product";
    byId("prodName").value = p.name;
    byId("prodDesc").value = stripProductVariantMeta(p.description || "");
    byId("prodCondition").value = p.condition;
    byId("prodListingType").value = p.listing_type;
    byId("prodSalePrice").value = p.sale_price ?? "";
    byId("prodDiscountPrice").value = p.discount_price ?? "";
    byId("prodRentalRate").value = p.rental_rate ?? "";
    byId("prodDeliveryMode").value = p.delivery_fee_mode || "free";
    if (byId("prodPaymentTiming")) byId("prodPaymentTiming").value = p.payment_timing || "pay_after";
    if (byId("prodPaymentDepositPercent")) byId("prodPaymentDepositPercent").value = Math.max(1, Math.min(99, Number(p.payment_deposit_percent ?? 20) || 20));
    updateProductPaymentTimingHint();
    byId("prodDeliveryFee").value = p.delivery_fee ?? 0;
    byId("prodDeliveryPerKm").value = p.delivery_fee_per_km ?? 0;
    byId("prodRateUnit").value = p.rental_rate_unit || "day";
    byId("prodDeposit").value = p.deposit_amount ?? "";
    byId("prodTrackQuantity").checked = p.track_quantity !== false;
    byId("prodQtyTotal").value = p.track_quantity === false ? 1 : p.quantity_total;
    toggleProdQuantityField();
    byId("prodIsService").checked = !!p.is_service;
    byId("prodServiceUnit").value = p.service_price_unit || "flat";
    if (byId("prodPaymentTiming")) byId("prodPaymentTiming").value = p.payment_timing === "pay_after" ? "pay_after" : "pay_before";
    if (byId("prodPaymentDepositPercent")) byId("prodPaymentDepositPercent").value = Math.max(1, Math.min(99, Number(p.payment_deposit_percent ?? 20) || 20));
    updateProductPaymentTimingHint();
    if (byId("prodBillingModel")) byId("prodBillingModel").value = p.billing_model || (p.is_service ? "commission" : "commission");
    byId("prodLikeVisibility").value=engagement?.like_visibility||"everyone";byId("prodAllowComments").checked=engagement?.allow_comments!==false;byId("prodCommentAudience").value=engagement?.comment_audience||"everyone";
    window.__existingPhotos = p.photos || [];
    renderExistingPhotos();
    renderProductDisplayPicture();
    renderProductVariantPricing();
    const currentCat = productModalCategories.find((c) => c.id === p.category_id);
    sectorSelect.value = currentCat?.sector_id || vendor.sector_id || productModalSectors[0]?.id || "";
    presetCategoryId = p.category_id || "";
  } else {
    byId("productModalTitle").textContent = "Add New Product";
    duplicatingProductId = null;
    ["prodName", "prodDesc", "prodSalePrice", "prodDiscountPrice", "prodRentalRate", "prodDeposit"].forEach((id) => (byId(id).value = ""));
    byId("prodDeliveryMode").value = "free";
    if (byId("prodPaymentTiming")) byId("prodPaymentTiming").value = "pay_before";
    if (byId("prodPaymentDepositPercent")) byId("prodPaymentDepositPercent").value = 20;
    updateProductPaymentTimingHint();
    byId("prodDeliveryFee").value = 0;
    byId("prodDeliveryPerKm").value = 0;
    byId("prodTrackQuantity").checked = false;
    byId("prodQtyTotal").value = 1;
    toggleProdQuantityField();
    byId("prodCondition").value = "new";
    byId("prodListingType").value = "sale";
    if (byId("prodBillingModel")) byId("prodBillingModel").value = "commission";
    byId("prodLikeVisibility").value="everyone";byId("prodAllowComments").checked=true;byId("prodCommentAudience").value="everyone";
    byId("prodIsService").checked = false;
    byId("prodServiceUnit").value = "flat";
    sectorSelect.value = vendor.sector_id || productModalSectors[0]?.id || "";
    renderProductVariantPricing();
  }
  // Fires the custom dropdown's own resync (see enhanceSelect) as well as
  // the plain onchange="loadProdCategoriesForSector()" on the real select -
  // the explicit call right after is what actually applies presetCategoryId.
  sectorSelect.dispatchEvent(new Event("change", { bubbles: true }));
  loadProdCategoriesForSector(presetCategoryId);
  updateProductFormFields();
  updateProductSaveButtonLabel();
  updateProductDeliveryFields();
  syncProductEngagementSettingsUI();
  byId("productModal").classList.remove("hidden");
  trackModalOpened("productModal");
  enhanceSelectsIn(byId("productModal"));
  // Re-render AFTER the modal is mounted. This is intentionally explicit: the
  // editor must always paint the complete saved variety set, even when the
  // initial render happened while the modal was being reset.
  if (editingProductId) {
    requestAnimationFrame(() => renderProductVariantPricing());
    // One final server reconciliation after the modal is painted. This is the
    // last word for Edit Product and prevents any late UI/draft observer from
    // replacing the saved variety table.
    setTimeout(async () => {
      if (!editingProductId || byId("productModal")?.classList.contains("hidden")) return;
      try {
        let { data: latest, error: latestError } = await sb.from("product_variants")
          .select("*").eq("product_id", editingProductId)
          .order("sort_order", {ascending:true}).order("created_at", {ascending:true});
        if (latestError) {
          const rpc = await sb.rpc("get_owned_product_variants", { p_product_id: editingProductId });
          latest = normalizeVariants(rpc.data); latestError = rpc.error;
        }
        if (!latestError && Array.isArray(latest)) {
          window.__productVariants = latest;
          renderProductVariantPricing();
        }
      } catch (e) { console.warn("[Levromart] Final variety reconciliation failed:", e); }
    }, 180);
  }
}
function loadProdCategoriesForSector(presetCategoryId) {
  const sectorId = byId("prodSector").value;
  const select = byId("prodCategory");
  const sectorOther = byId("prodSectorOther");
  const isOtherSector = sectorId === "__other__";
  sectorOther?.classList.toggle("hidden", !isOtherSector);
  if (isOtherSector) {
    select.innerHTML = '<option value="">Uncategorized</option><option value="__other__">＋ Other (not listed)</option>';
    select.value = presetCategoryId === "__other__" ? "__other__" : "";
    toggleProdCategoryOther();
    return;
  }
  const cats = productModalCategories.filter((c) => c.sector_id === sectorId);
  select.innerHTML = '<option value="">Uncategorized</option>';
  cats.filter((c) => !c.parent_category_id).forEach((parent) => {
    const group = document.createElement("optgroup");
    group.label = parent.name;
    cats.filter((c) => c.parent_category_id === parent.id).forEach((child) => {
      const opt = document.createElement("option");
      opt.value = child.id; opt.textContent = child.name;
      group.appendChild(opt);
    });
    select.appendChild(group);
  });
  const otherOpt = document.createElement("option");
  otherOpt.value = "__other__"; otherOpt.textContent = "＋ Other (not listed)";
  select.appendChild(otherOpt);
  if (presetCategoryId) select.value = presetCategoryId;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function renderExistingPhotos() {
  byId("prodExistingPhotos").innerHTML = (window.__existingPhotos || [])
    .map((url) => `<div class="photo-thumb"><img src="${esc(url)}" alt="" /><button type="button" class="photo-remove" onclick="removeExistingPhoto('${esc(url)}')" title="Remove"><i class="fa-solid fa-xmark"></i></button></div>`)
    .join("");
}
function removeExistingPhoto(url) {
  window.__existingPhotos = (window.__existingPhotos || []).filter((u) => u !== url);
  renderExistingPhotos();
  renderProductVariantPricing();
}

// Live thumbnails for photos just picked but not yet uploaded - so "Add
// photos" actually shows what you chose instead of staying blank until
// after Save.
function syncNewProductPhotoInput() {
  const input = byId("prodPhotoFiles");
  const files = window.__newProductPhotoFiles || [];
  if (!input) return;
  try {
    const dt = new DataTransfer();
    files.forEach((file) => dt.items.add(file));
    input.files = dt.files;
  } catch (e) {
    // Safari/iOS may not expose a writable FileList. The app's own array remains
    // the source of truth, so removing a thumbnail still works there.
  }
}
function renderNewProductPhotos() {
  const wrap = byId("prodNewPhotoPreviews");
  if (!wrap) return;
  wrap.innerHTML = "";
  (window.__newProductPhotoFiles || []).forEach((f, index) => {
    const url = URL.createObjectURL(f);
    const safeName = esc(f.name || "Image");
    const node = document.createElement("div");
    node.className = "photo-thumb";
    node.innerHTML = `<img src="${url}" alt="${safeName}" /><button type="button" class="photo-remove" onclick="removeNewProductPhoto(${index})" title="Remove photo" aria-label="Remove photo"><i class="fa-solid fa-xmark"></i></button><span class="photo-pending-badge">new</span>`;
    wrap.appendChild(node);
  });
}
function previewNewProductPhotos() {
  persistVisibleVariantOrder();
  const files=[...(byId("prodPhotoFiles").files || [])].filter(f=>f.type?.startsWith("image/"));
  // Replacing the display picture is a single-image operation; normal Add photos
  // accepts the complete selected collection. Never silently truncate uploads.
  const selectedFiles=window.__replaceDisplayPicture ? files.slice(0,1) : files;
  if(window.__replaceDisplayPicture && files.length){
    window.__existingPhotos=(window.__existingPhotos||[]).slice(1);
    window.__newProductPhotoFiles=selectedFiles;
  }else{
    window.__newProductPhotoFiles=files;
  }
  syncNewProductPhotoInput();
  renderNewProductPhotos();
  renderProductDisplayPicture();
  renderProductVariantPricing();
}
function removeNewProductPhoto(index) {
  const files = window.__newProductPhotoFiles || [];
  if (index < 0 || index >= files.length) return;
  window.__newProductPhotoFiles = files.filter((_, i) => i !== index);
  syncNewProductPhotoInput();
  const wrap = byId("prodNewPhotoPreviews");
  if (wrap) wrap.innerHTML = "";
  renderNewProductPhotos();
  renderProductVariantPricing();
}
(function setupPhotoDropzone() {
  document.addEventListener("dragover", (e) => {
    const zone = e.target.closest && e.target.closest("#photoDropzone");
    if (zone) { e.preventDefault(); zone.classList.add("drag-over"); }
  });
  document.addEventListener("dragleave", (e) => {
    const zone = e.target.closest && e.target.closest("#photoDropzone");
    if (zone) zone.classList.remove("drag-over");
  });
  document.addEventListener("drop", (e) => {
    const zone = e.target.closest && e.target.closest("#photoDropzone");
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove("drag-over");
    const input = byId("prodPhotoFiles");
    if (input && e.dataTransfer?.files?.length) {
      window.__newProductPhotoFiles = [...(window.__newProductPhotoFiles || []), ...[...e.dataTransfer.files]];
      syncNewProductPhotoInput();
      const wrap = byId("prodNewPhotoPreviews");
      if (wrap) wrap.innerHTML = "";
      renderNewProductPhotos();
      renderProductVariantPricing();
    }
  });
})();

function toggleProdCategoryOther() {
  byId("prodCategoryOther").classList.toggle("hidden", byId("prodCategory").value !== "__other__");
}

function setProductPaymentTiming(mode){
  const value=mode==="pay_after" ? "pay_after" : "pay_before";
  const sel=byId("prodPaymentTiming");
  if(sel) sel.value=value;
  document.querySelectorAll(".payment-timing-option").forEach(btn=>{
    btn.classList.toggle("selected",btn.dataset.paymentTiming===value);
    btn.setAttribute("aria-pressed",btn.dataset.paymentTiming===value ? "true" : "false");
  });
  updateProductPaymentTimingHint();
}
function updateProductPaymentTimingHint(){
  const el=byId("prodPaymentTimingHint"); const sel=byId("prodPaymentTiming"); if(!el||!sel)return;
  const isAfter=sel.value==="pay_after";
  const pctInput=byId("prodPaymentDepositPercent");
  const raw=String(pctInput?.value ?? "").trim();
  const pct=raw==="" ? null : Number(raw);
  const validPct=Number.isFinite(pct) ? Math.max(1,Math.min(99,pct)) : null;
  const remaining=validPct==null ? null : 100-validPct;
  if (isAfter) {
    byId("prodPaymentRemainingPercent")?.replaceChildren(document.createTextNode(remaining==null ? "-" : `${remaining}%`));
    el.innerHTML=validPct==null
      ? "<strong>Pay after delivery:</strong> enter the buyer's deposit percentage before saving."
      : `<strong>Pay after delivery:</strong> the buyer pays ${validPct}% before delivery; the remaining ${remaining}% is due after delivery.`;
  } else {
    el.innerHTML="<strong>Pay before delivery:</strong> the buyer pays the full item amount before dispatch. If they need a different arrangement, they should contact the vendor.";
  }
  byId("prodPaymentDepositPercentWrap")?.classList.toggle("hidden",!isAfter);
  document.querySelectorAll(".payment-timing-option").forEach(btn=>{
    btn.classList.toggle("selected",btn.dataset.paymentTiming===sel.value);
    btn.setAttribute("aria-pressed",btn.dataset.paymentTiming===sel.value ? "true" : "false");
  });
}
function normalizeProductPaymentDepositPercent(){
  const input=byId("prodPaymentDepositPercent");
  if(!input)return;
  const raw=String(input.value||"").trim();
  if(raw==="") { updateProductPaymentTimingHint(); return; }
  const pct=Math.max(1,Math.min(99,Math.round(Number(raw))));
  if(Number.isFinite(pct)) input.value=String(pct);
  updateProductPaymentTimingHint();
}
function updateProductDeliveryFields() {
  const mode = byId("prodDeliveryMode")?.value || "free";
  const isService = byId("prodIsService")?.checked;
  byId("prodDeliverySettings")?.classList.toggle("hidden", !!isService);
  byId("prodDeliveryFlatRow")?.classList.toggle("hidden", mode !== "flat");
  byId("prodDeliveryDistanceRow")?.classList.toggle("hidden", mode !== "distance");
  const hint = byId("prodDeliveryHint");
  if (hint) hint.textContent = mode === "free" ? "Customers will not be charged a delivery fee for this product." : mode === "flat" ? "Every delivery order for this product uses this flat fee." : "The delivery fee is calculated from the customer's distance from your shop.";
}

function updateProductSaveButtonLabel(){
  const btn=byId("saveProductBtn"); if(!btn) return;
  const isService=!!byId("prodIsService")?.checked;
  const type=isService ? "Service" : ((byId("prodListingType")?.value||"sale")==="rent" ? "Product" : "Product");
  btn.textContent = `Save to ${type}`;
}

function toggleProdQuantityField() {
  const tracking = !!byId("prodTrackQuantity")?.checked;
  byId("prodQtyTotalRow")?.classList.toggle("hidden", !tracking);
}
function updateProductFormFields() {
  const isService = byId("prodIsService").checked;
  byId("prodConditionWrap").classList.toggle("hidden", isService);
  byId("prodListingTypeWrap").classList.toggle("hidden", isService);
  byId("prodQtyWrap").classList.toggle("hidden", isService);
  byId("prodServiceUnitWrap").classList.toggle("hidden", !isService);
  byId("prodPaymentTimingSettings")?.classList.toggle("hidden", isService);

  if (isService) {
    const unit = byId("prodServiceUnit").value;
    byId("prodSalePriceLabel").textContent = unit === "flat" ? "Price (₦)" : `Rate (₦ per ${unit})`;
    byId("prodSalePriceWrap").classList.remove("hidden");
    byId("prodDiscountPriceWrap").classList.remove("hidden");
    byId("prodDeliverySettings").classList.add("hidden");
    byId("prodRentalRateWrap").classList.add("hidden");
    byId("prodRateUnitWrap").classList.add("hidden");
    byId("prodDepositWrap").classList.add("hidden");
    return;
  }
  byId("prodSalePriceLabel").textContent = "Price (₦)";
  byId("prodDiscountPriceWrap").classList.remove("hidden");
  updateProductDeliveryFields();
  const type = byId("prodListingType").value;
  byId("prodDiscountPriceWrap").classList.toggle("hidden", type === "rent");
  byId("prodSalePriceWrap").classList.toggle("hidden", type === "rent");
  byId("prodRentalRateWrap").classList.toggle("hidden", type === "sale");
  byId("prodRateUnitWrap").classList.toggle("hidden", type === "sale");
  byId("prodDepositWrap").classList.toggle("hidden", type === "sale");
}

function closeProductModal(options = {}) {
  if(byId('productModal')?.dataset.discardDraft==='1'){options.skipDraft=true;delete byId('productModal').dataset.discardDraft;}
  delete byId('productModal').dataset.draftRestored;
  duplicatingProductId = null;
  if (!options.skipDraft && typeof window.__captureListingDraftForModal === "function") {
    try { window.__captureListingDraftForModal("product"); } catch (_) {}
  }
  byId("productModal").classList.add("hidden");
  if (dismissibleModalId === "productModal") dismissibleModalId = null;
}

function renderProductDisplayPicture(){
  const wrap=byId('prodDisplayPicture'); if(!wrap)return;
  const url=(window.__newProductPhotoFiles?.[0] && (!(window.__existingPhotos||[]).length || window.__replaceDisplayPicture)) ? URL.createObjectURL(window.__newProductPhotoFiles[0]) : ((window.__existingPhotos||[])[0] || '');
  wrap.innerHTML=url?`<img src="${esc(url)}" alt="Display picture"><span style="position:absolute;left:.55rem;bottom:.55rem;padding:.25rem .45rem;border-radius:999px;background:rgba(0,0,0,.58);color:#fff;font-size:.62rem;font-weight:700;">Main card image · tap to edit</span>`:`<div class="display-picture-empty"><i class="fa-regular fa-image"></i><strong>No display picture</strong><span>Tap to choose an image</span></div>`;
}
function openProductDisplayPictureActions(event){
  event?.preventDefault?.(); event?.stopPropagation?.(); document.getElementById('productDisplayPictureMenu')?.remove();
  const menu=document.createElement('div'); menu.id='productDisplayPictureMenu'; menu.className='product-display-picture-menu';
  menu.innerHTML='<button type="button" data-action="replace"><i class="fa-solid fa-rotate"></i> Replace</button><button type="button" data-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>';
  document.body.appendChild(menu); const r=byId('prodDisplayPicture').getBoundingClientRect(); menu.style.left=`${Math.min(r.left,window.innerWidth-180)}px`; menu.style.top=`${Math.min(r.bottom+6,window.innerHeight-90)}px`;
  menu.addEventListener('click',e=>{const action=e.target.closest?.('button')?.dataset.action; if(action==='replace'){window.__replaceDisplayPicture=true;byId('prodPhotoFiles')?.click();} else if(action==='delete'){window.__existingPhotos=(window.__existingPhotos||[]).slice(1);renderExistingPhotos();renderProductDisplayPicture();} menu.remove();});
  setTimeout(()=>document.addEventListener('pointerdown',function close(ev){if(!menu.contains(ev.target)){menu.remove();document.removeEventListener('pointerdown',close)}},{once:true}),0);
}
function clearProductDisplayPicture(){window.__existingPhotos=(window.__existingPhotos||[]).slice(1);renderExistingPhotos();renderProductDisplayPicture();}

window.__collapsedProductVariants ||= new Set();
function toggleProductVariantAccordion(key) {
  const k = String(key || "");
  if (!k) return;
  const set = window.__collapsedProductVariants ||= new Set();
  if (set.has(k)) set.delete(k); else set.add(k);
  const row = [...document.querySelectorAll("#productVariantPricing .variant-price-row")].find(r => String(r.dataset.variantKey || "") === k);
  if (!row) return;
  const body = row.querySelector(".variant-accordion-body");
  const toggle = row.querySelector(".variant-accordion-toggle");
  const collapsed = set.has(k);
  body?.classList.toggle("hidden", collapsed);
  row.classList.toggle("is-collapsed", collapsed);
  toggle?.setAttribute("aria-expanded", String(!collapsed));
  const icon = toggle?.querySelector(".variant-accordion-chevron");
  if (icon) icon.className = `fa-solid ${collapsed ? "fa-chevron-down" : "fa-chevron-up"} variant-accordion-chevron`;
}
function renderProductVariantPricing() {
  const wrap = byId("productVariantPricing"); if (!wrap) return;
  const variants = Array.isArray(window.__productVariants) ? window.__productVariants : [];
  const existing = Array.isArray(window.__existingPhotos) ? window.__existingPhotos : [];
  const pending = Array.isArray(window.__newProductPhotoFiles) ? window.__newProductPhotoFiles : [];
  const rows = variants.map((v,index) => ({...v,_localKey:String(v.id||v._localKey||`variant-${index}`),_source:v.photo_url?"existing":"none"}));
  if (!rows.length) {
    wrap.innerHTML = '<div class="product-variant-pricing-head"><div><strong>Varieties</strong><div class="variant-price-note">Add optional variety details such as an image, name, color, size, price or discount price.</div></div></div>';
    renderProductDisplayPicture(); return;
  }
  const photoFiles = window.__productVariantPhotoFiles || {};
  const collapsed = window.__collapsedProductVariants ||= new Set();
  rows.forEach(r => { const key=String(r.id||r._localKey); if (!collapsed.has(key)) collapsed.add(key); });
  wrap.innerHTML = `<div class="product-variant-pricing-head"><div><strong>Varieties</strong><div class="variant-price-note">Each variety is optional. Drag the handle to reorder. Tap a variety header to expand or collapse its fields.</div></div></div>${rows.map((r,i)=>{
    const key=String(r.id||r._localKey), uploadedFile=photoFiles[key];
    const image=uploadedFile?URL.createObjectURL(uploadedFile):(r._previewUrl||r.photo_url||(r.temp_index!=null?pending[r.temp_index]&&URL.createObjectURL(pending[r.temp_index]):"")||"");
    const imageOptions=existing.map((u,j)=>`<option value="${esc(u)}" ${String(r.photo_url||"")===String(u)?"selected":""}>Product photo ${j+1}${j===0?" (display)":""}</option>`).join("");
    const isCollapsed=collapsed.has(key);
    const thumb=image?`<img class="variant-accordion-thumb" src="${esc(image)}" alt="">`:`<span class="variant-accordion-thumb variant-accordion-thumb-empty"><i class="fa-regular fa-image"></i></span>`;
    return `<div class="variant-price-row ${isCollapsed?"is-collapsed":""}" draggable="true" data-variant-key="${esc(key)}" data-photo-url="${esc(r.photo_url||"")}" data-temp-index="${r.temp_index??""}">
      <div class="variant-row-topbar">
        <button type="button" class="variant-dnd-handle" aria-label="Drag to reorder" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></button>
        <button type="button" class="variant-accordion-toggle" aria-expanded="${String(!isCollapsed)}" aria-controls="variant-body-${esc(key)}" onclick="toggleProductVariantAccordion('${esc(key)}')">
          ${thumb}<span class="variant-accordion-title"><strong class="variant-row-title">Variety ${i+1}</strong><small>${esc(r.name||"Unnamed variety")}</small></span><i class="fa-solid ${isCollapsed?"fa-chevron-down":"fa-chevron-up"} variant-accordion-chevron"></i>
        </button>
        <button type="button" class="variant-price-remove" onclick="clearProductVariantRow(this)" aria-label="Remove this variety" title="Remove this variety"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div id="variant-body-${esc(key)}" class="variant-accordion-body ${isCollapsed?"hidden":""}">
        <div class="variant-photo-section"><button type="button" class="variant-photo-picker" onclick="openProductVariantPhotoPicker('${esc(key)}')" aria-label="Add variety photo"><span class="variant-photo-preview">${image?`<img src="${esc(image)}" alt="Variety photo">`:`<i class="fa-regular fa-image"></i>`}</span><span class="variant-photo-copy"><strong>${image?'Change variety photo':'Add variety photo'}</strong><small>Optional · tap to choose an image</small></span><i class="fa-solid fa-camera variant-photo-camera"></i></button><input type="file" class="variant-photo-file" data-variant-photo-key="${esc(key)}" accept="image/*" onchange="handleProductVariantPhotoChange(this)" hidden>${existing.length?`<div class="variant-existing-photo-wrap"><label>Or use a product photo</label><select class="variant-image" aria-label="Use an existing product photo" onchange="clearProductVariantUploadedPhoto(this)"><option value="" ${!r.photo_url?"selected":""}>No existing photo</option>${imageOptions}</select></div>`:''}</div>
        <div class="variant-fields-grid"><div class="variant-field"><label>Variety name <span>(optional · auto-named if blank)</span></label><input class="variant-name" type="text" maxlength="120" placeholder="e.g. Large / Black / 500ml" value="${esc(r.name||"")}"></div><div class="variant-field"><label>Color <span>(optional)</span></label><input class="variant-color" type="text" maxlength="80" placeholder="e.g. Black" value="${esc(r.color||"")}"></div><div class="variant-field"><label>Size <span>(optional)</span></label><input class="variant-size" type="text" maxlength="80" placeholder="e.g. XL" value="${esc(r.size||"")}"></div><div class="variant-field"><label>Price (₦) <span>(optional · uses product price if blank)</span></label><input class="variant-sale-price" type="number" min="0" step="0.01" placeholder="e.g. 15000" value="${r.sale_price==null?"":esc(String(r.sale_price))}"></div><div class="variant-field variant-field-wide"><label>Discount price (₦) <span>(optional)</span></label><input class="variant-discount-price" type="number" min="0" step="0.01" placeholder="e.g. 13500" value="${r.discount_price==null?"":esc(String(r.discount_price))}"></div><div class="variant-field variant-field-wide"><label>Description <span>(optional)</span></label><textarea class="variant-description" aria-label="Variety description" placeholder="Description">${esc(r.description||"")}</textarea></div><div class="variant-field variant-field-wide"><label>Quantity available <span>(optional)</span></label><input class="variant-quantity" type="number" min="0" step="1" aria-label="Variety quantity available" placeholder="Quantity available" value="${r.quantity_available==null?'':esc(r.quantity_available)}"></div></div>
      </div>
    </div>`;
  }).join("")}`;
  bindProductVariantDnd(); renderProductDisplayPicture();
}
function openProductVariantPhotoPicker(key){const input=[...document.querySelectorAll('#productVariantPricing .variant-photo-file')].find(el=>String(el.dataset.variantPhotoKey||'')===String(key));input?.click();}
function handleProductVariantPhotoChange(input){const key=String(input?.dataset.variantPhotoKey||'');const file=input?.files?.[0];if(!key||!file||!file.type?.startsWith('image/'))return;window.__productVariantPhotoFiles ||= {};persistVisibleVariantOrder();window.__productVariantPhotoFiles[key]=file;const v=(window.__productVariants||[]).find(v=>String(v.id||v._localKey)===key);if(v){v._imageFile=file;v._previewUrl=URL.createObjectURL(file);}renderProductVariantPricing();window.__captureListingDraftForModal?.('product');}
function clearProductVariantUploadedPhoto(select){const key=String(select?.closest?.('.variant-price-row')?.dataset.variantKey||'');if(window.__productVariantPhotoFiles&&key)delete window.__productVariantPhotoFiles[key];}
async function selectVarietyImage(input){return handleProductVariantPhotoChange(input);}
async function uploadVarietyImages(){
  persistVisibleVariantOrder();
  await Promise.all((window.__productVariants||[]).map(async v=>{
    if(!v._imageFile)return;const file=v._imageFile,path=`product-photos/${vendor.id}/variants/${crypto.randomUUID()}.${(file.name.split('.').pop()||'jpg').toLowerCase()}`;
    let uploadBlob=file;
    try{if(typeof window.compressImage==="function")uploadBlob=await window.compressImage(file,{maxWidth:1600,maxHeight:1600});}catch(_){}
    v.photo_url=await uploadToR2(uploadBlob,path,uploadBlob.type||file.type);
    const row=[...document.querySelectorAll('#productVariantPricing .variant-price-row')].find(r=>r.dataset.variantKey===String(v.id||v._localKey));
    if(row){
      row.dataset.photoUrl=v.photo_url;
      const select=row.querySelector('.variant-image');
      if(select) select.value=v.photo_url;
    }
    delete v._imageFile;
  }));
}

/* ---- Listing form as a full page: illustration + bulk varieties ---- */
function bulkAddVarietiesFromPhotos(input){
  const files=[...(input?.files||[])].filter(f=>f?.type?.startsWith('image/'));
  if(input) input.value='';
  if(!files.length) return;
  persistVisibleVariantOrder();
  const variants=window.__productVariants||[];
  window.__productVariantPhotoFiles ||= {};
  files.forEach((file)=>{
    const key=`local-${crypto.randomUUID()}`;
    variants.push({_localKey:key,name:'',sale_price:'',discount_price:'',photo_url:'',description:'',quantity_available:null,sort_order:variants.length,_imageFile:file,_previewUrl:URL.createObjectURL(file)});
    window.__productVariantPhotoFiles[key]=file;
  });
  window.__productVariants=variants;
  renderProductVariantPricing();
  try{window.__captureListingDraftForModal?.('product');}catch(_){}
  showToast(`${files.length} ${files.length===1?'variety':'varieties'} added. Open any one to add its name and price.`,'success');
  byId('productVariantPricing')?.scrollIntoView({behavior:'smooth',block:'start'});
}
window.lfArtFor=function(mode){
  try{
    if(mode==='service')return document.querySelector('.lv-auth-char')?.getAttribute('src')||'';
    if(mode==='package')return document.querySelectorAll('#lvOnb img.lv-hero')[2]?.getAttribute('src')||'';
    return document.querySelector('#lvOnb .lv-hero-girl')?.getAttribute('src')||'';
  }catch(_){return ''}
};
window.lfApplyMode=function(){
  try{
    const pm=byId('productModal'),kg=byId('packageModal');
    if(pm){
      const svc=!!byId('prodIsService')?.checked, mode=svc?'service':'product';
      pm.dataset.lfMode=mode;try{updateProductSaveButtonLabel()}catch(_){}
      const t=byId('productModalTitle');
      if(t){const x=t.textContent||'';const y=svc?x.replace(/Product$/,'Service'):x.replace(/Service$/,'Product');if(x!==y)t.textContent=y}
      const sub=pm.querySelector('.lf-sub');
      if(sub)sub.innerHTML=svc?'Describe what you offer, set your rate and show your work. Fields marked <b class="lf-req">*</b> are required.':'Fill in the basics, add clear photos, then save. Fields marked <b class="lf-req">*</b> are required.';
      const nm=byId('prodName');if(nm)nm.placeholder=svc?'e.g. Hair braiding or Home cleaning':'e.g. BP Monitor or Ankara Fabric';
      const ds=byId('prodDesc');if(ds)ds.placeholder=svc?"Tell customers what's included and how it works (required)":'Tell buyers what makes it good (required)';
      const sm=pm.querySelector('.lm-pink .lm-sec-head strong');if(sm)sm.textContent=svc?'Photos of your work':'Photos';
      const bs=pm.querySelector('.lm-blue .lm-sec-head small');if(bs)bs.textContent=svc?'Name your service and say what it covers':'Name it and describe it';
      const img=pm.querySelector('.lf-art');const src=lfArtFor(mode);if(img&&src&&img.getAttribute('src')!==src)img.setAttribute('src',src);
    }
    if(kg){kg.dataset.lfMode='package';const img=kg.querySelector('.lf-art');const src=lfArtFor('package');if(img&&src&&img.getAttribute('src')!==src)img.setAttribute('src',src);}
  }catch(_){}
};
window.lfFillArt=window.lfApplyMode;
(function(){
  if(window.__lfWrapUPF)return;window.__lfWrapUPF=true;
  const o=window.updateProductFormFields;
  if(typeof o==='function')window.updateProductFormFields=function(){const r=o.apply(this,arguments);lfApplyMode();return r};
  /* chooser choice wins over a restored draft */
  new MutationObserver(()=>{const pm=byId('productModal');if(!pm||pm.classList.contains('hidden')||pm.dataset.draftRestored!=='1'||pm.dataset.lfEnforced==='1')return;
    pm.dataset.lfEnforced='1';const want=window.__lfWant;
    if(want&&/^Add/.test(byId('productModalTitle')?.textContent||'')){const cb=byId('prodIsService');if(cb&&cb.checked!==(want==='service')){cb.checked=want==='service';window.updateProductFormFields?.();updateProductSaveButtonLabel?.()}}
    window.__lfWant=null;lfApplyMode();
  }).observe(document.body,{attributes:true,subtree:true,attributeFilter:['class','data-draft-restored']});
  new MutationObserver(()=>{const pm=byId('productModal');if(pm&&pm.classList.contains('hidden'))delete pm.dataset.lfEnforced}).observe(document.body,{attributes:true,subtree:true,attributeFilter:['class']});
})();
(function(){
  const t=setInterval(()=>{
    if(typeof window.openAddProductModal==='function'&&!window.openAddProductModal.__lf){
      const o=window.openAddProductModal; const w=async function(){ const r=await o.apply(this,arguments); const want=window.__lfWant; if(want&&/^Add/.test(byId('productModalTitle')?.textContent||'')){const cb=byId('prodIsService');if(cb){cb.checked=want==='service';window.updateProductFormFields?.();updateProductSaveButtonLabel?.();}} window.lfApplyMode(); try{window.__restoreListingDraft?.()}catch(_){} return r; }; w.__lf=true; window.openAddProductModal=w;
    }
    if(typeof window.openAddPackageModal==='function'&&!window.openAddPackageModal.__lf){
      const o=window.openAddPackageModal; const w=async function(){ const r=await o.apply(this,arguments); window.lfFillArt(); try{window.__restoreListingDraft?.()}catch(_){} return r; }; w.__lf=true; window.openAddPackageModal=w;
    }
  },400);
  setTimeout(()=>clearInterval(t),20000);
})();
function addProductVarietyDraft(){
  persistVisibleVariantOrder();const variants=window.__productVariants||[];
  const newKey=`local-${crypto.randomUUID()}`;
  variants.push({_localKey:newKey,name:'',sale_price:'',discount_price:'',photo_url:'',description:'',quantity_available:null,sort_order:variants.length});
  (window.__collapsedProductVariants ||= new Set()).delete(newKey);
  window.__productVariants=variants;renderProductVariantPricing();
  const rows=document.querySelectorAll('#productVariantPricing .variant-price-row');rows[rows.length-1]?.querySelector('.variant-name')?.focus({preventScroll:true});
}
function clearProductVariantRow(btn) {
  const row=btn?.closest?.('.variant-price-row'); if(!row)return;
  persistVisibleVariantOrder();
  const key=String(row.dataset.variantKey||"");
  window.__productVariants=(window.__productVariants||[]).filter(v=>String(v.id||v._localKey||"")!==key);
  window.__collapsedProductVariants?.delete(key);
  renderProductVariantPricing();
}
function bindProductVariantDnd(){
  const wrap=byId('productVariantPricing'); if(!wrap||wrap.dataset.dndBound==='1')return; wrap.dataset.dndBound='1';
  let dragged=null;
  wrap.addEventListener('dragstart',e=>{const row=e.target.closest?.('.variant-price-row');if(!row)return;dragged=row;row.classList.add('dragging');try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',row.dataset.variantKey||'')}catch(_){}},true);
  wrap.addEventListener('dragend',()=>{dragged?.classList.remove('dragging');dragged=null;persistVisibleVariantOrder();},true);
  wrap.addEventListener('dragover',e=>{if(!dragged)return;e.preventDefault();const row=e.target.closest?.('.variant-price-row');if(!row||row===dragged)return;const rect=row.getBoundingClientRect();const before=e.clientY<rect.top+rect.height/2;row.parentNode.insertBefore(dragged,before?row:row.nextSibling);},true);
  let touchY=null, touchRow=null;
  wrap.addEventListener('pointerdown',e=>{const h=e.target.closest?.('.variant-dnd-handle');if(!h)return;touchRow=h.closest('.variant-price-row');touchY=e.clientY;try{h.setPointerCapture(e.pointerId)}catch(_){}},true);
  wrap.addEventListener('pointermove',e=>{if(!touchRow)return; if(Math.abs(e.clientY-(touchY||e.clientY))<10)return; const target=document.elementFromPoint(e.clientX,e.clientY)?.closest?.('.variant-price-row'); if(!target||target===touchRow||!wrap.contains(target))return; const before=e.clientY<target.getBoundingClientRect().top+target.getBoundingClientRect().height/2; target.parentNode.insertBefore(touchRow,before?target:target.nextSibling);},true);
  wrap.addEventListener('pointerup',()=>{if(touchRow){persistVisibleVariantOrder();touchRow=null;}},true);
}
function persistVisibleVariantOrder(){const rows=[...document.querySelectorAll('#productVariantPricing .variant-price-row')];const byKey=new Map((window.__productVariants||[]).map(v=>[String(v.id||v._localKey||''),v]));window.__productVariants=rows.map((r,i)=>{const v=byKey.get(String(r.dataset.variantKey||""))||{_localKey:r.dataset.variantKey},value=c=>r.querySelector(c)?.value??'',titleEl=r.querySelector('.variant-row-title');if(titleEl)titleEl.textContent=`Variety ${i+1}`;return {...v,name:value('.variant-name').trim(),sale_price:value('.variant-sale-price'),discount_price:value('.variant-discount-price'),size:value('.variant-size').trim(),color:value('.variant-color').trim(),description:value('.variant-description'),rental_rate:value('.variant-rental-rate')===''?null:Number(value('.variant-rental-rate')),quantity_available:value('.variant-quantity')===''?null:Number(value('.variant-quantity')),photo_url:r.querySelector('.variant-image')?.value||r.dataset.photoUrl||v.photo_url||'',sort_order:i};});}
function collectProductVariantDrafts(photoUrls, pricingFallback={}) {
  persistVisibleVariantOrder();
  const rows=[...document.querySelectorAll('#productVariantPricing .variant-price-row')];
  const drafts=[];
  const fallbackSale=Number(pricingFallback?.salePriceFallback);
  const fallbackRental=Number(pricingFallback?.rentalRateFallback);
  rows.forEach((row,index)=>{
    const nameInput=String(row.querySelector('.variant-name')?.value||'').trim();
    const saleRaw=String(row.querySelector('.variant-sale-price')?.value??'').trim();
    const discountRaw=String(row.querySelector('.variant-discount-price')?.value??'').trim();
    const size=String(row.querySelector('.variant-size')?.value||'').trim()||null;
    const color=String(row.querySelector('.variant-color')?.value||'').trim()||null;
    const descriptionRaw=String(row.querySelector('.variant-description')?.value||'').trim();
    const quantityRaw=String(row.querySelector('.variant-quantity')?.value??'').trim();
    let photoUrl=row.querySelector('.variant-image')?.value || row.dataset.photoUrl || '';
    if(row.dataset.tempIndex!=='')photoUrl=photoUrls[Number(row.dataset.tempIndex)]||photoUrl;
    const source=(window.__productVariants||[]).find(v=>String(v.id||v._localKey)===row.dataset.variantKey);
    const hasUploadedPhoto=!!source?._imageFile || !!window.__productVariantPhotoFiles?.[String(row.dataset.variantKey||'')];
    const hasMeaningfulInput=!!nameInput || saleRaw!=='' || discountRaw!=='' || !!size || !!color || !!descriptionRaw || quantityRaw!=='' || !!photoUrl || hasUploadedPhoto;
    if(!hasMeaningfulInput)return;

    // The editor deliberately treats name and price as optional. The database
    // requires a name and the existing variant RPC requires a positive sale price,
    // so give an image-only/partially-filled variety a stable name and inherit the
    // product's base price rather than silently dropping the row.
    const name=nameInput || `Variety ${index+1}`;
    const inheritedPrice=Number.isFinite(fallbackSale)&&fallbackSale>0 ? fallbackSale : (Number.isFinite(fallbackRental)&&fallbackRental>0 ? fallbackRental : null);
    const sale=saleRaw==='' ? inheritedPrice : Number(saleRaw);
    const discount=discountRaw===''?null:Number(discountRaw);
    if(!Number.isFinite(sale)||sale<=0)throw new Error(`Enter a valid price for ${name}, or enter a base product price first.`);
    if(discount!=null&&(!Number.isFinite(discount)||discount<=0||discount>=sale))throw new Error(`Discount price for ${name} must be lower than its regular price.`);
    const raw=row.querySelector('.variant-quantity')?.value??'',quantity_available=raw===''?null:Number(raw);
    if(quantity_available!=null&&(!Number.isInteger(quantity_available)||quantity_available<0))throw new Error(`Enter a whole-number quantity for ${name}.`);
    const saved=(window.__productVariants||[]).find(v=>String(v.id||v._localKey)===row.dataset.variantKey);
    const rentalInput=row.querySelector('.variant-rental-rate');
    const rentalRate=rentalInput ? (rentalInput.value==='' ? null : Number(rentalInput.value)) : (saved?.rental_rate ?? null);
    drafts.push({...(saved?.id?{id:saved.id}:{}),_localKey:row.dataset.variantKey||null,name,photo_url:photoUrl||null,sale_price:sale,discount_price:discount,size,color,description:descriptionRaw||null,rental_rate:rentalRate,quantity_available,sort_order:index});
  });
  return drafts;
}
async function saveProductVariants(productId,drafts){
  if(!productId)return [];
  const sourceVariants=Array.isArray(window.__productVariants)?window.__productVariants:[];
  const sourceByKey=new Map(sourceVariants.map(v=>[String(v.id||v._localKey||""),v]));
  const input=Array.isArray(drafts)?drafts:[];
  const payload=input.map((d,index)=>{
    const row={
      id:d.id||crypto.randomUUID(),
      product_id:productId,
      name:String(d.name||"").trim(),
      photo_url:d.photo_url||null,
      sale_price:d.sale_price===""||d.sale_price==null?null:Number(d.sale_price),
      discount_price:d.discount_price===""||d.discount_price==null?null:Number(d.discount_price),
      rental_rate:d.rental_rate===""||d.rental_rate==null?null:Number(d.rental_rate),
      sort_order:Number.isFinite(Number(d.sort_order))?Number(d.sort_order):index,
      quantity_available:Number.isFinite(Number(d.quantity_available))?Math.max(0,Math.trunc(Number(d.quantity_available))):0,
      size:d.size||null,
      color:d.color||null,
      description:d.description||null
    };
    if(!row.name)throw new Error("Every variety needs a variety name.");
    return row;
  });

  console.info("[LEVROMART VARIANT SAVE]", { productId, submitted: payload.length });
  const {data:savedRows,error}=await sb.rpc("save_product_variants",{p_product_id:productId,p_variants:payload});
  if(error)throw new Error(error.message||"Could not save varieties.");

  const rows = Array.isArray(savedRows) ? savedRows : normalizeVariantRowsForEditor(savedRows);
  if(rows.length !== payload.length){
    throw new Error(`Variety save returned ${rows.length} rows, but ${payload.length} were submitted.`);
  }

  const localById=new Map(payload.map(v=>[String(v.id),v]));
  const next=rows.map((row,i)=>{
    const source=localById.get(String(row.id))||payload[i];
    const original=sourceByKey.get(String(source?.id||source?._localKey||"")) || sourceByKey.get(String(input[i]?._localKey||""));
    return {
      ...row,
      _localKey:original?._localKey||source?._localKey||row.id,
      ...(original?._imageFile?{_imageFile:original._imageFile}:{}),
      ...(original?._previewUrl?{_previewUrl:original._previewUrl}: {})
    };
  });
  window.__productVariants=next;
  console.info("[LEVROMART VARIANT SAVE]", { submitted:payload.length, returned:next.length });
  return next;
}
function normalizeVariantRowsForEditor(value){
  if(Array.isArray(value))return value;
  if(typeof value==='string'){try{const p=JSON.parse(value);return Array.isArray(p)?p:[]}catch(_){return[]}}
  if(value&&typeof value==='object'){
    for(const k of ['variants','data','result','items']){
      if(Array.isArray(value[k]))return value[k];
      if(typeof value[k]==='string'){try{const p=JSON.parse(value[k]);if(Array.isArray(p))return p}catch(_) {}}
    }
  }
  return [];
}

function syncProductEngagementSettingsUI(){byId("prodCommentAudienceWrap")?.classList.toggle("hidden",!byId("prodAllowComments")?.checked);}
async function saveProductEngagementSettings(id){if(!id||!vendor?.id)return;const {error}=await sb.from("product_engagement_settings").upsert({product_id:id,vendor_id:vendor.id,like_visibility:byId("prodLikeVisibility")?.value||"everyone",allow_comments:!!byId("prodAllowComments")?.checked,comment_audience:byId("prodCommentAudience")?.value||"everyone"},{onConflict:"product_id"});if(error)throw error;}
async function refreshSavedProductState(productId) {
  if (!productId) return null;

  const [{ data: savedProduct, error: productError }, variantResult] = await Promise.all([
    sb.from("products").select("*, vendor:vendors!inner(id, business_name, previous_business_name, name_changed_at, city, address, phone, whatsapp_number, whatsapp_visible, avg_rating, review_count, verification_status, cac_number, created_at, is_active, logo_url, delivery_fee, delivery_fee_mode, delivery_fee_per_km, lat, lng), category:categories(name, sector_id)").eq("id", productId).maybeSingle(),
    sb.rpc("get_owned_product_variants", { p_product_id: productId })
  ]);
  let savedVariants = Array.isArray(variantResult.data) ? variantResult.data : [], variantsError = variantResult.error;
  if (variantsError) {
    const direct = await sb.from("product_variants").select("*").eq("product_id", productId).order("sort_order", {ascending:true}).order("created_at", {ascending:true});
    savedVariants = direct.data || [];
    variantsError = direct.error;
  }

  if (productError) throw productError;
  if (!savedProduct) throw new Error("The product was saved, but the latest saved product could not be loaded.");

  if (variantsError) {
    console.warn("[Levromart] Saved product loaded, but its varieties could not be refreshed:", variantsError);
  }
  savedProduct.variants = savedVariants || [];

  const replaceById = (list) => {
    if (!Array.isArray(list)) return list;
    let changed = false;
    const next = list.map((p) => {
      if (!p || String(p.id) !== String(productId)) return p;
      changed = true;
      return { ...p, ...savedProduct };
    });
    return changed ? next : list;
  };

  window.__homeBrowseCatalog = replaceById(window.__homeBrowseCatalog);
  window.__storefrontProducts = replaceById(window.__storefrontProducts);
  try {
    const cache = getOfflineHomeCache();
    if (cache) {
      writeOfflineHomeCache({
        ...cache,
        browseProducts: replaceById(cache.browseProducts),
        trending: replaceById(cache.trending),
        recentProducts: replaceById(cache.recentProducts)
      });
    }
  } catch (_) {}

  if (currentProductDetail && String(currentProductDetail.id) === String(productId)) {
    currentProductDetail = savedProduct;
  }

  try {
    window.__productPhotoCache ||= {};
    window.__productPhotoCache[productId] = Array.isArray(savedProduct.photos) ? savedProduct.photos : [];
  } catch (_) {}

  return savedProduct;
}

async function refreshVisibleProductAfterSave(productId) {
  const savedProduct = await refreshSavedProductState(productId);
  const view = currentView;
  const params = currentViewParams || {};

  // Re-render only the SPA view that was already open. Never force Home or
  // reload the entire document; the saved product remains the single source
  // of truth for the refreshed representation.
  if (view === "productDetail" && String(params.productId) === String(productId)) {
    await navigate("productDetail", { productId }, false);
  } else if (view === "vendorProducts") {
    await navigate("vendorProducts", {}, false);
  } else {
    document.querySelectorAll(`.product-card-wrap[data-product-id="${CSS.escape(String(productId))}"]`).forEach((node) => {
      const context = node.querySelector(".product-card-action-row")?.classList.contains("trending-card-action-row") ? "trending" : "";
      const nextProduct = { ...savedProduct, _cardContext: context };
      const template = document.createElement("template");
      template.innerHTML = productCardHtml(nextProduct).trim();
      const nextNode = template.content.firstElementChild;
      if (nextNode) node.replaceWith(nextNode);
    });
  }

  return savedProduct;
}

function clearProductValidationState() {
  document.querySelectorAll(".product-field-validation-message").forEach(el => el.remove());
  document.querySelectorAll(".product-validation-focus").forEach(el => el.classList.remove("product-validation-focus"));
  document.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute("aria-invalid"));
}

function focusProductValidationField(message) {
  clearProductValidationState();
  const text = String(message || "Please complete this field before saving.");
  const rules = [
    [/^Product name is required/i, "prodName"],
    [/^Choose how you want to pay Levromart/i, "prodBillingModel"],
    [/^Price is required|^Enter a price for this service/i, "prodSalePrice"],
    [/^Discount price must be lower/i, "prodDiscountPrice"],
    [/^Enter a fee per kilometre/i, "prodDeliveryPerKm"],
    [/^Enter a buyer deposit percentage/i, "prodPaymentDepositPercent"],
    [/^Rental rate is required/i, "prodRentalRate"],
    [/^Type a name for the new sector/i, "prodSectorOther"],
    [/^Type a name for the new category/i, "prodCategoryOther"],
    [/^Couldn't create that sector/i, "prodSectorOther"],
    [/^Couldn't create that category/i, "prodCategoryOther"],
    [/^This sector does not have an Other category/i, "prodCategory"]
  ];
  let fieldId = null;
  for (const [pattern, id] of rules) { if (pattern.test(text)) { fieldId = id; break; } }
  const field = fieldId ? byId(fieldId) : null;
  if (!field) return;

  field.classList.add("product-validation-focus");
  field.setAttribute("aria-invalid", "true");
  const msg = document.createElement("div");
  msg.className = "product-field-validation-message";
  msg.setAttribute("role", "alert");
  msg.textContent = text;
  field.insertAdjacentElement("afterend", msg);

  requestAnimationFrame(() => {
    try { field.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) { field.scrollIntoView(); }
    setTimeout(() => {
      try { field.focus({ preventScroll: true }); } catch (_) { try { field.focus(); } catch (_) {} }
    }, 180);
  });
}

function bindProductValidationClearers() {
  if (window.__levromartProductValidationClearersBound) return;
  window.__levromartProductValidationClearersBound = true;
  document.addEventListener("input", e => {
    if (e.target?.closest?.("#productModal") && (e.target.matches?.("#prodName,#prodSalePrice,#prodDiscountPrice,#prodRentalRate,#prodDeliveryPerKm,#prodPaymentDepositPercent,#prodSectorOther,#prodCategoryOther"))) {
      e.target.classList.remove("product-validation-focus");
      e.target.removeAttribute("aria-invalid");
      e.target.parentElement?.querySelector?.(":scope > .product-field-validation-message")?.remove();
      e.target.nextElementSibling?.classList?.contains("product-field-validation-message") && e.target.nextElementSibling.remove();
    }
  }, true);
  document.addEventListener("change", e => {
    if (e.target?.closest?.("#productModal") && e.target.matches?.("#prodBillingModel,#prodCategory,#prodSector")) {
      e.target.classList.remove("product-validation-focus");
      e.target.removeAttribute("aria-invalid");
      e.target.nextElementSibling?.classList?.contains("product-field-validation-message") && e.target.nextElementSibling.remove();
    }
  }, true);
}

bindProductValidationClearers();

/*
 * Service-save click guard.
 * Some mobile/browser event layers can swallow the inline click on the service
 * submit button after the service form is dynamically enhanced. Handle service
 * saves at capture level so the intended save path always receives the tap.
 * Physical-product saves keep their existing handler unchanged.
 */
(function bindServiceSaveButtonGuard(){
  if(window.__levromartServiceSaveButtonGuardBound)return;
  window.__levromartServiceSaveButtonGuardBound=true;
  document.addEventListener("click",function(e){
    const btn=e.target?.closest?.("#saveProductBtn");
    if(!btn || !byId("prodIsService")?.checked)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(btn.disabled)return;
    Promise.resolve(window.saveProduct ? window.saveProduct() : saveProduct()).catch(err=>{
      console.error("[LEVROMART SERVICE SAVE CLICK]",err);
      showToast?.(err?.message||"Could not save this service.","error");
    });
  },true);
})();

async function saveProduct() {
  const errorEl = byId("productError");
  errorEl.classList.add("hidden");
  const btn = byId("saveProductBtn");
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.dataset.originalLabel = btn.innerHTML;

  const originalProductId = editingProductId || null;
  let createdProductId = null;
  const uploadedStoragePaths = [];
  let savedDraftIdentity = originalProductId || "new";

  const setSaveStage = (label) => {
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${esc(label)}`;
  };

  const removeUploadedFiles = async () => {
    if (!uploadedStoragePaths.length) return;
    try {
      const { error } = await sb.storage.from("product-photos").remove(uploadedStoragePaths);
      if (error) console.warn("[LEVROMART IMAGE ROLLBACK] Storage cleanup failed:", error);
    } catch (e) {
      console.warn("[LEVROMART IMAGE ROLLBACK] Storage cleanup exception:", e);
    }
  };

  const normalizeVariantRows = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; }
    }
    if (value && typeof value === "object") {
      for (const key of ["variants", "data", "result", "items"]){
        const candidate = value[key];
        if (Array.isArray(candidate)) return candidate;
        if (typeof candidate === "string") {
          try { const parsed = JSON.parse(candidate); if (Array.isArray(parsed)) return parsed; } catch (_) {}
        }
      }
    }
    return [];
  };

  const verifySavedState = async (productId, expectedVariantIds, expectedPhotos) => {
    setSaveStage("Verifying…");
    const [{ data: serverProduct, error: productErr }, { data: serverVariants, error: variantErr }] = await Promise.all([
      sb.from("products").select("id,photos,vendor_id").eq("id", productId).eq("vendor_id", vendor.id).single(),
      sb.from("product_variants").select("id,product_id,name,photo_url,sale_price,discount_price,rental_rate,sort_order,quantity_available,size,color,description").eq("product_id", productId).order("sort_order", {ascending:true}).order("created_at", {ascending:true})
    ]);
    if (productErr) throw new Error(`Save verification failed: ${productErr.message}`);
    if (variantErr) throw new Error(`Variety verification failed: ${variantErr.message}`);

    const actualVariants = normalizeVariantRows(serverVariants);
    const actualIds = actualVariants.map(v => String(v.id)).sort();
    const expectedIds = (expectedVariantIds || []).map(String).sort();
    const actualPhotos = Array.isArray(serverProduct?.photos) ? serverProduct.photos : [];
    const photoMismatch = JSON.stringify(actualPhotos) !== JSON.stringify(Array.isArray(expectedPhotos) ? expectedPhotos : []);
    const variantMismatch = actualIds.length !== expectedIds.length || actualIds.some((id,i) => id !== expectedIds[i]);

    console.info("[LEVROMART SAVE VERIFY]", {
      productId,
      expectedVariants: expectedIds.length,
      serverVariants: actualIds.length,
      expectedPhotos: Array.isArray(expectedPhotos) ? expectedPhotos.length : 0,
      serverPhotos: actualPhotos.length,
      variantIdsMatch: !variantMismatch,
      photosMatch: !photoMismatch
    });

    if (variantMismatch) throw new Error(`Save verification failed: expected ${expectedIds.length} varieties, but the server has ${actualIds.length}.`);
    if (photoMismatch) throw new Error(`Save verification failed: expected ${Array.isArray(expectedPhotos) ? expectedPhotos.length : 0} product photos, but the server returned ${actualPhotos.length}.`);

    return { product: serverProduct, variants: actualVariants };
  };

  try {
    const is_service = byId("prodIsService").checked;
    const listing_type = is_service ? "sale" : byId("prodListingType").value;
    const billing_model = byId("prodBillingModel")?.value || "commission";
    const name = byId("prodName").value.trim();
    // Some listings (food, made-to-order items) genuinely have no fixed
    // stock count -- forcing a number onto them meant they'd eventually hit
    // "0 available" and look permanently sold out. When the vendor switches
    // quantity tracking off, treat the item as effectively unlimited instead
    // of asking for a number that doesn't mean anything for it.
    const track_quantity = is_service ? false : !!byId("prodTrackQuantity")?.checked;
    const quantity_total = is_service ? 999 : (track_quantity ? (parseInt(byId("prodQtyTotal").value) || 1) : 999999);
    const sale_price = byId("prodSalePrice").value ? Number(byId("prodSalePrice").value) : null;
    const discount_price = is_service && billing_model === "commission" ? null : (byId("prodDiscountPrice").value ? Number(byId("prodDiscountPrice").value) : null);
    const rental_rate = is_service ? null : (byId("prodRentalRate").value ? Number(byId("prodRentalRate").value) : null);
    const delivery_fee_mode = is_service ? "free" : (byId("prodDeliveryMode").value || "free");
    const delivery_fee = is_service || delivery_fee_mode !== "flat" ? 0 : Math.max(0, Number(byId("prodDeliveryFee").value) || 0);
    const delivery_fee_per_km = is_service || delivery_fee_mode !== "distance" ? 0 : Math.max(0, Number(byId("prodDeliveryPerKm").value) || 0);
    const payment_timing = is_service ? "pay_before" : (byId("prodPaymentTiming")?.value === "pay_after" ? "pay_after" : "pay_before");
    const paymentDepositRaw = String(byId("prodPaymentDepositPercent")?.value ?? "").trim();
    const payment_deposit_percent = paymentDepositRaw === "" ? null : Math.max(1, Math.min(99, Number(paymentDepositRaw)));
    const rental_rate_unit = byId("prodRateUnit").value;
    const service_price_unit = is_service ? (byId("prodServiceUnit").value || "flat") : null;

    if (!name) throw new Error("Product name is required.");
    if (!["commission","monthly"].includes(billing_model)) throw new Error("Choose how you want to pay Levromart for this listing.");
    if (!is_service && listing_type !== "rent" && !sale_price) throw new Error("Price is required for a sale listing.");
    if (is_service && !sale_price) throw new Error("Enter a service price/rate.");
    if (is_service && billing_model === "monthly" && !sale_price) throw new Error("Enter a fixed price for this monthly service listing.");
    if (discount_price != null && (sale_price == null || discount_price <= 0 || discount_price >= sale_price)) throw new Error("Discount price must be lower than the regular price.");
    if (delivery_fee_mode === "distance" && delivery_fee_per_km <= 0) throw new Error("Enter a fee per kilometre for distance-based delivery.");
    if (payment_timing === "pay_after" && (!Number.isFinite(payment_deposit_percent) || payment_deposit_percent < 1 || payment_deposit_percent > 99)) throw new Error("Enter a buyer deposit percentage between 1% and 99%.");
    if (listing_type !== "sale" && !rental_rate) throw new Error("Rental rate is required for a rental listing.");
    if (!byId("prodDesc").value.trim()) { byId("prodDesc").focus(); throw new Error("Add a description so buyers know what they're getting."); }

    let chosenSectorId = byId("prodSector").value || null;
    if (chosenSectorId === "__other__") {
      const customSectorName = byId("prodSectorOther").value.trim();
      if (!customSectorName) throw new Error("Type a name for the new sector, or pick one from the list.");
      const { data: newSectorId, error: sectorErr } = await sb.rpc("create_vendor_sector", { p_name: customSectorName });
      if (sectorErr) throw new Error(`Couldn't create that sector: ${sectorErr.message}`);
      chosenSectorId = newSectorId;
      sectors = []; window.__prodRefs = null;
    }

    let category_id = byId("prodCategory").value || null;
    if (category_id === "__other__") {
      const customName = byId("prodCategoryOther").value.trim();
      if (!customName) throw new Error("Type a name for the new category, or pick one from the list.");
      const { data: otherParent } = await sb.from("categories").select("id").eq("sector_id", chosenSectorId).is("parent_category_id", null).ilike("name", "Other").maybeSingle();
      if (!otherParent?.id) throw new Error("This sector does not have an Other category yet. Leave the category as Uncategorized or choose another category.");
      const { data: newCategoryId, error: catErr } = await sb.rpc("create_vendor_category", { p_name: customName, p_sector_id: chosenSectorId, p_parent_category_id: otherParent.id });
      if (catErr) throw new Error(`Couldn't create that category: ${catErr.message}`);
      category_id = newCategoryId;
      window.__prodRefs = null;
    }

    const fields = {
      name,
      description: stripProductVariantMeta(byId("prodDesc").value.trim()) || null,
      category_id,
      condition: byId("prodCondition").value,
      listing_type,
      is_service,
      service_price_unit,
      sale_price: listing_type === "rent" ? null : sale_price,
      discount_price: listing_type === "rent" ? null : discount_price,
      delivery_fee_mode,
      delivery_fee,
      delivery_fee_per_km,
      payment_timing,
      payment_deposit_percent,
      rental_rate: listing_type === "sale" ? null : rental_rate,
      rental_rate_unit: listing_type === "sale" ? null : rental_rate_unit,
      deposit_amount: is_service ? null : (byId("prodDeposit").value ? Number(byId("prodDeposit").value) : null),
      quantity_total,
      track_quantity,
      billing_model
    };
    if (originalProductId) {
      delete fields.billing_model;
    } else if (billing_model === "monthly") {
      fields.billing_status = "pending_payment";
      fields.billing_paid_until = null;
      fields.status = "paused";
    } else {
      fields.billing_status = "active";
      fields.billing_paid_until = null;
    }

    window.__displayPictureWasReplaced = !!window.__replaceDisplayPicture || (!((window.__existingPhotos || []).length) && !!(window.__newProductPhotoFiles || []).length);
    const newFiles = [...(window.__newProductPhotoFiles || byId("prodPhotoFiles")?.files || [])].filter(f => f?.type?.startsWith("image/"));
    const basePhotos = [...(window.__existingPhotos || [])];

    // Snapshot the editor BEFORE any server mutation. Every later write is derived
    // from this one snapshot, so a render/draft observer cannot change what Save means.
    const variantDrafts = collectProductVariantDrafts(basePhotos, { salePriceFallback: sale_price, rentalRateFallback: rental_rate }).map((d, index) => ({
      ...d,
      id: d.id || crypto.randomUUID(),
      sort_order: index
    }));
    const expectedVariantIds = variantDrafts.map(v => String(v.id));

    console.info("[LEVROMART PRODUCT SAVE]", {
      productId: originalProductId,
      variantCount: variantDrafts.length,
      productImageCount: newFiles.length + basePhotos.length,
      variantImageCount: variantDrafts.filter(v => {
        const source = (window.__productVariants || []).find(x => String(x.id || x._localKey) === String(v.id || v._localKey));
        return !!source?._imageFile;
      }).length
    });

    // IMPORTANT: upload all new media BEFORE changing the product/variant rows.
    // This removes the old race where the database was updated first and a later
    // storage failure left the UI saying "saved" without the requested image.
    setSaveStage("Preparing photos…");
    const variantSourceByKey = new Map((window.__productVariants || []).map(v => [String(v.id || v._localKey || ""), v]));

    const uploadOne = async (file, folder) => {
      const ext = (file.name?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `product-photos/${vendor.id}/${folder ? folder + "/" : ""}${crypto.randomUUID()}.${ext}`;
      let uploadBlob = file;
      try { if (typeof window.compressImage === "function") uploadBlob = await window.compressImage(file, { maxWidth: 1600, maxHeight: 1600 }); } catch (_) {}
      let publicUrl;
      try { publicUrl = await uploadToR2(uploadBlob, path, uploadBlob.type || file.type || "image/jpeg"); }
      catch (upErr) { throw new Error(`Photo upload failed: ${upErr.message}`); }
      uploadedStoragePaths.push(path);
      return publicUrl;
    };

    // Upload every photo (display + extras + varieties) at the same time, a few at once,
    // instead of one after another -- the main reason saving felt slow.
    const pool = async (tasks, limit = 4) => {
      const out = new Array(tasks.length); let next = 0;
      const worker = async () => { while (next < tasks.length) { const k = next++; out[k] = await tasks[k](); } };
      await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
      return out;
    };
    const jobs = [];
    newFiles.forEach((file) => jobs.push(async () => ({ kind: "main", url: await uploadOne(file, "") })));
    variantDrafts.forEach((draft) => {
      const source = variantSourceByKey.get(String(draft._localKey || draft.id || ""));
      if (source?._imageFile) jobs.push(async () => ({ kind: "variant", draft, url: await uploadOne(source._imageFile, "variants") }));
    });
    if (jobs.length) setSaveStage(`Uploading ${jobs.length} photo${jobs.length === 1 ? "" : "s"}…`);
    const uploaded = await pool(jobs, 4);
    const mainUrls = uploaded.filter((u) => u.kind === "main").map((u) => u.url);

    // A display-picture replacement is represented by previewNewProductPhotos()
    // removing the old first photo before Save. Preserve that semantics here.
    let finalPhotos = [...basePhotos, ...mainUrls];
    if (window.__displayPictureWasReplaced && mainUrls.length) {
      finalPhotos = [mainUrls[0], ...basePhotos, ...mainUrls.slice(1)];
    }

    const uploadedVariantUrls = new Map();
    uploaded.filter((u) => u.kind === "variant").forEach((u) => { uploadedVariantUrls.set(String(u.draft.id), u.url); u.draft.photo_url = u.url; });

    const isNewMonthlyListing = !originalProductId && billing_model === "monthly";
    if (isNewMonthlyListing) {
      // Monthly listings still use the existing manual-payment flow. Uploaded files
      // are cleaned up if the handoff fails; no listing is created yet.
      window.__manualMonthlyNewDraft = {
        kind: "product", vendor_id: vendor.id,
        fields: { ...fields, status: "paused", billing_status: "pending_payment", billing_reference: null, billing_paid_until: null },
        photos: finalPhotos, variantDrafts,
        engagement: {
          like_visibility: byId("prodLikeVisibility")?.value || "everyone",
          allow_comments: !!byId("prodAllowComments")?.checked,
          comment_audience: byId("prodCommentAudience")?.value || "everyone"
        }
      };
      try {
        closeProductModal({ skipDraft: true });
        await openManualMonthlyPayment("product", null, { isNew: true, draft: window.__manualMonthlyNewDraft });
      } catch (e) {
        await removeUploadedFiles();
        throw e;
      }
      return;
    }

    // Preserve sold units when editing inventory, exactly as the previous flow did.
    const existingProduct = originalProductId
      ? (await sb.from("products").select("quantity_total,quantity_available,photos").eq("id", originalProductId).eq("vendor_id", vendor.id).single()).data
      : null;
    if (originalProductId && !existingProduct) throw new Error("The product could not be loaded for saving.");

    let soldUnits = 0;
    let savedProductId = originalProductId;
    let savedProductRow = null;

    setSaveStage("Saving product…");
    if (originalProductId) {
      soldUnits = Math.max(Number(existingProduct.quantity_total) - Number(existingProduct.quantity_available), 0);
      const quantity_available = Math.max(quantity_total - soldUnits, 0);
      const { data, error } = await sb.from("products")
        .update({ ...fields, quantity_available, photos: finalPhotos })
        .eq("id", originalProductId).eq("vendor_id", vendor.id)
        .select("*").single();
      if (error) throw new Error(error.message);
      savedProductRow = data;
    } else {
      const { data, error } = await sb.from("products")
        .insert({ ...fields, vendor_id: vendor.id, quantity_available: quantity_total, photos: finalPhotos })
        .select("*").single();
      if (error) throw new Error(error.message);
      savedProductId = data?.id;
      createdProductId = savedProductId;
      if (!savedProductId) throw new Error("Product was created but no product ID was returned.");
      savedProductRow = data;
    }

    editingProductId = savedProductId;
    savedDraftIdentity = savedProductId;

    // The RPC is intentionally kept because it is the existing transactional,
    // ownership-checked batch path. Crucially, every new variant already has a
    // stable UUID, so uploaded variety media cannot lose its identity.
    setSaveStage(variantDrafts.length ? `Saving ${variantDrafts.length} ${variantDrafts.length === 1 ? "variety" : "varieties"}…` : "Saving varieties…");
    await saveProductVariants(savedProductId, variantDrafts);

    // Ensure any uploaded variant image is also reflected in the local model. The
    // URL was already part of the RPC payload, so no second race-prone write is needed.
    for (const [id, url] of uploadedVariantUrls) {
      const local = (window.__productVariants || []).find(v => String(v.id) === String(id));
      if (local) { local.photo_url = url; delete local._imageFile; local._previewUrl = url; }
    }

    const verified = await verifySavedState(savedProductId, expectedVariantIds, finalPhotos);
    const verifiedVariants = verified.variants;

    console.info("[LEVROMART SAVE VERIFY]", {
      expectedVariants: expectedVariantIds.length,
      serverVariants: verifiedVariants.length,
      expectedPhotos: finalPhotos.length,
      serverPhotos: verified.product?.photos?.length || 0
    });

    window.__existingPhotos = Array.isArray(verified.product?.photos) ? [...verified.product.photos] : [...finalPhotos];
    window.__productVariants = verifiedVariants.map((row, index) => {
      const local = (window.__productVariants || []).find(v => String(v.id) === String(row.id));
      return { ...row, _localKey: local?._localKey || row.id, ...(local?._previewUrl ? { _previewUrl: local._previewUrl } : {}) };
    });

    const primarySavedProduct = {
      ...(savedProductRow || {}),
      ...(verified.product || {}),
      id: savedProductId,
      ...fields,
      vendor_id: vendor.id,
      photos: [...window.__existingPhotos],
      quantity_available: Number(savedProductRow?.quantity_available ?? verified.product?.quantity_available ?? Math.max(quantity_total - soldUnits, 0)),
      variants: verifiedVariants
    };

    window.__lastSavedProductRow = null;
    window.__replaceDisplayPicture = false;
    window.__displayPictureWasReplaced = false;
    window.__productVariantPhotoFiles = {};

    clearProductValidationState();
    window.clearListingDraft?.("product", savedDraftIdentity);
    if (!originalProductId) window.clearListingDraft?.("product", "new");
    renderProductVariantPricing();

    // Keep secondary engagement settings from blocking the critical product save.
    void saveProductEngagementSettings(savedProductId).catch(e => console.warn("[Levromart] Engagement settings sync failed:", e));

    // Refresh the local marketplace state from the verified server representation.
    window.__homeBrowseCatalog = Array.isArray(window.__homeBrowseCatalog)
      ? window.__homeBrowseCatalog.map(p => String(p.id) === String(savedProductId) ? { ...p, ...primarySavedProduct } : p)
      : window.__homeBrowseCatalog;
    window.__storefrontProducts = Array.isArray(window.__storefrontProducts)
      ? window.__storefrontProducts.map(p => String(p.id) === String(savedProductId) ? { ...p, ...primarySavedProduct } : p)
      : window.__storefrontProducts;
    if (currentProductDetail && String(currentProductDetail.id) === String(savedProductId)) currentProductDetail = { ...currentProductDetail, ...primarySavedProduct };

    document.querySelectorAll(`.product-card-wrap[data-product-id="${CSS.escape(String(savedProductId))}"]`).forEach(node => {
      const context = node.querySelector(".product-card-action-row")?.classList.contains("trending-card-action-row") ? "trending" : "";
      const tpl = document.createElement("template");
      tpl.innerHTML = productCardHtml({ ...primarySavedProduct, _cardContext: context }).trim();
      if (tpl.content.firstElementChild) node.replaceWith(tpl.content.firstElementChild);
    });

    btn.innerHTML = `<i class="fa-solid fa-check"></i> Saved`;
    showToast(newFiles.length || variantDrafts.some(v => uploadedVariantUrls.has(String(v.id))) ? "Listing and photos saved successfully." : "Listing saved successfully.", "success");
    closeProductModal({ skipDraft: true });

    if (currentView === "vendorProducts") void navigate("vendorProducts", {}, false).catch(e => console.warn("[Levromart] Post-save navigation failed:", e));
    else if (currentView === "productDetail" && String(currentViewParams?.productId) === String(savedProductId)) void navigate("productDetail", { productId: savedProductId }, false).catch(e => console.warn("[Levromart] Post-save navigation failed:", e));

    // This is now a non-critical UI reconciliation only. It can never be the
    // thing that determines whether Save succeeded because verification already did.
    void refreshVisibleProductAfterSave(savedProductId).catch(e => console.warn("[Levromart] Post-save product reconciliation failed:", e));
  } catch (err) {
    // If we created a product and anything after creation failed, remove the newly
    // created record. Existing products are never deleted as a rollback shortcut.
    if (createdProductId) {
      try {
        await sb.from("product_variants").delete().eq("product_id", createdProductId).eq("product_id", createdProductId);
        await sb.from("products").delete().eq("id", createdProductId).eq("vendor_id", vendor.id);
      } catch (rollbackErr) {
        console.error("[LEVROMART SAVE ROLLBACK] Failed to remove incomplete new product:", rollbackErr);
      }
    }
    await removeUploadedFiles();
    console.error("[LEVROMART PRODUCT SAVE FAILED]", err);
    const message = err?.message || "Could not save this product. Nothing was reported as saved.";
    focusProductValidationField(message);
    showToast(message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalLabel || "Save to Product";
    delete btn.dataset.originalLabel;
  }
}

function listingActivationValid(p) {
  return p?.billing_model === "monthly" && Number.isFinite(Date.parse(p.billing_paid_until)) && Date.parse(p.billing_paid_until) > Date.now();
}
async function setProductStatus(id, status) {
  if (!vendor?.id) { showToast("Your vendor profile is unavailable. Please sign in again.", "error"); return; }
  try {
    if (status === "active") {
      // Commission listings can be reactivated directly. Only monthly listings
      // need the ₦999 renewal flow, and only when their paid period has expired.
      const { data: p, error: readErr } = await sb.from("products")
        .select("id,name,status,billing_model,billing_status,billing_paid_until")
        .eq("id", id).eq("vendor_id", vendor.id).maybeSingle();
      if (readErr) throw readErr;
      if (!p) throw new Error("Product not found.");
      if (p.billing_model === "monthly" && !listingActivationValid(p)) {
        return startListingMonthlyPayment("product", id);
      }
      const { error } = await sb.from("products")
        .update({ status: "active", billing_status: p.billing_model === "monthly" ? "active" : p.billing_status })
        .eq("id", id).eq("vendor_id", vendor.id);
      if (error) throw error;
      showToast(`${p.name || "Product"} is active again.`, "success");
    } else {
      const { error } = await sb.from("products").update({ status }).eq("id", id).eq("vendor_id", vendor.id);
      if (error) throw error;
      showToast("Product paused.", "success");
    }
    await navigate("vendorProducts", {}, false);
  } catch (err) {
    showToast(err?.message || "Could not update this product.", "error");
  }
}
async function removeProduct(id) {
  if ((window.__vendorPendingProductIds || new Set()).has(id)) {
    showToast("This product has a pending order. It can't be removed until that order is cleared (completed, returned, or cancelled).", "error");
    return;
  }
  if (!(await showConfirmDialog("Remove this listing? It will no longer be visible to buyers.", { title: "Remove listing", okLabel: "Remove", danger: true }))) return;
  const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
  const { error } = await sb.from("products").update({ status: "removed" }).eq("id", id).eq("vendor_id", vendor.id);
  if (error) { showToast(error.message, "error"); return; }
  invalidateMarketplaceState();
  showToast("Product moved to Discarded items.", "success");
  await navigate("vendorProducts", {}, false);
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: Math.max(0, scrollY), left: 0, behavior: "auto" })));
}
function toggleVendorProductsMenu(event) {
  event?.stopPropagation?.();
  byId("vendorProductsMenu")?.classList.toggle("hidden");
}
function toggleVendorDiscarded(event, force) {
  event?.stopPropagation?.();
  const panel = byId("vendorDiscardedPanel");
  const menu = byId("vendorProductsMenu");
  if (!panel) return;
  const open = typeof force === "boolean" ? force : panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !open);
  menu?.classList.add("hidden");
  if (open) panel.scrollIntoView({ behavior:"smooth", block:"start" });
}
async function restoreProduct(id) {
  const { data: p, error: readErr } = await sb.from("products").select("id,name,status,billing_model,billing_status,billing_paid_until").eq("id", id).eq("vendor_id", vendor.id).maybeSingle();
  if (readErr || !p) { showToast("That discarded product could not be found.", "error"); return; }
  if (p.billing_model === "monthly") {
    const paidUntil = p.billing_paid_until ? new Date(p.billing_paid_until).getTime() : 0;
    if (paidUntil <= Date.now()) {
      const confirmed = await showConfirmDialog(`${p.name} needs a new ₦999 monthly listing payment before it can be restored. Continue to Paystack?`, { title:"Renew listing", okLabel:"Pay ₦999", danger:false });
      if (!confirmed) return;
      await startListingMonthlyPayment("product", id);
      return;
    }
  }
  const { error } = await sb.from("products").update({ status:"active", billing_status: p.billing_model === "monthly" ? "active" : p.billing_status }).eq("id", id).eq("vendor_id", vendor.id);
  if (error) { showToast(error.message || "Could not restore this product.", "error"); return; }
  showToast(`${p.name} restored to your live products.`, "success");
  navigate("vendorProducts");
}
async function deleteProductCompletely(id, options = {}) {
  if ((window.__vendorPendingProductIds || new Set()).has(id)) {
    showToast("This product has a pending order. It can't be deleted until that order is cleared.", "error");
    return false;
  }
  if (!options.skipConfirm && !(await showConfirmDialog("Delete this product completely? If order history prevents deletion, it will remain in Discarded items instead.", { title: "Delete permanently", okLabel: "Delete permanently", danger: true }))) return false;
  const card = document.querySelector(`.vendor-discarded-card[data-discarded-id="${CSS.escape(String(id))}"]`);
  const { error } = await sb.from("products").delete().eq("id", id).eq("vendor_id", vendor.id);
  if (error) {
    await sb.from("products").update({ status:"removed", billing_status: "cancelled" }).eq("id", id).eq("vendor_id", vendor.id);
    showToast("This product has past order history, so it was kept safely in Discarded items.", "error");
    return false;
  }
  card?.remove();
  updateDiscardedSelection();
  if (!document.querySelector('.vendor-discarded-card')) {
    const grid = document.querySelector('.vendor-discarded-grid');
    if (grid) grid.outerHTML = '<div class="empty-state" style="margin:0;">No discarded products.</div>';
    document.querySelector('.vendor-discarded-bulkbar')?.remove();
  }
  showToast("Product permanently deleted.", "success");
  return true;
}
function updateDiscardedSelection(){
  const checks=[...document.querySelectorAll('.discarded-item-check')];
  const selected=checks.filter(c=>c.checked);
  const count=byId('discardedSelectedCount'); if(count) count.textContent=`${selected.length} selected`;
  const bulk=byId('discardedBulkDeleteBtn'); if(bulk) bulk.disabled=selected.length===0;
  const all=byId('discardedSelectAll'); if(all){all.checked=checks.length>0&&selected.length===checks.length;all.indeterminate=selected.length>0&&selected.length<checks.length;}
}
function toggleAllDiscardedItems(checked){
  document.querySelectorAll('.discarded-item-check').forEach(c=>c.checked=!!checked);
  updateDiscardedSelection();
}
async function deleteSelectedDiscardedItems(){
  const ids=[...document.querySelectorAll('.discarded-item-check:checked')].map(c=>c.value).filter(Boolean);
  if(!ids.length)return;
  if(!(await showConfirmDialog(`Delete ${ids.length} selected discarded product${ids.length===1?'':'s'} permanently?`,{title:'Delete selected',okLabel:'Delete permanently',danger:true})))return;
  const bulk=byId('discardedBulkDeleteBtn'); if(bulk)bulk.disabled=true;
  for(const id of ids) await deleteProductCompletely(id,{skipConfirm:true});
  updateDiscardedSelection();
}

