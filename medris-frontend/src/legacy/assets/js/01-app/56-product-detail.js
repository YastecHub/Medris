// ---------- PRODUCT DETAIL ----------

async function getServicePriceHint(listingId){
  try{
    const {data,error}=await sb.rpc("get_service_price_hint",{p_listing_id:listingId});
    if(error||!data||!data[0]||Number(data[0].booking_count||0)<2)return null;
    return {min:Number(data[0].min_price||0),max:Number(data[0].max_price||0),count:Number(data[0].booking_count||0)};
  }catch(_){return null;}
}
async function loadServiceOffers(listingId){
  if(!session?.user?.id)return [];
  try{
    const {data,error}=await sb.from("service_offers").select("id,listing_id,buyer_id,vendor_id,description,current_price,current_offer_by,status,round_count,created_at,updated_at,expires_at,accepted_at,payment_reported_at,completed_at,order_id").eq("listing_id",listingId).order("updated_at",{ascending:false}).limit(20);
    if(error)return [];
    return data||[];
  }catch(_){return []}
}
function serviceOfferStatusLabel(s){return String(s||'').replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase());}
async function serviceOfferAction(id,action,expectedPrice){
  try{
    let price=null;
    if(action==='counter'){
      const raw=prompt('Enter your counter-offer price (₦):','');
      if(raw===null)return;
      price=Number(String(raw).replace(/,/g,''));
      if(!Number.isFinite(price)||price<=0){showToast('Enter a valid counter-offer price.','error');return;}
    }
    const {data,error}=await sb.rpc('respond_service_offer',{p_offer_id:id,p_action:action,p_price:price,p_expected_price:Number(expectedPrice)});
    if(error)throw error;
    if(data?.order_id){showToast('Price accepted. You can now pay the vendor directly.','success');await navigate('orderDetail',{orderId:data.order_id});return;}
    showToast(action==='decline'?'Offer declined.':action==='counter'?'Counter-offer sent.':'Offer accepted.','success');
    await navigate('productDetail',{productId:currentViewParams?.productId||currentProductDetail?.id,serviceOfferId:id},false);
  }catch(e){showToast(e?.message||'Could not update the service offer.','error');}
}
function serviceOfferActionsHtml(offer,isBuyer,isVendor){
  if(!offer)return '';
  const common=`data-service-offer-id="${esc(offer.id)}"`;
  if(offer.status==='payment_reported' && isVendor){
    return `<div class="service-offer-actions"><button type="button" class="btn btn-sm" onclick="confirmServiceOfferPayment('${offer.id}')"><i class="fa-solid fa-check"></i> Confirm payment received</button><button type="button" class="btn btn-sm btn-danger" onclick="disputeServiceOfferPayment('${offer.id}')"><i class="fa-solid fa-triangle-exclamation"></i> Dispute payment</button></div>`;
  }
  if(offer.status!=='pending'&&offer.status!=='countered')return '';
  const mine=(offer.current_offer_by==='buyer')===isBuyer;
  if(mine)return `<span class="muted service-offer-waiting">Waiting for ${isBuyer?'vendor':'buyer'} response.</span>`;
  const canCounter=Number(offer.round_count||1)<7;
  return `<div class="service-offer-actions"><button type="button" class="btn btn-sm" onclick="serviceOfferAction('${offer.id}','accept',${Number(offer.current_price)})"><i class="fa-solid fa-check"></i> Accept · ${naira(offer.current_price)}</button>${canCounter?`<button type="button" class="btn btn-sm btn-outline" onclick="serviceOfferAction('${offer.id}','counter',${Number(offer.current_price)})"><i class="fa-solid fa-arrow-right-arrow-left"></i> Counter</button>`:''}<button type="button" class="btn btn-sm btn-danger" onclick="serviceOfferAction('${offer.id}','decline',${Number(offer.current_price)})"><i class="fa-solid fa-xmark"></i> Decline</button></div>`;
}
function renderServiceOfferList(offers,isBuyer,isVendor){
  if(!offers.length)return `<p class="muted" style="margin:0;">No service requests yet.</p>`;
  return offers.map(o=>`<div class="service-offer-row" ${serviceOfferActionsHtml(o,isBuyer,isVendor).includes('data-service-offer-id')?'data-service-offer':''}>
    <div class="service-offer-head"><strong>${isBuyer?'Your request':'Buyer request'}</strong><span class="badge">${esc(serviceOfferStatusLabel(o.status))}</span></div>
    <p class="service-offer-description">${esc(o.description)}</p>
    <div class="service-offer-meta"><span><strong>${naira(o.current_price)}</strong></span><span>${esc(o.current_offer_by==='buyer'?'Buyer proposed':'Vendor proposed')}</span><span>Round ${Number(o.round_count||1)}</span></div>
    ${serviceOfferActionsHtml(o,isBuyer,isVendor)}
  </div>`).join('');
}
async function renderCommissionServiceDetail(product,priceHint,offers){
  const ownListing=isOwnVendorId(product.vendor?.id);
  const isBuyer=!!session && !ownListing && profile?.role!=='admin';
  const isVendor=!!session && ownListing;
  const photos=Array.isArray(product.photos)?product.photos.filter(Boolean):[];
  const image=photos[0];
  const vendor=product.vendor||{};
  const rating=Number(vendor.avg_rating||0).toFixed(1);
  const reviews=Number(vendor.review_count||0);
  const category=product.category?.name||'Service';
  let html=`<div class="service-detail-card service-flat" data-service-detail-id="${esc(product.id)}">
    <div class="product-detail-top-actions"><button class="fav-btn ${favoriteIds.has(product.id)?'active':''}" onclick="toggleFavorite(event,'${product.id}')" aria-label="Save to wishlist">${favoriteIds.has(product.id)?"<i class='fa-solid fa-heart'></i>":"<i class='fa-regular fa-heart'></i>"}</button><button type="button" class="product-storefront-share-btn" onclick="openProductShare('${product.id}')" title="Share service"><i class="fa-solid fa-share-nodes"></i></button></div>
    <h2 class="product-detail-title">${esc(product.name)} <span class="badge">Service</span></h2>
    ${image?`<div class="product-detail-media"><div class="product-gallery"><div class="product-gallery-main"><img src="${esc(image)}" alt="${esc(product.name)}" loading="eager" /></div></div></div>`:''}
    <div class="service-vendor-info-block"><div class="service-vendor-info-head" role="button" tabindex="0" style="cursor:pointer;" onclick="navigate('storefront',{vendorId:'${vendor.id}'})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();navigate('storefront',{vendorId:'${vendor.id}'})}"><div class="service-vendor-avatar">${vendor.logo_url?profileAvatarHtml(vendor.logo_url,vendor.business_name||'Vendor','3.4rem'):avatarFallbackHtml(vendor.business_name||'Vendor','3.4rem','',vendor.business_name||'Vendor')}</div><div style="min-width:0;flex:1;"><strong>${vendorNameWithFormerly(vendor)} ${vendor.verification_status==='verified'?'<i data-vt="${esc(vendor.id)}" class="fa-solid fa-circle-check vendor-inline-verified" title="Verified vendor"></i>':''}</strong><div class="muted">${esc(category)}${vendor.city?' · '+esc(vendor.city):''}</div><div class="service-vendor-rating"><i class="fa-solid fa-star"></i> ${rating} (${reviews} review${reviews===1?'':'s'})</div></div></div></div>
    <div class="service-description-block"><h3>About this service</h3><p>${esc(stripProductVariantMeta(product.description||'No description provided.'))}</p></div>
    ${priceHint?`<div class="service-price-hint"><i class="fa-solid fa-chart-line"></i> <strong>Past agreed prices:</strong> ${naira(priceHint.min)}${priceHint.min!==priceHint.max?' – '+naira(priceHint.max):''} <span>(last ${priceHint.count} completed bookings)</span></div>`:''}
  </div>`;
  if(isBuyer){
    html+=`<div class="service-request-card service-flat"><h3><i class="fa-solid fa-handshake"></i> Name your price</h3><p class="muted">Tell the vendor what you need and offer a price. They can accept, decline or counter, just like negotiating a ride.</p><div id="serviceOfferError" class="error-text hidden"></div><label>What do you need?</label><textarea id="serviceOfferDescription" rows="4" maxlength="4000" placeholder="Describe exactly what you need from the vendor…"></textarea><label>Your offer</label><div class="svc-price-box"><button type="button" class="svc-step" onclick="svcBump(-500)" aria-label="Lower offer"><i class="fa-solid fa-minus"></i></button><div class="svc-price-in"><span>₦</span><input id="serviceOfferPrice" type="number" inputmode="decimal" min="1" step="0.01" placeholder="0" /></div><button type="button" class="svc-step" onclick="svcBump(500)" aria-label="Raise offer"><i class="fa-solid fa-plus"></i></button></div><div class="svc-chips">${(priceHint?[priceHint.min,Math.round((Number(priceHint.min)+Number(priceHint.max))/2),priceHint.max]:[5000,10000,20000,50000]).filter((v,i,a)=>a.indexOf(v)===i).map(v=>`<button type="button" class="svc-chip" onclick="svcSetPrice(${Number(v)})">${naira(v)}</button>`).join('')}</div><button type="button" class="btn" onclick="submitServiceOffer('${product.id}')"><i class="fa-solid fa-paper-plane"></i> Send request</button></div>`;
  } else if(profile?.role==='admin'){
    html+=`<div class="card"><p class="muted"><i class="fa-solid fa-circle-info"></i> Admin accounts can't negotiate service bookings.</p></div>`;
  }
  if((isBuyer||isVendor)&&offers.length){
    html+=`<div class="service-offers-card service-flat"><div class="service-offers-head"><h3><i class="fa-solid fa-comments-dollar"></i> ${isVendor?'Service requests':'Your service requests'}</h3><span class="muted">${offers.length} request${offers.length===1?'':'s'}</span></div>${renderServiceOfferList(offers,isBuyer,isVendor)}</div>`;
  }
  return html;
}
window.svcSetPrice=function(v){const i=byId('serviceOfferPrice');if(i){i.value=String(Math.max(1,Number(v)||1));i.focus();}};
window.svcBump=function(d){const i=byId('serviceOfferPrice');if(!i)return;const c=Number(String(i.value||'0').replace(/,/g,''))||0;i.value=String(Math.max(1,c+d));};
window.submitServiceOffer=async function(listingId){
  if(!session){showLogin();return;}
  const desc=String(byId('serviceOfferDescription')?.value||'').trim();
  const price=Number(String(byId('serviceOfferPrice')?.value||'').replace(/,/g,''));
  const err=byId('serviceOfferError'); if(err){err.classList.add('hidden');err.textContent='';}
  if(!desc){if(err){err.textContent='Describe what you need from the vendor.';err.classList.remove('hidden')}return;}
  if(!Number.isFinite(price)||price<=0){if(err){err.textContent='Enter a valid proposed price.';err.classList.remove('hidden')}return;}
  const btn=document.querySelector('.service-request-card button.btn:not(.btn-outline)');if(btn)btn.disabled=true;
  try{const {data,error}=await sb.rpc('create_service_offer',{p_listing_id:listingId,p_description:desc,p_price:price});if(error)throw error;showToast('Service request sent to the vendor.','success');await navigate('productDetail',{productId:listingId,serviceOfferId:data},false);}catch(e){if(err){err.textContent=e.message||'Could not send the service request.';err.classList.remove('hidden')}}finally{if(btn)btn.disabled=false;}
};
window.confirmServiceOfferPayment=async function(id){if(!(await showConfirmDialog('Confirm that you have received the buyer’s bank transfer for this service?',{title:'Confirm payment received',okLabel:'Confirm payment'})))return;try{const {data,error}=await sb.rpc('confirm_service_offer_payment',{p_offer_id:id});if(error)throw error;showToast('Payment confirmed. The service booking is complete.','success');if(data?.order_id){await navigate('orderDetail',{orderId:data.order_id},false);}else{await navigate('productDetail',{productId:currentProductDetail?.id,serviceOfferId:id},false);}}catch(e){showToast(e.message||'Could not confirm payment.','error')}};
window.disputeServiceOfferPayment=async function(id){if(!(await showConfirmDialog('Dispute this reported payment? No commission will be added while it is disputed.',{title:'Dispute payment',okLabel:'Dispute',danger:true})))return;try{const {error}=await sb.rpc('dispute_service_offer_payment',{p_offer_id:id});if(error)throw error;showToast('Payment disputed.','success');await navigate('productDetail',{productId:currentProductDetail?.id,serviceOfferId:id},false);}catch(e){showToast(e.message||'Could not dispute payment.','error')}};
window.__levroBaseRenderProductDetail = __levroOriginalRenderProductDetail;
window.renderProductDetail = async function(productId){
  const {data:p,error}=await sb.from('products').select('id,name,description,photos,is_service,billing_model,status,category:categories(name),vendor:vendors(id,business_name,previous_business_name,name_changed_at,logo_url,city,address,phone,whatsapp_number,whatsapp_visible,avg_rating,review_count,verification_status,is_active)').eq('id',productId).maybeSingle();
  if(!error&&p?.is_service&&p.billing_model==='commission'){
    const own=isOwnVendorId(p.vendor?.id);
    if(!own&&(p.status!=='active'||p.vendor?.verification_status!=='verified'||!p.vendor?.is_active))return '<div class="empty-state">This service is not currently available.</div>';
    const hint=await getServicePriceHint(productId); const offers=await loadServiceOffers(productId); currentProductDetail=p;
    return renderCommissionServiceDetail(p,hint,offers);
  }
  return window.__levroBaseRenderProductDetail(productId);
};

