/* ---- levromart-chat-viewport-stabilizer-20260910 ---- */
(function(){
  'use strict';
  var rafId = 0;
  function syncChatViewport(){
    var wrap = document.querySelector('.chat-page-wrap');
    if(!wrap || !document.body.classList.contains('chat-full-page')) return;
    var vv = window.visualViewport;
    if(!vv) return;
    var h = Math.max(280, Math.round(vv.height));
    var top = Math.max(0, Math.round(vv.offsetTop));
    wrap.style.setProperty('height', h + 'px', 'important');
    wrap.style.setProperty('max-height', h + 'px', 'important');
    wrap.style.setProperty('top', top + 'px', 'important');
    wrap.style.setProperty('bottom', 'auto', 'important');
  }
  function schedule(){
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(syncChatViewport);
  }
  window.__levromartSyncChatViewport = schedule;
  window.addEventListener('resize', schedule, {passive:true});
  window.addEventListener('orientationchange', function(){ setTimeout(schedule,120); }, {passive:true});
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', schedule, {passive:true});
    window.visualViewport.addEventListener('scroll', schedule, {passive:true});
  }
  var observer = new MutationObserver(schedule);
  observer.observe(document.body, {attributes:true, attributeFilter:['class']});
  document.addEventListener('focusin', function(e){
    if(e.target && (e.target.id === 'chatInput' || e.target.closest('.chat-page-wrap'))){ setTimeout(schedule,80); }
  }, true);
  document.addEventListener('focusout', function(){ setTimeout(schedule,80); }, true);
  setTimeout(schedule,0);
  setTimeout(schedule,120);
})();

/* ---- levromart-precision-20260910-final-runtime ---- */
(function(){
  'use strict';
  window.openHomeQuickAction = async function(action){
    try{
      if(action==='products' || action==='services'){
        homeListingTab = action==='services' ? 'services' : 'products';
        // When already on Home, do not route/re-render the page. Re-rendering
        // Home resets the carousel to slide 1 and can cause a visible flash.
        // The shortcut should simply select the catalogue and smoothly move
        // the user to it.
        if(currentView === 'home' && byId('browseSection')){
          switchHomeListingTab(homeListingTab);
          requestAnimationFrame(()=>byId('browseSection')?.scrollIntoView({behavior:'smooth',block:'start'}));
          return;
        }
        await navigate('home');
        requestAnimationFrame(()=>setTimeout(()=>{
          switchHomeListingTab(homeListingTab);
          byId('browseSection')?.scrollIntoView({behavior:'smooth',block:'start'});
        },40));
        return;
      }
      if(action==='rent'){
        // renderVendorsDirectory() now resets vendorsListingFilter to 'all'
        // on every visit -- set the pre-filter after navigating there,
        // not before, or the reset stomps it back to 'all' immediately.
        await navigate('vendors');
        if(typeof vendorsListingFilter!=='undefined') vendorsListingFilter='rent';
        return;
      }
      if(action==='vendors'){
        if(currentView === 'home' && byId('topRatedVendors')){
          byId('topRatedVendors')?.scrollIntoView({behavior:'smooth',block:'center'});
          return;
        }
        await navigate('home');
        requestAnimationFrame(()=>setTimeout(()=>byId('topRatedVendors')?.scrollIntoView({behavior:'smooth',block:'center'}),40));
        return;
      }
      if(action==='request'){ await navigate('requestEquipment'); return; }
      if(action==='chat'){ await navigate('messages'); return; }
    }catch(err){ console.warn('[Levromart] Quick action navigation failed:',err); }
  };

  /* The browser file picker may return several files. Levromart intentionally
     sends them through the editor ONE AT A TIME to keep caption/edit behavior
     deterministic on mobile. */
  window.handleChatFileSelected = function(evt, conversationId){
    const files=[...(evt?.target?.files||[])];
    if(evt?.target) evt.target.value='';
    if(!files.length) return;
    const first=files.find(f=>String(f.type||'').startsWith('image/') && f.size<=MAX_ATTACHMENT_BYTES);
    if(!first){ showToast('Choose one image up to 10MB.','error'); return; }
    if(files.length>1) showToast('Only one photo can be selected at a time.','info');
    bindChatImageEditorPointer();
    openChatAttachmentEditor(first,0,1,async function(result){
      if(!result) return;
      try{
        const input=byId('chatInput'); clearTimeout(typingStopTimer); publishChatTyping(false);
        const replyToId=chatReplyTarget?.id||null; const snap=chatReplyTarget?{...chatReplyTarget}:null;
        resetChatInput(input);
        const prepared=Array.isArray(result)?result[0]:result;
        if(!prepared) return;
        await sendPreparedChatImage(conversationId,prepared,replyToId,snap);
        chatReplyTarget=null; renderChatReplyPreview(); scrollChatToBottom();
        resolveVisibleAttachments(byId('chatMessages')); setupMessageInteractions(byId('chatMessages'));
        showToast('Photo sent.','success');
      }catch(err){showToast(err?.message||'Could not send the photo.','error');}
    });
  };

  /* Keep the final editor's crop interaction square and visibly bounded. */
  const oldTool=window.setChatImageEditorTool;
  window.setChatImageEditorTool=function(tool,btn){
    oldTool?.(tool,btn);
    const canvas=byId('chatAttachmentEditorCanvas');
    if(canvas) canvas.style.cursor=tool==='crop'?'crosshair':'default';
  };

  /* If the editor is opened by any older attachment trigger, normalize its
     chrome to the same single-photo presentation. */
  const normalizeEditor=()=>{
    const modal=byId('chatAttachmentEditorModal'); if(!modal)return;
    const title=modal.querySelector('.media-editor-title h3'); if(title) title.textContent='Edit photo';
    const use=modal.querySelector('.media-editor-actions .btn:not(.btn-outline)'); if(use) use.innerHTML='<i class="fa-solid fa-check"></i> Use photo';
  };
  const observer=new MutationObserver(()=>normalizeEditor());
  observer.observe(document.body,{subtree:true,childList:true});
  setTimeout(normalizeEditor,0);
})();

