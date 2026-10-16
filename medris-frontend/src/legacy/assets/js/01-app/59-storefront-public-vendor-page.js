// ---------- STOREFRONT (public vendor page) ----------
// Shown for a couple weeks after a vendor renames, so customers who knew them
// by the old name don't wonder where they went.
const VENDOR_RENAME_GRACE_DAYS = 14;
function vendorNameWithFormerly(v) {
  if (!v.previous_business_name || !v.name_changed_at) return esc(v.business_name);
  const daysSince = (Date.now() - new Date(v.name_changed_at).getTime()) / 86400000;
  if (daysSince > VENDOR_RENAME_GRACE_DAYS) return esc(v.business_name);
  return `${esc(v.business_name)} <span class="muted" style="font-weight:400;font-size:0.8em;">(formerly ${esc(v.previous_business_name)})</span>`;
}

function storefrontPublicUrl(vendorId) {
  return `${location.origin}/s/${encodeURIComponent(String(vendorId || ""))}`;
}
function productPublicUrl(productId) {
  return `${location.origin}/p/${encodeURIComponent(String(productId || ""))}`;
}
function updateStorefrontSocialMeta(v) {
  if (!v) return;
  const name = String(v.business_name || "Levromart storefront");
  const description = String(v.bio || `Check out ${name} on Levromart.`);
  const image = String(v.logo_url || "");
  const url = storefrontPublicUrl(v.id);
  document.title = `${name} | Levromart`;
  const setMeta = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.setAttribute("content", value);
  };
  setMeta('meta[name="description"]', description);
  setMeta('meta[property="og:title"]', name);
  setMeta('meta[property="og:description"]', description);
  setMeta('meta[property="og:url"]', url);
  setMeta('meta[property="og:image"]', image);
  setMeta('meta[name="twitter:title"]', name);
  setMeta('meta[name="twitter:description"]', description);
  setMeta('meta[name="twitter:image"]', image);
}
function resetStorefrontSocialMeta() {
  document.title = "Levromart";
  const setMeta = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.setAttribute("content", value);
  };
  setMeta('meta[name="description"]', "Rent or buy from verified vendors across Lagos: healthcare equipment, food, electronics, and more.");
  setMeta('meta[property="og:title"]', "Levromart");
  setMeta('meta[property="og:description"]', "Rent or buy from verified vendors across Lagos: healthcare equipment, food, electronics, and more.");
  setMeta('meta[property="og:url"]', window.location.origin + window.location.pathname);
  setMeta('meta[property="og:image"]', "");
  setMeta('meta[name="twitter:title"]', "Levromart");
  setMeta('meta[name="twitter:description"]', "Rent or buy from verified vendors across Lagos: healthcare equipment, food, electronics, and more.");
  setMeta('meta[name="twitter:image"]', "");
}
async function fetchVendorForShare(vendorId) {
  const { data, error } = await sb.from("vendors")
    .select("id,business_name,bio,logo_url,whatsapp_number,whatsapp_visible,verification_status,is_active")
    .eq("id", vendorId)
    .eq("verification_status", "verified")
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) throw new Error("This storefront is no longer available.");
  return data;
}
async function openStorefrontShare(vendorId) {
  try {
    const v = await fetchVendorForShare(vendorId);
    const url = storefrontPublicUrl(v.id);
    const name = v.business_name || "this store";
    const box = byId("storefrontShareModal");
    if (!box) return;
    byId("storefrontShareTitle").textContent = `Share ${name}`;
    byId("storefrontShareText").textContent = `Share ${name}'s storefront on Levromart.`;
    box.dataset.vendorId = v.id;
    box.dataset.url = url;
    box.dataset.name = name;
    box.dataset.whatsapp = v.whatsapp_visible && v.whatsapp_number ? v.whatsapp_number : "";
    delete box.dataset.packageId;
    delete box.dataset.productId;
    box.dataset.kind = "store"; box.dataset.thumb = v.logo_url || "";
    lvRenderShareSheet(box);
    box.classList.remove("hidden");
    trackModalOpened("storefrontShareModal");
  } catch (err) {
    showToast(err.message || "Couldn't prepare storefront sharing.", "error");
  }
}
async function shareStorefrontFromProduct(evt, vendorId) {
  evt?.stopPropagation();
  await openStorefrontShare(vendorId);
}
async function openProductShare(productId) {
  try {
    const { data: product, error } = await sb.from("products").select("id,name,photos,status,vendor:vendors!inner(id,business_name,verification_status,is_active)").eq("id", productId).eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true).maybeSingle();
    if (error || !product) throw new Error("This product is no longer available.");
    const box = byId("storefrontShareModal");
    if (!box) return;
    const name = product.name || "this product";
    byId("storefrontShareTitle").textContent = `Share ${name}`;
    byId("storefrontShareText").textContent = "Share this product on Levromart.";
    box.dataset.vendorId = product.vendor?.id || "";
    box.dataset.url = productPublicUrl(product.id);
    box.dataset.name = name;
    box.dataset.whatsapp = "";
    box.dataset.productId = product.id;
    delete box.dataset.packageId;
    box.dataset.kind = "product"; box.dataset.thumb = (Array.isArray(product.photos) && product.photos[0]) || "";
    lvRenderShareSheet(box);
    box.classList.remove("hidden");
    trackModalOpened("storefrontShareModal");
  } catch (err) { showToast(err?.message || "Couldn't prepare product sharing.", "error"); }
}