async function __levroOriginalRenderProductDetail(productId) {
  const productQuery = sb.from("products").select("*, vendor:vendors!inner(id, business_name, previous_business_name, name_changed_at, city, address, phone, whatsapp_number, whatsapp_visible, avg_rating, review_count, verification_status, cac_number, created_at, is_active, logo_url, delivery_fee, delivery_fee_mode, delivery_fee_per_km, lat, lng, business_hours, allow_after_hours_messages), category:categories(name)").eq("id", productId).maybeSingle();
  const variantsQuery = sb.from("product_variants").select("*").eq("product_id", productId).order("sort_order", {ascending:true}).order("created_at", {ascending:true});
  const engagementQuery=sb.from("product_engagement_settings").select("allow_comments,like_visibility,comment_audience,vendor_id").eq("product_id",productId).maybeSingle();
  const [{data:product,error},{data:loadedProductVariants,error:variantsError},{data:productEngagement}] = await Promise.all([productQuery,variantsQuery,engagementQuery]);
  if(error){console.error("[Levromart] Product detail load failed:",error);return `<div class="empty-state"><strong>Couldn\'t load this product.</strong><p class="muted" style="margin:.35rem 0 0;">Please try again. If the problem continues, the listing may be unavailable right now.</p></div>`;}
  if(!product)return '<div class="empty-state">Product not found.</div>';
  const ownListing=isOwnVendorId(product.vendor?.id);
  if(!ownListing && (product.status!=="active" || product.vendor?.verification_status!=="verified" || !product.vendor?.is_active)) return '<div class="empty-state">This product is not currently available.</div>';
  if(variantsError)console.warn("[Levromart] Product varieties could not be loaded:",variantsError);
  product.variants=loadedProductVariants||[]; currentProductDetail=product;
  // The vendor can only be messaged from a product page while the customer has an
  // accepted, still-open order for it (or within 24h of one being completed).
  const hasOrderedThisProduct=false;
  sb.rpc("increment_product_view",{p_product_id:productId}).then(()=>{}).catch(()=>{});
  const st={avg_rating:product.vendor?.avg_rating??0,review_count:product.vendor?.review_count??0};
  setTimeout(async()=>{try{const {data:stats}=await sb.rpc("get_vendor_stats",{p_vendor_id:product.vendor.id});const row=(stats&&stats[0])||{};const root=document.querySelector(`.product-detail-card[data-product-detail-id="${CSS.escape(String(productId))}"]`);if(!root)return;root.querySelector("[data-owner-stat=saved]")?.replaceChildren(document.createTextNode(Number(row.favorites_count??0).toLocaleString()));root.querySelector("[data-owner-stat=revenue]")?.replaceChildren(document.createTextNode(naira(Number(row.revenue??0))));root.querySelector("[data-owner-stat=sales]")?.replaceChildren(document.createTextNode(Number(row.sales_count??0).toLocaleString()));}catch(_){}},0);
  const canRent=!ownListing&&(product.listing_type==="rent"||product.listing_type==="both"), canBuy=!ownListing&&(product.listing_type==="sale"||product.listing_type==="both");
  const productVariants=Array.isArray(product.variants)?product.variants.slice().sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)):[];
  // Every variety's own photo is part of the swipeable gallery, so swiping the big picture moves through the varieties.
  const productPhotos=(()=>{const base=Array.isArray(product.photos)?product.photos.filter(Boolean):[];productVariants.forEach(v=>{if(v.photo_url&&!base.some(u=>String(u)===String(v.photo_url)))base.push(v.photo_url)});return base})();
  product.photos=productPhotos;
  // Keep payment-plan percentages as real JavaScript values. These are reused by the
  // customer-facing notices below; do not nest a template literal inside a quoted string.
  const paymentDepositPercent=Math.max(1,Math.min(99,Number(product.payment_deposit_percent ?? 20) || 20));
  const paymentRemainingPercent=100-paymentDepositPercent;
  const cleanDescription=stripProductVariantMeta(product.description||"");
  const photosHtml = productPhotos.length
    ? `<div class="product-gallery product-gallery-carousel">
        <div class="product-gallery-stage">
        <div class="product-gallery-main product-gallery-track" id="productGalleryTrack" aria-label="Product photos">
          ${productPhotos.map((u,i) => `<div class="product-gallery-slide" data-gallery-index="${i}" onclick="openProductGallerySlide(event,${i})"><img src="${esc(u)}" alt="${esc(product.name)} photo ${i+1}" loading="${i===0 ? 'eager' : 'lazy'}" decoding="async" draggable="false" ${i===0 ? 'fetchpriority="high"' : ''} /></div>`).join("")}
        </div>
        ${productPhotos.length > 1 ? `<span class="product-gallery-count"><i class="fa-solid fa-images"></i> <span id="productGalleryCount">1</span>/${productPhotos.length}</span>` : ""}
        </div>
        ${productPhotos.length > 1 ? `<div class="product-gallery-thumbs" aria-label="Product photo varieties">${productPhotos.map((u,i) => `<button type="button" class="product-gallery-thumb ${i===0 ? "active" : ""}" data-gallery-index="${i}" onclick="setProductGalleryPhoto(${i})" aria-label="View product photo ${i+1}"><img src="${esc(u)}" alt="" loading="lazy" decoding="async" /></button>`).join("")}</div>` : ""}
        <button type="button" id="productGalleryReturnMain" class="product-gallery-return-main hidden" onclick="restoreProductGalleryMainImage()" aria-label="Return to main product image"><i class="fa-solid fa-arrow-left"></i> Main image</button>
      </div>`
    : `<div class="product-img" style="height:220px;">${product.vendor?.logo_url ? `<img src="${esc(product.vendor.logo_url)}" alt="${esc(product.vendor.business_name||"Vendor")}" onerror="this.outerHTML=lvInitialsTileHtml(this.alt)">` : lvInitialsTileHtml(product.vendor?.business_name || product.name)}</div>`;
  window.__productGalleryPhotos = productPhotos;
  window.__productGalleryMainIndex = 0;
  window.__productGalleryVarietyOverride = false;
  window.__productGalleryIndex = 0;
  const isFav = favoriteIds.has(product.id);
  window.__lastRenderedProductPreview = product;
  try { syncLevromartLinkPreviewMeta('productDetail', { productId: product.id }); } catch (_) {}

  const statItems = [
    // Skip this when the product has its own varieties -- availability is
    // then a per-variety thing (shown in the variety picker itself), not a
    // single base-product number. Also skip it entirely when the vendor has
    // switched quantity tracking off for an item that isn't meant to run
    // out (e.g. made-to-order food).
    (!product.is_service && !productVariants.length && product.track_quantity !== false) ? { label: "Available", value: `${product.quantity_available} / ${product.quantity_total}` } : null,
    (product.sale_price != null && product.is_service) ? { label: "Price", value: naira(effectivePrice(product)) + servicePriceSuffix(product) } : null,
    product.rental_rate != null ? { label: "Rent", value: `${naira(product.rental_rate)} per ${product.rental_rate_unit}` } : null,
    product.deposit_amount ? { label: "Refundable deposit", value: naira(product.deposit_amount) } : null,
  ].filter(Boolean);

  const productGalleryVariantMetaHtml = productVariants.length ? `<div class="product-gallery-variant-meta" id="productGalleryVariantMeta"><span class="product-gallery-variant-label">Selected variety:</span><strong id="productGalleryVariantName">${esc(productVariants[0].name || "Selected variety")}</strong><strong id="productGalleryVariantPrice">Price: ${naira(Number(effectivePrice(productVariants[0]) ?? productVariants[0].rental_rate ?? 0))}</strong></div>` : "";

  let html = `<div class="card product-detail-card" data-product-detail-id="${esc(product.id)}" style="position:relative;">
    <div class="product-detail-top-actions" aria-label="Product actions">
      <button class="fav-btn ${isFav ? "active" : ""}" onclick="toggleFavorite(event,'${product.id}')" title="Save to wishlist" aria-label="Save to wishlist">${isFav ? "<i class='fa-solid fa-heart'></i>" : "<i class='fa-regular fa-heart'></i>"}</button>
      <button type="button" class="product-storefront-share-btn lv-top-comment-btn" onclick="lvOpenProductComments('${product.id}')" title="Comments" aria-label="Open comments"><span class="lv-cbubble"><i class="fa-solid fa-comment-dots"></i><b class="lv-ccount" data-product-id="${esc(product.id)}">${window.__productCommentCounts?.get?.(String(product.id)) ?? ""}</b></span></button>
      <button type="button" class="product-storefront-share-btn" onclick="openProductShare('${product.id}')" title="Share product" aria-label="Share product"><i class="fa-solid fa-share-nodes"></i></button>
    </div>
    <h2 class="product-detail-title">${esc(product.name)}${product.is_service ? ` <span class="badge">Service</span>` : ""}</h2>
    <div class="product-detail-media">${photosHtml}</div>
    ${productVariants.length && productVariants.some(v=>!v.photo_url) ? `<div class="product-gallery-varieties" id="productGalleryVarieties"><div class="product-gallery-varieties-head"><strong>Varieties</strong><span class="muted" style="font-size:.68rem;">${productVariants.length} option${productVariants.length===1?'':'s'}</span></div><div class="product-gallery-varieties-list">${productVariants.map((v,i)=>{const unit=Number(v.discount_price ?? v.sale_price ?? v.rental_rate ?? 0);const photo=v.photo_url||'';return `<button type="button" class="product-gallery-variety ${i===0?'active':''}" data-gallery-variety-id="${esc(v.id)}" onclick="selectProductVariant('${esc(v.id)}',true,true)">${photo?`<img src="${esc(photo)}" alt="${esc(v.name||`Variety ${i+1}`)}" loading="lazy" decoding="async">`:`<span class="product-gallery-variety-placeholder"><i class="fa-solid fa-layer-group"></i></span>`}<strong>${esc(v.name||`Variety ${i+1}`)}</strong><small>${unit>0?naira(unit):'Price on request'}</small></button>`;}).join('')}</div></div>` : ''}
    ${productGalleryVariantMetaHtml}
    <div class="product-detail-actions">
      ${(() => {
        if (profile?.role === "admin") return "";
        // No Message vendor button on product pages at all: customers message a vendor only from an accepted order.
        return "";
        if (!canMessageVendorNow(product.vendor)) {
          const hs = vendorHoursStatus(product.vendor);
          return `<span class="storefront-contact-closed" title="${esc(`${product.vendor.business_name || "This vendor"} is outside working hours right now${hs.todayText ? ` (${hs.todayLabel}: ${hs.todayText})` : ""}.`)}"><i class="fa-regular fa-clock"></i><span>Outside working hours</span></span>`;
        }
        // In-app messaging only -- no WhatsApp link, no direct call. Contact
        // details stay off the storefront entirely (see the chat contact-info
        // guard for why: this is the same "don't let a sale move off-platform
        // before the platform's been paid" decision, applied here too).
        return `<button class="btn btn-sm" onclick="startConversationWithVendor('${product.vendor.id}')"><i class='fa-solid fa-comment-dots'></i> Message vendor</button>`;
      })()}
      ${`<span class="badge ${ratingBadgeClass(Number(st.avg_rating ?? 0))}"><i class="fa-solid fa-star"></i> ${Number(st.avg_rating ?? 0).toFixed(1)} (${Number(st.review_count ?? 0)})</span>`}
    </div>
    <div class="product-detail-info">
      <p><strong>Vendor:</strong> <a class="product-detail-vendor-link" href="#" onclick="navigate('storefront',{vendorId:'${product.vendor.id}'});return false;">${product.vendor.logo_url ? `<img src="${esc(product.vendor.logo_url)}" alt="" class="product-detail-vendor-logo" loading="lazy" decoding="async" draggable="false">` : avatarFallbackHtml(product.vendor.business_name || "Vendor", "2.4rem", "product-detail-vendor-logo", product.vendor.business_name || "Vendor", product.vendor.id)}<span>${vendorNameWithFormerly(product.vendor)}</span></a></p>
      ${product.is_service || !product.condition ? "" : `<p class="pd-condition"><strong>Condition:</strong> <span class="pd-chip">${esc((product.condition || "").replace("-", " "))}</span></p>`}
      <details class="pd-about"><summary><span><i class="fa-solid fa-circle-info"></i> About this ${product.is_service ? "service" : "product"}</span><i class="fa-solid fa-chevron-down pd-about-chev"></i></summary><div class="pd-about-body">${readMoreHtml(`productDescText-${product.id}`, cleanDescription || "No description provided.")}</div></details>
    </div>
    ${(product.sale_price != null && !product.is_service) ? `<div class="product-price-hero" id="productPriceHero"><div class="pph-label">${productVariants.length ? "Price · selected variety" : "Buy price"}</div><div class="pph-row" id="productPriceHeroBody">${priceHeroInner(productVariants.length ? productVariants[0] : product)}</div></div>` : ""}
    ${statItems.length ? `<div class="product-detail-stats">${statItems.map((s) => `<div><span class="muted">${esc(s.label)}</span><strong>${s.value}</strong></div>`).join("")}</div>` : ""}
  </div>`;

  if (profile?.role === "admin") {
    html += `<div class="card"><p class="muted"><i class="fa-solid fa-circle-info"></i> Admin accounts can't make purchases on Levromart.</p></div>`;
  } else if (canRent) {
    const today = new Date().toISOString().slice(0, 10);
    html += `<div class="card"><h3><i class='fa-solid fa-calendar-days'></i> Rent this item</h3>
      <div class="flex">
        <input type="date" id="rentStart" min="${today}" oninput="updateRentTotalPreview(${product.rental_rate},'${product.rental_rate_unit}')" />
        <input type="date" id="rentEnd" min="${today}" oninput="updateRentTotalPreview(${product.rental_rate},'${product.rental_rate_unit}')" />
        <input type="number" id="rentQty" value="1" min="1" max="${product.quantity_total}" placeholder="Qty" oninput="updateRentTotalPreview(${product.rental_rate},'${product.rental_rate_unit}')" style="width:90px;" />
      </div>
      <p class="muted" id="rentTotalPreview">Pick your dates to see the total.</p>
      ${!product.is_service ? `<div class="product-payment-plan-notice ${product.payment_timing === "pay_after" ? "pay-after" : "pay-before"}"><strong><i class="fa-solid fa-wallet"></i> ${product.payment_timing === "pay_after" ? "Pay after delivery" : "Pay before delivery"}</strong><span>${product.payment_timing === "pay_after" ? `Pay ${paymentDepositPercent}% first; the remaining ${paymentRemainingPercent}% is due after delivery.` : "Full payment is required before delivery. If you need a different arrangement, please contact the vendor."}</span></div>` : ""}
      ${deliveryFieldsHtml("rent", product.delivery_fee, product.vendor.lat, product.vendor.lng, product.delivery_fee_mode, product.delivery_fee_per_km)}
      <button class="btn" onclick="confirmRental('${product.vendor.id}','${product.id}')">Reserve</button>
      <p id="rentError" class="error-text hidden"></p>
    </div>`;
  }
  if (profile?.role !== "admin" && canBuy) {
    const buyLabel = product.is_service ? "Book Now" : "Place order";
    const isTimedService = product.is_service && product.service_price_unit && product.service_price_unit !== "flat";
    // Items that are not counted in stock (made to order, etc.) show no stock number and no quantity box here.
    const hideQty = !product.is_service && product.track_quantity === false;
    html += `<div class="card"><h3><i class='fa-solid ${product.is_service ? "fa-calendar-check" : "fa-cart-shopping"}'></i> ${buyLabel}</h3>
      ${productVariants.length ? `<input type="hidden" id="selectedProductVariantId" value="${esc(productVariants[0].id)}" />` : ""}
      ${productVariants.length ? `<div class="selected-variant-summary sv-card" id="selectedVariantSummary"><div class="sv-top"><div class="sv-name"><span class="sv-label">Selected variety</span><strong id="selectedVariantName">${esc(productVariants[0].name)}</strong></div><strong id="selectedVariantPrice" class="sv-price">${naira(Number(effectivePrice(productVariants[0]) ?? 0))}</strong></div>${hideQty ? "" : `<div class="sv-stock muted">Available: <span id="selectedVariantStock">${variantStockLabel(productVariants[0])}</span></div>`}<details class="sv-details"><summary>About this variety <i class="fa-solid fa-chevron-down"></i></summary><p id="selectedVariantDescription" class="muted">${esc(productVariants[0].description || cleanDescription || "No variety-specific description is stored.")}</p></details></div>` : ""}
      <div class="pd-qty-row${hideQty ? " pd-no-qty" : ""}">${hideQty ? `<input type="hidden" id="buyQty" value="1" />` : `<div class="pd-qty-box"><span class="df-label">Quantity</span><div class="flex" style="margin:0;">
        ${isTimedService
          ? `<div><label style="margin:0;">Number of ${product.service_price_unit}s</label><input type="number" id="buyQty" value="1" min="1" oninput="updateServiceTotalPreview(${product.sale_price},'${product.service_price_unit}')" style="width:140px;" /></div>`
          : `<input type="number" id="buyQty" value="1" min="1" placeholder="Qty" oninput="updateBuyTotalPreview(${effectivePrice(product) ?? 0})" style="width:90px;" />`}
      </div></div>`}<div class="pd-total-box ${product.is_service ? "" : "pd-has-plan"}">${product.sale_price != null ? `<p class="muted" id="serviceTotalPreview" data-raw-total="${productVariants.length ? Number(effectivePrice(productVariants[0]) ?? effectivePrice(product)) : effectivePrice(product)}">Total: ${naira(productVariants.length ? Number(effectivePrice(productVariants[0]) ?? effectivePrice(product)) : effectivePrice(product))}</p>` : ""}</div></div>
      <div class="pd-step-title"><i class="fa-solid fa-truck-fast"></i> How do you want it?</div>
      ${deliveryFieldsHtml("buy", product.delivery_fee, product.vendor.lat, product.vendor.lng, product.delivery_fee_mode, product.delivery_fee_per_km, product.is_service ? "In-person" : "Pickup")}
      ${!product.is_service ? `<div class="pd-pay-notice"><div class="product-payment-plan-notice ${product.payment_timing === "pay_after" ? "pay-after" : "pay-before"}"><strong><i class="fa-solid fa-wallet"></i> ${product.payment_timing === "pay_after" ? "Pay after delivery" : "Pay before delivery"}</strong><span>${product.payment_timing === "pay_after" ? `Pay ${paymentDepositPercent}% now, ${paymentRemainingPercent}% after delivery.` : "Full payment is needed before delivery."}</span></div></div>` : ""}
      ${!product.is_service ? `<div class="pd-note-box"><label class="df-label" for="buyNote"><svg class="lv-pen-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7.4 18.6l-4 1 1-4z"/></svg> Note for the vendor <span class="df-hint">(optional)</span></label><textarea id="buyNote" rows="2" placeholder="e.g. I'd like the blue one, or a size 42"></textarea></div>` : ""}
      <div class="flex pd-buy-actions">
        ${!product.is_service ? `<button id="productAddToCartBtn" class="btn btn-outline" onclick="addToCart('${product.id}', parseInt(byId('buyQty').value)||1)"><i class="fa-solid fa-cart-plus"></i> Add to cart</button>` : ""}
        <button class="btn" onclick="buyNow('${product.vendor.id}','${product.id}')">${buyLabel}</button>
      </div>
      <p id="buyError" class="error-text hidden"></p>
    </div>`;
  }
  if (ownListing) {
    const ownerPaid = product.billing_model !== "monthly" || listingActivationValid(product);
    html += `<div class="card owner-listing-management"><div class="owner-listing-head"><div><span class="muted">Your listing</span><h3 style="margin:.15rem 0 0;">Manage this listing</h3></div><span class="badge ${product.status === "active" ? "success" : "warning"}">${esc(product.status || "paused")}</span></div>
      <div class="owner-listing-stats"><div><span>Views</span><strong>${Number(product.view_count||0).toLocaleString()}</strong></div><div><span>Saved</span><strong data-owner-stat="saved">0</strong></div><div><span>Revenue</span><strong data-owner-stat="revenue">${naira(0)}</strong></div><div><span>Sales</span><strong data-owner-stat="sales">0</strong></div></div>
      <div class="owner-listing-actions"><button type="button" class="btn btn-sm" onclick="openEditProductModal('${product.id}')"><i class="fa-solid fa-pen"></i> Edit</button>${product.status === "active" ? `<button type="button" class="btn btn-sm btn-outline" onclick="setProductStatus('${product.id}','paused')">Pause</button>` : ownerPaid ? `<button type="button" class="btn btn-sm" onclick="setProductStatus('${product.id}','active')">Activate</button>` : `<button type="button" class="btn btn-sm" onclick="startListingMonthlyPayment('product','${product.id}')"><i class="fa-solid fa-credit-card"></i> Pay ₦999</button>`}<button type="button" class="btn btn-sm btn-danger" onclick="removeProduct('${product.id}')"><i class="fa-solid fa-trash"></i> Remove</button></div>
      ${product.variants?.length ? `<p class="muted owner-listing-variant-note"><i class="fa-solid fa-layer-group"></i> ${product.variants.length} variety${product.variants.length===1?"":"ies"} configured.</p>` : ""}</div>`;
  }
  html += `<div class="card product-reviews-card"><h3 style="margin-top:0;"><i class="fa-solid fa-star"></i> Ratings &amp; reviews</h3><div id="productReviewsBody-${esc(product.id)}" class="product-reviews-body"><p class="muted">Loading reviews…</p></div></div>`;
  html += `<div class="card product-comments-card" data-product-comments-id="${esc(product.id)}"><button type="button" class="product-comments-toggle ${productEngagement?.allow_comments===false?"disabled":""}" onclick="${productEngagement?.allow_comments===false?"":"toggleProductComments('"+esc(product.id)+"')"}" aria-expanded="false" aria-label="${productEngagement?.allow_comments===false?"Comments disabled":"Show product comments"}"><span><i class="fa-regular fa-comment"></i><strong id="productCommentsCount" data-product-id="${esc(product.id)}">0</strong></span><i class="fa-solid fa-chevron-down"></i></button><div id="productCommentsPanel" class="product-comments-panel hidden"></div></div>`;
  setTimeout(() => hydrateProductReviewSection(product.id), 0);
  const relatedNames = RELATED_EQUIPMENT[product.category?.name] || [];
  if (relatedNames.length) {
    const { data: related } = await sb.from("products")
      .select("id, name, listing_type, sale_price, discount_price, rental_rate, rental_rate_unit, photos, quantity_available, condition, is_service, service_price_unit, delivery_fee, delivery_fee_mode, delivery_fee_per_km, category:categories!inner(name), vendor:vendors!inner(id, business_name, verification_status, logo_url, delivery_fee, delivery_fee_mode, delivery_fee_per_km, lat, lng)")
      .neq("id", product.id).eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true)
      .in("category.name", relatedNames).limit(6);
    if (related && related.length) {
      html += `<h3 class="section-title">You may also need</h3><div class="hscroll">${related.map(productCardHtml).join("")}</div>`;
    }
  }

  return html;
}