/* ---- levromart-20260910-final-bugfix-runtime ---- */
(function(){
  'use strict';

  /* Reviews: explicit open/closed state. This fixes the case where the arrow
     rotated but the review list remained visible (or vice versa). */
  window.toggleReviewsList=function(){
    const list=byId('reviewsList');
    const chevron=byId('reviewsChevron');
    if(!list) return;
    const collapsed=!list.classList.contains('reviews-collapsed');
    list.classList.toggle('reviews-collapsed',collapsed);
    list.classList.toggle('hidden',collapsed);
    if(chevron){
      chevron.style.transform=collapsed?'rotate(0deg)':'rotate(180deg)';
      chevron.setAttribute('aria-expanded',collapsed?'false':'true');
    }
  };

  /* Keep the review heading's initial state deterministic after a storefront
     rerender: expanded by default, with the arrow pointing down. */
  function normalizeReviewAccordion(){
    const list=byId('reviewsList'), chevron=byId('reviewsChevron');
    if(!list) return;
    if(!list.classList.contains('reviews-collapsed')) list.classList.remove('hidden');
    if(chevron){
      chevron.style.transform=list.classList.contains('reviews-collapsed')?'rotate(0deg)':'rotate(0deg)';
      chevron.setAttribute('aria-expanded',list.classList.contains('reviews-collapsed')?'false':'true');
    }
  }
  document.addEventListener('click',function(e){
    const head=e.target?.closest?.('.storefront-reviews-head');
    if(!head) return;
    /* The inline onclick calls the same function; this listener intentionally
       does nothing so we don't double-toggle. */
  },true);
  const reviewObserver=new MutationObserver(()=>{ if(byId('reviewsList')) setTimeout(normalizeReviewAccordion,0); });
  reviewObserver.observe(document.body,{subtree:true,childList:true});

  /* Single-photo attachment flow: do not invoke the heavyweight multi-image
     canvas editor on the file-picker path. This is deliberately conservative
     on mobile Safari: one image + one caption, then upload the original file.
     The existing crop/editor implementation remains in the file for other
     entry points, but it can no longer freeze the chat just from tapping clip. */
  let simpleAttachmentModal=null;
  function closeSimpleAttachment(){
    if(simpleAttachmentModal){simpleAttachmentModal.remove();simpleAttachmentModal=null;}
  }
  function openSimpleAttachment(file,conversationId){
    closeSimpleAttachment();
    const url=URL.createObjectURL(file);
    const modal=document.createElement('div');
    modal.className='modal';
    modal.style.cssText='display:flex;align-items:flex-end;justify-content:center;padding:0;z-index:1000;';
    modal.innerHTML=`<div class="modal-content" style="width:min(100%,620px);max-height:92vh;overflow:auto;border-radius:22px 22px 0 0;padding:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.8rem 1rem;border-bottom:1px solid var(--border);">
        <strong><i class="fa-solid fa-image"></i> Send photo</strong>
        <button type="button" class="icon-btn" aria-label="Close" data-simple-close><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div style="padding:.8rem;background:color-mix(in srgb,var(--text) 3%,var(--card));">
        <img src="${esc(url)}" alt="Selected photo" style="display:block;width:100%;max-height:55vh;object-fit:contain;border-radius:14px;background:#111;" />
      </div>
      <div style="padding:.7rem .85rem .9rem;">
        <label style="display:block;font-size:.75rem;font-weight:750;color:var(--text-muted);margin-bottom:.35rem;">Caption</label>
        <textarea id="simpleChatCaption" rows="2" maxlength="500" placeholder="Add a caption…" style="width:100%;resize:none;border-radius:12px;padding:.65rem .72rem;"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:.65rem;">
          <button type="button" class="btn btn-sm btn-outline" data-simple-cancel>Cancel</button>
          <button type="button" class="btn btn-sm" data-simple-send><i class="fa-solid fa-paper-plane"></i> Send photo</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(modal); simpleAttachmentModal=modal;
    const cleanup=()=>{URL.revokeObjectURL(url);closeSimpleAttachment();};
    modal.querySelector('[data-simple-close]')?.addEventListener('click',cleanup);
    modal.querySelector('[data-simple-cancel]')?.addEventListener('click',cleanup);
    modal.addEventListener('click',e=>{if(e.target===modal)cleanup();});
    modal.querySelector('[data-simple-send]')?.addEventListener('click',async()=>{
      const btn=modal.querySelector('[data-simple-send]'); if(!btn||btn.disabled)return;
      btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-circle-notch fa-spin"></i> Sending…';
      try{
        const input=byId('chatInput'); clearTimeout(typingStopTimer); publishChatTyping(false);
        const replyToId=chatReplyTarget?.id||null; const snap=chatReplyTarget?{...chatReplyTarget}:null;
        const caption=modal.querySelector('#simpleChatCaption')?.value?.trim()||'';
        resetChatInput(input);
        await sendPreparedChatImage(conversationId,{blob:file,caption,name:file.name,type:file.type||'image/jpeg'},replyToId,snap);
        chatReplyTarget=null; renderChatReplyPreview(); scrollChatToBottom();
        resolveVisibleAttachments(byId('chatMessages')); setupMessageInteractions(byId('chatMessages'));
        cleanup(); showToast('Photo sent.','success');
      }catch(err){
        btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Send photo';
        showToast(err?.message||'Could not send the photo.','error');
      }
    });
  }

  // A later "simplify" pass replaced the real multi-photo editor with a
  // single-photo-only shortcut, which silently became the active one and
  // quietly dropped that capability. Restore the grouped, array-based
  // version (crop/draw/highlight/rotate per photo, sent together as one
  // group) captured above -- it's the one that actually pairs with the
  // array-based window.openChatAttachmentEditor also defined earlier;
  // falling back to the older single-file handleChatFileSelected only if
  // that snapshot somehow wasn't captured.
  window.handleChatFileSelected = window.__handleChatFileSelectedGrouped || handleChatFileSelected;
  // Photo sending in chat is switched off: no attach button exists, and anything that still reaches this handler is ignored.
  window.handleChatFileSelected = function(evt){ try{ if(evt?.target) evt.target.value=''; }catch(_){} showToast('Sending photos in chat is not available.','info'); };

  /* If the page is genuinely offline, the banner remains valid. If it is
     online, remove any stale offline notice that may have been rendered by a
     previous transient failure. */
  function clearStaleOfflineNotice(){
    if(!navigator.onLine)return;
    document.querySelectorAll('.offline-browse-notice').forEach(el=>el.remove());
  }
  window.addEventListener('online',clearStaleOfflineNotice,{passive:true});
  setTimeout(clearStaleOfflineNotice,0);
})();

/* ---- levromart-filter-outside-close ---- */
(function(){
  "use strict";
  function closeBrowse(){
    const panel=document.getElementById("browseFilterPanel");
    const trigger=document.getElementById("browseFilterTrigger");
    if(!panel) return;
    panel.classList.add("hidden");
    trigger?.classList.remove("active");
    trigger?.setAttribute("aria-expanded","false");
    document.getElementById("browseListingSubmenu")?.classList.add("hidden");
    document.getElementById("browseCategorySubmenu")?.classList.add("hidden");
  }
  function closeVendors(){
    const panel=document.getElementById("vendorsFiltersPanel");
    const trigger=document.getElementById("vendorsFiltersToggle");
    if(!panel) return;
    panel.classList.add("hidden");
    trigger?.classList.remove("active");
    trigger?.setAttribute("aria-expanded","false");
  }
  function closeOrders(){
    document.querySelectorAll(".order-filters-wrap").forEach(w=>{
      const panel=w.querySelector(".order-filters-panel");
      const trigger=w.querySelector(".order-filters-trigger");
      panel?.classList.add("hidden");
      trigger?.classList.remove("active");
      trigger?.setAttribute("aria-expanded","false");
    });
  }
  document.addEventListener("pointerdown",function(e){
    const t=e.target;
    if(!t?.closest?.("#browseFilterPanel,#browseFilterTrigger")) closeBrowse();
    if(!t?.closest?.("#vendorsFiltersPanel,#vendorsFiltersToggle")) closeVendors();
    if(!t?.closest?.(".order-filters-panel,.order-filters-trigger")) closeOrders();
  },true);
  window.closeLevromartTransientFilters=function(){ closeBrowse(); closeVendors(); closeOrders(); };
})();

/* ---- levromart-levi-smart-experience ---- */
/* LEVI EXPERIENCE EXTENSION, search intelligence, permission coaching,
   compose suggestions and continuous FAB presence. This block only touches
   Levi/search-related UI; it does not alter marketplace rendering. */
(() => {
  const root = document.documentElement;
  const normalize = (v) => String(v || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  const synonymMap = {
    food:["foodstuff","groceries","grocery","rice","pasta","spaghetti","penne","macaroni","snacks","candy"],
    spaghetti:["pasta","penne","macaroni","noodles"],
    ice:["ice cream","icecream","frozen dessert","dessert","candy","sweet","yogurt"],
    "ice cream":["icecream","frozen dessert","dessert","candy","sweet","yogurt"],
    shoe:["shoes","footwear","sneaker","sneakers","slipper","sandals","boots"],
    shoes:["shoe","footwear","sneaker","sneakers","slipper","sandals","boots"],
    watch:["wristwatch","smartwatch","smart watch","timepiece"],
    jewelry:["jewellery","ring","necklace","bracelet","earrings","chain"],
    jewellery:["jewelry","ring","necklace","bracelet","earrings","chain"],
    clothes:["clothing","fashion","shirt","dress","trousers","jeans","jacket"],
    medical:["healthcare","health","hospital","clinical","medical equipment","diagnostic"],
    laptop:["computer","notebook","macbook","pc"],
    phone:["smartphone","mobile","iphone","android","telephone"],
    computer:["laptop","desktop","pc","macbook","notebook"],
    bag:["bags","handbag","backpack","purse","school bag"],
    furniture:["chair","chairs","table","desk","sofa","bed","wardrobe"],
    beauty:["cosmetics","makeup","skincare","hair","wig","perfume"],
    fitness:["gym","workout","sports","exercise","weights"],
    electronics:["gadgets","device","devices","charger","earbuds","headphones"],
    medicine:["medication","pharmacy","drug","drugs","medical equipment"],
    kitchen:["cookware","utensils","blender","pot","pan","plates"],
    drink:["drinks","beverage","beverages","juice","water","soda"],
    stationery:["books","pen","pens","notebook","school supplies"],
    jewelry:["jewellery","ring","rings","necklace","bracelet","earrings","watch","chain"]
  };
  const termsFor = (q) => {
    const n = normalize(q), out = new Set([n]);
    Object.entries(synonymMap).forEach(([k, vals]) => {
      if (n === k || n.includes(k) || vals.some(v => n.includes(v))) {
        out.add(k); vals.forEach(v => out.add(v));
      }
    });
    return [...out].filter(Boolean);
  };
  const score = (p, q) => {
    const terms = termsFor(q);
    const text = normalize([
      p.name, p.description, p.category?.name, p.category_name, p.sector?.name,
      p.sector_name, p.vendor?.business_name
    ].filter(Boolean).join(" "));
    let s = text.includes(normalize(q)) ? 30 : 0;
    for (const t of terms) if (text.includes(normalize(t))) s += t === normalize(q) ? 12 : 4;
    return s;
  };

  async function catalogue() {
    const local = Array.isArray(window.__homeBrowseCatalog) && window.__homeBrowseCatalog.length
      ? window.__homeBrowseCatalog
      : (typeof getOfflineHomeCache === "function" ? (getOfflineHomeCache()?.browseProducts || []) : []);
    if (local.length) return local;
    try {
      const { data } = await sb.from("products")
        .select("id,name,description,photos,sale_price,discount_price,rental_rate,quantity_available,status,is_service,category_id,vendor:vendors!inner(id,business_name,verification_status,is_active),category:categories(id,name,sector_id)")
        .eq("status", "active").eq("vendor.verification_status", "verified").eq("vendor.is_active", true).limit(350);
      return data || [];
    } catch (_) { return []; }
  }

  function ensureMenu(input) {
    if (!input) return null;
    let parent = input.parentElement;
    if (!parent) return null;
    parent.classList.add("levi-smart-search-host");
    let menu = parent.querySelector(".levi-smart-search-menu");
    if (!menu) {
      menu = document.createElement("div");
      menu.className = "levi-smart-search-menu hidden";
      parent.appendChild(menu);
    }
    return menu;
  }
  function hideMenu(input) { ensureMenu(input)?.classList.add("hidden"); }

  async function showRecommendations(input, raw) {
    const q = String(raw || "").trim();
    const menu = ensureMenu(input);
    if (!menu) return;
    if (!q || q.length < 2) { menu.classList.add("hidden"); return; }
    const requestId = String(Date.now()) + Math.random();
    input.dataset.leviSuggestRequest = requestId;
    const rows = await catalogue();
    const [packageRes, vendorRes] = await Promise.all([
      sb.from("vendor_packages").select("id,name,price,vendor:vendors!inner(id,business_name,verification_status,is_active)").eq("status","active").eq("vendor.verification_status","verified").eq("vendor.is_active",true).or(`name.ilike.%${q}%,description.ilike.%${q}%`).limit(5),
      sb.from("vendors").select("id,business_name,city,avg_rating,review_count").eq("verification_status","verified").eq("is_active",true).ilike("business_name",`%${q}%`).limit(4)
    ]);
    if (input.dataset.leviSuggestRequest !== requestId || String(input.value || "").trim() !== q) return;
    const packageMatches=packageRes.data||[];
    const vendorMatches=vendorRes.data||[];
    const matches = rows.map(p => ({ p, score: score(p, q) }))
      .filter(x => x.score > 0 && Number(x.p?.quantity_available ?? 1) > 0)
      .sort((a,b) => b.score - a.score)
      .slice(0, 6)
      .map(x => x.p);

    const categories = Array.isArray(window.__categories) ? window.__categories : [];
    const catMatches = categories.filter(c => termsFor(q).some(t => normalize(c.name).includes(normalize(t)) || normalize(t).includes(normalize(c.name)))).slice(0, 3);
    const sectors = Array.isArray(window.sectors) ? window.sectors : [];
    const sectorMatches = sectors.filter(s => termsFor(q).some(t => normalize(s.name).includes(normalize(t)) || normalize(t).includes(normalize(s.name)))).slice(0, 2);

    const seen = new Set();
    const items = [];
    matches.forEach(p => {
      if (seen.has(p.id)) return; seen.add(p.id);
      items.push(`<button type="button" class="levi-smart-search-item" data-product-id="${esc(p.id)}"><i class="fa-solid fa-box"></i><span><strong>${esc(p.name)}</strong><small>${esc(p.vendor?.business_name || "Levromart listing")}${p.category?.name ? ` · ${esc(p.category.name)}` : ""}</small></span></button>`);
    });
    packageMatches.forEach(pkg => items.push(`<button type="button" class="levi-smart-search-item" data-package-id="${esc(pkg.id)}"><i class="fa-solid fa-box-open"></i><span><strong>${esc(pkg.name)}</strong><small>Package · ${esc(pkg.vendor?.business_name||"Vendor")}${pkg.price!=null?` · ${naira(pkg.price)}`:""}</small></span></button>`));
    vendorMatches.forEach(v => items.push(`<button type="button" class="levi-smart-search-item" data-vendor-id="${esc(v.id)}"><i class="fa-solid fa-store"></i><span><strong>${esc(v.business_name)}</strong><small>Vendor${v.city?` · ${esc(v.city)}`:""}${v.avg_rating!=null?` · ${Number(v.avg_rating).toFixed(1)}★`:""}</small></span></button>`));
    catMatches.forEach(c => items.push(`<button type="button" class="levi-smart-search-item levi-smart-search-category" data-category-id="${esc(c.id)}"><i class="fa-solid fa-layer-group"></i><span><strong>${esc(c.name)}</strong><small>Category · show related listings</small></span></button>`));
    sectorMatches.forEach(s => items.push(`<button type="button" class="levi-smart-search-item levi-smart-search-category" data-sector-id="${esc(s.id)}"><i class="fa-solid fa-grip"></i><span><strong>${esc(s.name)}</strong><small>Sector · explore related listings</small></span></button>`));

    const related = termsFor(q).filter(t => normalize(t) !== normalize(q)).slice(0, 3);
    related.forEach(t => items.push(`<button type="button" class="levi-smart-search-item levi-smart-search-related" data-related="${esc(t)}"><i class="fa-solid fa-wand-magic-sparkles"></i><span><strong>${esc(t)}</strong><small>Related to “${esc(q)}”</small></span></button>`));

    if (!items.length) { menu.classList.add("hidden"); return; }
    menu.innerHTML = `<div class="levi-smart-search-heading"><i class="fa-solid fa-star"></i> Smart suggestions</div>${items.slice(0,9).join("")}`;
    menu.classList.remove("hidden");
    menu.querySelectorAll("[data-product-id]").forEach(btn => btn.addEventListener("mousedown", e => { e.preventDefault(); navigate("productDetail", { productId: btn.dataset.productId }); hideMenu(input); }));
    menu.querySelectorAll("[data-package-id]").forEach(btn => btn.addEventListener("mousedown", e => { e.preventDefault(); navigate("packageDetail", { packageId: btn.dataset.packageId }); hideMenu(input); }));
    menu.querySelectorAll("[data-vendor-id]").forEach(btn => btn.addEventListener("mousedown", e => { e.preventDefault(); navigate("storefront", { vendorId: btn.dataset.vendorId }); hideMenu(input); }));
    menu.querySelectorAll("[data-category-id]").forEach(btn => btn.addEventListener("mousedown", e => {
      e.preventDefault();
      const sel = byId("filterCategory"); if (sel) { sel.value = btn.dataset.categoryId; syncBrowseFilterLabels?.(); filterHomeProducts?.(); }
      byId("browseSection")?.scrollIntoView({ behavior:"smooth", block:"start" });
      hideMenu(input);
    }));
    menu.querySelectorAll("[data-sector-id]").forEach(btn => btn.addEventListener("mousedown", e => {
      e.preventDefault();
      if (typeof currentSectorId !== "undefined") currentSectorId = btn.dataset.sectorId;
      if (typeof navigate === "function") navigate("home");
      hideMenu(input);
    }));
    menu.querySelectorAll("[data-related]").forEach(btn => btn.addEventListener("mousedown", e => {
      e.preventDefault();
      input.value = btn.dataset.related;
      input.dispatchEvent(new Event("input", { bubbles:true }));
      input.focus();
    }));
  }

  let smartTimer = null;
  document.addEventListener("input", e => {
    const input = e.target?.closest?.("#heroSearch,#searchInput");
    if (!input) return;
    clearTimeout(smartTimer);
    smartTimer = setTimeout(() => showRecommendations(input, input.value), 180);
  }, true);
  document.addEventListener("focusin", e => {
    const input = e.target?.closest?.("#heroSearch,#searchInput");
    if (input && input.value.trim()) showRecommendations(input, input.value);
  }, true);
  document.addEventListener("mousedown", e => {
    if (!e.target?.closest?.(".levi-smart-search-host")) document.querySelectorAll(".levi-smart-search-menu").forEach(m => m.classList.add("hidden"));
  }, true);

  // If Levi's existing deterministic search truly has no result, go directly
  // to Request an item instead of leaving the user at a dead end. We keep the
  // existing suggestion path when there are plausible alternatives.
  const originalSuggestionFn = window.resolveLeviProductSuggestions;
  if (typeof originalSuggestionFn === "function" && !window.__leviSmartSuggestionWrapper) {
    window.__leviSmartSuggestionWrapper = true;
    window.resolveLeviProductSuggestions = async function(target) {
      const rows = await catalogue();
      const matches = rows.map(p => ({p, score:score(p,target)})).filter(x => x.score > 0).sort((a,b)=>b.score-a.score).slice(0,6).map(x=>x.p);
      if (matches.length) return matches;
      try { return await originalSuggestionFn(target); } catch (_) { return []; }
    };
  }

  // Levi is allowed to be playful, but the FAB must remain reliable. A tiny
  // idle animation makes it feel alive without covering content or moving it.
  let idleTimer = null;
  function leviIdleNudge() {
    const fab = byId("aiChatFab");
    if (!fab || fab.classList.contains("hidden") || byId("aiChatPanel") && !byId("aiChatPanel").classList.contains("hidden")) return;
    fab.classList.remove("levi-idle-nudge");
    void fab.offsetWidth;
    fab.classList.add("levi-idle-nudge");
    setTimeout(() => fab.classList.remove("levi-idle-nudge"), 950);
  }
  function scheduleLeviIdleNudge() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { leviIdleNudge(); scheduleLeviIdleNudge(); }, 45_000);
  }
  scheduleLeviIdleNudge();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { scheduleLeviIdleNudge(); try { syncLeviFabVisibility(); } catch (_) {} } });

  // Permission coaching: the browser owns permission itself; Levi only keeps
  // the in-app reminder alive. A denied permission cannot be re-prompted by a
  // web app, so the reminder points the user to Settings instead of spamming
  // the native permission dialog.
  let permissionReminderTimer = null;
  let lastPermissionReminder = 0;
  async function leviPermissionReminder(force = false) {
    if (!session) return;
    // Once the user has dismissed this nudge (or a notification/location
    // modal) once, it should not keep coming back. This used to be "enforced"
    // by patching window.leviPermissionReminder from another script, but that
    // function is only ever reachable as this local closure binding -- the
    // patch silently never took effect, so the nudge kept firing every few
    // minutes forever regardless of dismissal. Check the same flag directly.
    try { if (localStorage.getItem("levromart-permission-nudge-seen-v2") === "1") return; } catch (_) {}
    if (Date.now() - lastPermissionReminder < 4 * 60 * 1000 && !force) return;
    const notifState = (typeof Notification !== "undefined") ? Notification.permission : "unsupported";
    let locationState = "unknown";
    try { if (typeof getBrowserLocationPermission === "function") locationState = await getBrowserLocationPermission(); } catch (_) {}
    const needsNotif = pushSupported?.() && notifState !== "granted";
    const needsLocation = navigator.geolocation && locationState !== "granted" && locationSharingEnabled !== false;
    if (!needsNotif && !needsLocation) return;
    const existing = byId("leviPermissionNudge");
    if (existing) return;
    lastPermissionReminder = Date.now();
    const modal = document.createElement("div");
    modal.id = "leviPermissionNudge";
    modal.className = "levi-permission-nudge";
    const title = needsNotif && needsLocation ? "Turn on Levromart permissions" : needsNotif ? "Turn on notifications" : "Turn on location";
    const body = needsNotif && needsLocation
      ? "Notifications keep orders and messages timely, while location lets Levi find nearby vendors and calculate distances."
      : needsNotif
        ? "Turn on notifications so Levromart can keep you updated about orders, messages and important activity."
        : "Turn on location so Levi can find the closest vendors and show accurate distances."
    modal.innerHTML = `<div class="levi-permission-nudge-card"><div class="levi-permission-nudge-icon"><i class="fa-solid ${needsLocation ? "fa-location-dot" : "fa-bell"}"></i></div><div class="levi-permission-nudge-copy"><strong>${title}</strong><span>${body}</span></div><button type="button" class="levi-permission-nudge-close" aria-label="Dismiss">×</button><button type="button" class="levi-permission-nudge-action">Turn on</button></div>`;
    document.body.appendChild(modal);
    modal.querySelector(".levi-permission-nudge-close")?.addEventListener("click", () => modal.remove());
    modal.querySelector(".levi-permission-nudge-action")?.addEventListener("click", async () => {
      modal.remove();
      try {
        if (needsLocation && typeof showLocationPrompt === "function") { showLocationPrompt(locationState === "denied" ? "recovery" : "first-use"); return; }
        if (needsNotif) {
          if (notifState === "denied") {
            navigate("settings");
            setTimeout(() => showToast("Notifications are blocked for Levromart. Open your browser/site settings and allow them, then return here." , "info"), 120);
          } else if (typeof maybeShowNotifPrompt === "function") {
            maybeShowNotifPrompt();
          }
          return;
        }
      } catch (_) {}
    });
  }
  function schedulePermissionReminder() {
    clearTimeout(permissionReminderTimer);
    permissionReminderTimer = setTimeout(async () => {
      await leviPermissionReminder();
      schedulePermissionReminder();
    }, 6 * 60 * 60 * 1000);
  }
  setTimeout(() => { leviPermissionReminder(true).catch(() => {}); schedulePermissionReminder(); }, 12_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) leviPermissionReminder().catch(() => {}); });

  // Contextual message-compose suggestions. This is intentionally opt-in at
  // the UI level: suggestions appear above the compose box and are never sent
  // automatically. The backend has a dedicated lightweight suggestion mode.
  let composeTimer = null;
  let composeRequest = 0;
  async function loadComposeSuggestions() {
    const input = byId("chatInput");
    if (!input || !session) return;
    const bubbles = [...document.querySelectorAll("#chatMessages .chat-bubble")].slice(-8);
    if (!bubbles.length) return;
    const text = bubbles.map(b => `${b.classList.contains("mine") ? "Me" : "Them"}: ${normalize(b.textContent || "")}`).join("\n");
    if (!text || text.length < 3) return;
    const id = ++composeRequest;
    try {
      const response = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"}, cache:"no-store",
        body:JSON.stringify({ mode:"message_suggestions", accessToken:session.access_token, messages:[{role:"user",content:text}] })
      });
      const data = await response.json();
      if (id !== composeRequest || !response.ok || !Array.isArray(data.suggestions)) return;
      let wrap = document.getElementById("leviComposeSuggestions");
      if (!wrap) {
        wrap = document.createElement("div"); wrap.id = "leviComposeSuggestions";
        input.parentElement?.parentElement?.insertBefore(wrap, input.parentElement);
      }
      wrap.innerHTML = data.suggestions.slice(0,3).map(s => `<button type="button" class="levi-compose-chip">${esc(s)}</button>`).join("");
      wrap.querySelectorAll(".levi-compose-chip").forEach(btn => btn.addEventListener("click", () => { input.value = btn.textContent || ""; input.dispatchEvent(new Event("input", {bubbles:true})); input.focus(); }));
    } catch (_) {}
  }
  document.addEventListener("input", e => {
    if (e.target?.id !== "chatInput") return;
    clearTimeout(composeTimer); composeTimer = setTimeout(loadComposeSuggestions, 550);
  }, true);

  const style = document.createElement("style");
  style.id = "levi-smart-experience-style";
  style.textContent = `
    .levi-smart-search-host{position:relative !important;z-index:250 !important;}
    .levi-smart-search-menu{position:absolute;left:0;right:0;top:calc(100% + .35rem);max-height:22rem;overflow:auto;background:var(--card,#fff);border:1px solid color-mix(in srgb,#3fb97f 30%,var(--border,#ddd));border-radius:16px;box-shadow:0 16px 38px rgba(0,0,0,.16);padding:.35rem;z-index:9999;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);}
    .levi-smart-search-heading{font-size:.68rem;font-weight:800;color:#0A5C40;padding:.45rem .55rem;display:flex;gap:.4rem;align-items:center;}
    .levi-smart-search-item{width:100%;border:0;background:transparent;color:var(--text);display:flex;align-items:center;gap:.65rem;padding:.65rem .6rem;border-radius:12px;text-align:left;cursor:pointer;font:inherit;}
    .levi-smart-search-item:hover,.levi-smart-search-item:focus-visible{background:color-mix(in srgb,#3fb97f 10%,transparent);outline:none;}
    .levi-smart-search-item>i{width:1.25rem;text-align:center;color:#3fb97f;}
    .levi-smart-search-item span{display:flex;min-width:0;flex-direction:column;gap:.08rem;}
    .levi-smart-search-item strong{font-size:.78rem;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .levi-smart-search-item small{font-size:.62rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .levi-idle-nudge{animation:leviIdleNudge .95s cubic-bezier(.34,1.56,.64,1);}
    @keyframes leviIdleNudge{0%,100%{transform:translateY(0) rotate(0)}25%{transform:translateY(-7px) rotate(-3deg)}50%{transform:translateY(2px) rotate(2deg)}75%{transform:translateY(-4px) rotate(-1deg)}}
    .levi-permission-nudge{position:fixed;left:1rem;right:1rem;bottom:calc(6.4rem + env(safe-area-inset-bottom,0px));z-index:9997;display:flex;justify-content:center;pointer-events:none;}
    .levi-permission-nudge-card{pointer-events:auto;width:min(100%,520px);display:grid;grid-template-columns:auto 1fr auto;gap:.7rem;align-items:center;padding:.8rem;border:1px solid color-mix(in srgb,#3fb97f 28%,var(--border,#ddd));border-radius:18px;background:color-mix(in srgb,var(--card,#fff) 92%,#3fb97f 8%);box-shadow:0 14px 36px rgba(0,0,0,.18);backdrop-filter:blur(18px);}
    .levi-permission-nudge-icon{width:2.4rem;height:2.4rem;border-radius:50%;display:grid;place-items:center;background:#3fb97f;color:#fff;}
    .levi-permission-nudge-copy{display:flex;flex-direction:column;gap:.15rem;min-width:0;}
    .levi-permission-nudge-copy strong{font-size:.78rem;}.levi-permission-nudge-copy span{font-size:.66rem;color:var(--text-muted);line-height:1.35;}
    .levi-permission-nudge-action{border:0;border-radius:999px;background:#3fb97f;color:#fff;padding:.58rem .82rem;font:700 .7rem inherit;white-space:nowrap;cursor:pointer;}
    .levi-permission-nudge-close{border:0;background:transparent;color:var(--text-muted);font-size:1.15rem;cursor:pointer;grid-column:3;grid-row:1;align-self:start;}
    #leviComposeSuggestions{display:flex;gap:.4rem;overflow:auto;padding:.35rem .1rem;scrollbar-width:none;}
    #leviComposeSuggestions::-webkit-scrollbar{display:none;}
    .levi-compose-chip{flex:0 0 auto;border:1px solid color-mix(in srgb,#3fb97f 28%,var(--border,#ddd));background:color-mix(in srgb,#3fb97f 7%,var(--card,#fff));color:var(--text);border-radius:999px;padding:.42rem .68rem;font:600 .66rem inherit;cursor:pointer;}
    .levi-compose-chip:hover{background:color-mix(in srgb,#3fb97f 13%,var(--card,#fff));}
    @media(max-width:520px){.levi-permission-nudge{left:.65rem;right:.65rem}.levi-permission-nudge-card{grid-template-columns:auto 1fr auto}.levi-permission-nudge-copy span{font-size:.61rem}.levi-permission-nudge-action{padding:.5rem .65rem}}
  `;
  document.head.appendChild(style);
})();

/* ---- levromart-launch-final-ux-v4-js ---- */
(function(){
  "use strict";
  function closeSearchBeforeSheet(){
    try{ window.closeLevromartHeaderSearch?.(); }catch(_){}
    document.querySelectorAll('.levro-compact-search-wrap.open,.order-search-wrap.open').forEach(el=>{
      el.classList.remove('open');
      const input=el.querySelector('input');
      if(input) input.blur();
    });
    if(!document.querySelector('input:focus,textarea:focus')) document.body.classList.remove('search-input-active');
  }
  function wireSheetTriggers(){
    document.querySelectorAll('[onclick*="toggleProfilePanel"],[onclick*="toggleNotifPanel"],[onclick*="toggleSettingsPanel"]').forEach(btn=>{
      if(btn.dataset.levroSheetGuard==='1') return;
      btn.dataset.levroSheetGuard='1';
      btn.addEventListener('click',closeSearchBeforeSheet,true);
    });
  }
  function enforceStack(){
    wireSheetTriggers();
    ['profilePanel','notifPanel','settingsPanel'].forEach(id=>{
      const el=document.getElementById(id); if(!el)return;
      el.style.setProperty('z-index','100000','important');
      el.style.setProperty('position','fixed','important');
    });
    const dock=document.getElementById('levromartHeaderSearchDock');
    if(dock) dock.style.setProperty('z-index','90000','important');
  }
  const mo=new MutationObserver(enforceStack);
  mo.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
  enforceStack();

  // Ensure every compact search field has a clean close path and its search
  // query is saved when the user commits it.
  document.addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    const input=e.target?.closest?.('#searchInput,#vendorSearchInput,#orderHistorySearch');
    if(input && input.value.trim()){
      try{
        const key='levromart-search-history-v1';
        const old=JSON.parse(localStorage.getItem(key)||'[]');
        const q=input.value.trim();
        localStorage.setItem(key,JSON.stringify([q,...(Array.isArray(old)?old:[]).filter(x=>String(x).toLowerCase()!==q.toLowerCase())].slice(0,8)));
      }catch(_){}
    }
  },true);
})();

/* ---- levromart-final-source-of-truth-ux ---- */
(function(){
  "use strict";
  const HISTORY_KEY = "levromart-search-history-v1";
  const MAX_HISTORY = 5;
  let searchTimer = 0;
  let searchSeq = 0;

  const byId = id => document.getElementById(id);
  const escText = value => {
    if (typeof window.esc === "function") return window.esc(value);
    return String(value ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  };
  const LEGACY_HISTORY_KEYS = ["levromart_recent_searches","recentSearches","levromartSearchHistory"];
  const normaliseHistory = list => {
    const seen = new Set(), out = [];
    for (const raw of (Array.isArray(list) ? list : [])) {
      const q = String(raw ?? "").trim(); if(!q) continue;
      const k=q.toLowerCase(); if(seen.has(k)) continue; seen.add(k); out.push(q);
      if(out.length>=MAX_HISTORY) break;
    }
    return out;
  };
  const readHistory = () => {
    try {
      const current=JSON.parse(localStorage.getItem(HISTORY_KEY)||"null");
      if(Array.isArray(current)) return normaliseHistory(current);
      for(const key of LEGACY_HISTORY_KEYS){
        const raw=localStorage.getItem(key); if(!raw) continue;
        try{const migrated=normaliseHistory(JSON.parse(raw)); if(migrated.length)localStorage.setItem(HISTORY_KEY,JSON.stringify(migrated)); return migrated;}catch(_){ }
      }
    } catch(_) { }
    return [];
  };
  const notifyHistoryChanged=()=>window.dispatchEvent(new CustomEvent("levromart:search-history-changed"));
  const saveHistory = value => {
    const q=String(value||"").trim(); if(!q)return;
    try{localStorage.setItem(HISTORY_KEY,JSON.stringify(normaliseHistory([q,...readHistory()])));}catch(_){ }
    notifyHistoryChanged(); return q;
  };
  const removeHistory = value => {
    const q=String(value||"").trim().toLowerCase();
    try{localStorage.setItem(HISTORY_KEY,JSON.stringify(readHistory().filter(x=>x.toLowerCase()!==q)));}catch(_){ }
    notifyHistoryChanged();
  };
  const clearHistory = () => { try{localStorage.removeItem(HISTORY_KEY);}catch(_){ } notifyHistoryChanged(); };

  function historyMarkup(onUse){
    const history = readHistory();
    const recent = history.length ? `
      <section class="levro-search-section">
        <div class="levro-search-section-head"><strong>Recent searches</strong><button type="button" class="levro-search-clear-all">Clear all</button></div>
        <div class="levro-search-history-list">
          ${history.map(q => `<div class="levro-search-history-row">
            <button type="button" class="levro-search-history-use" data-q="${escText(q).replace(/"/g,'&quot;')}"><i class="fa-solid fa-clock-rotate-left"></i><span>${escText(q)}</span></button>
            <button type="button" class="levro-search-history-remove" data-q="${escText(q).replace(/"/g,'&quot;')}" aria-label="Remove ${escText(q)} from search history"><i class="fa-solid fa-xmark"></i></button>
          </div>`).join("")}
        </div>
      </section>` : `<section class="levro-search-section levro-search-empty-history"><strong>Recent searches</strong><p>Searches you make will appear here.</p></section>`;

    const sectors = (typeof window.sectors !== "undefined" && Array.isArray(window.sectors) ? window.sectors : (typeof sectors !== "undefined" && Array.isArray(sectors) ? sectors : [])).filter(Boolean).slice(0,6);
    const recs = [
      ["products","Shop products","fa-box"],
      ["services","Find a service","fa-hand-holding-heart"],
      ["vendors","Explore vendors","fa-store"],
      ["packages","Browse packages","fa-box-open"]
    ];
    const chips = recs.map(([action,label,icon]) => `<button type="button" class="levro-search-recommendation" data-recommend="${action}"><i class="fa-solid ${icon}"></i>${label}</button>`).join("") + sectors.map(s => `<button type="button" class="levro-search-recommendation" data-sector="${escText(s.name)}"><i class="fa-solid fa-layer-group"></i>${escText(s.name)}</button>`).join("");
    return recent + `<section class="levro-search-section"><div class="levro-search-section-head"><strong>Recommended</strong></div><div class="levro-search-recommendations">${chips}</div></section>`;
  }

  function makeSearchPanel(){
    let backdrop = byId("levromartHeaderSearchBackdrop");
    if(!backdrop){
      backdrop = document.createElement("div");
      backdrop.id = "levromartHeaderSearchBackdrop";
      backdrop.setAttribute("aria-hidden","true");
      document.body.appendChild(backdrop);
    }
    let dock = byId("levromartHeaderSearchDock");
    if(!dock){
      dock = document.createElement("div");
      dock.id = "levromartHeaderSearchDock";
      dock.innerHTML = `<div class="header-search-space" role="dialog" aria-label="Search Levromart">
        <div class="header-search-bar"><i class="fa-solid fa-magnifying-glass"></i><input id="levromartHeaderSearchInput" type="search" autocomplete="off" placeholder="Search products, services, vendors…" aria-label="Search Levromart" /><button type="button" class="header-search-close" id="levromartHeaderSearchClose" aria-label="Close search"><i class="fa-solid fa-xmark"></i></button></div>
        <div id="levromartHeaderSearchSuggest" class="header-search-content"></div>
      </div>`;
      document.body.appendChild(dock);
    }
    return {backdrop,dock,input:byId("levromartHeaderSearchInput"),content:byId("levromartHeaderSearchSuggest")};
  }

  async function smartResults(q){
    q=String(q||"").trim();
    if(!q || typeof sb === "undefined") return "";
    try{
      const t=q.toLowerCase().replace(/\s+/g," ");
      const [ids,vendors,packages,cats,sectors] = await Promise.all([
        sb.rpc("search_product_ids",{p_query:t}),
        sb.from("vendors").select("id,business_name,city").eq("verification_status","verified").eq("is_active",true).ilike("business_name",`%${t}%`).limit(4),
        sb.from("vendor_packages").select("id,name,price,vendor:vendors!inner(id,business_name,verification_status,is_active)").eq("status","active").eq("vendor.verification_status","verified").eq("vendor.is_active",true).or(`name.ilike.%${t}%,description.ilike.%${t}%`).limit(4),
        sb.from("categories").select("id,name").ilike("name",`%${t}%`).limit(4),
        sb.from("sectors").select("id,name").ilike("name",`%${t}%`).limit(4)
      ]);
      const idList=(ids.data||[]).slice(0,6).map(x=>x.id).filter(Boolean);
      let products=[];
      if(idList.length){
        const r=await sb.from("products").select("id,name,is_service,vendor:vendors!inner(business_name,verification_status,is_active)").eq("status","active").eq("vendor.verification_status","verified").eq("vendor.is_active",true).in("id",idList);
        products=(r.data||[]).sort((a,b)=>idList.indexOf(a.id)-idList.indexOf(b.id));
      }
      const rows=[
        ...products.map(p=>`<button type="button" class="levro-smart-result" data-action="product" data-id="${escText(p.id)}"><i class="fa-solid ${p.is_service?'fa-hand-holding-heart':'fa-box'}"></i><span><strong>${escText(p.name)}</strong><small>${escText(p.vendor?.business_name||"Listing")}</small></span></button>`),
        ...(packages.data||[]).map(p=>`<button type="button" class="levro-smart-result" data-action="package" data-id="${escText(p.id)}"><i class="fa-solid fa-box-open"></i><span><strong>${escText(p.name)}</strong><small>Package · ₦${Number(p.price||0).toLocaleString()}</small></span></button>`),
        ...(vendors.data||[]).map(v=>`<button type="button" class="levro-smart-result" data-action="vendor" data-id="${escText(v.id)}"><i class="fa-solid fa-store"></i><span><strong>${escText(v.business_name)}</strong><small>Vendor · ${escText(v.city||"")}</small></span></button>`),
        ...(cats.data||[]).map(c=>`<button type="button" class="levro-smart-result" data-action="category" data-id="${escText(c.id)}"><i class="fa-solid fa-tags"></i><span><strong>${escText(c.name)}</strong><small>Category</small></span></button>`),
        ...(sectors.data||[]).map(s=>`<button type="button" class="levro-smart-result" data-action="sector" data-id="${escText(s.id)}"><i class="fa-solid fa-layer-group"></i><span><strong>${escText(s.name)}</strong><small>Sector</small></span></button>`)
      ];
      return rows.slice(0,12).join("") || `<div class="levro-search-no-results">No matching listings yet. Press Enter to search the marketplace.</div>`;
    }catch(e){ return `<div class="levro-search-no-results">Press Enter to search the marketplace.</div>`; }
  }

  function routeSearch(q){
    q=String(q||"").trim(); if(!q)return;
    saveHistory(q);
    const browse=byId("searchInput");
    const apply=()=>{
      if(browse){browse.value=q;browse.dispatchEvent(new Event("input",{bubbles:true}));}
      try{ if(typeof window.switchHomeListingTab==='function') window.switchHomeListingTab("products"); }catch(_){}
      try{ if(typeof window.filterHomeProducts==='function') window.filterHomeProducts(); }catch(_){}
      setTimeout(()=>byId("browseSection")?.scrollIntoView({behavior:"smooth",block:"start"}),80);
    };
    if(typeof currentView!=="undefined" && currentView!=="home" && typeof window.navigate==='function'){
      Promise.resolve(window.navigate("home",{},false)).then(()=>setTimeout(apply,80)).catch(apply);
    }else apply();
  }

  let browseShortcutBusy=false;
  function commitBrowseSearchFromUi(){
    const input=byId("searchInput"), toolbar=input?.closest?.(".browse-filter-toolbar");
    const q=String(input?.value||"").trim();
    if(input && toolbar?.classList.contains("final-search-open") && q) saveHistory(q);
  }
  async function openBrowseSearch(){
    if(browseShortcutBusy)return;
    browseShortcutBusy=true;
    try{
      closeAllPanels();
      if(currentView!=="home")await navigate("home",{},false);
      setupCompactSearches();
      const input=byId("searchInput"), toolbar=input?.closest(".browse-filter-toolbar");
      if(!input||!toolbar)return;
      toolbar.classList.add("final-search-open");
      toolbar.querySelector(".levro-final-search-toggle")?.setAttribute("aria-expanded","true");
      document.body.classList.add("search-input-active");
      try{syncVisibleRecentSearches();}catch(_){ }
      requestAnimationFrame(()=>{
        const header = document.querySelector("#appHeader, header.sticky-header, header.site-header, .app-header, .main-header") || document.querySelector("header");
        const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
        const rect = input.getBoundingClientRect();
        const target = window.scrollY + rect.top - headerBottom - 4;
        window.scrollTo({top:Math.max(0,target),behavior:"smooth"});
        input.focus({preventScroll:true});
      });
    }finally{browseShortcutBusy=false;}
  }
  function bindHeaderSearch(){
    window.openLevromartHeaderSearch=openBrowseSearch;
    window.__levroCommitBrowseSearch=commitBrowseSearchFromUi;
    window.closeLevromartHeaderSearch=()=>{
      try{commitBrowseSearchFromUi();}catch(_){ }
      try { document.querySelectorAll(".final-search-open,.final-order-open,.levro-compact-search-wrap.open,.final-order-search-wrap.open").forEach(el=>el.classList.remove("final-search-open","final-order-open","open")); } catch(_) {}
      document.body.classList.remove("search-input-active");
      document.querySelectorAll('input[type="search"]:focus').forEach(x=>{try{x.blur();}catch(_){}});
      try { renderBottomNav(); } catch(_) {}
      try { updateCartFab(); } catch(_) {}
    };
    window.__levroTopSearch=e=>{e?.preventDefault?.();e?.stopPropagation?.();openBrowseSearch();return false;};
    const button=byId("levromartHeaderSearchButton");
    if(button)button.onclick=window.__levroTopSearch;
  }

  function bindContentActions(ui){
    ui.content.querySelectorAll(".levro-search-history-use").forEach(btn=>btn.onclick=()=>{const q=btn.dataset.q||"";ui.input.value=q;saveHistory(q);ui.input.dispatchEvent(new Event("input",{bubbles:true}));});
    ui.content.querySelectorAll(".levro-search-history-remove").forEach(btn=>btn.onclick=()=>{removeHistory(btn.dataset.q||"");ui.content.innerHTML=historyMarkup();bindContentActions(ui);});
    ui.content.querySelector(".levro-search-clear-all")?.addEventListener("click",()=>{clearHistory();ui.content.innerHTML=historyMarkup();bindContentActions(ui);});
    ui.content.querySelectorAll("[data-recommend]").forEach(btn=>btn.addEventListener("click",()=>{
      const action=btn.dataset.recommend;
      if(action==="vendors")navigate("vendors");
      else if(action==="services"){ if(typeof switchHomeListingTab==='function')switchHomeListingTab("services"); else navigate("home"); }
      else if(action==="packages"){ if(typeof switchHomeListingTab==='function')switchHomeListingTab("packages"); else navigate("home"); }
      else { if(typeof switchHomeListingTab==='function')switchHomeListingTab("products"); else navigate("home"); }
      ui.close?.();
    }));
    ui.content.querySelectorAll("[data-sector]").forEach(btn=>btn.addEventListener("click",()=>{routeSearch(btn.dataset.sector||"");ui.close?.();}));
    ui.content.querySelectorAll(".levro-smart-result").forEach(btn=>btn.addEventListener("click",()=>{
      const action=btn.dataset.action,id=btn.dataset.id;
      const label=btn.querySelector("strong")?.textContent||""; if(label)saveHistory(label);
      if(action==="product")navigate("productDetail",{productId:id});
      else if(action==="package")navigate("packageDetail",{packageId:id});
      else if(action==="vendor")navigate("storefront",{vendorId:id});
      else routeSearch(label);
      ui.close?.();
    }));
  }

  // -----------------------------------------------------------------------
  // Compact search controls: exactly one icon beside each filter control.
  // -----------------------------------------------------------------------
  function historyMenuFor(host,input){
    let menu=host.querySelector(":scope > .levro-compact-history");
    if(!menu){menu=document.createElement("div");menu.className="levro-compact-history hidden";host.appendChild(menu);}
    const render=()=>{
      const h=readHistory();
      menu.innerHTML=h.length ? `<div class="levro-compact-history-head"><strong>Recent searches</strong><button type="button" class="compact-clear">Clear all</button></div>${h.map(q=>`<div class="levro-compact-history-row"><button type="button" class="compact-use" data-q="${escText(q).replace(/"/g,'&quot;')}"><i class="fa-solid fa-clock-rotate-left"></i>${escText(q)}</button><button type="button" class="compact-remove" data-q="${escText(q).replace(/"/g,'&quot;')}" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button></div>`).join("")}` : `<div class="levro-compact-history-head"><strong>Recent searches</strong></div><p class="levro-compact-history-empty">Your recent searches will appear here.</p>`;
      menu.classList.remove("hidden");
      menu.querySelector(".compact-clear")?.addEventListener("click",()=>{clearHistory();render();});
      menu.querySelectorAll(".compact-remove").forEach(b=>b.addEventListener("click",()=>{removeHistory(b.dataset.q);render();}));
      menu.querySelectorAll(".compact-use").forEach(b=>b.addEventListener("click",()=>{const q=String(b.dataset.q||"").trim();if(!q)return;input.value=q;saveHistory(q);input.dispatchEvent(new Event("input",{bubbles:true}));window.filterHomeProducts?.();input.focus({preventScroll:true});}));
    };
    return {menu,render};
  }

  function syncVisibleRecentSearches(){
    const input=byId("searchInput");
    document.querySelectorAll(".browse-filter-toolbar").forEach(host=>{
      const menu=host.querySelector(":scope > .levro-compact-history");
      if(!menu || !input)return;
      const h=readHistory();
      menu.innerHTML=h.length
        ? `<div class="levro-compact-history-head"><strong>Recent searches</strong><button type="button" class="compact-clear">Clear all</button></div>${h.map(q=>`<div class="levro-compact-history-row"><button type="button" class="compact-use" data-q="${escText(q).replace(/"/g,'&quot;')}"><i class="fa-solid fa-clock-rotate-left"></i>${escText(q)}</button><button type="button" class="compact-remove" data-q="${escText(q).replace(/"/g,'&quot;')}" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button></div>`).join("")}`
        : `<div class="levro-compact-history-head"><strong>Recent searches</strong></div><p class="levro-compact-history-empty">Your recent searches will appear here.</p>`;
      menu.classList.remove("hidden");
      menu.querySelector(".compact-clear")?.addEventListener("click",()=>{clearHistory();syncVisibleRecentSearches();});
      menu.querySelectorAll(".compact-remove").forEach(b=>b.addEventListener("click",()=>{removeHistory(b.dataset.q||"");syncVisibleRecentSearches();}));
      menu.querySelectorAll(".compact-use").forEach(b=>b.addEventListener("click",()=>{const q=String(b.dataset.q||"").trim();if(!q)return;input.value=q;saveHistory(q);input.dispatchEvent(new Event("input",{bubbles:true}));window.filterHomeProducts?.();input.focus({preventScroll:true});}));
    });
  }
  window.addEventListener("levromart:search-history-changed",()=>setTimeout(syncVisibleRecentSearches,0));

  function setupCompactSearches(){
    // Browse Everything
    const browseToolbar=document.querySelector(".browse-filter-toolbar");
    if(browseToolbar){
      browseToolbar.querySelectorAll(".levro-compact-search-toggle,.browse-compact-search-slot").forEach(el=>el.remove());
      browseToolbar.querySelectorAll(".levro-final-search-toggle").forEach((el,i)=>{if(i>0)el.remove();});
      let input=byId("searchInput");
      const filter=browseToolbar.querySelector(".browse-filter-trigger");
      let toggle=browseToolbar.querySelector(".levro-final-search-toggle");
      if(!toggle){toggle=document.createElement("button");toggle.type="button";toggle.className="icon-btn levro-final-search-toggle";toggle.setAttribute("aria-label","Search Browse Everything");toggle.title="Search Browse Everything";toggle.innerHTML=`<i class="fa-solid fa-magnifying-glass"></i>`;filter?.insertAdjacentElement("afterend",toggle);}
      if(input && input.dataset.finalCompact!="1"){
        input.dataset.finalCompact="1";input.type="search";input.autocomplete="off";
        const state=historyMenuFor(browseToolbar,input);
        toggle.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();const open=browseToolbar.classList.toggle("final-search-open");toggle.setAttribute("aria-expanded",String(open));if(open){document.body.classList.add("search-input-active");state.render();input.focus({preventScroll:true});}else{saveHistory(input.value);state.menu.classList.add("hidden");document.body.classList.remove("search-input-active");try{renderBottomNav();updateCartFab();}catch(_){}}});
        input.addEventListener("focus",()=>{browseToolbar.classList.add("final-search-open");toggle.setAttribute("aria-expanded","true");if(!input.value.trim())state.render();});
        input.addEventListener("keydown",e=>{
          if(e.key==="Enter"&&input.value.trim()){
            e.preventDefault();
            const q=input.value.trim();
            saveHistory(q);
            state.render();
            state.menu.classList.add("hidden");
            try{window.filterHomeProducts?.();}catch(_){}
            input.dispatchEvent(new Event("input",{bubbles:true}));
          }
          if(e.key==="Escape"){
            e.preventDefault();
            saveHistory(input.value);
            browseToolbar.classList.remove("final-search-open");
            state.menu.classList.add("hidden");
            input.blur();
            document.body.classList.remove("search-input-active");
            try{renderBottomNav();updateCartFab();}catch(_){}
          }
        });
      }
    }

    // Vendor directory
    const vendorControls=document.querySelector(".vendors-directory-controls");
    const vendorSearch=document.querySelector(".vendors-directory-search");
    const vendorInput=byId("vendorSearchInput");
    if(vendorControls&&vendorSearch&&vendorInput){
      vendorControls.querySelectorAll(".levro-final-search-toggle").forEach((el,i)=>{if(i>0)el.remove();});
      let toggle=vendorControls.querySelector(".levro-final-search-toggle");
      if(!toggle){toggle=document.createElement("button");toggle.type="button";toggle.className="icon-btn levro-final-search-toggle";toggle.setAttribute("aria-label","Search vendors or products");toggle.title="Search vendors or products";toggle.innerHTML=`<i class="fa-solid fa-magnifying-glass"></i>`;vendorControls.querySelector(".vendors-filters-toggle")?.insertAdjacentElement("afterend",toggle);}
      if(vendorInput.dataset.finalCompact!="1"){
        vendorInput.dataset.finalCompact="1";vendorInput.type="search";
        const state=historyMenuFor(vendorSearch,vendorInput);
        toggle.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();const open=vendorSearch.classList.toggle("final-search-open");toggle.setAttribute("aria-expanded",String(open));if(open){state.render();vendorInput.focus({preventScroll:true});}else state.menu.classList.add("hidden");});
        vendorInput.addEventListener("focus",()=>{vendorSearch.classList.add("final-search-open");toggle.setAttribute("aria-expanded","true");if(!vendorInput.value.trim())state.render();});
        vendorInput.addEventListener("keydown",e=>{if(e.key==="Enter"&&vendorInput.value.trim())saveHistory(vendorInput.value.trim());if(e.key==="Escape"){vendorSearch.classList.remove("final-search-open");state.menu.classList.add("hidden");vendorInput.blur();}});
      }
    }

    // Orders, same component for customer orders AND my purchases.
    document.querySelectorAll(".orders-filter-search-row").forEach(row=>{
      const filter=row.querySelector(".order-filters-wrap"); if(!filter)return;
      row.querySelectorAll(":scope > .orders-search-slot").forEach(el=>el.remove());
      let wrap=row.querySelector(":scope > .final-order-search-wrap");
      if(wrap&&wrap.dataset.bound==="1") return;
      if(!wrap){
        row.querySelectorAll(":scope > .order-search-wrap").forEach(el=>el.remove());
        wrap=document.createElement("div");wrap.className="order-search-wrap final-order-search-wrap";
        wrap.innerHTML=`<button type="button" class="icon-btn order-search-toggle" aria-expanded="false" aria-label="Search orders" title="Search orders"><i class="fa-solid fa-magnifying-glass"></i></button><input id="orderHistorySearch" class="order-history-search" type="search" placeholder="Search orders…" autocomplete="off" />`;
        filter.insertAdjacentElement("afterend",wrap);
      }
      wrap.dataset.bound="1";
      const input=wrap.querySelector("input");const toggle=wrap.querySelector("button");
      // Give each row its own input id without creating duplicate IDs.
      if(document.querySelectorAll("#orderHistorySearch").length>1) input.removeAttribute("id");
      const state=historyMenuFor(wrap,input);
      const open=()=>{wrap.classList.add("final-order-open");toggle.setAttribute("aria-expanded","true");state.render();input.focus({preventScroll:true});};
      const close=()=>{wrap.classList.remove("final-order-open");toggle.setAttribute("aria-expanded","false");state.menu.classList.add("hidden");input.blur();};
      toggle.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();wrap.classList.contains("final-order-open")?close():open();});
      input.addEventListener("focus",()=>{wrap.classList.add("final-order-open");toggle.setAttribute("aria-expanded","true");if(!input.value.trim())state.render();});
      input.addEventListener("input",()=>{window.__levroOrderSearchTerm=input.value.trim().toLowerCase();if(input.value.trim())saveHistory(input.value.trim());try{window.filterOrderHistoryDom?.();}catch(_){} });
      input.addEventListener("keydown",e=>{if(e.key==="Enter"&&input.value.trim())saveHistory(input.value.trim());if(e.key==="Escape"){e.preventDefault();close();}});
    });
  }

  // -----------------------------------------------------------------------
  // Public follower counts. The RPC is SECURITY DEFINER and returns the count
  // without exposing follower identities. Update every visible vendor card.
  //
  // Both this and hydrateVendorCardFollowState below are re-run by a
  // MutationObserver on essentially any DOM change anywhere in the app (see
  // the observer near the bottom of this IIFE) -- a toast, a badge count, a
  // chat preview, anything. Without a "nothing actually changed" guard that
  // re-fires the RPC dozens of times a minute per session for the exact same
  // set of visible vendor cards; across every concurrent user that's what
  // ran this project's Supabase egress quota into the ground. The guard
  // below skips the network round trip entirely when the same vendor-id set
  // was already hydrated within the last 10 seconds.
  // -----------------------------------------------------------------------
  // Remembered follow list: kept in memory and in localStorage (per user) so
  // a card that is rebuilt, or a page that is refreshed before the network
  // answers (or when it fails), still shows "Following" for a vendor the
  // user follows instead of briefly/permanently falling back to "Follow".
  const __followKey=()=>"levromart_followed_vendors:"+(session?.user?.id||"anon");
  function followedVendorSet(){
    const uid=session?.user?.id||"anon";
    if(window.__followedVendorSet && window.__followedVendorSetUid===uid)return window.__followedVendorSet;
    let arr=[];try{arr=JSON.parse(localStorage.getItem(__followKey())||"[]");}catch(_){}
    window.__followedVendorSet=new Set(Array.isArray(arr)?arr.map(String):[]);
    window.__followedVendorSetUid=uid;
    return window.__followedVendorSet;
  }
  function rememberVendorFollow(id,following){
    if(!id)return;
    const set=followedVendorSet();
    if(following)set.add(String(id));else set.delete(String(id));
    try{localStorage.setItem(__followKey(),JSON.stringify([...set]));}catch(_){}
  }
  window.rememberVendorFollow=rememberVendorFollow;
  window.followedVendorSet=followedVendorSet;
  function paintRememberedFollows(){
    if(!session)return;
    const set=followedVendorSet();
    document.querySelectorAll(".vendor-card-follow-btn[data-vendor-id]").forEach(btn=>{
      const id=String(btn.dataset.vendorId||"");
      const recent=window.__vendorCardFollowRecent?.get(id);
      if(recent && Date.now()-recent.at<15000)return;
      const on=set.has(id);
      if(on!==btn.classList.contains("following")){btn.classList.toggle("following",on);btn.textContent=on?"Following":"Follow";}
    });
  }
  const __vendorHydrateCache={followerCounts:{key:"",at:0},followState:{key:"",at:0}};
  function __vendorHydrateShouldSkip(cache,ids){
    const key=ids.slice().sort().join(",");
    // Same set of visible vendors: don't ask again for 90s (this was 10s, and the
    // DOM observer below fires on almost any change, so a page sitting open
    // re-requested follower counts/follow state every ~10-15s).
    if(cache.key===key && Date.now()-cache.at<90000)return true;
    cache.key=key;cache.at=Date.now();
    return false;
  }
  async function hydrateFollowerCounts(){
    if(typeof sb === "undefined")return;
    const ids=[...new Set([...document.querySelectorAll("[data-vendor-id]")].map(el=>el.dataset.vendorId).filter(Boolean))];
    if(!ids.length)return;
    // Counts seen in the last 10 minutes are applied straight from memory (no request).
    const memo0=(window.__followerCountMemo||=new Map());
    const stale0=ids.filter(id=>{const h=memo0.get(String(id));return !h||Date.now()-h.at>600000;});
    if(!stale0.length){ids.forEach(id=>document.querySelectorAll(`[data-vendor-id="${CSS.escape(id)}"] .vendor-follower-count`).forEach(el=>{el.textContent=Number(memo0.get(String(id)).n).toLocaleString();}));return;}
    if(__vendorHydrateShouldSkip(__vendorHydrateCache.followerCounts,ids))return;
    try{
      const {data,error}=await sb.rpc("get_vendor_follower_counts",{p_vendor_ids:stale0});
      if(error)throw error;
      const memo=(window.__followerCountMemo||=new Map());
      stale0.forEach(id=>{const row=(data||[]).find(r=>String(r.vendor_id)===String(id));memo.set(String(id),{n:Number(row?.follower_count||0),at:Date.now()});});
      const counts=new Map(ids.map(id=>[String(id),Number(memo.get(String(id))?.n||0).toLocaleString()]));
      ids.forEach(id=>document.querySelectorAll(`[data-vendor-id="${CSS.escape(id)}"] .vendor-follower-count`).forEach(el=>{el.textContent=counts.get(String(id))||"0";}));
    }catch(err){ console.warn("[Levromart] Follower count refresh failed:",err); }
  }

  function installVendorCardRenderer(){
    if(typeof window.vendorCardHtml!=="function")return;
    window.vendorCardHtml=function(v){
      const name=v?.business_name||"Vendor";
      const avatar=v?.logo_url||v?.user_avatar_url||"";
      const sectorName=v?.sector_name || (Array.isArray(sectors)?sectors.find(sec=>String(sec.id)===String(v?.sector_id))?.name:"") || "Sector not listed";
      const count=Number(v?.follower_count||0).toLocaleString();
      const avatarHtml=avatar?`<img src="${escText(avatar)}" alt="" class="vendor-directory-logo" loading="lazy" draggable="false" onerror="this.replaceWith(document.createRange().createContextualFragment(avatarFallbackHtml('${escText(name)}','3.1rem','vendor-directory-logo','${escText(name)}')))">`:avatarFallbackHtml(name,'3.1rem','vendor-directory-logo',name);
      // Admins are people too -- there's no reason they can't follow a vendor's
      // shop from the Featured Vendors rail like any other account can.
      const showFollow=!(typeof isOwnVendorId==="function" && isOwnVendorId(v?.id));
      // A card rebuilt right after a tap (filter change, cache-then-refresh
      // repaint, another hydrate pass) has no way to know about that tap
      // until a fresh network round trip catches up -- so without this it
      // silently reverts to "Follow" and the user has to tap twice. Trust
      // whatever was tapped most recently for a few seconds instead.
      const recentFollow=window.__vendorCardFollowRecent?.get(String(v?.id||""));
      const recentFresh=!!(recentFollow && (Date.now()-recentFollow.at<15000));
      const isFollowingNow=recentFresh ? !!recentFollow.following : !!(session && followedVendorSet().has(String(v?.id||"")));
      const followBtn=showFollow?`<button type="button" class="vendor-card-follow-btn${isFollowingNow?" following":""}" data-vendor-id="${escText(v?.id||"")}" onclick="event.stopPropagation();toggleVendorCardFollow('${escText(v?.id||"")}',event)">${isFollowingNow?"Following":"Follow"}</button>`:"";
      // Fewer stacked rows: rating and follower count now share one row at
      // the bottom of the card instead of each getting its own, and
      // city/distance share one line instead of two.
      const followerStat=`<span class="vendor-card-follower-stat"><i class="fa-solid fa-user-group" aria-hidden="true"></i> <span class="vendor-follower-count">${count}</span> follower${Number(v?.follower_count||0)===1?'':'s'}</span>`;
      const distanceHtml = vendorDistanceHtml(v);
      const ratingInline = `<span class="vendor-card-rating-corner badge ${typeof ratingBadgeClass==='function'?ratingBadgeClass(Number(v?.avg_rating||0)):''}"><i class="fa-solid fa-star"></i> ${Number(v?.avg_rating||0).toFixed(1)}</span>`;
      const verifiedBadge = `<span data-vt="${esc(v?.id||"")}" class="vendor-card-verified-badge" aria-label="Verified vendor" title="Verified vendor"><i class="fa-solid fa-circle-check"></i></span>`;
      return `<div class="vendor-card homepage-vendor-card" data-vendor-id="${escText(v?.id||"")}" onclick="navigate('storefront',{vendorId:'${escText(v?.id||"")}'});" role="button" tabindex="0">
        <span class="vendor-card-avatar-wrap">${avatarHtml}${verifiedBadge}</span><div class="vendor-directory-copy" style="min-width:0;flex:1 1 auto;overflow:hidden;">
          <strong class="vendor-directory-name">${escText(name)}</strong>
          <p class="muted vendor-directory-city" style="margin:.15rem 0;">${escText(v?.city||"Online")}${distanceHtml ? ` · ${distanceHtml}` : ""}</p>
          <p class="muted vendor-directory-categories"><i class="fa-solid fa-layer-group"></i> ${escText(sectorName)}</p>
          ${followBtn}
          <div class="vendor-card-meta-row">${followerStat}${ratingInline}</div>
        </div></div>`;
    };
  }
  async function toggleVendorCardFollow(vendorId,ev){
    ev?.preventDefault?.();ev?.stopPropagation?.();
    if(!session){showLogin?.();return;}
    const btn=ev?.currentTarget||document.querySelector(`.vendor-card-follow-btn[data-vendor-id="${CSS.escape(String(vendorId))}"]`);
    if(!btn||btn.disabled)return;
    const next=!btn.classList.contains("following");
    const matches=document.querySelectorAll(`.vendor-card-follow-btn[data-vendor-id="${CSS.escape(String(vendorId))}"]`);
    // Flip the button the instant it's tapped -- waiting on the round trip
    // before showing "Following" reads as stalling. Reconcile with the
    // server after; on failure, flip it back and say why.
    window.__vendorCardFollowRecent=window.__vendorCardFollowRecent||new Map();
    window.__vendorCardFollowRecent.set(String(vendorId),{following:next,at:Date.now()});
    rememberVendorFollow(vendorId,next);
    try{window.__followerCountMemo?.delete(String(vendorId));}catch(_){}
    matches.forEach(b=>{b.classList.toggle("following",next);b.textContent=next?"Following":"Follow";b.disabled=true;});
    try{
      const r=await sb.rpc("toggle_vendor_follow",{p_vendor_id:vendorId,p_following:next});
      if(r.error)throw r.error;
      /* follow/unfollow: no toast */
    }catch(e){
      window.__vendorCardFollowRecent.set(String(vendorId),{following:!next,at:Date.now()});
      rememberVendorFollow(vendorId,!next);
      matches.forEach(b=>{b.classList.toggle("following",!next);b.textContent=!next?"Following":"Follow";});
      showToast?.(e.message||"Could not update your following list.","error");
    }
    finally{ matches.forEach(b=>{b.disabled=false;}); }
  }
  window.toggleVendorCardFollow=toggleVendorCardFollow;
  async function hydrateVendorCardFollowState(){
    if(!session||typeof sb==="undefined")return;
    // Paint what we already know right away (no network needed).
    paintRememberedFollows();
    // Once per session, pull the full follow list (one small query) so every
    // card is right even before it has been individually hydrated.
    if(window.__followListLoadedFor!==session.user.id && !window.__followListLoading){
      window.__followListLoading=true;
      try{
        const {data:rows,error:listErr}=await sb.from("vendor_follows").select("vendor_id").eq("follower_id",session.user.id).limit(2000);
        if(!listErr && Array.isArray(rows)){
          const set=followedVendorSet();set.clear();rows.forEach(r=>r?.vendor_id&&set.add(String(r.vendor_id)));
          try{localStorage.setItem(__followKey(),JSON.stringify([...set]));}catch(_){}
          window.__followListLoadedFor=session.user.id;
          paintRememberedFollows();
        }
      }catch(_){}
      finally{window.__followListLoading=false;}
    }
    const ids=[...new Set([...document.querySelectorAll(".vendor-card-follow-btn[data-vendor-id]")].map(el=>el.dataset.vendorId).filter(Boolean))];
    if(!ids.length)return;
    if(__vendorHydrateShouldSkip(__vendorHydrateCache.followState,ids))return;
    try{
      // One batched RPC call for every visible card instead of one call per
      // card -- this used to fire get_vendor_follow_state once per vendor id
      // on every single hydration pass, which combined with how often the
      // pass itself re-ran (see the guard above) was firing well over a
      // million times a day across all sessions.
      const {data,error}=await sb.rpc("get_vendor_follow_states",{p_vendor_ids:ids});
      if(error)throw error;
      (data||[]).forEach((st)=>{
        const id=st?.vendor_id;
        if(!id)return;
        // A tap in the last 15s wins over this fetch -- the fetch may have
        // been in flight since before that tap landed, and reflecting a
        // stale answer over it is exactly the "needs two taps" bug.
        const recent=window.__vendorCardFollowRecent?.get(String(id));
        if(recent && (Date.now()-recent.at<15000))return;
        rememberVendorFollow(id,!!st?.following);
        if(!st?.following)return;
        document.querySelectorAll(`.vendor-card-follow-btn[data-vendor-id="${CSS.escape(id)}"]`).forEach(btn=>{btn.classList.add("following");btn.textContent="Following";});
      });
    }catch(err){ console.warn("[Levromart] Follow-state hydrate failed:",err); }
  }

  // Listing activation now uses the already-existing vendor-payments function,
  // keeping Vercel at 12 serverless functions instead of creating a new one.
  const listingPaymentBusy=new Set();
  const pendingListingKey=(kind,id)=>"levromart-listing-payment:"+vendor.id+":"+kind+":"+id;
  async function readOwnedListing(kind,id){
    if(!vendor?.id || !["product","package"].includes(kind))throw new Error("Listing or vendor is unavailable.");
    const result=await sb.from(kind==="product"?"products":"vendor_packages").select("*").eq("id",id).eq("vendor_id",vendor.id).single();
    if(result.error||!result.data)throw new Error(result.error?.message||"Listing not found for this vendor.");
    return result.data;
  }
  async function verifyListingReference(reference){
    const r=await fetch("/api/vendor-payments",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({action:"verify-listing-payment",reference,accessToken:session.access_token})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok||data.status!=="success")throw new Error(data.error||"Payment is not verified yet. Retry verification before paying again.");
    return data;
  }
  const MANUAL_MONTHLY_ACCOUNT={number:"8063227669",bank:"OPay",name:"Kennis Kalu Dede"};
  const manualMonthlyBusy=new Set();
  function manualMonthlyTable(kind){return kind==="product"?"products":"vendor_packages";}
  function manualMonthlyLabel(kind,listing){return kind==="product"?(listing?.is_service?"service":"product"):"package";}
  function ensureManualMonthlyModal(){
    let m=byId("manualMonthlyPaymentModal");
    if(m)return m;
    m=document.createElement("div");m.id="manualMonthlyPaymentModal";m.className="modal hidden";m.innerHTML=`
      <div class="modal-content manual-monthly-payment-modal-content" style="max-width:520px;">
        <div class="manual-monthly-head"><div><span class="muted">Monthly listing</span><h3 id="manualMonthlyTitle" style="margin:.12rem 0 0;">Pay ₦999 to submit</h3></div><button type="button" class="icon-btn" onclick="closeManualMonthlyPayment()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
        <div id="manualMonthlyError" class="error-text hidden"></div>
        <div id="manualMonthlyExistingNote"></div>
        <div class="manual-monthly-account-card">
          <div class="manual-monthly-account-row"><span>Bank</span><strong>${esc(MANUAL_MONTHLY_ACCOUNT.bank)}</strong><button type="button" class="btn btn-sm btn-outline" onclick="copyManualMonthlyValue('${MANUAL_MONTHLY_ACCOUNT.bank}','Bank copied.')"><i class="fa-regular fa-copy"></i> Copy</button></div>
          <div class="manual-monthly-account-row"><span>Account number</span><strong>${esc(MANUAL_MONTHLY_ACCOUNT.number)}</strong><button type="button" class="btn btn-sm btn-outline" onclick="copyManualMonthlyValue('${MANUAL_MONTHLY_ACCOUNT.number}','Account number copied.')"><i class="fa-regular fa-copy"></i> Copy</button></div>
          <div class="manual-monthly-account-row"><span>Account name</span><strong>${esc(MANUAL_MONTHLY_ACCOUNT.name)}</strong><button type="button" class="btn btn-sm btn-outline" onclick="copyManualMonthlyValue('${esc(MANUAL_MONTHLY_ACCOUNT.name)}','Account name copied.')"><i class="fa-regular fa-copy"></i> Copy</button></div>
          <div class="manual-monthly-account-row manual-monthly-amount"><span>Amount</span><strong>₦999</strong><button type="button" class="btn btn-sm btn-outline" onclick="copyManualMonthlyValue('999','Amount copied.')"><i class="fa-regular fa-copy"></i> Copy</button></div>
        </div>
        <p class="muted manual-monthly-instruction">Transfer exactly <strong>₦999</strong> to the account above. Then enter the <strong>name of the account that made the payment</strong> and upload the receipt. Your listing remains pending until an administrator verifies the receipt.</p>
        <label>Name on payer account *</label>
        <input id="manualMonthlyPayerName" type="text" maxlength="120" placeholder="Name shown on the account that paid" autocomplete="name" />
        <label>Payment receipt *</label>
        <input id="manualMonthlyReceipt" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" />
        <div id="manualMonthlyReceiptPreview" class="manual-monthly-receipt-preview hidden"></div>
        <div class="manual-monthly-actions"><button type="button" class="btn btn-outline" onclick="closeManualMonthlyPayment()">Cancel</button><button type="button" class="btn" id="manualMonthlySubmitBtn" onclick="submitManualMonthlyPayment()"><i class="fa-solid fa-paper-plane"></i> Submit receipt</button></div>
      </div>`;
    document.body.appendChild(m);
    byId("manualMonthlyReceipt")?.addEventListener("change",()=>previewManualMonthlyReceipt());
    return m;
  }
  window.copyManualMonthlyValue=async function(value,message){
    try{await navigator.clipboard.writeText(String(value));showToast(message||"Copied.","success");}
    catch(_){const ta=document.createElement("textarea");ta.value=String(value);ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();try{document.execCommand("copy");showToast(message||"Copied.","success")}catch(__){showToast("Copy is unavailable on this device.","info")}ta.remove();}
  };
  window.closeManualMonthlyPayment=function(){
    const m=byId("manualMonthlyPaymentModal");if(m)m.classList.add("hidden");
    const b=byId("manualMonthlySubmitBtn");if(b){b.disabled=false;b.innerHTML='<i class="fa-solid fa-paper-plane"></i> Submit receipt';}
    const note=byId("manualMonthlyExistingNote");if(note)note.innerHTML="";
    window.__manualMonthlyTarget=null;window.__manualMonthlyNewDraft=null;
  };
  function previewManualMonthlyReceipt(){
    const input=byId("manualMonthlyReceipt"),preview=byId("manualMonthlyReceiptPreview");if(!input||!preview)return;
    const file=input.files?.[0];if(!file){preview.classList.add("hidden");preview.innerHTML="";return;}
    if(file.size>10*1024*1024){input.value="";preview.classList.add("hidden");preview.innerHTML="";showToast("Receipt must be 10 MB or smaller.","error");return;}
    preview.classList.remove("hidden");preview.innerHTML=file.type==="application/pdf"?`<div><i class="fa-solid fa-file-pdf"></i> ${esc(file.name)} · ${(file.size/1024/1024).toFixed(2)} MB</div>`:`<img src="${URL.createObjectURL(file)}" alt="Receipt preview" />`;
  }
  async function findPendingManualSubmission(kind,id){
    if(!id)return null;
    const {data,error}=await sb.from("monthly_listing_submissions").select("id,kind,listing_id,payer_name,receipt_path,status,submitted_at,review_note").eq("kind",kind).eq("listing_id",id).eq("status","pending").order("submitted_at",{ascending:false}).limit(1).maybeSingle();
    if(error)return null;return data||null;
  }
  async function openManualMonthlyPayment(kind,id,options={}){
    if(!session?.access_token){showLogin();return false;}
    const lock=kind+":"+(id||"new");if(manualMonthlyBusy.has(lock))return false;manualMonthlyBusy.add(lock);
    try{
      const isNew=!!options.isNew;
      let listing=options.draft||null;
      if(!isNew)listing=await readOwnedListing(kind,id);
      if(!isNew&&listing.billing_model!=="monthly")return false;
      if(!isNew&&listingActivationValid(listing)){
        if(listing.status!=="active")await sb.from(manualMonthlyTable(kind)).update({status:"active",billing_status:"active"}).eq("id",id).eq("vendor_id",vendor.id);
        await navigate(kind==="product"?"vendorProducts":"vendorPackages",{},false);return true;
      }
      const pending=await findPendingManualSubmission(kind,id);
      const m=ensureManualMonthlyModal();
      window.__manualMonthlyTarget=isNew?{kind,id:null,newDraft:options.draft}:{kind,id,listing};
      byId("manualMonthlyTitle").textContent=isNew?`Pay ₦999 to submit ${manualMonthlyLabel(kind,listing)}`:`Pay ₦999 to renew ${manualMonthlyLabel(kind,listing)}`;
      byId("manualMonthlyPayerName").value=pending?.payer_name||"";
      byId("manualMonthlyReceipt").value="";
      byId("manualMonthlyReceiptPreview").classList.add("hidden");byId("manualMonthlyReceiptPreview").innerHTML="";
      const errorEl=byId("manualMonthlyError");errorEl.classList.add("hidden");errorEl.textContent="";
      const note=byId("manualMonthlyExistingNote");if(note)note.innerHTML="";
      const submitBtn=byId("manualMonthlySubmitBtn");
      if(pending&&!isNew){
        if(note)note.innerHTML='<div class="manual-monthly-existing-note">A receipt is already awaiting admin review for this listing. Please wait for the administrator to approve or reject it.</div>';
        if(submitBtn){submitBtn.disabled=true;submitBtn.innerHTML='<i class="fa-solid fa-clock"></i> Awaiting review';}
      }else if(submitBtn){submitBtn.disabled=false;submitBtn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Submit receipt';}
      m.classList.remove("hidden");
      if(kind==="product")closeProductModal?.();else closePackageModal?.();
      return true;
    }catch(e){showToast(e.message||"Could not open monthly payment.","error");return false;}finally{manualMonthlyBusy.delete(lock);}
  }
  async function createManualMonthlyListing(target,payer,receiptPath){
    const draft=target?.newDraft;if(!draft?.kind||!draft?.fields||!vendor?.id)throw new Error("Your vendor profile is unavailable.");
    if(String(draft.vendor_id)!==String(vendor.id))throw new Error("This listing draft belongs to a different vendor account.");
    let listingId=null;
    if(draft.kind==="product"){
      const {data,error}=await sb.from("products").insert({...draft.fields,vendor_id:vendor.id,quantity_available:Number(draft.fields.quantity_total)||1,photos:Array.isArray(draft.photos)?draft.photos:[],status:"paused",billing_model:"monthly",billing_status:"pending_payment",billing_paid_until:null,billing_reference:null}).select("id").single();
      if(error||!data?.id)throw new Error(error?.message||"Could not save the product for admin review.");
      listingId=data.id;
      try{
        await saveProductVariants(listingId,Array.isArray(draft.variantDrafts)?draft.variantDrafts:[]);
        const {error:ee}=await sb.from("product_engagement_settings").upsert({product_id:listingId,vendor_id:vendor.id,...(draft.engagement||{})},{onConflict:"product_id"});if(ee)throw ee;
      }catch(e){await sb.from("products").delete().eq("id",listingId).eq("vendor_id",vendor.id);throw e;}
    }else{
      const {data,error}=await sb.from("vendor_packages").insert({...draft.fields,vendor_id:vendor.id,status:"paused",billing_model:"monthly",billing_status:"pending_payment",billing_paid_until:null,billing_reference:null}).select("id").single();
      if(error||!data?.id)throw new Error(error?.message||"Could not save the package for admin review.");
      listingId=data.id;
      try{
        const {error:ie}=await sb.from("package_items").insert((draft.items||[]).map(it=>({...it,package_id:listingId})));if(ie)throw ie;
        const {error:ee}=await sb.from("package_engagement_settings").upsert({package_id:listingId,vendor_id:vendor.id,...(draft.engagement||{})},{onConflict:"package_id"});if(ee)throw ee;
      }catch(e){await sb.from("vendor_packages").delete().eq("id",listingId).eq("vendor_id",vendor.id);throw e;}
    }
    const {data:submissionId,error:subErr}=await sb.rpc("submit_monthly_listing_payment",{p_kind:draft.kind,p_listing_id:listingId,p_payer_name:payer,p_receipt_path:receiptPath});
    if(subErr||!submissionId){
      if(draft.kind==="product")await sb.from("products").delete().eq("id",listingId).eq("vendor_id",vendor.id);else await sb.from("vendor_packages").delete().eq("id",listingId).eq("vendor_id",vendor.id);
      throw new Error(subErr?.message||"Could not submit the monthly listing application.");
    }
    return listingId;
  }
  window.submitManualMonthlyPayment=async function(){
    const target=window.__manualMonthlyTarget;if(!target)return;
    const btn=byId("manualMonthlySubmitBtn"),errorEl=byId("manualMonthlyError");
    const payer=String(byId("manualMonthlyPayerName")?.value||"").trim(),file=byId("manualMonthlyReceipt")?.files?.[0];
    errorEl.classList.add("hidden");errorEl.textContent="";
    if(payer.length<2){errorEl.textContent="Enter the name on the account that made the transfer.";errorEl.classList.remove("hidden");return;}
    if(!file){errorEl.textContent="Upload the ₦999 payment receipt.";errorEl.classList.remove("hidden");return;}
    if(file.size>10*1024*1024){errorEl.textContent="Receipt must be 10 MB or smaller.";errorEl.classList.remove("hidden");return;}
    btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
    let path=null;
    try{
      path=`${session.user.id}/${target.kind}/${target.id||"new"}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      const {error:upErr}=await sb.storage.from("listing-payment-receipts").upload(path,file,{contentType:file.type,upsert:false});
      if(upErr)throw new Error(`Receipt upload failed: ${upErr.message}`);
      btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
      let listingId=target.id||null;
      if(target.newDraft)listingId=await createManualMonthlyListing(target,payer,path);
      else{
        const {data:submissionId,error}=await sb.rpc("submit_monthly_listing_payment",{p_kind:target.kind,p_listing_id:listingId,p_payer_name:payer,p_receipt_path:path});
        if(error||!submissionId)throw new Error(error?.message||"Could not submit the payment receipt.");
      }
      closeManualMonthlyPayment();
      showToast("Receipt submitted. Your listing is waiting for admin approval.","success");
      await navigate(target.kind==="product"?"vendorProducts":"vendorPackages",{},false);
    }catch(e){
      if(path){try{await sb.storage.from("listing-payment-receipts").remove([path])}catch(_){}}
      errorEl.textContent=e.message||"Could not submit the receipt.";errorEl.classList.remove("hidden");
    }finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Submit receipt';}
  };
  window.startListingMonthlyPayment=async function(kind,id){return openManualMonthlyPayment(kind,id);};
  window.startNewListingMonthlyPayment=async function(kind,draft){if(!session?.access_token){showLogin();return false;}window.__manualMonthlyNewDraft=draft;return openManualMonthlyPayment(kind,null,{isNew:true,draft});};
  async function finalizePaidListingDraft(reference,expectedKind){
    const raw=sessionStorage.getItem("levromart-pending-listing-draft");
    if(!raw)return {ok:false,error:"Your paid listing draft is no longer available on this device. Please contact support before paying again."};
    let draft; try{draft=JSON.parse(raw);}catch(_){return {ok:false,error:"The pending listing draft could not be read."};}
    if(!draft||draft.kind!==expectedKind||!draft.fields)return {ok:false,error:"The pending listing draft does not match this payment."};
    const vendorId=vendor?.id; if(!vendorId)return {ok:false,error:"Your vendor profile is unavailable. Please sign in again."};
    if(String(draft.vendor_id)!==String(vendorId))return {ok:false,error:"This listing draft belongs to a different vendor account."};
    const fields={...draft.fields,status:"active",billing_status:"active",billing_reference:reference,billing_paid_until:(()=>{const d=new Date();const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+1);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return d.toISOString();})()};
    let savedProductId=null;
    const existing=await sb.from("products").select("id").eq("vendor_id",vendorId).eq("billing_reference",reference).maybeSingle();
    if(existing.data?.id){savedProductId=existing.data.id;}
    else{
      const {data:created,error}=await sb.from("products").insert({...fields,vendor_id:vendorId,quantity_available:fields.quantity_total,photos:Array.isArray(draft.photos)?draft.photos:[]}).select("id").single();
      if(error||!created?.id)return {ok:false,error:error?.message||"Payment succeeded, but the listing could not be saved yet. Your draft has been kept so you can retry."};
      savedProductId=created.id;
      try{await saveProductVariants(savedProductId,Array.isArray(draft.variantDrafts)?draft.variantDrafts:[]);}catch(e){return {ok:false,error:e.message||"The listing was saved, but its varieties could not be saved yet."};}
    }
    const claim=await fetch("/api/vendor-payments",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({action:"consume-listing-payment",reference,listingId:savedProductId,accessToken:session.access_token})});
    const claimData=await claim.json().catch(()=>({}));
    if(!claim.ok&&!/already been used/i.test(String(claimData.error||"")))return {ok:false,error:claimData.error||"The payment was received, but the payment record could not be finalized. Your listing draft is safe; please retry."};
    await sb.from("products").update({billing_reference:null}).eq("id",savedProductId).eq("vendor_id",vendorId);
    sessionStorage.removeItem("levromart-pending-listing-draft");sessionStorage.removeItem("levromart-pending-listing-reference");
    return {ok:true,id:savedProductId};
  }

  window.syncListingBillingUI=function(){
    const service=byId("prodIsService")?.checked, select=byId("prodBillingModel"), hint=byId("prodBillingHint"), saveBtn=byId("saveProductBtn");
    if(!select)return;
    // Services can use either billing model. Commission services use negotiation;
    // monthly services keep a fixed price and use the existing ₦999 manual listing-fee flow.
    select.disabled=false;
    const __hintText=select.value==="monthly"
      ? (service ? "Monthly service: set a fixed price, transfer ₦999, upload your receipt, then wait for admin approval." : "Monthly listing: transfer ₦999, upload your receipt, then wait for admin approval.")
      : (service ? "Commission service: buyers request the service and propose a price for you to accept, decline, or counter." : "Commission-based listings can go live without an upfront activation payment.");
    if(hint&&hint.textContent!==__hintText)hint.textContent=__hintText;
    if(saveBtn&&!editingProductId){const __btnHtml=select.value==="monthly"?'<i class="fa-solid fa-receipt"></i> Submit ₦999 payment': 'Save to Product'; if(saveBtn.__lvHtml!==__btnHtml){saveBtn.innerHTML=__btnHtml;saveBtn.__lvHtml=__btnHtml;}}
  };
  window.syncPackageBillingUI=function(){
    const s=byId("pkgBillingModel"),h=byId("pkgBillingHint");if(h){const t=s?.value==="monthly"?"Monthly package: transfer ₦999, upload your receipt, then wait for admin approval.":"Commission-based packages can go live without an activation payment."; if(h.textContent!==t)h.textContent=t;}
  };

  async function finalPaymentReturn(){ return; }

  function run(){
    bindHeaderSearch();
    setupCompactSearches();
    installVendorCardRenderer();
    // Repaint vendor cards once after installing the final renderer so the
    // follower-count hooks are present on an already-rendered home/vendor page.
    try {
      if (typeof currentView !== "undefined" && currentView === "vendors" && typeof renderVendorDirectoryCards === "function") renderVendorDirectoryCards();
    } catch(_) {}
    hydrateFollowerCounts();
    hydrateVendorCardFollowState();
    syncListingBillingUI();syncPackageBillingUI();
    finalPaymentReturn();
  }
  document.addEventListener("change",e=>{if(e.target?.id==="prodIsService"||e.target?.id==="prodBillingModel")syncListingBillingUI();if(e.target?.id==="pkgBillingModel")syncPackageBillingUI();},true);
  document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target?.matches?.("#searchInput,#vendorSearchInput,#orderHistorySearch")&&e.target.value.trim())saveHistory(e.target.value.trim());},true);
  const observer=new MutationObserver((mutations)=>{
    // Browse Everything's product grid replaces its own innerHTML on every
    // filter/refresh; those mutations never contain vendor cards or search
    // toolbars, so skip the expensive re-hydration pass for them instead of
    // re-scanning the whole document after every Home grid rebuild.
    const onlyProductGrid=mutations.length>0 && mutations.every(m=>{
      const t=m.target;
      return t && t.nodeType===1 && (t.id==="productGrid" || t.closest?.("#productGrid"));
    });
    if(onlyProductGrid)return;
    // Ignore churn that can never contain vendor cards / search toolbars: toasts,
    // call overlay, Levi chat, chat threads, header/bottom-nav badges, carousels.
    const IGNORE="#toastStack,#levroCallOverlay,#leviAskBubble,#aiChatPanel,#chatMessages,.chat-page-header,#bottomNav,header,.home-promotional-carousel,#homePromotionalViewport";
    const meaningful=mutations.some(m=>{
      const t=m.target;
      if(!t||t.nodeType!==1)return true;
      return !t.closest?.(IGNORE);
    });
    if(!meaningful)return;
    clearTimeout(window.__levroFinalUxTimer);window.__levroFinalUxTimer=setTimeout(()=>{setupCompactSearches();installVendorCardRenderer();hydrateFollowerCounts();hydrateVendorCardFollowState();syncListingBillingUI();syncPackageBillingUI();},80);
  });
  observer.observe(document.body,{childList:true,subtree:true});
  setTimeout(run,250);
})();

/* ---- levromart-phase1-final-repairs-20260911 ---- */
(function(){
  "use strict";
  const SEARCH_KEY="levromart-search-history-v1";
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const read=()=>{try{const a=JSON.parse(localStorage.getItem(SEARCH_KEY)||"[]");return Array.isArray(a)?a.map(String).map(x=>x.trim()).filter(Boolean).slice(0,8):[]}catch(_){return[]}};
  const save=q=>{q=String(q||"").trim();if(!q)return;try{localStorage.setItem(SEARCH_KEY,JSON.stringify([q,...read().filter(x=>x.toLowerCase()!==q.toLowerCase())].slice(0,8)))}catch(_){}};
  // Permission nudges are one-time onboarding prompts, not recurring notifications.
  const NUDGE_KEY="levromart-permission-nudge-seen-v2";
  const seen=()=>{try{return localStorage.getItem(NUDGE_KEY)==="1"}catch(_){return false}};
  const markSeen=()=>{try{localStorage.setItem(NUDGE_KEY,"1")}catch(_){}};
  const patchNudge=()=>{
    const fn=window.leviPermissionReminder;
    if(typeof fn!=="function"||fn.__phase1)return;
    const wrapped=async function(...args){if(seen())return false;return fn.apply(this,args)};wrapped.__phase1=true;window.leviPermissionReminder=wrapped;
  };
  setTimeout(patchNudge,0);setTimeout(patchNudge,500);setTimeout(patchNudge,2000);
  document.addEventListener("click",e=>{if(e.target?.closest?.(".levi-permission-nudge-close,.levi-permission-nudge-action,#notifPromptModal button,#locationPromptModal button"))markSeen()},true);
  // Stop any already-created nudge after it has been dismissed and prevent the 5-minute loop.
  setInterval(()=>{if(seen())document.getElementById("leviPermissionNudge")?.remove()},1500);
  // Make the vendor-owned follower count an actual social-style entry point.
  function wireFollowerCount(){
    if(typeof window.makeFollowerStatClickable==='function') { try{ window.makeFollowerStatClickable(); }catch(_){} }
    const stat=document.querySelector('.storefront-profile[data-own-storefront="1"] [data-follow-count]');
    const id=(typeof currentViewParams!="undefined"&&currentViewParams?.vendorId)||vendor?.id;
    if(stat&&id){stat.classList.add('storefront-follow-count-button');stat.onclick=()=>window.showVendorFollowers?.(id);stat.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();window.showVendorFollowers?.(id)}};stat.setAttribute('role','button');stat.setAttribute('tabindex','0');stat.title='View your followers';}
  }
  setTimeout(wireFollowerCount,300);
  new MutationObserver(()=>setTimeout(wireFollowerCount,60)).observe(document.body,{childList:true,subtree:true});

  // Commission reminder clock for both My Shop and Edit business profile.
  async function phase1CommissionDeadline(){
    if(typeof sb==='undefined'||!vendor?.id)return;
    try{
      const r=await sb.rpc('get_vendor_commission_deadline',{p_vendor_id:vendor.id});
      const due=r?.data?.[0]?.earliest_due_at;
      if(!due)return;
      const tick=()=>document.querySelectorAll('.levro-commission-deadline').forEach(el=>{const ms=new Date(due).getTime()-Date.now();if(ms<=0){el.textContent='Due now';return;}const d=Math.floor(ms/86400000),h=Math.floor(ms%86400000/3600000),m=Math.floor(ms%3600000/60000);el.textContent=d?`${d}d ${h}h left`:h?`${h}h ${m}m left`:`${m}m left`;});
      tick();clearInterval(window.__phase1CommissionTimer);window.__phase1CommissionTimer=setInterval(tick,30000);
    }catch(_){}
  }
  setTimeout(phase1CommissionDeadline,450);
  new MutationObserver(()=>{clearTimeout(window.__phase1CommissionTimerBoot);window.__phase1CommissionTimerBoot=setTimeout(phase1CommissionDeadline,250)}).observe(document.body,{childList:true,subtree:true});

  // Admin bottom navigation: compact, same footprint as the normal rail.
  const style=document.createElement("style");style.textContent=`@media(max-width:720px){#bottomNav:not(.has-add):not(.buyer-no-add){height:68px!important;min-height:0!important;padding:.22rem .22rem!important;box-sizing:border-box!important;align-items:center!important}#bottomNav:not(.has-add):not(.buyer-no-add) .bottom-nav-item{height:54px!important;min-height:54px!important;padding:.28rem .08rem!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:.18rem!important}#bottomNav:not(.has-add):not(.buyer-no-add) .bottom-nav-item>span:last-child{font-size:.62rem!important;line-height:1!important}}@media(min-width:721px){#bottomNav{left:50%!important;right:auto!important;transform:translateX(-50%)!important;width:min(760px,calc(100vw - 2rem))!important}#bottomNav:not(.has-add) .bottom-nav-item{flex:1 1 0!important}}.vendor-commission-deadline-row{display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin:.15rem 0 .65rem;font-size:.76rem}.vendor-commission-deadline-row strong{font-variant-numeric:tabular-nums;color:var(--primary)}.phase1-search-shell{width:min(760px,100%);margin:0 auto;background:color-mix(in srgb,var(--card) 97%,transparent);border:1px solid color-mix(in srgb,var(--primary) 22%,var(--border));border-radius:20px;box-shadow:0 24px 70px rgba(15,23,42,.22);overflow:hidden}.phase1-search-bar{display:flex;align-items:center;gap:.55rem;padding:.5rem .65rem;border-bottom:1px solid var(--border)}.phase1-search-bar>i{color:var(--primary)}#levromartHeaderSearchDock #levromartHeaderSearchInput{flex:1!important;min-width:0!important;border:0!important;background:transparent!important;box-shadow:none!important;margin:0!important;padding:.7rem .1rem!important}.phase1-search-bar>button{width:38px;height:38px;border:0;background:transparent;border-radius:50%;cursor:pointer}.phase1-search-section{padding:.7rem}.phase1-search-head{display:flex;justify-content:space-between;align-items:center;gap:.5rem;font-size:.8rem;margin-bottom:.45rem}.phase1-search-head button{border:0;background:none;color:var(--primary);font-weight:700;cursor:pointer}.phase1-search-row{display:flex;align-items:center;border-radius:11px}.phase1-use{flex:1;display:flex;align-items:center;gap:.65rem;border:0;background:none;padding:.65rem;color:var(--text);text-align:left;cursor:pointer}.phase1-use i{color:var(--text-muted)}.phase1-use span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.phase1-remove{width:36px;height:36px;border:0;background:transparent;color:var(--text-muted);cursor:pointer}.phase1-empty{margin:.2rem 0;color:var(--text-muted);font-size:.75rem}.vendor-product-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:.65rem!important}.vendor-product-card-grid .card{min-width:0!important;padding:.65rem!important}.vendor-product-card-grid .product-img{height:150px!important;border-radius:12px!important}.vendor-draft-actions button[aria-label*="Delete"],.ai-chat-history-delete{background:#dc2626!important;color:#fff!important;border-color:#dc2626!important}.saved-location-delete{background:#dc2626!important;color:#fff!important;border-color:#dc2626!important}.order-filters-wrap .filter-dropdown-menu,.order-filters-wrap .filters-panel,.vendor-notification-menu{max-width:min(360px,calc(100vw - 2rem))!important;width:min(360px,calc(100vw - 2rem))!important}.order-filters-wrap .filter-dropdown-menu,.order-filters-wrap .filters-panel{max-height:55vh!important;overflow:auto!important}@media(min-width:721px){#bottomNav{max-width:760px!important;margin-inline:auto!important}.vendor-product-card-grid .product-img{height:180px!important}}@media(max-width:520px){.vendor-product-card-grid .product-img{height:118px!important}}`;document.head.appendChild(style);
})();

/* ---- levromart-phase1-password-runtime ---- */
(function(){document.addEventListener("click",function(e){const b=e.target?.closest?.(".password-visibility-toggle");if(!b)return;const i=document.getElementById(b.dataset.passwordTarget);if(!i)return;const showing=i.type==="text";i.type=showing?"password":"text";const icon=b.querySelector("i");if(icon)icon.className="fa-solid "+(showing?"fa-eye":"fa-eye-slash");b.setAttribute("aria-label",(showing?"Show ":"Hide ")+"password");b.title=showing?"Show password":"Hide password"},true)})();

/* ---- levromart-astra-final-qa-runtime ---- */
(function(){'use strict';
  /* Search state: one delegated controller covers expandable searches across the SPA. */
  const searchSelector='input[type="search"],#heroSearch,#searchInput,#vendorSearchInput,#orderHistorySearch,#vendorProductSearch,#storefrontPackageSearch,#adminPeopleSearch,#msgSearchInput,.messages-search';
  function searchOpen(){document.body.classList.add('search-input-active');}
  function searchClose(){
    try{window.closeLevromartHeaderSearch?.();}catch(_){}
    document.querySelectorAll('.final-search-open,.final-order-open,.levro-compact-search-wrap.open,.final-order-search-wrap.open,.vendor-product-search-popover.open').forEach(x=>x.classList.remove('final-search-open','final-order-open','open'));
    document.querySelectorAll('.levro-compact-history').forEach(x=>x.classList.add('hidden'));
    const dock=document.getElementById('levromartHeaderSearchDock'); if(dock)dock.classList.remove('open');
    const backdrop=document.getElementById('levromartHeaderSearchBackdrop'); if(backdrop)backdrop.classList.remove('open');
    document.querySelectorAll('input[type="search"]:focus, #heroSearch:focus').forEach(x=>{try{x.blur()}catch(_){} });
    document.body.classList.remove('search-input-active');
    try{renderBottomNav();updateCartFab();}catch(_){}
  }
  function isInsideActiveSearch(target){
    if(!target?.closest)return false;
    return !!target.closest('#levromartHeaderSearchDock,.browse-filter-toolbar.final-search-open,.vendors-directory-search.final-search-open,.final-order-search-wrap.final-order-open,.vendor-product-search-popover.open,.levro-compact-history,.levro-final-search-toggle,.header-search-btn');
  }
  document.addEventListener('focusin',e=>{if(e.target?.matches?.(searchSelector))searchOpen()},true);
  document.addEventListener('pointerdown',e=>{
    if(!document.body.classList.contains('search-input-active'))return;
    const backdrop=e.target?.closest?.('#levromartHeaderSearchBackdrop,.search-backdrop,.compact-search-backdrop,.order-search-backdrop');
    if(backdrop || !isInsideActiveSearch(e.target)) searchClose();
  },true);
  document.addEventListener('click',e=>{
    if(e.target?.closest?.('[data-search-close],.header-search-close,.levro-search-close,.final-order-search-close')){searchClose();return;}
    if(e.target?.closest?.('.levro-compact-search-toggle,.final-order-search-toggle,.vendor-search-toggle,.search-toggle,.levro-final-search-toggle'))setTimeout(searchOpen,0);
  },true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('search-input-active'))searchClose()},true);
  const observer=new MutationObserver(()=>{
    if(document.querySelector('.levro-compact-search-wrap.open,.final-order-search-wrap.open,#levromartHeaderSearchDock.open')) searchOpen();
  }); observer.observe(document.body,{childList:true,subtree:true});

  window.__levroHardCloseSearch=searchClose;

  /* Request notification badge: include both request offers and fresh customer requests. */
  const oldRefreshNotifications=window.refreshNotifications;
  if(typeof oldRefreshNotifications==='function'&&!window.__astraNotifWrap){window.__astraNotifWrap=true;window.refreshNotifications=async function(...args){const r=await oldRefreshNotifications.apply(this,args);try{if(profile?.role==='vendor'&&session?.user?.id){const q=await sb.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',session.user.id).eq('type','new_request').eq('read',false).eq('archived',false).is('deleted_at',null);window.requestVendorNotificationCount=Number(q.count||0);const el=document.querySelector('[data-profile-label="Requests"] .profile-request-badge');if(el){const n=Number(window.requestVendorNotificationCount||0)+Number(requestOfferBadgeCount||0);el.textContent=n>9?'9+':String(n);el.classList.toggle('hidden',n===0)}}}catch(_){}return r}}

  /* Request category: keep the picker synced after sector changes and support related lexical search without inventing values. */
  document.addEventListener('change',e=>{if(e.target?.id==='reqSector')setTimeout(()=>window.updateRequestCategoryOptions?.(),0)},true);

  /* Drafts: debounced, user-scoped and identity-scoped. Backdrop/X keeps the
     draft; explicit Cancel clears it. Each modal identity has its own timer
     and monotonically increasing revision so a stale callback cannot write
     an older snapshot after a newer edit. */
  const DRAFT_PREFIX='levromart-listing-form-draft-v5';
  const draftTimers=new Map();
  const draftRevisions=new Map();
  function draftKey(kind='product', id){return `${DRAFT_PREFIX}:${session?.user?.id||'guest'}:${kind}:${id||'new'}`}
  function listingModalKind(root){return root?.id==='packageModal'?'package':'product'}
  function listingModalIdentity(root){if(!root)return 'new'; const kind=listingModalKind(root); return kind==='product'?(editingProductId||'new'):(editingPackageId||'new')}
  function isListingForm(el){return !!el?.closest?.('#productModal,#packageModal') && !!document.querySelector('#productModal:not(.hidden),#packageModal:not(.hidden)')}
  function nextDraftRevision(key){const n=(draftRevisions.get(key)||0)+1;draftRevisions.set(key,n);return n}
  function cancelDraftTimer(key){const t=draftTimers.get(key);if(t){clearTimeout(t);draftTimers.delete(key)}}
  function captureListingDraft(rootOrKind){
    if(!session?.user?.id)return;
    const root=typeof rootOrKind==='string'?byId(rootOrKind==='package'?'packageModal':'productModal'):rootOrKind;
    if(!root||root.classList.contains('hidden'))return;
    const kind=listingModalKind(root), id=listingModalIdentity(root), key=draftKey(kind,id), revision=nextDraftRevision(key);
    cancelDraftTimer(key);
    const controls=[...root.querySelectorAll('input:not([type=file]),select,textarea')], values={};
    controls.forEach(c=>{if(!c.id)return;values[c.id]=c.type==='checkbox'?c.checked:c.value});
    if(kind==='product')persistVisibleVariantOrder();
    const snapshot={version:5,savedAt:Date.now(),revision,kind,id,values,existingPhotos:kind==='product'?[...(window.__existingPhotos||[])]:[...(window.__existingPackagePhotos||[])],variants:kind==='product'?(window.__productVariants||[]).map(({_imageFile,_previewUrl,...v})=>v):null};
    try{localStorage.setItem(key,JSON.stringify(snapshot));}catch(_){}
    window.__listingDraftSession={userId:session.user.id,kind,id,existingPhotos:snapshot.existingPhotos,variants:kind==='product'?(window.__productVariants||[]).map(v=>({...v})):null,newProductPhotoFiles:kind==='product'?[...(window.__newProductPhotoFiles||[])]:[],newPackagePhotoFiles:kind==='package'?[...(window.__newPackagePhotoFiles||[])]:[]};
    return snapshot;
  }
  function scheduleListingDraft(root){
    if(!session?.user?.id||!root||root.classList.contains('hidden'))return;
    const kind=listingModalKind(root), id=listingModalIdentity(root), key=draftKey(kind,id);
    cancelDraftTimer(key);
    draftTimers.set(key,setTimeout(()=>{draftTimers.delete(key);captureListingDraft(root)},420));
  }
  function restoreListingDraft(){
    if(!session?.user?.id)return;
    const root=document.querySelector('#productModal:not(.hidden),#packageModal:not(.hidden)');
    if(!root||root.dataset.draftRestored==='1')return;
    root.dataset.draftRestored='1';
    const kind=listingModalKind(root), id=listingModalIdentity(root), key=draftKey(kind,id);
    // Existing product edits are always loaded from Supabase. Restoring an
    // autosaved local snapshot here can overwrite server-loaded varieties or
    // photos with stale/partial state. Draft restore remains available for new
    // listings and package flows.
    if(kind==='product' && id && id!=='new') return;
    let raw;try{raw=localStorage.getItem(key)}catch(_){return}
    if(!raw)return;
    let d;try{d=JSON.parse(raw)}catch(_){return}
    if(!d?.values||d.kind!==kind||String(d.id||'new')!==String(id||'new'))return;
    // For an existing listing, the database is authoritative. Do not let an
    // older autosaved draft (which may contain an empty/partial variety set)
    // overwrite varieties that were just loaded from Supabase.
    const serverLoadedAt=Number(root.dataset.serverLoadedAt||0);
    if(serverLoadedAt && Number(d.savedAt||0) <= serverLoadedAt) return;
    draftRevisions.set(key,Math.max(Number(d.revision)||0,draftRevisions.get(key)||0));
    Object.entries(d.values).forEach(([fieldId,v])=>{const el=byId(fieldId);if(!el||!root.contains(el))return;if(el.type==='checkbox')el.checked=!!v;else el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}))});
    if(kind==='product'){
      window.__existingPhotos=Array.isArray(d.existingPhotos)?d.existingPhotos:window.__existingPhotos||[];
      window.__productVariants=window.__listingDraftSession?.userId===session.user.id&&window.__listingDraftSession?.kind===kind&&window.__listingDraftSession?.id===id?window.__listingDraftSession.variants||[]:Array.isArray(d.variants)?d.variants:window.__productVariants||[];
      window.__newProductPhotoFiles=window.__listingDraftSession?.userId===session.user.id&&window.__listingDraftSession?.kind==='product'&&window.__listingDraftSession?.id===id?[...(window.__listingDraftSession.newProductPhotoFiles||[])]:window.__newProductPhotoFiles||[];
      renderExistingPhotos();renderProductDisplayPicture();renderProductVariantPricing();syncNewProductPhotoInput?.();renderNewProductPhotos?.();
      updateProductFormFields?.();updateProductSaveButtonLabel?.();updateProductDeliveryFields?.();
    }
    if(kind==='package'){
      window.__existingPackagePhotos=Array.isArray(d.existingPhotos)?d.existingPhotos:window.__existingPackagePhotos||[];
      window.__newPackagePhotoFiles=window.__listingDraftSession?.userId===session.user.id&&window.__listingDraftSession?.kind==='package'&&window.__listingDraftSession?.id===id?[...(window.__listingDraftSession.newPackagePhotoFiles||[])]:window.__newPackagePhotoFiles||[];
      renderExistingPackagePhotos();syncNewPackagePhotoInput?.();renderNewPackagePhotos?.();
    }
  }
  function clearListingDraft(kind,id){const key=draftKey(kind,id);cancelDraftTimer(key);nextDraftRevision(key);try{localStorage.removeItem(key)}catch(_){} if(window.__listingDraftSession?.kind===kind&&window.__listingDraftSession?.id===id)window.__listingDraftSession=null;}
  function clearNewListingDraft(kind){clearListingDraft(kind,kind==='product'?(editingProductId||'new'):(editingPackageId||'new'))}
  window.clearListingDraft=clearListingDraft;
  window.clearNewListingDraft=clearNewListingDraft;
  window.__captureListingDraftForModal=kind=>captureListingDraft(kind);
  document.addEventListener('input',e=>{if(isListingForm(e.target))scheduleListingDraft(e.target.closest('#productModal,#packageModal'))},true);
  document.addEventListener('change',e=>{if(isListingForm(e.target))scheduleListingDraft(e.target.closest('#productModal,#packageModal'))},true);
  document.addEventListener('click',e=>{const b=e.target?.closest?.('#productModal button,#packageModal button');if(!b)return;const txt=(b.textContent||'').trim().toLowerCase();if(txt==='cancel'){const root=b.closest('#productModal,#packageModal');root.dataset.discardDraft='1';clearNewListingDraft(listingModalKind(root));searchClose?.()}},true);
  const draftObserver=new MutationObserver(()=>{const root=document.querySelector('#productModal:not(.hidden),#packageModal:not(.hidden)');if(root&&!window.__astraRestoreTimer){window.__astraRestoreTimer=setTimeout(()=>{window.__astraRestoreTimer=0;restoreListingDraft()},80)}});
  window.__restoreListingDraft=restoreListingDraft;
  draftObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});

  /* Own listing management: enrich active owner pages and make owner navigation obvious. */
  document.addEventListener('click',e=>{const card=e.target?.closest?.('.vendor-product-card-grid>.card');if(!card)return;if(e.target.closest('button,a,input'))return;const edit=card.querySelector('.vendor-edit-action');if(edit)e.preventDefault();},true);

  /* Admin phone actions */
  window.openAdminPhoneActions=function(event,phone,name){event?.preventDefault?.();event?.stopPropagation?.();const existing=document.getElementById('adminPhoneActionModal');existing?.remove();const modal=document.createElement('div');modal.id='adminPhoneActionModal';modal.className='modal';const safe=String(phone).replace(/[^0-9+]/g,'');const wa=safe.replace(/^\+/,'');modal.innerHTML=`<div class="modal-content" style="max-width:340px"><div class="drawer-header"><h3 style="margin:0">${escHtml(name)}</h3><button type="button" class="drawer-close-btn" onclick="document.getElementById('adminPhoneActionModal')?.remove()"><i class="fa-solid fa-xmark"></i></button></div><p class="muted" style="margin:.3rem 0 .8rem">${escHtml(phone)}</p><div class="flex" style="gap:.5rem"><button type="button" class="btn" onclick="navigator.clipboard?.writeText('${escHtml(phone)}').then(()=>{showToast('Phone number copied.','success');document.getElementById('adminPhoneActionModal')?.remove()})"><i class="fa-regular fa-copy"></i> Copy</button><a class="btn btn-outline" href="https://wa.me/${wa}" target="_blank" rel="noopener" onclick="document.getElementById('adminPhoneActionModal')?.remove()"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a></div></div>`;document.body.appendChild(modal);modal.addEventListener('click',e=>{if(e.target===modal)modal.remove()})};

  /* Levi texture is cosmetic only. */
  document.querySelectorAll('#aiChatFab .ai-chat-fab-logo').forEach(x=>x.classList.add('astra-levi-textured'));
  setInterval(()=>{if(currentView==='adminPeople')renderAdminPeopleRows()},60*60*1000);
})();

/* ---- levromart-refinement-20260912-runtime ---- */
(function(){'use strict';
  function markBackButtons(root=document){root.querySelectorAll?.('button,.btn,a').forEach(el=>{if(el.dataset.levroBackMarked==='1')return;const text=(el.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();if(!text.startsWith('back'))return;const onclick=el.getAttribute('onclick')||'';if(!onclick.includes('navigate(')&&!el.classList.contains('settings-back-btn')&&!el.classList.contains('chat-header-back'))return;if(el.classList.contains('danger')||el.dataset.primaryAction==='1')return;el.dataset.levroBackMarked='1';el.dataset.levroBack='1';});} markBackButtons(); new MutationObserver(()=>markBackButtons()).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('click',e=>{const hit=e.target?.closest?.('#levromartHeaderSearchBackdrop,.search-backdrop,.compact-search-backdrop,.order-search-backdrop');if(!hit)return;try{window.closeLevromartHeaderSearch?.();}catch(_){document.body.classList.remove('search-input-active');document.querySelectorAll('.final-search-open,.final-order-open,.levro-compact-search-wrap.open,.final-order-search-wrap.open').forEach(el=>el.classList.remove('final-search-open','final-order-open','open'));document.querySelectorAll('input[type="search"]:focus').forEach(x=>{try{x.blur()}catch(_){}});try{renderBottomNav();updateCartFab();}catch(_){}}},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.getElementById('reqSectorPickerModal')?.remove();document.getElementById('reqCategoryPickerModal')?.remove();if(document.body.classList.contains('search-input-active')){try{window.__levroHardCloseSearch?.();}catch(_){}}}},true);
  document.addEventListener('focusout',e=>{if(!e.target?.matches?.('#searchInput,#levromartHeaderSearchInput,.vendors-directory-search input,.orders-filter-search-row input'))return;setTimeout(()=>{if(!document.querySelector('.browse-filter-toolbar.final-search-open,.final-search-open,.levro-compact-search-wrap.open')&&!document.activeElement?.matches?.('input[type=search]')){document.body.classList.remove('search-input-active');try{renderBottomNav();updateCartFab();}catch(_){}}},80);},true);
  window.addEventListener('pagehide',()=>{try{commitBrowseSearchFromUi?.();}catch(_){}document.body.classList.remove('search-input-active');});


  async function hydrateAdminAttention(){
    if(typeof session==='undefined' || profile?.role!=='admin' || typeof sb==='undefined') return;
    try{
      const [vendorsQ,supportQ,disputesQ,suggestionsQ,paymentEscalationQ,confirmedEscalationQ]=await Promise.all([
        sb.from('vendors').select('id',{count:'exact',head:true}).eq('verification_status','pending').is('deleted_at',null),
        sb.from('support_requests').select('id',{count:'exact',head:true}).in('status',['open','in_progress']),
        sb.from('disputes').select('id,order_id',{count:'exact'}).not('status','in','(resolved,closed)'),
        sb.from('suggestions').select('id',{count:'exact',head:true}).eq('status','new'),
        sb.from('orders').select('id',{count:'exact',head:true}).eq('status','payment_unresolved').not('payment_escalated_at','is',null),
        sb.from('orders').select('id',{count:'exact',head:true}).eq('status','confirmed').not('payment_escalated_at','is',null)
      ]);
      const openDisputeOrderIds=new Set((disputesQ.data||[]).map(x=>String(x.order_id||'')));
      const escalatedExtra=Number(paymentEscalationQ?.count||0);
      const counts={adminPanel:isSuperAdmin()?Number(vendorsQ.count||0):0,adminSupportRequests:Number(supportQ.count||0),adminDisputes:Number(disputesQ.count||0)+Math.max(0,escalatedExtra)+Number(confirmedEscalationQ?.count||0),adminFeedback:Number(suggestionsQ.count||0),adminPasswordResets:isSuperAdmin()?Number(window.__passwordResetPendingCount||0):0};
      window.__adminDisputeCount = counts.adminDisputes;
      const profileDisputeBadge = document.querySelector('#profilePanel [data-profile-key="disputes"] .profile-disputes-badge');
      if(profileDisputeBadge){
        const n=counts.adminDisputes;
        profileDisputeBadge.textContent=n>9?'9+':String(n);
        profileDisputeBadge.classList.toggle('hidden', n===0);
      }
      document.querySelectorAll('.admin-dash-tabs [data-admin-view]').forEach(btn=>{
        const key=btn.dataset.adminView;
        let badge=btn.querySelector('.admin-unresolved-badge');
        const n=Number(counts[key]||0);
        if(n>0){ if(!badge){badge=document.createElement('span');badge.className='dash-tab-dot admin-unresolved-badge';btn.appendChild(badge);} badge.textContent=n>9?'9+':String(n); badge.setAttribute('aria-label',`${n} unresolved`); }
        else badge?.remove();
      });
    }catch(e){ console.warn('[Levromart] Admin attention refresh failed:',e); }
  }
  window.hydrateAdminAttention=hydrateAdminAttention;
  async function applyPushDeepLink(data){
    if(!data) return false;
    const meta=data.metadata||data.meta||data.data||{};
    let view=String(data.target_view||data.targetView||data.view||data.route||meta.target_view||meta.targetView||meta.view||meta.route||'').trim();
    let params=data.target_params||data.targetParams||data.params||meta.target_params||meta.targetParams||meta.params||{};
    if(typeof params==='string'){try{params=JSON.parse(params||'{}')}catch(_){params={}}}
    params={...(params||{})};
    if(!view&&(meta.product_id||meta.productId)){view='productDetail';params.productId=meta.product_id||meta.productId;}
    if(!view&&(meta.request_id||meta.requestId)){view='vendorRequests';params.requestId=meta.request_id||meta.requestId;}
    if(!view&&(meta.conversation_id||meta.conversationId)){view='messages';params.conversationId=meta.conversation_id||meta.conversationId;}
    if(!view) return false;
    if(view==='messages'&&(params.conversationId||params.conversation_id)) params={...params,conversationId:params.conversationId||params.conversation_id};
    try{await navigate(view,params);if(view==='adminPanel'&&(params.vendorId||params.vendor_id))setTimeout(()=>document.getElementById(`adminVendor-${CSS.escape(String(params.vendorId||params.vendor_id))}`)?.scrollIntoView({behavior:'smooth',block:'center'}),120);return true;}catch(_){return false;}
  }
  window.applyPushDeepLink=applyPushDeepLink;
  if('serviceWorker' in navigator){
    navigator.serviceWorker.addEventListener('message',e=>{
      const d=e.data?.notification||e.data?.push||e.data;
      if(d?.type==='PUSH_NOTIFICATION_CLICK'||d?.event==='notificationclick'||d?.target_view||d?.targetView) setTimeout(()=>applyPushDeepLink(d),0);
    });
  }
  const initialPush=(()=>{try{const q=new URLSearchParams(location.search);const view=q.get('target_view')||q.get('targetView')||q.get('view');if(!view)return null;let params={};const raw=q.get('target_params')||q.get('params');if(raw)try{params=JSON.parse(raw)}catch(_){}return {target_view:view,target_params:params}}catch(_){return null}})();
  if(initialPush) window.__pendingPushDeepLink=initialPush;
  let adminAttentionObserverTimer=null;
  new MutationObserver(()=>{
    if(!currentView?.startsWith('admin') || !document.querySelector('.admin-dash-tabs')) return;
    clearTimeout(adminAttentionObserverTimer);
    adminAttentionObserverTimer=setTimeout(()=>hydrateAdminAttention(),1200);
  }).observe(document.getElementById('mainContent')||document.body,{childList:true,subtree:true});
  document.addEventListener('levromart:view-rendered',()=>{if(currentView?.startsWith('admin'))setTimeout(hydrateAdminAttention,50);});
  setInterval(()=>{if(currentView?.startsWith('admin')&&!document.hidden)hydrateAdminAttention();},180000);
  const applyPendingPush=()=>{if(window.__pendingPushDeepLink && session){const d=window.__pendingPushDeepLink;window.__pendingPushDeepLink=null;applyPushDeepLink(d);}};
  setTimeout(applyPendingPush,1200);
  document.addEventListener('levromart:auth-ready',applyPendingPush);

})();

/* ---- levromart-comment-sheet-gesture-20260913 ---- */
(function(){let y=0,drag=false;document.addEventListener("pointerdown",e=>{const c=e.target?.closest?.(".levromart-comment-sheet-card");if(!c||e.target.closest("button,textarea,input"))return;y=e.clientY;drag=true},{passive:true});document.addEventListener("pointermove",e=>{if(!drag)return;const c=document.querySelector(".levromart-comment-sheet-card");if(!c)return;const dy=Math.max(0,e.clientY-y);if(dy)c.style.transform=`translateY(${dy}px)`},{passive:true});document.addEventListener("pointerup",e=>{if(!drag)return;drag=false;const c=document.querySelector(".levromart-comment-sheet-card");if(!c)return;const dy=Math.max(0,e.clientY-y);c.style.transform="";if(dy>90)closeSocialCommentSheet()},{passive:true});document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.body.classList.contains("levromart-comment-sheet-open"))closeSocialCommentSheet()})})();

/* ---- levromart-inline-comments-repair-20260913 ---- */
(function(){
  "use strict";
  const $=(id)=>document.getElementById(id);
  const escSafe=(v)=>typeof esc==="function"?esc(v):String(v??"");
  const nameSafe=(v)=>String(v||"Levromart user");

  function commentRow(c,likeMap,myLiked,depth,kind){
    if(window.lvCommentRowHtml) return window.lvCommentRowHtml(c,likeMap,myLiked,depth,kind);
    const liked=myLiked?.has(String(c.id)), own=String(session?.user?.id||"")===String(c.user_id||"");
    const likeFn=kind==="package"?"togglePackageCommentLike":"toggleProductCommentLike";
    const replyFn=kind==="package"?"replyToPackageComment":"replyToProductComment";
    const deleteFn=kind==="package"?"deletePackageComment":"deleteProductComment";
    return `<div class="product-comment-row" data-comment-id="${escSafe(c.id)}" data-depth="${depth||0}" style="${depth?"margin-left:1.1rem;":""}">
      ${c.author_avatar_url?`<img src="${escSafe(c.author_avatar_url)}" class="avatar-circle" style="width:2rem;height:2rem;object-fit:cover;flex:none;" alt="${escSafe(nameSafe(c.author_name))}">`:avatarFallbackHtml(nameSafe(c.author_name),"2rem","product-comment-avatar",nameSafe(c.author_name),c.user_id||c.author_name)}
      <div class="product-comment-main">
        <div class="product-comment-head"><strong>${escSafe(nameSafe(c.author_name))}</strong><span class="muted">${timeAgo(c.created_at)}</span>${c.updated_at&&new Date(c.updated_at)-new Date(c.created_at)>3000?'<span class="muted lv-edited">· edited</span>':""}</div>
        <div class="product-comment-body-row">
          <div class="product-comment-body">${window.lvMentionHtml?window.lvMentionHtml(c.content,c.author_name):escSafe(c.content)}</div>
          <div class="product-comment-actions">
            <button type="button" class="product-comment-action ${liked?"active":""}" onclick="${likeFn}('${escSafe(c.id)}')" aria-label="Like comment" title="Like"><i class="fa-${liked?"solid":"regular"} fa-heart"></i>${Number(likeMap?.get(String(c.id))||0)>0?`<span class="comment-like-count">${Number(likeMap?.get(String(c.id))||0)}</span>`:""}</button>
            <button type="button" class="product-comment-action" onclick="${replyFn}('${escSafe(c.id)}')" aria-label="Reply to comment" title="Reply"><i class="fa-solid fa-reply"></i></button>
            ${own?`<button type="button" class="product-comment-action lv-cmore" onclick="lvCommentMenu('${kind==="package"?"package":"product"}','${escSafe(c.id)}')" aria-label="Comment options" title="More"><i class="fa-solid fa-ellipsis"></i></button>`:""}
          </div>
        </div>
      </div>
    </div>`;
  }

  function simpleThread(rows,likeMap,myLiked,kind){
    const roots=(rows||[]).filter(r=>!r.parent_comment_id);
    const children=new Map();
    (rows||[]).filter(r=>r.parent_comment_id).forEach(r=>{
      const k=String(r.parent_comment_id);
      if(!children.has(k))children.set(k,[]);
      children.get(k).push(r);
    });
    return roots.map(root=>{
      const replies=(children.get(String(root.id))||[]).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
      const replyId=`levro-replies-${kind}-${root.id}`;
      return commentRow(root,likeMap,myLiked,0,kind)+
        (replies.length?`<button type="button" class="comment-replies-toggle" onclick="toggleInlineCommentReplies('${escSafe(root.id)}','${kind}')" aria-expanded="false" data-replies-for="${escSafe(root.id)}"><span class="cr-line"></span><span class="cr-label">View ${replies.length} ${replies.length===1?"reply":"replies"}</span></button><div id="${replyId}" class="comment-replies-dropdown hidden">${replies.map(r=>commentRow(r,likeMap,myLiked,1,kind)).join("")}</div>`:"");
    }).join("");
  }

  window.toggleInlineCommentReplies=function(id,kind){
    const el=$(`levro-replies-${kind}-${id}`); if(!el)return;
    const open=!el.classList.contains("hidden");
    el.classList.toggle("hidden",open);
    const btn=document.querySelector(`[data-replies-for="${CSS.escape(String(id))}"]`);
    if(btn){
      btn.setAttribute("aria-expanded",String(!open));
      const count=el.querySelectorAll(".product-comment-row").length;
      btn.innerHTML=`<span class="cr-line"></span><span class="cr-label">${open?`View ${count} ${count===1?"reply":"replies"}`:"Hide replies"}</span>`;
    }
  };

  async function loadInlineComments(kind,id,{preserveDraft=true,showLoading=true}={}){
    const panel=$(kind==="package"?"packageCommentsPanel":"productCommentsPanel");
    if(!panel)return;
    const inputId=kind==="package"?"packageCommentInput":"productCommentInput";
    const draft=preserveDraft?($(inputId)?.value||""):"";
    // Never replace the visible comment area with a loading banner. Render the
    // composer/empty shell immediately, then hydrate comments when the request
    // returns. Realtime/background refreshes remain completely silent.
    if(!panel.dataset.loaded){
      const composer=`<div class="product-comment-composer"><div class="product-comment-compose-row"><textarea id="${inputId}" rows="2" placeholder="Write a comment..." ${session?"":"disabled"}></textarea><button type="button" class="btn btn-sm" aria-label="Send comment" onclick="${kind==="package"?"submitPackageComment":"submitProductComment"}('${escSafe(id)}')" ${session?"":"disabled"}><i class="fa-solid fa-paper-plane"></i></button></div>${session?"":'<small class="muted">Log in to join the discussion.</small>'}</div>`;
      panel.innerHTML="<div class=\"comment-fetch-placeholder\"></div>"+composer;
    }
    try{
      const result=kind==="package"?await fetchPackageComments(id):await fetchProductComments(id);
      panel.dataset.loaded="1";
      const rows=result.rows||[];
      if(kind==="package"){
        window.__packageCommentCounts.set(String(id),rows.length);
        $(`packageCommentsCount`)?.replaceChildren(document.createTextNode(String(rows.length)));
      }else{
        window.__productCommentCounts.set(String(id),rows.length);
        $(`productCommentsCount`)?.replaceChildren(document.createTextNode(String(rows.length)));
      }
      const thread=rows.length?simpleThread(rows,result.likeMap,result.myLiked,kind):'<div class="product-comments-empty">No comments yet. Be the first to ask a question.</div>';
      const replyActive=kind==="package"?window.__levroActivePackageReply:window.__levroActiveProductReply;
      const composer=`<div class="product-comment-composer">${replyActive?`<div class="product-comment-replying">Replying to a comment <button type="button" class="icon-btn" onclick="${kind==="package"?"cancelPackageCommentReply":"cancelProductCommentReply"}()" aria-label="Cancel reply"><i class="fa-solid fa-xmark"></i></button></div>`:""}<div class="product-comment-compose-row"><textarea id="${inputId}" rows="2" placeholder="Write a comment..." ${session?"":"disabled"}>${escSafe(draft)}</textarea><button type="button" class="btn btn-sm" aria-label="Send comment" onclick="${kind==="package"?"submitPackageComment":"submitProductComment"}('${escSafe(id)}')" ${session?"":"disabled"}><i class="fa-solid fa-paper-plane"></i></button></div>${session?"":'<small class="muted">Log in to join the discussion.</small>'}</div>`;
      const __oldComposer=panel.querySelector(":scope > .product-comment-composer");
      if(__oldComposer&&$(inputId)){
        /* Keep the same input element alive so the keyboard never drops and a half-typed reply survives refreshes. */
        const __tmp=document.createElement("div"); __tmp.innerHTML=thread+composer;
        const __newComposer=__tmp.querySelector(".product-comment-composer"); const __newRep=__newComposer?.querySelector(".product-comment-replying"); const __oldRep=__oldComposer.querySelector(".product-comment-replying");
        if(__oldRep&&!__newRep)__oldRep.remove(); else if(!__oldRep&&__newRep)__oldComposer.insertBefore(__newRep,__oldComposer.firstChild);
        [...panel.childNodes].forEach(n=>{if(n!==__oldComposer)n.remove()});
        __newComposer?.remove();
        while(__tmp.firstChild)panel.insertBefore(__tmp.firstChild,__oldComposer);
      }else panel.innerHTML=thread+composer;
    }catch(_){
      if(!panel.dataset.loaded)panel.innerHTML='<div class="product-comments-empty">Couldn’t load comments right now. Please try again.</div>';
    }
  }

  window.loadProductComments=function(id,opts={}){return loadInlineComments("product",id,opts)};
  window.loadPackageComments=function(id,opts={}){return loadInlineComments("package",id,opts)};

  function stopChannel(key){
    const ch=window[key];
    if(ch){try{sb.removeChannel(ch)}catch(_){}}
    window[key]=null;
  }
  function startChannel(kind,id){
    if(!sb)return;
    const key=kind==="package"?"__levroPackageCommentChannel":"__levroProductCommentChannel";
    stopChannel(key);
    window[key]=sb.channel(`levro-inline-${kind}-comments-${id}`).on("postgres_changes",{event:"*",schema:"public",table:kind==="package"?"package_comments":"product_comments",filter:`${kind==="package"?"package_id":"product_id"}=eq.${id}`},async()=>{
      try{await loadInlineComments(kind,id,{showLoading:false}); if(kind==="product")await hydrateProductCommentCountsInView(); else await hydratePackageCommentCountsInView();}catch(_){}
    }).subscribe();
  }
  window.stopProductCommentRealtime=function(){stopChannel("__levroProductCommentChannel")};
  window.stopPackageCommentRealtime=function(){stopChannel("__levroPackageCommentChannel")};

  window.replyToProductComment=function(id){window.__levroActiveProductReply=String(id);const i=$("productCommentInput");if(i)i.focus();if(currentProductDetail?.id)loadInlineComments("product",currentProductDetail.id,{showLoading:false})};
  window.cancelProductCommentReply=function(){window.__levroActiveProductReply=null;if(currentProductDetail?.id)loadInlineComments("product",currentProductDetail.id,{showLoading:false})};
  window.replyToPackageComment=function(id){window.__levroActivePackageReply=String(id);const i=$("packageCommentInput");if(i)i.focus();if(currentViewParams?.packageId)loadInlineComments("package",currentViewParams.packageId,{showLoading:false})};
  window.cancelPackageCommentReply=function(){window.__levroActivePackageReply=null;if(currentViewParams?.packageId)loadInlineComments("package",currentViewParams.packageId,{showLoading:false})};

  window.submitProductComment=async function(id){
    if(!session){showLogin();return}
    const content=String($("productCommentInput")?.value||"").trim();
    if(!content){showToast("Write a comment first.","error");return}
    const __in=$("productCommentInput");const __restore=()=>{const i=$("productCommentInput");if(i&&!i.value){i.value=content;i.style.height=""}};if(__in){__in.value="";__in.style.height=""}
    const {data:st}=await sb.from("product_engagement_settings").select("allow_comments,comment_audience,vendor_id").eq("product_id",id).maybeSingle();
    if(st?.allow_comments===false){showToast("Comments are disabled for this listing.","error");__restore();return}
    if(st?.comment_audience==="followers"&&!isOwnVendorId(st.vendor_id)){const {data:f}=await sb.from("vendor_follows").select("id").eq("vendor_id",st.vendor_id).eq("follower_id",session.user.id).maybeSingle();if(!f){showToast("Only followers can comment on this listing.","error");__restore();return}}
    const {error}=await sb.from("product_comments").insert({product_id:id,user_id:session.user.id,parent_comment_id:window.__levroActiveProductReply||null,content,author_name:profile?.name||"Levromart user",author_avatar_url:profile?.avatar_url||null});
    if(error){showToast(error.message||"Could not post that comment.","error");__restore();return}
    window.__levroActiveProductReply=null;await loadInlineComments("product",id,{preserveDraft:false,showLoading:false});hydrateProductCommentCountsInView();
  };
  window.submitPackageComment=async function(id){
    if(!session){showLogin();return}
    const content=String($("packageCommentInput")?.value||"").trim();
    if(!content){showToast("Write a comment first.","error");return}
    const __in=$("packageCommentInput");const __restore=()=>{const i=$("packageCommentInput");if(i&&!i.value){i.value=content;i.style.height=""}};if(__in){__in.value="";__in.style.height=""}
    const {data:st}=await sb.from("package_engagement_settings").select("allow_comments,comment_audience,vendor_id").eq("package_id",id).maybeSingle();
    if(st?.allow_comments===false){showToast("Comments are disabled for this package.","error");__restore();return}
    if(st?.comment_audience==="followers"&&!isOwnVendorId(st.vendor_id)){const {data:f}=await sb.from("vendor_follows").select("id").eq("vendor_id",st.vendor_id).eq("follower_id",session.user.id).maybeSingle();if(!f){showToast("Only followers can comment on this package.","error");__restore();return}}
    const {error}=await sb.from("package_comments").insert({package_id:id,user_id:session.user.id,parent_comment_id:window.__levroActivePackageReply||null,content,author_name:profile?.name||"Levromart user",author_avatar_url:profile?.avatar_url||null});
    if(error){showToast(error.message||"Could not post that comment.","error");__restore();return}
    window.__levroActivePackageReply=null;await loadInlineComments("package",id,{preserveDraft:false,showLoading:false});hydratePackageCommentCountsInView();
  };
  window.toggleProductCommentLike=async function(id){
    if(!session){showLogin();return}
    const {data:x}=await sb.from("product_comment_likes").select("id").eq("comment_id",id).eq("user_id",session.user.id).maybeSingle();
    const r=x?.id?await sb.from("product_comment_likes").delete().eq("id",x.id).eq("user_id",session.user.id):await sb.from("product_comment_likes").insert({comment_id:id,user_id:session.user.id});
    if(r.error&&!/duplicate/i.test(r.error.message||"")){showToast(r.error.message||"Could not update comment like.","error");return}
    if(currentProductDetail?.id)loadInlineComments("product",currentProductDetail.id,{showLoading:false});
  };
  window.togglePackageCommentLike=async function(id){
    if(!session){showLogin();return}
    const {data:x}=await sb.from("package_comment_likes").select("id").eq("comment_id",id).eq("user_id",session.user.id).maybeSingle();
    const r=x?.id?await sb.from("package_comment_likes").delete().eq("id",x.id).eq("user_id",session.user.id):await sb.from("package_comment_likes").insert({comment_id:id,user_id:session.user.id});
    if(r.error&&!/duplicate/i.test(r.error.message||"")){showToast(r.error.message||"Could not update comment like.","error");return}
    if(currentViewParams?.packageId)loadInlineComments("package",currentViewParams.packageId,{showLoading:false});
  };
  window.deleteProductComment=async function(id){if(!session)return;if(!(await showConfirmDialog("Delete your comment?",{title:"Delete comment",okLabel:"Delete",danger:true})))return;const {error}=await sb.from("product_comments").delete().eq("id",id).eq("user_id",session.user.id);if(error){showToast(error.message||"Could not delete comment.","error");return}if(currentProductDetail?.id){await loadInlineComments("product",currentProductDetail.id,{showLoading:false});hydrateProductCommentCountsInView()}};
  window.deletePackageComment=async function(id){if(!session)return;if(!(await showConfirmDialog("Delete your comment?",{title:"Delete comment",okLabel:"Delete",danger:true})))return;const {error}=await sb.from("package_comments").delete().eq("id",id).eq("user_id",session.user.id);if(error){showToast(error.message||"Could not delete comment.","error");return}if(currentViewParams?.packageId){await loadInlineComments("package",currentViewParams.packageId,{showLoading:false});hydratePackageCommentCountsInView()}};

  window.toggleProductComments=function(id){
    const panel=$("productCommentsPanel"),toggle=document.querySelector(".product-comments-toggle");
    if(!panel)return;
    const opening=panel.classList.contains("hidden");
    panel.classList.toggle("hidden",!opening);
    toggle?.setAttribute("aria-expanded",String(opening));
    if(opening){window.__levroActiveProductReply=null;panel.dataset.loaded="";loadInlineComments("product",id,{showLoading:false});startChannel("product",id)}
    else stopChannel("__levroProductCommentChannel");
  };
  window.togglePackageComments=function(id){
    const panel=$("packageCommentsPanel"),toggle=document.querySelector(".package-comments-toggle");
    if(!panel)return;
    const opening=panel.classList.contains("hidden");
    panel.classList.toggle("hidden",!opening);
    toggle?.setAttribute("aria-expanded",String(opening));
    if(opening){window.__levroActivePackageReply=null;panel.dataset.loaded="";loadInlineComments("package",id,{showLoading:false});startChannel("package",id)}
    else stopChannel("__levroPackageCommentChannel");
  };
  window.openProductCommentsFromCard=function(id){navigate("productDetail",{productId:id,openComments:true})};
  window.openPackageCommentsFromCard=function(id){navigate("packageDetail",{packageId:id,openComments:true})};
  window.openSocialCommentSheet=function(kind,id,title){ if(kind==="package")return window.togglePackageComments(id); return window.toggleProductComments(id); };
  window.closeSocialCommentSheet=function(){ document.body.classList.remove("levromart-comment-sheet-open"); $("levromartCommentSheet")?.remove(); stopChannel("__levroProductCommentChannel"); stopChannel("__levroPackageCommentChannel"); };
  try{$("levromartCommentSheet")?.remove();document.body.classList.remove("levromart-comment-sheet-open")}catch(_){}
  // Defensive cleanup for any legacy renderer that may still attempt to inject
  // the old loading banner. Never expose it to the user.
  new MutationObserver(()=>{document.querySelectorAll(".product-comments-loading").forEach(el=>el.remove())}).observe(document.body,{childList:true,subtree:true});
})();

/* ---- levromart-listing-expiry-ui-20260913 ---- */
(function(){
  "use strict";
  function formatRemaining(ms){
    if(ms<=0)return "Expired";
    const total=Math.floor(ms/1000),days=Math.floor(total/86400),hours=Math.floor((total%86400)/3600),mins=Math.floor((total%3600)/60);
    if(days>0)return `${days}d ${hours}h left`;
    if(hours>0)return `${hours}h ${mins}m left`;
    return `${Math.max(0,mins)}m left`;
  }
  window.listingExpiryMarkup=function(p){
    const paid=Date.parse(p?.billing_paid_until||"");
    if(!Number.isFinite(paid))return "";
    const expired=paid<=Date.now();
    const cls=expired?"expired":paid-Date.now()<=5*86400000?"expiring-soon":"";
    return `<span class="listing-expiry-inline ${cls}" data-paid-until="${esc(p.billing_paid_until)}"><i class="fa-regular fa-clock"></i> ${expired?"Expired":formatRemaining(paid-Date.now())}</span>`;
  };
  function refresh(){
    document.querySelectorAll(".listing-expiry-inline[data-paid-until]").forEach(el=>{
      const paid=Date.parse(el.dataset.paidUntil||""); if(!Number.isFinite(paid))return;
      const ms=paid-Date.now(); el.classList.toggle("expired",ms<=0);el.classList.toggle("expiring-soon",ms>0&&ms<=5*86400000);
      el.innerHTML=`<i class="fa-regular fa-clock"></i> ${formatRemaining(ms)}`;
    });
  }
  window.setInterval(refresh,60000);
  document.addEventListener("levromart:vendor-products-rendered",refresh);
  setTimeout(refresh,100);
})();

/* ---- levromart-payment-repair-20260913 ---- */
(function(){
  "use strict";
  // Before opening a second Paystack checkout, try to verify the listing's
  // existing pending reference. This repairs payments whose browser callback
  // was missed and prevents the vendor from being charged twice.
  const originalStart=window.startListingMonthlyPayment;
  if(typeof originalStart==="function"&&!window.__levroStartListingMonthlyPaymentWrapped){
    window.__levroStartListingMonthlyPaymentWrapped=true;
    window.startListingMonthlyPayment=async function(kind,id,options={}){
      try{
        if(typeof session!=="undefined"&&session?.access_token&&id&&(kind==="product"||kind==="package")){
          const table=kind==="product"?"products":"vendor_packages";
          const {data:listing}=await sb.from(table).select("id,billing_status,billing_reference,status,billing_paid_until").eq("id",id).maybeSingle();
          const ref=listing?.billing_reference;
          if(ref&&listing?.billing_status==="pending_payment"){
            const r=await fetch("/api/vendor-payments",{method:"POST",headers:{"Content-Type":"application/json","Cache-Control":"no-cache"},cache:"no-store",body:JSON.stringify({action:"verify-listing-payment",reference:ref,accessToken:session.access_token})});
            const d=await r.json().catch(()=>({}));
            if(r.ok&&d?.status==="success"){
              showToast?.("Payment confirmed. Your listing is active for one month.","success");
              await navigate("vendorProducts",{},false);
              return true;
            }
          }
        }
      }catch(_){}
      return originalStart(kind,id,options);
    };
  }
  window.__levroPaymentRepairReady=true;
})();