function lvRenderShareSheet(box){
  try{
    const url=box.dataset.url||"", kind=box.dataset.kind||"store", thumb=box.dataset.thumb||"";
    const th=byId("lvShareThumb");
    if(th){ th.innerHTML=thumb?`<img src="${esc(thumb)}" alt="" onerror="this.remove()">`:`<i class="fa-solid ${kind==="product"?"fa-bag-shopping":kind==="package"?"fa-box-open":"fa-store"}"></i>`; }
    const u=byId("lvShareUrl"); if(u) u.textContent=url.replace(/^https?:\/\//,"");
    const t=byId("storefrontShareText"); if(t) t.textContent=kind==="product"?"Product on Levromart":kind==="package"?"Package on Levromart":"Storefront on Levromart";
    byId("storefrontShareTitle").textContent=box.dataset.name||"Share";
    box.querySelector(".lv-share-apps")?.scrollTo?.(0,0);
  }catch(_){}
}
function lvShareTo(app){
  const box=byId("storefrontShareModal"); const url=box?.dataset.url; if(!url) return;
  const name=box.dataset.name||"this";
  const kind=box.dataset.kind||"store";
  const msg=kind==="product"?`Check out ${name} on Levromart.`:kind==="package"?`Check out the ${name} package on Levromart.`:`Check out ${name}'s storefront on Levromart.`;
  const u=encodeURIComponent(url), t=encodeURIComponent(msg);
  const open=(href)=>{ try{ const a=document.createElement("a"); a.href=href; a.target="_blank"; a.rel="noopener noreferrer"; a.style.display="none"; document.body.appendChild(a); a.click(); setTimeout(()=>a.remove(),500); }catch(_){ location.href=href; } };
  if(app==="more"){ nativeShareStorefront(); return; }
  if(app==="whatsapp"){ window.lvOpenWhatsApp(`${msg}\n${url}`); }
  else if(app==="facebook") open(`https://www.facebook.com/sharer/sharer.php?u=${u}`);
  else if(app==="messenger"){ if(/Android|iPhone|iPad/i.test(navigator.userAgent)) location.href=`fb-messenger://share/?link=${u}`; else open(`https://www.facebook.com/sharer/sharer.php?u=${u}`); }
  else if(app==="x") open(`https://twitter.com/intent/tweet?text=${t}&url=${u}`);
  else if(app==="telegram") open(`https://t.me/share/url?url=${u}&text=${t}`);
  else if(app==="linkedin") open(`https://www.linkedin.com/sharing/share-offsite/?url=${u}`);
  else if(app==="sms") location.href=`sms:?&body=${encodeURIComponent(msg+" "+url)}`;
  else if(app==="email") location.href=`mailto:?subject=${encodeURIComponent(name+" | Levromart")}&body=${encodeURIComponent(msg+"\n\n"+url)}`;
  closeStorefrontShareModal(true);
}
async function copyStorefrontShareLink() {
  const box = byId("storefrontShareModal");
  const url = box?.dataset.url;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    showToast(box?.dataset.productId ? "Product link copied." : box?.dataset.packageId ? "Package link copied." : "Storefront link copied.", "success");
    closeStorefrontShareModal(true);
  } catch (_) {
    await showConfirmDialog(url, { title: box?.dataset.productId ? "Product link" : box?.dataset.packageId ? "Package link" : "Storefront link", okLabel: "Close" });
  }
}
async function nativeShareStorefront() {
  const box = byId("storefrontShareModal");
  const url = box?.dataset.url;
  const name = box?.dataset.name || "this store";
  if (!url) return;
  const isPackage = !!box?.dataset.packageId;
  const isProduct = !!box?.dataset.productId;
  const payload = { title: `${name} | Levromart`, text: isProduct ? `Check out ${name} on Levromart.` : isPackage ? `Check out the ${name} package on Levromart.` : `Check out ${name}'s storefront on Levromart.`, url };
  try {
    if (navigator.share) {
      await navigator.share(payload);
      closeStorefrontShareModal(true);
      return;
    }
    await navigator.clipboard.writeText(url);
    showToast(`Native sharing isn't available here, so the ${isProduct ? "product" : isPackage ? "package" : "storefront"} link was copied.`, "success");
    closeStorefrontShareModal(true);
  } catch (err) {
    if (err?.name !== "AbortError") showToast(`Couldn't share the ${isProduct ? "product" : isPackage ? "package" : "storefront"}.`, "error");
  }
}
window.lvOpenWhatsApp = function (text) {
  const url = "https://wa.me/?text=" + encodeURIComponent(text);
  try {
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.style.display = "none";
    document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
  } catch (_) { window.location.href = url; }
};
function whatsappShareStorefront() {
  const box = byId("storefrontShareModal");
  const url = box?.dataset.url;
  const name = box?.dataset.name || "this store";
  if (!url) return;
  const isPackage = !!box?.dataset.packageId;
  const text = isPackage ? `Check out the ${name} package on Levromart.\n${url}` : `Check out ${name}'s storefront on Levromart.\n${url}`;
  window.lvOpenWhatsApp(text);
  closeStorefrontShareModal(true);
}
function closeStorefrontShareModal(goBack = false) {
  byId("storefrontShareModal")?.classList.add("hidden");
  const wasTracked = dismissibleModalId === "storefrontShareModal";
  dismissibleModalId = wasTracked ? null : dismissibleModalId;
  // Popping the modal's own history entry must not be treated as a page change (it used to send people Home after "Copy link").
  if (goBack && wasTracked && history.state?.dismissibleModal === "storefrontShareModal") { window.__ignoreNextPopstate = true; setTimeout(() => { window.__ignoreNextPopstate = false; }, 800); history.back(); }
}
/*
 * STOREFRONT FIRST-PAINT GUARD
 *
 * Opening a storefront must never leave the navigation shell waiting on the
 * vendor/products/stats/reviews/package requests. Return immediately, then
 * replace the shell with the real storefront when the background request is
 * ready. Successful HTML is cached in memory for instant revisits.
 */