const RELATED_EQUIPMENT = {
  "ECG Machine": ["Pulse Oximeter", "Stethoscope", "Blood Pressure Machine"],
  "Blood Pressure Machine": ["Stethoscope", "Pulse Oximeter", "Thermometer"],
  "Glucometer": ["Thermometer", "Blood Pressure Machine"],
  "Pulse Oximeter": ["ECG Machine", "Blood Pressure Machine"],
  "Stethoscope": ["Blood Pressure Machine", "ECG Machine"],
  "Thermometer": ["Glucometer", "Blood Pressure Machine"],
  "Hospital Bed": ["Wheelchair", "Suction Machine", "Nebulizer"],
  "Wheelchair": ["Hospital Bed"],
  "Nebulizer": ["Suction Machine", "Hospital Bed"],
  "Suction Machine": ["Nebulizer", "Hospital Bed"],
  "Ultrasound Machine": ["ECG Machine"],
};

function deliveryFieldsHtml(prefix, deliveryFee, vendorLat, vendorLng, feeMode, perKm, pickupLabel, fixedItemTotal) {
  const fee = Number(deliveryFee) || 0;
  const isDistance = feeMode === "distance" && Number(perKm) > 0 && vendorLat != null && vendorLng != null;
  const hasVendorLoc = vendorLat != null && vendorLng != null;
  return `<div class="flex delivery-method-row" style="margin:0.6rem 0 0.9rem;flex-direction:row;">
      <label style="display:flex;align-items:center;gap:0.35rem;margin:0;font-weight:400;"><input type="radio" name="${prefix}DeliveryMethod" value="delivery" checked onchange="toggleDeliveryFields('${prefix}')" style="width:auto;margin:0;" /> Delivery${isDistance ? " (by distance)" : fee > 0 ? ` <strong class="delivery-fee-inline">(+${naira(fee)})</strong>` : " (free)"}</label>
      <label style="display:flex;align-items:center;gap:0.35rem;margin:0;font-weight:400;"><input type="radio" name="${prefix}DeliveryMethod" value="pickup" onchange="toggleDeliveryFields('${prefix}')" style="width:auto;margin:0;" /> ${esc(pickupLabel || "Pickup")}</label>
    </div>
    <div id="${prefix}DeliveryFields" class="dyn-delivery-fields" style="margin-bottom:0.9rem;" data-vendor-lat="${vendorLat ?? ""}" data-vendor-lng="${vendorLng ?? ""}" data-fee="${fee}" data-fee-mode="${esc(feeMode || "flat")}" data-per-km="${Number(perKm) || 0}" data-pickup-label="${esc(pickupLabel || "Pickup")}" data-item-total="${fixedItemTotal != null ? Number(fixedItemTotal) : ""}">
      <label class="df-label" for="${prefix}Address"><i class="fa-solid fa-location-dot"></i> Delivery address</label>
      <input type="text" id="${prefix}Address" placeholder="Delivery address" value="${esc(profile?.address || "")}" />
      ${!isDistance && fee > 0 ? `<p class="delivery-fee-line" style="margin:0.35rem 0 0;"><i class="fa-solid fa-truck"></i> <strong>${naira(fee)}</strong> delivery fee</p>` : ""}
      ${isDistance || hasVendorLoc ? `<p class="delivery-fee-line" style="margin:0.35rem 0 0;" id="${prefix}FeeLine">${deliveryInfoLineHtml(prefix, isDistance, hasVendorLoc, vendorLat, vendorLng, perKm)}</p>` : ""}
      <div id="${prefix}PriceBreakdown" class="price-breakdown-table" aria-live="polite"></div>
      <p class="muted" style="font-size:0.76rem;margin-top:0.25rem;">Wrong? <a href="#" onclick="navigate('editProfile');return false;">Fix in profile</a>.</p>
    </div>`;
}
// A always-visible item + delivery-fee + total breakdown so buyers can't miss
// what they'll actually pay -- reads the item subtotal from whichever live
// preview element applies (buy/service or rent) or, for a fixed-price
// listing like a package, from data-item-total set at render time.
// A plain-language breakdown of how the delivery fee was worked out, so the buyer can see why they pay it.
function deliveryFeeCalcHtml(prefix) {
  const wrap = byId(`${prefix}DeliveryFields`);
  if (!wrap) return "";
  const vLat = wrap.dataset.vendorLat !== "" ? Number(wrap.dataset.vendorLat) : null;
  const vLng = wrap.dataset.vendorLng !== "" ? Number(wrap.dataset.vendorLng) : null;
  let lines = [];
  if (wrap.dataset.feeLines) { try { lines = JSON.parse(wrap.dataset.feeLines); } catch (_) { lines = []; } }
  else lines = [{ name: "", mode: wrap.dataset.feeMode || "flat", fee: Number(wrap.dataset.fee) || 0, perKm: Number(wrap.dataset.perKm) || 0 }];
  const rows = [];
  let km = null;
  if (buyerLocation && vLat != null && vLng != null) km = haversineKm(buyerLocation.lat, buyerLocation.lng, vLat, vLng);
  let usedDistance = false;
  lines.forEach((l) => {
    const label = l.name ? ` <small>(${esc(l.name)})</small>` : "";
    if (l.mode === "distance" && l.perKm > 0 && km != null) {
      usedDistance = true;
      const billedKm = Math.max(1, km), raw = l.perKm * billedKm, fee = Math.round(raw / 50) * 50;
      rows.push(`<div class="fee-calc-row"><span>${billedKm.toFixed(2)} km × ${naira(l.perKm)} per km${label}${km < 1 ? " <small>(1 km minimum)</small>" : ""}</span><strong>${naira(Math.round(raw))}</strong></div>` + (Math.round(raw) !== fee ? `<div class="fee-calc-row fee-calc-sub"><span>Rounded to the nearest ₦50</span><strong>${naira(fee)}</strong></div>` : ""));
    } else if (l.mode === "flat" && l.fee > 0) {
      rows.push(`<div class="fee-calc-row"><span>Flat delivery fee${label}</span><strong>${naira(l.fee)}</strong></div>`);
    }
  });
  if (!usedDistance || !rows.length) return "";
  const perKmShown = lines.find((l) => l.mode === "distance" && l.perKm > 0)?.perKm;
  return `<details class="fee-calc"><summary><span><i class="fa-solid fa-route"></i> How is this fee worked out?</span><i class="fa-solid fa-chevron-down fee-calc-chev"></i></summary>
    <div class="fee-calc-body">
    <div class="fee-calc-row"><span>Distance (straight line)</span><strong>${km.toFixed(2)} km</strong></div>
    <div class="fee-calc-row"><span>Vendor's rate</span><strong>${naira(perKmShown)} / km</strong></div>
    ${rows.join("")}
    </div></details>`;
}
function refreshPriceBreakdown(prefix) {
  const wrap = byId(`${prefix}DeliveryFields`);
  const box = byId(`${prefix}PriceBreakdown`);
  if (!wrap || !box) return;
  const method = document.querySelector(`input[name="${prefix}DeliveryMethod"]:checked`)?.value || "delivery";
  let itemTotal = wrap.dataset.itemTotal !== "" ? Number(wrap.dataset.itemTotal) : null;
  if (itemTotal == null) {
    const previewEl = byId(prefix === "rent" ? "rentTotalPreview" : "serviceTotalPreview");
    itemTotal = previewEl?.dataset.rawTotal != null ? Number(previewEl.dataset.rawTotal) : null;
  }
  if (itemTotal == null) { box.innerHTML = ""; return; }
  const pickupLabel = wrap.dataset.pickupLabel || "Pickup";
  const { fee, known } = computeDeliveryFeeForPrefix(prefix, method);
  const feeLabel = method !== "delivery" ? `<span class="price-breakdown-free">Free</span>` : known ? (fee > 0 ? naira(fee) : `<span class="price-breakdown-free">Free</span>`) : `<span class="muted">Share location to see fee</span>`;
  const total = method !== "delivery" ? itemTotal : (known ? itemTotal + fee : null);
  if (prefix === "buy") {
    // Keep the headline "Total" honest: show the delivery-inclusive amount right under it.
    const headline = byId("serviceTotalPreview");
    if (headline) {
      headline.querySelector(".total-with-delivery")?.remove();
      if (method === "delivery" && known && fee > 0) headline.insertAdjacentHTML("beforeend", ` <span class="total-with-delivery" style="display:block;font-weight:700;">With delivery: ${naira(itemTotal + fee)}</span>`);
    }
  }
  const ckTotal = byId(`${prefix}CheckoutTotal`);
  if (ckTotal) ckTotal.textContent = naira(method !== "delivery" ? itemTotal : (known ? itemTotal + fee : itemTotal));
  box.innerHTML = `
    <div class="price-breakdown-row"><span>Item price</span><strong>${naira(itemTotal)}</strong></div>
    <div class="price-breakdown-row"><span>${method === "delivery" ? "Delivery fee" : pickupLabel}</span><strong>${feeLabel}</strong></div>
    ${total != null ? `<div class="price-breakdown-row price-breakdown-total"><span>You'll pay</span><strong>${naira(total)}</strong></div>` : `<div class="price-breakdown-row"><span class="muted">Full total shown once your location is shared</span></div>`}
  ` + (method === "delivery" ? deliveryFeeCalcHtml(prefix) : "");
}
// Delivery defaults ON (most buyers want it) -- this renders that default
// info line synchronously from data already known at render time, so it's
// correct on first paint without waiting for a JS pass after insertion.
function deliveryInfoLineHtml(prefix, isDistance, hasVendorLoc, vendorLat, vendorLng, perKm) {
  if (!isDistance && !hasVendorLoc) return "";
  // Distance pricing should always show the actual rate (naira per km) up
  // front, not just a final computed number with no way to see how it was
  // worked out -- and once the buyer's location is known, show the actual
  // multiplication (rate × distance = total), not just the total alone.
  if (isDistance && !buyerLocation) {
    return `<i class="fa-solid fa-truck"></i> ${naira(Number(perKm))}/km · <a href="#" onclick="requestDeliveryEta('${prefix}');return false;">Share location</a> to see your total delivery cost.`;
  }
  if (!buyerLocation) return `<i class="fa-solid fa-location-crosshairs"></i> <a href="#" onclick="requestDeliveryEta('${prefix}');return false;">Share location</a> for an ETA.`;
  const km = haversineKm(buyerLocation.lat, buyerLocation.lng, vendorLat, vendorLng);
  const eta = estimateDeliveryRange(km);
  if (isDistance) {
    const fee = distanceDeliveryFee(perKm, km);
    return `<i class="fa-solid fa-truck"></i> ${naira(Number(perKm))}/km × ${formatDistanceKm(Math.max(1, km))}${km < 1 ? " (1 km minimum)" : ""} = <strong>${naira(fee)}</strong> · ~${eta}`;
  }
  return `<i class="fa-solid fa-clock"></i> ~${eta} estimated`;
}
// Distance-priced delivery only ever gets a real, accurate fee once we know
// where the customer actually is -- so for that mode, being on "Delivery"
// (the default) compulsorily asks for location right away instead of
// letting someone proceed and only finding out (or worse, getting a wrong
// flat-rate fee) at checkout. Runs both on the delivery/pickup radio
// changing AND once automatically per page load (see initDeliveryFieldsOnPage)
// since delivery now starts pre-selected, not something someone has to
// actively switch to.
async function ensureDeliveryLocation(prefix) {
  const wrap = byId(`${prefix}DeliveryFields`);
  if (!wrap) return;
  const isDistance = wrap.dataset.feeMode === "distance" && Number(wrap.dataset.perKm) > 0 && wrap.dataset.vendorLat && wrap.dataset.vendorLng;
  if (isDistance && !buyerLocation) {
    try {
      await requestCustomerLocation();
    } catch (err) {
      showToast("Delivery for this vendor is priced by distance, so it needs your location. Switched to pickup.", "info");
      const pickupRadio = document.querySelector(`input[name="${prefix}DeliveryMethod"][value="pickup"]`);
      if (pickupRadio) pickupRadio.checked = true;
      wrap.classList.add("hidden");
      return;
    }
  }
  updateDeliveryEta(prefix);
}
async function toggleDeliveryFields(prefix) {
  const method = document.querySelector(`input[name="${prefix}DeliveryMethod"]:checked`)?.value;
  byId(`${prefix}DeliveryFields`)?.classList.toggle("hidden", method !== "delivery");
  refreshPriceBreakdown(prefix);
  if (method !== "delivery") return;
  ensureDeliveryLocation(prefix);
}
// Every page that renders deliveryFieldsHtml (product page, cart, packages)
// starts with Delivery pre-selected, so this scans for all of them after
// each render and runs the same compulsory-location + fee/ETA check a
// manual toggle would have triggered -- one shared hook instead of wiring
// a setTimeout into every call site.
function initDeliveryFieldsOnPage() {
  document.querySelectorAll(".dyn-delivery-fields").forEach((wrap) => {
    const prefix = wrap.id.replace(/DeliveryFields$/, "");
    ensureDeliveryLocation(prefix);
    refreshPriceBreakdown(prefix);
  });
}
function updateDeliveryEta(prefix) {
  const wrap = byId(`${prefix}DeliveryFields`);
  const feeEl = byId(`${prefix}FeeLine`);
  if (!wrap || !feeEl) return;
  const vLat = parseFloat(wrap.dataset.vendorLat);
  const vLng = parseFloat(wrap.dataset.vendorLng);
  if (isNaN(vLat) || isNaN(vLng)) return;
  const isDistance = wrap.dataset.feeMode === "distance" && Number(wrap.dataset.perKm) > 0;
  feeEl.innerHTML = deliveryInfoLineHtml(prefix, isDistance, true, vLat, vLng, wrap.dataset.perKm);
  refreshPriceBreakdown(prefix);
}
async function requestDeliveryEta(prefix) {
  try {
    await requestCustomerLocation();
    updateDeliveryEta(prefix);
  } catch (err) { /* declined, leave as-is */ }
}
// Same idea as updateDeliveryEta, but for an order that's already placed --
// keyed off window.__orderEtaVendor since this fires from a setTimeout
// outside the render closure that built the order detail page.
function updateOrderDeliveryEta() {
  const etaEl = byId("orderEtaLine");
  const v = window.__orderEtaVendor;
  if (!etaEl || !v) return;
  if (!buyerLocation) {
    etaEl.innerHTML = `<i class="fa-solid fa-clock"></i> <a href="#" onclick="requestOrderEta();return false;">Share location</a> for an ETA.`;
    return;
  }
  const km = haversineKm(buyerLocation.lat, buyerLocation.lng, v.lat, v.lng);
  etaEl.innerHTML = `<i class="fa-solid fa-clock"></i> ~${estimateDeliveryRange(km)} estimated delivery.`;
}
async function requestOrderEta() {
  try {
    await requestCustomerLocation();
    updateOrderDeliveryEta();
  } catch (err) { /* declined, leave as-is */ }
}
function readDeliveryFields(prefix, errorEl) {
  const method = document.querySelector(`input[name="${prefix}DeliveryMethod"]:checked`)?.value || "pickup";
  const address = byId(`${prefix}Address`)?.value.trim() || "";
  const phone = null; // contacts are no longer exchanged; buyers and vendors use in-app chat and calls
  if (method === "delivery" && !address) {
    errorEl.textContent = "Enter a delivery address, or switch to pickup.";
    errorEl.classList.remove("hidden");
    return null;
  }
  return { method, address, phone };
}
// Mirrors deliveryInfoLineHtml's math so the order-confirmation summary can
// show the same delivery fee the buyer already saw on the page, as a real
// number to add into the grand total (not just re-displayed text).
function computeDeliveryFeeForPrefix(prefix, method) {
  if (method !== "delivery") return { fee: 0, known: true };
  const wrap = byId(`${prefix}DeliveryFields`);
  if (!wrap) return { fee: 0, known: true };
  const feeMode = wrap.dataset.feeMode || "flat";
  const flatFee = Number(wrap.dataset.fee) || 0;
  const perKm = Number(wrap.dataset.perKm) || 0;
  const vendorLat = wrap.dataset.vendorLat !== "" ? Number(wrap.dataset.vendorLat) : null;
  const vendorLng = wrap.dataset.vendorLng !== "" ? Number(wrap.dataset.vendorLng) : null;
  if (wrap.dataset.feeLines) {
    try {
      const lines = JSON.parse(wrap.dataset.feeLines);
      let total = 0;
      for (const l of lines) {
        if (l.mode === "flat") total += Number(l.fee) || 0;
        else if (l.mode === "distance" && l.perKm > 0) {
          if (vendorLat == null || vendorLng == null) total += Number(l.fee) || 0;
          else if (!buyerLocation) return { fee: 0, known: false };
          else total += distanceDeliveryFee(l.perKm, haversineKm(buyerLocation.lat, buyerLocation.lng, vendorLat, vendorLng));
        }
      }
      return { fee: total, known: true };
    } catch (_) {}
  }
  const isDistanceMode = feeMode === "distance" && perKm > 0 && vendorLat != null && vendorLng != null;
  if (isDistanceMode) {
    if (!buyerLocation) return { fee: 0, known: false };
    const km = haversineKm(buyerLocation.lat, buyerLocation.lng, vendorLat, vendorLng);
    return { fee: distanceDeliveryFee(perKm, km), known: true };
  }
  return { fee: flatFee, known: true };
}
// A full, itemised breakdown for the order-confirmation pop-up -- item(s),
// delivery/pickup method, delivery fee (if any) and a real grand total --
// instead of a single vague line. Scrolls inside the dialog if it grows
// long (see #confirmModalMsg's max-height/overflow-y).
function orderSummaryConfirmHtml({ itemLines, method, pickupLabel, deliveryFee, feeKnown, itemTotal }) {
  const rows = itemLines.map((line) => `<div class="order-summary-row"><span>${esc(line)}</span></div>`).join("");
  const methodLabel = method === "delivery" ? "Delivery" : (pickupLabel || "Pickup");
  const deliveryRow = method === "delivery"
    ? (feeKnown
      ? `<div class="order-summary-row"><span>Delivery fee</span><strong>${deliveryFee > 0 ? naira(deliveryFee) : "Free"}</strong></div>`
      : `<div class="order-summary-row"><span>Delivery fee</span><span class="muted">Confirmed after location is shared</span></div>`)
    : "";
  const grandTotal = itemTotal != null && feeKnown ? itemTotal + deliveryFee : null;
  return `<div class="order-summary-confirm">
    ${rows}
    <div class="order-summary-row"><span>Fulfilment</span><strong>${esc(methodLabel)}</strong></div>
    ${deliveryRow}
    ${grandTotal != null ? `<div class="order-summary-row order-summary-total"><span>Total to pay</span><strong>${naira(grandTotal)}</strong></div>` : ""}
  </div>`;
}

async function confirmRental(vendorId, productId) {
  if (!session) { showLogin(); return; }
  if (blockOwnVendorPurchase(vendorId, "rent")) return;
  const start = byId("rentStart").value;
  const end = byId("rentEnd").value;
  const qty = parseInt(byId("rentQty").value) || 1;
  const errorEl = byId("rentError");
  errorEl.classList.add("hidden");
  if (!start || !end) { errorEl.textContent = "Select both dates."; errorEl.classList.remove("hidden"); return; }
  const delivery = readDeliveryFields("rent", errorEl);
  if (!delivery) return;

  const productName = currentProductDetail?.name || "this item";
  const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const rentPreviewEl = byId("rentTotalPreview");
  const itemTotal = rentPreviewEl?.dataset.rawTotal != null ? Number(rentPreviewEl.dataset.rawTotal) : null;
  const { fee: deliveryFee, known: feeKnown } = computeDeliveryFeeForPrefix("rent", delivery.method);
  const itemLine = `${qty > 1 ? qty + "× " : ""}${productName} · ${fmtDate(start)} to ${fmtDate(end)}${itemTotal != null ? ` (${naira(itemTotal)})` : ""}`;
  const summaryHtml = orderSummaryConfirmHtml({
    itemLines: [itemLine],
    method: delivery.method,
    pickupLabel: "Pickup",
    deliveryFee, feeKnown, itemTotal,
  });
  if (!(await showConfirmDialog(summaryHtml, { title: "Confirm reservation", okLabel: "Reserve", html: true }))) return;

  const { data: orderId, error } = await sb.rpc("create_rental_order", {
    p_vendor_id: vendorId,
    p_product_id: productId,
    p_quantity: qty,
    p_start_date: start,
    p_end_date: end,
    p_delivery_method: delivery.method,
    p_delivery_address: delivery.address,
    p_delivery_phone: delivery.phone,
    p_buyer_lat: buyerLocation?.lat ?? null,
    p_buyer_lng: buyerLocation?.lng ?? null,
  });
  if (error) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); return; }
  await persistBuyerDeliveryLocation(orderId, delivery.method);
  navigate("orderDetail", { orderId });
}

function updateServiceTotalPreview(rate, unit) {
  const qty = parseInt(byId("buyQty").value) || 0;
  const el = byId("serviceTotalPreview");
  if (el) { el.textContent = `Total: ${naira(rate * qty)} (${qty} ${unit}${qty === 1 ? "" : "s"} × ${naira(rate)}/${unit})`; el.dataset.rawTotal = String(rate * qty); }
  refreshPriceBreakdown("buy");
}
function updateBuyTotalPreview(rate) {
  const vid = byId("selectedProductVariantId")?.value;
  const sv = vid ? (currentProductDetail?.variants || []).find((v) => String(v.id) === String(vid)) : null;
  if (sv && effectivePrice(sv) != null) rate = Number(effectivePrice(sv));
  const qty = parseInt(byId("buyQty").value) || 0;
  const el = byId("serviceTotalPreview");
  if (el) { el.textContent = `Total: ${naira(rate * qty)} (${qty} × ${naira(rate)})`; el.dataset.rawTotal = String(rate * qty); }
  refreshPriceBreakdown("buy");
}
function updateRentTotalPreview(rate, unit) {
  const start = byId("rentStart")?.value;
  const end = byId("rentEnd")?.value;
  const qty = parseInt(byId("rentQty")?.value) || 0;
  const el = byId("rentTotalPreview");
  if (!el) return;
  if (!start || !end) { el.textContent = "Pick your dates to see the total."; delete el.dataset.rawTotal; refreshPriceBreakdown("rent"); return; }
  const days = Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000) + 1);
  const units = unit === "week" ? Math.ceil(days / 7) : days;
  el.textContent = `Total: ${naira(rate * units * qty)} (${qty} × ${units} ${unit}${units === 1 ? "" : "s"} × ${naira(rate)}/${unit})`;
  el.dataset.rawTotal = String(rate * units * qty);
  refreshPriceBreakdown("rent");
}

function variantStock(v){const x=v?.quantity_available;if(x==null||x==='')return null;const n=Number(x);return Number.isFinite(n)&&n>=0?n:null;}
function variantStockLabel(v){const n=variantStock(v);return n==null?'Availability not provided':n.toLocaleString();}
function selectProductVariant(variantId, scrollGallery = true, syncGallery = true) {
  const variants = Array.isArray(currentProductDetail?.variants) ? currentProductDetail.variants : [];
  const variant = variants.find(v => String(v.id) === String(variantId));
  if (!variant) return;
  const hidden = byId("selectedProductVariantId");
  if (hidden) hidden.value = variant.id;
  document.querySelectorAll(".product-variant-choice").forEach(btn => {
    const selected = btn.getAttribute("onclick")?.includes(String(variant.id));
    btn.classList.toggle("active", !!selected);
    btn.setAttribute("aria-pressed", String(!!selected));
  });
  document.querySelectorAll(".product-gallery-variety[data-gallery-variety-id]").forEach(btn => {
    const selected = String(btn.dataset.galleryVarietyId) === String(variant.id);
    btn.classList.toggle("active", selected);
    btn.setAttribute("aria-pressed", String(selected));
  });
  const qty = parseInt(byId("buyQty")?.value || 1) || 1;
  const unit = Number(effectivePrice(variant) ?? variant.rental_rate ?? 0);
  const heroBody = byId("productPriceHeroBody"); if (heroBody && effectivePrice(variant) != null) heroBody.innerHTML = priceHeroInner(variant);
  const preview = byId("serviceTotalPreview");
  if (preview && unit > 0) { preview.textContent = `Total: ${naira(unit * qty)} (${qty} × ${naira(unit)})`; preview.dataset.rawTotal = String(unit * qty); }
  const nameEl = byId("selectedVariantName"), priceEl = byId("selectedVariantPrice"), descEl = byId("selectedVariantDescription");
  if (nameEl) nameEl.textContent = variant.name || "Selected variety";
  if (priceEl) priceEl.textContent = naira(unit);
  if (descEl) descEl.textContent = stripProductVariantMeta(variant.description || currentProductDetail?.description || "") || "No variety-specific description is stored.";
  const galleryNameEl = byId("productGalleryVariantName"), galleryPriceEl = byId("productGalleryVariantPrice");
  if (galleryNameEl) galleryNameEl.textContent = variant.name || "Selected variety";
  if (galleryPriceEl) galleryPriceEl.textContent = naira(unit);
  const stockEl=byId("selectedVariantStock"); if(stockEl) stockEl.textContent=variantStockLabel(variant);
  // Buyers are no longer capped to a variety's stock count -- see
  // create_sale_order's own comment for why.
  if (scrollGallery && variant.photo_url) {
    window.__productGalleryVarietyOverride = true;
    const galleryIndex = Number(currentProductDetail?.photos?.findIndex?.(u => String(u) === String(variant.photo_url)) ?? -1);
    if (galleryIndex >= 0) setProductGalleryPhoto(galleryIndex, false, syncGallery, true);
    const mainImg = document.querySelector("#productGalleryTrack .product-gallery-slide.active img") || document.querySelector("#productGalleryTrack .product-gallery-slide img");
    if (mainImg && galleryIndex < 0) mainImg.src = variant.photo_url;
    updateProductGalleryMainControl();
  }
}

async function persistBuyerDeliveryLocation(orderId, deliveryMethod) {
  if (deliveryMethod !== "delivery" || !orderId || !buyerLocation) return;
  try {
    const { error } = await sb.rpc("set_order_buyer_location", {
      p_order_id: orderId,
      p_lat: buyerLocation.lat,
      p_lng: buyerLocation.lng,
    });
    if (error) console.warn("[Levromart] Could not store buyer delivery location:", error);
  } catch (err) {
    console.warn("[Levromart] Could not store buyer delivery location:", err);
  }
}

async function buyNow(vendorId, productId) {
  if (!session) { showLogin(); return; }
  if (blockOwnVendorPurchase(vendorId, "buy")) return;
  if (!(await ensureCustomerProfile(byId("buyError")))) return;
  const qty = parseInt(byId("buyQty").value) || 1;
  const errorEl = byId("buyError");
  errorEl.classList.add("hidden");
  const delivery = readDeliveryFields("buy", errorEl);
  if (!delivery) return;

  const productName = currentProductDetail?.name || "this item";
  const verb = currentProductDetail?.is_service ? "Book" : "Buy";
  const selectedVariantId = byId("selectedProductVariantId")?.value || null;
  const selectedVariant = (currentProductDetail?.variants || []).find(v => String(v.id) === String(selectedVariantId));

  const previewEl = byId("serviceTotalPreview");
  const totalText = previewEl ? [...previewEl.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").replace(/^Total:\s*/, "").trim() : (currentProductDetail?.sale_price != null ? naira(effectivePrice(currentProductDetail) * qty) : "");
  const itemTotal = previewEl?.dataset.rawTotal != null ? Number(previewEl.dataset.rawTotal) : (currentProductDetail?.sale_price != null ? effectivePrice(currentProductDetail) * qty : null);
  const { fee: deliveryFee, known: feeKnown } = computeDeliveryFeeForPrefix("buy", delivery.method);
  const itemLine = `${qty > 1 && !previewEl ? qty + "× " : ""}${productName}${totalText ? ` · ${totalText}` : ""}`;
  const summaryHtml = orderSummaryConfirmHtml({
    itemLines: [itemLine],
    method: delivery.method,
    pickupLabel: currentProductDetail?.is_service ? "In-person" : "Pickup",
    deliveryFee, feeKnown, itemTotal,
  });
  if (!(await showConfirmDialog(summaryHtml, { title: `Confirm ${verb === "Book" ? "booking" : "purchase"}`, okLabel: `${verb} now`, html: true }))) return;

  const { data: orderId, error } = await sb.rpc("create_sale_order", {
    p_vendor_id: vendorId,
    p_product_id: productId,
    p_quantity: qty,
    p_delivery_method: delivery.method,
    p_delivery_address: delivery.address,
    p_delivery_phone: delivery.phone,
    p_buyer_note: byId("buyNote")?.value.trim() || null,
    p_buyer_lat: buyerLocation?.lat ?? null,
    p_variant_id: selectedVariant?.id || null,
    p_buyer_lng: buyerLocation?.lng ?? null,
  });
  if (error) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); return; }
  await persistBuyerDeliveryLocation(orderId, delivery.method);

  await navigate("orderDetail", { orderId });
}


/* ---- swipe the page background to move to the vendor's next / previous product ---- */
(function () {
  let t0 = null;
  const blocked = "input,textarea,select,button,a,label,.product-gallery-carousel,.product-gallery-track,.product-gallery-main,.product-gallery-thumbs,.product-gallery-varieties,.product-comments-panel,.lv-cmt-sheet,.modal,.drawer,[role=dialog],.horizontal-scroll,.carousel,.hscroll";
  const cache = new Map();
  async function siblings(vendorId) {
    if (cache.has(vendorId)) return cache.get(vendorId);
    const p = sb.from("products").select("id").eq("vendor_id", vendorId).eq("status", "active").order("created_at", { ascending: false }).limit(60)
      .then(({ data }) => (data || []).map((r) => String(r.id))).catch(() => []);
    cache.set(vendorId, p);
    return p;
  }
  async function step(dir) {
    const cur = currentProductDetail, vid = cur?.vendor?.id || cur?.vendor_id;
    if (!cur?.id || !vid || currentView !== "productDetail") return;
    const ids = await siblings(String(vid));
    const i = ids.indexOf(String(cur.id));
    if (i < 0 || ids.length < 2) { showToast("No other products from this vendor yet.", "info"); return; }
    const next = ids[(i + dir + ids.length) % ids.length];
    navigate("productDetail", { productId: next });
  }
  document.addEventListener("touchstart", (e) => {
    t0 = null;
    if (currentView !== "productDetail" || e.touches.length !== 1) return;
    if (e.target.closest?.(blocked)) return;
    if (!e.target.closest?.("#app")) return;
    t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!t0) return;
    const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y, dt = Date.now() - t0.t;
    t0 = null;
    if (Math.abs(dx) < 90 || Math.abs(dy) > 45 || Math.abs(dx) < Math.abs(dy) * 2.5 || dt > 700) return;
    step(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

/* the comment badge on the product page's top button only shows when there are comments */
(function () {
  const mark = () => document.querySelectorAll(".product-detail-card .lv-ccount").forEach((b) => { const z = !Number(b.textContent); if (z !== (b.dataset.zero === "1")) b.dataset.zero = z ? "1" : ""; });
  try { new MutationObserver(mark).observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (_) {}
})();
