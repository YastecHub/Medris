/* ---- script ---- */
(function(){
  /* ---------------------------------------------------------------
     1. MESSAGING REALTIME, make incoming messages paint immediately.
     The old handler waited for a parent-reply query before inserting the
     message. That extra query could make a message feel delayed on mobile.
     Paint first, enrich second. Also reconnect the conversation channel if
     Supabase times out.
     --------------------------------------------------------------- */
  const originalSubscribeToConversation = window.subscribeToConversation;
  if (typeof originalSubscribeToConversation === 'function' && !window.__levroImmediateMessageRealtime) {
    window.__levroImmediateMessageRealtime = true;
    window.subscribeToConversation = async function(conversationId){
      try { await originalSubscribeToConversation.apply(this, arguments); } catch(e) { console.warn('[Levromart] conversation realtime setup failed:', e); }
      const channel = window.activeMsgChannel || (typeof activeMsgChannel !== 'undefined' ? activeMsgChannel : null);
      if (!channel || !conversationId || !session) return;
      /* The original channel already has its INSERT handler. Add a tiny
         duplicate-safe listener only for the case where the original handler
         is waiting on a reply-parent query. */
      if (channel.__levroFastInsertBound) return;
      channel.__levroFastInsertBound = true;
      channel.on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:`conversation_id=eq.${conversationId}` }, (payload)=>{
        if (activeConversationId !== conversationId || payload?.new?.sender_id === session.user.id) return;
        const el = byId('chatMessages');
        if (!el || el.querySelector(`.chat-bubble[data-msg-id="${CSS.escape(String(payload.new.id))}"]`)) return;
        const msg = { ...payload.new };
        el.insertAdjacentHTML('beforeend', chatBubbleHtml(msg));
        scrollChatToBottom();
        resolveVisibleAttachments(el);
        setupMessageInteractions(el);
        /* Enrich the reply quote after the bubble is already visible. */
        if (msg.reply_to_id) {
          sb.from('messages').select('id,sender_id,body,attachment_name,deleted_at').eq('id',msg.reply_to_id).maybeSingle().then(({data:parent})=>{
            const b = el.querySelector(`.chat-bubble[data-msg-id="${CSS.escape(String(msg.id))}"]`);
            if (!b || !parent) return;
            const holder = document.createElement('div');
            holder.innerHTML = replyQuoteHtml({reply_to:parent});
            const old = b.querySelector('.chat-reply-quote');
            if (old) old.replaceWith(holder.firstElementChild);
          }).catch(()=>{});
        }
        sb.from('messages').update({read_at:new Date().toISOString(),delivered_at:new Date().toISOString()}).eq('id',msg.id).then(()=>refreshNotifications()).catch(()=>{});
      });
    };
  }

  /* ---------------------------------------------------------------
     2. SWIPE REPLY, easier on iPhone. Use a larger activation threshold,
     a capped movement, and release the transform on every termination path.
     --------------------------------------------------------------- */
  const originalSetupMessageSwipeReply = window.setupMessageSwipeReply;
  if (typeof originalSetupMessageSwipeReply === 'function' && !window.__levroBetterSwipeReply) {
    window.__levroBetterSwipeReply = true;
    window.setupMessageSwipeReply = function(root){
      const el = root || document;
      el.querySelectorAll?.('.chat-bubble-wrap[data-msg-wrap-id]').forEach((wrap)=>{
        if (wrap.dataset.betterSwipeReplyBound) return;
        const bubble = wrap.querySelector('.chat-bubble[data-msg-id]');
        if (!bubble || bubble.classList.contains('deleted')) return;
        wrap.dataset.betterSwipeReplyBound = '1';
        let sx=0,sy=0,dx=0,dy=0,tracking=false,horizontal=false;
        const mine = bubble.classList.contains('mine');
        const reset = ()=>{
          tracking=false; horizontal=false; dx=dy=0;
          wrap.classList.remove('chat-swipe-active');
          bubble.style.transform='';
        };
        bubble.addEventListener('pointerdown',(e)=>{
          if(chatSelectionMode || (e.pointerType==='mouse' && e.button!==0)) return;
          sx=e.clientX||0; sy=e.clientY||0; dx=dy=0; tracking=true; horizontal=false;
          try{ bubble.setPointerCapture?.(e.pointerId); }catch(_){}
        },{passive:true});
        bubble.addEventListener('pointermove',(e)=>{
          if(!tracking) return;
          dx=(e.clientX||0)-sx; dy=(e.clientY||0)-sy;
          if(!horizontal){
            if(Math.abs(dy)>9 && Math.abs(dy)>Math.abs(dx)*1.1){ reset(); return; }
            if(Math.abs(dx)<5) return;
            horizontal=Math.abs(dx)>Math.abs(dy)*0.65;
            if(!horizontal) return;
            wrap.classList.add('chat-swipe-active');
          }
          // WhatsApp-like direction: incoming → right, own → left.
          const allowed = mine ? dx < 0 : dx > 0;
          if(!allowed){ bubble.style.transform='translate3d(0,0,0)'; return; }
          e.preventDefault();
          const shift = mine ? Math.max(-72,Math.min(0,dx*0.95)) : Math.min(72,Math.max(0,dx*0.95));
          bubble.style.transform=`translate3d(${shift}px,0,0)`;
        },{passive:false});
        const finish=()=>{
          if(!tracking) return;
          const allowed = mine ? dx < 0 : dx > 0;
          const shouldReply = horizontal && allowed && Math.abs(dx)>=28;
          const id=bubble.dataset.msgId;
          reset();
          if(shouldReply && id){
            wrap.classList.add('chat-swipe-reply');
            setChatReplyTarget(id);
            setTimeout(()=>wrap.classList.remove('chat-swipe-reply'),240);
          }
        };
        bubble.addEventListener('pointerup',finish,{passive:true});
        bubble.addEventListener('pointercancel',reset,{passive:true});
        bubble.addEventListener('lostpointercapture',finish,{passive:true});
      });
    };
  }

  /* ---------------------------------------------------------------
     3. VENDOR PAGE, horizontal vendor rail above the map + See all.
     Keep the existing grid/list/map controls intact.
     --------------------------------------------------------------- */
  function vendorRailHtml(){
    const all=Array.isArray(window.__filteredVendors)?window.__filteredVendors:[];
    if(!all.length) return '<div class="vendors-map-vendor-rail-head"><strong>Vendors</strong></div><div class="muted" style="padding:.2rem 0 .7rem;font-size:.8rem;">No vendors match these filters.</div>';
    const visible=all.slice(0,6);
    const chips=visible.map(v=>{
      const logo=v.logo_url?`<img src="${esc(v.logo_url)}" alt="" loading="lazy" />`:avatarFallbackHtml(v.business_name||'Vendor','2.8rem','',v.business_name||'Vendor');
      const dist=(buyerLocation&&v.lat!=null&&v.lng!=null)?formatDistanceKm(haversineKm(buyerLocation.lat,buyerLocation.lng,v.lat,v.lng)):'';
      return `<button type="button" class="vendors-map-vendor-chip" onclick="focusVendorOnMap('${esc(v.id)}')">${logo}<span class="vendors-map-vendor-chip-copy"><strong>${esc(v.business_name||'Vendor')}</strong><small>${esc(v.city||'Online')}${dist?' · '+esc(dist):''}</small></span><span class="vendors-map-vendor-chip-action">View on map</span></button>`;
    }).join('');
    return `<div class="vendors-map-vendor-rail-head"><strong>Vendors</strong>${all.length>6?`<button type="button" onclick="switchVendorsView('list')">See all →</button>`:''}</div><div class="vendors-map-vendor-rail">${chips}</div>`;
  }
  window.focusVendorOnMap = function(vendorId){
  const list = Array.isArray(window.__filteredVendors) ? window.__filteredVendors : [];
  const target = list.find(v => String(v.id) === String(vendorId));
  if (!target || target.lat == null || target.lng == null) {
    showToast("This vendor has not added a map location yet.", "info");
    return;
  }
  const keepY = window.scrollY, keepEl = document.scrollingElement || document.documentElement;
  [0, 60, 150, 300, 500, 800].forEach((ms) => setTimeout(() => { if (Math.abs((window.scrollY || 0) - keepY) > 2) keepEl.scrollTop = keepY; }, ms));
  if (vendorsViewMode !== "map" || byId("vendorsMapWrap")?.classList.contains("hidden")) { vendorsViewMode = "map"; switchVendorsView("map"); }
  const focus = () => {
    if (!vendorsMap) return;
    vendorsMap.setView([Number(target.lat), Number(target.lng)], Math.max(vendorsMap.getZoom(), 15), { animate:true, duration:.45 });
    const geo = (window.__filteredVendors || []).filter(v => v.lat != null && v.lng != null);
    const idx = geo.findIndex(v => String(v.id) === String(target.id));
    const offset = buyerLocation ? 1 : 0;
    const m = idx >= 0 ? vendorsMapMarkers[idx + offset] : null;
    if (m?.openPopup) m.openPopup();
  };
  requestAnimationFrame(() => requestAnimationFrame(focus));
  setTimeout(focus, 180);
};

