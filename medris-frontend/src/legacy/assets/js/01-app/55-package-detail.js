// ---------- PACKAGE DETAIL ----------
let packageDetailGalleryIndex = 0;
function setPackageDetailPhoto(index, smooth = true) {
  const photos = window.__packageDetailPhotos || [];
  const track = byId("packageDetailGalleryTrack");
  if (!photos.length || !track) return;
  packageDetailGalleryIndex = Math.max(0, Math.min(index, photos.length - 1));
  const slide = track.querySelector(`.package-detail-gallery-slide[data-gallery-index="${packageDetailGalleryIndex}"]`);
  if (slide) {
    const targetLeft = slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2;
    track.scrollTo({ left: Math.max(0, targetLeft), behavior: smooth ? "smooth" : "auto" });
  }
  const count = byId("packageGalleryCount");
  if (count) count.textContent = String(packageDetailGalleryIndex + 1);
}
function changePackageDetailPhoto(delta) { setPackageDetailPhoto(packageDetailGalleryIndex + delta); }
function syncPackageGalleryIndex(track) {
  if (!track) return;
  const slides = [...track.querySelectorAll('.package-detail-gallery-slide')];
  if (!slides.length) return;
  const center = track.scrollLeft + track.clientWidth / 2;
  let best = 0, bestDist = Infinity;
  slides.forEach((slide, i) => {
    const c = slide.offsetLeft + slide.offsetWidth / 2;
    const d = Math.abs(c - center);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  packageDetailGalleryIndex = Number(slides[best].dataset.galleryIndex) || 0;
  const count = byId('packageGalleryCount');
  if (count) count.textContent = String(packageDetailGalleryIndex + 1);
}



async function togglePackageFavorite(evt, packageId) {
  evt?.stopPropagation?.();
  if (!session) { showLogin(); return; }
  const isFav = packageFavoriteIds.has(packageId);
  const btn = evt?.currentTarget || document.querySelector(`.package-fav-btn[data-package-id="${packageId}"]`);
  if (btn) btn.disabled = true;
  try {
    if (isFav) {
      const { error } = await levroData.favorites.removePackage(session.user.id, packageId);
      if (error) throw error;
      packageFavoriteIds.delete(packageId);
    } else {
      const { error } = await levroData.favorites.addPackage(session.user.id, packageId);
      if (error) throw error;
      packageFavoriteIds.add(packageId);
    }
    document.querySelectorAll(`.package-fav-btn[data-package-id="${packageId}"]`).forEach((b) => {
      b.innerHTML = packageFavoriteIds.has(packageId) ? `<i class="fa-solid fa-heart"></i>` : `<i class="fa-regular fa-heart"></i>`;
      b.classList.toggle("active", packageFavoriteIds.has(packageId));
      b.disabled = false;
    });
    showToast(packageFavoriteIds.has(packageId) ? "Package saved to wishlist." : "Package removed from wishlist.", "success");
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast(err?.message || "Could not update package wishlist.", "error");
  }
}
async function openPackageShare(packageId) {
  try {
    const { data: pkg, error } = await sb.from("vendor_packages").select("id,name,price,photos,status,vendor:vendors!inner(id,business_name,verification_status,is_active)").eq("id", packageId).eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true).maybeSingle();
    if (error || !pkg) throw new Error("This package is no longer available.");
    const url = `${location.origin}/k/${encodeURIComponent(pkg.id)}`;
    const box = byId("storefrontShareModal");
    if (!box) return;
    const name = pkg.name || "this package";
    byId("storefrontShareTitle").textContent = `Share ${name}`;
    byId("storefrontShareText").textContent = `Share this package on Levromart.`;
    box.dataset.vendorId = ""; box.dataset.url = url; box.dataset.name = name; box.dataset.whatsapp = ""; box.dataset.packageId = pkg.id; delete box.dataset.productId; box.dataset.kind = "package"; box.dataset.thumb = (Array.isArray(pkg.photos) && pkg.photos[0]) || "";
    lvRenderShareSheet(box);
    box.classList.remove("hidden");
    trackModalOpened("storefrontShareModal");
  } catch (err) { showToast(err?.message || "Couldn't prepare package sharing.", "error"); }
}
function openPackageDetailLightbox() {
  const photos = window.__packageDetailPhotos || [];
  if (!photos.length) return;
  const img = byId("productLightboxImage");
  if (img) img.src = photos[packageDetailGalleryIndex || 0];
  byId("productImageLightbox")?.classList.remove("hidden");
}
function openPackageGallerySlide(event, index) {
  event?.stopPropagation?.();
  const track = byId('packageDetailGalleryTrack');
  if (track?.dataset.suppressClick === '1') { track.dataset.suppressClick = ''; return; }
  setPackageDetailPhoto(index, false);
  openPackageDetailLightbox();
}
async function buyPackageFromDetail(packageId) {
  if (!session) { showLogin(); return; }
  if (blockOwnVendorPurchase(window.__packageDetailVendorId, "buy")) return;
  const errorEl = byId("packageDetailBuyError");
  errorEl?.classList.add("hidden");
  const delivery = readDeliveryFields("pkgdetail", errorEl);
  if (!delivery) return;
  const { data: orderId, error } = await sb.rpc("create_package_order", {
    p_package_id: packageId,
    p_delivery_method: delivery.method,
    p_delivery_address: delivery.address,
    p_delivery_phone: delivery.phone,
  });
  if (error) {
    if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); }
    return;
  }
  await persistBuyerDeliveryLocation(orderId, delivery.method);
  navigate("orderDetail", { orderId });
}
async function renderPackageDetail(packageId) {
  const engagementPromise=sb.from("package_engagement_settings").select("allow_comments,like_visibility,comment_audience,vendor_id").eq("package_id",packageId).maybeSingle();
  const { data: pkg, error } = await sb.from("vendor_packages")
    .select("id, vendor_id, name, description, price, photos, created_at, status, vendor:vendors!inner(id,business_name,previous_business_name,name_changed_at,city,address,phone,whatsapp_number,whatsapp_visible,avg_rating,review_count,verification_status,is_active,logo_url,delivery_fee,delivery_fee_mode,delivery_fee_per_km,lat,lng), items:package_items(quantity, product:products(id,name,sale_price,rental_rate,rental_rate_unit,photos,quantity_available,condition,listing_type,is_service,service_price_unit,category:categories(name)))")
    .eq("id", packageId).eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true).maybeSingle();
  if (error || !pkg) return '<div class="empty-state"><i class="fa-solid fa-box-open" style="font-size:1.6rem;display:block;margin-bottom:.6rem;"></i>Package not found or no longer available.</div>';
  const {data:packageEngagement}=await engagementPromise;

  const photos = Array.isArray(pkg.photos) ? pkg.photos.filter(Boolean) : [];
  window.__packageDetailPhotos = photos;
  packageDetailGalleryIndex = 0;
  const v = pkg.vendor || {};
  window.__packageDetailVendorId = v.id || null;
  const items = pkg.items || [];
  const vendorLogo = v.logo_url ? `<img src="${esc(v.logo_url)}" alt="" style="width:2.2rem;height:2.2rem;border-radius:50%;object-fit:cover;" />` : avatarFallbackHtml(v.business_name || "Vendor", "2.2rem", "", v.business_name || "Vendor");
  const gallery = photos.length
    ? `<div class="package-detail-gallery">
        <div class="package-detail-gallery-track product-gallery-main" id="packageDetailGalleryTrack" aria-label="Package photos">
          ${photos.map((u,i) => `<div class="package-detail-gallery-slide" data-gallery-index="${i}" onclick="openPackageGallerySlide(event,${i})"><img class="package-detail-main" src="${esc(u)}" alt="${esc(pkg.name)} photo ${i+1}" loading="${i===0 ? 'eager' : 'lazy'}" decoding="async" draggable="false" ${i===0 ? 'fetchpriority="high"' : ''} /></div>`).join("")}
        </div>
      </div>`
    : `<div class="package-gallery-placeholder" style="height:260px;"><i class="fa-solid fa-box-open"></i>&nbsp; No package photos</div>`;

  let html = `<div class="card" style="position:relative;">
    <div class="package-detail-top-actions"><button type="button" class="icon-btn" onclick="navigate('home')" aria-label="Back to marketplace"><i class="fa-solid fa-xmark"></i></button><div class="package-detail-actions-right"><button type="button" class="icon-btn package-fav-btn ${packageFavoriteIds.has(pkg.id) ? "active" : ""}" data-package-id="${pkg.id}" onclick="togglePackageFavorite(event,'${pkg.id}')" aria-label="Save package to wishlist"><i class="fa-${packageFavoriteIds.has(pkg.id) ? "solid" : "regular"} fa-heart"></i></button><button type="button" class="icon-btn" onclick="openPackageShare('${pkg.id}')" aria-label="Share package"><i class="fa-solid fa-share-nodes"></i></button></div></div>
    <div style="display:flex;align-items:center;gap:.55rem;margin-bottom:.8rem;">${vendorLogo}<div><strong>${esc(v.business_name || "Vendor")}</strong><div class="muted" style="font-size:.78rem;">Verified vendor${v.city ? ` · ${esc(v.city)}` : ""}</div></div></div>
    ${gallery}
    <div style="margin-top:1rem;display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;"><div><h2 style="margin:0 0 .25rem;">${esc(pkg.name)}</h2><p class="muted" style="margin:0;">Special package</p></div><span class="package-detail-price">${naira(pkg.price)}</span></div>
    ${pkg.description ? `<p style="margin:1rem 0 0;line-height:1.55;">${esc(pkg.description)}</p>` : ""}
  </div>`;

  html += `<div class="card"><h3 style="margin-top:0;"><i class="fa-solid fa-box-open"></i> What's included</h3><div class="package-detail-items">${items.length ? items.map((it) => {
    const p = it.product || {};
    const img = p.photos?.[0];
    return `<div class="package-detail-item" onclick="navigate('productDetail',{productId:'${p.id}'})">${img ? `<img src="${esc(img)}" alt="${esc(p.name || "Product")}" loading="lazy" decoding="async" />` : `<div class="pkg-item-placeholder"><i class="fa-solid fa-box"></i></div>`}<div class="pkg-item-copy"><strong>${esc(p.name || "Included item")}</strong><span class="muted" style="font-size:.78rem;">${it.quantity}×${p.category?.name ? ` · ${esc(p.category.name)}` : ""}</span></div><i class="fa-solid fa-chevron-right muted"></i></div>`;
  }).join("") : `<p class="muted">No items are currently attached to this package.</p>`}</div></div>`;

  if (profile?.role === "admin") {
    html += `<div class="service-flat"><p class="muted"><i class="fa-solid fa-circle-info"></i> Admin accounts can't make purchases on Levromart.</p></div>`;
  } else if (isOwnVendorId(v.id)) {
    html += `<div class="card own-purchase-block"><p style="margin:0;"><i class="fa-solid fa-circle-info"></i> This is your own package. You can manage it from your vendor dashboard, but you can't buy it from your own shop.</p></div>`;
  } else {
    html += `<div class="card"><h3 style="margin-top:0;"><i class="fa-solid fa-cart-shopping"></i> Buy this package</h3>
      ${deliveryFieldsHtml("pkgdetail", v.delivery_fee, v.lat, v.lng, v.delivery_fee_mode, v.delivery_fee_per_km, "Pickup", pkg.price)}
      <button class="btn" style="width:100%;justify-content:center;" onclick="buyPackageFromDetail('${pkg.id}')">Buy package · ${naira(pkg.price)}</button>
      <p id="packageDetailBuyError" class="error-text hidden"></p>
    </div>`;
  }

  html += `<div class="card package-comments-card" data-package-comments-id="${esc(pkg.id)}"><button type="button" class="product-comments-toggle package-comments-toggle ${packageEngagement?.allow_comments===false?"disabled":""}" onclick="${packageEngagement?.allow_comments===false?"":"togglePackageComments('"+esc(pkg.id)+"')"}" aria-expanded="false" aria-label="${packageEngagement?.allow_comments===false?"Comments disabled":"Show package comments"}"><span><i class="fa-regular fa-comment"></i><strong id="packageCommentsCount" data-package-id="${esc(pkg.id)}">0</strong></span><i class="fa-solid fa-chevron-down"></i></button><div id="packageCommentsPanel" class="product-comments-panel hidden"></div></div>`;
  html += `<div class="card"><div class="flex" style="justify-content:space-between;align-items:center;"><div><h3 style="margin:0;">About the vendor</h3><p class="muted" style="margin:.25rem 0 0;">${`★ ${Number(v.avg_rating ?? 0).toFixed(1)} · ${Number(v.review_count ?? 0)} reviews`}</p></div><button class="btn btn-sm btn-outline" onclick="navigate('storefront',{vendorId:'${v.id}'})">View storefront</button></div></div>`;

  const { data: morePackages } = await sb.from("vendor_packages")
    .select("id, vendor_id, name, description, price, photos, created_at, vendor:vendors!inner(id,business_name,logo_url,delivery_fee,verification_status,is_active), items:package_items(quantity, product:products(id,name,photos))")
    .eq("vendor_id", v.id).eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true).neq("id", pkg.id).order("created_at", { ascending: false }).limit(4);
  if (morePackages?.length) {
    html += `<h3 class="section-title"><span><i class="fa-solid fa-layer-group"></i> More packages from ${esc(v.business_name || "this vendor")}</span></h3><div class="hscroll package-recommendation-strip">${morePackages.map((p) => packageCardHtml(p, p.vendor?.delivery_fee, true)).join("")}</div>`;
  }
  return html;
}