// Only the product catalogue is on the critical path for a storefront's
// first paint -- header, "Latest from" strip and catalogue tab counts all
// need it. Rating/reviews, follower/follow state and packages are
// secondary polish; making a customer wait on ALL FIVE queries (each its
// own network round trip) before showing the shop they just tapped is what
// made every storefront visit feel like a multi-second stall. These
// render as lightweight loading placeholders and patch in via
// hydrateStorefrontExtras() the moment they arrive, in parallel with (not
// after) the critical products fetch.
function storefrontStatsInnerHtml(listingCount, stats, followState) {
  const st = (Array.isArray(stats) ? stats[0] : stats) || {};
  const followerCount = Number(followState?.[0]?.follower_count || 0);
  return `<span><strong>${listingCount}</strong> listing${listingCount === 1 ? "" : "s"}</span>
    <button type="button" class="storefront-stat-link" onclick="event.stopPropagation();scrollToVendorReviews()"><strong>${st.review_count || 0}</strong> review${Number(st.review_count || 0) === 1 ? "" : "s"}</button>
    <button type="button" class="storefront-stat-link" onclick="event.stopPropagation();scrollToVendorReviews()"><strong>★ ${Number(st.avg_rating ?? 0).toFixed(1)}</strong> rating</button>
    <span data-follow-count class="storefront-stat-link" role="button" tabindex="0" onclick="event.stopPropagation();openFollowerNetwork()"><strong>${followerCount.toLocaleString()}</strong> follower${followerCount === 1 ? "" : "s"}</span>`;
}
function storefrontStatsLoadingInnerHtml(listingCount) {
  return `<span><strong>${listingCount}</strong> listing${listingCount === 1 ? "" : "s"}</span>
    <span class="storefront-stat-link" style="opacity:.55;"><strong>…</strong> reviews</span>
    <span class="storefront-stat-link" style="opacity:.55;"><strong>★ …</strong> rating</span>
    <span data-follow-count style="opacity:.55;"><strong>…</strong> followers</span>`;
}
function storefrontFollowNotificationMode(st) {
  const x = (Array.isArray(st) ? st[0] : st) || {};
  const vals = [x.notify_new_listing, x.notify_new_service, x.notify_new_package, x.notify_new_variety, x.notify_price_change, x.notify_discount];
  if (String(x.mute_mode || '') === 'always' && vals.every(v => v === false)) return 'off';
  if (vals.every(v => v === true)) return 'all';
  if (x.notify_new_listing !== false && x.notify_new_service !== false && x.notify_new_package !== false && x.notify_new_variety === false && x.notify_price_change === false && x.notify_discount === false) return 'relevant';
  // New follows/defaults without an explicit preference get everything ("All").
  if (vals.every(v => v == null)) return 'all';
  return 'relevant';
}
function storefrontFollowWrapInnerHtml(v, followState) {
  const following = !!followState?.[0]?.following;
  const mode = storefrontFollowNotificationMode(followState);
  return `<div class="storefront-follow-controls">
      <button type="button" class="btn btn-sm follow-btn follow-btn-icon ${following ? "" : "btn-outline"}" aria-pressed="${following ? "true" : "false"}" aria-label="${following ? "Unfollow" : "Follow"} ${esc(v.business_name || "vendor")}" title="${following ? "Following, tap to unfollow" : "Follow vendor"}" onclick="window.toggleLevromartVendorFollow?.('${v.id}',event)"><i class="fa-solid ${following ? "fa-check" : "fa-user-plus"}"></i><span class="follow-btn-label">${following ? "Following" : "Follow"}</span></button>
      <button type="button" class="btn btn-sm btn-outline follow-settings-btn" ${following ? "" : "disabled"} aria-expanded="false" aria-label="Notification preferences" title="${following ? "Notification preferences" : "Follow this vendor to manage notifications"}" onclick="window.toggleLevromartFollowNotifications?.('${v.id}',event)"><i class="fa-solid fa-bell"></i></button>
    </div>
    <div class="follow-menu hidden" role="dialog" aria-label="Vendor notification preferences">
      <strong>Notifications from this vendor</strong>
      <p class="follow-mode-intro">Choose how you want LevroMart to keep you updated.</p>
      <button type="button" class="follow-mode-row" data-notify-mode="all" aria-pressed="${mode === 'all' ? 'true' : 'false'}"><span class="follow-mode-icon follow-mode-icon-all"><i class="fa-solid fa-bell"></i></span><span class="follow-mode-copy"><b>All</b><small>Get notified about every update from this vendor.</small></span><span class="follow-mode-check" aria-hidden="true"><i class="fa-solid fa-check"></i></span></button>
      <button type="button" class="follow-mode-row" data-notify-mode="relevant" aria-pressed="${mode === 'relevant' ? 'true' : 'false'}"><span class="follow-mode-icon follow-mode-icon-relevant"><i class="fa-solid fa-star"></i></span><span class="follow-mode-copy"><b>Most relevant</b><small>Get the updates that matter most to you.</small></span><span class="follow-mode-check" aria-hidden="true"><i class="fa-solid fa-check"></i></span></button>
      <button type="button" class="follow-mode-row" data-notify-mode="off" aria-pressed="${mode === 'off' ? 'true' : 'false'}"><span class="follow-mode-icon follow-mode-icon-off"><i class="fa-regular fa-bell-slash"></i></span><span class="follow-mode-copy"><b>Off</b><small>Don't receive notifications from this vendor.</small></span><span class="follow-mode-check" aria-hidden="true"><i class="fa-solid fa-check"></i></span></button>
    </div>`;
}
function storefrontFollowWrapLoadingInnerHtml() {
  return `<div class="storefront-follow-controls"><button type="button" class="btn btn-sm btn-outline follow-btn follow-btn-icon" disabled aria-label="Loading follow status"><i class="fa-solid fa-spinner fa-spin"></i></button></div>`;
}
function storefrontPackagesInnerHtml(v, packages) {
  return `<div class="storefront-section-head">
      <h3>Special packages</h3>
      ${packages && packages.length ? `<button type="button" class="icon-btn package-search-toggle" aria-label="Search special packages" title="Search packages" onclick="toggleStorefrontPackageSearch(event)"><i class="fa-solid fa-magnifying-glass"></i></button>` : ""}
    </div>
    ${packages && packages.length ? `<div class="storefront-packages-body" id="storefrontPackagesBody">
      <div class="package-search-row hidden" id="storefrontPackageSearchRow">
        <i class="fa-solid fa-magnifying-glass" style="color:var(--text-muted);"></i>
        <input type="text" id="storefrontPackageSearch" placeholder="Search packages or what's inside…" oninput="filterStorefrontPackages()" />
        <button type="button" class="icon-btn" onclick="clearStorefrontPackageSearch()" aria-label="Clear package search"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="grid" id="storefrontPackagesGrid">${packages.map((pkg) => packageCardHtml(pkg, v.delivery_fee, true)).join("")}</div>
    </div>` : `<div class="empty-state">No packages listed yet.</div>`}`;
}
function storefrontPackagesLoadingInnerHtml() {
  return `<div class="storefront-section-head"><h3>Special packages</h3></div><p class="muted">Loading…</p>`;
}
function storefrontReviewsInnerHtml(st, reviews) {
  if (reviews && reviews.length > 0) {
    return `<button type="button" class="storefront-reviews-head" onclick="toggleReviewsList()"><h3 style="margin:0;">Reviews${st.review_count ? ` (${st.review_count})` : ""}</h3><i class="fa-solid fa-chevron-down" id="reviewsChevron" style="transition:transform 0.2s;color:var(--text-muted);"></i></button><div id="reviewsList">${reviews.map((r) => `<div class="card review-card">${r.buyer_avatar_url ? `<img src="${esc(r.buyer_avatar_url)}" class="avatar-circle" style="width:2.3rem;height:2.3rem;object-fit:cover;" />` : avatarFallbackHtml(r.buyer_name || "Customer", "2.3rem", "", r.buyer_name || "Customer")}<div><div class="flex" style="justify-content:space-between;gap:1rem;"><strong>${esc(r.buyer_name || "A buyer")}</strong><span class="star-display">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span></div>${r.comment ? `<p style="margin:0.3rem 0 0;">${esc(r.comment)}</p>` : ""}<p class="muted" style="font-size:0.75rem;margin-top:0.2rem;">${new Date(r.created_at).toLocaleDateString()}</p></div></div>`).join("")}</div>`;
  }
  return `<h3 style="margin-top:0;">Reviews</h3><p class="muted">No reviews yet.</p>`;
}
function storefrontReviewsLoadingInnerHtml() {
  return `<h3 style="margin-top:0;">Reviews</h3><p class="muted">Loading reviews…</p>`;
}
function hydrateStorefrontExtras(v, listingCount, stats, reviews, packages, followState, isOwnStorefront) {
  const st = (stats && stats[0]) || {};
  window.__storefrontPackages = packages || [];
  const statsLine = byId("storefrontStatsLine");
  if (statsLine) statsLine.innerHTML = storefrontStatsInnerHtml(listingCount, stats, followState);
  if (!isOwnStorefront) {
    const followWrap = byId("storefrontFollowWrap");
    if (followWrap) {
      // This followState snapshot was fetched in parallel with the rest of
      // the page, so it can predate a follow/unfollow tap the user made
      // while this fetch was still in flight. Trust that more recent local
      // action over a stale server read, rather than letting this
      // hydration silently flip the button back -- the "twitching" bug.
      const recent = window.__followRecentAction;
      const effectiveState = (recent && recent.vendorId === String(v.id) && Date.now() - recent.at < 10000)
        ? [{ ...(followState?.[0] || {}), following: recent.following }]
        : followState;
      followWrap.innerHTML = storefrontFollowWrapInnerHtml(v, effectiveState);
    }
  }
  const packagesCount = byId("storefrontPackagesCount");
  if (packagesCount) packagesCount.textContent = `(${packages?.length || 0})`;
  const packagesSection = byId("storefrontPackagesSection");
  if (packagesSection) packagesSection.innerHTML = storefrontPackagesInnerHtml(v, packages);
  const reviewsSection = byId("vendorReviews");
  if (reviewsSection) reviewsSection.innerHTML = storefrontReviewsInnerHtml(st, reviews);
}
async function renderStorefront(vendorId) {
  // A network blip on either query used to bubble all the way up as an
  // uncaught rejection, which navigate()'s outer catch could only respond
  // to by re-painting the loading shell that was already on screen --
  // a stuck spinner with no error and no way forward short of a manual
  // reload. Catching it here returns a real retry state directly instead.
  try {
    return await renderStorefrontInner(vendorId);
  } catch (err) {
    console.warn("[Levromart] Storefront failed to load:", err);
    return `<div class="card" style="max-width:480px;margin:2rem auto;text-align:center;">
      <i class="fa-solid fa-triangle-exclamation" style="font-size:2rem;color:var(--primary);margin-bottom:.65rem;"></i>
      <h2 style="margin:.1rem 0 .45rem;">Couldn't load this storefront</h2>
      <p class="muted" style="margin:0 auto 1rem;">Check your connection and try again.</p>
      <div class="flex" style="justify-content:center;gap:.5rem;flex-wrap:wrap;">
        <button type="button" class="btn" onclick="navigate('storefront',{vendorId:'${esc(vendorId)}'},false)"><i class="fa-solid fa-rotate-right"></i> Try again</button>
        <button type="button" class="btn btn-outline" onclick="navigate('home')">Go to marketplace</button>
      </div>
    </div>`;
  }
}
async function renderStorefrontInner(vendorId) {
  // Fire the vendor lookup and the product catalogue at the same time.
  // The products query only ever needed the vendorId that was already
  // passed into this function -- nothing from the vendor row itself --
  // so waiting for the vendor fetch to finish before even starting it
  // turned what should be one network round trip into two, back to back,
  // on every single storefront visit.
  const vendorPromise = sb.from("vendors").select("*, sector:sectors(name, icon)").eq("id", vendorId).eq("verification_status", "verified").maybeSingle();
  const productsPromise = sb.from("products").select("id, name, listing_type, sale_price, discount_price, rental_rate, rental_rate_unit, photos, quantity_available, condition, is_service, service_price_unit, payment_timing, payment_deposit_percent, delivery_fee, delivery_fee_mode, delivery_fee_per_km, category:categories(name), vendor:vendors!inner(id,business_name,verification_status,logo_url,delivery_fee,delivery_fee_mode,delivery_fee_per_km,lat,lng)").eq("vendor_id", vendorId).eq("status", "active").order("created_at", { ascending: false });

  const { data: v, error } = await vendorPromise;
  if (error || !v) return '<div class="empty-state">Storefront not found.</div>';
  if (!v.is_active) return '<div class="empty-state"><i class="fa-solid fa-store-slash" style="font-size:1.6rem;display:block;margin-bottom:0.6rem;"></i>This shop is currently paused. Check back later.</div>';
  updateStorefrontSocialMeta(v);

  // allSettled, not all: these four are independent panels (stats, reviews,
  // packages, follow state). Promise.all fails atomically, so one flaky
  // query used to leave every one of them stuck on its loading placeholder
  // forever -- most visibly the follow button's spinner, which never got
  // replaced with a real, clickable button. Each panel now hydrates (or
  // stays gracefully empty) independently of whether the others succeeded.
  const extrasPromise = Promise.allSettled([
    sb.rpc("get_vendor_stats", { p_vendor_id: v.id }),
    sb.from("reviews").select("id, rating, comment, buyer_name, buyer_avatar_url, created_at").eq("vendor_id", v.id).order("created_at", { ascending: false }).limit(10),
    sb.from("vendor_packages").select("*, items:package_items(quantity, product:products(name))").eq("vendor_id", v.id).eq("status", "active").order("created_at", { ascending: false }),
    sb.rpc("get_vendor_follow_state", { p_vendor_id: v.id }),
  ]);

  const { data: products } = await productsPromise;
  // Cards need the shop's location and logo to work out delivery totals and fallbacks, so each product carries them.
  const allProducts = (products || []).map((pr) => ({ ...pr, vendor: pr.vendor || { id: v.id, business_name: v.business_name, logo_url: v.logo_url, lat: v.lat, lng: v.lng, delivery_fee: v.delivery_fee, delivery_fee_mode: v.delivery_fee_mode, delivery_fee_per_km: v.delivery_fee_per_km, verification_status: v.verification_status } }));
  window.__storefrontProducts = allProducts;
  window.__storefrontExpanded = false;
  storefrontCatalogTab = "products";

  const customCoverUrl = v.cover_url || "";
  const isOwnStorefront = !!session?.user?.id && String(session.user.id) === String(v.user_id);
  if (!isOwnStorefront) sb.rpc("increment_vendor_profile_view", { p_vendor_id: v.id }).then(()=>{}).catch(()=>{});
  const logo = v.logo_url
    ? `<button type="button" class="storefront-avatar storefront-avatar-button" aria-label="View ${esc(v.business_name || "Vendor")} profile picture" onclick="openProfileImageLightbox('${esc(v.logo_url)}','${esc(v.business_name || "Vendor")}',event)"><img src="${esc(v.logo_url)}" alt="" data-lvimg onload="this.classList.add('lv-ld')" loading="eager" draggable="false" /></button>`
    : `<button type="button" class="storefront-avatar storefront-avatar-button storefront-avatar-fallback-button" aria-label="View ${esc(v.business_name || "Vendor")} profile picture" onclick="openProfileImageLightbox('','${esc(v.business_name || "Vendor")}',event)">${avatarFallbackHtml(v.business_name || "Vendor", "100%", "", v.business_name || "Vendor", v.id)}</button>`;
  const location = [v.address, v.city].filter(Boolean).map(esc).join(", ") || "Online business";

  const storefrontMoreItems = [
    v.sector?.name ? `<div class="ms-item"><i class="fa-solid ${esc(v.sector.icon || "fa-shapes")}"></i> ${esc(v.sector.name)}</div>` : "",
    v.cac_number ? `<div class="ms-item"><i class='fa-solid fa-building-columns'></i> CAC verified</div>` : "",
    yearsSince(v.created_at) ? `<div class="ms-item"><i class="fa-solid fa-calendar-check"></i> ${esc(yearsSince(v.created_at))}</div>` : "",
    v.opening_hours ? `<div class="ms-item"><i class='fa-solid fa-clock'></i> ${esc(v.opening_hours)}</div>` : "",
    profile?.role !== "admin" ? `<button type="button" class="ms-item" onclick="showSuggestionModal('vendor','${v.id}')"><i class='fa-solid fa-lightbulb'></i> Suggest something</button>` : "",
    `<button type="button" class="ms-item" onclick="openStorefrontShare('${v.id}');closeStorefrontMoreSheet()"><i class='fa-solid fa-share-nodes'></i> Share storefront</button>`,
  ].filter(Boolean).join("");

  let html = `<section class="storefront-profile" data-own-storefront="${isOwnStorefront ? "1" : "0"}">
    <div class="storefront-cover ${customCoverUrl ? "has-custom-cover" : ""}" ${customCoverUrl ? `style="background-image:url('${esc(customCoverUrl)}')"` : ""}>
      ${customCoverUrl ? '<div class="storefront-cover-overlay"></div>' : '<div class="storefront-cover-empty">Set a custom storefront header in your business profile.</div>'}
      ${isOwnStorefront ? `<label class="storefront-cover-edit" title="Edit storefront header" aria-label="Edit storefront header"><i class="fa-solid fa-pen"></i><input type="file" accept="image/*" onchange="uploadVendorCover(event)" /></label>` : ""}
      ${storefrontMoreItems ? `<button class="storefront-banner-more" type="button" aria-label="More vendor details" title="More vendor details" onclick="openStorefrontMoreSheet(event)"><i class="fa-solid fa-ellipsis"></i></button>` : ""}
    </div>
    <div class="storefront-profile-body">
      <div class="storefront-avatar-row">
        ${logo}
      </div>
      <div class="storefront-profile-actions storefront-public-actions">
        ${isOwnStorefront && profile?.role !== "admin" ? `<button class="btn btn-sm btn-outline storefront-more-icon storefront-own-message-icon" type="button" aria-label="Messages" title="Messages" onclick="navigate('messages')"><i class='fa-solid fa-comment-dots'></i></button>` : ""}
        ${!isOwnStorefront ? `<div class="storefront-follow-wrap" id="storefrontFollowWrap" data-follow-vendor-id="${v.id}">${storefrontFollowWrapLoadingInnerHtml()}</div>` : ""}
      </div>
      <div class="storefront-name-row">
        <h1 class="storefront-profile-name">${vendorNameWithFormerly(v)} <i data-vt="${esc(v.id)}" class="fa-solid fa-circle-check vendor-inline-verified" aria-label="Verified vendor" title="Verified vendor"></i></h1>
      </div>
      ${v.bio ? `<section class="storefront-about" aria-label="Vendor description">
        <div class="storefront-bio-wrap" id="storefrontBioWrap"><p class="storefront-bio">${esc(v.bio)}</p>${v.bio.length > 160 ? `<button type="button" class="storefront-bio-toggle" onclick="toggleStorefrontBio(this)">Read more</button>` : ""}</div>
      </section>` : ""}
      <div class="storefront-meta"><span class="sf-loc"><i class="fa-solid fa-location-dot"></i> ${location}</span>${storefrontDistanceHtml(v)}${v.sector?.name ? `<span><i class="fa-solid ${esc(v.sector.icon || "fa-shapes")}"></i> ${esc(v.sector.name)}</span>` : ""}</div>
      <div class="storefront-stats" id="storefrontStatsLine">${storefrontStatsLoadingInnerHtml(allProducts.length)}</div>
    </div>
  </section>
  ${storefrontMoreItems ? `<div class="levro-storefront-sheet-root" id="storefrontMoreSheetRoot">
    <div class="levro-storefront-sheet-backdrop" id="storefrontMoreSheetBackdrop" aria-hidden="true" onclick="closeStorefrontMoreSheet()"></div>
    <section class="levro-storefront-sheet" id="storefrontMoreSheet" role="dialog" aria-modal="true" aria-labelledby="storefrontMoreSheetTitle" aria-hidden="true">
      <div class="levro-sheet-handle" aria-hidden="true"></div>
      <div class="levro-sheet-head">
        <div><h2 id="storefrontMoreSheetTitle">Store options</h2><p>More information and actions for this storefront.</p></div>
        <button type="button" class="levro-sheet-close" aria-label="Close" onclick="closeStorefrontMoreSheet()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="levro-storefront-sheet-list">${storefrontMoreItems.replaceAll('class="ms-item"', 'class="levro-storefront-sheet-item"').replaceAll("closeInlineMenu('storefrontMoreMenu')", "closeStorefrontMoreSheet()")}</div>
    </section>
  </div>` : ""}`;

  if (allProducts.length) {
    const featured = allProducts.slice(0, 6);
    html += `<section class="storefront-featured">
      <div class="storefront-section-head"><h3>Latest from ${esc(v.business_name || "this shop")}</h3></div>
      <div class="storefront-product-strip">${featured.map((p) => {
        const img = p.photos?.[0];
        const price = p.is_service ? `${naira(p.sale_price)}${servicePriceSuffix(p)}` : p.sale_price != null ? naira(p.sale_price) : p.rental_rate != null ? `${naira(p.rental_rate)}/${p.rental_rate_unit}` : "View details";
        return `<div class="storefront-product-mini" onclick="navigate('productDetail',{productId:'${p.id}'})">${img ? `<img src="${esc(lvThumb(img, 240))}" alt="${esc(p.name)}" loading="lazy" />` : `<div class="mini-placeholder"><i class="fa-solid fa-box"></i></div>`}<strong>${esc(p.name)}</strong><span>${price}</span></div>`;
      }).join("")}</div>
    </section>`;
  }

  const productCount = allProducts.filter((p) => !p.is_service).length;
  const serviceCount = allProducts.filter((p) => !!p.is_service).length;
  html += `<div class="storefront-catalog-tabs" role="tablist" aria-label="Storefront catalogue">
    <button type="button" class="storefront-catalog-tab active" id="storefrontProductsTab" role="tab" aria-selected="true" onclick="switchStorefrontCatalogTab('products')"><i class="fa-solid fa-box"></i> Products <span class="tab-count" id="storefrontProductsCount">(${productCount})</span></button>
    <button type="button" class="storefront-catalog-tab" id="storefrontServicesTab" role="tab" aria-selected="false" onclick="switchStorefrontCatalogTab('services')"><i class="fa-solid fa-hand-holding-heart"></i> Services <span class="tab-count" id="storefrontServicesCount">(${serviceCount})</span></button>
    <button type="button" class="storefront-catalog-tab" id="storefrontPackagesTab" role="tab" aria-selected="false" onclick="switchStorefrontCatalogTab('packages')"><i class="fa-solid fa-box-open"></i> Packages <span class="tab-count" id="storefrontPackagesCount">(…)</span></button>
  </div>`;

  html += `<section class="storefront-packages storefront-tab-panel-hidden" id="storefrontPackagesSection">${storefrontPackagesLoadingInnerHtml()}</section>`;

  html += `<section class="storefront-products-shell" id="storefrontProductsShell">
    <div class="storefront-section-head"><h3>Products & services</h3></div>
    ${allProducts.length ? `<div class="storefront-products-toolbar"><div class="storefront-search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="storefrontSearch" placeholder="Search this shop" oninput="filterStorefrontProducts()" /></div></div><div class="storefront-category-chips" id="storefrontCategoryChips"></div>` : ""}
    <div id="storefrontGrid" class="grid">${allProducts.length ? "<p class='muted'>Loading…</p>" : '<div class="empty-state">No products or services listed yet.</div>'}</div>
    <div class="storefront-view-more" id="storefrontViewMoreWrap"></div>
  </section>`;

  html += `<section class="storefront-reviews" id="vendorReviews">${storefrontReviewsLoadingInnerHtml()}</section>`;

  storefrontViewMode = "grid";
  if (allProducts.length) setTimeout(filterStorefrontProducts, 0);
  // extrasPromise was already in flight for as long as the vendor/products
  // queries above took, so by the time this function returns it has often
  // already settled -- firing hydrateStorefrontExtras() right here would
  // frequently run it against DOM that either doesn't exist yet or is about
  // to be thrown away, since navigate() doesn't insert this returned html
  // into the page until a bit later. That one-shot .then() never fires
  // again, so losing that race left the follow button (and stats/reviews/
  // packages) stuck on their loading placeholders permanently. Hand the
  // promise to navigate() instead, which applies it right after the HTML
  // this function returned actually lands in the DOM.
  window.__storefrontExtrasPending = {
    vendorId: String(v.id),
    apply: async () => {
      const results = await extrasPromise;
      const labels = ["stats", "reviews", "packages", "follow state"];
      const pick = (r, i) => {
        if (r.status !== "fulfilled") { console.warn(`[Levromart] Storefront ${labels[i]} failed to load:`, r.reason); return null; }
        if (r.value?.error) { console.warn(`[Levromart] Storefront ${labels[i]} failed to load:`, r.value.error); return null; }
        return r.value?.data ?? null;
      };
      const [stats, reviews, packages, followState] = results.map(pick);
      hydrateStorefrontExtras(v, allProducts.length, stats, reviews, packages, followState, isOwnStorefront);
    },
  };
  return html;
}

function showSupportInfo() {
  const modal = byId("supportInfoModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  trackModalOpened("supportInfoModal");
}
function closeSupportInfo() {
  const modal = byId("supportInfoModal");
  if (modal) modal.classList.add("hidden");
}
function supportStatusLabel(status) {
  return ({
    open: 'Submitted',
    in_progress: 'In progress',
    resolved: 'Resolved',
    closed: 'Closed'
  })[status] || 'Submitted';
}
function supportStatusNote(status) {
  return ({
    open: 'Received, waiting for a support/admin response.',
    in_progress: 'A support/admin member is handling this request.',
    resolved: 'Support has marked this issue as resolved.',
    closed: 'This support request has been closed.'
  })[status] || 'Received, waiting for a support/admin response.';
}
function supportAttachmentHtml(a, signedUrl) {
  const name = esc(a?.name || 'Attachment');
  const type = String(a?.type || '').toLowerCase();
  if (type.startsWith('image/') && signedUrl) {
    return `<a class="support-attachment" href="${esc(signedUrl)}" target="_blank" rel="noopener" title="Open ${name}"><img src="${esc(signedUrl)}" alt="${name}" loading="lazy" decoding="async"><span class="support-attachment-name">${name}</span></a>`;
  }
  return `<a class="support-attachment" href="${esc(signedUrl || '#')}" ${signedUrl ? 'target="_blank" rel="noopener"' : ''} title="${name}"><span class="support-attachment-file"><i class="fa-solid ${type === 'application/pdf' ? 'fa-file-pdf' : 'fa-paperclip'}"></i><span>${name}</span></span></a>`;
}
async function getSupportAttachmentHtml(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return '';
  const rendered = await Promise.all(attachments.map(async a => {
    let signedUrl = '';
    if (a?.path) {
      const { data } = await sb.storage.from('support-attachments').createSignedUrl(a.path, 3600);
      signedUrl = data?.signedUrl || '';
    }
    return supportAttachmentHtml(a, signedUrl);
  }));
  return `<div class="support-request-attachments">${rendered.join('')}</div>`;
}
function renderContactUs() {
  const channels = [
    { icon: "fa-envelope", label: "Email", value: "Levromartsupport@gmail.com", href: "mailto:Levromartsupport@gmail.com" },
    { icon: "fa-phone", label: "Phone", value: "+234 806 322 7669", href: "tel:+2348063227669" },
    { icon: "fa-phone", label: "Phone", value: "+234 806 063 8179", href: "tel:+2348060638179" },
  ];
  const socials = [
    { logo: "/social-instagram.jpg", label: "Instagram", key: "instagram", href: "https://instagram.com/levromart" },
    { logo: "/social-tiktok.jpg", label: "TikTok", key: "tiktok", href: "https://tiktok.com/@levromart" },
    { logo: "/social-linkedin.png", label: "LinkedIn", key: "linkedin", href: "https://linkedin.com/company/levromart" },
  ];
  return `<div class="contact-us-page">
    <h2><i class="fa-solid fa-address-book"></i> Contact us</h2>
    <p class="muted contact-us-sub">We're happy to help. Reach us directly or find us on social media.</p>
    <div class="card contact-us-card">
      ${channels.map((c) => `<a class="contact-us-row" href="${c.href}"><span class="contact-us-row-icon"><i class="fa-solid ${c.icon}"></i></span><span class="contact-us-row-copy"><span class="contact-us-row-label">${esc(c.label)}</span><strong>${esc(c.value)}</strong></span><i class="fa-solid fa-chevron-right contact-us-row-arrow"></i></a>`).join("")}
    </div>
    <h3 class="contact-us-socials-title">Follow us</h3>
    <div class="contact-us-socials">
      ${socials.map((s) => `<a class="contact-us-social-btn" href="${s.href}" target="_blank" rel="noopener" onclick="window.trackSocialClick?.('${s.key}')"><img src="${s.logo}" alt="${esc(s.label)}" class="contact-us-social-logo" loading="lazy" decoding="async"><span>${esc(s.label)}</span></a>`).join("")}
    </div>
    <p class="muted contact-us-handle">@levromart on all platforms</p>
    <p class="muted contact-us-handle" style="margin-top:.2rem">Followed us? Screenshot it and send it on <a href="https://wa.me/2348063227669" target="_blank" rel="noopener noreferrer">WhatsApp to 0806 322 7669</a> to earn leaderboard points.</p>
    <div class="contact-us-help">
      <span class="contact-us-help-ico"><i class="fa-solid fa-headset"></i></span>
      <div><strong>Need help with an order or your account?</strong><p>Send us a support request and our team will reply inside the app.</p></div>
      <button type="button" class="vl-add" onclick="navigate('supportRequest')"><i class="fa-solid fa-paper-plane"></i> Send a request</button>
    </div>
    <p class="contact-us-tag">BUY • SELL • CONNECT</p>
  </div>`;
}
async function renderSupportRequest() {
  if (!session) return '<div class="empty-state">Please log in to contact Levromart support.</div>';
  const { data: requests, error } = await sb.from("support_requests")
    .select("id,subject,message,status,admin_reply,attachments,created_at,updated_at")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });
  let html = `<div class="support-page-head"><h2><i class="fa-solid fa-headset"></i> Support request</h2><button type="button" class="support-info-btn" onclick="showSupportInfo()" aria-label="About support requests" title="About support requests"><i class="fa-solid fa-info"></i></button></div>`;
  html += `<div class="card support-page-card" style="margin-bottom:1rem;">
    <h3 style="margin-top:0;">Send a support request</h3>
    <label for="supportSubject">Subject</label>
    <input id="supportSubject" maxlength="140" placeholder="What do you need help with?" />
    <label for="supportMessage" style="margin-top:.7rem;">Message</label>
    <textarea id="supportMessage" rows="6" maxlength="4000" placeholder="Explain what happened and include any order number or useful details."></textarea>
    <div class="support-attachments">
      <div class="support-attachments-label"><span><i class="fa-solid fa-paperclip"></i> Attach files</span><span class="muted" style="font-size:.76rem;">Optional</span></div>
      <input class="support-file-input" id="supportAttachments" type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt" onchange="previewSupportAttachments(this)">
      <label class="support-file-dropzone" id="supportFileDropzone" for="supportAttachments" onclick="event.stopPropagation()" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="handleSupportFileDrop(event)">
        <span class="support-file-dropzone-icon"><i class="fa-solid fa-cloud-arrow-up"></i></span>
        <span class="support-file-dropzone-copy"><strong>Upload files</strong><span>Tap to choose, or drag screenshots and documents here</span></span>
        <i class="fa-solid fa-chevron-right" style="margin-left:auto;color:var(--muted);"></i>
      </label>
      <small class="support-file-help muted">Screenshots, payment evidence, photos, PDFs or other useful files. Up to 5 files, 10 MB each.</small>
      <div id="supportFileList" class="support-file-list" aria-live="polite"></div>
    </div>
    <div class="flex" style="justify-content:flex-end;margin-top:.85rem;">
      <button class="btn" id="supportSubmitBtn" onclick="submitSupportRequest()"><i class="fa-solid fa-paper-plane"></i> Send request</button>
    </div>
  </div>`;
  if (error) return html + errorStateHtml(error);
  if (!requests?.length) return html + `<div class="support-requests-accordion"><div class="support-requests-empty-head"><h3>Your requests</h3></div><div class="empty-state">You have not sent a support request yet.</div></div>`;
  html += `<details class="support-requests-accordion"><summary><h3>Your requests</h3><span class="support-requests-summary-right"><span>${requests.length} request${requests.length === 1 ? '' : 's'}</span><i class="fa-solid fa-chevron-down support-requests-chevron"></i></span></summary><div class="support-requests-list">`;
  for (const r of requests) {
    const attachments = await getSupportAttachmentHtml(r.attachments);
    html += `<details class="support-request-accordion">
      <summary>
        <span class="support-request-summary-main"><span class="support-request-summary-subject">${esc(r.subject)}</span><span class="support-request-summary-meta">${new Date(r.created_at).toLocaleString('en-GB')}</span></span>
        <span class="flex" style="align-items:center;gap:.45rem;flex:0 0 auto;"><span class="badge ${r.status === 'resolved' ? 'success' : r.status === 'closed' ? 'danger' : r.status === 'in_progress' ? 'warning' : ''}">${supportStatusLabel(r.status)}</span><i class="fa-solid fa-chevron-down support-request-chevron"></i></span>
      </summary>
      <div class="support-request-body">
        <div class="support-request-status-note">${supportStatusNote(r.status)}</div>
        <p style="white-space:pre-wrap;margin:.75rem 0 0;">${esc(r.message)}</p>
        ${attachments}
        ${r.admin_reply ? `<div class="banner" style="margin-top:.8rem;"><strong>Levromart support</strong><div style="white-space:pre-wrap;margin-top:.25rem;">${esc(r.admin_reply)}</div></div>` : ''}
      </div>
    </details>`;
  }
  html += `</div></details>`;
  return html;
}
function handleSupportFileDrop(event) {
  event.preventDefault();
  const zone = event.currentTarget;
  zone?.classList.remove('dragover');
  const input = byId('supportAttachments');
  if (!input) return;
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  const dt = new DataTransfer();
  files.slice(0, 5).forEach(f => dt.items.add(f));
  input.files = dt.files;
  previewSupportAttachments(input);
}
function previewSupportAttachments(input) {
  const list = byId('supportFileList');
  if (!list) return;
  const files = Array.from(input?.files || []);
  if (files.length > 5) {
    showToast('You can attach up to 5 files.', 'error');
    input.value = '';
    list.innerHTML = '';
    return;
  }
  const tooLarge = files.find(f => f.size > 10 * 1024 * 1024);
  if (tooLarge) {
    showToast(`${tooLarge.name} is larger than 10 MB.`, 'error');
    input.value = '';
    list.innerHTML = '';
    return;
  }
  list.innerHTML = files.map(f => `<div class="support-file-chip"><i class="fa-solid ${f.type.startsWith('image/') ? 'fa-image' : 'fa-paperclip'}"></i><span>${esc(f.name)}</span><small class="muted">${(f.size/1024/1024).toFixed(1)} MB</small></div>`).join('');
}
async function submitSupportRequest() {
  if (!session) { showLogin(); return; }
  const subject = String(byId('supportSubject')?.value || '').trim();
  const message = String(byId('supportMessage')?.value || '').trim();
  const files = Array.from(byId('supportAttachments')?.files || []);
  if (!subject || !message) { showToast('Please enter a subject and message.', 'error'); return; }
  if (files.length > 5) { showToast('You can attach up to 5 files.', 'error'); return; }
  const tooLarge = files.find(f => f.size > 10 * 1024 * 1024);
  if (tooLarge) { showToast(`${tooLarge.name} is larger than 10 MB.`, 'error'); return; }
  const btn = byId('supportSubmitBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…'; }
  const { data: request, error } = await sb.from('support_requests').insert({ user_id: session.user.id, subject, message, attachments: [] }).select('id').single();
  if (error || !request?.id) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send request'; }
    showToast(error?.message || 'Could not send support request.', 'error'); return;
  }
  const uploaded = [];
  try {
    for (const file of files) {
      let uploadBlob = file;
      try { if (typeof window.compressImage === "function") uploadBlob = await window.compressImage(file, { maxWidth: 1600, maxHeight: 1600 }); } catch (_) {}
      const ext = (uploadBlob.name || file.name || '').split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
      const path = `${session.user.id}/${request.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await sb.storage.from('support-attachments').upload(path, uploadBlob, { upsert: false, contentType: uploadBlob.type || file.type || 'application/octet-stream' });
      if (uploadError) throw uploadError;
      uploaded.push({ path, name: file.name, type: uploadBlob.type || file.type || 'application/octet-stream', size: uploadBlob.size });
    }
    const { error: updateError } = await sb.from('support_requests').update({ attachments: uploaded }).eq('id', request.id).eq('user_id', session.user.id);
    if (updateError) throw updateError;
  } catch (e) {
    if (uploaded.length) await Promise.all(uploaded.map(a => sb.storage.from('support-attachments').remove([a.path])));
    await sb.from('support_requests').delete().eq('id', request.id).eq('user_id', session.user.id);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send request'; }
    showToast(e?.message || 'One or more attachments could not be uploaded.', 'error'); return;
  }
  showToast('Support request sent.', 'success');
  navigate('supportRequest', {}, { replace: true });
}