window.renderVendorMapRail = function(){
    const wrap=byId('vendorsMapVendorRail');
    if(wrap) wrap.innerHTML=vendorRailHtml();
  };

  const originalVendorRender=window.renderVendorsDirectory;
  if(typeof originalVendorRender==='function' && !window.__levroVendorRailInjected){
    window.__levroVendorRailInjected=true;
    window.renderVendorsDirectory=function(){
      let html=originalVendorRender.apply(this,arguments);
      const needle='<div id="vendorsMapWrap" class="hidden">';
      // Keep the horizontal rail inside the map wrapper. That makes the
      // rail exist only in map mode and guarantees it sits directly above the
      // map rather than becoming a second vendor-card section on the page.
      if(html.includes(needle) && !html.includes('vendorsMapVendorRail')) html=html.replace(needle,`<div id="vendorsMapWrap" class="hidden"><div id="vendorsMapVendorRail"></div>`);
      return html;
    };
  }
  const originalVendorFilter=window.filterVendorsDirectory;
  if(typeof originalVendorFilter==='function' && !window.__levroVendorRailFilter){
    window.__levroVendorRailFilter=true;
    window.filterVendorsDirectory=function(){
      originalVendorFilter.apply(this,arguments);
      window.renderVendorMapRail?.();
    };
  }
  const originalVendorRenderCards=window.renderVendorDirectoryCards;
  if(typeof originalVendorRenderCards==='function' && !window.__levroVendorRailCards){
    window.__levroVendorRailCards=true;
    window.renderVendorDirectoryCards=function(){
      originalVendorRenderCards.apply(this,arguments);
      window.renderVendorMapRail?.();
    };
  }

  /* Robustly destroy a stale Leaflet instance when SPA navigation replaced its
     DOM node. This fixes the blank-map-after-back problem. */
  const originalVendorMap=window.renderVendorsMap;
  if(typeof originalVendorMap==='function' && !window.__levroMapReattach){
    window.__levroMapReattach=true;
    window.renderVendorsMap=async function(){
      const el=byId('vendorsMap');
      if(!el)return;
      try{
        if(typeof vendorsMap!=='undefined' && vendorsMap && vendorsMap._container!==el){
          try{vendorsMap.remove();}catch(_){ }
          vendorsMap=null;
          if(typeof vendorsMapMarkers!=='undefined') vendorsMapMarkers=[];
        }
      }catch(_){ }
      const result=await originalVendorMap.apply(this,arguments);
      requestAnimationFrame(()=>requestAnimationFrame(()=>{try{vendorsMap?.invalidateSize(true);}catch(_){}}));
      setTimeout(()=>{try{vendorsMap?.invalidateSize(true);}catch(_){}},180);
      return result;
    };
  }

  /* ---------------------------------------------------------------
     4. ADD (+) BUTTON, one clear chooser for Product, Service, Package.
     The product modal's existing service checkbox remains available when
     editing; the chooser simply makes the three listing types explicit.
     --------------------------------------------------------------- */
  window.openAddChooser=function(){
    if(!session||!vendor){showLogin();return;}
    if(byId('addListingChooser')){byId('addListingChooser').classList.remove('hidden');return;}
    const modal=document.createElement('div');
    modal.id='addListingChooser'; modal.className='modal';
    modal.innerHTML=`<div class="modal-content"><div class="drawer-header"><h3 style="margin:0;"><i class="fa-solid fa-plus"></i> Add to your shop</h3><button type="button" class="drawer-close-btn" onclick="byId('addListingChooser')?.remove()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><p class="muted" style="margin:.25rem 0 .7rem;">Choose what you want to add.</p>
      <button type="button" class="add-listing-choice" onclick="chooseAddListing('product')"><i class="fa-solid fa-box"></i><span class="add-listing-choice-copy"><strong>Product</strong><small>Sell or rent a physical item.</small></span></button>
      <button type="button" class="add-listing-choice" onclick="chooseAddListing('service')"><i class="fa-solid fa-hand-holding-heart"></i><span class="add-listing-choice-copy"><strong>Service</strong><small>Offer a service with its own price or rate.</small></span></button>
      <button type="button" class="add-listing-choice" onclick="chooseAddListing('package')"><i class="fa-solid fa-box-open"></i><span class="add-listing-choice-copy"><strong>Package</strong><small>Bundle your products into one fixed-price deal.</small></span></button>
    </div>`;
    document.body.appendChild(modal); trackModalOpened('addListingChooser');
  };
  window.chooseAddListing=async function(type){
    byId('addListingChooser')?.remove();
    window.__lfWant=(type==='service')?'service':(type==='product'?'product':null);
    if(type==='package'){ await openAddPackageModal(); return; }
    await window.openAddProductModal();
    if(type==='service'){
      const cb=byId('prodIsService');
      if(cb){cb.checked=true;updateProductFormFields();updateProductSaveButtonLabel();}
    }
  };
  /* Make any remaining plus trigger use the chooser. */
  document.querySelectorAll?.('.bottom-nav-add').forEach(btn=>{btn.setAttribute('onclick','openAddChooser()');btn.title='Add listing';});

  /* Notification grouping intentionally handled by the final compact summary renderer. */
})();
