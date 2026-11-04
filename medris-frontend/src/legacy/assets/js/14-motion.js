/* ---- app-like motion: pages slide/fade in, and a re-render that changes nothing no longer wipes and redraws the screen ---- */
(function(){
  "use strict";
  var app=document.getElementById("app"); if(!app) return;
  var desc=Object.getOwnPropertyDescriptor(Element.prototype,"innerHTML"); if(!desc||!desc.set) return;
  var reduce=false; try{ reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(_){}
  var TABS={home:1,vendors:1,search:1,notifications:1,vendorOrders:1,buyerOrders:1,buyerProfile:1,vendorDashboard:1,requestEquipment:1,vendorRequests:1,cart:1,wishlist:1,messages:1};
  var NAVPOS={home:0,vendors:1,vendorsMap:1,requestEquipment:2,vendorRequests:2,notifications:3,buyerOrders:4,vendorOrders:4};
  var last={html:null,gen:-1,view:null}, goingBack=false, animTimer=null;
  // Small pictures are shown at 50-170 px, but profile pictures and shop logos are stored as 800 px originals (about 40 million
  // pixels on Home alone, which is what makes scrolling and dragging heavy on a phone). Cards, rows and lists get right-sized copies;
  // the full photo is still used on the product page and the profile picture viewer.
  var FULLSIZE = { productDetail: 1, packageDetail: 1, orderDetail: 1, adminPanel: 1, adminPeople: 1 };
  window.lvSlimImgs = function (html, vw) {
    try {
      if (typeof lvThumb !== "function" || html.indexOf("<img") < 0) return html;
      return html.replace(/(<img\b[^>]*?\ssrc=")(https?:\/\/[^"]+)(")/g, function (m, a, u, z) {
        if (u.indexOf("wsrv.nl") >= 0) return m;
        var w = u.indexOf("/avatars/") >= 0 ? 160 : u.indexOf("/vendor-logos/") >= 0 ? 240 : (u.indexOf("/product-photos/") >= 0 && !FULLSIZE[vw]) ? 360 : 0;
        if (!w) return m;
        var t = lvThumb(u.replace(/&amp;/g, "&"), w);
        return t === u ? m : a + t.replace(/&/g, "&amp;") + z;
      });
    } catch (_) { return html; }
  };
  window.addEventListener("popstate",function(){ goingBack=true; });
  function gen(){ try{ return navigationGeneration; }catch(_){ return -1; } }
  function view(){ try{ return currentView; }catch(_){ return ""; } }
  function animate(el,frames,ms){
    var root=document.documentElement; root.classList.add("lv-anim"); clearTimeout(animTimer); animTimer=setTimeout(function(){root.classList.remove("lv-anim");},ms+60);
    try{ el.animate(frames,{duration:ms,easing:"cubic-bezier(.22,.8,.24,1)"}); }catch(_){}
  }
  // Parts of Home that are expensive to redraw (the banner carousel, the category row) are kept alive when the page is
  // swapped or revisited, as long as their content is unchanged. Redrawing them is what made them blink.
  function resumeCarousel(){
    try{
      var vp=document.getElementById("homePromotionalViewport"); if(!vp) return;
      if(homeCarouselTimer){ clearInterval(homeCarouselTimer); homeCarouselTimer=null; }
      if(vp.dataset.loop!=="1"||reduce) return;
      homeCarouselPause(HOME_CAROUSEL_INTERVAL_MS);
      homeCarouselTimer=setInterval(function(){
        if(!vp.isConnected){ clearInterval(homeCarouselTimer); homeCarouselTimer=null; return; }
        if(document.hidden||window.__lvDragging||Date.now()<homeCarouselResumeAt) return;
        var r=vp.getBoundingClientRect(); if(r.bottom<0||r.top>window.innerHeight) return;
        var step=homeCarouselStep(vp); if(!step) return;
        homeCarouselGoTo(vp,Math.round(vp.scrollLeft/step)+1);
      },HOME_CAROUSEL_INTERVAL_MS);
    }catch(_){}
  }
  window.lvResumeCarousel=resumeCarousel;
  var KEEP=[
    {sel:"#homePromotionalCarousel",
     sig:function(n){ return Array.prototype.map.call(n.querySelectorAll(".home-promotional-slide:not([data-clone]):not([data-wv])"),function(b){ var i=b.querySelector("img"); return (i?(i.getAttribute("src")||""):"")+"|"+(b.getAttribute("data-link-url")||"")+"|"+(b.getAttribute("aria-label")||""); }).join(";"); },
     scroll:function(n){ var v=n.querySelector("#homePromotionalViewport"); return v?v.scrollLeft:0; },
     after:function(n,sc){ var v=n.querySelector("#homePromotionalViewport"); requestAnimationFrame(function(){ if(v&&sc){ v.style.scrollSnapType="none"; v.scrollLeft=sc; requestAnimationFrame(function(){ v.style.scrollSnapType=""; }); } resumeCarousel(); }); }},
    {sel:".levro-home-cat-rail",
     sig:function(n){ return Array.prototype.map.call(n.children,function(c){ return (c.getAttribute("data-cat")||c.textContent.trim())+(c.classList.contains("active")?"*":""); }).join(","); },
     scroll:function(n){ return n.scrollLeft; },
     after:function(n,sc){ if(sc) requestAnimationFrame(function(){ n.scrollLeft=sc; }); }}
  ];
  var stash={};
  // Lists of cards (vendors, products) and chip rows are updated card by card: a card whose markup did not change keeps
  // its DOM node (so its image stays decoded and nothing blinks); only new or changed cards are swapped in.
  var inner=Object.getOwnPropertyDescriptor(Element.prototype,"innerHTML");
  function cardKey(c){
    if(!c||c.nodeType!==1) return "";
    var d=c.dataset||{}; if(d.vendorId) return "v:"+d.vendorId; if(d.productId) return "p:"+d.productId;
    var oc=c.getAttribute("onclick")||""; var m=/vendorId:\s*'([^']+)'/.exec(oc); if(m) return "v:"+m[1];
    return "";
  }
  function chipKey(c){ return c&&c.nodeType===1?(c.getAttribute("data-cat")||c.getAttribute("data-id")||c.getAttribute("data-value")||c.textContent.trim()):""; }
  var SMART=[{sel:"#vendorsGrid",key:cardKey},{sel:"#productGrid",key:cardKey},{sel:"#vendorCatChips",key:chipKey}];
  function installSmart(root){
    SMART.forEach(function(sm){
      var el=root.querySelector(sm.sel); if(!el||el.__lvSmart) return; el.__lvSmart=1;
      Array.prototype.forEach.call(el.children,function(c){ if(c.__lvRaw==null) c.__lvRaw=c.outerHTML; });
      Object.defineProperty(el,"innerHTML",{configurable:true,
        get:function(){ return inner.get.call(this); },
        set:function(v){
          var html=window.lvSlimImgs(String(v), view());
          if(el.__lvLast===html) return;
          el.__lvLast=html;
          var t=document.createElement("template"); t.innerHTML=html;
          var next=Array.prototype.slice.call(t.content.children), cur=Array.prototype.slice.call(el.children);
          var keyed=next.length&&cur.length&&next.every(function(n){return !!sm.key(n);})&&cur.every(function(c){return !!sm.key(c);});
          if(!keyed||t.content.childNodes.length!==next.length||el.childNodes.length!==cur.length){ inner.set.call(el,html); Array.prototype.forEach.call(el.children,function(c){ c.__lvRaw=c.outerHTML; }); return; }
          var byKey=new Map(); cur.forEach(function(c){ byKey.set(sm.key(c),c); });
          var out=next.map(function(n){
            var raw=n.outerHTML, old=byKey.get(sm.key(n));
            if(old&&old.__lvRaw===raw){ byKey.delete(sm.key(n)); return old; }
            n.__lvRaw=raw; return n;
          });
          // only touch the DOM where something actually differs
          var same=out.length===cur.length&&out.every(function(n,i){return n===cur[i];});
          if(!same){ el.replaceChildren.apply(el,out); }
        }
      });
    });
  }
  installSmart(document);
  Object.defineProperty(app,"innerHTML",{configurable:true,
    get:function(){ return desc.get.call(this); },
    set:function(v){
      var g=gen(), vw=view(), html=window.lvSlimImgs(String(v), vw); v=html;
      var sameNav=(g===last.gen&&vw===last.view);
      // the cached page and the freshly loaded page are identical: leave the screen exactly as it is
      if(sameNav&&html===last.html) return;
      if(last.forced&&html===last.html&&vw==="search"){ last.forced=false; return; }
      var prevView=last.view, self=this;
      KEEP.forEach(function(k){ if(html.indexOf(k.sel.slice(1))<0) { delete stash[k.sel]; return; } var n=self.querySelector(k.sel); if(n) stash[k.sel]={node:n,sig:k.sig(n),scroll:k.scroll(n)}; });   // only read the old page (which forces it to be laid out) when the new one will reuse that part
      var liveBar=document.getElementById("lvCampusBar"); if(liveBar) window.__lvBarStash=liveBar;
      desc.set.call(this,v);
      KEEP.forEach(function(k){
        var st=stash[k.sel], nw=self.querySelector(k.sel);
        if(st&&nw&&nw!==st.node&&k.sig(nw)===st.sig){ nw.replaceWith(st.node); k.after(st.node,st.scroll); }
      });
      last={html:html,gen:g,view:vw};
      installSmart(this);
      if(reduce||!this.animate||window.__lvSwipeNav) return;
      if(window.__lvForceSlide){ window.__lvForceSlide=false; last.forced=true; animate(this,[{opacity:.2,transform:"translateX(32%)"},{opacity:1,transform:"none"}],230); goingBack=false; return; }
      if(sameNav){ animate(this,[{opacity:.6},{opacity:1}],150); return; }
      var chat=document.body&&document.body.classList.contains("chat-full-page");
      var tabSwitch=!!(TABS[prevView]&&TABS[vw]);
      if(chat) animate(this,[{opacity:0},{opacity:1}],180);
      else if(vw==="home"&&!goingBack&&tabSwitch) animate(this,[{opacity:.55},{opacity:1}],110);   // Home just appears: no slide, no wait
      else if(goingBack) animate(this,[{opacity:.2,transform:"translateX(-30%)"},{opacity:1,transform:"none"}],230);
      else if(tabSwitch&&NAVPOS[prevView]!=null&&NAVPOS[vw]!=null&&NAVPOS[prevView]!==NAVPOS[vw]){
        // the bottom bar: the page comes in from the side the tapped tab is on
        var dir=NAVPOS[vw]>NAVPOS[prevView]?1:-1;
        animate(this,[{opacity:.2,transform:"translateX("+(dir*30)+"%)"},{opacity:1,transform:"none"}],230);
      }
      else animate(this,[{opacity:.2,transform:"translateX(32%)"},{opacity:1,transform:"none"}],230);
      goingBack=false;
    }
  });
})();

/* Drag any bottom sheet down from anywhere on it (Levi, comments, share, pop-up cards), like WhatsApp and TikTok.
   The sheet follows the finger exactly (no jump when the drag starts), the page behind never scrolls, the dimmed backdrop
   fades as the sheet goes down, and on release it either glides away or settles back, depending on how far and how fast
   it was pulled. It only follows the finger when its own content is scrolled to the top, so normal scrolling is untouched. */
(function () {
  var SHEETS = [
    { sel: "#aiChatPanel:not(.hidden)", close: function () { try { toggleAiChat(); } catch (_) {} }, back: null,
      // Levi only follows a drag that starts on his top bar or on empty chat space: never on buttons, the chat list, the select toolbar or the box
      allow: function (t, sheet) {
        if (t.closest("button,a,input,textarea,select,label,.ai-chat-history-item,.ai-history-select-toolbar,.ai-chat-input-row,.levi-tools")) return false;
        if (sheet.classList.contains("history-mode") && !t.closest(".drawer-header")) return false;
        if (sheet.classList.contains("lv-full")) return false;
        if (document.querySelector(".lv-dlg,#confirmModal.open,.modal.open")) return false;
        return true;
      } },
    { sel: ".lv-cs-card", close: function (el) { var x = el.querySelector(".lv-cs-x"); if (x) x.click(); }, back: ".lv-cs-back", own: ".lv-cs-head" },
    { sel: ".lv-cm-card", close: function (el) { var b = el.parentNode && el.parentNode.querySelector(".lv-cm-back"); if (b) b.click(); }, back: ".lv-cm-back", own: ".lv-cm-card" },
    { sel: ".vendors-filters-panel:not(.hidden)", close: function () { try { toggleVendorsFilters(false); } catch (_) {} }, back: ".lv-sheet-back" },
    { sel: ".browse-filter-panel:not(.hidden)", close: function () { try { toggleBrowseFilters(false); } catch (_) {} }, back: ".lv-sheet-back" },
    { sel: "#messagesMoreMenu:not(.hidden)", close: function () { var m = document.getElementById("messagesMoreMenu"); if (m) m.classList.add("hidden"); }, back: ".lv-sheet-back" },
    { sel: ".order-filters-panel:not(.hidden)", close: function () { try { window.closeLevromartTransientFilters(); } catch (_) {} }, back: ".lv-sheet-back" },
    { sel: "#storefrontShareModal:not(.hidden) .storefront-share-sheet", close: function (el) { var m = el.closest("#storefrontShareModal"); if (m) m.dispatchEvent(new MouseEvent("click", { bubbles: false })); }, back: null }
  ];
  var START_SLOP = 8;          // px of movement before it counts as a drag
  var cur = null, raf = 0;
  function put(el, prop, val) { el.style.setProperty(prop, val, "important"); }   // beats the sheets' own !important transforms
  function clear(el) { el.style.removeProperty("transform"); el.style.removeProperty("transition"); el.style.removeProperty("will-change"); }
  function scrolledDown(target, sheet) {
    for (var n = target; n && n.nodeType === 1; n = n.parentNode) {
      if (n.scrollHeight > n.clientHeight + 2 && n.scrollTop > 0 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return true;
      if (n === sheet) break;
    }
    return false;
  }
  function backdropOf(c) { return c.s.back ? (c.el.parentNode && c.el.parentNode.querySelector(c.s.back)) : null; }
  function paint() {
    raf = 0;
    if (!cur) return;
    put(cur.el, "transform", "translate3d(0," + cur.offset + "px,0)");
    if (cur.back) cur.back.style.opacity = String(Math.max(0, 1 - cur.offset / Math.max(1, cur.height)));
  }
  function velocity(c) {   // px per ms over the last ~100 ms
    var h = c.trail, last = h[h.length - 1], first = last;
    for (var i = h.length - 1; i >= 0 && last.t - h[i].t <= 100; i--) first = h[i];
    return last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
  }
  function settle(c, closing) {
    var el = c.el, back = c.back;
    var done = false;
    function finish() {
      if (done) return; done = true;
      if (closing) c.s.close(el);
      clear(el);
      if (back) back.style.removeProperty("opacity");
    }
    put(el, "transition", closing ? "transform .26s cubic-bezier(.3,.7,.4,1)" : "transform .34s cubic-bezier(.2,.9,.25,1.05)");
    put(el, "transform", closing ? "translate3d(0," + (c.height + 24) + "px,0)" : "translate3d(0,0,0)");
    if (back) { back.style.transition = "opacity .26s ease"; back.style.opacity = closing ? "0" : "1"; }
    el.addEventListener("transitionend", function te(e) { if (e.target !== el) return; el.removeEventListener("transitionend", te); finish(); });
    setTimeout(finish, 420);
  }
  function stopTheirs(e, c) { if (c && c.s.own && e.target.closest && e.target.closest(c.s.own)) e.stopPropagation(); }  // replaces the sheets' older, jumpier handlers

  document.addEventListener("touchstart", function (e) {
    cur = null;
    if (e.touches.length !== 1) return;
    var t = e.target;
    if (!t.closest) return;
    for (var i = 0; i < SHEETS.length; i++) {
      var sheet = t.closest(SHEETS[i].sel);
      if (!sheet) continue;
      if (SHEETS[i].allow && !SHEETS[i].allow(t, sheet)) return;
      var c = { s: SHEETS[i], el: sheet, y: e.touches[0].clientY, x: e.touches[0].clientX, on: false, offset: 0, height: sheet.getBoundingClientRect().height, trail: [], back: null };
      stopTheirs(e, c);
      if (t.closest("textarea,input,select,[contenteditable],.leaflet-container") || scrolledDown(t, sheet)) return;
      c.trail.push({ y: c.y, t: e.timeStamp });
      cur = c;
      return;
    }
  }, { passive: true, capture: true });

  document.addEventListener("touchmove", function (e) {
    if (!cur) return;
    stopTheirs(e, cur);
    var y = e.touches[0].clientY, dy = y - cur.y, dx = Math.abs(e.touches[0].clientX - cur.x);
    if (!cur.on) {
      if (dy > START_SLOP && dy > dx * 1.4) {
        cur.on = true;
        cur.back = backdropOf(cur);
        put(cur.el, "transition", "none");
        put(cur.el, "will-change", "transform");
        if (cur.back) cur.back.style.transition = "none";
      } else if (dy < -START_SLOP || dx > 14) { cur = null; return; }
      else return;
    }
    cur.offset = Math.max(0, dy - START_SLOP);     // the sheet starts moving from where the drag began, so there is no jump
    cur.trail.push({ y: y, t: e.timeStamp });
    if (cur.trail.length > 8) cur.trail.shift();
    if (e.cancelable) e.preventDefault();          // the page behind must not scroll while the sheet is being dragged
    if (!raf) raf = requestAnimationFrame(paint);
  }, { passive: false, capture: true });

  function end(e) {
    if (!cur) return;
    stopTheirs(e, cur);
    var c = cur; cur = null;
    if (!c.on) return;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    var v = velocity(c);
    settle(c, c.offset > c.height * 0.3 || (v > 0.55 && c.offset > 24));
  }
  document.addEventListener("touchend", end, { passive: true, capture: true });
  document.addEventListener("touchcancel", end, { passive: true, capture: true });
})();

/* ===== Pay now with Paystack (issue #96) =====
   Shown only when the backend says the Paystack switch is on; then Paystack is the only way to pay an order in the app.
   The amount always comes from the server; nothing is marked paid in the browser. */
(function () {
  "use strict";
  var origDirect = window.openVendorDirectPayment;
  var onCache = null, onAt = 0;
  function naira(n) { try { return "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 }); } catch (_) { return "₦" + n; } }
  function paystackOn() {
    if (onCache !== null && Date.now() - onAt < 60000) return Promise.resolve(onCache);
    if (!window.levroData || !window.levroData.payments) return Promise.resolve(false);
    return window.levroData.payments.config().then(function (r) { onCache = !!(r && r.data && r.data.paystackCheckout); onAt = Date.now(); window.__lvPaystackKnownOn = onCache; return onCache; }, function () { return false; });
  }
  window.lvPaystackOn = paystackOn;
  function closeModal() { var m = document.getElementById("lvPayModal"); if (m) m.remove(); }
  function openModal(html, extra) {
    closeModal();
    var m = document.createElement("div");
    m.id = "lvPayModal"; m.className = "modal lv-pm open" + (extra ? " " + extra : "");
    m.innerHTML = '<div class="modal-content lv-pm-card" role="dialog" aria-modal="true" aria-labelledby="lvPmTitle">' + html + "</div>";
    m.addEventListener("click", function (e) { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    return m;
  }

  // "Pay" on an order: when Paystack checkout is on, it goes straight to the Paystack summary (no bank-transfer option).
  // When it is off, the original bank-transfer screen opens as before.
  window.openVendorDirectPayment = async function (orderId) {
    var args = arguments;
    if (!orderId || typeof session === "undefined" || !session) return origDirect.apply(this, args);
    var on = await paystackOn();
    if (!on) return origDirect.apply(this, args);
    // pay with the Levromart wallet (no fee) or with Paystack
    if (window.lvW3ChoosePay) {
      var total = null;
      try { var o = (await sb.from("orders").select("total_amount").eq("id", orderId).maybeSingle()).data; total = o && o.total_amount; } catch (_) {}
      return window.lvW3ChoosePay(orderId, total, function () { return startPaystack(orderId); });
    }
    return startPaystack(orderId);
  };

  // Step 2: ask the server what to pay, show it, then continue to Paystack
  async function startPaystack(orderId) {
    openModal('<div class="lv-pm-head"><h3 id="lvPmTitle">Getting your payment ready…</h3></div><p class="muted" role="status" aria-live="polite">Please wait a moment.</p>');
    var r = await window.levroData.payments.initialize(orderId);
    if (r.error || !r.data) {
      openModal('<div class="lv-pm-head"><h3 id="lvPmTitle">We could not start the payment</h3></div><p class="lv-pm-err" role="alert">' + esc((r.error && r.error.message) || "Please try again.") + '</p>' + (r.error && (r.error.code || r.error.status) ? '<p class="muted" style="font-size:.72rem;margin:.25rem 0 0">Code: ' + esc([r.error.code, r.error.status].filter(Boolean).join(" ")) + '</p>' : '') + '<div class="lv-pm-actions"><button type="button" class="btn" onclick="document.getElementById(\'lvPayModal\')?.remove()">Close</button></div>');
      return;
    }
    var d = r.data;
    // what is being paid for: the shop, the items and the delivery, so the buyer sees exactly what the money covers
    var o = null;
    try { o = (await sb.from("orders").select("id,total_amount,delivery_fee,delivery_method,vendor:vendors(business_name,logo_url),items:order_items(quantity,unit_price,product:products(name,photos))").eq("id", orderId).maybeSingle()).data; } catch (_) {}
    var items = (o && o.items) || [], shop = (o && o.vendor) || {}, delivery = Number((o && o.delivery_fee) || 0);
    var itemsTotal = items.reduce(function (t, it) { return t + Number(it.unit_price || 0) * Number(it.quantity || 1); }, 0);
    var thumb = function (it) { var ph = it.product && Array.isArray(it.product.photos) ? it.product.photos[0] : ""; return ph ? '<img src="' + esc(typeof lvThumb === "function" ? lvThumb(ph, 120) : ph) + '" alt="">' : '<span class="lvp-ph"><i class="fa-solid fa-box"></i></span>'; };
    var shopPic = shop.logo_url ? '<img src="' + esc(typeof lvThumb === "function" ? lvThumb(shop.logo_url, 96) : shop.logo_url) + '" alt="">' : '<span>' + esc(String(shop.business_name || "S").trim().slice(0, 1).toUpperCase()) + "</span>";
    openModal(
      '<div class="lvp-grab" aria-hidden="true"></div>' +
      '<div class="lvp-top"><h3 class="lvp-title" id="lvPmTitle">Checkout</h3><button type="button" class="lvp-x" aria-label="Close" onclick="document.getElementById(\'lvPayModal\')?.remove()"><i class="fa-solid fa-xmark"></i></button></div>' +
      (shop.business_name ? '<div class="lvp-shop"><span class="lvp-shop-pic">' + shopPic + '</span><div><small>Paying</small><b>' + esc(shop.business_name) + '</b></div><span class="lvp-ref">#' + esc(String(orderId).slice(0, 8).toUpperCase()) + "</span></div>" : "") +
      (items.length ? '<ul class="lvp-items">' + items.slice(0, 4).map(function (it) { return "<li>" + thumb(it) + '<div><b>' + esc((it.product && it.product.name) || "Item") + "</b><small>Qty " + esc(String(it.quantity || 1)) + "</small></div><span>" + esc(naira(Number(it.unit_price || 0) * Number(it.quantity || 1))) + "</span></li>"; }).join("") + (items.length > 4 ? '<li class="lvp-more">+' + (items.length - 4) + " more</li>" : "") + "</ul>" : "") +
      '<ul class="lvp-rows">' +
        (items.length && Math.abs(itemsTotal + delivery - Number(d.orderAmountNaira)) < 0.01 ? "<li><span>Items</span><b>" + esc(naira(itemsTotal)) + "</b></li>" + (delivery ? "<li><span>Delivery</span><b>" + esc(naira(delivery)) + "</b></li>" : "") : "<li><span>Order amount</span><b>" + esc(naira(d.orderAmountNaira)) + "</b></li>") +
        "<li><span>Payment fee</span><b>" + esc(naira(d.feeNaira)) + "</b></li>" +
        '<li class="lvp-total"><span>Total</span><b>' + esc(naira(d.amountNaira)) + "</b></li>" +
      "</ul>" +
      '<p class="lvp-note"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i><span>Levromart holds your money safely. The shop is paid only after you confirm you have your order.</span></p>' +
      '<button type="button" class="lvp-pay" id="lvPmGo"><i class="fa-solid fa-lock" aria-hidden="true"></i> Pay ' + esc(naira(d.amountNaira)) + "</button>" +
      '<p class="lvp-foot">Secured by Paystack \u00b7 card, bank transfer or USSD</p>', "lvp"
    );
    var go = document.getElementById("lvPmGo");
    go.addEventListener("click", function () {
      if (go.disabled) return; go.disabled = true; go.textContent = "Opening secure checkout…";   // a second tap must not open a second payment
      openCheckout(orderId, d);
    });
  }

  function loadInline() {
    if (window.PaystackPop) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "https://js.paystack.co/v2/inline.js"; s.async = true;
      var t = setTimeout(function () { resolve(false); }, 4000);
      s.onload = function () { clearTimeout(t); resolve(!!window.PaystackPop); };
      s.onerror = function () { clearTimeout(t); resolve(false); };
      document.head.appendChild(s);
    });
  }
  async function openCheckout(orderId, d) {
    var popup = false;
    try {
      if (await loadInline()) {
        var pop = new window.PaystackPop();
        pop.resumeTransaction(d.accessCode, {
          onSuccess: function () { closeModal(); window.lvConfirmPaystack(d.reference, orderId); },
          onCancel: function () { closeModal(); showToast("Payment cancelled. Nothing was charged.", "info"); },
          onError: function () { closeModal(); showToast("Payment could not be completed. Please try again.", "error"); }
        });
        popup = true;
      }
    } catch (_) { popup = false; }
    if (!popup) { location.href = d.authorizationUrl; }   // popup blocked or unavailable: go to Paystack's page
  }

  // Ask the live server (the same one that settles commission payments) what Paystack says, and settle the order when it is paid.
  window.lvVerifyPayment = async function (reference) {
    try {
      var res = await fetch("/api/verify-payment?reference=" + encodeURIComponent(reference));
      var json = await res.json();
      window.__lvPayInfo = { status: json && json.status, settled: json && json.settled };
      return json && json.status;
    } catch (_) { return undefined; }
  };
  // Checks again and again (about two minutes): "paid", "failed", or "pending" when Paystack has not finished yet.
  window.lvWaitForPayment = async function (reference) {
    var waits = [0, 1200, 2000, 3000, 4000, 6000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000];
    for (var i = 0; i < waits.length; i++) {
      if (waits[i]) await new Promise(function (r) { setTimeout(r, waits[i]); });
      var st = await window.lvVerifyPayment(reference);
      if (st === "success") { try { window.levroData.payments.status(reference); } catch (_) {} return "paid"; }
      if (st === "failed") return "failed";
      try {   // second opinion from the newer backend (it may have settled it already through the webhook)
        var r = await window.levroData.payments.status(reference);
        if (r && r.data && window.levroData.payments.outcomeOf(r.data.status) === "paid") return "paid";
      } catch (_) {}
    }
    return "pending";
  };
  // After Paystack: "Confirming your payment…", then Paid or not completed. Used by the popup and the return link.
  window.lvConfirmPaystack = async function (reference, orderId) {
    openModal('<div class="lv-pm-head"><h3 id="lvPmTitle">Confirming your payment…</h3></div><p class="muted" role="status" aria-live="polite">This usually takes a few seconds. Please do not close the app.</p><div class="lv-pm-spin" aria-hidden="true"></div>');
    var outcome = await window.lvWaitForPayment(reference);
    closeModal();
    var info = window.__lvPayInfo || {};
    // "settled" = this check recorded it; "duplicate" = the webhook or the every-minute check had already recorded it
    if (outcome === "paid" && info.settled === "amount_mismatch") showToast("Paystack took a different amount from your order total, so our team is checking this payment. You do not need to pay again; we will update your order.", "info");
    else if (outcome === "paid" && info.settled && !/^(applied|already_paid|ok|settled|duplicate)/.test(String(info.settled))) showToast("Paystack confirmed your payment, but we could not update your order yet. Please screenshot this and send it to support. Code: " + String(info.settled).slice(0, 140), "error");
    else if (outcome === "paid") showToast("Paid. Thank you!", "success");
    else if (outcome === "failed") showToast("Payment not completed. You were not charged. Please try again.", "error");
    else showToast("We could not confirm that payment yet" + (info.status ? " (Paystack says: " + String(info.status) + ")" : "") + ". It may still be processing; check your order in a minute.", "info");
    if (orderId) { try { await navigate("orderDetail", { orderId: orderId }); } catch (_) {} }
  };

  // Order page: a short line saying the order was paid with Paystack (buyer and vendor wording)
  var origDetail = window.renderOrderDetail;
  if (typeof origDetail === "function") {
    window.renderOrderDetail = async function (orderId) {
      var html = await origDetail.apply(this, arguments);
      try {
        if (typeof html !== "string" || !orderId || typeof session === "undefined" || !session || !(await paystackOn())) return html;
        var q = await Promise.all([
          sb.from("payments").select("provider_reference,status").eq("order_id", orderId).eq("status", "paid").like("provider_reference", "lvm_ord_%").limit(1),
          sb.from("orders").select("buyer_id").eq("id", orderId).maybeSingle()
        ]);
        var paid = q[0] && q[0].data && q[0].data[0];
        if (!paid) {
          // A card or bank-transfer payment can reach Paystack a few minutes after the buyer left: when this order has a payment
          // waiting, ask the server to check it (the same check as the webhook) and reload the page once it is paid.
          try {
            var wait = await sb.from("payments").select("provider_reference").eq("order_id", orderId).eq("status", "pending").like("provider_reference", "lvm_ord_%").order("created_at", { ascending: false }).limit(1);
            var ref = wait && wait.data && wait.data[0] && wait.data[0].provider_reference;
            window.__lvPayChecked = window.__lvPayChecked || {};
            if (ref && Date.now() - (window.__lvPayChecked[ref] || 0) > 20000) {
              window.__lvPayChecked[ref] = Date.now();
              window.lvVerifyPayment(ref).then(function (st) {
                if (st === "success" && typeof currentView !== "undefined" && currentView === "orderDetail") {
                  showToast("Payment confirmed. Thank you!", "success");
                  navigate("orderDetail", { orderId: orderId }, false);
                }
              });
              window.levroData.payments.status(ref).then(function (r) {
                if (r && r.data && window.levroData.payments.outcomeOf(r.data.status) === "paid" && typeof currentView !== "undefined" && currentView === "orderDetail") {
                  showToast("Payment confirmed. Thank you!", "success");
                  navigate("orderDetail", { orderId: orderId }, false);
                }
              }, function () {});
            }
          } catch (_) {}
          if (ref) {
            var isBuyerNow = q[1] && q[1].data && String(q[1].data.buyer_id) === String(session.user.id);
            if (isBuyerNow) return '<div class="lv-pm-note" role="status"><i class="fa-solid fa-rotate"></i><span>Already paid with Paystack? </span><button type="button" class="btn btn-sm" onclick="lvConfirmPaystack(\'' + esc(ref) + '\', \'' + esc(orderId) + '\')">Check my payment</button></div>' + html;
          }
          return html;
        }
        var buyer = q[1] && q[1].data && String(q[1].data.buyer_id) === String(session.user.id);
        var line = buyer ? "Paid with Paystack. Levromart holds the money until you confirm delivery." : "Paid. The money is held by Levromart and sent to your bank after the buyer confirms.";
        return '<div class="lv-pm-note" role="status"><i class="fa-solid fa-shield-halved"></i><span>' + esc(line) + "</span></div>" + html;
      } catch (_) { return html; }
    };
  }
})();

/* ===== Verified payout account (issue #97) =====
   When Paystack checkout is on, the vendor sees the name on the bank account and confirms it is theirs before it is saved.
   The server looks the name up again and checks it matches; the full number is never sent back. */
(function () {
  "use strict";
  var origSave = window.saveVendorBankDetails;
  function fail(msg) { var e = document.getElementById("bankError"); if (e) { e.textContent = msg; e.classList.remove("hidden"); } }
  function confirmName(name, bank, last4) {
    return new Promise(function (resolve) {
      var m = document.createElement("div");
      m.id = "lvAcctModal"; m.className = "modal lv-pm open";
      m.innerHTML = '<div class="modal-content lv-pm-card" role="dialog" aria-modal="true" aria-labelledby="lvAcctTitle">' +
        '<div class="lv-pm-head"><h3 id="lvAcctTitle">Is this your account?</h3></div>' +
        '<p class="lv-pm-acct"><b>' + esc(name) + "</b><br><span class=\"muted\">" + esc(bank || "") + " · ···" + esc(last4 || "") + "</span></p>" +
        '<p class="muted">Your earnings will be sent here. Only confirm if this is your own account.</p>' +
        '<div class="lv-pm-actions"><button type="button" class="btn btn-outline" data-a="no">No, go back</button><button type="button" class="btn" data-a="yes">Yes, this is my account</button></div></div>';
      m.addEventListener("click", function (e) {
        var a = e.target && e.target.getAttribute && e.target.getAttribute("data-a");
        if (a || e.target === m) { m.remove(); resolve(a === "yes"); }
      });
      document.body.appendChild(m);
    });
  }
  window.saveVendorBankDetails = async function () {
    var on = window.lvPaystackOn ? await window.lvPaystackOn() : false;
    if (!on || !window.levroData || !window.levroData.payments.resolveAccount) return origSave.apply(this, arguments);
    var bankCode = String((document.getElementById("veBankCode") || {}).value || "").trim();
    var number = String((document.getElementById("veAccountNumber") || {}).value || "").trim();
    var err = document.getElementById("bankError"); if (err) err.classList.add("hidden");
    if (!/^\d{10}$/.test(number)) return fail("Enter a valid 10-digit account number.");
    if (!bankCode) return fail("Choose a bank.");
    var btn = document.getElementById("saveBankBtn");
    if (btn) { if (btn.disabled) return; btn.disabled = true; }
    try {
      var r = await window.levroData.payments.resolveAccount(bankCode, number);
      if (r.error || !r.data) return fail((r.error && r.error.message) || "We could not find that account. Check the bank and number.");
      if (!(await confirmName(r.data.accountName, r.data.bankName, r.data.accountLast4))) return;
      var s = await window.levroData.payments.savePayoutAccount(bankCode, number, r.data.accountName);
      if (s.error || !s.data) return fail((s.error && s.error.message) || "Could not save your account. Please try again.");
      showToast("Payout account verified: " + s.data.accountName, "success");
      await navigate("vendorEditProfile", {}, false);
    } catch (e) {
      fail("Something went wrong. Please try again.");
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  window.lvPayoutCardInit = async function () {
    try {
      if (!(window.lvPaystackOn && (await window.lvPaystackOn()))) return;
      var box = document.getElementById("payoutVerifiedBox");
      if (!box) return;
      var r = await window.levroData.payments.myPayoutAccount();
      var d = r && r.data;
      var legacy = document.getElementById("payoutLegacy"); if (legacy) legacy.classList.add("hidden");
      box.innerHTML = d && d.verified
        ? '<div class="ve-bank"><span class="ve-bank-ico" data-bank-code="' + esc((typeof vendor !== "undefined" && vendor && vendor.bank_code) || "") + '"><i class="fa-solid fa-building-columns"></i></span><div class="ve-bank-copy"><strong>' + esc(d.accountName || "") + '</strong><small>' + esc(d.bankName || "") + " ···" + esc(d.accountLast4 || "") + '</small></div><span class="ve-chip ok"><i class="fa-solid fa-circle-check"></i> Verified</span></div>'
        : '<div class="ve-bank ve-bank-empty"><span class="ve-bank-ico"><i class="fa-solid fa-triangle-exclamation"></i></span><div class="ve-bank-copy"><strong>Account not verified</strong><small>Add your bank below and confirm the name to be paid.</small></div></div>';
    } catch (_) {}
  };
})();

/* ===== Vendor payouts list on the Earnings page (issue #98) =====
   Each payout the vendor is owed, with where it is: waiting, on its way, sent, or on hold (and why). Shown only with Paystack on. */
(function () {
  "use strict";
  var orig = window.renderVendorEarnings;
  if (typeof orig !== "function") return;
  var LABEL = {
    pending: ["Waiting to be sent", "fa-clock", "pending"],
    processing: ["On its way to your bank", "fa-paper-plane", "info"],
    success: ["Sent to your bank", "fa-circle-check", "success"],
    on_hold: ["On hold", "fa-hand", "warning"],
    failed: ["Trying again", "fa-rotate", "warning"],
    reversed: ["Returned by the bank. We are sorting it out", "fa-rotate-left", "warning"],
    paid_manually: ["Paid to you by Levromart", "fa-circle-check", "success"]
  };
  function naira(n) { try { return "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 }); } catch (_) { return "₦" + n; } }
  window.renderVendorEarnings = async function () {
    var html = await orig.apply(this, arguments);
    if (typeof html !== "string" || html.indexOf("Access denied") >= 0) return html;
    setTimeout(window.lvLoadPayoutList, 0);
    return html + (window.lvSaleTiersHtml ? window.lvSaleTiersHtml() : "") + '<section class="lv-payouts" id="lvPayoutList" aria-live="polite"></section>';
  };
  window.lvLoadPayoutList = async function () {
    var box = document.getElementById("lvPayoutList");
    try {
      if (!box || !(window.lvPaystackOn && (await window.lvPaystackOn()))) return;
      var r = await window.levroData.payments.myPayouts();
      var rows = (r && r.data) || [];
      if (!rows.length) { box.innerHTML = ""; return; }
      box.innerHTML = '<h3 class="earn-h"><i class="fa-solid fa-money-bill-transfer"></i> Your payouts</h3>' + rows.map(function (p) {
        var l = LABEL[p.status] || [p.status, "fa-circle", "info"];
        var when = new Date(p.updatedAt || p.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
        return '<button type="button" class="lv-payout-row" onclick="navigate(\'orderDetail\',{orderId:\'' + esc(p.orderId) + '\',source:\'sales\'})">' +
          '<span class="lv-payout-ico lv-payout-' + l[2] + '"><i class="fa-solid ' + l[1] + '"></i></span>' +
          '<span class="lv-payout-t"><b>' + naira(p.amount) + '</b><small>' + esc(l[0]) + (p.status === "on_hold" && p.holdReason ? " · " + esc(p.holdReason) : "") + '</small></span>' +
          '<span class="lv-payout-d">' + esc(when) + "</span></button>";
      }).join("");
    } catch (_) {}
  };
})();

/* ===== Commission "Pay now" through the Paystack ledger (issue #100) =====
   With Paystack on, the owed commission is paid through the new endpoint (same amount, same unlock afterwards).
   With it off, or if the new endpoint is not there, the old flow runs unchanged. */
(function () {
  "use strict";
  var orig = window.payCommission;
  if (typeof orig !== "function") return;
  window.payCommission = async function () {
    var on = window.lvPaystackOn ? await window.lvPaystackOn() : false;
    if (!on || !window.levroData || !window.levroData.payments.payCommission) return orig.apply(this, arguments);
    var errorEl = document.getElementById("commissionError");
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[onclick*="payCommission()"]'));
    buttons.forEach(function (b) { b.disabled = true; });
    try {
      var r = await window.levroData.payments.payCommission();
      if (r.error || !r.data || !r.data.authorizationUrl) throw new Error((r.error && r.error.message) || "Could not start the commission payment.");
      window.location.assign(r.data.authorizationUrl);
    } catch (e) {
      if (errorEl) { errorEl.textContent = e.message; errorEl.classList.remove("hidden"); }
      else showToast(e.message || "Could not start the commission payment.", "error");
      buttons.forEach(function (b) { b.disabled = false; });
    }
  };
})();

/* ===== Admin: Payments area (issues #98, #99, #101) =====
   Money in and out, payouts (release / hold / paid by hand), refunds, and the daily Paystack check. Admin only: the server
   refuses everyone else, this screen is only the window onto it. */
(function () {
  "use strict";
  var tab = "payouts", range = "today", picked = false, reuse = false, shCache = null;
  function naira(n) { try { return "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 }); } catch (_) { return "₦" + n; } }
  function when(t) { try { return new Date(t).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } }
  function api() { return window.levroData && window.levroData.adminPayments; }
  var STATUS = { pending: "Waiting", processing: "On its way", success: "Sent to shop", on_hold: "On hold", failed: "Failed", reversed: "Returned by bank", paid_manually: "Paid by hand", initialized: "Started", abandoned: "Abandoned", refunded: "Refunded", partially_refunded: "Part refunded", processed: "Done" };
  function pill(s) { var good = s === "success" || s === "processed" || s === "paid_manually"; var bad = s === "failed" || s === "reversed"; return '<span class="badge ' + (good ? "badge-success" : bad ? "badge-danger" : "badge-warning") + '">' + esc(STATUS[s] || s) + "</span>"; }

  function ask(title, label, withAmount, onOk) {
    var m = document.createElement("div");
    m.className = "modal lv-pm open lv-ap-sheet"; m.id = "lvAdminAsk";
    m.innerHTML = '<div class="modal-content lv-pm-card" role="dialog" aria-modal="true"><div class="lv-pm-head"><h3>' + esc(title) + "</h3></div>" +
      (withAmount ? '<label>Amount in naira (leave empty to refund everything left)</label><input id="lvAskAmount" inputmode="decimal" />' : "") +
      "<label>" + esc(label) + '</label><input id="lvAskText" maxlength="200" /><p class="lv-pay-err error-text hidden" id="lvAskErr"></p>' +
      '<div class="lv-pm-actions"><button type="button" class="btn btn-outline" data-a="no">Cancel</button><button type="button" class="btn" data-a="yes">Confirm</button></div></div>';
    m.addEventListener("click", async function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute("data-a");
      if (a === "no" || e.target === m) return m.remove();
      if (a !== "yes") return;
      var text = document.getElementById("lvAskText").value.trim();
      var amtEl = document.getElementById("lvAskAmount");
      var amount = amtEl && amtEl.value.trim() ? Number(amtEl.value) : undefined;
      if (text.length < 3) { var er = document.getElementById("lvAskErr"); er.textContent = "Please write a few words."; er.classList.remove("hidden"); return; }
      var res = await onOk(text, amount);
      if (res && res.error && /already been paid|done by hand/i.test(String(res.error.message || ""))) {
        if (m.__order) { noRefund[m.__order] = 1; try { localStorage.setItem("lv-no-refund", JSON.stringify(noRefund)); } catch (_) {} }
        m.remove(); showToast("This shop has already been paid for this order, so it cannot be refunded from here. Ask the shop to return the money.", "info"); reuse = true; navigate("adminPayments", {}, false); return;
      }
      if (res && res.error) { var er2 = document.getElementById("lvAskErr"); er2.textContent = res.error.message || "Something went wrong."; er2.classList.remove("hidden"); return; }
      m.remove(); showToast("Done.", "success"); navigate("adminPayments", {}, false);
    });
    document.body.appendChild(m);
  }
  var txByOrder = {}, refundedBy = {};   // what each order paid, and what has already been sent back
  // Refund: first see who is being refunded and what is left, then decide how much
  async function refundSheet(orderId) {
    var a = api(); if (!a) return;
    // opened from another page (the disputes page): look up what this order paid and what was already refunded
    if (!txByOrder[orderId]) {
      try {
        var look = await Promise.all([a.transactions({ limit: 200 }), a.refunds({ limit: 200 })]);
        ((look[0] && look[0].data) || []).forEach(function (x) { if (x.order_id) txByOrder[x.order_id] = x; });
        refundedBy = {}; ((look[1] && look[1].data) || []).forEach(function (r) { if (r.order_id && r.status !== "failed" && r.status !== "abandoned") refundedBy[r.order_id] = (refundedBy[r.order_id] || 0) + Number(r.amount || 0); });
      } catch (_) {}
    }
    var t = txByOrder[orderId] || {}, paid = Number(t.amount || 0), done = Number(refundedBy[orderId] || 0), left = Math.max(0, Math.round((paid - done) * 100) / 100);
    var o = null, bu = null, ve = null;
    try {
      o = (await sb.from("orders").select("id,buyer_id,vendor_id,total_amount,status,created_at").eq("id", orderId).maybeSingle()).data;
      if (o && o.buyer_id) bu = (await sb.from("users").select("name,email,phone").eq("id", o.buyer_id).maybeSingle()).data;
      if (o && o.vendor_id) ve = (await sb.from("vendors").select("business_name").eq("id", o.vendor_id).maybeSingle()).data;
    } catch (_) {}
    var who = (bu && (bu.name || bu.email)) || "the buyer";
    var row = function (k, v) { return '<div class="rf-row"><span>' + k + "</span><b>" + v + "</b></div>"; };
    var m = document.createElement("div");
    m.className = "modal lv-pm open lv-ap-sheet"; m.id = "lvRefundSheet";
    m.innerHTML = '<div class="modal-content lv-pm-card" role="dialog" aria-modal="true"><div class="lv-pm-head"><h3>Refund this order</h3></div>' +
      '<div class="rf-card">' +
      row("Buyer", esc(who) + (bu && bu.name && (bu.email || bu.phone) ? "<small>" + esc([bu.email, bu.phone].filter(Boolean).join(" \u00b7 ")) + "</small>" : "")) +
      row("Shop", esc((ve && ve.business_name) || t.business_name || "Shop")) +
      row("Order", "#" + esc(String(orderId).slice(0, 8).toUpperCase()) + (o && o.status ? "<small>" + esc(String(o.status).replace(/_/g, " ")) + "</small>" : "")) +
      row("Paid", naira(paid) + "<small>" + esc(when(t.paid_at || t.created_at)) + "</small>") +
      (done > 0 ? row("Already refunded", naira(done)) : "") +
      row("You can refund up to", '<span class="rf-max">' + naira(left) + "</span>") +
      "</div>" +
      '<label>Amount to refund (\u20a6)</label><input id="lvRfAmount" inputmode="decimal" value="' + left + '" />' +
      '<label>Reason (the buyer will see this)</label><input id="lvRfReason" maxlength="200" placeholder="For example: item not delivered" />' +
      '<p class="rf-note"><i class="fa-solid fa-wallet"></i> If <b>' + esc(who) + "</b> has saved a refund bank account, the money goes into their Levromart refund wallet (Account &gt; Refunds wallet) and they withdraw it to that bank account. If not, it goes back to the card they paid with.</p>" +
      '<p class="lv-pay-err error-text hidden" id="lvRfErr"></p>' +
      '<div class="lv-pm-actions"><button type="button" class="btn btn-outline" data-a="no">Cancel</button><button type="button" class="btn" data-a="yes">Refund ' + naira(left) + "</button></div></div>";
    m.addEventListener("input", function (e) { if (e.target && e.target.id === "lvRfAmount") { var v = Number(e.target.value); var b = m.querySelector('[data-a="yes"]'); if (b) b.textContent = "Refund " + naira(v > 0 ? Math.min(v, left) : 0); } });
    m.addEventListener("click", async function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute("data-a");
      if (act === "no" || e.target === m) return m.remove();
      if (act !== "yes") return;
      var err = document.getElementById("lvRfErr"), show = function (t2) { err.textContent = t2; err.classList.remove("hidden"); };
      var amt = Number(String(document.getElementById("lvRfAmount").value).replace(/,/g, "")), why = document.getElementById("lvRfReason").value.trim();
      if (!(amt > 0)) return show("Enter the amount to refund.");
      if (amt > left + 0.001) return show("The most you can refund is " + naira(left) + ".");
      if (why.length < 3) return show("Please write a few words as the reason.");
      var btn = e.target; btn.disabled = true;
      var res = await a.refund(orderId, { amountNaira: amt >= left - 0.001 ? undefined : amt, reason: why });
      btn.disabled = false;
      if (res && res.error) {
        if (/already been paid|done by hand/i.test(String(res.error.message || ""))) { noRefund[orderId] = 1; try { localStorage.setItem("lv-no-refund", JSON.stringify(noRefund)); } catch (_) {} m.remove(); showToast("This shop has already been paid for this order, so it cannot be refunded from here. Ask the shop to return the money.", "info"); navigate("adminPayments", {}, false); return; }
        return show(res.error.message || "Something went wrong.");
      }
      m.remove(); showToast(naira(amt) + " refund sent for " + who + ". It shows in their refund wallet, or goes back to their card.", "success"); navigate(typeof currentView !== "undefined" && currentView === "adminDisputes" ? "adminDisputes" : "adminPayments", {}, false);
    });
    document.body.appendChild(m);
  }
  window.lvPayAct = function (kind, id) {
    var a = api(); if (!a) return;
    if (kind === "release") {
      showConfirmDialog("Send this payout again now?", { title: "Release payout", okLabel: "Release" }).then(async function (yes) {
        if (!yes) return;
        var r = await a.release(id);
        if (r.error) return showToast(r.error.message, "error");
        showToast("Queued. It is sent within a minute.", "success"); navigate("adminPayments", {}, false);
      });
    } else if (kind === "hold") ask("Hold payout", "Why are you holding it?", false, function (t) { return a.hold(id, t); });
    else if (kind === "manual") ask("Mark as paid by hand", "How did you pay (reference)?", false, function (t) { return a.markManual(id, t); });
    else if (kind === "refund") refundSheet(id);
    else if (kind === "retryWaiting") {
      showConfirmDialog("Have you topped up the Paystack balance? The waiting payouts will be sent within a minute. If the balance is still too low, they wait again.", { title: "Send waiting payouts now", okLabel: "Send now" }).then(async function (yes) {
        if (!yes) return;
        var r = await a.retryWaiting();
        if (r.error) return showToast(r.error.message, "error");
        var n = (r.data && r.data.queued) || 0;
        showToast(n ? n + " payout" + (n === 1 ? " is" : "s are") + " being sent now." : "They are already being tried. Check again in a minute.", "success");
        setTimeout(function () { navigate("adminPayments", {}, false); }, 1500);
      });
    }
  };
  window.lvPayTab = function (t) { tab = t; picked = true; reuse = true; navigate("adminPayments", {}, false); };
  window.lvWithdrawDecide = function (id, how, hasDispute) {
    if (how === "reject") return ask("Reject withdrawal", "Reason (the shop will see this)", false, function (t) { return sb.rpc("admin_decide_withdrawal", { p_request_id: id, p_decision: "reject", p_reason: t }); });
    showConfirmDialog(hasDispute ? "This shop has a disputed order. Only the money of orders without a dispute will be sent. Approve?" : "Approve this withdrawal? The money is sent to the shop's bank within a minute.", { title: "Approve withdrawal", okLabel: "Approve" }).then(async function (yes) {
      if (!yes) return;
      var r = await sb.rpc("admin_decide_withdrawal", { p_request_id: id, p_decision: "approve" });
      if (r.error) return showToast(r.error.message, "error");
      showToast("Approved. It is sent within a minute.", "success"); navigate("adminPayments", {}, false);
    });
  };
  window.lvCancelDecide = function (id, how) {
    if (how === "reject") return ask("Reject cancellation", "Reason (the shop will see this)", false, function (t) { return sb.rpc("admin_decide_cancellation", { p_request_id: id, p_decision: "reject", p_reason: t }); });
    showConfirmDialog("Cancel this paid order and refund the buyer (the Paystack fee is not refunded)?", { title: "Approve cancellation", okLabel: "Cancel the order", cancelLabel: "Go back", danger: true }).then(async function (yes) {
      if (!yes) return;
      var r = await sb.rpc("admin_decide_cancellation", { p_request_id: id, p_decision: "approve" });
      if (r.error) return showToast(r.error.message, "error");
      showToast("Order cancelled. The refund is queued.", "success"); navigate("adminPayments", {}, false);
    });
  };
  function cancelRow(c) {
    var open = c.status === "requested";
    var acts = open ? '<button class="btn btn-sm btn-danger" onclick="lvCancelDecide(\'' + esc(c.id) + '\',\'approve\')">Cancel &amp; refund</button><button class="btn btn-sm btn-outline" onclick="lvCancelDecide(\'' + esc(c.id) + '\',\'reject\')">Reject</button>' : "";
    return '<div class="lv-ap-row"><div class="lv-ap-main"><b>' + naira(Number(c.total_amount || 0)) + "</b> " + '<span class="badge ' + (c.status === "approved" ? "badge-success" : c.status === "rejected" ? "badge-danger" : "badge-warning") + '">' + esc({ requested: "Waiting", approved: "Cancelled", rejected: "Rejected" }[c.status] || c.status) + "</span>" +
      "<small>" + esc(c.business_name || "") + " · " + when(c.created_at) + " · Reason: " + esc(c.reason || "") + (c.status === "rejected" && c.reject_reason ? " · Rejected: " + esc(c.reject_reason) : "") + '</small><a class="lv-ap-link" onclick="navigate(\'orderDetail\',{orderId:\'' + esc(c.order_id) + '\'})">Open order</a></div><div class="lv-ap-acts">' + acts + "</div></div>";
  }
  function withdrawalRow(w) {
    var open = w.status === "requested", rej = w.status === "rejected";
    var disp = Number(w.disputes) > 0;
    var chip = disp ? '<span class="badge badge-danger lv-ap-dispute" title="Open dispute on this shop"><i class="fa-solid fa-triangle-exclamation"></i> Disputed order' + (w.disputes > 1 ? " ×" + w.disputes : "") + "</span> " : "";
    var chg = w.account_changed_at ? '<span class="badge badge-warning lv-ap-acct" title="Bank account changed at ' + esc(when(w.account_changed_at)) + '"><i class="fa-solid fa-building-columns"></i> Account changed ' + esc(when(w.account_changed_at)) + " · check with the shop first</span> " : "";
    var links = disp ? (w.dispute_orders || []).map(function (o) { return '<a class="lv-ap-link" onclick="navigate(\'orderDetail\',{orderId:\'' + esc(o) + '\'})">Open disputed order</a>'; }).join(" ") : "";
    var acts = open ? '<button class="btn btn-sm" onclick="lvWithdrawDecide(\'' + esc(w.id) + '\',\'approve\',' + (disp ? "true" : "false") + ')">Approve</button><button class="btn btn-sm btn-outline" onclick="lvWithdrawDecide(\'' + esc(w.id) + '\',\'reject\')">Reject</button>' : "";
    var age = w.shop_since ? Math.max(1, Math.floor((Date.now() - new Date(w.shop_since).getTime()) / 86400000)) : null;
    (window.__lvPayReg = window.__lvPayReg || {})["wd:" + w.id] = w;
    return '<div class="lv-ap-row lv-tap" data-lvd="wd:' + esc(w.id) + '"><div class="lv-ap-main"><b>' + naira(Number(w.amount_kobo) / 100) + "</b> " + chip + '<span class="badge ' + (w.status === "approved" ? "badge-success" : rej ? "badge-danger" : "badge-warning") + '">' + esc({ requested: "Waiting", approved: w.kind === "instant" ? "Sent at once" : "Approved", rejected: "Rejected" }[w.status] || w.status) + "</span> " + chg +
      "<small>" + esc(w.business_name || "") + " · " + when(w.created_at) + (age ? " · shop " + age + " day" + (age === 1 ? "" : "s") + " old" : "") + (w.bank_name ? " · " + esc(w.bank_name) + (w.account_name ? " (" + esc(w.account_name) + ")" : "") : "") + (rej && w.reject_reason ? " · Reason: " + esc(w.reject_reason) : "") + "</small>" + links + '</div><div class="lv-ap-acts">' + acts + "</div></div>";
  }
  window.lvPayRange = function (r) { range = r; reuse = true; navigate("adminPayments", {}, false); };

  function payoutRow(p) {
    var acts = "";
    if (["on_hold", "failed", "reversed"].indexOf(p.status) >= 0) acts += '<button class="btn btn-sm" onclick="lvPayAct(\'release\',\'' + esc(p.id) + '\')">Release</button>';
    if (p.status === "pending" || p.status === "failed") acts += '<button class="btn btn-sm btn-outline" onclick="lvPayAct(\'hold\',\'' + esc(p.id) + '\')">Hold</button>';
    // payouts are sent by Paystack on their own; "paid by hand" is only for a payout that failed or came back
    if (["failed", "reversed"].indexOf(p.status) >= 0) acts += '<button class="btn btn-sm btn-outline" onclick="lvPayAct(\'manual\',\'' + esc(p.id) + '\')">Paid outside Levromart</button>';
    var onBalance = p.status === "pending" && p.last_error === "Paystack balance too low";
    var pst = p.status === "success" || p.status === "paid_manually" ? "in" : p.status === "failed" || p.status === "reversed" ? "bad" : "wait";
    var pic = pst === "in" ? "fa-arrow-up-right-from-square" : pst === "bad" ? "fa-triangle-exclamation" : p.status === "on_hold" ? "fa-pause" : "fa-hourglass-half";
    (window.__lvPayReg = window.__lvPayReg || {})["payout:" + p.id] = p;
    return '<div class="lv-ap-row ap2-row lv-tap" data-lvd="payout:' + esc(p.id) + '"><span class="ap2-ico ' + pst + '"><i class="fa-solid ' + pic + '"></i></span><div class="lv-ap-main"><b>' + naira(p.amount) + "</b> " + (onBalance ? '<span class="badge badge-danger">Waiting for Paystack balance</span>' : pill(p.status)) + "<small>" + esc(p.business_name || "") + " · " + when(p.created_at) + (p.hold_reason ? " · " + esc(p.hold_reason) : "") + (p.last_error && !onBalance ? " · " + esc(p.last_error) : "") + '</small><a class="lv-ap-link" onclick="navigate(\'orderDetail\',{orderId:\'' + esc(p.order_id) + '\'})">Open order</a></div><div class="lv-ap-acts">' + acts + "</div></div>";
  }
  var paidOut = {};   // orders whose shop has already been paid: they cannot be refunded from here
  function txRow(t) {
    var okStatus = t.status === "success" || t.status === "partially_refunded";
    var shopPaid = !!(t.order_id && (paidOut[t.order_id] || noRefund[t.order_id]));
    var back = Number(refundedBy[t.order_id] || 0), full = back > 0 && Number(t.amount || 0) - back <= 0.009;
    var can = t.order_id && okStatus && !shopPaid && !full;
    var what = String(t.purpose || "order payment").replace(/_/g, " ");
    var good = t.status === "success", bad = t.status === "failed";
    var ic = good ? "fa-arrow-down" : bad ? "fa-xmark" : t.status === "refunded" || t.status === "partially_refunded" ? "fa-rotate-left" : "fa-hourglass-half";
    var tail = can ? '<button class="btn btn-sm btn-outline" onclick="lvPayAct(\'refund\',\'' + esc(t.order_id) + '\')">Refund</button>' : (full ? '<span class="ap2-tag ap2-tag-ref"><i class="fa-solid fa-rotate-left"></i> Fully refunded</span>' : okStatus && shopPaid ? '<span class="ap2-tag"><i class="fa-solid fa-circle-check"></i> Shop paid</span>' : "");
    if (can && back > 0) tail = '<span class="ap2-tag ap2-tag-ref"><i class="fa-solid fa-rotate-left"></i> ' + naira(back) + ' back</span>' + tail;
    (window.__lvPayReg = window.__lvPayReg || {})["tx:" + t.id] = t;
    return '<div class="lv-ap-row ap2-row lv-tap" data-lvd="tx:' + esc(t.id) + '"><span class="ap2-ico ' + (good ? "in" : bad ? "bad" : "wait") + '"><i class="fa-solid ' + ic + '"></i></span><div class="lv-ap-main"><b>' + naira(t.amount) + "</b> " + payPill(t.status) + "<small>" + esc(what) + (t.business_name ? " \u00b7 " + esc(t.business_name) : "") + " \u00b7 " + when(t.paid_at || t.created_at) + '</small></div><div class="lv-ap-acts">' + tail + "</div></div>";
  }


  function refundRow(r) { (window.__lvPayReg = window.__lvPayReg || {})["refund:" + r.id] = r; return '<div class="lv-ap-row ap2-row lv-tap" data-lvd="refund:' + esc(r.id) + '"><span class="ap2-ico wait"><i class="fa-solid fa-rotate-left"></i></span><div class="lv-ap-main"><b>' + naira(r.amount) + "</b> " + pill(r.status) + "<small>Refund for order #" + esc(String(r.order_id || "").slice(0, 8).toUpperCase()) + " \u00b7 " + when(r.created_at) + (r.reason ? " \u00b7 " + esc(r.reason) : "") + (r.last_error ? " \u00b7 " + esc(r.last_error) : "") + '</small><a class="lv-ap-link" onclick="navigate(\'orderDetail\',{orderId:\'' + esc(r.order_id) + '\'})">Open order</a></div></div>'; }
  function reportRow(r) {
    var rep = r.report || {}; var list = (rep.problems || []).map(function (p) { return "<li>" + esc(p.detail) + "</li>"; }).join("");
    return '<div class="lv-ap-row lv-ap-col"><div class="lv-ap-main"><b>' + esc(String(r.window_start).slice(0, 10)) + "</b> " + (r.problems ? '<span class="badge badge-danger">' + r.problems + " to check</span>" : '<span class="badge badge-success">All matched</span>') + "<small>" + (rep.error ? esc(rep.error) : (rep.checked || 0) + " payments checked") + "</small></div>" + (list ? "<ul class=\"lv-ap-list\">" + list + "</ul>" : "") + "</div>";
  }

  // ===== The Payments page: four plain tabs, each with a sentence saying what it is for =====
  var TABS = [["todo", "Needs you"], ["payouts", "Shop payouts"], ["payments", "Buyer payments"], ["checks", "Daily check"]];
  var HELP = {
    todo: "Shops asking for something. Approve or reject each one; once you decide it leaves this list.",
    payouts: "Money Levromart sends to shops after a sale. It goes out by itself; you only step in when a payout is stuck.",
    payments: "Money buyers paid through Levromart, and refunds sent back to them.",
    checks: "Every day Levromart compares its own records with Paystack's. \u201cAll matched\u201d means there is nothing for you to do."
  };
  var chipOf = { payouts: "all", payments: "paid" }, noRefund = {};
  try { noRefund = JSON.parse(localStorage.getItem("lv-no-refund") || "{}") || {}; } catch (_) {}
  window.lvPayChip = function (c) { chipOf[tab] = c; reuse = true; navigate("adminPayments", {}, false); };
  function chipsHtml(list, cur) { return '<div class="ap2-chips">' + list.map(function (x) { return '<button type="button" class="' + (x[0] === cur ? "on" : "") + '" onclick="lvPayChip(\'' + x[0] + '\')">' + esc(x[1]) + (x[2] ? "<i>" + x[2] + "</i>" : "") + "</button>"; }).join("") + "</div>"; }
  var PAY_WORDS = { success: "Paid", initialized: "Started", abandoned: "Not completed", failed: "Failed", refunded: "Refunded", partially_refunded: "Part refunded", pending: "Waiting", processing: "On its way" };
  function payPill(s) { var good = s === "success"; var bad = s === "failed"; return '<span class="badge ' + (good ? "badge-success" : bad ? "badge-danger" : "badge-warning") + '">' + esc(PAY_WORDS[s] || s) + "</span>"; }
  function section(title, rows, empty) { return '<h4 class="ap2-h">' + esc(title) + "</h4>" + (rows.length ? rows.join("") : '<p class="ap2-empty">' + esc(empty) + "</p>"); }

  window.renderAdminPayments = async function () {
    var a = api();
    var nav = typeof adminNavHtml === "function" ? adminNavHtml("adminPayments") : "";
    if (!a) return nav + '<div class="empty-state">Payments are not available right now.</div>';
    // The four overview requests run together, and switching tab or range reuses them (for 30 seconds) so only the list itself is fetched
    var base = (reuse && shCache && Date.now() - shCache.at < 30000) ? shCache : null; reuse = false;
    if (!base) {
      var got = await Promise.all([a.summary(), sb.rpc("admin_list_withdrawals", { p_status: null }), sb.rpc("get_setup_status"), sb.rpc("admin_list_cancellations", { p_status: null })]);
      base = { at: Date.now(), sum: got[0], wd: got[1], su: got[2], cr: got[3] };
      if (!got[0].error) shCache = base;
    }
    var sum = base.sum, wd = base.wd, su = base.su, cr = base.cr;
    if (sum.error) return nav + '<div class="empty-state">' + esc(sum.error.message || "Only admins can see payments.") + "</div>";
    var s = sum.data, h = s.health, t = s[range];
    var wdRows = (wd && wd.data) || [], crRows = (cr && cr.data) || [];
    var wdOpen = wdRows.filter(function (x) { return x.status === "requested"; }), crOpen = crRows.filter(function (x) { return x.status === "requested"; });
    var pending = wdOpen.length + crOpen.length;
    var missing = (su && su.data && su.data.missing) || [];
    if (window.lvPayPaint) window.lvPayPaint(pending);
    if (["withdrawals", "cancellations"].indexOf(tab) >= 0) tab = "todo";
    if (["held", "failed"].indexOf(tab) >= 0) tab = "payouts";
    if (["refunds"].indexOf(tab) >= 0) tab = "payments";
    if (!picked && pending) tab = "todo";
    var body = "";
    if (tab === "todo") {
      var decided = wdRows.concat(crRows).filter(function (x) { return x.status !== "requested"; }).sort(function (x, y) { return String(y.created_at).localeCompare(String(x.created_at)); }).slice(0, 8);
      body = section("Withdrawal requests (" + wdOpen.length + ")", wdOpen.map(withdrawalRow), "No withdrawal is waiting for you.") +
        section("Cancel requests (" + crOpen.length + ")", crOpen.map(cancelRow), "No cancel request is waiting for you.") +
        (decided.length ? '<details class="ap2-more"><summary>Recently decided (' + decided.length + ")</summary>" + decided.map(function (x) { return x.reason !== undefined && x.total_amount !== undefined ? cancelRow(x) : withdrawalRow(x); }).join("") + "</details>" : "");
    } else if (tab === "payouts") {
      var c1 = chipOf.payouts || "all", prow = await a.payouts({ limit: 80 });
      var pl = ((prow && prow.data) || []).filter(function (p) { return Number(p.amount) > 0; });   // a payout of nothing is not worth a line
      var f1 = { all: pl, waiting: pl.filter(function (p) { return p.status === "pending" || p.status === "processing"; }), hold: pl.filter(function (p) { return p.status === "on_hold"; }), failed: pl.filter(function (p) { return p.status === "failed" || p.status === "reversed"; }), sent: pl.filter(function (p) { return p.status === "success" || p.status === "paid_manually"; }) };
      body = chipsHtml([["all", "All"], ["waiting", "Waiting", f1.waiting.length || ""], ["hold", "On hold", f1.hold.length || ""], ["failed", "Failed", f1.failed.length || ""], ["sent", "Sent"]], c1) +
        '<div class="lv-ap-list-wrap">' + (f1[c1].length ? f1[c1].map(payoutRow).join("") : '<p class="ap2-empty">Nothing here.</p>') + "</div>";
    } else if (tab === "payments") {
      var c2 = chipOf.payments || "paid";
      var rs = await Promise.all([a.transactions({ limit: 80 }), a.refunds({ limit: 100 }), a.payouts({ limit: 100, status: "success" }), a.payouts({ limit: 100, status: "processing" })]);
      refundedBy = {}; ((rs[1] && rs[1].data) || []).forEach(function (r) { if (r.order_id && r.status !== "failed" && r.status !== "abandoned") refundedBy[r.order_id] = (refundedBy[r.order_id] || 0) + Number(r.amount || 0); });
      paidOut = {}; [rs[2], rs[3]].forEach(function (r) { ((r && r.data) || []).forEach(function (p) { if (p.order_id) paidOut[p.order_id] = 1; }); });
      var tl = (rs[0] && rs[0].data) || [];
      var f2 = { paid: tl.filter(function (x) { return x.status === "success" || x.status === "partially_refunded" || x.status === "refunded"; }), open: tl.filter(function (x) { return x.status === "abandoned" || x.status === "initialized" || x.status === "failed"; }) };
      (rs[0] && rs[0].data || []).forEach(function (x) { if (x.order_id) txByOrder[x.order_id] = x; });
      var rowsHtml = c2 === "refunds" ? (((rs[1] && rs[1].data) || []).map(refundRow)) : (f2[c2] || []).map(txRow);
      body = chipsHtml([["paid", "Paid"], ["refunds", "Refunds sent"], ["open", "Not completed"]], c2) + '<div class="lv-ap-list-wrap">' + (rowsHtml.length ? rowsHtml.join("") : '<p class="ap2-empty">Nothing here.</p>') + "</div>";
    } else {
      var rr = await a.reports();
      body = '<div class="lv-ap-list-wrap">' + (((rr && rr.data) || []).map(reportRow).join("") || '<p class="ap2-empty">No daily check has run yet.</p>') + "</div>";
    }
    var tiles = [["Paid in by buyers", t.collected, "fa-arrow-down"], ["Refunded to buyers", t.refunded, "fa-rotate-left"], ["Paid out to shops", t.paidToVendors, "fa-arrow-up-right-from-square"], ["Levromart's commission", t.commission, "fa-percent"]];
    var stuckOnBalance = Number(h.waiting_on_balance || 0);
    var status = pending ? '<span class="ap-need"><b>' + pending + "</b> waiting for you</span>" : h.needsAttention ? '<span class="ap-need"><b>' + h.needsAttention + "</b> to check</span>" : '<span class="ap-ok"><i class="fa-solid fa-circle-check"></i> All clear</span>';
    var counts = { todo: pending, payouts: 0, payments: 0, checks: Number(h.needsAttention || 0) > stuckOnBalance ? 1 : 0 };
    return nav + '<div class="ap-head"><h2>Payments</h2>' + status + "</div>" +
      (stuckOnBalance ? '<div class="ap-note ap-warn ap-bal-warn" role="alert"><i class="fa-solid fa-triangle-exclamation"></i> <span><b>' + stuckOnBalance + " shop payout" + (stuckOnBalance === 1 ? "" : "s") + " (" + naira(h.waitingOnBalance) + ") cannot be sent yet:</b> the Paystack balance is too low. Top it up and tap Send waiting payouts.</span> " + '<button class="btn btn-sm" onclick="lvPayAct(\'retryWaiting\')">Send waiting payouts</button></div>' : (h.paystackBalance == null ? "" : '<p class="ap-bal"><i class="fa-solid fa-building-columns"></i> Paystack balance (what shop payouts are paid from): <b>' + naira(h.paystackBalance) + "</b></p>")) +
      (missing.length ? '<details class="ap-setup"><summary><i class="fa-solid fa-screwdriver-wrench"></i> ' + missing.length + ' feature' + (missing.length === 1 ? "" : "s") + ' not switched on yet</summary><p>Ask your engineer to apply these database changes:</p><ul>' + missing.map(function (m) { return "<li>" + esc(typeof m === "string" ? m : (m.label || m.name || JSON.stringify(m))) + "</li>"; }).join("") + "</ul></details>" : "") +
      '<div class="ap-card"><div class="ap2-title">Money moved</div><div class="ap-range">' + [["today", "Today"], ["week", "7 days"], ["month", "30 days"]].map(function (r) { return '<button class="' + (r[0] === range ? "active" : "") + '" onclick="lvPayRange(\'' + r[0] + '\')">' + r[1] + "</button>"; }).join("") + "</div>" +
      '<div class="ap-tiles">' + tiles.map(function (x) { return '<div class="ap-tile"><small>' + x[0] + "</small><b>" + naira(x[1]) + "</b></div>"; }).join("") + "</div></div>" +
      '<div class="ap2-tabs" role="tablist">' + TABS.map(function (x) { var n = counts[x[0]]; return '<button role="tab" class="' + (x[0] === tab ? "active" : "") + '" onclick="lvPayTab(\'' + x[0] + '\')">' + esc(x[1]) + (n ? '<i class="ap-n' + (x[0] === "todo" ? " red" : "") + '">' + (x[0] === "checks" ? "!" : n) + "</i>" : "") + "</button>"; }).join("") + "</div>" +
      '<p class="ap-help"><i class="fa-solid fa-circle-info"></i> ' + esc(HELP[tab]) + "</p>" + body;
  };
})();

/* ===== No numbers in a shop's "about" text =====
   Phone numbers, account numbers or any digits are not allowed in a business description (people were using it to take
   customers away from the app). Digits are removed as they are typed or pasted, and the save is refused if any are left.
   The database enforces the same rule (migration 0011). */
(function () {
  "use strict";
  var DIGITS = /[0-9\u0660-\u0669\u06F0-\u06F9\uFF10-\uFF19]/g;
  var SELECTOR = "#veBio,#vaBio";
  var lastToast = 0;
  function say() {
    if (Date.now() - lastToast < 4000) return;
    lastToast = Date.now();
    try { showToast("Numbers are not allowed in your business description.", "info"); } catch (_) {}
  }
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (!t || !t.matches || !t.matches(SELECTOR)) return;
    if (!DIGITS.test(t.value)) { DIGITS.lastIndex = 0; return; }
    DIGITS.lastIndex = 0;
    var pos = t.selectionStart, before = t.value.slice(0, pos == null ? 0 : pos).replace(DIGITS, "").length;
    t.value = t.value.replace(DIGITS, "");
    try { t.setSelectionRange(before, before); } catch (_) {}
    say();
  }, true);
  // a "hint" under each field
  new MutationObserver(function () {
    document.querySelectorAll(SELECTOR).forEach(function (t) {
      if (t.dataset.noNum) return;
      t.dataset.noNum = "1";
      var h = document.createElement("small");
      h.className = "muted lv-no-num-hint";
      h.textContent = "No numbers, please (phone or account numbers are not allowed here).";
      t.insertAdjacentElement("afterend", h);
    });
  }).observe(document.body, { childList: true, subtree: true });
})();

/* ===== Filter drawers (vendors, browse, orders): a real backdrop, a handle, Clear / Show buttons =====
   The drawer used to fake its backdrop with a giant shadow, which could not fade or follow a drag. Now the backdrop is its
   own layer (tap it to close, it fades while the drawer is pulled down) and the drawer is in the sheet-drag list above.
   Whatever closes a drawer (the Done button, a tap outside, a drag), the backdrop goes with it. */
(function () {
  "use strict";
  var PANELS = [
    { sel: ".vendors-filters-panel", close: function () { try { toggleVendorsFilters(false); } catch (_) {} }, clear: "clearVendorsDirectoryFilters", label: "Show vendors" },
    { sel: ".browse-filter-panel", close: function () { try { toggleBrowseFilters(false); } catch (_) {} }, clear: "clearBrowseFilters", label: "Show results" },
    { sel: ".order-filters-panel", close: function () { try { window.closeLevromartTransientFilters(); } catch (_) {} }, clear: null, label: null },
    { sel: "#messagesMoreMenu", close: function () { var m = document.getElementById("messagesMoreMenu"); if (m) m.classList.add("hidden"); }, clear: null, label: null }
  ];
  function sync() {
    PANELS.forEach(function (p) {
      var el = document.querySelector(p.sel);
      if (!el || !el.parentNode) return;
      var open = !el.classList.contains("hidden");
      var back = el.parentNode.querySelector(":scope > .lv-sheet-back");
      if (open && !back) {
        back = document.createElement("div");
        back.className = "lv-sheet-back";
        back.addEventListener("click", p.close);
        el.parentNode.insertBefore(back, el);
      } else if (!open && back) back.remove();
      if (open && p.label && !el.querySelector(":scope > .lv-sheet-foot")) {
        var foot = document.createElement("div");
        foot.className = "lv-sheet-foot";
        foot.innerHTML = '<button type="button" class="btn btn-outline" data-a="clear">Clear all</button><button type="button" class="btn" data-a="done">' + p.label + "</button>";
        foot.addEventListener("click", function (e) {
          var a = e.target && e.target.getAttribute && e.target.getAttribute("data-a");
          if (a === "clear" && p.clear && typeof window[p.clear] === "function") window[p.clear]();
          if (a === "done") p.close();
        });
        el.appendChild(foot);
      }
    });
  }
  var raf = 0;
  new MutationObserver(function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; sync(); }); }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
})();

/* ===== Search keeps its place: coming back to the Search page (e.g. from a vendor or product you opened) shows the same
   search and results again, instead of an empty "no results" page. It remembers for 30 minutes. ===== */
(function () {
  "use strict";
  var KEY = "lv-search-state";
  function save(patch) {
    try {
      var cur = JSON.parse(sessionStorage.getItem(KEY) || "{}") || {};
      sessionStorage.setItem(KEY, JSON.stringify(Object.assign(cur, patch, { at: Date.now() })));
    } catch (_) {}
  }
  function load() {
    try {
      var s = JSON.parse(sessionStorage.getItem(KEY) || "null");
      return s && s.term && Date.now() - s.at < 30 * 60000 ? s : null;
    } catch (_) { return null; }
  }
  function wrap(name, after) {
    var orig = window[name];
    if (typeof orig !== "function") return;
    window[name] = function () { var r = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (_) {} return r; };
  }
  wrap("runSearchPageQuery", function (term) { term = String(term || "").trim(); if (term) save({ term: term, filter: (typeof searchPageFilter !== "undefined" ? searchPageFilter : "all") }); });
  wrap("setSearchPageFilter", function (id) { save({ filter: id }); });
  wrap("clearSearchPageInput", function () { try { sessionStorage.removeItem(KEY); } catch (_) {} });
  var origRender = window.renderSearchPage;
  if (typeof origRender === "function") {
    window.renderSearchPage = function () {
      var html = origRender.apply(this, arguments);
      setTimeout(function () {
        var s = load(), input = document.getElementById("searchPageInput");
        if (!s || !input || input.value) return;
        input.value = s.term;
        var clear = document.getElementById("searchPageClearBtn"); if (clear) clear.classList.remove("hidden");
        if (s.filter && s.filter !== "all" && typeof setSearchPageFilter === "function") setSearchPageFilter(s.filter);
        else if (typeof runSearchPageQuery === "function") runSearchPageQuery(s.term, false);
      }, 60);
      return html;
    };
  }
})();

/* ===== The profile picture in the top bar never falls back to the generic icon while you are signed in =====
   The picture is remembered on this phone, shown at once when the app opens, and only replaced by the green login icon
   when there really is no login (signed out, or never signed in). */
(function () {
  "use strict";
  var KEY = "lv-avatar";
  function hasStoredLogin() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && /^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) return true;
      }
    } catch (_) {}
    return false;
  }
  function cached() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; } }
  function paintCached() {
    var c = cached(), btn = document.getElementById("avatarBtn"), login = document.getElementById("loginBtn");
    if (!c || !btn || !login || !hasStoredLogin()) return;
    btn.classList.remove("hidden"); login.classList.add("hidden");
    if (!btn.firstElementChild) {
      btn.innerHTML = c.url
        ? '<img src="' + String(c.url).replace(/"/g, "&quot;") + '" alt="" draggable="false" />'
        : (typeof avatarFallbackHtml === "function" ? avatarFallbackHtml(c.name || "", "100%", "", c.name || "") : "");
    }
  }
  var orig = window.updateAuthUI;
  if (typeof orig === "function") {
    window.updateAuthUI = function () {
      orig.apply(this, arguments);
      try {
        if (typeof session !== "undefined" && session && typeof profile !== "undefined" && profile) {
          localStorage.setItem(KEY, JSON.stringify({ id: session.user.id, url: profile.avatar_url || "", name: profile.name || profile.email || "" }));
        } else if (!hasStoredLogin()) {
          localStorage.removeItem(KEY);   // really signed out
        } else {
          paintCached();                  // still signed in, the profile is just not loaded yet: keep the picture
        }
      } catch (_) {}
    };
  }
  paintCached();
})();

/* ===== Back arrows take you back to where you were, not to Home =====
   The app counts how many screens deep you are (stored on each history entry). A back arrow goes one screen back when
   there is one, and only falls back to the given screen (Home) when this is the first screen of the visit. */
(function () {
  "use strict";
  function depth() { try { return (history.state && history.state.lvDepth) || 0; } catch (_) { return 0; } }
  var orig = window.navigate;
  // Where each screen was scrolled to, per history entry, so Back returns to the exact spot (not the top of the page).
  var scrolls = {};
  try { scrolls = JSON.parse(sessionStorage.getItem("lv-scrolls") || "{}") || {}; } catch (_) {}
  function keyOf(create) {
    try {
      var st = history.state;
      if (st && st.lvKey) return st.lvKey;
      if (create && st) { var k = "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); history.replaceState(Object.assign({}, st, { lvKey: k }), ""); return k; }
    } catch (_) {}
    return null;
  }
  var heights = {};
  try { heights = JSON.parse(sessionStorage.getItem("lv-heights") || "{}") || {}; } catch (_) {}
  function view0() { try { return currentView; } catch (_) { return ""; } }
  var pageSnaps = {};
  window.lvDropPageSnaps = function () { pageSnaps = {}; vendorsSnap = null; };
  var vendorsSnap = null;   // the Vendors page as it looked when we left it (grid/list only), so Back can show it at once
  function remember() {
    try {
      var a = document.getElementById("app"), m = null; try { m = localStorage.getItem("levromart_vendors_view"); } catch (_) {}
      if (a && view0() === "vendors" && m !== "map" && a.querySelector("#vendorsGrid .vd-card, #vendorsGrid > *:not(.vd-skel)")) vendorsSnap = a.innerHTML;
      // Home and a shop's page are remembered the same way, so Back shows them at once instead of rebuilding them
      if (a && view0() === "home" && a.querySelector(".lv-act-grid")) pageSnaps.home = a.innerHTML;
      else if (a && view0() === "storefront" && a.querySelector(".storefront-profile-name")) { var sp = history.state && history.state.params; if (sp && sp.vendorId) pageSnaps["storefront|" + sp.vendorId] = a.innerHTML; }
    } catch (_) {}
    var k = keyOf(true);
    if (!k) return;
    scrolls[k] = window.scrollY || document.documentElement.scrollTop || 0;
    heights[k] = document.documentElement.scrollHeight || 0;
    try { sessionStorage.setItem("lv-scrolls", JSON.stringify(scrolls)); sessionStorage.setItem("lv-heights", JSON.stringify(heights)); } catch (_) {}
  }
  // keep the spot while the page fills in; stop the moment the person scrolls or touches the screen
  function restore(y) {
    var cancelled = false, stop = function () { cancelled = true; };
    ["touchstart", "wheel", "keydown", "pointerdown"].forEach(function (t) { addEventListener(t, stop, { once: true, passive: true, capture: true }); });
    [0, 40, 120, 300, 700, 1400].forEach(function (ms) {
      setTimeout(function () { if (!cancelled && Math.abs((window.scrollY || 0) - y) > 2) window.scrollTo({ top: y, behavior: "instant" }); }, ms);
    });
  }
  // leaving a screen by any route (taps, links, the bottom bar) remembers where you were
  document.addEventListener("click", function (e) { if (e.target && e.target.closest && e.target.closest("a, button, [onclick], .card, .product-card-wrap")) remember(); }, true);
  addEventListener("pagehide", remember);
  if (typeof orig === "function") {
    var flying = {};
    window.navigate = async function (view, params, pushHistory) {
      // a second tap on the same tab while it is still opening would draw the page all over again (and slow it): ignore it
      var fkey = view + "|" + (params ? JSON.stringify(params) : "");
      if ((view === "home" || view === "vendors") && flying[fkey] && Date.now() - flying[fkey] < 4000) return;
      if (view === "home" || view === "vendors") flying[fkey] = Date.now();
      try { return await navInner.apply(this, arguments); } finally { delete flying[fkey]; }
    };
    var navInner = async function (view, params, pushHistory) {
      var prev = depth(), pushes = pushHistory !== false && !(pushHistory && typeof pushHistory === "object" && pushHistory.replace === true);
      if (pushes) remember();
      // Going Back: keep the page as tall as it was, so the saved spot exists straight away (the list fills in afterwards)
      // and we do not first show the top and then scroll down.
      var heldBody = false;
      if (pushHistory === false) {
        try { var hk = keyOf(false), hh = hk != null ? heights[hk] : 0; if (hh > 0) { document.body.style.minHeight = hh + "px"; heldBody = true; } } catch (_) {}
        // go straight to the saved spot: the page is held at its old height, so there is nothing to wait for
        try { var k1 = keyOf(false), y1 = k1 != null ? scrolls[k1] : undefined; if (heldBody && Number.isFinite(y1) && y1 > 0) { document.documentElement.classList.add("lv-restoring"); window.scrollTo({ top: y1, behavior: "instant" }); setTimeout(function () { document.documentElement.classList.remove("lv-restoring"); }, 1800); } } catch (_) {}
      }
      if (pushHistory === false && view === "vendors" && vendorsSnap && view0() !== "vendors") {
        try { document.getElementById("app").innerHTML = vendorsSnap; } catch (_) {}
      }
      if (pushHistory === false && view0() !== view && (view === "home" || view === "storefront")) {
        try { var sk = view === "home" ? "home" : "storefront|" + (params && params.vendorId); if (pageSnaps[sk]) document.getElementById("app").innerHTML = pageSnaps[sk]; } catch (_) {}
      }
      var r = await orig.apply(this, arguments);
      if (heldBody) setTimeout(function () { document.body.style.minHeight = ""; }, 2200);
      try {
        var st = history.state;
        if (pushes && st && st.view === view && st.lvDepth == null) history.replaceState(Object.assign({}, st, { lvDepth: prev + 1 }), "");
        if (pushHistory === false) {            // Back / forward: return to where this screen was left
          var k = keyOf(false), y = k != null ? scrolls[k] : undefined;
          if (Number.isFinite(y)) { window.scrollTo({ top: y, behavior: "instant" }); restore(y); }
        }
      } catch (_) {}
      return r;
    };
  }
  window.lvGoBack = function (fallback) {
    if (depth() > 0) history.back();
    else if (typeof navigate === "function") navigate(fallback || "home");
  };
})();

/* ===== A refresh never leaves you on the old version =====
   The app opens instantly from a saved copy and checks for a newer one in the background. When a newer one is found in the
   first seconds, and nothing has been touched yet, the page reloads itself once, so you never see the old look (or a mix of
   old and new) after an update. */
(function () {
  "use strict";
  var touched = false;
  ["pointerdown", "keydown", "touchstart"].forEach(function (t) { addEventListener(t, function () { touched = true; }, { once: true, capture: true, passive: true }); });
  try {
    navigator.serviceWorker && navigator.serviceWorker.addEventListener("message", function (e) {
      if (e.data && e.data.type === "LV_APP_UPDATED" && !touched && performance.now() < 20000) location.reload();
    });
  } catch (_) {}
})();

/* ===== Maps follow the app theme: dark mode gives a dark map, light mode a light map (you can still pick another style on the map) ===== */
(function () {
  "use strict";
  var orig = window.setTheme;
  if (typeof orig !== "function") return;
  window.setTheme = function (theme) {
    var r = orig.apply(this, arguments);
    try {
      if (typeof vmpMap !== "undefined" && vmpMap && typeof vmpSetStyle === "function") vmpSetStyle(theme === "dark" || theme === "black" ? "night" : "streets", false);
    } catch (_) {}
    return r;
  };
})();

/* ===== Search: after you open a result, the search box is cleared (nothing left to wipe by hand) ===== */
(function () {
  "use strict";
  document.addEventListener("click", function (e) {
    var hit = e.target && e.target.closest && e.target.closest("#searchPageResults .search-result-row, #searchPageResults .lv-svr-item, #searchPageResults .sr-row, #searchPageResults [data-product-id], #searchPageResults [data-vendor-id]");
    if (!hit) return;
    try { sessionStorage.removeItem("lv-search-state"); } catch (_) {}
    setTimeout(function () {
      var input = document.getElementById("searchPageInput");
      if (input) input.value = "";
    }, 0);
  }, false);
})();

/* ===== The Messages "Chat actions" drawer stays open until you close it =====
   The inbox redraws itself every few seconds as new messages arrive; that used to wipe the open drawer (and bring the bottom
   bar back). The open state is now remembered and put back after every redraw. */
(function () {
  "use strict";
  var wantOpen = false;
  function menu() { return document.getElementById("messagesMoreMenu"); }
  new MutationObserver(function (list) {
    var m = menu();
    if (!m) return;
    var attr = list.some(function (r) { return r.type === "attributes" && r.target === m; });
    if (attr) { wantOpen = !m.classList.contains("hidden"); return; }          // the person opened or closed it
    if (wantOpen && m.classList.contains("hidden")) m.classList.remove("hidden"); // the page was redrawn: put it back
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  // leaving the Messages page ends it
  var nav = window.navigate;
  if (typeof nav === "function") window.navigate = function () { wantOpen = false; return nav.apply(this, arguments); };
})();

/* ===== Vendor application: working hours use the app's own dropdown (not the phone's plain list) ===== */
(function () {
  "use strict";
  function dress() { var s = document.getElementById("vaHoursPreset"); if (s && typeof enhanceSelect === "function") { try { enhanceSelect(s); } catch (_) {} } }
  var host = document.getElementById("app") || document.body;
  new MutationObserver(dress).observe(host, { childList: true, subtree: true });
  dress();
})();

/* ===== Profile panel: draw attention to "Apply to be a vendor" with a gentle jiggle ===== */
(function () {
  "use strict";
  function mark() {
    var panel = document.getElementById("profilePanel"); if (!panel) return;
    panel.querySelectorAll(".vp-row, button, a").forEach(function (el) {
      if (el.classList.contains("vp-cta-jiggle")) return;
      var t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (/^Apply to be a vendor/i.test(t) && t.length < 60) el.classList.add("vp-cta-jiggle");
    });
  }
  new MutationObserver(mark).observe(document.body, { childList: true, subtree: true });
  mark();
})();

/* ===== Bank pickers: show each bank's own logo (small pictures kept with the app); a plain bank icon when there is none ===== */
(function () {
  "use strict";
  function dressBank() {
    document.querySelectorAll(".ve-bank-ico[data-bank-code]:not([data-lvlogo])").forEach(function (holder) {
      holder.setAttribute("data-lvlogo", "1");
      var code = String(holder.getAttribute("data-bank-code") || "").replace(/[^a-zA-Z0-9._-]/g, "");
      if (!code) return;
      var img = new Image(); img.alt = ""; img.decoding = "async";
      img.onload = function () { holder.innerHTML = ""; holder.classList.add("has-logo"); holder.appendChild(img); };
      img.src = "/bank-logos/" + code + ".webp";
    });
  }
  function dress() {
    dressBank();
    document.querySelectorAll(".vendor-bank-option:not([data-lvlogo])").forEach(function (btn) {
      btn.setAttribute("data-lvlogo", "1");
      var code = String(btn.getAttribute("data-bank-code") || "").replace(/[^a-zA-Z0-9._-]/g, "");
      var holder = btn.querySelector(".vendor-bank-option-icon");
      if (!code || !holder) return;
      var img = new Image();
      img.alt = ""; img.decoding = "async";
      img.onload = function () { holder.innerHTML = ""; holder.appendChild(img); };
      img.src = "/bank-logos/" + code + ".webp";
    });
  }
  new MutationObserver(dress).observe(document.body, { childList: true, subtree: true });
})();

/* ===== Settings: pick the pattern behind product cards ===== */
(function () {
  "use strict";
  var KEY = "lv-card-style";
  var STYLES = [["dots", "Dots", "lv-cs-dots"], ["lines", "Stripes", "lv-cs-lines"], ["grid", "Grid", "lv-cs-grid2"], ["glow", "Soft glow", "lv-cs-glow"], ["corners", "Corners", "lv-cs-corners"], ["plain", "Plain", ""]];
  function get() { try { return localStorage.getItem(KEY) || "dots"; } catch (_) { return "dots"; } }
  document.documentElement.setAttribute("data-card-style", get());
  function paint() {
    var cur = get();
    document.querySelectorAll("#lvCardStyleSection .lv-cs-tile").forEach(function (b) { var on = b.getAttribute("data-cs") === cur; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (_) {} document.documentElement.setAttribute("data-card-style", v); paint(); }
  function mount() {
    var page = document.getElementById("settings-page");
    if (!page || document.getElementById("lvCardStyleSection")) return;
    var first = page.querySelector(".settings-page-section"); if (!first) return;
    var sec = document.createElement("section");
    sec.className = "settings-page-section"; sec.id = "lvCardStyleSection";
    sec.innerHTML = '<h3><i class="fa-solid fa-table-cells-large"></i> Product cards</h3><p class="settings-section-note">Dots is the default. You can change the pattern behind product cards here any time; it is saved on this device.</p><div class="lv-cs-grid">' +
      STYLES.map(function (s) { return '<button type="button" class="lv-cs-tile" data-cs="' + s[0] + '" aria-pressed="false"><span class="lv-cs-prev ' + s[2] + '"></span>' + s[1] + "</button>"; }).join("") + "</div>";
    first.insertAdjacentElement("afterend", sec);
    sec.addEventListener("click", function (e) { var b = e.target.closest("[data-cs]"); if (b) set(b.getAttribute("data-cs")); });
    paint();
  }
  new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
  mount();
})();

/* ===== Vendors page: coming Back shows the vendors we already have straight away (no grey placeholders first) ===== */
(function () {
  "use strict";
  var orig = window.renderVendorsDirectory;
  if (typeof orig !== "function" || window.__lvVendorsInstant) return;
  window.__lvVendorsInstant = true;
  window.renderVendorsDirectory = function () {
    var html = orig.apply(this, arguments);
    try {
      var all = window.__allVendors;
      if (!Array.isArray(all) || !all.length || typeof vendorDirectorySkeletonHtml !== "function") return html;
      var sk = vendorDirectorySkeletonHtml();
      var at = html.indexOf(sk);
      if (at < 0) return html;
      var shown = window.__filteredVendors;
      var mode = typeof vendorDirectoryMode === "string" ? vendorDirectoryMode : "grid", cards = "";
      if (mode !== "map") {
        if (!Array.isArray(shown) || shown.length !== all.length) return html;   // a filter was applied last time: wait for the fresh list
        var fn = mode === "list" ? window.vendorDirectoryCardHtml || (typeof vendorDirectoryCardHtml === "function" ? vendorDirectoryCardHtml : null) : (typeof vendorPageCardHtml === "function" ? vendorPageCardHtml : null);
        if (!fn) return html;
        cards = shown.slice(0, 12).map(fn).join("");
      }
      return html.slice(0, at) + cards + html.slice(at + sk.length);
    } catch (_) { return html; }
  };
})();

/* ===== Home: three flyer banners for the vendor who is winning right now (storefront, products, follow) =====
   They are slipped in between the normal promotional banners, take their colours from the vendor's logo, and change on
   their own whenever a different vendor takes the lead. */
(function () {
  "use strict";
  var busy = false, prodCache = {}, colorCache = {};
  function esc2(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function hueOf(id) { var h = 2166136261; String(id).split("").forEach(function (ch) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }); return (h >>> 0) % 360; }
  // hand-picked pairs (no greens, no blues): the banners cycle through these, each one a step apart, and fade between them
  var PAL = [["#8438e8", "#6a22c9"], ["#6d28d9", "#be185d"], ["#e11d48", "#f97316"], ["#c2410c", "#9d174d"], ["#d946ef", "#7c3aed"], ["#be123c", "#6d28d9"], ["#f59e0b", "#ea580c"]];
  var palStep = 0, logoPal = null;
  function pickPal(offset) { var list = logoPal ? [logoPal].concat(PAL) : PAL; return list[(palStep + offset) % list.length]; }
  function palette(offset) { var c = pickPal(offset); return "--wv-a:" + c[0] + ";--wv-b:" + c[1] + ";--wv-ink:" + c[0]; }
  function rgbHex(h) { var a = (h % 360) / 60, x = 1 - Math.abs(a % 2 - 1), r = 0, g = 0, b = 0; if (a < 1) { r = 1; g = x; } else if (a < 2) { r = x; g = 1; } else if (a < 3) { g = 1; b = x; } else if (a < 4) { g = x; b = 1; } else if (a < 5) { r = x; b = 1; } else { r = 1; b = x; } var f = function (v) { return Math.round((0.18 + v * 0.55) * 255).toString(16).padStart(2, "0"); }; return "#" + f(r) + f(g) + f(b); }
  // the most colourful part of the logo, so the flyer matches it
  function logoHue(url) {
    if (!url) return Promise.resolve(null);
    if (colorCache[url] !== undefined) return Promise.resolve(colorCache[url]);
    return new Promise(function (res) {
      var im = new Image(); im.crossOrigin = "anonymous";
      var done = function (v) { colorCache[url] = v; res(v); };
      im.onload = function () {
        try {
          var c = document.createElement("canvas"); c.width = c.height = 32; var x = c.getContext("2d"); x.drawImage(im, 0, 0, 32, 32);
          var d = x.getImageData(0, 0, 32, 32).data, bins = new Array(24).fill(0);
          for (var i = 0; i < d.length; i += 4) {
            var r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dl = mx - mn;
            if (d[i + 3] < 200 || dl < .18 || l < .15 || l > .9) continue;
            var h = mx === r ? ((g - b) / dl + 6) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
            bins[Math.floor(h * 60 / 15) % 24] += dl;
          }
          var best = 0; bins.forEach(function (v, k) { if (v > bins[best]) best = k; });
          done(bins[best] > 0 ? best * 15 + 7 : null);
        } catch (_) { done(null); }
      };
      im.onerror = function () { done(null); };
      im.src = url;
    });
  }
  function products(vid) {
    var c = prodCache[vid]; if (c && Date.now() - c.at < 300000) return Promise.resolve(c.rows);
    return Promise.resolve(sb.from("products").select("id,name,photos,sale_price,discount_price,is_service").eq("vendor_id", vid).eq("status", "active").order("created_at", { ascending: false }).limit(40))
      .then(function (r) {
        var rows = ((r && r.data) || []).filter(function (p) { return p.photos && p.photos[0]; }).slice(0, 24);
        prodCache[vid] = { at: Date.now(), rows: rows }; preload(rows); return rows;   // the pictures are fetched up front, so a banner's products show the moment it slides in
      }).catch(function () { return []; });
  }
  function pick3(pool) { var a = pool.slice(), out = []; while (a.length && out.length < 3) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]); return out; }
  function th(u) { try { return typeof lvThumb === "function" ? lvThumb(u, 300) : u; } catch (_) { return u; } }
  function preload(rows) { try { (rows || []).forEach(function (p) { var i = new Image(); i.decoding = "async"; i.src = th(p.photos[0]); }); } catch (_) {} }
  function thumbsHtml(rows) { return rows.map(function (p) { return '<img data-pid="' + esc2(p.id) + '" src="' + esc2(th(p.photos[0])) + '" alt="" decoding="async">'; }).join(""); }
  function tilesHtml(rows) { return rows.map(function (p) { return '<span class="lv-wv-tile" data-pid="' + esc2(p.id) + '"><img src="' + esc2(th(p.photos[0])) + '" alt="" decoding="async"><b>' + esc2(p.name) + "</b><i>" + esc2(naira(p)) + "</i></span>"; }).join(""); }
  function naira(p) { try { var v = typeof effectivePrice === "function" ? effectivePrice(p) : (p.discount_price || p.sale_price); v = Number(v); return v > 0 ? "₦" + v.toLocaleString("en-NG") : ""; } catch (_) { return ""; } }
  function logoHtml(w, cls) {
    var ini = esc2(String(w.business_name || "?").trim().slice(0, 2).toUpperCase());
    return '<span class="lv-wv-logo ' + (cls || "") + '">' + (w.logo_url ? '<img src="' + esc2(w.logo_url) + '" alt="" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement(\'b\'),{textContent:\'' + ini + '\'}))">' : "<b>" + ini + "</b>") + "</span>";
  }
  // When the winner is the one for the chosen campus, that school's logo sits in front of the badge
  function scopeId() { try { return (window.__lb && window.__lb.spotFor) || ""; } catch (_) { return ""; } }
  function schoolChip() {
    var id = scopeId(); if (!id || typeof window.lvCampusLogoHtml !== "function") return "";
    var nm = ""; try { nm = window.lvCampusShort ? window.lvCampusShort(id) : ""; } catch (_) {}
    return '<span class="lv-wv-school" title="' + esc2(nm) + '"><span class="lv-wv-school-logo">' + window.lvCampusLogoHtml(id) + "</span></span>";
  }
  function slide(kind, w, rows, hue) {
    var id = esc2(w.vendor_id), nm = esc2(w.business_name);
    var open = ' class="home-promotional-slide lv-wv lv-wv-' + kind + '" data-wv="' + id + '" data-wv-kind="' + kind + '" style="' + palette({ a: 0, b: 1, c: 2, o: 0 }[kind]) + '" onclick="lvWvTap(event,\'' + kind + '\',\'' + id + '\')" aria-label="';
    if (kind === "o") {
      var pts = Number(w.points) ? " with " + Number(w.points).toLocaleString("en-NG") + " points" : "";
      var othumbs = thumbsHtml(rows);
      return '<button type="button" class="home-promotional-slide lv-wv lv-wv-o" data-wv="' + id + '" data-wv-kind="o" onclick="lvWvTap(event,\'o\',\'' + id + '\')" aria-label="Overall vendor of the week on every campus: ' + nm + '"><span class="lv-wv-in">' +
        '<span class="lv-wv-badge"><i class="fa-solid fa-crown"></i> Overall winner</span>' +
        logoHtml(w, "lv-wv-logo-big") +
        '<span class="lv-wv-name">' + nm + "</span>" +
        '<span class="lv-wv-sub">Last week\u2019s overall winner across all campuses' + pts + "</span>" +
        (othumbs ? '<span class="lv-wv-thumbs lv-wv-o-thumbs">' + othumbs + "</span>" : "") +
        '<span class="lv-wv-cta">Open storefront</span></span></button>';
    }
    var thumbs = thumbsHtml(rows);
    if (kind === "a") {
      return "<button type=\"button\"" + open + "Vendor of the week: " + nm + '"><span class="lv-wv-in">' +
        '<span class="lv-wv-badge">' + schoolChip() + '<i class="fa-solid fa-award"></i> Vendor of the week</span>' +
        logoHtml(w, "lv-wv-logo-big") +
        '<span class="lv-wv-name">' + nm + "</span>" +
        '<span class="lv-wv-sub">' + (Number(w.points) ? "Won last week with " + Number(w.points).toLocaleString("en-NG") + " points" : "Last week\u2019s winner") + "</span>" +
        (thumbs ? '<span class="lv-wv-thumbs">' + thumbs + "</span>" : "") +
        '<span class="lv-wv-cta">Open storefront</span></span></button>';
    }
    if (kind === "b") {
      var tiles = tilesHtml(rows);
      return "<button type=\"button\"" + open + "Shop " + nm + '"><span class="lv-wv-in">' +
        '<span class="lv-wv-badge">' + schoolChip() + '<i class="fa-solid fa-fire"></i> Fresh from the winner</span>' +
        logoHtml(w, "lv-wv-logo-sm") +
        '<span class="lv-wv-name lv-wv-name-sm">' + nm + "</span>" +
        '<span class="lv-wv-tiles">' + tiles + "</span>" +
        '<span class="lv-wv-more">Tap to shop all <i class="fa-solid fa-arrow-right"></i></span></span></button>';
    }
    return "<button type=\"button\"" + open + "Follow " + nm + '"><span class="lv-wv-in">' +
      '<span class="lv-wv-badge">' + schoolChip() + '<i class="fa-solid fa-heart"></i> Don\'t miss a drop</span>' +
      logoHtml(w, "lv-wv-logo-big") +
      '<span class="lv-wv-name">Follow ' + nm + "</span>" +
      '<span class="lv-wv-sub">Be first to see new products, deals and updates.</span>' +
      (thumbs ? '<span class="lv-wv-thumbs lv-wv-thumbs-r">' + thumbs + "</span>" : "") +
      '<span class="lv-wv-cta lv-wv-cta-follow">Follow</span></span></button>';
  }
  window.lvWvTap = function (e, kind, vid) {
    var s = e.currentTarget, vp = document.getElementById("homePromotionalViewport");
    try {
      if (vp && vp.dataset.loop === "1" && typeof homeCarouselStep === "function") {
        var step = homeCarouselStep(vp), dom = Array.prototype.indexOf.call(s.parentElement.children, s);
        if (step && Math.abs(vp.scrollLeft - dom * step) > step * .35) { e.preventDefault(); vp.scrollTo({ left: dom * step, behavior: "smooth" }); return; }
      }
      if (typeof homeCarouselJustDragged !== "undefined" && homeCarouselJustDragged) { e.preventDefault(); return; }
    } catch (_) {}
    if (kind.indexOf("fy:") === 0) {
      var act = kind.slice(3);
      if (act === "join") window.open("https://chat.whatsapp.com/DVCSNKkZ6AIHtKYyMPWxHs", "_blank", "noopener");
      else if (act === "links") window.open("/links", "_blank", "noopener");
      else if (act === "requestEquipment" && !session) requireLoginThen("requestEquipment");
      else navigate(act, {}, true);
      return;
    }
    var hit = e.target && e.target.closest && e.target.closest("[data-pid]");
    if (hit && kind !== "c") { navigate("productDetail", { productId: hit.getAttribute("data-pid") }); return; }
    if (kind !== "c") { navigate("storefront", { vendorId: vid }); return; }
    if (!session) { try { showLogin(); } catch (_) {} return; }
    try { window.__followRecentAction = { vendorId: String(vid), following: true, at: Date.now() }; window.rememberVendorFollow && window.rememberVendorFollow(vid, true); } catch (_) {}
    navigate("storefront", { vendorId: vid });
    Promise.resolve(levroData.follows.set(vid, true)).then(function (r) {
      if (r && r.error) throw r.error;
      try { showToast("You are now following this vendor.", "success"); } catch (_) {}
    }).catch(function () { try { window.__followRecentAction = null; showToast("Could not follow just now. Open the shop and tap follow.", "error"); } catch (_) {} });
  };
  // lays the banners out: winner flyers first, then alternating with the normal ones; adds the loop copies and the dots
  function compose(car, extra) {
    var track = car.querySelector("#homePromotionalTrack"), vp = car.querySelector("#homePromotionalViewport"); if (!track || !vp) return 0;
    var base = Array.prototype.filter.call(track.children, function (n) { return !n.hasAttribute("data-clone") && !n.hasAttribute("data-wv"); });
    if (!base.length) return 0;
    var tmp = document.createElement("div"); tmp.innerHTML = extra.join("");
    var wv = Array.prototype.slice.call(tmp.children), order = [], bi = 0;
    while (wv.length || bi < base.length) { if (wv.length) order.push(wv.shift()); if (bi < base.length) order.push(base[bi++]); }
    track.replaceChildren.apply(track, order);
    if (order.length > 1) {
      var lastC = order[order.length - 1].cloneNode(true), firstC = order[0].cloneNode(true);
      [lastC, firstC].forEach(function (c) { c.setAttribute("data-clone", "1"); c.setAttribute("tabindex", "-1"); c.setAttribute("aria-hidden", "true"); });
      track.insertBefore(lastC, track.firstChild); track.appendChild(firstC);
      vp.dataset.loop = "1";
    }
    var dots = car.querySelector("#homePromotionalDots");
    if (!dots && order.length > 1) { dots = document.createElement("div"); dots.className = "home-promotional-dots"; dots.id = "homePromotionalDots"; car.appendChild(dots); }
    if (dots) dots.innerHTML = order.map(function (_, i) { return '<button type="button" class="home-promotional-dot ' + (i === 0 ? "active" : "") + '" onclick="activateHomeCarouselSlide(' + i + ')" aria-label="Go to slide ' + (i + 1) + '"></button>'; }).join("");
    return order.length;
  }
  function rebuild(car, extra) {
    var vp = car.querySelector("#homePromotionalViewport"); if (!vp) return;
    var n = compose(car, extra); if (!n) return;
    // a fresh row: the old one still carries listeners that remember the old number of banners (they wrapped the loop too early)
    var fresh = vp.cloneNode(true); vp.replaceWith(fresh); vp = fresh;
    var order = { length: n };
    vp.dataset.carouselBound = ""; window.__levroCarouselDom = null;
    try { if (typeof homeCarouselTimer !== "undefined" && homeCarouselTimer) { clearInterval(homeCarouselTimer); homeCarouselTimer = null; } } catch (_) {}
    try { initHomepageCarousel(); } catch (_) {}
    var jump = function () { try { var st = homeCarouselStep(vp); if (st && order.length > 1) { vp.style.scrollSnapType = "none"; vp.scrollLeft = st; requestAnimationFrame(function () { vp.style.scrollSnapType = ""; }); } } catch (_) {} };
    requestAnimationFrame(jump); setTimeout(jump, 120); setTimeout(jump, 400);
  }
  // ---- the six launch banners, rebuilt in code from the original flyer pictures (same words, colours and photos, with moving icons) ----
  // A banner whose picture an admin uploaded or edited after this release (CUT) keeps its picture, so replacing one still works.
  var CUT = Date.parse("2026-10-26T00:00:00Z");
  var FY = [
    { k: "join", act: "join", link: "https://chat.whatsapp.com/DVCSNKkZ6AIHtKYyMPWxHs", label: "Join the community", h1: "Join the", h2: "community.", sub: "Be first to hear new vendors, offers and campus updates on WhatsApp.", cta: "Join the group", ph: "join", tiles: ["fa-cart-shopping", "fa-bag-shopping", "star"] },
    { k: "sell", act: "vendorApply", link: "?levro=vendorApply", label: "Sell to your whole campus", h1: "Sell to your", h2: "whole campus.", sub: "Open your shop in minutes. List products, get orders, grow.", cta: "Become a vendor", ph: "sell", tiles: ["fa-box", "star", "fa-tag", "fa-cart-shopping"] },
    { k: "store", act: "vendors", link: "?levro=vendors", label: "Your campus online store", h1: "Your campus", h2: "online store.", sub: "Shop products, book services and rent items from vendors on your campus.", cta: "Open the store", ph: "follow", tiles: ["fa-cart-shopping", "fa-box", "fa-bag-shopping", "fa-tag", "star"] },
    { k: "follow", act: "links", link: "/links", label: "Follow us everywhere", h1: "Follow us", h2: "everywhere.", sub: 'Same name on every platform: <b>@levromart</b>', cta: "Click to follow", ph: "store", tiles: ["star", "fa-bag-shopping", "fa-cart-shopping"], social: true },
    { k: "win", act: "leaderboard", link: "?levro=leaderboard", label: "Win a full week of promotion", h1: "Win a full week", h2: "of promotion.", sub: "Be seen by more customers. Be Vendor of the Week.", cta: "", ph: "win", tiles: ["fa-cart-shopping", "star", "fa-tag", "fa-bag-shopping"], soon: true },
    { k: "request", act: "requestEquipment", link: "?levro=requestEquipment", label: "Can't find it? Request it.", h1: "Can't find it?", h2: "Request it.", sub: "Tell vendors what you need. They come to you with offers.", cta: "Request an item", ph: "request", tiles: ["fa-cart-shopping", "fa-bag-shopping", "star", "fa-box"] }
  ];
  var SOC = [["fa-instagram", "#e1306c"], ["fa-tiktok", "#111"], ["fa-facebook-f", "#1877f2"], ["fa-x-twitter", "#000"], ["fa-linkedin-in", "#0a66c2"], ["substack", "#ff6719"], ["fa-whatsapp", "#25d366"]];
  // the icon font has no Substack logo, so it is drawn here
  var SUBSTACK = '<svg viewBox="0 0 24 24" width="55%" height="55%" fill="#fff" aria-hidden="true"><path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z"/></svg>';
  function fyHtml(d) {
    var tiles = d.tiles.map(function (t, i) { return '<span class="lv-fy-t lv-fy-t' + (i + 1) + '">' + (t === "star" ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-solid ' + t + '"></i>') + "</span>"; }).join("");
    var soc = d.social ? '<span class="lv-fy-soc">' + SOC.map(function (x) { return '<span style="background:' + x[1] + '">' + (x[0] === "substack" ? SUBSTACK : '<i class="fa-brands ' + x[0] + '"></i>') + "</span>"; }).join("") + "</span>" : "";
    return '<span class="lv-wv-in"><span class="lv-fy-brand"><img src="/icon-192.png" alt="" width="40" height="40"><b>levromart</b></span>' +
      (d.soon ? '<span class="lv-fy-soon">COMING SOON</span>' : "") +
      '<span class="lv-fy-h"><em>' + d.h1 + "</em><strong>" + d.h2 + "</strong></span>" +
      '<span class="lv-fy-sub">' + d.sub + "</span>" + soc +
      (d.cta ? '<span class="lv-fy-cta">' + d.cta + "" + "</span>" : "") +
      (d.foot ? '<span class="lv-fy-foot">' + d.foot + "</span>" : "") +
      '<span class="lv-fy-photo"><img src="/lb/flyer-' + d.ph + '.webp" alt="" decoding="async"></span>' + tiles + "</span>";
  }
  function flyerize(b, d) {
    b.classList.add("lv-wv", "lv-fy", "lv-fy-" + d.k); b.setAttribute("data-flyer", d.k);
    b.setAttribute("data-link-url", d.link); b.setAttribute("onclick", "lvWvTap(event,'fy:" + d.act + "','')"); b.setAttribute("aria-label", d.label); b.removeAttribute("style");
    b.innerHTML = fyHtml(d);
  }
  var origR = window.renderHomepageCarouselHtml;
  if (typeof origR === "function" && !window.__lvDesignedBanners) {
    window.__lvDesignedBanners = true;
    window.renderHomepageCarouselHtml = function () {
      var arguments0 = arguments[0], html = origR.apply(this, arguments);
      if (!html) return html;
      try {
        var box = document.createElement("div"); box.innerHTML = html;
        var list = (arguments0 && arguments0.filter ? arguments0 : []).filter(function (x) { return x && x.image_url; }).slice(0, 12), map = {}, n = 0;
        list.forEach(function (sl, i) { var t = Date.parse(sl.updated_at || sl.created_at || ""); if ((!t || t < CUT) && n < FY.length) map[i] = FY[n++]; });
        box.querySelectorAll(".home-promotional-slide").forEach(function (b) { var d = map[Number(b.getAttribute("data-carousel-index"))]; if (d) flyerize(b, d); });
        var car = box.querySelector("#homePromotionalCarousel"), c = null;
        try { c = JSON.parse(localStorage.getItem("lv-wv-cache") || "null"); } catch (_) {}
        if (car && c && c.w && c.w.vendor_id && Date.now() - c.at < 43200000 && !c.scope && (function () { try { return (window.lvViewCampus ? window.lvViewCampus() : "all") === "all"; } catch (_) { return true; } })()) {
          logoPal = c.pal || null; var pool = c.pool || []; window.__lvWvPool = pool;
          var rows = pick3(pool), extra = [slide("a", c.w, rows, 0)]; if (rows.length) extra.push(slide("b", c.w, rows, 0)); extra.push(slide("c", c.w, rows, 0));
          car.setAttribute("data-wv-key", c.w.vendor_id + "|" + (logoPal ? logoPal[0] : "") + "|" + (pool.length ? 1 : 0));
          compose(car, extra);
        }
        return box.innerHTML;
      } catch (_) { return html; }
    };
  }
  var again = false;
  async function inject() {
    if (busy || Date.now() - (window.__lvCarTouchedAt || 0) < 15000) return;
    var car = document.getElementById("homePromotionalCarousel"); if (!car || typeof window.lvVendorSpot !== "function") return;
    busy = true;
    try {
      var spot = await window.lvVendorSpot();
      var w = spot && spot.winner;   // the vendor who WON last week keeps the banners for this whole week (not whoever is leading right now)
      if (w && (!w.vendor_id || !w.business_name)) w = null;
      // the overall winner (all campuses) has a banner of its own that stays whichever campus view is chosen
      var ov = null; try { ov = typeof window.lvOverallSpot === "function" ? await window.lvOverallSpot() : null; } catch (_) {}
      var ow = ov && ov.winner && ov.winner.vendor_id && ov.winner.business_name ? ov.winner : null;
      car = document.getElementById("homePromotionalCarousel"); if (!car) return;
      if (!w && !ow) { try { localStorage.removeItem("lv-wv-cache"); } catch (_) {} car.querySelectorAll("[data-wv]").length && removeAll(car); return; }
      var extra = [], pool = [], rows = [], h = null;
      if (w) {
        pool = await products(w.vendor_id); rows = pick3(pool); window.__lvWvPool = pool;
        h = await logoHue(w.logo_url);
        logoPal = (h != null && (h < 70 || h > 170)) ? [rgbHex(h), rgbHex(h + 40)] : null;
      } else { logoPal = null; window.__lvWvPool = []; }
      car = document.getElementById("homePromotionalCarousel"); if (!car) return;
      var key = (w ? w.vendor_id + "|" + (logoPal ? logoPal[0] : "") + "|" + (pool.length ? 1 : 0) + "|" + scopeId() : "none") + "|ov:" + (ow ? ow.vendor_id : "");
      if (car.getAttribute("data-wv-key") === key) return;
      if (w) { extra.push(slide("a", w, rows, h)); if (rows.length) extra.push(slide("b", w, rows, h)); extra.push(slide("c", w, rows, h)); }
      if (ow) { var opool = await products(ow.vendor_id); window.__lvOvPool = opool; extra.push(slide("o", ow, pick3(opool), null)); } else window.__lvOvPool = [];
      car.setAttribute("data-wv-key", key);
      if (w) { try { localStorage.setItem("lv-wv-cache", JSON.stringify({ at: Date.now(), scope: scopeId(), w: { vendor_id: w.vendor_id, business_name: w.business_name, logo_url: w.logo_url, points: w.points }, pal: logoPal, pool: pool.map(function (p) { return { id: p.id, name: p.name, photos: [p.photos[0]], sale_price: p.sale_price, discount_price: p.discount_price, is_service: p.is_service }; }) })); } catch (_) {} }
      rebuild(car, extra);
    } catch (err) { console.warn("[Levromart] winner banners", err); } finally { busy = false; if (again) { again = false; setTimeout(inject, 0); } }
  }
  function removeAll(car) { car.removeAttribute("data-wv-key"); rebuild(car, []); }
  var t = 0;
  new MutationObserver(function () { if (t || busy) return; if (!document.getElementById("homePromotionalCarousel")) return; t = setTimeout(function () { t = 0; inject(); }, 120); }).observe(document.body, { childList: true, subtree: true });
  setInterval(function () { if (!document.hidden) inject(); }, 120000);
  document.addEventListener("lv-spot-changed", function () { window.__lvCarTouchedAt = 0; if (busy) { again = true; return; } setTimeout(inject, 0); });
  // every few seconds: new products on the flyers, new colours on the banners
  function swapProducts() {
    if (document.hidden) return;
    if (window.__lvDragging || document.documentElement.classList.contains("lv-fab-dragging")) return;   // never while a button is being carried
    var onScreen = function (box) { var r = box.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
    // each winner's banners draw from that winner's own products: the campus winner's, and (separately) the overall winner's
    [[window.__lvWvPool, ".lv-wv-thumbs:not(.lv-wv-o-thumbs), .lv-wv-tiles"], [window.__lvOvPool, ".lv-wv-o-thumbs"]].forEach(function (g) {
      var pool = g[0]; if (!pool || pool.length < 4) return;
      var rows = pick3(pool);
      // look first (only banners on screen), then change: no layout is forced in between
      var boxes = [].filter.call(document.querySelectorAll(g[1]), onScreen);
      if (!boxes.length) return;
      boxes.forEach(function (box) { box.classList.remove("lv-wv-swap"); });
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        boxes.forEach(function (box) {
          box.innerHTML = box.classList.contains("lv-wv-tiles") ? tilesHtml(rows) : thumbsHtml(rows);
          box.classList.add("lv-wv-swap");
        });
      }); });
    });
  }
  function swapColours() {
    if (document.hidden || window.__lvDragging) return; palStep++;
    document.querySelectorAll(".lv-wv").forEach(function (sl) {
      var c = pickPal(sl.hasAttribute("data-pal") ? Number(sl.getAttribute("data-pal")) : ({ a: 0, b: 1, c: 2 }[sl.getAttribute("data-wv-kind")] || 0));
      sl.style.setProperty("--wv-a", c[0]); sl.style.setProperty("--wv-b", c[1]); sl.style.setProperty("--wv-ink", c[0]);
    });
  }
  setInterval(swapProducts, 7000);
  setInterval(swapColours, 11000);
  inject();
})();


/* ===== Home strips: the "Shop from your campus / Follow us / ..." banners fade through nicer colours and their icons wiggle now and then ===== */
(function () {
  "use strict";
  var P = [["#6d28d9", "#be185d"], ["#1d4ed8", "#7c3aed"], ["#e11d48", "#f97316"], ["#0e7490", "#1e3a8a"], ["#c2410c", "#9d174d"], ["#4338ca", "#0ea5e9"], ["#be123c", "#6d28d9"]];
  var step = 0;
  function paint() {
    document.querySelectorAll(".lv-b3-slide").forEach(function (sl, i) {
      if (sl.classList.contains("s5")) return;     // WhatsApp keeps its own green
      var c = P[(step + i * 2) % P.length];
      sl.style.setProperty("--b3-a", c[0]); sl.style.setProperty("--b3-b", c[1]);
    });
  }
  new MutationObserver(function () { if (document.querySelector(".lv-b3-slide:not([style*='--b3-a'])")) paint(); }).observe(document.body, { childList: true, subtree: true });
  setInterval(function () { if (!document.hidden && !window.__lvDragging) { step++; paint(); } }, 9000);
  paint();
})();

/* ===== Empty pages (saved items, following): same lively "what to do next" cards as the Orders page ===== */
(function () {
  "use strict";
  var SETS = [
    { re: /^Nothing saved yet/i, acts: [["fa-bag-shopping", "Browse products", "home"], ["fa-store", "Find vendors", "vendors"]], steps: [["fa-heart", "Save it", "Tap the heart on anything you like", "#e11d48"], ["fa-bell", "Stay tuned", "Come back when you are ready", "#6d28d9"], ["fa-bag-shopping", "Buy it", "Order straight from your saved list", "#0e7490"]] },
    { re: /not following/i, acts: [["fa-store", "Find vendors", "vendors"], ["fa-trophy", "See who is winning", "leaderboard"]], steps: [["fa-store", "Pick a vendor", "Open a storefront you like", "#6d28d9"], ["fa-user-plus", "Follow", "One tap on the follow button", "#e11d48"], ["fa-bell", "Get updates", "New drops and deals reach you first", "#0e7490"]] }
  ];
  function dress() {
    document.querySelectorAll("#app .empty-state:not([data-lv-live])").forEach(function (el) {
      var t = (el.textContent || "").replace(/\s+/g, " ").trim(), set = SETS.filter(function (x) { return x.re.test(t); })[0];
      if (!set) return;
      el.setAttribute("data-lv-live", "1"); el.classList.add("orders-empty-live");
      el.insertAdjacentHTML("beforeend",
        '<div class="oe-actions">' + set.acts.map(function (a, i) { return '<button type="button" class="btn' + (i ? " btn-outline" : "") + '" onclick="navigate(\'' + a[2] + '\')"><i class="fa-solid ' + a[0] + '"></i> ' + a[1] + "</button>"; }).join("") + "</div>" +
        '<div class="oe-steps">' + set.steps.map(function (x, i) { return '<div class="oe-step" style="--oe:' + x[3] + ";animation-delay:" + i * 90 + 'ms"><span class="oe-ico"><i class="fa-solid ' + x[0] + '"></i></span><b>' + x[1] + "</b><small>" + x[2] + "</small></div>"; }).join("") + "</div>");
    });
  }
  new MutationObserver(function () { dress(); }).observe(document.body, { childList: true, subtree: true });
  dress();
})();


/* ===== Levi: the X always closes him (and Esc), even if something else swallowed the tap ===== */
(function () {
  "use strict";
  function closeLevi() {
    var p = document.getElementById("aiChatPanel");
    if (!p || p.classList.contains("hidden")) return;
    p.classList.add("hidden"); p.classList.remove("lv-full", "lv-side-open"); document.documentElement.classList.remove("lv-levi-full"); p.style.removeProperty("transform"); p.style.removeProperty("transition");
    try { syncLeviFabVisibility(); } catch (_) {}
    try { updateCartFab(); } catch (_) {}
  }
  function isX(e) { return e.target && e.target.closest && e.target.closest("#aiChatPanel .drawer-close-btn"); }
  document.addEventListener("click", function (e) { if (!isX(e)) return; e.preventDefault(); e.stopPropagation(); closeLevi(); }, true);
  document.addEventListener("touchend", function (e) { if (!isX(e)) return; if (e.cancelable) e.preventDefault(); e.stopPropagation(); closeLevi(); }, { capture: true, passive: false });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLevi(); });
})();

/* ===== Home banners: once someone touches the row, it stays where they leave it (no more self-scrolling back) ===== */
(function () {
  "use strict";
  window.__lvCarTouchedAt = 0;
  // a pause can only get longer: the row's own short 8-second pause must not cancel the long one set when someone touches it
  var pauseOrig = window.homeCarouselPause;
  if (typeof pauseOrig === "function" && !window.__lvPauseMax) {
    window.__lvPauseMax = true;
    window.homeCarouselPause = function (ms) {
      try { var until = Date.now() + ms; if (until > homeCarouselResumeAt) homeCarouselResumeAt = until; } catch (_) { pauseOrig(ms); }
    };
  }
  function mine(e) { return e.target && e.target.closest && e.target.closest("#homePromotionalViewport"); }
  ["touchstart", "pointerdown", "wheel", "mousedown"].forEach(function (t) {
    document.addEventListener(t, function (e) {
      if (!mine(e)) return;
      window.__lvCarTouchedAt = Date.now();
      try { homeCarouselPause(10000); } catch (_) {}
    }, { passive: true, capture: true });
  });
})();

/* ===== Home: Trending products / services drift one card to the right every 10 seconds (stops while someone is using the row) ===== */
(function () {
  "use strict";
  var reduce = false; try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) {}
  if (reduce) return;
  var touched = new WeakMap();
  ["touchstart", "pointerdown", "wheel", "mousedown"].forEach(function (t) {
    document.addEventListener(t, function (e) { var row = e.target && e.target.closest && e.target.closest(".trending-scroll"); if (row) touched.set(row, Date.now()); }, { passive: true, capture: true });
  });
  setInterval(function () {
    if (document.hidden) return;
    document.querySelectorAll("#app .trending-scroll").forEach(function (row) {
      if (row.scrollWidth <= row.clientWidth + 8) return;                       // everything already fits
      var r = row.getBoundingClientRect(); if (r.bottom < 0 || r.top > window.innerHeight) return;   // off screen
      if (window.__lvDragging || Date.now() - (touched.get(row) || 0) < 30000) return;
      var first = row.firstElementChild, gap = parseFloat(getComputedStyle(row).columnGap) || 12;
      var step = first ? first.getBoundingClientRect().width + gap : row.clientWidth * 0.8;
      var atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 6;
      if (atEnd) return;   // never jumps back to the first card: the row keeps filling with more products instead
      try { row.scrollTo({ left: row.scrollLeft + step, behavior: "smooth" }); } catch (_) {}
    });
  }, 10000);
})();

/* ===== Always run the newest version: whenever the app comes back to the front, check for a newer release and refresh once ===== */
(function () {
  "use strict";
  var link = document.querySelector('link[href*="01-base.css"]');
  var m = link && /[?&]v=(\d+)/.exec(link.getAttribute("href") || "");
  var running = m ? m[1] : null;
  if (!running) return;
  var hiddenAt = 0, lastCheck = 0;
  function busy() {
    var a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value);
  }
  async function check(force) {
    if (Date.now() - lastCheck < (force ? 0 : 90000)) return;
    lastCheck = Date.now();
    try {
      var reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) reg.update().catch(function () {});
      var r = await fetch("/sw.js?lvv=" + Date.now(), { cache: "no-store" });
      var t = await r.text(), n = /shell-v(\d+)/.exec(t);
      if (!n || n[1] === running) return;
      var key = "lv-updated-to"; var done = ""; try { done = sessionStorage.getItem(key) || ""; } catch (_) {}
      if (done === n[1] || busy()) return;           // only once per release, never while someone is typing
      try { sessionStorage.setItem(key, n[1]); } catch (_) {}
      try { showToast("Updating Levromart…", "info"); } catch (_) {}
      setTimeout(function () { location.reload(); }, 600);
    } catch (_) {}
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 15000) check(true);
  });
  window.addEventListener("pageshow", function (e) { if (e.persisted) check(true); });
  setTimeout(function () { check(true); }, 4000);          // shortly after opening
  setInterval(function () { if (!document.hidden) check(false); }, 300000);
})();

/* ---- Vendor-of-the-week banners: the products come up one after another when the banner slides into view ---- */
(function(){
  if(!("IntersectionObserver" in window)) return;
  var io=null, seen=new WeakSet();
  function mk(vp){
    io=new IntersectionObserver(function(es){ es.forEach(function(e){ e.target.classList.toggle("lv-wv-live",e.isIntersecting&&e.intersectionRatio>=0.55); }); },{root:vp||null,threshold:[0,0.55,0.8]});
  }
  function scan(){
    var vp=document.getElementById("homePromotionalViewport");
    var list=document.querySelectorAll(".lv-wv.lv-wv-a,.lv-wv.lv-wv-b,.lv-wv.lv-wv-c,.lv-wv.lv-wv-o"); if(!list.length) return;
    if(!io||io.__vp!==vp){ if(io) io.disconnect(); mk(vp); io.__vp=vp; seen=new WeakSet(); }
    document.documentElement.classList.add("lv-stag");
    list.forEach(function(s){ if(!seen.has(s)){ seen.add(s); io.observe(s); } });
  }
  var q=0; new MutationObserver(function(){ if(q) return; q=setTimeout(function(){ q=0; scan(); },80); }).observe(document.documentElement,{childList:true,subtree:true});
  scan();
})();

/* ---- Shop location: pick a point on the map once; it stays until the owner changes it ---- */
(function () {
  var esc2 = function (t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function campusName() {
    try { var id = window.lvMyCampusId && window.lvMyCampusId(); if (!id || id === "none") return ""; var r = window.lvCampusById && window.lvCampusById(id); return r ? r.name + (r.city ? ", " + r.city : "") : ""; } catch (_) { return ""; }
  }
  function geocode(q) {
    if (!q) return Promise.resolve(null);
    return fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ng&q=" + encodeURIComponent(q), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); }).then(function (a) { return a && a[0] ? { lat: Number(a[0].lat), lng: Number(a[0].lon), name: a[0].display_name } : null; }).catch(function () { return null; });
  }
  window.lvPickShopLocation = function (opts) {
    opts = opts || {};
    var old = document.getElementById("lvLocPick"); if (old) old.remove();
    var w = document.createElement("div"); w.id = "lvLocPick"; w.className = "lvlp";
    var school = opts.school || campusName();
    w.innerHTML = '<div class="lvlp-map" id="lvlpMap"></div><div class="lvlp-pin" aria-hidden="true"><i class="fa-solid fa-location-dot"></i></div>' +
      '<div class="lvlp-top"><button type="button" class="lvlp-x" aria-label="Close"><i class="fa-solid fa-xmark"></i></button><div class="lvlp-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" id="lvlpQ" placeholder="Search your school or area" value="' + esc2(school) + '" autocomplete="off"></div></div>' +
      '<div class="lvlp-card"><strong>Set your shop location</strong><p>Drag the map so the pin sits exactly where your shop is. This stays your location until you change it yourself.</p>' +
      '<div class="lvlp-row"><button type="button" class="lvlp-alt" id="lvlpMe"><i class="fa-solid fa-location-crosshairs"></i> Use my location now</button>' + (school ? '<button type="button" class="lvlp-alt" id="lvlpSchool"><i class="fa-solid fa-graduation-cap"></i> My school</button>' : "") + '</div>' +
      '<button type="button" class="lvlp-save" id="lvlpSave"><i class="fa-solid fa-check"></i> Save this location</button></div>';
    document.body.appendChild(w); document.documentElement.style.overflow = "hidden";
    var map = null, close = function () { try { map && map.remove(); } catch (_) {} w.remove(); document.documentElement.style.overflow = ""; };
    w.querySelector(".lvlp-x").onclick = close;
    var go = function (lat, lng, z) { if (map) map.setView([lat, lng], z || 16, { animate: true }); };
    (typeof loadLeaflet === "function" ? loadLeaflet() : Promise.resolve()).then(function () {
      var start = opts.lat != null && opts.lng != null ? [Number(opts.lat), Number(opts.lng)] : [6.5244, 3.3792];
      map = window.L.map("lvlpMap", { zoomControl: false, attributionControl: true, tap: false }).setView(start, opts.lat != null ? 17 : 12);
      map.attributionControl.setPrefix(false);
      (typeof addBasemapTileLayer === "function" ? addBasemapTileLayer(map) : window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }).addTo(map));
      if (opts.lat == null && school) geocode(school).then(function (g) { if (g) go(g.lat, g.lng, 16); });
    });
    var q = w.querySelector("#lvlpQ"), t = null;
    var run = function () { geocode(q.value.trim()).then(function (g) { if (g) go(g.lat, g.lng, 16); else try { showToast("Couldn't find that place. Try a nearby landmark.", "info"); } catch (_) {} }); };
    q.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); run(); q.blur(); } });
    var sb2 = w.querySelector("#lvlpSchool"); if (sb2) sb2.onclick = function () { q.value = school; run(); };
    w.querySelector("#lvlpMe").onclick = function () {
      var b = this; b.disabled = true;
      (typeof getCurrentPositionOnce === "function" ? getCurrentPositionOnce() : Promise.reject(new Error("Location is not available on this device.")))
        .then(function (l) { go(l.lat, l.lng, 17); }).catch(function (e) { try { showToast((e && e.message) || "Couldn't get your location.", "error"); } catch (_) {} }).then(function () { b.disabled = false; });
    };
    w.querySelector("#lvlpSave").onclick = function () {
      if (!map) return; var c = map.getCenter(); var out = { lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)) };
      Promise.resolve(opts.onSave && opts.onSave(out)).then(function () { close(); }).catch(function (e) { try { showToast((e && e.message) || "Couldn't save.", "error"); } catch (_) {} });
    };
  };
  /* the application form gets a "Shop location" block under the address */
  var prev = window.renderVendorApply;
  if (typeof prev === "function") window.renderVendorApply = async function () {
    window.__vaLoc = null;
    var html = await prev.apply(this, arguments); html = String(html || "");
    if (html.indexOf('id="vaAddress"') < 0 || html.indexOf("vaLocBlock") >= 0) return html;
    var block = '<div class="va-loc" id="vaLocBlock"><div class="va-loc-ic"><i class="fa-solid fa-location-dot"></i></div><div class="va-loc-t"><strong>Shop location</strong><span id="vaLocText">Pick the point on the map where you are. Students: it starts at your school.</span></div><button type="button" class="va-loc-btn" onclick="vaPickLocation()">Set on map</button></div>';
    return html.replace(/(<input id="vaAddress"[^>]*\/?>)/i, "$1" + block);
  };
  window.vaPickLocation = function () {
    lvPickShopLocation({ lat: window.__vaLoc && window.__vaLoc.lat, lng: window.__vaLoc && window.__vaLoc.lng, onSave: function (l) {
      window.__vaLoc = l; var t = document.getElementById("vaLocText"); if (t) t.textContent = "Location saved. You can change it later in your business profile.";
      var b = document.querySelector("#vaLocBlock .va-loc-btn"); if (b) b.textContent = "Change";
      document.getElementById("vaLocBlock")?.classList.add("ok");
    } });
  };
})();

/* ---- Tabs react at once: the bottom bar lights the tapped tab inside the tap, and the vendors map strip is rebuilt after the page is on screen ---- */
(function(){
  document.addEventListener("click",function(e){
    var b=e.target&&e.target.closest&&e.target.closest("#bottomNav .bottom-nav-item"); if(!b) return;
    document.querySelectorAll("#bottomNav .bottom-nav-item").forEach(function(x){ x.classList.toggle("active",x===b); });
  },true);
  var rt=0;
  function wrapRail(){
    var r=window.renderVendorMapRail; if(typeof r!=="function"||r.__lvLazy) return;
    var w=function(){
      var wrap=document.getElementById("vendorsMapWrap"), self=this, args=arguments;
      if(wrap&&wrap.classList.contains("hidden")){ clearTimeout(rt); rt=setTimeout(function(){ r.apply(self,args); },900); return; }
      return r.apply(this,args);
    };
    w.__lvLazy=true; window.renderVendorMapRail=w;
  }
  wrapRail(); setTimeout(wrapRail,1500);
})();

/* ---- a thin line on top of the bottom bar slides to the tab you tap (and the page slides in the same direction) ---- */
(function(){
  var lastG=null;
  function geo(nav,it){ var n=nav.getBoundingClientRect(), r=it.getBoundingClientRect(), w=Math.max(0,r.width-8); return {x:r.left-n.left+4,w:w}; }
  function put(nav,animate){
    if(!nav) return;
    var it=nav.querySelector(".bottom-nav-item.active"), ind=nav.querySelector(".bn-ind");
    if(!ind){ ind=document.createElement("i"); ind.className="bn-ind"; ind.setAttribute("aria-hidden","true"); nav.appendChild(ind); }
    if(!it){ ind.style.opacity="0"; return; }
    var g=geo(nav,it); if(!g.w) return;
    ind.style.opacity="1";
    if(lastG&&animate!==false){ ind.style.transition="none"; ind.style.width=lastG.w+"px"; ind.style.transform="translateX("+lastG.x+"px)"; void ind.offsetWidth; }
    ind.style.transition="transform .24s cubic-bezier(.22,.9,.3,1),width .24s cubic-bezier(.22,.9,.3,1)";
    ind.style.width=g.w+"px"; ind.style.transform="translateX("+g.x+"px)";
    lastG=g;
  }
  function wrap(){
    var r=window.renderBottomNav; if(typeof r!=="function"||r.__lvInd) return;
    var w=function(){ var out=r.apply(this,arguments); try{ requestAnimationFrame(function(){ try{ put(document.getElementById("bottomNav"),true); }catch(_){} }); }catch(_){} return out; };
    w.__lvInd=true; window.renderBottomNav=w;
  }
  wrap(); setTimeout(wrap,800);
  document.addEventListener("click",function(e){
    var b=e.target&&e.target.closest&&e.target.closest("#bottomNav .bottom-nav-item"); if(!b) return;
    requestAnimationFrame(function(){ put(document.getElementById("bottomNav"),true); });
  },true);
  window.addEventListener("resize",function(){ lastG=null; put(document.getElementById("bottomNav"),false); });
  setTimeout(function(){ put(document.getElementById("bottomNav"),false); },1200);
})();

/* ===== Vendor wallet: what Levromart is holding, what is on its way to the bank, what has been paid out ===== */
(function () {
  "use strict";
  var HIDE = "lv-wallet-hide", TTL = 45000;
  var cache = null, loading = null, filter = "all", tab = "tx";
  // amounts are hidden every time the app is opened; showing them lasts only until the app is closed
  var revealed = false;
  function hidden() { return !revealed; }
  function setHidden(v) { revealed = !v; }
  function money(n) { return hidden() ? "₦ ••••" : "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function when(d) { try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " + new Date(d).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" }); } catch (_) { return ""; } }

  var FEE_TYPES = { sale_price: 1, rental_fee: 1, delivery_deposit_20: 1 };
  function storeKey() { return "lv-wallet-v1:" + ((typeof vendor !== "undefined" && vendor && vendor.id) || ""); }
  function readStored() {
    try { var r = JSON.parse(localStorage.getItem(storeKey()) || "null"); if (r && r.data) { cache = { at: 0, data: r.data }; } } catch (_) {}
  }
  function writeStored(data) {
    try { var d = Object.assign({}, data, { tx: data.tx.slice(0, 80), charges: data.charges.slice(0, 80) }); localStorage.setItem(storeKey(), JSON.stringify({ at: Date.now(), data: d })); } catch (_) {}
  }
  async function load(force) {
    if (!cache) readStored();
    if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
    if (loading) return loading;
    loading = (async function () {
      var v = typeof vendor !== "undefined" ? vendor : null;
      if (!v || !v.id) return null;
      var res = await Promise.all([
        sb.from("orders").select("id,status,created_at,completed_at,items:order_items(quantity,product:products(name)),payments(payment_type,amount,status,method,provider_reference,paid_at)").eq("vendor_id", v.id).neq("status", "cancelled").order("created_at", { ascending: false }).limit(150),
        sb.from("vendor_payouts").select("order_id,amount_kobo,status,hold_reason,last_error,withdrawal_id,created_at,updated_at").eq("vendor_id", v.id),
        sb.from("commission_charges").select("order_id,amount,status,created_at,paid_at").eq("vendor_id", v.id).order("created_at", { ascending: false }).limit(300),
        sb.rpc("get_vendor_commission_owed", { p_vendor_id: v.id }),
        sb.rpc("get_vendor_commission_deadline", { p_vendor_id: v.id }),
        sb.from("withdrawal_requests").select("id,status,kind,amount_kobo,has_dispute,reject_reason,created_at,decided_at").eq("vendor_id", v.id).order("created_at", { ascending: false }).limit(30),
        // money given back to buyers comes off the shop's wallet (the shop's share, after commission)
        sb.from("paystack_refunds").select("order_id,amount_kobo,status").neq("status", "failed").limit(500)
      ]);
      var orders = (res[0] && res[0].data) || [], payouts = (res[1] && res[1].data) || [], charges = (res[2] && res[2].data) || [];
      var owed = Number((res[3] && res[3].data) || 0), dueAt = res[4] && res[4].data && res[4].data[0] ? res[4].data[0].earliest_due_at : null;
      var payoutBy = {}; payouts.forEach(function (p) { payoutBy[p.order_id] = p; });
      var commBy = {}; charges.forEach(function (c) { commBy[c.order_id] = (commBy[c.order_id] || 0) + Number(c.amount || 0); });
      var requests = (res[5] && res[5].data) || [];
      var refundBy = {}; ((res[6] && res[6].data) || []).forEach(function (r) { refundBy[r.order_id] = (refundBy[r.order_id] || 0) + Number(r.amount_kobo || 0) / 100; });
      var tx = [], pending = 0, onWay = 0, paidOut = 0, ready = 0, held = 0, asked = 0, heldReason = "", delayed = 0;
      orders.forEach(function (o) {
        var paid = (o.payments || []).filter(function (p) { return p.status === "paid" && FEE_TYPES[p.payment_type] && (p.method === "card" || /^(lvm_ord_|medris_)/.test(String(p.provider_reference || ""))); });
        if (!paid.length) return;
        var gross = paid.reduce(function (s, p) { return s + Number(p.amount || 0); }, 0);
        var comm = commBy[o.id] || 0, back = refundBy[o.id] || 0, net = Math.max(0, gross - comm - back);
        var at = paid.map(function (p) { return p.paid_at; }).filter(Boolean).sort().pop() || o.created_at;
        var legacy = paid.every(function (p) { return /^medris_/.test(String(p.provider_reference || "")); });
        var pay = payoutBy[o.id], state, amount = net, date = at;
        if (legacy) {   // the older checkout: Paystack pays the shop's bank directly, the next business day
          state = Date.now() - new Date(at).getTime() < 2 * 86400000 ? "onway" : "paid";
        } else if (pay) {
          if (pay.status === "success" || pay.status === "paid_manually") { state = "paid"; if (Number(pay.amount_kobo) > 0) amount = Number(pay.amount_kobo) / 100; date = pay.updated_at || pay.created_at; }
          else if (pay.status === "on_hold" && pay.hold_reason === "Waiting for the vendor to withdraw") state = o.status === "disputed" ? "held" : pay.withdrawal_id ? "asked" : "ready";
          else if (pay.status === "on_hold") { state = "held"; if (!heldReason) heldReason = pay.hold_reason || ""; }
          else { state = "onway"; if (pay.status === "pending" && pay.last_error === "Paystack balance too low") delayed += amount; }
        } else if (o.status === "disputed") state = "held";
        else if (o.status === "completed") state = "onway";
        else state = "pending";
        if (state === "pending") pending += amount; else if (state === "ready") ready += amount; else if (state === "held") held += amount; else if (state === "asked") asked += amount; else if (state === "onway") onWay += amount; else paidOut += amount;
        var names = (o.items || []).map(function (i) { return i && i.product && i.product.name; }).filter(Boolean);
        var title = names.length ? names[0] + (names.length > 1 ? " +" + (names.length - 1) + " more" : "") : "Order";
        tx.push({ id: o.id, state: state, amount: amount, gross: gross, comm: comm, refunded: back, date: date, title: title });
      });
      tx.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
      var commissionTotal = charges.reduce(function (s, c) { return s + (c.status === "waived" ? 0 : Number(c.amount || 0)); }, 0);
      var data = { pending: pending, ready: ready, held: held, requests: requests, asked: asked, heldReason: heldReason, onWay: onWay, delayed: delayed, paidOut: paidOut, tx: tx, charges: charges, owed: owed, dueAt: dueAt, commissionTotal: commissionTotal, rate: Number(v.commission_pct ?? 3), hasPayout: !!(v.paystack_subaccount_code || v.transfer_recipient_code) };
      cache = { at: Date.now(), data: data };
      writeStored(data);
      return data;
    })().catch(function () { return null; }).finally(function () { loading = null; });
    return loading;
  }

  var LABEL = { pending: "Pending", ready: "Ready to withdraw", asked: "Awaiting approval", held: "On hold (dispute)", onway: "On its way", paid: "Paid out" };
  function card(d, compact) {
    // the one Levromart wallet takes this place once the server has it (the older card stays until then)
    if (window.lvWalletCardHtml) { var h3 = window.lvWalletCardHtml("shop", d); if (h3) return h3; }
    var eye = hidden();
    var balance = d ? d.pending + d.onWay + (d.ready || 0) + (d.held || 0) + (d.asked || 0) : 0;
    var last = d && d.tx && d.tx[0];
    var notes = "";
    if (d && d.held > 0) notes += '<div class="lvw-note"><i class="fa-solid fa-scale-balanced"></i> <b>' + money(d.held) + '</b> on hold' + (d.heldReason ? ' · ' + esc(d.heldReason) : ' · dispute') + '</div>';
    if (d && d.asked > 0) notes += '<div class="lvw-note"><i class="fa-solid fa-hourglass-half"></i> <b>' + money(d.asked) + '</b> waiting for Levromart to approve</div>';
    if (d && d.delayed > 0) notes += '<div class="lvw-note"><i class="fa-solid fa-calendar-day"></i> <span><b>' + money(d.delayed) + '</b> arrives in your bank next business day.</span></div>';
    var ICO = { paid: "fa-arrow-down-long", onway: "fa-paper-plane", ready: "fa-wallet", asked: "fa-user-clock", held: "fa-scale-balanced", pending: "fa-hourglass-half" };
    return '<div class="lvw-card lvw2' + (compact ? " is-compact" : "") + '">' +
      '<div class="lvw-top"><span class="lvw-label"><i class="fa-solid fa-wallet"></i> Wallet</span>' +
      '<button type="button" class="lvw-help" onclick="lvWalletHow()" aria-label="How your wallet works and wallet colour"><i class="fa-solid fa-circle-question"></i></button>' +
      '<span class="lvw-top-sp"></span>' +
      '<button type="button" class="lvw-eye" onclick="lvWalletToggle()" aria-label="' + (eye ? "Show amounts" : "Hide amounts") + '"><i class="fa-regular ' + (eye ? "fa-eye-slash" : "fa-eye") + '"></i></button></div>' +
      '<div class="lvw-bal-label">Not yet in your bank</div>' +
      '<div class="lvw-bal">' + (d ? money(balance) : '<span class="lvw-skel"></span>') + '</div>' +
      '<div class="lvw-mini">' +
        '<span><i class="lvw-dot pending"></i>Pending <b>' + (d ? money(d.pending) : "—") + '</b></span>' +
        '<span><i class="lvw-dot ready"></i>Ready <b>' + (d ? money(d.ready) : "—") + '</b></span>' +
        '<span><i class="lvw-dot onway"></i>On its way <b>' + (d ? money(d.onWay) : "—") + '</b></span>' +
      '</div>' + notes +
      '<div class="lvw-foot"><div class="lvw-foot-l"><small>Paid out so far</small><b>' + (d ? money(d.paidOut) : "—") + '</b></div>' +
      '<button type="button" class="lvw-btn lvw-btn-withdraw" onclick="lvWalletWithdraw()"><i class="fa-solid fa-building-columns"></i> Withdraw</button></div>' +
      // one slim strip, like Opay: "Transaction history", the latest one in short, and an arrow
      '<button type="button" class="lvw-strip" onclick="lvWalletOpen(\'tx\')"><i class="fa-solid fa-clock-rotate-left lvw-strip-ic"></i><span class="lvw-strip-t">Transaction history</span>' +
        (last ? '<span class="lvw-strip-last"><span class="lvw-strip-nm">' + esc(last.title) + '</span><b>' + money(last.amount) + '</b></span>' : "") +
        '<i class="fa-solid fa-chevron-right lvw-strip-go"></i></button>' +
      (d && !d.hasPayout ? '<button type="button" class="lvw-warn" onclick="lvGoToPayout()"><i class="fa-solid fa-triangle-exclamation"></i> Add your bank account so we can pay you <i class="fa-solid fa-chevron-right"></i></button>' : "") +
    '</div>';
  }
  window.lvWalletRepaint = function () { paint(); };
  window.lvWalletReload = function () { return load(true).then(paint); };
  function paint() {
    if (!cache) readStored();
    var d = cache && cache.data;
    document.querySelectorAll("[data-lv-wallet]").forEach(function (el) {
      var html = card(d, el.getAttribute("data-lv-wallet") === "compact");
      if (el.__lvwHtml !== html) { el.innerHTML = html; el.__lvwHtml = html; }   // only touch the page when something really changed: no blinking
    });
    var pg = document.getElementById("lvwPageBody");
    if (pg) { var ph = pageBody(); if (pg.__lvwHtml !== ph) { pg.innerHTML = ph; pg.__lvwHtml = ph; } }
  }
  async function refresh(force) {
    if (typeof vendor === "undefined" || !vendor) return;
    paint();
    startLive();
    await load(force);
    paint();
  }

  // ---- live: the wallet follows the database as it changes (a payment lands, an order completes, a payout is sent)
  var liveFor = null, liveChannel = null, liveTimer = 0, lastLive = 0;
  function liveRefresh() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () {
      if (!document.querySelector("[data-lv-wallet]")) return;
      lastLive = Date.now();
      load(true).then(function () { paint(); flash(); });
    }, 500);
  }
  function flash() { document.querySelectorAll(".lvw-bal").forEach(function (e) { e.classList.remove("lvw-flash"); void e.offsetWidth; e.classList.add("lvw-flash"); }); }
  function startLive() {
    try {
      if (typeof vendor === "undefined" || !vendor || !vendor.id || typeof sb === "undefined" || !sb.channel) return;
      if (liveFor === vendor.id && liveChannel) return;
      if (liveChannel) { try { sb.removeChannel(liveChannel); } catch (_) {} }
      liveFor = vendor.id;
      var uid = session && session.user && session.user.id;
      var ch = sb.channel("wallet-" + vendor.id)
        .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: "vendor_id=eq." + vendor.id }, liveRefresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, liveRefresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "vendor_payouts", filter: "vendor_id=eq." + vendor.id }, liveRefresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "withdrawal_requests", filter: "vendor_id=eq." + vendor.id }, liveRefresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "commission_charges", filter: "vendor_id=eq." + vendor.id }, liveRefresh);
      if (uid) ch = ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + uid }, liveRefresh);
      liveChannel = ch.subscribe();
    } catch (_) {}
  }
  // safety net: if a change is missed (a dropped connection, a table that does not broadcast), the wallet still catches up
  setInterval(function () { if (document.hidden) return; startLive(); if (document.querySelector("[data-lv-wallet]") && Date.now() - lastLive > 10000) liveRefresh(); }, 5000);   // also checks every few seconds, in case the live channel misses a change
  document.addEventListener("visibilitychange", function () { if (!document.hidden && document.querySelector("[data-lv-wallet]")) liveRefresh(); });
  window.addEventListener("online", liveRefresh);
  window.lvWalletToggle = function () { setHidden(!hidden()); paint(); };

  // ---- the wallet page: Transactions and Commission tabs
  function txList(d) {
    var chips = [["all", "All"], ["pending", "Pending"], ["ready", "Ready"], ["onway", "On its way"], ["paid", "Paid out"]];
    var rows = d.tx.filter(function (t) { return filter === "all" || t.state === filter; });
    return '<div class="lvw-chips">' + chips.map(function (c) { return '<button type="button" class="lvw-chip' + (filter === c[0] ? " on" : "") + '" onclick="lvWalletFilter(\'' + c[0] + '\')">' + c[1] + '</button>'; }).join("") + '</div>' +
      (rows.length ? '<ul class="lvw-list">' + rows.map(function (t) {
        return '<li onclick="navigate(\'orderDetail\',{orderId:\'' + esc(t.id) + '\'})"><span class="lvw-ico ' + t.state + '"><i class="fa-solid ' + (t.state === "paid" ? "fa-arrow-down-long" : t.state === "onway" ? "fa-paper-plane" : t.state === "ready" ? "fa-wallet" : t.state === "asked" ? "fa-user-clock" : t.state === "held" ? "fa-scale-balanced" : "fa-hourglass-half") + '"></i></span>' +
          '<div class="lvw-li"><strong>' + esc(t.title) + '</strong><small>#' + esc(String(t.id).slice(0, 8).toUpperCase()) + " · " + LABEL[t.state] + " · " + esc(when(t.date)) + '</small>' + ((t.comm || t.refunded) ? '<small>Sale ' + esc(money(t.gross)) + (t.comm ? ' − commission ' + esc(money(t.comm)) : "") + (t.refunded ? ' − refunded ' + esc(money(t.refunded)) : "") + '</small>' : "") + '</div>' +
          '<b class="lvw-amt ' + t.state + '">' + money(t.amount) + '</b></li>';
      }).join("") + '</ul>' : '<div class="lvw-empty"><i class="fa-regular fa-credit-card"></i><strong>Nothing here yet</strong><span>Payments made through Levromart appear here.</span></div>');
  }
  function commissionPane(d) {
    var rows = d.charges.slice(0, 60);
    return '<div class="lvw-comm"><div class="lvw-comm-top lvw-comm-two"><div><span>Commission rate</span><b>' + esc(String(d.rate)) + '%</b></div><div><span>Taken from</span><b>Each payout</b></div></div>' +
      '<h4 class="lvw-h4">Commission per order</h4>' +
      (rows.length ? '<ul class="lvw-list">' + rows.map(function (c) {
        return '<li' + (c.order_id ? ' onclick="navigate(\'orderDetail\',{orderId:\'' + esc(c.order_id) + '\'})"' : "") + '><span class="lvw-ico paid"><i class="fa-solid fa-percent"></i></span><div class="lvw-li"><strong>' + (c.order_id ? "Order #" + esc(String(c.order_id).slice(0, 8).toUpperCase()) : "Commission") + '</strong><small>' + esc(when(c.paid_at || c.created_at)) + '</small></div><b class="lvw-amt pending">' + money(c.amount) + '</b></li>';
      }).join("") + '</ul>' : '<div class="lvw-empty"><i class="fa-solid fa-percent"></i><strong>No commission yet</strong><span>Levromart takes ' + esc(String(d.rate)) + '% of each completed sale.</span></div>') + '</div>';
  }
  var W_LABEL = { requested: "Waiting for approval", approved: "Approved", rejected: "Not approved" };
  function withdrawalsPane(d) {
    var rows = d.requests || [];
    return rows.length ? '<ul class="lvw-list">' + rows.map(function (r) {
      var st = r.status === "approved" ? "paid" : r.status === "rejected" ? "held" : "asked";
      return '<li><span class="lvw-ico ' + st + '"><i class="fa-solid ' + (r.status === "approved" ? "fa-check" : r.status === "rejected" ? "fa-xmark" : "fa-user-clock") + '"></i></span><div class="lvw-li"><strong>' + (r.kind === "instant" ? "Sent to your bank" : "Withdrawal request") + '</strong><small>' + esc(W_LABEL[r.status] || r.status) + " · " + esc(when(r.created_at)) + '</small>' +
        (r.status === "rejected" && r.reject_reason ? '<small class="lvw-reject">Reason: ' + esc(r.reject_reason) + '</small>' : "") + '</div><b class="lvw-amt ' + st + '">' + money(Number(r.amount_kobo) / 100) + '</b></li>';
    }).join("") + '</ul>' : '<div class="lvw-empty"><i class="fa-solid fa-building-columns"></i><strong>No withdrawals yet</strong><span>Tap Withdraw on your wallet when money is ready.</span></div>';
  }
  function pageBody() {
    if (!cache) readStored();
    var d = cache && cache.data;
    if (!d) return '<p class="muted" style="text-align:center;padding:1.5rem 0">Loading…</p>';
    return '<div class="lvw-tabs"><button type="button" class="' + (tab === "tx" ? "on" : "") + '" onclick="lvWalletOpen(\'tx\')">Transactions</button><button type="button" class="' + (tab === "withdrawals" ? "on" : "") + '" onclick="lvWalletOpen(\'withdrawals\')">Withdrawals</button><button type="button" class="' + (tab === "commission" ? "on" : "") + '" onclick="lvWalletOpen(\'commission\')">Commission</button></div>' +
      (tab === "tx" ? txList(d) : tab === "withdrawals" ? withdrawalsPane(d) : commissionPane(d));
  }
  window.lvWalletFilter = function (f) { filter = f; paint(); };
  window.lvWalletOpen = function (t) { tab = t || "tx"; if (typeof currentView !== "undefined" && currentView === "vendorWallet") paint(); else { window.__lvWalletTab = tab; navigate("vendorWallet"); } };
  window.renderVendorWallet = async function () {
    if (typeof session === "undefined" || !session || typeof vendor === "undefined" || !vendor) return '<div class="empty-state">Access denied.</div>';
    if (window.__lvWalletTab) { tab = window.__lvWalletTab; window.__lvWalletTab = null; }
    setTimeout(function () { refresh(true); }, 30);
    return '<div class="lvw-page"><div class="lvw-page-head"><button type="button" class="lvw-back" onclick="navigate(\'vendorDashboard\')" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button><h2>Wallet</h2></div>' +
      '<div class="lvw" data-lv-wallet="page">' + card((cache || (readStored(), cache)) && cache.data, false) + '</div><div id="lvwPageBody">' + pageBody() + '</div></div>';
  };
  window.lvGoToPayout = function () {
    var go = function () {
      var sec = document.getElementById("payoutSection"); if (!sec) return false;
      var wrap = document.getElementById("bankFormWrap"); if (wrap) wrap.classList.remove("hidden");
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(function () { var i = document.getElementById("veAccountNumber"); if (i) { try { i.focus({ preventScroll: true }); } catch (_) {} } }, 500);
      return true;
    };
    if (typeof currentView !== "undefined" && currentView === "vendorEditProfile" && go()) return;
    Promise.resolve(navigate("vendorEditProfile")).then(function () { var n = 0; var t = setInterval(function () { if (go() || ++n > 30) clearInterval(t); }, 150); });
  };

  function openSheet(title, bodyHtml) {
    var old = document.getElementById("lvwSheet"); if (old) old.remove();
    var m = document.createElement("div");
    m.id = "lvwSheet"; m.className = "lvw-sheet-wrap";
    m.innerHTML = '<div class="lvw-sheet" role="dialog" aria-modal="true"><div class="lvw-sheet-grab" aria-hidden="true"></div><div class="lvw-sheet-head"><h3>' + esc(title) + '</h3><button type="button" class="lvw-eye lvw-eye-dark" onclick="document.getElementById(\'lvwSheet\').remove()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><div class="lvw-sheet-body">' + bodyHtml + '</div></div>';
    m.addEventListener("click", function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
  }
  var NOW = function (n) { return "₦" + Number(n / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 }); };
  window.lvWalletWithdraw = async function () {
    openSheet("Withdraw", '<p class="muted" style="text-align:center">Checking your wallet…</p>');
    var body = document.querySelector("#lvwSheet .lvw-sheet-body");
    var r = await sb.rpc("get_withdrawal_summary");
    if (!body) return;
    if (r.error || !r.data) { body.innerHTML = '<p class="lvw-sheet-msg">' + esc((r.error && r.error.message) || "Withdrawals are not available right now. Please try again shortly.") + "</p>"; return; }
    var s = r.data, inst = Number(s.instant_kobo), appr = Number(s.approval_kobo), held = Number(s.held_kobo), min = Number(s.min_kobo);
    var canInst = inst >= min, small = !canInst && inst > 0;
    var askAmt = appr + (canInst ? 0 : inst), canAsk = !s.open_request && askAmt > 0;
    if (!canInst) { appr = askAmt; inst = 0; }
    var h = '<div class="lvw-wd">';
    if (s.blocked) h += '<p class="lvw-sheet-msg lvw-sheet-warn"><i class="fa-solid fa-shield-halved"></i> ' + esc(s.blocked) + "</p>";
    h += '<div class="lvw-wd-row"><span>Sent to your bank right now</span><b>' + NOW(inst) + '</b></div><small>Money paid 24 hours ago or more.</small>' +
      '<div class="lvw-wd-row"><span>Needs Levromart\'s approval</span><b>' + NOW(appr) + '</b></div><small>Paid less than 24 hours ago. We check and reply, you will get a message.</small>';
    if (held > 0) h += '<div class="lvw-wd-row lvw-wd-held"><span>On hold (disputed order)</span><b>' + NOW(held) + '</b></div><small>This stays held until the dispute is settled. The rest of your money is not affected.</small>';
    if (s.open_request) h += '<p class="lvw-sheet-msg"><i class="fa-solid fa-user-clock"></i> You already have a request of ' + NOW(Number(s.open_request.amount_kobo)) + ' waiting for approval.</p>';
    if (s.recent_bank_change != null && !s.blocked) h += '<p class="lvw-sheet-msg lvw-sheet-warn"><i class="fa-solid fa-shield-halved"></i> You changed your bank account recently, so Levromart checks every withdrawal first. It can still be approved.</p>';
    else if (small || (!canInst && appr > 0 && appr < min)) h += '<p class="lvw-sheet-msg">Amounts under ' + NOW(min) + ' are checked by Levromart before they are sent.</p>';
    if (!canInst && !canAsk && !s.blocked && !s.open_request) h += '<p class="lvw-sheet-msg">There is no money ready to withdraw yet.</p>';
    var total = (canInst ? inst : 0) + (canAsk ? appr : 0);
    h += '<button type="button" class="btn lvw-wd-go" id="lvwWdGo"' + (s.blocked || total <= 0 ? " disabled" : "") + '>' + (total > 0 ? "Withdraw " + NOW(total) : "Nothing to withdraw") + "</button></div>";
    body.innerHTML = h;
    var go = document.getElementById("lvwWdGo"); if (!go || go.disabled) return;
    go.onclick = async function () {
      if (s.has_dispute) {
        var ok = await showConfirmDialog("One of your orders has a dispute. The money for that order stays on hold until the dispute is settled. You can still withdraw the rest, and Levromart will see the dispute when it checks your request.", { title: "Disputed order", okLabel: "Continue" });
        if (!ok) return;
      }
      go.disabled = true; go.textContent = "Please wait…";
      var q = await sb.rpc("request_withdrawal");
      if (q.error) { go.disabled = false; go.textContent = "Try again"; return showToast(q.error.message || "Could not withdraw.", "error"); }
      var d = q.data || {};
      var el = document.getElementById("lvwSheet"); if (el) el.remove();
      showToast(Number(d.sent_kobo) > 0 && Number(d.requested_kobo) > 0 ? NOW(Number(d.sent_kobo)) + " is on its way; " + NOW(Number(d.requested_kobo)) + " is waiting for approval." : Number(d.sent_kobo) > 0 ? NOW(Number(d.sent_kobo)) + " is on its way to your bank." : "Request sent. We will message you when it is approved.", "success");
      load(true).then(paint);
    };
  };
  window.lvWalletHow = function () {
    openSheet("How your wallet works",
      '<ul class="lvw-how"><li><b>Pending.</b> The buyer has paid through Levromart. We hold the money until they confirm they received the order, or 48 hours pass with no problem raised.</li>' +
      '<li><b>Ready.</b> The order is complete. Tap <b>Withdraw</b> to send it to your bank. Money paid 24 hours ago or more goes straight away, whatever the amount (from \u20a6100); newer money is checked by Levromart first. An order with a dispute is held until it is settled.</li>' +
      '<li><b>On its way.</b> Your money is being sent to your bank. Transfers usually arrive within minutes. Money from a very recent card payment goes out automatically the next business day.</li>' +
      '<li><b>Paid out.</b> The money has been sent to your bank account.</li>' +
      '<li><b>Refunds.</b> If a buyer is refunded for an order, that amount comes off your wallet automatically. A refund is paid out of your share of the sale (what is left after Levromart\'s commission); the commission is not refunded.</li>' +
      '</ul>' + (typeof window.lvWalletColoursHtml === "function" ? window.lvWalletColoursHtml() : ""));
  };

  function wrapRenderers() {
    function wrapFn(name, build) {
      var f = window[name]; if (typeof f !== "function" || f.__lvw) return;
      var w = async function () { var html = await f.apply(this, arguments); var out = build(String(html == null ? "" : html), arguments); if (out !== null) setTimeout(function () { refresh(false); }, 30); return out === null ? html : out; };
      w.__lvw = true; w.__lvrw = f.__lvrw; window[name] = w;   // keep the refunds wallet's mark too
    }
    // the shop's own full profile: the wallet takes the place of the top banner
    wrapFn("renderVendorDashboard", function (html) {
      if (typeof vendor === "undefined" || !vendor || html.indexOf("vendor-profile-header-card") < 0) return null;
      // the wallet sits under the profile (not above it)
      var wallet = '<div class="lvw" data-lv-wallet="full">' + card((cache || (readStored(), cache)) && cache.data, false) + "</div>";
      var cut = html.indexOf('<hr class="vendor-profile-divider"');
      return cut > 0 ? html.slice(0, cut) + wallet + html.slice(cut) : wallet + html;
    });
    // orders from customers: a slimmer wallet on top (not on "My purchases")
    wrapFn("renderVendorOrders", function (html, args) {
      if (typeof vendor === "undefined" || !vendor || (args[5] === "purchases") || html.indexOf("empty-state") === 0 && html.length < 200) return null;
      return '<div class="lvw" data-lv-wallet="compact">' + card((cache || (readStored(), cache)) && cache.data, true) + "</div>" + html;
    });
  }
  wrapRenderers(); setTimeout(wrapRenderers, 1200); setTimeout(wrapRenderers, 4000);
})();

/* ===== Suggestions: the red number on the profile panel is refreshed whenever the panel opens ===== */
(function () {
  "use strict";
  var busy = false;
  async function refresh() {
    if (busy || typeof session === "undefined" || !session) return;
    var isAdmin = typeof profile !== "undefined" && profile && profile.role === "admin";
    if (!isAdmin && !(typeof vendor !== "undefined" && vendor)) return;
    busy = true;
    try {
      var r = await sb.rpc(isAdmin ? "get_platform_suggestions" : "get_vendor_suggestions");
      if (r && !r.error && Array.isArray(r.data)) {
        var n = r.data.filter(function (x) { return String(x.status || "").toLowerCase() === "new"; }).length;
        if (n !== Number(unreadSuggestionCount || 0)) { unreadSuggestionCount = n; if (typeof updateAuthUI === "function") updateAuthUI(); }
      }
    } catch (_) {} finally { busy = false; }
  }
  window.lvRefreshSuggestionBadge = refresh;
  function wrap() {
    var t = window.toggleProfilePanel;
    if (typeof t !== "function" || t.__lvSg) return;
    var w = function () { var out = t.apply(this, arguments); setTimeout(refresh, 50); return out; };
    w.__lvSg = true; window.toggleProfilePanel = w;
  }
  wrap(); setTimeout(wrap, 1500);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  setTimeout(refresh, 4000);
})();


/* ===== Home is ready before you tap it: a quiet copy is prepared while the app is idle, so the tab opens at once ===== */
(function () {
  "use strict";
  var busy = false;
  function warm() {
    if (busy || document.hidden) return;
    try {
      if (typeof renderHome !== "function" || typeof routeHtmlCache === "undefined") return;
      var key = routeCacheKey("home", {});
      if (routeHtmlCache.has(key) && Date.now() - (window.__lvHomeWarmAt || 0) < 300000) return;
      if (typeof currentView !== "undefined" && currentView === "home") return;   // the page on screen already fills it
      if (typeof currentHomeCategoryId !== "undefined" && (currentHomeCategoryId || (typeof currentSectorId !== "undefined" && currentSectorId))) return;
      busy = true;
      Promise.resolve(renderHome()).then(function (html) {
        var str = String(html || "");
        if (str && isUsableRouteSnapshot(str)) { routeHtmlCache.set(key, str); persistRouteHtml("home", {}, str); window.__lvHomeWarmAt = Date.now(); }
      }).catch(function () {}).finally(function () { busy = false; });
    } catch (_) { busy = false; }
  }
  function schedule() { var run = function () { warm(); }; if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 2500); }
  setTimeout(schedule, 5000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) setTimeout(schedule, 800); });
  setInterval(function () { if (!document.hidden) schedule(); }, 240000);
  setTimeout(function () { try { window.lvPaystackOn && window.lvPaystackOn(); } catch (_) {} }, 2500);
})();


/* ===== Pop-ups (confirm and "write a message"): clean card, an icon, quick answers, a clear "go back" ===== */
(function () {
  "use strict";
  function dress(modalId, opts, prompt) {
    var m = document.getElementById(modalId), c = m && m.querySelector(".modal-content"); if (!c) return;
    c.classList.add("lv-dlg");
    var old = c.querySelector(".lv-dlg-ico"); if (old) old.remove();
    var ico = document.createElement("div");
    ico.className = "lv-dlg-ico" + (opts.danger ? " danger" : "") + (opts.tone === "purple" ? " purple" : "");
    c.classList.toggle("lv-dlg-purple", opts.tone === "purple");
    ico.innerHTML = '<i class="fa-solid ' + (opts.icon || (opts.danger ? "fa-triangle-exclamation" : "fa-circle-question")) + '"></i>';
    c.insertBefore(ico, c.firstChild);
    var cancel = document.getElementById(prompt ? "textPromptModalCancel" : "confirmModalCancel");
    if (cancel) cancel.textContent = opts.cancelLabel || (opts.danger ? "Go back" : "Cancel");
    if (prompt) {
      var chips = c.querySelector(".lv-dlg-chips"); if (chips) chips.remove();
      if (opts.chips && opts.chips.length) {
        chips = document.createElement("div"); chips.className = "lv-dlg-chips";
        var input = document.getElementById("textPromptModalInput");
        opts.chips.forEach(function (t) {
          var b = document.createElement("button"); b.type = "button"; b.textContent = t;
          b.onclick = function () { input.value = t; input.focus(); };
          chips.appendChild(b);
        });
        c.insertBefore(chips, input);
      }
    }
  }
  function wrap(name, modalId, prompt) {
    var f = window[name]; if (typeof f !== "function" || f.__lvDlg) return;
    var w = function () {
      var opts = (prompt ? arguments[2] : arguments[1]) || {};
      var p = f.apply(this, arguments);
      try { dress(modalId, opts, prompt); } catch (_) {}
      return p;
    };
    w.__lvDlg = true; window[name] = w;
  }
  wrap("showConfirmDialog", "confirmModal", false);
  wrap("showTextPromptDialog", "textPromptModal", true);
})();


/* ===== A shop cannot cancel an order the buyer has paid for: it asks Levromart (an admin decides, the buyer is refunded) ===== */
window.lvAskCancel = async function (orderId) {
  var ok = await showConfirmDialog("The buyer has already paid, so you cannot cancel this order yourself. Send a request to Levromart. If it is approved, the order is cancelled and the buyer is refunded.", { title: "Ask Levromart to cancel?", okLabel: "Write the reason", cancelLabel: "Go back", danger: true });
  if (!ok) return;
  var reason = await showTextPromptDialog("Why do you need to cancel?", "Levromart reads this before deciding.", { placeholder: "Write a short reason…", okLabel: "Send request", chips: ["Out of stock", "Cannot deliver to this area", "Price was wrong"], icon: "fa-paper-plane", danger: true });
  if (reason === null) return;
  var r = await sb.rpc("request_order_cancellation", { p_order_id: orderId, p_reason: reason });
  if (r.error) return showToast(r.error.message || "Could not send the request.", "error");
  showToast("Request sent. Levromart will review it.", "success");
};

/* ===== Refunds wallet for buyers: refunds land here (not on the card) and are withdrawn to a bank account ===== */
(function () {
  "use strict";
  var cache = null, loading = null, popupDone = false, failed = false, activating = false;
  var DISMISS = "lv-rw-dismissed";
  function signedIn() { return typeof session !== "undefined" && session && typeof profile !== "undefined" && profile && profile.role !== "admin"; }
  // An account that was checked but could not be saved on the server yet (the refunds wallet is still being switched on) is kept
  // safely on the person's own login and sent again automatically as soon as the server can take it.
  function pendingAcct() { try { return (session && session.user && session.user.user_metadata && session.user.user_metadata.lv_refund_pending) || null; } catch (_) { return null; } }
  async function setPending(v) {
    try {
      var r = await sb.auth.updateUser({ data: { lv_refund_pending: v } });
      if (r && r.error) return false;
      try { session.user.user_metadata = Object.assign({}, session.user.user_metadata || {}, { lv_refund_pending: v }); } catch (_) {}
      return true;
    } catch (_) { return false; }
  }
  async function activatePending() {
    var pa = pendingAcct(); if (!pa || activating) return; activating = true;
    try {
      var r = await sb.rpc("save_refund_account", { p_bank_code: pa.c, p_account_number: pa.n, p_confirmed_name: pa.name });
      if (!r.error) { await setPending(null); cache = null; refresh(true); }
    } catch (_) {} finally { activating = false; }
  }
  function money(kobo) { return "₦" + (Number(kobo || 0) / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 }); }
  function when(d) { try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " + new Date(d).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" }); } catch (_) { return ""; } }
  async function load(force) {
    if (!signedIn()) return null;
    if (!force && cache && Date.now() - cache.at < 30000) return cache.data;
    if (loading) return loading;
    loading = (async function () {
      var r = await sb.rpc("get_refund_wallet");
      if (r.error || !r.data) { failed = true; return cache ? cache.data : null; }   // not set up on the server yet: the card says so instead of waiting forever
      failed = false;
      cache = { at: Date.now(), data: r.data };
      if (!r.data.has_account && pendingAcct()) activatePending();
      return r.data;
    })().catch(function () { return null; }).finally(function () { loading = null; });
    return loading;
  }
  var rHide = false; try { rHide = localStorage.getItem("lv-rw-hide") === "1"; } catch (_) {}
  function mR(k) { return rHide ? "\u20a6 \u2022\u2022\u2022\u2022" : money(k); }
  window.lvRefundEye = function () { rHide = !rHide; try { localStorage.setItem("lv-rw-hide", rHide ? "1" : "0"); } catch (_) {} paint(); };
  function card(d) {
    if (window.lvWalletCardHtml) { var h3 = window.lvWalletCardHtml("me", null); if (h3) return h3; }
    var pa = pendingAcct(), has = d && d.has_account, bal = d ? Number(d.available_kobo) : 0, pend = d ? Number(d.processing_kobo) : 0;
    return '<div class="lvw-card lvw2 is-compact lvrw-card"><div class="lvw-top"><span class="lvw-label"><i class="fa-solid fa-rotate-left"></i> Refunds wallet</span><button type="button" class="lvw-help" onclick="lvRefundHow()" aria-label="How refunds work and wallet colour"><i class="fa-solid fa-circle-question"></i></button><span class="lvw-top-sp"></span><button type="button" class="lvw-eye" onclick="lvRefundEye()" aria-label="' + (rHide ? "Show amounts" : "Hide amounts") + '"><i class="fa-regular ' + (rHide ? "fa-eye-slash" : "fa-eye") + '"></i></button></div>' +
      '<div class="lvw-bal-label">' + (has ? "Available to withdraw" : pa ? "Refund account saved" : "Refunds you are owed land here") + '</div>' +
      '<div class="lvw-bal">' + (d || failed ? mR(bal) : '<span class="lvw-skel"></span>') + '</div>' +
      (pend ? '<div class="lvw-note"><i class="fa-solid fa-paper-plane"></i> <b>' + mR(pend) + '</b> on its way to your bank</div>' : "") +
      '<div class="lvw-foot"><div class="lvw-foot-l">' + (has ? '<small>Refund account</small><b>' + esc(d.account.bank_name) + " ···" + esc(d.account.last4) + ' <button type="button" class="lvw-inline" onclick="lvRefundAccount()">Change</button></b>' : '<small>Refund account</small><b>Not added yet</b>') + '</div>' +
      (has ? '<button type="button" class="lvw-btn lvw-btn-withdraw" onclick="lvRefundWithdraw()"><i class="fa-solid fa-building-columns"></i> Withdraw</button>' : '<button type="button" class="lvw-btn lvw-btn-withdraw" onclick="lvRefundAccount()"><i class="fa-solid ' + (pa ? "fa-pen" : "fa-plus") + '"></i> ' + (pa ? "Change bank" : "Add bank") + '</button>') + '</div>' +
      '<button type="button" class="lvw-strip" onclick="lvRefundHistory()"><i class="fa-solid fa-clock-rotate-left lvw-strip-ic"></i><span class="lvw-strip-t">Refund history</span><i class="fa-solid fa-chevron-right lvw-strip-go"></i></button>' +
    '</div>';
  }
  window.lvRefundRepaint = function () { paint(); };
  function paint() {
    document.querySelectorAll("[data-lv-rwallet]").forEach(function (el) { var h = card(cache && cache.data); if (el.__h !== h) { el.innerHTML = h; el.__h = h; } });
  }
  async function refresh(force) { paint(); await load(force); paint(); }
  function sheet(title, body) {
    var old = document.getElementById("lvrwSheet"); if (old) old.remove();
    var m = document.createElement("div");
    m.id = "lvrwSheet"; m.className = "lvw-sheet-wrap";
    m.innerHTML = '<div class="lvw-sheet" role="dialog" aria-modal="true"><div class="lvw-sheet-grab" aria-hidden="true"></div><div class="lvw-sheet-head"><h3>' + esc(title) + '</h3><button type="button" class="lvw-eye lvw-eye-dark" onclick="document.getElementById(\'lvrwSheet\').remove()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><div class="lvw-sheet-body">' + body + '</div></div>';
    m.addEventListener("click", function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    return m;
  }
  function say(el, msg, bad) { if (el) { el.textContent = msg; el.className = "lvw-sheet-msg" + (bad ? " lvw-sheet-warn" : ""); el.hidden = !msg; } }

  window.lvRefundHow = function () {
    sheet("Your refunds wallet",
      '<ul class="lvw-how"><li><b>Refunds land here.</b> If an order you paid for is cancelled, or a problem is settled in your favour, the money is put in this wallet.</li>' +
      '<li><b>Withdraw any time.</b> Tap <b>Withdraw</b> to send it to your refund bank account (from \u20a6100).</li>' +
      '<li><b>Where it comes from.</b> A refund is paid out of the shop\'s share of the sale. You get back what you paid for the order; Paystack\'s payment fee is not refunded.</li>' +
      '<li><b>Changed your bank account?</b> You can still withdraw. Levromart is told about the change and may check it.</li>' +
      '<li><b>No account yet?</b> Add one so refunds can reach you. It must be an account in your own name.</li></ul>' +
      (typeof window.lvWalletColoursHtml === "function" ? window.lvWalletColoursHtml() : ""));
  };
  window.lvRefundAccount = async function (fromPopup) {
    var m = sheet(fromPopup ? "Where should your money go?" : "Your bank account",
      '<p class="muted" style="margin:0 0 .8rem;font-size:.88rem;line-height:1.45">When you withdraw from your Levromart wallet (refunds, money sent to you, money you added), it goes to this account. It must be an account in your own name. For your safety, you can withdraw 24 hours after you add or change it, and the first withdrawal to it is checked by Levromart. Check the details carefully: Levromart is not responsible for money sent to an account that was entered wrongly.</p>' +
      '<label class="lvrw-l">Bank</label><button type="button" class="lvrw-bankbtn" id="lvrwBankBtn"><span class="ve-bank-ico" id="lvrwBankIco"><i class="fa-solid fa-building-columns"></i></span><span id="lvrwBankLabel" class="lvrw-bank-label">Choose your bank</span><i class="fa-solid fa-chevron-down"></i></button>' +
      '<label class="lvrw-l">Account number</label><input id="lvrwNum" class="lvrw-in" inputmode="numeric" maxlength="10" placeholder="10 digits" autocomplete="off">' +
      '<p id="lvrwMsg" class="lvw-sheet-msg" hidden></p><div id="lvrwName" class="lvrw-name" hidden></div>' +
      '<button type="button" class="btn lvw-wd-go" id="lvrwGo">Check account</button>' + (fromPopup ? '<button type="button" class="lvrw-later" onclick="lvRefundLater()">I\'ll do it later</button><p class="muted" style="margin:.5rem 0 0;font-size:.78rem;text-align:center">You can add it any time from your profile. Refunds can only reach you once it is added.</p>' : ""));
    if (fromPopup) {   // no close button or tap-outside: "I'll do it later" is the way out, so the choice is a clear one
      var x0 = m.querySelector(".lvw-eye"); if (x0) x0.remove();
      m.classList.add("lvrw-locked");
      m.addEventListener("click", function (e) { if (e.target === m) e.stopImmediatePropagation(); }, true);
    }
    var num = m.querySelector("#lvrwNum"), msg = m.querySelector("#lvrwMsg"), nameBox = m.querySelector("#lvrwName"), go = m.querySelector("#lvrwGo");
    var sel = { value: "" }, list = [];
    try { var bk = await window.levroData.payments.banks(); list = (bk && Array.isArray(bk.data) && bk.data) || []; } catch (_) {}
    if (!list.length && typeof NIGERIAN_BANKS !== "undefined") list = NIGERIAN_BANKS;   // the full list kept in the app, so the form always works
    list = list.slice().sort(function (x, y) { return String(x.name).localeCompare(String(y.name)); });
    var found = null;
    function reset() { found = null; nameBox.hidden = true; go.textContent = "Check account"; say(msg, ""); }
    function choose(code, name) {
      sel.value = code; reset();
      m.querySelector("#lvrwBankLabel").textContent = name;
      var ico = m.querySelector("#lvrwBankIco");
      ico.className = "ve-bank-ico"; ico.removeAttribute("data-lvlogo"); ico.innerHTML = '<i class="fa-solid fa-building-columns"></i>'; ico.setAttribute("data-bank-code", code);
    }
    // the same bank picker as the shop's payout page: search, and each bank's own logo
    m.querySelector("#lvrwBankBtn").onclick = function () {
      var pk = document.createElement("div");
      pk.id = "vendorBankPickerModal"; pk.className = "modal vendor-bank-picker-modal open"; pk.style.zIndex = "2147483500";   // same id as the shop's picker: the same look, light and dark
      pk.innerHTML = '<div class="modal-content vendor-bank-picker-content"><div class="vendor-bank-picker-head"><div><div class="vendor-bank-picker-title"><i class="fa-solid fa-building-columns"></i><span>Select your bank</span></div><div class="muted" style="font-size:.76rem;margin-top:.2rem;">' + list.length + ' supported banks and financial institutions</div></div><button type="button" class="drawer-close-btn" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><div class="vendor-bank-search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input class="vendor-bank-search" type="search" autocomplete="off" placeholder="Search bank..." aria-label="Search banks"></div><div class="vendor-bank-picker-list"></div></div>';
      document.body.appendChild(pk);
      var box = pk.querySelector(".vendor-bank-picker-list"), q = pk.querySelector(".vendor-bank-search");
      function paintList() {
        var t = q.value.trim().toLowerCase();
        var rows = list.filter(function (x) { return !t || String(x.name).toLowerCase().indexOf(t) >= 0; });
        box.innerHTML = rows.length ? rows.map(function (x) { return '<button type="button" class="vendor-bank-option' + (x.code === sel.value ? " selected" : "") + '" data-bank-code="' + esc(x.code) + '" data-bank-name="' + esc(x.name) + '"><span class="vendor-bank-option-icon"><i class="fa-solid fa-building-columns"></i></span><span class="vendor-bank-option-main"><strong>' + esc(x.name) + '</strong></span>' + (x.code === sel.value ? '<i class="fa-solid fa-circle-check vendor-bank-option-check"></i>' : '<i class="fa-solid fa-chevron-right vendor-bank-option-arrow"></i>') + '</button>'; }).join("") : '<div class="empty-state" style="padding:2rem 1rem;">No bank matches your search.</div>';
      }
      q.addEventListener("input", paintList);
      pk.addEventListener("click", function (e) {
        var o = e.target.closest && e.target.closest(".vendor-bank-option");
        if (o) { choose(o.getAttribute("data-bank-code"), o.getAttribute("data-bank-name")); pk.remove(); return; }
        if (e.target === pk || (e.target.closest && e.target.closest(".drawer-close-btn"))) pk.remove();
      });
      paintList(); setTimeout(function () { try { q.focus(); } catch (_) {} }, 60);
    };
    num.addEventListener("input", reset);
    function friendly(e) {
      var t = String((e && e.message) || "");
      if (/not found|does not exist|unknown|404|failed to fetch|network/i.test(t) || !t) return "Refund accounts are being switched on. Please try again in a little while.";
      return t;
    }
    go.onclick = async function () {
      say(msg, "");
      if (!sel.value) return say(msg, "Choose your bank.", true);
      if (!/^\d{10}$/.test(num.value.trim())) return say(msg, "Enter your 10-digit account number.", true);
      go.disabled = true;
      try {
        if (!found) {
          var r = await window.levroData.payments.resolveAccount(sel.value, num.value.trim());
          if (r.error || !r.data) return say(msg, (r.error && r.error.message) || "We could not find that account. Check the bank and number.", true);
          found = r.data;
          nameBox.hidden = false; nameBox.innerHTML = '<b>' + esc(found.accountName) + '</b><span>' + esc(found.bankName || "") + " · ···" + esc(found.accountLast4 || "") + '</span><small>Is this your account?</small>';
          go.textContent = "Yes, this is my account";
          return;
        }
        var s = await sb.rpc("save_refund_account", { p_bank_code: sel.value, p_account_number: num.value.trim(), p_confirmed_name: found.accountName });
        if (s.error) {
          // the name was confirmed with the bank, so keep the account safe on the person's login and finish saving it later
          var bname = (list.find(function (x) { return x.code === sel.value; }) || {}).name || found.bankName || "";
          var kept = await setPending({ c: sel.value, n: num.value.trim(), name: found.accountName, b: bname, l: num.value.trim().slice(-4), at: Date.now() });
          if (!kept) { found = null; return say(msg, friendly(s.error), true); }
          var el0 = document.getElementById("lvrwSheet"); if (el0) el0.remove();
          showToast("Account saved. Refunds will use it as soon as the refunds wallet is switched on.", "success");
          paint(); return;
        }
        await setPending(null);
        var el = document.getElementById("lvrwSheet"); if (el) el.remove();
        showToast("Refund account saved.", "success");
        await refresh(true);
      } catch (e) { say(msg, friendly(e), true); }
      finally { go.disabled = false; }
    };
  };
  window.lvRefundLater = function () { try { localStorage.setItem(DISMISS, String(Date.now())); } catch (_) {} var el = document.getElementById("lvrwSheet"); if (el) el.remove(); };

  window.lvRefundWithdraw = async function () {
    var d = await load(true);
    if (!d) return showToast("Your wallet is not available right now.", "error");
    if (d.blocked) return showToast(d.blocked, "info");
    var bal = Number(d.available_kobo);
    if (bal < Number(d.min_kobo)) return showToast(bal > 0 ? "The smallest withdrawal is " + money(d.min_kobo) + "." : "You have no refund money to withdraw yet.", "info");
    var ok = await showConfirmDialog("Send " + money(bal) + " to " + d.account.bank_name + " ···" + d.account.last4 + "?", { title: "Withdraw refund", okLabel: "Withdraw", cancelLabel: "Go back" });
    if (!ok) return;
    var r = await sb.rpc("withdraw_refunds");
    if (r.error) return showToast(r.error.message || "Could not withdraw.", "error");
    showToast(r.data && r.data.status === "sent" ? money(bal) + " was sent to your bank." : money(bal) + " is on its way to your bank.", "success");
    refresh(true);
  };
  window.lvRefundHistory = async function () {
    var m = sheet("Refund history", '<p class="muted" style="text-align:center">Loading…</p>');
    var d = await load(true), body = m.querySelector(".lvw-sheet-body");
    if (!d) { body.innerHTML = '<p class="lvw-sheet-msg">Your wallet is not available right now.</p>'; return; }
    var rows = [];
    (d.credits || []).forEach(function (c) { rows.push({ at: c.created_at, t: "Refund added", s: c.status === "available" ? "In your wallet" : c.status === "processing" ? "Being sent" : "Sent to your bank", amt: c.amount_kobo, plus: true, order: c.order_id }); });
    (d.withdrawals || []).forEach(function (w) { rows.push({ at: w.created_at, t: "Withdrawal", s: w.status === "success" ? "Sent" : w.status === "processing" ? "On its way" : "Not sent, money returned to wallet", amt: w.amount_kobo, plus: false }); });
    rows.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
    body.innerHTML = rows.length ? '<ul class="lvw-list">' + rows.map(function (r) { return '<li' + (r.order ? ' onclick="document.getElementById(\'lvrwSheet\').remove();navigate(\'orderDetail\',{orderId:\'' + esc(r.order) + '\'})"' : "") + '><span class="lvw-ico ' + (r.plus ? "ready" : "onway") + '"><i class="fa-solid ' + (r.plus ? "fa-rotate-left" : "fa-paper-plane") + '"></i></span><div class="lvw-li"><strong>' + esc(r.t) + '</strong><small>' + esc(r.s) + " · " + esc(when(r.at)) + '</small></div><b class="lvw-amt ' + (r.plus ? "ready" : "onway") + '">' + (r.plus ? "+" : "−") + money(r.amt) + '</b></li>'; }).join("") + "</ul>" : '<div class="lvw-empty"><i class="fa-solid fa-rotate-left"></i><strong>No refunds yet</strong><span>If an order is cancelled after you paid, the money appears here.</span></div>';
  };

  // the wallet sits on top of the buyer's profile and their orders
  function wrapFn(name) {
    var f = window[name]; if (typeof f !== "function" || f.__lvrw) return;
    var w = async function () {
      var html = await f.apply(this, arguments);
      var str = String(html == null ? "" : html);
      if (!signedIn() || str.length < 200 || str.indexOf("data-lv-rwallet") >= 0 || (name === "renderVendorOrders" && arguments[5] !== "purchases")) return html;   // one wallet only: the page may already carry it
      setTimeout(function () { refresh(false); }, 30);
      var rw = '<div class="lvw lvrw" data-lv-rwallet>' + card(cache && cache.data) + "</div>";
      var end = name === "renderBuyerProfile" ? str.indexOf("</section>") : -1;   // on the profile: under the profile header
      return end > 0 ? str.slice(0, end + 10) + rw + str.slice(end + 10) : rw + str;
    };
    w.__lvrw = true; w.__lvw = f.__lvw; window[name] = w;   // keep the other wallet's mark so it is never wrapped again on top of this one
  }
  function wrapEdit() {
    var f = window.renderEditProfile; if (typeof f !== "function" || f.__lvrw) return;
    var w = function () {
      var out = f.apply(this, arguments);
      var add = function (html) { return String(html) + '<div class="lvrw-edit"><div><strong>Refund account</strong><small>Where refunds are sent when an order is cancelled or a problem is settled in your favour.</small></div><button type="button" class="btn btn-outline" onclick="lvRefundAccount()">Add or change</button></div>'; };
      return out && typeof out.then === "function" ? out.then(add) : add(out);
    };
    w.__lvrw = true; window.renderEditProfile = w;
  }
  function wrapAll() { wrapFn("renderBuyerProfile"); wrapFn("renderCustomerOrders"); wrapFn("renderVendorOrders"); wrapEdit(); }
  wrapAll(); setTimeout(wrapAll, 1200); setTimeout(wrapAll, 4000);

  // every customer is asked for a refund account until one is saved; "I'll do it later" puts the question off for 3 days
  var LATER_MS = 3 * 24 * 60 * 60 * 1000;
  function putOff() { try { return Date.now() - Number(localStorage.getItem(DISMISS) || 0) < LATER_MS; } catch (_) { return false; } }
  async function ask() {
    if (document.hidden || !signedIn()) return;
    if (pendingAcct() || putOff()) return;
    if (document.querySelector(".modal.open, #lvrwSheet, #lvCampus, #levromartSplash:not(.is-hidden), .onboarding-overlay, .lvw-sheet-wrap")) return;
    var d = await load(false);
    if (!d || d.has_account || pendingAcct()) return;
    window.lvRefundAccount(true);   // it comes back (3 days after "I'll do it later") until a refund account is saved
  }
  setInterval(ask, 20000); setTimeout(ask, 8000);
})();

/* ===== Admin: a red number on "Payments" while withdrawals or cancel requests wait for a decision ===== */
(function () {
  "use strict";
  var busy = false;
  function paint(n) {
    window.__lvPayPending = n;
    document.querySelectorAll(".lv-pay-badge").forEach(function (b) {
      b.textContent = n > 9 ? "9+" : String(n);
      b.classList.toggle("hidden", !n);
    });
    try { if (typeof renderBottomNav === "function") renderBottomNav(); } catch (_) {}
  }
  window.lvPayPaint = function (n) { if (n !== (window.__lvPayPending || 0)) paint(n); };
  window.lvPayPendingRefresh = async function () {
    if (busy || typeof sb === "undefined" || typeof session === "undefined" || !session || !profile || profile.role !== "admin") return;
    busy = true;
    try {
      var r = await Promise.all([sb.rpc("admin_list_withdrawals", { p_status: "requested" }), sb.rpc("admin_list_cancellations", { p_status: "requested" })]);
      var n = 0;
      r.forEach(function (x) { n += ((x && x.data) || []).filter(function (y) { return y.status === "requested"; }).length; });
      if (n !== (window.__lvPayPending || 0)) paint(n);
    } catch (_) {} finally { busy = false; }
  };
  setInterval(function () { if (!document.hidden) window.lvPayPendingRefresh(); }, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) window.lvPayPendingRefresh(); });
  var w = window.renderBottomNav;
  if (typeof w === "function" && !w.__lvPay) {
    var inner = w;
    window.renderBottomNav = function () { var out = inner.apply(this, arguments); if (typeof profile !== "undefined" && profile && profile.role === "admin" && window.__lvPayPending == null) window.lvPayPendingRefresh(); return out; };
    window.renderBottomNav.__lvPay = true; Object.keys(inner).forEach(function (k) { window.renderBottomNav[k] = inner[k]; });
  }
})();

/* ===== Vendor application: the phone number already on the account is filled in ===== */
(function () {
  "use strict";
  function fill() {
    var el = document.getElementById("vaPhone");
    if (!el || el.value || el.dataset.lvFilled) return;
    var ph = (typeof profile !== "undefined" && profile && profile.phone) || (typeof vendor !== "undefined" && vendor && vendor.phone) || "";
    if (ph) { el.value = ph; el.dataset.lvFilled = "1"; }
  }
  var raf = 0;
  new MutationObserver(function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; fill(); }); }).observe(document.body, { childList: true, subtree: true });
})();

/* ===== A shop can change its own referral code (4 to 16 letters or numbers; capitals do not matter) ===== */
(function () {
  "use strict";
  function currentCode() {
    var el = document.querySelector(".lb-code-val");
    if (el && el.textContent.trim()) return el.textContent.trim();
    return (typeof vendor !== "undefined" && vendor && vendor.referral_code) || "";
  }
  window.lvShareReferral = function () {
    var old = document.getElementById("lvShareSheet"); if (old) old.remove();
    var code = currentCode(); if (!code) return;
    var link = (typeof referLink === "function") ? referLink(code) : (location.origin + "/?ref=" + encodeURIComponent(code));
    var m = document.createElement("div");
    m.id = "lvShareSheet"; m.className = "lvw-sheet-wrap";
    m.innerHTML = '<div class="lvw-sheet" role="dialog" aria-modal="true"><div class="lvw-sheet-grab" aria-hidden="true"></div><div class="lvw-sheet-head"><h3>Share your code</h3><button type="button" class="lvw-eye lvw-eye-dark" aria-label="Close" onclick="document.getElementById(\'lvShareSheet\').remove()"><i class="fa-solid fa-xmark"></i></button></div><div class="lvw-sheet-body lv-share-list">' +
      '<button type="button" data-a="copy"><i class="fa-regular fa-copy"></i> Copy link</button>' +
      '<button type="button" data-a="wa"><i class="fa-brands fa-whatsapp"></i> WhatsApp</button>' +
      '<button type="button" data-a="more"><i class="fa-solid fa-share-nodes"></i> More apps</button></div></div>';
    m.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-a]");
      if (!b) { if (e.target === m) m.remove(); return; }
      m.remove();
      try { if (b.dataset.a === "copy") lbCopy(link, "Referral link copied"); else if (b.dataset.a === "wa") lbShareCode(); else lbShareMore(); } catch (_) {}
    });
    document.body.appendChild(m);
  };
  window.lvChangeReferralCode = function () {
    var old = document.getElementById("lvRefSheet"); if (old) old.remove();
    var m = document.createElement("div");
    m.id = "lvRefSheet"; m.className = "lvw-sheet-wrap";
    m.innerHTML = '<div class="lvw-sheet" role="dialog" aria-modal="true"><div class="lvw-sheet-grab" aria-hidden="true"></div><div class="lvw-sheet-head"><h3>Your referral code</h3><button type="button" class="lvw-eye lvw-eye-dark" aria-label="Close" onclick="document.getElementById(\'lvRefSheet\').remove()"><i class="fa-solid fa-xmark"></i></button></div><div class="lvw-sheet-body">' +
      '<p class="muted" style="margin:0 0 .8rem;font-size:.88rem;line-height:1.45">Use your shop name or anything easy to say. 4 to 16 letters or numbers. Capital or small letters, it works the same.</p>' +
      '<input id="lvRefInput" class="lvrw-in" maxlength="24" autocapitalize="characters" autocomplete="off" placeholder="e.g. MYSHOP" value="' + String(currentCode()).replace(/"/g, "") + '">' +
      '<p id="lvRefMsg" class="lvw-sheet-msg" hidden></p><button type="button" class="btn lvw-wd-go" id="lvRefGo">Save code</button></div></div>';
    m.addEventListener("click", function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    var inp = m.querySelector("#lvRefInput"), msg = m.querySelector("#lvRefMsg"), go = m.querySelector("#lvRefGo");
    setTimeout(function () { try { inp.focus(); inp.select(); } catch (_) {} }, 80);
    go.onclick = async function () {
      if (go.disabled) return; go.disabled = true; go.textContent = "Saving…"; msg.hidden = true;
      var r = await sb.rpc("set_my_referral_code", { p_code: inp.value });
      var d = r && r.data;
      go.disabled = false; go.textContent = "Save code";
      if ((r && r.error) || !d || !d.ok) {
        msg.textContent = (d && d.message) || (r && r.error && /not.*(found|exist)|setting up|unavailable/i.test(r.error.message || "") ? "This is being set up. Try again later." : "Could not save the code. Try again.");
        msg.className = "lvw-sheet-msg lvw-sheet-warn"; msg.hidden = false; return;
      }
      try { if (typeof vendor !== "undefined" && vendor) vendor.referral_code = d.referral_code; } catch (_) {}
      m.remove();
      showToast("Your referral code is now " + d.referral_code + ".", "success");
      try { if (currentView === "leaderboard") navigate("leaderboard", currentViewParams || {}, false); } catch (_) {}
    };
  };
  function dress() {
    var v = document.querySelector(".lb-code:not([data-lv-chg])");
    if (v) {
      v.dataset.lvChg = "1";
      var val = v.querySelector(".lb-code-val");
      if (val && !v.querySelector(".lb-code-edit")) {
        var ed = document.createElement("button"); ed.type = "button"; ed.className = "lb-code-edit"; ed.setAttribute("aria-label", "Change my referral code"); ed.title = "Change code";
        ed.innerHTML = '<i class="fa-solid fa-pen"></i>'; ed.onclick = window.lvChangeReferralCode;
        val.parentNode.insertBefore(ed, val.nextSibling);
      }
      var acts = v.querySelector(".lb-code-actions");
      if (acts) { acts.innerHTML = '<button type="button" class="lb-share-one"><i class="fa-solid fa-share-nodes"></i> Share</button>'; acts.firstChild.onclick = window.lvShareReferral; }
    }
    var s = document.getElementById("settings-page");
    if (s && !s.querySelector("[data-lv-refrow]") && typeof vendor !== "undefined" && vendor && vendor.id) {
      var sec = document.createElement("section"); sec.className = "settings-page-section"; sec.dataset.lvRefrow = "1";
      sec.innerHTML = '<h3><i class="fa-solid fa-gift"></i> Referrals</h3><button class="settings-action-row" onclick="lvChangeReferralCode()"><i class="fa-solid fa-pen"></i><span><strong>Change my referral code</strong><small>Make it your shop name or anything easy to say</small></span></button>';
      var acct = [].find.call(s.querySelectorAll(".settings-page-section"), function (x) { return /Account/.test(x.querySelector("h3") ? x.querySelector("h3").textContent : ""); });
      if (acct) acct.parentNode.insertBefore(sec, acct); else s.appendChild(sec);
    }
  }
  var raf = 0;
  new MutationObserver(function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; dress(); }); }).observe(document.body, { childList: true, subtree: true });
})();

/* ===== Realistic 3D icons (Microsoft Fluent Emoji, MIT, in /icons3d) for categories, home headings and quick cards ===== */
(function () {
  "use strict";
  var RULES = [
    [/snack|popcorn|chips/, "1f37f"], [/bakery|bread|pastr|cake/, "1f35e"], [/beverage|drink|juice|water/, "1f9c3"], [/grocer/, "1f957"], [/food|restaurant|cater|kitchen|dining|shawarma/, "1f354"],
    [/shoe|footwear|sneaker/, "1f45f"], [/bag|handbag/, "1f45c"], [/watch/, "231a"], [/jewel|jewell|ring|accessor/, "1f48d"], [/fashion|cloth|tailor|fabric|wear|thrift|design/, "1f457"],
    [/skin|perfume|fragrance|scent|cosmetic/, "1f9f4"], [/salon|barb|braid/, "1f488"], [/beauty|hair|personal|wellness|care/, "1f484"],
    [/computer|laptop|software|web|digital/, "1f4bb"], [/phone|electronic|gadget|tech|tv|audio|telecom|game|gaming/, "1f4f1"],
    [/home|furniture|decor|interior|living|property|real estate|appliance/, "1f3e0"], [/health|pharmac|medical|health/, "1f48a"],
    [/book|station|educat|office|print/, "1f4da"], [/gift/, "1f381"], [/baby|kid|toy/, "1f9f8"], [/sport|fitness|gym/, "1f3cb-fe0f"], [/pet/, "1f43e"],
    [/auto|car|transport|logistic|travel|vehicle/, "1f697"], [/photo|video|media|camera/, "1f4f7"], [/art|craft|handmade|graphic|brand/, "1f3a8"],
    [/music|event|entertain/, "1f3b6"], [/clean|laundry/, "1f9f9"], [/repair|tool|construct|electrical|industr|hardware|solar|energy|manufactur|safety/, "1f6e0-fe0f"],
    [/agri|farm/, "1f33e"], [/financ|wholesale|retail|market/, "1f4b0"], [/service/, "2728"]
  ];
  function code(name) {
    var n = String(name || "").toLowerCase();
    for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(n)) return RULES[i][1];
    return "1f6cd-fe0f";
  }
  window.lv3d = function (c, cls) { return '<img class="lv3d ' + (cls || "") + '" src="/icons3d/' + c + '.webp" alt="" aria-hidden="true" decoding="async">'; };
  window.levroSectorArt = function (sector) { return "/icons3d/" + code(sector && (sector.name || sector.id)) + ".webp"; };
  window.lvCat3d = function (name, all) { return lv3d(all ? "1f6d2" : code(name), "lv3d-chip"); };   // a category's 3D icon (the cart for "All")
  var FA = { "fa-fire": "1f525", "fa-gem": "1f48e", "fa-hand-holding-heart": "1f6ce-fe0f", "fa-box-open": "1f4e6", "fa-table-cells-large": "1f6cd-fe0f", 
    "fa-bag-shopping": "1f6cd-fe0f", "fa-screwdriver-wrench": "1f6e0-fe0f", "fa-key": "1f511", "fa-store": "1f3ea", "fa-hand": "1f4dd", "fa-comment-dots": "1f4ac", "fa-graduation-cap": "1f393" };
  var SEL = "#app .section-title > i.fa-solid, #app .section-title > span > i.fa-solid, #lvCampusBar .lvcb-trophy > i.fa-solid, #lvCampusBar .ico > i.fa-solid";
  function dress() {
    document.querySelectorAll(SEL).forEach(function (i) {
      if (i.dataset.lv3) return;
      var c = null; for (var k in FA) if (i.classList.contains(k)) { c = FA[k]; break; }
      if (!c) return;
      i.dataset.lv3 = "1";
      var img = document.createElement("img"); img.className = "lv3d lv3d-ico"; img.src = "/icons3d/" + c + ".webp"; img.alt = ""; img.setAttribute("aria-hidden", "true");
      i.replaceWith(img);
    });
    // the "All campuses" badge
    var ico = document.querySelector("#lvCampusBar .lvcb-main .ico:not([data-lv3])");
    if (ico && !ico.querySelector("img")) { ico.dataset.lv3 = "1"; ico.innerHTML = '<img class="lv3d lv3d-ico" src="/icons3d/1f393.webp" alt="" aria-hidden="true">'; }
    // "All" chips
    document.querySelectorAll("#app .vd-chip-all img, #app .levro-home-cat-all img").forEach(function (im) { if (!im.dataset.lv3) { im.dataset.lv3 = "1"; im.src = "/icons3d/1f6d2.webp"; } });
    dressBrowse(); dressVendors();
  }
  // Browse everything: no search box or filter button any more; a rail of small round category pills sits on top instead
  function dressBrowse() {
    var grid = document.getElementById("productGrid"), sel = document.getElementById("filterCategory");
    if (!grid || !sel) return;
    var rail = document.getElementById("lvBrowsePills");
    var opts = [].filter.call(sel.options, function (o) { return o.value; });
    if (!opts.length) { if (rail) rail.remove(); return; }
    var key = opts.map(function (o) { return o.value; }).join(",") + "|" + sel.value;
    if (rail && rail.dataset.k === key) return;
    if (!rail) { rail = document.createElement("div"); rail.id = "lvBrowsePills"; rail.className = "lv-pills"; rail.setAttribute("role", "group"); rail.setAttribute("aria-label", "Categories"); grid.parentNode.insertBefore(rail, grid); }
    rail.dataset.k = key;
    rail.innerHTML = '<button type="button" class="lv-pill' + (sel.value ? "" : " on") + '" data-v="">' + lv3d("1f6d2") + '<span>All</span></button>' + opts.map(function (o) {
      return '<button type="button" class="lv-pill' + (sel.value === o.value ? " on" : "") + '" data-v="' + o.value + '">' + lv3d(code(o.textContent)) + "<span>" + o.textContent.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</span></button>";
    }).join("");
    rail.onclick = function (e) { var b = e.target.closest("button.lv-pill"); if (!b) return; try { chooseBrowseCategory(b.dataset.v, b.textContent.trim()); } catch (_) {} };
  }
  // Vendors page: no search box or filter button; the grid / list / map switch sits beside the tabs
  function dressVendors() {
    var tabs = document.getElementById("vendorsListingTabs"), views = document.querySelector("#app .vd-page .vd-views");
    if (!tabs || !views || tabs.parentNode.classList.contains("vd-toprow")) return;
    var t0 = tabs.querySelector("button[data-filter='all'], .vd-tab"); if (t0 && /^all vendors$/i.test(t0.textContent.trim())) t0.textContent = "All";
    var row = document.createElement("div"); row.className = "vd-toprow";
    tabs.parentNode.insertBefore(row, tabs); row.appendChild(tabs); row.appendChild(views);
  }
  var raf = 0;
  new MutationObserver(function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; dress(); }); }).observe(document.body, { childList: true, subtree: true });
  dress();
})();

/* ===== Profile photo: load the current picture through the proxy when the direct read is blocked, and a modern
   pinch / drag / scroll circular cropper (replaces the old slider dialog). Later definitions win. ===== */
(function () {
  function lvLoadImageBlob(url) {
    var direct = function () { return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("x"); return r.blob(); }); };
    var proxied = function () { return fetch("/api/delete-account?imgproxy=" + encodeURIComponent(url)).then(function (r) { if (!r.ok) throw new Error("x"); return r.blob(); }); };
    return direct().catch(proxied);
  }
  window.lvLoadImageBlob = lvLoadImageBlob;

  window.editCurrentAvatar = async function () {
    try { closeMediaActionSheet(); } catch (_) {}
    if (!profile || !profile.avatar_url) return;
    try {
      var blob = await lvLoadImageBlob(profile.avatar_url);
      pendingAvatarFile = new File([blob], "current-avatar.jpg", { type: blob.type || "image/jpeg" });
      openAvatarCropModal(pendingAvatarFile);
    } catch (e) {
      showToast("Couldn't open your current photo. Tap Replace to choose a new one.", "error");
    }
  };
  window.editCurrentVendorCover = async function () {
    try { closeMediaActionSheet(); } catch (_) {}
    if (!vendor || !vendor.cover_url) return;
    try {
      var blob = await lvLoadImageBlob(vendor.cover_url);
      pendingVendorCoverFile = new File([blob], "current-cover.jpg", { type: blob.type || "image/jpeg" });
      openVendorCoverCropModal(pendingVendorCoverFile);
    } catch (e) {
      showToast("Couldn't open your current header. Tap Replace to choose a new one.", "error");
    }
  };

  var st = null;
  function dia() { return Math.round(Math.min(window.innerWidth * 0.86, window.innerHeight * 0.56, 420)); }
  function clamp() {
    var D = st.D, bw = st.iw * st.base * st.s, bh = st.ih * st.base * st.s;
    var mx = Math.max(0, (bw - D) / 2), my = Math.max(0, (bh - D) / 2);
    st.x = Math.max(-mx, Math.min(mx, st.x)); st.y = Math.max(-my, Math.min(my, st.y));
  }
  function paint() {
    var img = document.getElementById("avatarCropImage"); if (!img || !st) return;
    clamp();
    img.style.width = (st.iw * st.base) + "px"; img.style.height = (st.ih * st.base) + "px";
    img.style.transform = "translate(calc(-50% + " + st.x + "px), calc(-50% + " + st.y + "px)) scale(" + st.s + ")";
  }
  function zoomBy(f) { st.s = Math.max(1, Math.min(6, st.s * f)); paint(); }
  window.lvCropZoom = function (f) { if (st) zoomBy(f); };

  window.updateAvatarCropTransform = paint;
  window.bindAvatarCropDrag = function () {};
  window.closeAvatarCropModal = function () {
    var m = document.getElementById("avatarCropModal"); if (m) m.remove();
    st = null; try { avatarCropState = null; pendingAvatarFile = null; } catch (_) {}
    document.documentElement.classList.remove("lvc-open");
  };
  window.openAvatarCropModal = function (file) {
    var reader = new FileReader();
    reader.onerror = reader.onabort = function () { try { showToast("Couldn't open that photo. Try another one.", "error"); } catch (_) {} };
    reader.onload = function () {
      var old = document.getElementById("avatarCropModal"); if (old) old.remove();
      var D = dia();
      var m = document.createElement("div");
      m.id = "avatarCropModal"; m.className = "lvc";
      m.innerHTML = '<div class="lvc-top"><button type="button" class="lvc-x" aria-label="Cancel" onclick="closeAvatarCropModal()"><i class="fa-solid fa-xmark"></i></button><span>Move and scale</span><i></i></div>' +
        '<div class="lvc-stage" id="avatarCropViewport"><img id="avatarCropImage" alt="" draggable="false" src="' + reader.result + '"><div class="lvc-mask" style="width:' + D + 'px;height:' + D + 'px"></div></div>' +
        '<div class="lvc-bar"><button type="button" class="lvc-btn lvc-ghost" onclick="closeAvatarCropModal()">Cancel</button><span class="lvc-zoom"><button type="button" aria-label="Zoom out" onclick="lvCropZoom(1/1.25)"><i class="fa-solid fa-minus"></i></button><button type="button" aria-label="Zoom in" onclick="lvCropZoom(1.25)"><i class="fa-solid fa-plus"></i></button></span><button type="button" class="lvc-btn lvc-go" id="avatarCropDone" onclick="saveAvatarCrop()">Done</button></div>';
      document.body.appendChild(m);
      document.documentElement.classList.add("lvc-open");
      st = { D: D, s: 1.25, x: 0, y: 0, iw: 1, ih: 1, base: 1 };
      var img = document.getElementById("avatarCropImage");
      img.onload = function () {
        st.iw = img.naturalWidth || 1; st.ih = img.naturalHeight || 1;
        st.base = Math.max(st.D / st.iw, st.D / st.ih); paint();
      };
      var stage = document.getElementById("avatarCropViewport");
      var ptrs = {}, last = 0, lx = 0, ly = 0;
      function pts() { return Object.keys(ptrs).map(function (k) { return ptrs[k]; }); }
      function dist(a) { return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
      stage.addEventListener("pointerdown", function (e) { ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; try { stage.setPointerCapture(e.pointerId); } catch (_) {} var a = pts(); last = a.length > 1 ? dist(a) : 0; lx = e.clientX; ly = e.clientY; });
      stage.addEventListener("pointermove", function (e) {
        if (!st || !ptrs[e.pointerId]) return;
        ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
        var a = pts();
        if (a.length > 1) { var d = dist(a); if (last) zoomBy(d / last); last = d; }
        else { st.x += e.clientX - lx; st.y += e.clientY - ly; lx = e.clientX; ly = e.clientY; paint(); }
      });
      function up(e) { delete ptrs[e.pointerId]; var a = pts(); last = a.length > 1 ? dist(a) : 0; if (a.length === 1) { lx = a[0].x; ly = a[0].y; } }
      var lastTap = 0;
      stage.addEventListener("pointerup", function (e) { if (Object.keys(ptrs).length === 1 && Math.hypot(e.clientX - lx, e.clientY - ly) < 6) { var now = Date.now(); if (now - lastTap < 320 && st) { st.s = st.s > 1.4 ? 1 : 2.2; st.x = 0; st.y = 0; paint(); lastTap = 0; } else lastTap = now; } });
      stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
      stage.addEventListener("wheel", function (e) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08); }, { passive: false });
    };
    reader.readAsDataURL(file);
  };
  window.saveAvatarCrop = async function () {
    var img = document.getElementById("avatarCropImage");
    if (!st || !img || !session) return;
    var out = 800, canvas = document.createElement("canvas"); canvas.width = out; canvas.height = out;
    var k = 1 / (st.base * st.s), side = st.D * k;
    var cx = st.iw / 2 - st.x * k, cy = st.ih / 2 - st.y * k;
    canvas.getContext("2d").drawImage(img, cx - side / 2, cy - side / 2, side, side, 0, 0, out, out);
    var btn = document.getElementById("avatarCropDone");
    var busy = function (on) { if (btn) { btn.disabled = on; btn.textContent = on ? "Saving…" : "Done"; } };
    busy(true);
    canvas.toBlob(async function (blob) {
      if (!blob) { busy(false); showToast("Could not prepare that photo.", "error"); return; }
      try {
        var publicUrl = await uploadToR2(blob, "avatars/" + session.user.id + "/avatar.jpg", "image/jpeg");
        var url = publicUrl + "?t=" + Date.now();
        var r = await sb.from("users").update({ avatar_url: url }).eq("id", session.user.id);
        if (r.error) throw r.error;
        profile.avatar_url = url;
        if (vendor && vendor.id) {
          var v = await sb.from("vendors").update({ logo_url: url }).eq("id", vendor.id);
          if (!v.error) vendor.logo_url = url;
        }
        updateAuthUI(); closeAvatarCropModal(); showToast("Profile photo updated.", "success");
        try { window.lvAvatarChanged && window.lvAvatarChanged(); } catch (_) {}
      } catch (err) { busy(false); showToast((err && err.message) || "Couldn't save the photo. Try again.", "error"); }
    }, "image/jpeg", 0.9);
  };
})();

/* ===== Header search: the hint types itself out ("Search for products", "Search for vendors near you", ...) =====
   The visible bar is the button .header-search-row (its text is a span); the real input opens when it is tapped. */
(function () {
  var PHRASES = ["Search for products", "Search for vendors near you", "Search for services", "Search for things to rent", "Search for food & drinks"];
  var i = 0, n = 0, dir = 1;
  try { if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (_) {}
  function tick() {
    var el = document.querySelector(".header-search-row > span");
    if (!el || document.hidden) { setTimeout(tick, 1000); return; }
    var p = PHRASES[i];
    n += dir;
    el.textContent = p.slice(0, n) + (n > 0 ? "" : "Search…");
    var wait = 70;
    if (dir > 0 && n >= p.length) { dir = -1; wait = 1600; }
    else if (dir < 0 && n <= 0) { dir = 1; i = (i + 1) % PHRASES.length; wait = 400; }
    else if (dir < 0) wait = 28;
    setTimeout(tick, wait);
  }
  setTimeout(tick, 1200);
})();

/* ===== New accounts: a skippable "Set up your profile" page (photo + name), like WhatsApp ===== */
(function () {
  var orig = window.runPostAuthChecks;
  if (typeof orig !== "function") return;
  function flagKey() { return "lv-setup-done:" + (session && session.user && session.user.id); }
  function done() { try { return !!localStorage.getItem(flagKey()); } catch (_) { return true; } }
  function markDone() { try { localStorage.setItem(flagKey(), "1"); } catch (_) {} }
  function isNew() {
    var t = profile && profile.created_at ? new Date(profile.created_at).getTime() : 0;
    return t && Date.now() - t < 3 * 86400000;
  }
  var timer = 0;
  function close() { clearInterval(timer); var e = document.getElementById("lvSetup"); if (e) e.remove(); document.documentElement.classList.remove("lvsu-open"); }
  function paintAvatar() {
    var box = document.getElementById("lvSetupAv"); if (!box) return;
    box.innerHTML = (typeof profileAvatarHtml === "function" ? profileAvatarHtml(profile.avatar_url, profile.name || "You", "100%") : "") + '<span class="lvsu-cam"><i class="fa-solid fa-camera"></i></span>';
  }
  function show() {
    if (document.getElementById("lvSetup")) return;
    var d = document.createElement("div"); d.id = "lvSetup"; d.className = "lvsu";
    d.innerHTML = '<div class="lvsu-card"><h2>Set up your profile</h2><p>Add a photo and check your name so people know it\'s you. You can skip this and do it later.</p>' +
      '<button type="button" class="lvsu-av" id="lvSetupAv" aria-label="Choose a profile photo"></button>' +
      '<input type="file" id="lvSetupFile" accept="image/*" hidden onchange="uploadAvatar(event)">' +
      '<label class="lvsu-l" for="lvSetupName">Your name</label><input id="lvSetupName" class="lvsu-name" type="text" maxlength="60" autocomplete="name" value="">' +
      '<button type="button" class="lvsu-go" id="lvSetupGo">Continue</button><button type="button" class="lvsu-skip" id="lvSetupSkip">Skip for now</button></div>';
    document.body.appendChild(d);
    document.documentElement.classList.add("lvsu-open");
    document.getElementById("lvSetupName").value = profile.name || "";
    paintAvatar();
    document.getElementById("lvSetupAv").onclick = function () { document.getElementById("lvSetupFile").click(); };
    var last = profile.avatar_url;
    timer = setInterval(function () { if (profile && profile.avatar_url !== last) { last = profile.avatar_url; paintAvatar(); } }, 500);
    document.getElementById("lvSetupSkip").onclick = function () { markDone(); close(); };
    document.getElementById("lvSetupGo").onclick = async function () {
      var btn = this, v = document.getElementById("lvSetupName").value.trim();
      if (v && v !== profile.name) {
        if (v.length < 2) { showToast("Please enter your name.", "error"); return; }
        btn.disabled = true; btn.textContent = "Saving…";
        var r = await sb.from("users").update({ name: v }).eq("id", session.user.id);
        if (r.error) { btn.disabled = false; btn.textContent = "Continue"; showToast(r.error.message || "Couldn't save your name. Try again.", "error"); return; }
        profile.name = v; try { updateAuthUI(); } catch (_) {}
      }
      markDone(); close();
    };
  }
  window.runPostAuthChecks = async function () {
    await orig.apply(this, arguments);
    try {
      if (!profile || !session || profile.role === "admin" || done() || !isNew()) return;
      if (!String(profile.phone || "").trim() || profile.has_password === false) return;
      var blocked = ["setPasswordModal", "vendorPayoutNudgeModal"].some(function (id) { var m = document.getElementById(id); return m && !m.classList.contains("hidden"); });
      if (!blocked) show();
    } catch (_) {}
  };
})();

/* ===== Comments: one-tap reactions, a sticker button beside the box, and the comment count badge kept up to date ===== */
(function () {
  var CHIPS = ["❤️❤️❤️", "🔥🔥🔥", "⭐⭐⭐", "👏👏👏", "😍😍😍"];
  var STK = ["1f525", "2764-fe0f", "1f60d", "1f602", "1f44f", "1f64f", "1f4af", "1f389", "1f60e", "1f929", "1f973", "1f62d", "1f60a", "1f44d", "1f4aa", "2b50", "1f496", "1f970", "1f64c", "1f618", "1f440", "1f48e", "1f381", "1f680", "1f91d", "1f6cd-fe0f", "1f62e", "1f914", "1f631", "1f921", "1f308", "1f31f", "1f340", "1f354", "1f355", "1f37b", "1f37f", "1f383", "1f388", "1f38a", "1f3af", "1f3b6", "1f3c6", "1f431", "1f44a", "1f44b", "1f44c", "1f451", "1f47b", "1f480", "1f483", "1f48b", "1f493", "1f499", "1f49a", "1f49c", "1f4a1", "1f4a5", "1f4a9", "1f4b8", "1f4e6", "1f604", "1f605", "1f606", "1f607", "1f608", "1f609", "1f60b", "1f61c", "1f621", "1f622", "1f624", "1f62a", "1f634", "1f642", "1f643", "1f69a", "1f6d2", "1f90c", "1f90d", "1f911", "1f913", "1f916", "1f917", "1f919", "1f91e", "1f923", "1f92c", "1f92f", "1f942", "1f972", "1f975", "1f976", "1f979", "1f97a", "1f981", "1f984", "1f98b", "1f9e1", "26a1", "270a", "2728"];
  // "3d/<code>" is the glossy 3D set (/stickers3d); the others are the flat and moving ones
  function stkSrc(id) { return id.indexOf("3d/") === 0 ? "/stickers3d/" + id.slice(3) + ".webp" : "/stickers/" + id + ".webp"; }
  // a comment that is only a sticker is drawn as the picture straight away (no flash of the sticker's code first)
  (function () {
    var om = window.lvMentionHtml;
    window.lvMentionHtml = function (c) {
      var m = /^\s*::s:((?:still\/|3d\/)?[0-9a-f-]+)::\s*$/.exec(String(c == null ? "" : c));
      if (m) return '<img class="lv-stk" src="' + stkSrc(m[1]) + '" alt="sticker" width="96" height="96" decoding="async">';
      return om ? om.apply(this, arguments) : String(c == null ? "" : c).replace(/[&<>"]/g, function (x) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]; });
    };
  })();
  function showStickers() {
    document.querySelectorAll(".product-comment-body:not([data-stk])").forEach(function (b) {
      var m = /^::s:((?:still\/|3d\/)?[0-9a-f-]+)::$/.exec((b.textContent || "").trim());
      b.dataset.stk = "1";
      if (m) b.innerHTML = '<img class="lv-stk" src="' + stkSrc(m[1]) + '" alt="sticker" width="96" height="96" loading="lazy" decoding="async">';
    });
  }
  function syncCount() {
    var panel = document.getElementById("productCommentsPanel"); if (!panel) return;
    if (panel.querySelector(".comment-fetch-placeholder")) return;
    var n = panel.querySelectorAll("[data-comment-id]").length;
    if (!n && !panel.querySelector(".product-comments-empty")) return;
    document.querySelectorAll(".product-detail-card .lv-ccount, #productCommentsCount").forEach(function (b) { if (b.textContent !== String(n)) b.textContent = String(n); });
  }
  function dress() {
    showStickers(); syncCount();
    document.querySelectorAll(".product-comment-composer").forEach(function (c) {
      if (c.dataset.lvChips) return;
      var ta = c.querySelector("textarea"); var send = c.querySelector(".product-comment-compose-row button");
      if (!ta || !send || /package/i.test(ta.id)) return;
      c.dataset.lvChips = "1";
      var row = document.createElement("div"); row.className = "lv-cmt-chips";
      CHIPS.forEach(function (t) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = t;
        b.onclick = function () {
          if (!session) { try { showLogin(); } catch (_) {} return; }
          ta.value = t; ta.dispatchEvent(new Event("input", { bubbles: true })); send.click();
        };
        row.appendChild(b);
      });
      var compose = c.querySelector(".product-comment-compose-row");
      // stickers: a button at the start of the row opens a grid; tapping a sticker posts it as the comment
      // two sets: still stickers and moving ones, switched with the tabs at the top of the panel
      var panel = document.createElement("div"); panel.className = "lv-stk-panel hidden";
      var tabs = document.createElement("div"); tabs.className = "lv-stk-tabs"; panel.appendChild(tabs);
      var grids = {};
      [["3d", "3D"], ["still", "Flat"], ["", "Moving"]].forEach(function (set, i) {
        var tb = document.createElement("button"); tb.type = "button"; tb.textContent = set[1]; tb.className = i === 0 ? "on" : "";
        var grid = document.createElement("div"); grid.className = "lv-stk-grid" + (i === 0 ? "" : " hidden"); grids[set[0]] = grid;
        tb.onclick = function () { tabs.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === tb); }); Object.keys(grids).forEach(function (k) { grids[k].classList.toggle("hidden", k !== set[0]); }); };
        tabs.appendChild(tb);
        STK.forEach(function (code) {
          var id = (set[0] ? set[0] + "/" : "") + code;
          var sb2 = document.createElement("button"); sb2.type = "button"; sb2.setAttribute("aria-label", "Send sticker");
          sb2.innerHTML = '<img src="' + stkSrc(id) + '" alt="" width="48" height="48" loading="lazy" decoding="async">';
          sb2.onclick = function () { if (!session) { try { showLogin(); } catch (_) {} return; } panel.classList.add("hidden"); ta.value = "::s:" + id + "::"; ta.dispatchEvent(new Event("input", { bubbles: true })); send.click(); };
          grid.appendChild(sb2);
        });
        panel.appendChild(grid);
      });
      var tog = document.createElement("button"); tog.type = "button"; tog.className = "lv-stk-tog"; tog.setAttribute("aria-label", "Stickers"); tog.innerHTML = '<i class="fa-regular fa-face-smile"></i>';
      tog.onclick = function () { panel.classList.toggle("hidden"); };
      compose.insertBefore(tog, compose.firstChild);
      c.insertBefore(panel, compose); c.insertBefore(row, panel);
    });
  }
  var raf = 0;
  try { new MutationObserver(function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; dress(); }); }).observe(document.body, { childList: true, subtree: true }); } catch (_) {}
  dress();
})();

/* ===== Laptop / desktop: the side menu hides behind a menu button, and side-scrolling rows get arrows ===== */
(function () {
  var mq = window.matchMedia("(min-width: 1024px)");
  var root = document.documentElement;
  function close() { root.classList.remove("lv-rail-open"); var b = document.getElementById("lvRailBtn"); if (b) b.setAttribute("aria-expanded", "false"); }
  function toggle() { var open = !root.classList.contains("lv-rail-open"); root.classList.toggle("lv-rail-open", open); var b = document.getElementById("lvRailBtn"); if (b) b.setAttribute("aria-expanded", String(open)); }
  window.lvCloseRail = close;
  function ensure() {
    var row = document.querySelector("header .header-top-row");
    if (row && !document.getElementById("lvRailBtn")) {
      var b = document.createElement("button");
      b.type = "button"; b.id = "lvRailBtn"; b.className = "lv-rail-btn"; b.setAttribute("aria-label", "Menu"); b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-controls", "bottomNav");
      b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
      b.onclick = function (e) { e.stopPropagation(); toggle(); };
      row.insertBefore(b, row.firstChild);
    }
    if (!document.getElementById("lvRailScrim")) {
      var s = document.createElement("div"); s.id = "lvRailScrim"; s.onclick = close; document.body.appendChild(s);
    }
  }
  // choosing anything in the menu closes it
  document.addEventListener("click", function (e) { if (root.classList.contains("lv-rail-open") && e.target.closest && e.target.closest("#bottomNav .bottom-nav-item, #bottomNav .bottom-nav-add")) setTimeout(close, 60); }, true);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  if (mq.addEventListener) mq.addEventListener("change", function () { if (!mq.matches) close(); });
  ensure(); document.addEventListener("DOMContentLoaded", ensure); setTimeout(ensure, 1500);

  // arrows for rows that scroll sideways (a mouse cannot swipe them)
  var prev, next, cur = null, hideT = 0;
  function btn(dir) {
    var b = document.createElement("button"); b.type = "button"; b.className = "lv-row-arrow lv-row-" + dir; b.setAttribute("aria-label", dir === "prev" ? "Scroll left" : "Scroll right");
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="' + (dir === "prev" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6") + '"/></svg>';
    b.onclick = function () { if (cur) cur.scrollBy({ left: (dir === "prev" ? -1 : 1) * Math.max(240, cur.clientWidth * 0.8), behavior: "smooth" }); setTimeout(place, 420); };
    b.onmouseenter = function () { clearTimeout(hideT); };
    document.body.appendChild(b); return b;
  }
  function scroller(el) {
    while (el && el !== document.body) {
      if (el.scrollWidth > el.clientWidth + 8) { var ox = getComputedStyle(el).overflowX; if (ox === "auto" || ox === "scroll") return el; }
      el = el.parentElement;
    }
    return null;
  }
  function place() {
    if (!cur || !mq.matches) { if (prev) { prev.classList.remove("on"); next.classList.remove("on"); } return; }
    var r = cur.getBoundingClientRect(), y = r.top + r.height / 2 - 20;
    if (r.bottom < 0 || r.top > innerHeight) { prev.classList.remove("on"); next.classList.remove("on"); return; }
    prev.style.top = next.style.top = y + "px"; prev.style.left = (r.left + 8) + "px"; next.style.left = (r.right - 48) + "px";
    prev.classList.toggle("on", cur.scrollLeft > 4); next.classList.toggle("on", cur.scrollLeft + cur.clientWidth < cur.scrollWidth - 4);
  }
  document.addEventListener("mouseover", function (e) {
    if (!mq.matches || !e.target.closest || e.target.closest(".lv-row-arrow")) return;
    var s = scroller(e.target);
    if (!s || s.closest("#bottomNav, .leaflet-container, .vmpage")) { clearTimeout(hideT); hideT = setTimeout(function () { cur = null; place(); }, 250); return; }
    clearTimeout(hideT);
    if (!prev) { prev = btn("prev"); next = btn("next"); }
    cur = s; place();
  }, { passive: true });
  addEventListener("scroll", function () { if (cur) place(); }, { passive: true, capture: true });
})();

/* ===== Wallet colours: a small palette button next to the "Wallet" label; the choice is remembered on this phone ===== */
(function () {
  "use strict";
  var THEMES = ["", "violet", "ocean", "sunset", "rose", "midnight"];
  var KEY = "lv-wallet-theme";
  function read() {
    try { var v = localStorage.getItem(KEY); if (v !== null) return v; } catch (_) {}
    try { var m = /(?:^|; )lv-wallet-theme=([^;]*)/.exec(document.cookie); return m ? decodeURIComponent(m[1]) : ""; } catch (_) { return ""; }
  }
  function save(t) {
    try { localStorage.setItem(KEY, t); } catch (_) {}
    try { document.cookie = KEY + "=" + encodeURIComponent(t) + "; max-age=31536000; path=/; samesite=lax"; } catch (_) {}
  }
  function apply(t) { if (t) document.documentElement.setAttribute("data-lvw-theme", t); else document.documentElement.removeAttribute("data-lvw-theme"); }
  apply(read());
  // an installed app can be woken from the background: put the saved colour back whenever it comes forward
  document.addEventListener("visibilitychange", function () { if (!document.hidden) apply(read()); });
  window.addEventListener("pageshow", function () { apply(read()); });
  // the colour choice lives in the wallet's help sheet (the "?" beside the wallet's name)
  var NAMES = { "": "Green", violet: "Violet", ocean: "Ocean", sunset: "Sunset", rose: "Rose", midnight: "Midnight" };
  window.lvWalletColoursHtml = function () {
    var cur = document.documentElement.getAttribute("data-lvw-theme") || "";
    return '<div class="lvw-colours"><div class="lvw-colours-h">Wallet colour</div><div class="lvw-swatches" role="radiogroup" aria-label="Wallet colour">' +
      THEMES.map(function (t) { return '<button type="button" role="radio" aria-checked="' + (t === cur) + '" class="lvw-sw lvw-sw-' + (t || "green") + (t === cur ? " on" : "") + '" onclick="lvWalletSetTheme(\'' + t + '\')"><span class="lvw-sw-dot">' + (t === cur ? '<i class="fa-solid fa-check"></i>' : "") + '</span><small>' + NAMES[t] + '</small></button>'; }).join("") +
      '</div></div>';
  };
  window.lvWalletSetTheme = function (t) {
    if (THEMES.indexOf(t) < 0) t = "";
    apply(t); save(t);
    document.querySelectorAll(".lvw-colours").forEach(function (box) { var tmp = document.createElement("div"); tmp.innerHTML = window.lvWalletColoursHtml(); box.replaceWith(tmp.firstChild); });
  };
  window.lvWalletTheme = function (e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    var cur = document.documentElement.getAttribute("data-lvw-theme") || "";
    var next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    apply(next); save(next);
  };
  function addButtons() {
    document.querySelectorAll(".lvw-card:not(.lvw2) .lvw-top").forEach(function (top) {
      if (top.querySelector(".lvw-theme-btn")) return;
      var b = document.createElement("button");
      b.type = "button"; b.className = "lvw-theme-btn"; b.title = "Change wallet colour"; b.setAttribute("aria-label", "Change wallet colour");
      b.innerHTML = '<i class="fa-solid fa-palette" aria-hidden="true"></i>';
      b.onclick = window.lvWalletTheme;
      var label = top.querySelector(".lvw-label");
      if (label && label.nextSibling) top.insertBefore(b, label.nextSibling); else top.appendChild(b);   // beside the label, the eye stays at the far right
    });
    apply(read());
  }
  var raf = 0;
  new MutationObserver(function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; addButtons(); }); }).observe(document.body, { childList: true, subtree: true });
  addButtons();
})();

/* ===== Bottom bar: each icon has its own little motion when tapped (home hops, the pin drops, Request twirls, the bell rings, the receipt slides) ===== */
(function () {
  "use strict";
  var MAP = { home: "hop", vendors: "drop", request: "twirl", add: "twirl", notifications: "ring", orders: "slide" };
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#bottomNav .bottom-nav-item, #bottomNav .bottom-nav-add");
    if (!b) return;
    var label = (b.textContent || "").trim().toLowerCase().replace(/\s+/g, " ");
    var kind = MAP[label]; if (!kind) return;
    var ic = b.querySelector(".bn-icon"); if (!ic) return;
    ic.classList.remove("bn-m-hop", "bn-m-drop", "bn-m-twirl", "bn-m-ring", "bn-m-slide");
    void ic.offsetWidth;   // restart the motion even on a quick second tap
    ic.classList.add("bn-m-" + kind);
    setTimeout(function () { ic.classList.remove("bn-m-" + kind); }, 700);
  }, true);
})();

/* ===== Vendors page: Levi morphs into a floating map pin (draggable, sparkling); tapping it opens the map ===== */
(function () {
  "use strict";
  var POS = "lv-mapfab-pos", fab = null, busy = 0;
  var PIN = '<svg class="mf-pin" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
  function levi() { return document.getElementById("aiChatFab"); }
  // Levi turns into a pin on the Vendors page and into a magnifying glass (still carrying the Levromart mark) on the Search page
  var LENS = '<svg viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true"><defs><linearGradient id="lvLensA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#19c486"/><stop offset="1" stop-color="#7c3aed"/></linearGradient><linearGradient id="lvLensB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#19c486"/></linearGradient></defs><g class="mf-lens-ring"><path d="M13.7 31.9A13.5 13.5 0 0 1 13.7 8.1" stroke="url(#lvLensA)" stroke-width="4.6" stroke-linecap="round"/><path d="M26.3 8.1A13.5 13.5 0 0 1 26.3 31.9" stroke="url(#lvLensA)" stroke-width="4.6" stroke-linecap="round"/><circle cx="20" cy="20" r="3.6" fill="url(#lvLensB)"/></g><path d="M34.5 34.5 42 42" stroke="url(#lvLensB)" stroke-width="6" stroke-linecap="round"/></svg>';
  function modeNow() { try { var v = typeof currentView !== "undefined" ? currentView : ""; return v === "vendors" ? "vendors" : v === "search" ? "search" : ""; } catch (_) { return ""; } }
  function core(mode) { return '<span class="mf-core">' + (mode === "search" ? LENS : PIN) + '<b>' + (mode === "search" ? "Search" : "Map") + '</b></span>'; }
  function tap(mode) { if (mode === "search") { try { if (typeof toggleAiChat === "function") { var pnl = document.getElementById("aiChatPanel"); if (!pnl || pnl.classList.contains("hidden")) toggleAiChat(); } } catch (_) {} } else { try { navigate("vendorsMap"); } catch (_) {} } }
  function clampPos(x, y) {
    var w = innerWidth, h = innerHeight;
    return { x: Math.min(Math.max(x, 8), w - 68), y: Math.min(Math.max(y, 70), h - 150) };
  }
  function build(x, y, mode) {
    var b = document.createElement("button");
    b.type = "button"; b.id = "lvMapFab"; b.className = "lv-mapfab"; b.setAttribute("aria-label", mode === "search" ? "Ask Levi" : "Open the vendors map"); b.title = mode === "search" ? "Search" : "Vendors map";
    b.innerHTML = core(mode); b.__mode = mode; b.setAttribute("data-mode", mode);
    b.style.left = x + "px"; b.style.top = y + "px";
    attachDrag(b);
    return b;
  }
  function attachDrag(b) {
    var sx = 0, sy = 0, bl = 0, bt = 0, moved = false, id = null, raf = 0, lx = 0, ly = 0;
    b.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      id = e.pointerId; moved = false; sx = e.clientX; sy = e.clientY;
      var r = b.getBoundingClientRect(); bl = r.left; bt = r.top; lx = bl; ly = bt;
      try { b.setPointerCapture(id); } catch (_) {}
    }, { passive: true });
    b.addEventListener("pointermove", function (e) {
      if (id === null || e.pointerId !== id) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) > 6) { moved = true; window.__lvDragging = true; b.classList.add("mf-drag"); document.documentElement.classList.add("lv-fab-dragging"); }
      if (!moved) return;
      var p = clampPos(bl + dx, bt + dy); lx = p.x; ly = p.y;
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; b.style.transform = "translate3d(" + (lx - bl) + "px," + (ly - bt) + "px,0)"; });
    }, { passive: true });
    function end(e) {
      if (id === null || (e && e.pointerId !== id)) return;
      id = null; if (raf) { cancelAnimationFrame(raf); raf = 0; }
      window.__lvDragging = false; b.classList.remove("mf-drag"); document.documentElement.classList.remove("lv-fab-dragging");
      if (moved) {
        b.style.left = lx + "px"; b.style.top = ly + "px"; b.style.transform = ""; b.style.translate = "";
        try { localStorage.setItem(POS, JSON.stringify({ x: lx, y: ly })); } catch (_) {}
      } else { tap(b.__mode); }
    }
    b.addEventListener("pointerup", end, { passive: true });
    b.addEventListener("pointercancel", end, { passive: true });
  }
  function show() {
    if (fab || busy) return;
    var l = levi(), r = l && l.offsetWidth ? l.getBoundingClientRect() : null;
    var saved = null; try { saved = JSON.parse(localStorage.getItem(POS) || "null"); } catch (_) {}
    var start = saved && Number.isFinite(saved.x) ? { x: saved.x, y: saved.y } : r ? { x: r.left + r.width / 2 - 30, y: r.top + r.height / 2 - 30 } : { x: innerWidth - 78, y: innerHeight - 190 };
    start = clampPos(start.x, start.y);
    fab = build(start.x, start.y, modeNow());
    document.body.appendChild(fab);
    requestAnimationFrame(function () { fab.classList.add("mf-in"); });
    if (l) l.classList.add("lv-levi-away");   // Levi shrinks and turns away while the pin grows in his place
  }
  function hide() {
    if (!fab) return;
    var f = fab; fab = null; busy++;
    f.classList.remove("mf-in"); f.classList.add("mf-out");
    var l = levi(); if (l) l.classList.remove("lv-levi-away");   // Levi comes back
    setTimeout(function () { try { f.remove(); } catch (_) {} busy = Math.max(0, busy - 1); check(); }, 420);
  }
  function check() {
    var m = modeNow();
    if (!m) { hide(); return; }
    if (!fab) { show(); return; }
    if (fab.__mode !== m && fab.classList.contains("mf-in")) {   // Vendors <-> Search: the icon warps into the other one in place
      var f = fab; f.classList.remove("mf-in"); f.classList.add("mf-swap");
      setTimeout(function () { if (!f.isConnected) return; f.innerHTML = core(m); f.__mode = m; f.setAttribute("data-mode", m); f.setAttribute("aria-label", m === "search" ? "Search" : "Open the vendors map"); f.title = m === "search" ? "Search" : "Vendors map"; f.classList.remove("mf-swap"); f.classList.add("mf-in"); }, 220);
    }
  }
  var nav = window.navigate;
  if (typeof nav === "function") {
    window.navigate = function () { var r = nav.apply(this, arguments); setTimeout(check, 0); try { Promise.resolve(r).then(check, check); } catch (_) {} return r; };
  }
  setInterval(check, 600);
  window.addEventListener("popstate", function () { setTimeout(check, 50); });
  setTimeout(check, 800);
})();

/* ===== Trending rails: every product in the app, once each, then the row simply ends (no looping) =====
   Near the end of a sideways row, the next products are added in one fixed (shuffled once) order. A product already on the row
   is never added again, and when all of them have been shown nothing more is added. ===== */
(function () {
  "use strict";
  var BATCH = 12;
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  window.__lvTrendOrder = window.__lvTrendOrder || {};
  function attach(rail) {
    if (rail.__lvEndless) return; rail.__lvEndless = true;
    var isSvc = rail.classList.contains("service-trending-scroll"), key = isSvc ? "svc" : "prod";
    var busy = false;
    function order() {
      var cur = window.__lvTrendOrder[key];
      if (cur && cur.length) return cur;
      var idx = window.__homeBrowseIndex;
      if (!Array.isArray(idx)) return [];
      cur = shuffle(idx.filter(function (x) { return !!x.is_service === isSvc; }).map(function (x) { return String(x.id); }));
      window.__lvTrendOrder[key] = cur; return cur;
    }
    async function more() {
      if (busy || typeof fetchProductsByIds !== "function" || typeof productCardHtml !== "function") return;
      busy = true;
      try {
        var ids = order(); if (!ids.length) return;
        var onRail = new Set([].map.call(rail.querySelectorAll("[data-product-id]"), function (e) { return e.getAttribute("data-product-id"); }));
        var take = ids.filter(function (id) { return !onRail.has(id); }).slice(0, BATCH);
        if (!take.length) return;                       // everything has been shown: the row ends here
        var rows = await fetchProductsByIds(take);
        if (!rail.isConnected || !rows || !rows.length) return;
        var have = new Set([].map.call(rail.querySelectorAll("[data-product-id]"), function (e) { return e.getAttribute("data-product-id"); }));
        var fresh = rows.filter(function (r) { return r && !have.has(String(r.id)); });
        if (fresh.length) rail.insertAdjacentHTML("beforeend", fresh.map(productCardHtml).join(""));
      } catch (_) {} finally { busy = false; }
    }
    rail.addEventListener("scroll", function () { if (rail.scrollWidth - rail.scrollLeft - rail.clientWidth < 900) more(); }, { passive: true });
    setTimeout(function () { if (rail.isConnected && rail.scrollWidth - rail.clientWidth < 900) more(); }, 1500);
  }
  var raf = 0;
  new MutationObserver(function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; document.querySelectorAll("#app .hscroll.trending-scroll").forEach(attach); }); }).observe(document.body, { childList: true, subtree: true });
})();

/* ===== Profile picture: choosing a photo never leaves the page, and a new picture shows everywhere at once ===== */
(function () {
  "use strict";
  // The hidden file picker sits inside clickable areas (like the panel header that opens "my profile"). Opening it from code sends a
  // click that bubbled up to them and took the person away from the page before the photo was even chosen.
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.matches && t.matches('input[type="file"]')) e.stopPropagation();
  }, true);

  function rawOf(src) {
    if (!src) return "";
    if (src.indexOf("wsrv.nl") >= 0) { var m = /[?&]url=([^&]+)/.exec(src); try { return m ? "https://" + decodeURIComponent(m[1]) : src; } catch (_) { return src; } }
    return src;
  }
  // every small picture of this account (top right, side panel, My account, vendor cards) is swapped for the new one in place
  function refreshEverywhere() {
    try {
      var uid = session && session.user && session.user.id, url = profile && profile.avatar_url;
      if (!uid) return;
      var key = "/avatars/" + uid + "/";
      var imgs = document.querySelectorAll("img");
      for (var i = 0; i < imgs.length; i++) {
        var im = imgs[i], raw = rawOf(im.getAttribute("src") || "");
        if (raw.indexOf(key) < 0) continue;
        if (!url) { im.style.visibility = "hidden"; continue; }
        var w = im.getBoundingClientRect().width || 120;
        im.src = (typeof lvThumb === "function" ? lvThumb(url, Math.max(160, Math.min(400, Math.round(w)))) : url) || url;
        im.style.visibility = "";
      }
      if (window.lvDropPageSnaps) window.lvDropPageSnaps();   // the saved copies of Home and shop pages (for a quick Back) still show the old one
    } catch (_) {}
  }
  var prev = window.lvAvatarChanged;
  window.lvAvatarChanged = function () {
    try { if (typeof prev === "function") prev.apply(this, arguments); } catch (_) {}
    refreshEverywhere();
    [150, 700].forEach(function (ms) { setTimeout(refreshEverywhere, ms); });   // after the header and panel have redrawn
  };
})();

/* ===== The first time someone opens a product, a small hint shows that they can swipe sideways to the next product ===== */
(function () {
  "use strict";
  var KEY = "lv-swipe-hint-v1", shownFor = null;
  function seen() { try { return localStorage.getItem(KEY) === "1"; } catch (_) { return false; } }
  function show() {
    if (seen() || document.getElementById("lvSwipeHint")) return;
    var d = document.createElement("div");
    d.id = "lvSwipeHint"; d.setAttribute("aria-hidden", "true");
    d.innerHTML = '<span class="lvsh-a l"><i class="fa-solid fa-chevron-left"></i><i class="fa-solid fa-chevron-left"></i></span><b>Swipe for the next product</b><span class="lvsh-a r"><i class="fa-solid fa-chevron-right"></i><i class="fa-solid fa-chevron-right"></i></span>';
    document.body.appendChild(d);
    try { localStorage.setItem(KEY, "1"); } catch (_) {}
    var gone = false;
    function kill() { if (gone) return; gone = true; d.classList.add("out"); setTimeout(function () { d.remove(); }, 300); }
    setTimeout(kill, 5200);
    ["touchstart", "pointerdown"].forEach(function (t) { document.addEventListener(t, kill, { once: true, passive: true, capture: true }); });
  }
  var raf = 0;
  new MutationObserver(function () {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      try {
        if (typeof currentView === "undefined" || currentView !== "productDetail") { shownFor = null; var h = document.getElementById("lvSwipeHint"); if (h) h.remove(); return; }
        if (!seen() && document.querySelector("#app .product-detail-title") && shownFor !== location.href) { shownFor = location.href; setTimeout(show, 900); }
      } catch (_) {}
    });
  }).observe(document.body, { childList: true, subtree: true });
})();

/* ---- occasional welcome pop-up (lv-promo) ----
   Now and then, when someone opens the app on the home screen, a short card about one Levromart feature pops up,
   with a round X underneath to close it. It never shows on the first visit, before onboarding is finished, more
   than once every two days, or over another open sheet. The cards take turns; the artwork is the onboarding art. */
(function () {
  "use strict";
  var KEY = "lv_promo_v1", GAP_MS = 48 * 60 * 60 * 1000, WAIT_MS = 2500;
  // kept in local storage AND a cookie: some phones lose one of them when the app is closed, which made the same card
  // come back every time; whichever copy has seen more app opens wins
  function fromCookie() { try { var m = /(?:^|; )lv_promo_v1=([^;]*)/.exec(document.cookie); return m ? JSON.parse(decodeURIComponent(m[1])) || {} : {}; } catch (_) { return {}; } }
  function load() {
    var a = {}; try { a = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (_) {}
    var b = fromCookie();
    return Number(b.opens || 0) > Number(a.opens || 0) || Number(b.at || 0) > Number(a.at || 0) ? b : a;
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {}
    try { document.cookie = "lv_promo_v1=" + encodeURIComponent(JSON.stringify({ opens: s.opens, at: s.at, n: s.n })) + "; max-age=31536000; path=/; samesite=lax"; } catch (_) {}
  }
  var arts = [].slice.call(document.querySelectorAll("#lvOnb img.lv-hero")).map(function (i) { return i.getAttribute("src") || ""; });
  function isVendor() { try { return typeof profile !== "undefined" && profile && profile.role === "vendor"; } catch (_) { return false; } }
  function closeAi() { try { var p = document.getElementById("aiChatPanel"); return !p || p.classList.contains("hidden"); } catch (_) { return true; } }
  var CARDS = [
    { key: "safe", tone: "green", art: 1, kicker: "Shop with peace of mind", t1: "Pay safe.", t2: "Shop happy.",
      sub: "Your money stays with Levromart until you confirm you got your order.", cta: "Start shopping", icon: "fa-shield-halved",
      go: function () { if (typeof navigate === "function") navigate("home"); setTimeout(function () { var b = document.getElementById("browseSection"); if (b) b.scrollIntoView({ behavior: "smooth", block: "start" }); }, 250); } },
    { key: "levi", tone: "purple", art: 0, kicker: "Meet Levi", t1: "Just ask.", t2: "Levi finds it.",
      sub: "A gown, the closest vendor, the best price. Ask Levi and get real products in seconds.", cta: "Ask Levi", icon: "fa-wand-magic-sparkles",
      go: function () { if (typeof toggleAiChat === "function" && closeAi()) toggleAiChat(); } },
    { key: "near", tone: "blue", art: 1, kicker: "Around you", t1: "Vendors", t2: "near you.",
      sub: "See who sells close to you, what they sell and how far they are.", cta: "Find vendors", icon: "fa-location-dot",
      go: function () { if (typeof navigate === "function") navigate("vendors"); } },
    { key: "sell", tone: "amber", art: 2, kicker: "Got something to sell?", t1: "Open your", t2: "own shop.",
      sub: "Sell to shoppers around you and get paid safely through Levromart.", cta: "Start selling", icon: "fa-store", forVendors: false,
      go: function () { if (typeof session === "undefined" || !session) { if (typeof showLogin === "function") showLogin(); return; } if (typeof navigate === "function") navigate("vendorApply"); } }
  ];
  function pick(s) {
    var list = CARDS.filter(function (c) { return !(c.forVendors === false && isVendor()); });
    if (!list.length) return null;
    var n = Number(s.n || 0);
    return list[n % list.length];
  }
  function close(m, done) {
    if (!m || m.__closing) return; m.__closing = true;
    m.classList.add("lv-promo-out");
    document.removeEventListener("keydown", m.__key);
    setTimeout(function () { m.remove(); if (done) done(); }, 220);
  }
  function show(card) {
    if (!card || document.getElementById("lvPromo")) return;
    var art = arts[card.art] || arts[0] || "";
    var m = document.createElement("div");
    m.id = "lvPromo"; m.className = "lv-promo lv-promo-" + card.tone;
    m.innerHTML =
      '<div class="lv-promo-wrap" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="lvPromoTitle" aria-describedby="lvPromoSub">' +
        '<div class="lv-promo-card">' +
          '<span class="lv-promo-glow" aria-hidden="true"></span>' +
          '<span class="lv-promo-coin c1" aria-hidden="true">₦</span><span class="lv-promo-coin c2" aria-hidden="true">₦</span>' +
          '<span class="lv-promo-spark s1" aria-hidden="true"></span><span class="lv-promo-spark s2" aria-hidden="true"></span><span class="lv-promo-spark s3" aria-hidden="true"></span>' +
          (art ? '<img class="lv-promo-art" src="' + art + '" alt="" decoding="async" />' : '') +
          '<div class="lv-promo-body">' +
            '<span class="lv-promo-kicker"><i class="fa-solid ' + card.icon + '" aria-hidden="true"></i>' + card.kicker + '</span>' +
            '<h2 id="lvPromoTitle" class="lv-promo-title"><span>' + card.t1 + '</span><span class="lv-promo-hl">' + card.t2 + '</span></h2>' +
            '<p id="lvPromoSub" class="lv-promo-sub">' + card.sub + '</p>' +
            '<button type="button" class="lv-promo-cta">' + card.cta + '<i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="lv-promo-x" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '</div>';
    m.addEventListener("click", function (e) {
      if (e.target.closest(".lv-promo-cta")) { close(m, function () { try { card.go(); } catch (_) {} }); return; }
      if (e.target.closest(".lv-promo-x") || e.target === m) close(m);
    });
    m.__key = function (e) { if (e.key === "Escape") close(m); };
    document.addEventListener("keydown", m.__key);
    document.body.appendChild(m);
    try { m.querySelector(".lv-promo-wrap").focus({ preventScroll: true }); } catch (_) {}
  }
  function busy() {
    if (document.querySelector(".modal.open, #lvPayModal, #lvRefundSheet, .lv-ap-sheet")) return true;
    var mods = document.querySelectorAll(".modal:not(.hidden)");
    for (var i = 0; i < mods.length; i++) if (mods[i].offsetParent !== null || getComputedStyle(mods[i]).position === "fixed" && getComputedStyle(mods[i]).display !== "none" && getComputedStyle(mods[i]).visibility !== "hidden") return true;
    var onb = document.getElementById("lvOnb");
    if (onb && onb.offsetParent !== null && getComputedStyle(onb).display !== "none" && getComputedStyle(onb).visibility !== "hidden") return true;
    return !closeAi();
  }
  function onboarded() { try { return localStorage.getItem("levromart_onboarding_completed") === "true"; } catch (_) { return false; } }
  // counts app opens; the pop-up never comes on the very first one
  var s = load(); s.opens = Number(s.opens || 0) + 1; save(s);
  function maybe() {
    var st = load();
    if (/[?&]nopromo\b/.test(location.search)) return;
    if (st.opens < 2 || !onboarded()) return;
    if (st.at && Date.now() - Number(st.at) < GAP_MS) return;
    if (typeof currentView !== "undefined" && currentView !== "home") return;
    if (document.visibilityState === "hidden" || busy()) return;
    var card = pick(st); if (!card) return;
    st.at = Date.now(); st.n = Number(st.n || 0) + 1; save(st);
    show(card);
  }
  setTimeout(maybe, WAIT_MS);
  // for checking a card on a preview: lvShowPromo("safe" | "levi" | "near" | "sell")
  window.lvShowPromo = function (key) { show(CARDS.filter(function (c) { return c.key === key; })[0] || CARDS[0]); };
})();

/* ---- Orders page, tidied (lvo-): a title row with Stats and History, no "Payment unresolved" tab (Paystack confirms
   payments itself now), short clean order cards and a small empty state. Shared by the shop's and the buyer's pages. ---- */
(function () {
  "use strict";
  // the status tabs: "Payment unresolved" only appears while it is the chosen filter (still in the Filter list for old orders)
  var origPills = window.orderStatusPillsHtml;
  if (typeof origPills === "function") {
    window.orderStatusPillsHtml = function (view, status) {
      var html = origPills.apply(this, arguments);
      if (status === "payment_unresolved") return html;
      return String(html).replace(/<button type="button" data-status="payment_unresolved"[\s\S]*?<\/button>/, "");
    };
  }
  window.lvToggleOrderStats = function (btn) {
    var sec = document.getElementById("orderStatsAccordion"); if (!sec) return;
    var open = !sec.classList.contains("open");
    sec.classList.toggle("open", open);
    if (btn) { btn.classList.toggle("on", open); btn.setAttribute("aria-expanded", String(open)); }
    if (open && typeof renderOrderStatsBody === "function") renderOrderStatsBody();
  };
  var HIST = 'aria-label="Order history" title="Order history"><i class="fa-solid fa-clock-rotate-left"></i></button>';
  function tidy(html, isVendor) {
    html = String(html == null ? "" : html);
    if (html.indexOf("orders-title-row") < 0 || html.indexOf("lvo-ready") >= 0) return html;
    var stats = isVendor && html.indexOf("orderStatsAccordion") >= 0 ? '<button type="button" class="orders-icon-btn lvo-pill" onclick="lvToggleOrderStats(this)" aria-expanded="false" aria-label="Order stats"><i class="fa-solid fa-chart-simple"></i><span>Stats</span></button>' : "";
    var i = html.indexOf(HIST);
    if (i >= 0) {
      var b = html.lastIndexOf("<button", i);
      html = html.slice(0, b) + stats + html.slice(b, i).replace('class="orders-icon-btn', 'class="orders-icon-btn lvo-pill') + 'aria-label="Order history" title="Order history"><i class="fa-solid fa-clock-rotate-left"></i><span>History</span></button>' + html.slice(i + HIST.length);
    }
    return html.replace('class="orders-title-row"', 'class="orders-title-row lvo-ready"');
  }
  function wrap(name, isVendor) {
    var f = window[name]; if (typeof f !== "function" || f.__lvo) return;
    var w = async function () { return tidy(await f.apply(this, arguments), isVendor && arguments[5] !== "purchases"); };
    w.__lvo = true; w.__lvw = f.__lvw; w.__lvrw = f.__lvrw; window[name] = w;
  }
  function wrapAll() { wrap("renderVendorOrders", true); wrap("renderCustomerOrders", false); }
  wrapAll(); setTimeout(wrapAll, 1300); setTimeout(wrapAll, 4200);

  // order cards
  var origList = window.orderListHtml;
  var STATUS = { pending: "Pending", confirmed: "Confirmed", handed_over: "Handed over", returned: "Returned", payment_unresolved: "Payment check", disputed: "Disputed", completed: "Completed", cancelled: "Cancelled" };
  function shortDate(iso) { try { var d = new Date(iso), t = new Date(); var same = d.toDateString() === t.toDateString(); return same ? "Today, " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } }
  window.orderListHtml = function (orders, isCustomerView, sourcePerspective) {
    if (typeof orderListViewMode !== "undefined" && orderListViewMode === "table" && origList) return origList.apply(this, arguments);
    var src = sourcePerspective ? ",source:'" + sourcePerspective + "'" : "";
    if (!orders || !orders.length) {
      var onlyHistory = window.__orderHistoryEmpty === false;
      var acts = isCustomerView
        ? '<button type="button" class="btn lvo-btn" onclick="navigate(\'home\')"><i class="fa-solid fa-bag-shopping"></i> Start shopping</button>'
        : (typeof vendor !== "undefined" && vendor && vendor.id ? '<button type="button" class="btn lvo-btn" onclick="navigate(\'storefront\',{vendorId:\'' + esc(vendor.id) + '\'})"><i class="fa-solid fa-share-nodes"></i> View and share your shop</button>' : "");
      return '<div class="lvo-empty"><span class="lvo-empty-ico">' + (typeof lvIllus === "function" ? lvIllus("box", 64) : '<i class="fa-solid fa-box-open"></i>') + '</span>' +
        '<strong>' + (onlyHistory ? "No active orders" : "No orders yet") + '</strong>' +
        '<span>' + (onlyHistory ? "Finished orders are in History." : isCustomerView ? "Orders you place will show up here." : "When a customer orders from you, it shows up here and you get a notification.") + '</span>' + acts + '</div>';
    }
    var expanded = typeof orderListExpanded !== "undefined" && orderListExpanded;
    var size = typeof ORDER_LIST_PAGE_SIZE !== "undefined" ? ORDER_LIST_PAGE_SIZE : 5;
    var shown = expanded ? orders : orders.slice(0, size);
    var more = orders.length > size ? '<button type="button" class="lvo-more" onclick="toggleOrderListExpanded()">' + (expanded ? 'Show less <i class="fa-solid fa-chevron-up"></i>' : 'Show all ' + orders.length + ' orders <i class="fa-solid fa-chevron-down"></i>') + '</button>' : "";
    return '<div class="lvo-list">' + shown.map(function (o) {
      var items = o.items || [], first = items[0], prod = first && first.product;
      var title = prod && prod.name ? prod.name + (items.length > 1 ? " +" + (items.length - 1) + " more" : "") : "Order";
      var qty = first && Number(first.quantity) > 1 && items.length === 1 ? " ×" + first.quantity : "";
      var photo = (prod && prod.photos && prod.photos[0]) || (isCustomerView && o.vendor && o.vendor.logo_url) || "";
      var party = isCustomerView ? (o.vendor && o.vendor.business_name) || "Vendor" : (o.buyer && o.buyer.name) || (o.status === "pending" ? "New customer" : "Customer");
      var stage = typeof lvOrderStageLabel === "function" ? lvOrderStageLabel(o) : "";
      var label = stage || STATUS[o.status] || String(o.status || "").replace(/_/g, " ");
      var cls = stage ? "paid" : (o.status || "");
      var iso = typeof orderActivityIso === "function" ? orderActivityIso(o) : o.created_at;
      return '<button type="button" class="order-list-card lvo-card" onclick="navigate(\'orderDetail\',{orderId:\'' + esc(o.id) + "'" + src + '})">' +
        '<span class="lvo-media">' + (photo ? '<img src="' + esc(photo) + '" alt="" loading="lazy" decoding="async" draggable="false">' : '<i class="fa-solid ' + (prod && prod.is_service ? "fa-hand-holding-heart" : "fa-box") + '"></i>') + '</span>' +
        '<span class="lvo-main">' +
          '<span class="lvo-l1"><strong>' + esc(title) + esc(qty) + '</strong><b>' + (typeof naira === "function" ? naira(o.total_amount) : "₦" + o.total_amount) + '</b></span>' +
          '<span class="lvo-l2"><i class="fa-solid ' + (isCustomerView ? "fa-store" : "fa-user") + '"></i> ' + esc(party) + '</span>' +
          '<span class="lvo-l3"><small>#' + esc(String(o.id || "").slice(0, 8).toUpperCase()) + (iso ? " · " + esc(shortDate(iso)) : "") + '</small><span class="lvo-st lvo-st-' + esc(cls) + '">' + esc(label) + '</span></span>' +
        '</span></button>';
    }).join("") + '</div>' + more;
  };
})();

/* ---- vendors map, tidied (lvm-): opens on a vendor (nearest first) with its card showing, a Google-Maps-style
   "my location" button, and a neat map-type sheet (picture previews + a switch for vendor names). ---- */
(function () {
  "use strict";
  var LOC_SVG = '<svg class="lvm-loc" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="2"/><circle class="lvm-loc-dot" cx="12" cy="12" r="3.4" fill="currentColor"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var LAYER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 8.2 12 13.4l9.5-5.2L12 3Z" fill="currentColor" opacity=".9"/><path d="m4.3 11.6-1.8 1L12 17.8l9.5-5.2-1.8-1L12 15.8l-7.7-4.2Z" fill="currentColor" opacity=".6"/><path d="m4.3 15.4-1.8 1L12 21.6l9.5-5.2-1.8-1L12 19.6l-7.7-4.2Z" fill="currentColor" opacity=".4"/></svg>';
  function swapIcons() {
    var loc = document.getElementById("vmpLocate");
    if (loc && !loc.querySelector(".lvm-loc")) loc.innerHTML = LOC_SVG;
    var lay = document.querySelector(".vmpage .vmp-fabs .vmp-fab");
    if (lay && !lay.querySelector("svg")) { lay.innerHTML = LAYER_SVG; lay.classList.add("lvm-layers"); }
    try { if (loc) loc.classList.toggle("on", !!(typeof buyerLocation !== "undefined" && buyerLocation)); } catch (_) {}
  }
  window.vmpDrawSheet = function () {
    var box = document.getElementById("vmpStyles"); if (!box) return;
    var styles = typeof VMP_STYLES !== "undefined" ? VMP_STYLES : {};
    var cur = typeof vmpStyle !== "undefined" ? vmpStyle : "streets";
    var names = typeof vmpDetails !== "undefined" && vmpDetails && vmpDetails.names;
    box.innerHTML = '<div class="vmp-sheet-back" onclick="vmpToggleStyles()"></div><div class="vmp-sheet lvm-sheet" role="dialog" aria-label="Map type">' +
      '<div class="lvm-grab" aria-hidden="true"></div>' +
      '<div class="vmp-sheet-head"><strong>Map type</strong><button type="button" aria-label="Close" onclick="vmpToggleStyles()"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="lvm-types">' + Object.keys(styles).map(function (k) {
        return '<button type="button" class="lvm-type' + (k === cur ? " on" : "") + '" onclick="vmpSetStyle(\'' + k + '\')" aria-pressed="' + (k === cur) + '"><span class="lvm-prev lvm-prev-' + k + '"><i class="lvm-road r1"></i><i class="lvm-road r2"></i><i class="lvm-road r3"></i><i class="lvm-pin"></i>' + (k === cur ? '<span class="lvm-check"><i class="fa-solid fa-check"></i></span>' : "") + '</span><small>' + esc(styles[k].label) + '</small></button>';
      }).join("") + '</div>' +
      '<div class="lvm-sec">Map details</div>' +
      '<button type="button" class="lvm-row" role="switch" aria-checked="' + !!names + '" onclick="vmpDetails.names=!vmpDetails.names;vmpDrawSheet();vmpDrawPins()"><span class="lvm-row-ico"><i class="fa-solid fa-tag"></i></span><span class="lvm-row-t"><strong>Vendor names</strong><small>Show every shop\'s name under its pin</small></span><span class="lvm-switch' + (names ? " on" : "") + '"><i></i></span></button>' +
    '</div>';
  };
  // open on a vendor: once the pins are drawn and nothing is picked yet, pick the nearest (or the first) and show its card
  function lockOn(tries) {
    try {
      if (typeof vmpMap === "undefined" || !vmpMap || !document.getElementById("vmpRail")) { if (tries < 40) setTimeout(function () { lockOn(tries + 1); }, 150); return; }
      if (vmpSelected) return;
      var list = typeof vmpRailList === "function" ? vmpRailList() : [];
      if (!list.length) { if (tries < 40) setTimeout(function () { lockOn(tries + 1); }, 150); return; }
      var asked = vmpAskedLoc; vmpAskedLoc = true;   // opening the map must not pop up a location request by itself
      vmpSelect(list[0].id, true, false, true);
      vmpAskedLoc = asked;
    } catch (_) {}
  }
  var origInit = window.initVendorsMapPage;
  if (typeof origInit === "function" && !origInit.__lvm) {
    var w = async function () {
      var out = await origInit.apply(this, arguments);
      swapIcons();
      if (!window.__lvmLocked) { window.__lvmLocked = true; setTimeout(function () { window.__lvmLocked = false; lockOn(0); }, 450); }
      return out;
    };
    w.__lvm = true; window.initVendorsMapPage = w;
  }
  // without the person's location there is no real distance: show the shop and a button to turn location on (not "~0 m")
  var origRouteCard = window.vmpRouteCardDraw;
  if (typeof origRouteCard === "function") window.vmpRouteCardDraw = function (v) {
    var hasLoc = false; try { hasLoc = !!(typeof buyerLocation !== "undefined" && buyerLocation) || !!vmpRouteInfo; } catch (_) {}
    if (!v || hasLoc) return origRouteCard.apply(this, arguments);
    var box = document.getElementById("vmpRouteCard"); if (!box) return;
    box.innerHTML = vmpCardHtml(v) + '<button type="button" class="lvm-dist" onclick="vmpLocate()"><span class="lvm-dist-ico">' + LOC_SVG + '</span><span><strong>See how far this shop is</strong><small>Turn on your location for distance and travel times</small></span><i class="fa-solid fa-chevron-right"></i></button>';
    box.classList.add("vmp-route-merged"); box.classList.remove("hidden");
    var ex = document.getElementById("vmpExpandedCard"); if (ex) ex.classList.add("hidden");
  };
  var origLocate = window.vmpLocate;
  if (typeof origLocate === "function") window.vmpLocate = async function () { var r = await origLocate.apply(this, arguments); swapIcons(); return r; };
  var lvmRaf = 0;
  new MutationObserver(function () { if (lvmRaf) return; lvmRaf = requestAnimationFrame(function () { lvmRaf = 0; if (document.getElementById("vmPage")) swapIcons(); }); }).observe(document.getElementById("app") || document.body, { childList: true, subtree: true });
})();

/* ===== Admin: Disputes page, tidied (adp-) =====
   Two tabs that matter (Open, Resolved) and a third only when there are payment checks. One clean card per dispute: who, why,
   the shop's reply, the money (paid / refunded, with a Refund button), and the outcome in one place. Choosing an outcome never
   undoes a refund that was already made. */
(function () {
  "use strict";
  function money(n) { try { return "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 }); } catch (_) { return "₦" + n; } }
  function ref(id) { return "#" + String(id || "").slice(0, 8).toUpperCase(); }
  function nice(s) { return String(s || "").replace(/_/g, " ").replace(/^./, function (c) { return c.toUpperCase(); }); }
  function when(t) { try { return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " + new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } }
  function paidOnline(o) {
    return (o.payments || []).filter(function (p) { return p.status === "paid" && /^lvm_ord_/.test(String(p.provider_reference || "")); }).reduce(function (s, p) { return s + Number(p.amount || 0); }, 0);
  }
  var claimOf = function (o) { return (o.payments || []).find(function (p) { return p.status === "pending" && ["buyer_report", "service_offer_report"].indexOf(String(p.provider_reference || "").toLowerCase()) >= 0; }); };
  window.lvAdpTab = function (t) {
    document.querySelectorAll(".adp-tab").forEach(function (b) { b.classList.toggle("on", b.dataset.t === t); b.setAttribute("aria-selected", String(b.dataset.t === t)); });
    document.querySelectorAll(".adp-panel").forEach(function (p) { p.classList.toggle("hidden", p.dataset.t !== t); });
  };
  window.lvAdpOutcome = function (id, v, btn) {
    var inp = document.getElementById("newstatus-" + id); if (inp) inp.value = v;
    var wrap = btn && btn.parentElement; if (wrap) wrap.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === btn); b.setAttribute("aria-checked", String(b === btn)); });
  };
  function card(d, refunded) {
    var o = d.order || {}, paid = paidOnline(o), back = refunded[o.id] || 0, claim = claimOf(o);
    var buyer = d.__buyer ? esc(d.__buyer) : "Buyer";
    var vResp = d.vendor_response ? '<p>' + esc(d.vendor_response) + '</p>' : '<p class="adp-muted">The shop has not replied yet.</p>';
    var ev = typeof disputeEvidenceHtml === "function" ? disputeEvidenceHtml(d.attachments) : "";
    return '<article class="adp-card">' +
      '<header class="adp-top"><div class="adp-who"><strong>' + esc((o.vendor && o.vendor.business_name) || "Shop") + '</strong><small>' + esc(nice(o.order_type || "order")) + ' · ' + esc(ref(o.id)) + (o.total_amount != null ? ' · ' + money(o.total_amount) : "") + '</small></div>' +
      '<span class="adp-pill">Raised by ' + esc(String(d.raised_by || "unknown")) + '</span></header>' +
      '<div class="adp-meta"><span><i class="fa-regular fa-user"></i> ' + buyer + '</span><span><i class="fa-regular fa-clock"></i> ' + esc(when(d.created_at)) + '</span></div>' +
      '<div class="adp-block"><label>Reason</label><p>' + esc(d.reason || "") + '</p>' + ev + '</div>' +
      '<div class="adp-block"><label>Shop\'s reply</label>' + vResp + '</div>' +
      (claim ? '<div class="adp-claim"><div><strong>Payment claim: ' + money(claim.amount) + '</strong><small>The buyer reported a direct transfer that is not verified yet.</small></div><div class="adp-row"><button class="btn btn-sm" onclick="adminConfirmReportedPayment(\'' + esc(o.id) + '\')">Verify</button><button class="btn btn-sm btn-danger" onclick="adminRejectReportedPayment(\'' + esc(o.id) + '\')">Reject</button></div></div>' : "") +
      (paid > 0 ? '<div class="adp-money"><div><small>Paid by buyer</small><b>' + money(paid) + '</b></div><div><small>Refunded</small><b class="' + (back ? "adp-red" : "") + '">' + money(back) + '</b></div><button type="button" class="btn btn-sm btn-outline" onclick="lvPayAct(\'refund\',\'' + esc(o.id) + '\')"><i class="fa-solid fa-rotate-left"></i> Refund</button></div>' : "") +
      '<div class="adp-links">' + (o.buyer_id && o.vendor_id ? '<button type="button" onclick="openDisputeChat(\'' + esc(o.buyer_id) + '\',\'' + esc(o.vendor_id) + '\')"><i class="fa-solid fa-comment-dots"></i> View chat</button>' : "") +
        '<button type="button" onclick="navigate(\'orderDetail\',{orderId:\'' + esc(o.id) + '\'})"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open order</button></div>' +
      '<div class="adp-resolve"><label for="notes-' + esc(d.id) + '">Resolution notes</label><textarea id="notes-' + esc(d.id) + '" rows="2" placeholder="What did you decide, and why?"></textarea>' +
        '<label>Order outcome</label><input type="hidden" id="newstatus-' + esc(d.id) + '" value="">' +
        '<div class="adp-outcomes" role="radiogroup" aria-label="Order outcome"><button type="button" role="radio" aria-checked="false" onclick="lvAdpOutcome(\'' + esc(d.id) + '\',\'completed\',this)"><i class="fa-solid fa-circle-check"></i> Completed</button><button type="button" role="radio" aria-checked="false" onclick="lvAdpOutcome(\'' + esc(d.id) + '\',\'cancelled\',this)"><i class="fa-solid fa-ban"></i> Cancelled</button></div>' +
        '<small class="adp-hint"><i class="fa-solid fa-circle-info"></i> A refund you already made stays, whichever outcome you pick. Refund separately with the button above.</small>' +
        '<button type="button" class="btn adp-go" onclick="resolveDispute(\'' + esc(d.id) + '\',\'' + esc(o.id) + '\',\'' + esc(o.payout_status) + '\')">Mark resolved</button></div>' +
    '</article>';
  }
  function doneCard(d, refunded) {
    var o = d.order || {}, back = refunded[o.id] || 0, st = String(o.status || "");
    return '<article class="adp-card adp-done"><header class="adp-top"><div class="adp-who"><strong>' + esc((o.vendor && o.vendor.business_name) || "Shop") + '</strong><small>' + esc(nice(o.order_type || "order")) + ' · ' + esc(ref(o.id)) + (o.total_amount != null ? ' · ' + money(o.total_amount) : "") + '</small></div>' +
      '<span class="adp-pill adp-st-' + esc(st) + '">' + esc(nice(st)) + '</span></header>' +
      '<div class="adp-block"><label>Reason</label><p>' + esc(d.reason || "") + '</p></div>' +
      (d.admin_notes ? '<div class="adp-block"><label>Your notes</label><p>' + esc(d.admin_notes) + '</p></div>' : "") +
      (back ? '<div class="adp-note"><i class="fa-solid fa-rotate-left"></i> ' + money(back) + ' was refunded to the buyer. This stays whatever the order status is.</div>' : "") +
      '<div class="adp-row adp-row-end"><button class="btn btn-sm btn-outline" onclick="adminReopenDispute(\'' + esc(d.id) + '\')"><i class="fa-solid fa-rotate-left"></i> Reopen</button>' +
      (st !== "completed" ? '<button class="btn btn-sm btn-outline" onclick="adminRemarkDispute(\'' + esc(d.id) + '\',\'' + esc(o.id || "") + '\',\'completed\',\'' + esc(o.payout_status || "") + '\')">Set completed</button>' : "") +
      (st !== "cancelled" ? '<button class="btn btn-sm btn-outline" onclick="adminRemarkDispute(\'' + esc(d.id) + '\',\'' + esc(o.id || "") + '\',\'cancelled\',\'' + esc(o.payout_status || "") + '\')">Set cancelled</button>' : "") + '</div></article>';
  }
  function checkCard(o, kind) {
    var claim = claimOf(o);
    return '<article class="adp-card"><header class="adp-top"><div class="adp-who"><strong>' + esc((o.vendor && o.vendor.business_name) || "Shop") + '</strong><small>' + esc(nice(o.order_type || "order")) + ' · ' + esc(ref(o.id)) + (o.total_amount != null ? ' · ' + money(o.total_amount) : "") + '</small></div><span class="adp-pill">' + (kind === "unresolved" ? "Payment unresolved" : "Confirmed, unpaid") + '</span></header>' +
      (claim ? '<div class="adp-block"><label>Reported payment</label><p>' + money(claim.amount) + ' — the buyer reported a direct transfer; the shop has not confirmed it.</p></div>' : '<p class="adp-muted">No pending payment claim is visible.</p>') +
      '<div class="adp-row">' + (kind === "unresolved" ? '<button class="btn btn-sm" ' + (claim ? "" : "disabled") + ' onclick="adminConfirmReportedPayment(\'' + esc(o.id) + '\')">Verify payment</button><button class="btn btn-sm btn-danger" ' + (claim ? "" : "disabled") + ' onclick="adminRejectReportedPayment(\'' + esc(o.id) + '\')">Reject claim</button>' : '<button class="btn btn-sm btn-danger" onclick="adminCancelConfirmedOverdue(\'' + esc(o.id) + '\')">Cancel order</button>') +
      '<button class="btn btn-sm btn-outline" onclick="navigate(\'orderDetail\',{orderId:\'' + esc(o.id) + '\'})">Open order</button></div></article>';
  }
  window.renderAdminDisputes = async function () {
    if (!session || profile?.role !== "admin") return '<div class="empty-state">Access denied.</div>';
    var pay = "id,payment_type,amount,status,provider_reference,created_at,paid_at";
    var res = await Promise.all([
      sb.from("disputes").select("*, order:orders(id, order_type, buyer_id, vendor_id, payout_status, status, payment_unresolved_at, payment_escalated_at, total_amount, status_changed_at, vendor:vendors(business_name), payments(" + pay + "))").eq("status", "open").order("created_at", { ascending: true }),
      sb.from("orders").select("id,order_type,buyer_id,vendor_id,status,payment_unresolved_at,payment_escalated_at,total_amount,vendor:vendors(business_name),payments(" + pay + ")").eq("status", "payment_unresolved").not("payment_escalated_at", "is", null).order("payment_escalated_at", { ascending: true }),
      sb.from("orders").select("id,order_type,buyer_id,vendor_id,status,total_amount,status_changed_at,payment_escalated_at,vendor:vendors(business_name),payments(" + pay + ")").eq("status", "confirmed").not("payment_escalated_at", "is", null).order("payment_escalated_at", { ascending: true }),
      sb.from("disputes").select("id,reason,admin_notes,created_at,order:orders(id,order_type,status,total_amount,payout_status,vendor:vendors(business_name))").eq("status", "resolved").order("created_at", { ascending: false }).limit(60)
    ]);
    var head = '<h2 class="adp-h"><i class="fa-solid fa-scale-balanced"></i> Disputes</h2>' + adminNavHtml("adminDisputes");
    if (res[0].error && res[1].error && res[2].error) return head + errorStateHtml(res[0].error);
    var open = res[0].data || [], resolved = res[3].data || [];
    var unresolved = (res[1].data || []).filter(function (o) { return !open.some(function (d) { return String((d.order && d.order.id) || d.order_id || "") === String(o.id); }); });
    var confirmed = (res[2].data || []).filter(function (o) { var fee = o.order_type === "rental" ? "rental_fee" : "sale_price"; return !(o.payments || []).some(function (p) { return String(p.payment_type || "").toLowerCase() === fee && p.status === "paid"; }); });
    var checks = unresolved.length + confirmed.length;
    // refunds made so far, and the buyers' names
    var ids = open.map(function (d) { return d.order && d.order.id; }).concat(resolved.map(function (d) { return d.order && d.order.id; })).filter(Boolean);
    var refunded = {};
    try { var rr = await sb.from("paystack_refunds").select("order_id,amount_kobo,status").in("order_id", ids).neq("status", "failed"); ((rr && rr.data) || []).forEach(function (r) { refunded[r.order_id] = (refunded[r.order_id] || 0) + Number(r.amount_kobo || 0) / 100; }); } catch (_) {}
    try {
      var bids = open.map(function (d) { return d.order && d.order.buyer_id; }).filter(Boolean);
      if (bids.length) { var ur = await sb.from("users").select("id,name").in("id", bids); var nm = {}; ((ur && ur.data) || []).forEach(function (u) { nm[u.id] = u.name; }); open.forEach(function (d) { d.__buyer = d.order && nm[d.order.buyer_id]; }); }
    } catch (_) {}
    var tab = "open";
    var tabs = '<div class="adp-tabs" role="tablist"><button role="tab" class="adp-tab on" data-t="open" aria-selected="true" onclick="lvAdpTab(\'open\')">Open' + (open.length ? '<i>' + open.length + '</i>' : "") + '</button><button role="tab" class="adp-tab" data-t="resolved" aria-selected="false" onclick="lvAdpTab(\'resolved\')">Resolved' + (resolved.length ? '<i class="ok">' + resolved.length + '</i>' : "") + '</button>' + (checks ? '<button role="tab" class="adp-tab" data-t="checks" aria-selected="false" onclick="lvAdpTab(\'checks\')">Payment checks<i>' + checks + '</i></button>' : "") + '</div>';
    var empty = function (t, ic) { return '<div class="adp-empty"><i class="fa-solid ' + ic + '"></i><strong>' + t + '</strong></div>'; };
    return head + '<div class="adp">' + tabs +
      '<section class="adp-panel" data-t="open">' + (open.length ? open.map(function (d) { return card(d, refunded); }).join("") : empty("No open disputes", "fa-circle-check")) + '</section>' +
      '<section class="adp-panel hidden" data-t="resolved">' + (resolved.length ? resolved.map(function (d) { return doneCard(d, refunded); }).join("") : empty("No resolved disputes yet", "fa-box-archive")) + '</section>' +
      (checks ? '<section class="adp-panel hidden" data-t="checks">' + unresolved.map(function (o) { return checkCard(o, "unresolved"); }).concat(confirmed.map(function (o) { return checkCard(o, "confirmed"); })).join("") + '</section>' : "") + '</div>';
  };
  // an outcome never undoes a refund: cancelling a paid order no longer refuses; the admin is reminded that a refund is its own step
  async function setOutcome(disputeId, orderId, status, notes, paidNote) {
    if (paidNote && status === "cancelled") {
      var ok = await showConfirmDialog("This order was paid online. Cancelling it does not refund the buyer by itself: use Refund on the dispute card for that. Any refund already made stays. Mark the order as cancelled?", { title: "Cancel the order", okLabel: "Mark cancelled", cancelLabel: "Go back", danger: true });
      if (!ok) return false;
    }
    var r = await sb.rpc("resolve_dispute", { p_dispute_id: disputeId, p_admin_notes: notes, p_new_order_status: status });
    if (r.error) { showToast(r.error.message || "Could not save the outcome.", "error"); return false; }
    return true;
  }
  window.resolveDispute = async function (id, orderId, payoutStatus) {
    var notes = (document.getElementById("notes-" + id).value || "").trim() || "Resolved.";
    var status = (document.getElementById("newstatus-" + id) || {}).value || "";
    if (!status) { showToast("Choose an outcome (Completed or Cancelled) before resolving.", "error"); return; }
    if (status === "completed" && payoutStatus === "held") {
      var res = await fetch("/api/order-payout-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release", orderId: orderId, accessToken: session.access_token }) });
      var json = await res.json().catch(function () { return {}; });
      if (!res.ok) { showToast(json.error || "Could not release payment.", "error"); return; }
      var e2 = await sb.rpc("resolve_dispute", { p_dispute_id: id, p_admin_notes: notes });
      if (e2.error) { showToast(e2.error.message, "error"); return; }
      showToast("Dispute resolved.", "success"); navigate("adminDisputes", {}, false); return;
    }
    if (await setOutcome(id, orderId, status, notes, payoutStatus === "held" || payoutStatus === "released")) { showToast("Dispute resolved.", "success"); navigate("adminDisputes", {}, false); }
  };
  window.adminRemarkDispute = async function (id, orderId, status, payoutStatus) {
    if (!(await showConfirmDialog("Set this order to " + status + "? A refund that was already made stays.", { title: "Change outcome", okLabel: "Yes, set " + status, cancelLabel: "Go back" }))) return;
    var r = await sb.rpc("resolve_dispute", { p_dispute_id: id, p_admin_notes: "Outcome changed by admin to " + status + ".", p_new_order_status: status });
    if (r.error) { showToast(r.error.message || "Could not change the outcome.", "error"); return; }
    showToast("Done.", "success"); navigate("adminDisputes", {}, false);
  };
})();

/* ===== My listings: the listing details pop-up, tidied (vld-) =====
   Name, status chips, three stat tiles (views, saved, sales), the facts as clean rows, then the actions. */
(function () {
  "use strict";
  function chip(t, cls) { return '<span class="vld-chip' + (cls ? " " + cls : "") + '">' + esc(t) + "</span>"; }
  function row(ic, k, v) { return '<div class="vld-row"><span class="vld-ic"><i class="fa-solid ' + ic + '"></i></span><span class="vld-k">' + k + '</span><b>' + v + "</b></div>"; }
  window.showVendorProductDetails = function (productId) {
    var d = (window.__vlDetailsRaw || {})[productId], old = (window.__vendorProductCardDetails || {})[productId];
    if (!d && !old) return;
    var modal = document.getElementById("vendorProductDetailsModal"); if (!modal) return;
    var p = d ? d.p : {}, body = document.getElementById("vendorProductDetailsBody");
    document.getElementById("vendorProductDetailsTitle").textContent = (d ? p.name : old.name) || "Listing";
    if (d) {
      var st = String(p.status || ""), kind = p.is_service ? "Service" : (String(p.listing_type || "sale").replace(/^./, function (c) { return c.toUpperCase(); }));
      var avail = p.is_service ? "" : (p.track_quantity === false ? "Always available" : (p.quantity_available + " of " + p.quantity_total + " available"));
      var chips = chip(kind) + (avail ? chip(avail) : "") + chip(st.replace(/^./, function (c) { return c.toUpperCase(); }), st === "active" ? "ok" : st === "paused" ? "warn" : "");
      var vr = Array.isArray(p.variants) && p.variants.length ? p.variants : null;
      var expiry = p.billing_model === "monthly" && p.billing_paid_until && typeof listingExpiryMarkup === "function" ? '<div class="vld-note">' + listingExpiryMarkup(p) + "</div>" : "";
      body.innerHTML = '<div class="vld">' +
        '<div class="vld-chips">' + chips + "</div>" +
        '<div class="vld-tiles"><div><i class="fa-solid fa-eye"></i><b>' + Number(p.view_count || 0).toLocaleString("en-NG") + '</b><small>Views</small></div><div><i class="fa-solid fa-heart"></i><b>' + Number(d.favCount || 0).toLocaleString("en-NG") + '</b><small>Saved</small></div><div><i class="fa-solid fa-sack-dollar"></i><b>' + naira(d.revenue || 0) + '</b><small>Sales</small></div></div>' +
        (vr ? row("fa-layer-group", "Varieties", vr.length + " · " + esc(vr.slice(0, 3).map(function (v) { return v.name; }).join(", ")) + (vr.length > 3 ? "…" : "")) : "") +
        (d.topRegion ? row("fa-map-location-dot", "Sells best in", '<a href="#" onclick="event.stopPropagation();showProductRegions(\'' + esc(p.id) + '\',\'' + esc(p.name).replace(/'/g, "\\'") + '\');return false;">' + esc(d.topRegion.city) + " (" + d.topRegion.order_count + ")</a>") : "") +
        expiry +
        (d.hasPendingOrder ? '<div class="vld-warn"><i class="fa-solid fa-circle-exclamation"></i> This listing has a pending order. It cannot be removed until that is cleared.</div>' : "") +
      "</div>";
    } else body.innerHTML = old.html;
    var viewBtn = document.getElementById("vendorProductDetailsViewBtn");
    if (viewBtn) viewBtn.onclick = function () { modal.classList.add("hidden"); navigate("productDetail", { productId: productId }); };
    modal.classList.add("vld-modal");
    modal.classList.remove("hidden");
  };
})();

/* ===== Every "Cancel" button is red =====
   Any button whose label starts with "Cancel" (Cancel, Cancel order, Cancel & refund…) gets the red look, so a person can tell at a
   glance which button backs out or cancels. "Cancelled" (a status) is not a button to press, so it is left alone. */
(function () {
  "use strict";
  var RE = /^cancel(?!led)\b/i;
  function label(b) { return String(b.textContent || "").replace(/\s+/g, " ").trim(); }
  function tag(root) {
    var list = (root.nodeType === 1 && root.matches && root.matches("button,.btn")) ? [root] : [];
    if (root.querySelectorAll) list = list.concat([].slice.call(root.querySelectorAll("button,.btn")));
    list.forEach(function (b) {
      if (b.__lvc === label(b)) return;
      b.__lvc = label(b);
      var on = RE.test(b.__lvc) && !b.closest(".order-status-pills-rail,.adp-outcomes,.segmented-tabs");
      b.classList.toggle("lv-cancel", on);
    });
  }
  var raf = 0, queue = [];
  new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      m.addedNodes.forEach(function (n) { if (n.nodeType === 1) queue.push(n); });
      if (m.type === "characterData" && m.target.parentElement) queue.push(m.target.parentElement);
    });
    if (!raf) raf = requestAnimationFrame(function () { raf = 0; var q = queue; queue = []; q.forEach(tag); });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  tag(document.body);
})();

/* ===== Admin: tap any payment, refund, payout or withdrawal to see everything about it (lvpd-) =====
   Who paid whom, how (card / bank transfer / USSD), the Paystack reference, and the money breakdown: what the buyer paid, the
   Paystack fee, Levromart's commission, the shop's share, refunds, and what was sent to the shop. Read-only. */
(function () {
  "use strict";
  function naira(n) { try { return "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 }); } catch (_) { return "₦" + n; } }
  function k(x) { return Number(x || 0) / 100; }
  function when(t) { try { return t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + ", " + new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"; } catch (_) { return "—"; } }
  function nice(s) { return String(s || "").replace(/_/g, " ").replace(/^./, function (c) { return c.toUpperCase(); }); }
  function ref(id) { return id ? "#" + String(id).slice(0, 8).toUpperCase() : "—"; }
  var CHANNEL = { card: "Card", bank: "Bank", bank_transfer: "Bank transfer", ussd: "USSD", mobile_money: "Mobile money", qr: "QR", eft: "EFT", apple_pay: "Apple Pay" };
  function kv(a, b, cls) { return '<div class="lvpd-kv' + (cls ? " " + cls : "") + '"><span>' + a + '</span><b>' + b + "</b></div>"; }
  function sec(t, body) { return body ? '<section class="lvpd-sec"><h4>' + t + "</h4>" + body + "</section>" : ""; }
  function person(role, name, extra) { return '<div class="lvpd-p"><span class="lvpd-pr">' + role + '</span><b>' + esc(name || "—") + "</b>" + (extra ? "<small>" + extra + "</small>" : "") + "</div>"; }
  function statusChip(s) { var st = String(s || ""); var good = /success|processed|paid|approved|sent/.test(st), bad = /fail|reject|reverse|abandon/.test(st); return '<span class="lvpd-chip ' + (good ? "ok" : bad ? "bad" : "wait") + '">' + esc(nice(st || "unknown")) + "</span>"; }
  async function ctx(orderId, vendorId) {
    var out = { order: null, buyer: null, shop: null, owner: null, pays: [], comm: [], payout: null, refunds: [], wd: null };
    var safe = function (p) { return Promise.resolve(p).then(function (r) { return r && r.data; }, function () { return null; }); };
    if (orderId) {
      var rs = await Promise.all([
        safe(sb.from("orders").select("id,status,order_type,total_amount,delivery_fee,created_at,completed_at,buyer_id,vendor_id,delivery_method").eq("id", orderId).maybeSingle()),
        safe(sb.from("payments").select("payment_type,amount,status,method,provider_reference,paid_at").eq("order_id", orderId)),
        safe(sb.from("commission_charges").select("amount,status,paid_at,created_at").eq("order_id", orderId)),
        safe(sb.from("vendor_payouts").select("id,amount_kobo,commission_kobo,status,hold_reason,last_error,withdrawal_id,paystack_transfer_code,updated_at,created_at").eq("order_id", orderId).maybeSingle()),
        safe(sb.from("paystack_refunds").select("id,amount_kobo,status,reason,created_at,transaction_reference").eq("order_id", orderId).order("created_at", { ascending: true }))
      ]);
      out.order = rs[0]; out.pays = rs[1] || []; out.comm = rs[2] || []; out.payout = rs[3]; out.refunds = rs[4] || [];
      if (out.order) { vendorId = vendorId || out.order.vendor_id; }
      if (out.order && out.order.buyer_id) out.buyer = await safe(sb.from("users").select("name,email,phone").eq("id", out.order.buyer_id).maybeSingle());
      if (out.payout && out.payout.withdrawal_id) out.wd = await safe(sb.from("withdrawal_requests").select("id,status,kind,amount_kobo,created_at,decided_at").eq("id", out.payout.withdrawal_id).maybeSingle());
    }
    if (vendorId) out.shop = await safe(sb.from("vendors").select("business_name,bank_name,account_name,user_id").eq("id", vendorId).maybeSingle());
    if (out.shop && out.shop.user_id) out.owner = await safe(sb.from("users").select("name,email,phone").eq("id", out.shop.user_id).maybeSingle());
    return out;
  }
  // the money, step by step, for one order: buyer paid → fee → commission → shop share → refunds → paid to the shop
  function breakdown(c, t) {
    var paidNet = c.pays.filter(function (p) { return p.status === "paid" && /^lvm_ord_/.test(String(p.provider_reference || "")); }).reduce(function (s, p) { return s + Number(p.amount || 0); }, 0);
    var gross = t && t.amount != null ? Number(t.amount) : paidNet, fee = Math.max(0, gross - paidNet);
    var comm = c.comm.filter(function (x) { return x.status !== "waived"; }).reduce(function (s, x) { return s + Number(x.amount || 0); }, 0);
    var rate = paidNet > 0 ? Math.round(comm / paidNet * 1000) / 10 : 0;
    var back = c.refunds.filter(function (r) { return r.status !== "failed" && r.status !== "abandoned"; }).reduce(function (s, r) { return s + k(r.amount_kobo); }, 0);
    var share = Math.max(0, paidNet - comm), net = Math.max(0, share - back);
    var h = kv("Buyer paid in total", naira(gross)) + (fee ? kv("Paystack fee (paid by the buyer)", naira(fee), "lvpd-dim") : "") + kv("Paid for the order", naira(paidNet)) +
      kv("Levromart commission" + (rate ? " (" + rate + "%)" : ""), "− " + naira(comm)) + kv("Shop's share", naira(share));
    if (back) h += kv("Refunded to the buyer", "− " + naira(back), "lvpd-red") + kv("Shop's share after refunds", naira(net), "lvpd-strong");
    else h += kv("Shop's share after refunds", naira(net), "lvpd-strong");
    var po = c.payout;
    if (po) {
      var sent = po.status === "success" || po.status === "paid_manually";
      h += kv("Sent to the shop", sent ? naira(k(po.amount_kobo)) : "Not yet (" + esc(nice(po.status === "on_hold" ? (po.hold_reason ? "waiting for withdrawal" : "on hold") : po.status)) + ")");
    }
    return h;
  }
  function timeline(c, t) {
    var ev = [];
    c.pays.filter(function (p) { return p.status === "paid"; }).forEach(function (p) { ev.push([p.paid_at, "Buyer paid " + naira(p.amount), "fa-arrow-down"]); });
    c.refunds.forEach(function (r) { ev.push([r.created_at, "Refund " + naira(k(r.amount_kobo)) + " · " + nice(r.status) + (r.reason ? " · " + esc(r.reason) : ""), "fa-rotate-left"]); });
    if (c.wd) ev.push([c.wd.created_at, "Shop asked to withdraw", "fa-hand-holding-dollar"]);
    if (c.payout && (c.payout.status === "success" || c.payout.status === "paid_manually")) ev.push([c.payout.updated_at, "Sent to the shop " + naira(k(c.payout.amount_kobo)), "fa-paper-plane"]);
    ev = ev.filter(function (x) { return x[0]; }).sort(function (a, b) { return new Date(a[0]) - new Date(b[0]); });
    return ev.length ? '<ul class="lvpd-tl">' + ev.map(function (x) { return '<li><i class="fa-solid ' + x[2] + '"></i><div><b>' + x[1] + "</b><small>" + esc(when(x[0])) + "</small></div></li>"; }).join("") + "</ul>" : "";
  }
  function open(title, sub, bodyHtml) {
    var old = document.getElementById("lvpdSheet"); if (old) old.remove();
    var m = document.createElement("div"); m.id = "lvpdSheet"; m.className = "lvw-sheet-wrap lvpd-wrap";
    m.innerHTML = '<div class="lvw-sheet lvpd" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="lvw-sheet-grab" aria-hidden="true"></div>' +
      '<div class="lvpd-head"><div><small>' + esc(sub || "") + '</small><h3>' + title + '</h3></div><button type="button" class="lvw-eye lvw-eye-dark" aria-label="Close" onclick="document.getElementById(\'lvpdSheet\').remove()"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="lvw-sheet-body lvpd-body">' + bodyHtml + "</div></div>";
    m.addEventListener("click", function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    return m;
  }
  var LOADING = '<p class="muted" style="text-align:center;padding:1.2rem 0"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</p>';
  var PURPOSE = { order_payment: "Order payment", order_balance: "Order balance payment", listing_fee: "Listing fee", commission: "Commission payment", monthly_fee: "Monthly listing fee" };
  async function showTx(t) {
    var title = naira(t.amount), what = PURPOSE[t.purpose] || nice(t.purpose || "payment");
    var m = open(title, what, LOADING);
    var c = await ctx(t.order_id, t.vendor_id), body = m.querySelector(".lvpd-body"); if (!body) return;
    var shopName = (c.shop && c.shop.business_name) || t.business_name || "Shop";
    var from = c.buyer ? person("From (buyer)", c.buyer.name || c.buyer.email, esc([c.buyer.email, c.buyer.phone].filter(Boolean).join(" · "))) : person("From", t.order_id ? "Buyer" : shopName);
    var to = person("To (shop)", shopName, c.owner ? esc([c.owner.name, c.owner.phone].filter(Boolean).join(" · ")) : "");
    var isOrder = /^order/.test(String(t.purpose || "")) && c.order;
    body.innerHTML = '<div class="lvpd-top">' + statusChip(t.status) + '<span class="lvpd-meth"><i class="fa-solid fa-credit-card"></i> ' + esc(CHANNEL[String(t.channel || "").toLowerCase()] || nice(t.channel || "Not recorded")) + "</span></div>" +
      '<div class="lvpd-who">' + from + '<i class="fa-solid fa-arrow-right"></i>' + to + "</div>" +
      sec("Money breakdown", isOrder ? breakdown(c, t) : kv("Amount", naira(t.amount))) +
      sec("Payment", kv("Method", esc(CHANNEL[String(t.channel || "").toLowerCase()] || nice(t.channel || "Not recorded"))) + kv("Paid at", esc(when(t.paid_at || t.created_at))) + kv("Paystack reference", '<code>' + esc(t.reference || "—") + "</code>") + (t.order_id ? kv("Order", esc(ref(t.order_id)) + (c.order ? " · " + esc(nice(c.order.status)) : "")) : "")) +
      sec("What happened", timeline(c, t)) +
      (t.order_id ? '<button type="button" class="btn btn-outline lvpd-open" onclick="document.getElementById(\'lvpdSheet\').remove();navigate(\'orderDetail\',{orderId:\'' + esc(t.order_id) + '\'})">Open the order</button>' : "");
  }
  async function showRefund(r) {
    var m = open(naira(r.amount), "Refund", LOADING);
    var c = await ctx(r.order_id, null), body = m.querySelector(".lvpd-body"); if (!body) return;
    var credit = null; try { credit = (await sb.from("refund_credits").select("status,amount_kobo,created_at").eq("refund_id", r.id).maybeSingle()).data; } catch (_) {}
    var shopName = (c.shop && c.shop.business_name) || "Shop";
    var dest = credit ? "Buyer's Levromart refunds wallet" + (credit.status === "available" ? " (waiting to be withdrawn)" : credit.status === "processing" ? " (being sent to their bank)" : " (withdrawn to their bank)") : /processed|processing|success/.test(r.status) ? "Back to the buyer's card (through Paystack)" : "Not sent yet";
    body.innerHTML = '<div class="lvpd-top">' + statusChip(r.status) + '<span class="lvpd-meth"><i class="fa-solid fa-rotate-left"></i> Refund</span></div>' +
      '<div class="lvpd-who">' + person("From", shopName + "'s share", "Taken off the shop's wallet") + '<i class="fa-solid fa-arrow-right"></i>' + (c.buyer ? person("To (buyer)", c.buyer.name || c.buyer.email, esc([c.buyer.email, c.buyer.phone].filter(Boolean).join(" · "))) : person("To", "Buyer")) + "</div>" +
      sec("Refund", kv("Amount", naira(r.amount)) + kv("Went to", esc(dest)) + kv("Reason", esc(r.reason || "—")) + kv("Asked by", esc(nice(r.source || "admin"))) + kv("Date", esc(when(r.created_at))) + (r.last_error ? kv("Note", esc(r.last_error), "lvpd-red") : "") + kv("Original payment", "<code>" + esc(r.transaction_reference || "—") + "</code>")) +
      (c.order ? sec("The order's money", breakdown(c, null)) : "") +
      '<button type="button" class="btn btn-outline lvpd-open" onclick="document.getElementById(\'lvpdSheet\').remove();navigate(\'orderDetail\',{orderId:\'' + esc(r.order_id) + '\'})">Open the order</button>';
  }
  async function showPayout(p) {
    var m = open(naira(p.amount), "Payout to a shop", LOADING);
    var c = await ctx(p.order_id, p.vendor_id), body = m.querySelector(".lvpd-body"); if (!body) return;
    body.innerHTML = '<div class="lvpd-top">' + statusChip(p.status) + '<span class="lvpd-meth"><i class="fa-solid fa-building-columns"></i> Bank transfer</span></div>' +
      '<div class="lvpd-who">' + person("From", "Levromart", "Paystack balance") + '<i class="fa-solid fa-arrow-right"></i>' + person("To (shop)", (c.shop && c.shop.business_name) || p.business_name, c.shop ? esc([c.shop.account_name, c.shop.bank_name].filter(Boolean).join(" · ")) : "") + "</div>" +
      sec("Payout", kv("Amount sent", naira(p.amount)) + kv("Commission taken", naira(p.commission)) + kv("Status", esc(nice(p.status))) + (p.hold_reason ? kv("Why on hold", esc(p.hold_reason)) : "") + (p.last_error ? kv("Last problem", esc(p.last_error), "lvpd-red") : "") + kv("Updated", esc(when(p.updated_at)))) +
      (c.order ? sec("The order's money", breakdown(c, null)) : "") + sec("What happened", timeline(c, null)) +
      '<button type="button" class="btn btn-outline lvpd-open" onclick="document.getElementById(\'lvpdSheet\').remove();navigate(\'orderDetail\',{orderId:\'' + esc(p.order_id) + '\'})">Open the order</button>';
  }
  async function showWd(w) {
    var m = open(naira(Number(w.amount_kobo) / 100), "Withdrawal request", LOADING);
    var c = await ctx(null, w.vendor_id), body = m.querySelector(".lvpd-body"); if (!body) return;
    body.innerHTML = '<div class="lvpd-top">' + statusChip(w.status) + '<span class="lvpd-meth"><i class="fa-solid fa-hand-holding-dollar"></i> ' + (w.kind === "instant" ? "Sent at once" : "Needed approval") + "</span></div>" +
      '<div class="lvpd-who">' + person("From", "Levromart", "Paystack balance") + '<i class="fa-solid fa-arrow-right"></i>' + person("To (shop)", w.business_name || (c.shop && c.shop.business_name), esc([w.account_name, w.bank_name].filter(Boolean).join(" · "))) + "</div>" +
      sec("Request", kv("Amount", naira(Number(w.amount_kobo) / 100)) + kv("Orders covered", String((w.order_ids || []).length)) + kv("Asked", esc(when(w.created_at))) + (w.decided_at ? kv("Decided", esc(when(w.decided_at))) : "") + (w.reject_reason ? kv("Reason given", esc(w.reject_reason)) : "") + (w.has_dispute ? kv("Dispute", "Has a disputed order", "lvpd-red") : "") + (w.account_changed_at ? kv("Bank account", "Changed " + esc(when(w.account_changed_at)), "lvpd-red") : ""));
  }
  var BUILD = { tx: showTx, refund: showRefund, payout: showPayout, wd: showWd };
  window.lvPayDetail = function (key) { var kind = String(key).split(":")[0], row = (window.__lvPayReg || {})[key]; if (row && BUILD[kind]) BUILD[kind](row); };
  document.addEventListener("click", function (e) {
    var row = e.target.closest && e.target.closest(".lv-tap[data-lvd]"); if (!row) return;
    if (e.target.closest("button,a,.btn,select,input,textarea,label")) return;
    window.lvPayDetail(row.getAttribute("data-lvd"));
  });
})();

/* ===== The Levromart wallet (one wallet for everyone; migration 0033) =====
   Balance top left, Add money top right, Transfer and Withdraw underneath, a slim history line at the bottom. Shops also see
   their earnings and move them in. Until the server has the wallet switched on, the older wallet cards keep showing. */
(function () {
  "use strict";
  var W = { data: null, at: 0, loading: null, off: false, hide: false };
  try { W.hide = localStorage.getItem("lv-w3-hide") === "1"; } catch (_) {}
  function k2n(k) { return Number(k || 0) / 100; }
  function money(k, plain) { if (W.hide && !plain) return "₦ ••••"; try { return "₦" + k2n(k).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (_) { return "₦" + k2n(k); } }
  function short(k) { try { return "₦" + k2n(k).toLocaleString("en-NG", { maximumFractionDigits: 2 }); } catch (_) { return "₦" + k2n(k); } }
  function signedIn() { return typeof session !== "undefined" && session && typeof profile !== "undefined" && profile && profile.role !== "admin"; }
  function key() { try { return crypto.randomUUID(); } catch (_) { return String(Date.now()) + Math.random().toString(16).slice(2); } }
  async function load(force) {
    if (!signedIn() || W.off) return null;
    if (!force && W.data && Date.now() - W.at < 20000) return W.data;
    if (W.loading) return W.loading;
    W.loading = (async function () {
      try {
        var r = await sb.rpc("get_levro_wallet");
        if (r.error || !r.data) { if (r.error && /set up|not ready|being set|unknown|not found|404|503/i.test(String(r.error.message || r.error.code || ""))) W.off = true; return W.data; }
        W.data = r.data; W.at = Date.now(); return W.data;
      } catch (_) { return W.data; }
    })().finally(function () { W.loading = null; });
    return W.loading;
  }
  function repaint() { try { if (window.lvWalletRepaint) window.lvWalletRepaint(); } catch (_) {} try { if (window.lvRefundRepaint) window.lvRefundRepaint(); } catch (_) {} }
  window.lvW3Refresh = function () { return load(true).then(repaint); };
  window.lvW3Eye = function () { W.hide = !W.hide; try { localStorage.setItem("lv-w3-hide", W.hide ? "1" : "0"); } catch (_) {} repaint(); };

  var KIND = {
    topup: ["Money added", "fa-plus", "in"], transfer_in: ["Received", "fa-arrow-down", "in"], transfer_out: ["Sent", "fa-arrow-up", "out"],
    order_payment: ["Order payment", "fa-bag-shopping", "pay"], refund_in: ["Refund", "fa-rotate-left", "in"], refund_out: ["Refunded to a buyer", "fa-rotate-right", "out"],
    earnings_in: ["Shop earnings", "fa-store", "in"], withdrawal: ["Withdrawal", "fa-building-columns", "bank"], withdrawal_return: ["Returned to wallet", "fa-reply", "in"]
  };
  function entryTitle(e) {
    var k = KIND[e.kind] || ["Wallet", "fa-wallet", "in"];
    if (e.kind === "transfer_in") return "From " + (e.counterparty_handle ? "@" + e.counterparty_handle : e.counterparty_name || "someone");
    if (e.kind === "transfer_out") return "To " + (e.counterparty_handle ? "@" + e.counterparty_handle : e.counterparty_name || "someone");
    if (e.kind === "order_payment" && e.note) return e.note;
    return k[0];
  }

  // the card; `kind` is "shop" (shop orders / dashboard) or "me" (everywhere else). `shop` is the shop's earnings (older card data).
  window.lvWalletCardHtml = function (kind, shop) {
    var d = W.data; if (!d || W.off) { load(false).then(function (x) { if (x) repaint(); }); return null; }
    var last = (d.entries || [])[0];
    var pendingWd = (d.withdrawals || []).filter(function (w) { return w.status === "requested"; });
    var earn = kind === "shop" && shop ? Number(shop.ready || 0) * 100 : 0, earnPending = kind === "shop" && shop ? Number(shop.pending || 0) * 100 : 0;
    var notes = "";
    if (d.frozen) notes += '<div class="lvw-note"><i class="fa-solid fa-lock"></i> <span>Your wallet is on hold' + (d.frozen_reason ? ": " + esc(d.frozen_reason) : "") + '. Contact support.</span></div>';
    if (pendingWd.length) notes += '<div class="lvw-note"><i class="fa-solid fa-hourglass-half"></i> <span><b>' + money(pendingWd.reduce(function (s, w) { return s + Number(w.amount_kobo); }, 0)) + '</b> withdrawal waiting for Levromart\'s check</span></div>';
    if (kind === "shop" && shop && shop.delayed > 0) notes += '<div class="lvw-note"><i class="fa-solid fa-calendar-day"></i> <span><b>' + money(shop.delayed * 100) + '</b> arrives in your bank next business day.</span></div>';
    return '<div class="lvw-card lvw2 lvw3">' +
      '<div class="lw-top"><div class="lw-col">' +
        '<div class="lw-label">Available balance <button type="button" class="lw-ic" onclick="lvW3Eye()" aria-label="' + (W.hide ? "Show balance" : "Hide balance") + '"><i class="fa-regular ' + (W.hide ? "fa-eye-slash" : "fa-eye") + '"></i></button><button type="button" class="lw-ic" onclick="lvW3Help()" aria-label="How your wallet works"><i class="fa-solid fa-circle-question"></i></button></div>' +
        '<div class="lw-balrow"><div class="lw-bal">' + money(d.balance_kobo) + '</div>' +
        '<button type="button" class="lw-tag" onclick="lvW3CopyTag()" aria-label="Copy your @tag">@' + esc(d.handle) + ' <i class="fa-regular fa-copy"></i></button></div>' +
      '</div><button type="button" class="lw-add" onclick="lvW3Add()"><i class="fa-solid fa-plus"></i> Add money</button></div>' +
      (kind === "shop" && shop ? '<div class="lw-earn"><div><b><small>Shop earnings</small> ' + money(earn) + ' ready</b>' + (earnPending ? '<small>' + money(earnPending) + ' waiting for buyers to confirm</small>' : "") + '</div><button type="button" onclick="lvW3MoveEarnings()"' + (earn > 0 ? "" : " disabled") + '>Move to wallet</button></div>' : "") +
      notes +
      '<div class="lw-acts lw-acts2"><button type="button" onclick="lvW3Send()"><i class="fa-solid fa-paper-plane"></i>Transfer</button><button type="button" onclick="lvW3Withdraw()"><i class="fa-solid fa-building-columns"></i>Withdraw</button></div>' +
      '<button type="button" class="lvw-strip" onclick="lvW3History()"><i class="fa-solid fa-clock-rotate-left lvw-strip-ic"></i><span class="lvw-strip-t">Transaction history</span>' +
        (last ? '<span class="lvw-strip-last"><span class="lvw-strip-nm">' + esc(entryTitle(last)) + '</span><b>' + (Number(last.amount_kobo) > 0 ? "+" : "−") + short(Math.abs(Number(last.amount_kobo))) + '</b></span>' : "") +
        '<i class="fa-solid fa-chevron-right lvw-strip-go"></i></button>' +
    '</div>';
  };

  /* ---------------------------------------------------------------- sheets */
  function sheet(title, body, cls) {
    var old = document.getElementById("lvW3Sheet"); if (old) old.remove();
    var m = document.createElement("div");
    m.id = "lvW3Sheet"; m.className = "lvw-sheet-wrap lw-wrap" + (cls ? " " + cls : "");
    m.innerHTML = '<div class="lvw-sheet lw-sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="lvw-sheet-grab" aria-hidden="true"></div><div class="lvw-sheet-head"><h3>' + esc(title) + '</h3><button type="button" class="lvw-eye lvw-eye-dark" onclick="document.getElementById(\'lvW3Sheet\').remove()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><div class="lvw-sheet-body">' + body + "</div></div>";
    m.addEventListener("click", function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    return m;
  }
  function closeSheet() { var m = document.getElementById("lvW3Sheet"); if (m) m.remove(); }
  function amountField(id, val) { return '<div class="lw-amt"><span>₦</span><input id="' + id + '" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + (val || "") + '"></div>'; }
  function readAmount(id) { var v = Number(String((document.getElementById(id) || {}).value || "").replace(/[,\s₦]/g, "")); return v > 0 ? Math.round(v * 100) : 0; }
  function err(m, text) { var e = m.querySelector(".lw-err"); if (e) { e.textContent = text || ""; e.hidden = !text; } }

  window.lvW3CopyTag = function () {
    var t = W.data ? "@" + W.data.handle : ""; if (!t) return;
    try { navigator.clipboard.writeText(t).then(function () { showToast("Copied " + t + ". People send you money with it.", "success"); }); } catch (_) { showToast(t, "info"); }
  };

  window.lvW3Add = async function () {
    var d = await load(false); if (!d) return showToast("Your wallet is not available right now.", "error");
    var m = sheet("Add money", '<p class="lw-hint">Add money with your card, bank transfer or USSD through Paystack. Paystack\'s small fee is added on top.</p>' + amountField("lwAddAmt") +
      '<div class="lw-chips">' + [500, 1000, 2000, 5000, 10000].map(function (n) { return '<button type="button" data-n="' + n + '">₦' + n.toLocaleString("en-NG") + "</button>"; }).join("") + "</div>" +
      '<p class="lw-err" hidden></p><button type="button" class="btn lw-go" id="lwAddGo">Continue</button>');
    m.addEventListener("click", function (e) { var c = e.target.closest("[data-n]"); if (c) { document.getElementById("lwAddAmt").value = c.dataset.n; } });
    m.querySelector("#lwAddGo").onclick = async function () {
      var amt = readAmount("lwAddAmt"), b = this;
      if (amt < 10000) return err(m, "The smallest amount is ₦100.");
      b.disabled = true; b.textContent = "Opening Paystack…";
      var r = await sb.rpc("wallet_topup", { p_amount_kobo: amt });
      if (r.error || !r.data) { b.disabled = false; b.textContent = "Continue"; return err(m, (r.error && r.error.message) || "Could not start. Please try again."); }
      var info = r.data;
      closeSheet();
      try {
        if (window.PaystackPop || (await new Promise(function (res) { var s = document.createElement("script"); s.src = "https://js.paystack.co/v2/inline.js"; s.onload = function () { res(true); }; s.onerror = function () { res(false); }; document.head.appendChild(s); }))) {
          new window.PaystackPop().resumeTransaction(info.accessCode, {
            onSuccess: function () { confirmTopup(info.reference); },
            onCancel: function () { showToast("Cancelled. Nothing was charged.", "info"); },
            onError: function () { showToast("The payment could not be completed. Please try again.", "error"); }
          });
          return;
        }
      } catch (_) {}
      location.href = info.authorizationUrl;
    };
  };
  async function confirmTopup(reference) {
    showToast("Confirming your top-up…", "info");
    for (var i = 0; i < 12; i++) {
      try { var r = await window.levroData.payments.status(reference); if (r && r.data && r.data.status === "success") break; } catch (_) {}
      await new Promise(function (res) { setTimeout(res, i < 3 ? 1500 : 4000); });
    }
    await load(true); repaint();
    showToast("Your wallet balance is updated.", "success");
  }
  // coming back from Paystack's page after a top-up
  try {
    var qs = new URLSearchParams(location.search);
    if (qs.get("wallet") === "1" && qs.get("reference")) { var ref0 = qs.get("reference"); history.replaceState(null, "", location.pathname); setTimeout(function () { confirmTopup(ref0); }, 1500); }
  } catch (_) {}

  window.lvW3Send = async function (prefill) {
    var d = await load(true); if (!d) return showToast("Your wallet is not available right now.", "error");
    var pick = null, myKey = key(), timer = 0;
    var m = sheet("Transfer", '<label class="lw-l">To</label><div class="lw-to"><span>@</span><input id="lwTo" autocomplete="off" autocapitalize="off" placeholder="their tag" value="' + esc(prefill || "") + '"></div><div class="lw-sugg" id="lwSugg"></div>' +
      '<label class="lw-l">Amount</label>' + amountField("lwSendAmt") + '<p class="lw-hint">Balance ' + money(d.balance_kobo, true) + "</p>" +
      '<label class="lw-l">Note (optional)</label><input id="lwNote" class="lw-in" maxlength="140" placeholder="What is it for?">' +
      '<p class="lw-err" hidden></p><button type="button" class="btn lw-go" id="lwSendGo">Continue</button>');
    var to = m.querySelector("#lwTo"), sugg = m.querySelector("#lwSugg");
    function paintPick() { sugg.innerHTML = pick ? '<div class="lw-person on">' + (pick.avatar_url ? '<img src="' + esc(pick.avatar_url) + '" alt="">' : '<span>' + esc(String(pick.name || pick.handle).slice(0, 1).toUpperCase()) + "</span>") + '<div><b>' + esc(pick.name || "") + '</b><small>@' + esc(pick.handle) + '</small></div><i class="fa-solid fa-circle-check"></i></div>' : ""; }
    async function search() {
      var q = to.value.trim().replace(/^@/, "").toLowerCase(); pick = null;
      if (q.length < 2) { sugg.innerHTML = ""; return; }
      var r = await sb.rpc("find_wallet_people", { p_query: q });
      var list = (r && r.data) || [];
      var exact = list.find(function (p) { return p.handle === q; }); if (exact && list.length === 1) { pick = exact; paintPick(); return; }
      sugg.innerHTML = list.length ? list.map(function (p, i) { return '<button type="button" class="lw-person" data-i="' + i + '">' + (p.avatar_url ? '<img src="' + esc(p.avatar_url) + '" alt="">' : '<span>' + esc(String(p.name || p.handle).slice(0, 1).toUpperCase()) + "</span>") + '<div><b>' + esc(p.name || "") + '</b><small>@' + esc(p.handle) + "</small></div></button>"; }).join("") : '<p class="lw-hint">Nobody has that @tag yet.</p>';
      sugg.__list = list;
    }
    to.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(search, 250); });
    sugg.addEventListener("click", function (e) { var b = e.target.closest("[data-i]"); if (!b) return; pick = sugg.__list[+b.dataset.i]; to.value = pick.handle; paintPick(); });
    if (prefill) search();
    m.querySelector("#lwSendGo").onclick = async function () {
      var amt = readAmount("lwSendAmt"), note = m.querySelector("#lwNote").value.trim();
      if (!pick) return err(m, "Choose who to send to from the list.");
      if (amt < 5000) return err(m, "The smallest amount is ₦50.");
      if (amt > Number(d.balance_kobo)) return err(m, "You only have " + money(d.balance_kobo, true) + ". Add money first.");
      err(m, "");
      var ok = await showConfirmDialog("Send " + short(amt) + " to " + (pick.name || "") + " (@" + pick.handle + ")? Transfers cannot be undone.", { title: "Confirm transfer", okLabel: "Send " + short(amt), cancelLabel: "Go back" });
      if (!ok) return;
      var b = this; b.disabled = true; b.textContent = "Sending…";
      var r = await sb.rpc("wallet_send", { p_to: pick.handle, p_amount_kobo: amt, p_note: note || null, p_key: myKey });
      if (r.error) { b.disabled = false; b.textContent = "Continue"; return err(m, r.error.message || "Could not send."); }
      await load(true); repaint();
      m.querySelector(".lvw-sheet-body").innerHTML = '<div class="lw-done"><span><i class="fa-solid fa-check"></i></span><b>' + short(amt) + ' sent</b><p>to ' + esc(pick.name || "") + ' (@' + esc(pick.handle) + ')</p><button type="button" class="btn lw-go" onclick="document.getElementById(\'lvW3Sheet\').remove()">Done</button></div>';
    };
  };

  window.lvW3Withdraw = async function () {
    var d = await load(true); if (!d) return showToast("Your wallet is not available right now.", "error");
    if (!d.account) {
      var add = await showConfirmDialog("Add the bank account your money should go to. It must be in your own name.", { title: "Add your bank account", okLabel: "Add bank account", cancelLabel: "Not now" });
      if (add) { if (typeof vendor !== "undefined" && vendor && window.lvGoToPayout) window.lvGoToPayout(); else if (window.lvRefundAccount) window.lvRefundAccount(); }
      return;
    }
    var a = d.account, fresh = Math.max(0, Number(d.balance_kobo) - Number(d.withdrawable_now_kobo));
    var m = sheet("Withdraw", '<div class="lw-bank"><span><i class="fa-solid fa-building-columns"></i></span><div><b>' + esc(a.bank_name || "Your bank") + ' ···' + esc(a.last4 || "") + '</b><small>' + esc(a.account_name || "") + "</small></div></div>" +
      '<label class="lw-l">Amount</label>' + amountField("lwWdAmt", k2n(d.balance_kobo)) + '<p class="lw-hint">Balance ' + money(d.balance_kobo, true) + (fresh > 0 ? " · " + money(fresh, true) + " arrived in the last 24 hours and is checked by Levromart before it goes to a bank" : "") + "</p>" +
      (a.changed_hours_ago < 24 ? '<p class="lw-warn"><i class="fa-solid fa-shield-halved"></i> Your bank account was added or changed less than 24 hours ago. For your safety you can withdraw ' + Math.max(1, 24 - a.changed_hours_ago) + ' hour(s) from now.</p>' : "") +
      '<p class="lw-err" hidden></p><button type="button" class="btn lw-go" id="lwWdGo"' + (a.changed_hours_ago < 24 ? " disabled" : "") + '>Withdraw</button>');
    m.querySelector("#lwWdGo").onclick = async function () {
      var amt = readAmount("lwWdAmt");
      if (amt < 10000) return err(m, "The smallest withdrawal is ₦100.");
      if (amt > Number(d.balance_kobo)) return err(m, "You have " + money(d.balance_kobo, true) + ".");
      var b = this; b.disabled = true; b.textContent = "Please wait…";
      var r = await sb.rpc("wallet_withdraw", { p_amount_kobo: amt });
      if (r.error) { b.disabled = false; b.textContent = "Withdraw"; return err(m, r.error.message || "Could not withdraw."); }
      closeSheet(); await load(true); repaint();
      if (r.data && r.data.status === "requested") showToast(short(amt) + " is waiting for Levromart's check (" + (r.data.review_reason || "security check") + "). You will get a message.", "info");
      else showToast(short(amt) + " is on its way to your bank.", "success");
    };
  };

  window.lvW3MoveEarnings = async function () {
    var r0 = await sb.rpc("get_withdrawal_summary"); var s = (r0 && r0.data) || {};
    var now = Number(s.to_wallet_now_kobo || 0), later = Number(s.to_wallet_approval_kobo || 0);
    if (!now && !later) return showToast("There are no earnings ready to move yet.", "info");
    var ok = await showConfirmDialog((now ? short(now) + " (paid 24 hours ago or more) moves into your wallet now." : "") + (later ? (now ? " " : "") + short(later) + " was paid less than 24 hours ago, so Levromart checks it first." : ""), { title: "Move earnings to your wallet", okLabel: "Move", cancelLabel: "Go back" });
    if (!ok) return;
    var r = await sb.rpc("request_withdrawal", { p_destination: "wallet" });
    if (r.error) return showToast(r.error.message || "Could not move your earnings.", "error");
    showToast(Number(r.data.sent_kobo) > 0 ? short(r.data.sent_kobo) + " is now in your wallet." : "Request sent. We will message you when it is approved.", "success");
    await load(true); repaint(); try { if (window.lvWalletReload) window.lvWalletReload(); } catch (_) {}
  };

  window.lvW3Help = function () {
    var shop = typeof vendor !== "undefined" && vendor;
    sheet("How your wallet works", '<ul class="lvw-how">' +
      '<li><b>One wallet.</b> Money you add, money people send you, refunds' + (shop ? " and your shop earnings" : "") + ' all land here. Your @tag is how people send you money.</li>' +
      '<li><b>Add money.</b> With your card, bank transfer or USSD through Paystack. Paystack\'s small fee is added on top.</li>' +
      '<li><b>Pay for orders.</b> Choose "Levromart wallet" when you pay: no Paystack fee, and the shop gets the order money the usual way.</li>' +
      '<li><b>Transfer.</b> Send money to anyone by their @tag. Check the name before you send: transfers cannot be undone.</li>' +
      (shop ? '<li><b>Shop earnings.</b> When a buyer confirms an order, your share (the sale minus Levromart\'s 3% commission) is ready. Money paid 24 hours ago or more moves into your wallet at once; newer money is checked by Levromart first. If a buyer is refunded, it comes out of your share.</li>' : '<li><b>Refunds.</b> If an order is cancelled or a problem is settled in your favour, the refund comes into your wallet. It is paid out of the shop\'s share.</li>') +
      '<li><b>Withdraw.</b> To your own bank account. For your safety: nothing can be withdrawn for 24 hours after you add or change your bank account, and the first withdrawal to a new account is checked by Levromart. This stops anyone who gets into your account from sending your money to their own bank. Money added or received in the last 24 hours is also checked before it goes to a bank.</li>' +
      '</ul>' + (typeof window.lvWalletColoursHtml === "function" ? window.lvWalletColoursHtml() : ""));
  };

  // the full history: grouped by day, a new-bank header when withdrawals start going to a different account
  window.lvW3History = async function () {
    var m = sheet("Transaction history", '<p class="muted" style="text-align:center">Loading…</p>', "lw-tall");
    var r = await sb.rpc("get_levro_wallet_history", {});
    var body = m.querySelector(".lvw-sheet-body"); if (!body) return;
    var rows = (r && r.data) || [];
    if (!rows.length) { body.innerHTML = '<div class="lvw-empty"><i class="fa-solid fa-receipt"></i><strong>No transactions yet</strong><span>Money you add, send, receive or spend shows here.</span></div>'; return; }
    var banks = rows.filter(function (e) { return e.kind === "withdrawal" && e.bank_name; }).slice().reverse(), firstBank = banks.length ? banks[0].bank_name + banks[0].account_last4 : null;
    var h = "", day = "", seenBank = firstBank;
    rows.slice().reverse().forEach(function (e) { if (e.kind === "withdrawal" && e.bank_name) { var b = e.bank_name + e.account_last4; if (b !== seenBank) { e.__newBank = true; seenBank = b; } } });
    rows.forEach(function (e) {
      var dt = new Date(e.created_at), label = dt.toDateString() === new Date().toDateString() ? "Today" : dt.toDateString() === new Date(Date.now() - 864e5).toDateString() ? "Yesterday" : dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      if (label !== day) { h += (day ? "</ul>" : "") + '<div class="lw-day">' + label + '</div><ul class="lw-list">'; day = label; }
      if (e.__newBank) h += '<li class="lw-bankhead"><i class="fa-solid fa-building-columns"></i> New payout bank: <b>' + esc(e.bank_name) + " ···" + esc(e.account_last4 || "") + "</b></li>";
      var k = KIND[e.kind] || ["Wallet", "fa-wallet", "in"], amt = Number(e.amount_kobo), st = e.kind === "withdrawal" ? e.withdrawal_status : "";
      var cls = st === "requested" || st === "processing" ? "wait" : k[2];
      h += '<li><span class="lw-ico ' + cls + '"><i class="fa-solid ' + k[1] + '"></i></span><div class="lw-li"><strong>' + esc(entryTitle(e)) + '</strong><small>' + dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) +
        (e.kind === "withdrawal" && e.bank_name ? " · " + esc(e.bank_name) + " ···" + esc(e.account_last4 || "") : "") + (st ? " · " + ({ requested: "Waiting for Levromart's check", processing: "On its way", success: "Sent", failed: "Not sent", reversed: "Returned", rejected: "Not approved" }[st] || st) : "") +
        (e.note && e.kind !== "order_payment" && e.kind !== "withdrawal" ? " · " + esc(e.note) : "") + '</small></div><b class="lw-amt ' + (amt > 0 ? "in" : cls === "wait" ? "wait" : "out") + '">' + (amt > 0 ? "+" : "−") + short(Math.abs(amt)) + "</b></li>";
    });
    body.innerHTML = '<div class="lw-hist">' + h + "</ul></div>";
  };

  // paying for an order: choose the wallet (no fee) or Paystack
  window.lvW3ChoosePay = async function (orderId, total, paystackGo) {
    var d = await load(true);
    if (!d || d.frozen) return paystackGo();
    var bal = Number(d.balance_kobo), need = Math.round(Number(total || 0) * 100), enough = need > 0 ? bal >= need : bal > 0;
    var m = sheet("How do you want to pay?", '<button type="button" class="lw-pay" id="lwPayWallet"' + (enough ? "" : " disabled") + '><span class="lw-pay-ic w"><i class="fa-solid fa-wallet"></i></span><div><b>Levromart wallet</b><small>Balance ' + money(bal, true) + (enough ? " · no fee" : " · not enough") + '</small></div><i class="fa-solid fa-chevron-right"></i></button>' +
      (enough ? "" : '<button type="button" class="lw-link" onclick="lvW3Add()"><i class="fa-solid fa-plus"></i> Add money to your wallet</button>') +
      '<button type="button" class="lw-pay" id="lwPayCard"><span class="lw-pay-ic p"><i class="fa-solid fa-credit-card"></i></span><div><b>Card, bank transfer or USSD</b><small>Through Paystack · a small fee is added</small></div><i class="fa-solid fa-chevron-right"></i></button>' +
      '<p class="lw-err" hidden></p>');
    m.querySelector("#lwPayCard").onclick = function () { closeSheet(); paystackGo(); };
    var wb = m.querySelector("#lwPayWallet");
    wb.onclick = async function () {
      if (wb.disabled) return;
      var ok = await showConfirmDialog("Pay " + (need ? short(need) : "this order") + " from your Levromart wallet?", { title: "Pay with wallet", okLabel: "Pay now", cancelLabel: "Go back" });
      if (!ok) return;
      wb.disabled = true;
      var r = await sb.rpc("wallet_pay_order", { p_order_id: orderId });
      if (r.error) { wb.disabled = false; return err(m, r.error.message || "Could not pay."); }
      closeSheet(); await load(true); repaint();
      showToast("Paid from your wallet. Thank you!", "success");
      try { await navigate("orderDetail", { orderId: orderId }); } catch (_) {}
    };
  };

  // notifications can point at the wallet
  var nav0 = window.navigate;
  if (typeof nav0 === "function" && !nav0.__lw) {
    var nav1 = function (view) {
      if (view === "levroWallet") { var to = typeof vendor !== "undefined" && vendor ? "vendorOrders" : "buyerProfile"; var p = nav0.call(this, to); Promise.resolve(p).then(function () { setTimeout(window.lvW3History, 400); }); return p; }
      return nav0.apply(this, arguments);
    };
    nav1.__lw = true; window.navigate = nav1;
  }
  setInterval(function () { if (!document.hidden && document.querySelector(".lvw3")) load(true).then(repaint); }, 30000);
})();

/* ===== Admin: wallets and commission (on the Payments page) =====
   Wallet withdrawals waiting for a check (approve / reject with a reason), the money held in all wallets, any wallet found by
   @tag or name (put on hold / release), and Levromart's commission by period. */
(function () {
  "use strict";
  function naira(k) { try { return "₦" + (Number(k || 0) / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 }); } catch (_) { return "₦" + k; } }
  function when(t) { try { return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " + new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } }
  var q = "", range = "30";
  async function commissionHtml() {
    var days = { today: 1, "7": 7, "30": 30, all: 3650 }[range] || 30;
    var since = new Date(Date.now() - days * 864e5); if (range === "today") { since = new Date(); since.setHours(0, 0, 0, 0); }
    var r = await sb.from("commission_charges").select("amount,status,paid_at,payment_id,created_at").neq("status", "waived").gte("created_at", since.toISOString()).limit(5000);
    var rows = (r && r.data) || [];
    var held = rows.filter(function (c) { return c.status === "paid" && c.payment_id; }).reduce(function (s, c) { return s + Number(c.amount || 0); }, 0);
    var owed = rows.filter(function (c) { return c.status === "owed"; }).reduce(function (s, c) { return s + Number(c.amount || 0); }, 0);
    var byDay = {}; rows.forEach(function (c) { if (c.status === "paid" && c.payment_id) { var d = new Date(c.paid_at || c.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); byDay[d] = (byDay[d] || 0) + Number(c.amount || 0); } });
    var days7 = Object.keys(byDay).slice(-7);
    return '<div class="aw-card"><div class="aw-h"><b><i class="fa-solid fa-percent"></i> Levromart commission</b><div class="aw-range">' + [["today", "Today"], ["7", "7 days"], ["30", "30 days"], ["all", "All"]].map(function (x) { return '<button type="button" class="' + (x[0] === range ? "on" : "") + '" onclick="lvAwRange(\'' + x[0] + '\')">' + x[1] + "</button>"; }).join("") + "</div></div>" +
      '<div class="aw-tiles"><div><small>Earned and held in Paystack</small><b>' + naira(held * 100) + '</b><span>Yours to withdraw from the Paystack balance</span></div><div><small>Still owed by shops</small><b>' + naira(owed * 100) + "</b><span>Sales not paid through Levromart</span></div></div>" +
      (days7.length ? '<div class="aw-days">' + days7.map(function (d) { return '<div><small>' + d + "</small><b>" + naira(byDay[d] * 100) + "</b></div>"; }).join("") + "</div>" : "") + "</div>";
  }
  async function walletsHtml() {
    var r = await sb.rpc("admin_wallets", { p_query: q || null });
    if (r.error || !r.data) return '<div class="aw-card aw-off"><b><i class="fa-solid fa-wallet"></i> Wallets</b><p>Not switched on yet. Your engineer needs to apply migration 0033 and redeploy the backend.</p></div>';
    var d = r.data, waiting = (d.withdrawals || []).filter(function (x) { return x.status === "requested"; });
    return '<div class="aw-card"><div class="aw-h"><b><i class="fa-solid fa-wallet"></i> Wallets</b><span class="aw-held">Held for people: <b>' + naira(d.held_kobo) + "</b></span></div>" +
      '<p class="aw-note">This money belongs to people\'s wallets and must always stay in the Paystack balance.</p>' +
      (waiting.length ? '<div class="aw-sub">Withdrawals to check (' + waiting.length + ")</div>" + waiting.map(function (x) {
        return '<div class="aw-row"><div><b>' + naira(x.amount_kobo) + ' · @' + esc(x.handle || "") + '</b><small>' + esc(x.name || "") + " · " + esc(when(x.created_at)) + '</small><small class="aw-why"><i class="fa-solid fa-shield-halved"></i> ' + esc(x.review_reason || "Needs a check") + '</small><small>To ' + esc(x.bank_name || "") + " ···" + esc(x.account_last4 || "") + " (" + esc(x.account_name || "") + ")</small></div>" +
          '<div class="aw-acts"><button class="btn btn-sm" onclick="lvAwDecide(\'' + esc(x.id) + '\',\'approve\')">Approve</button><button class="btn btn-sm btn-danger" onclick="lvAwDecide(\'' + esc(x.id) + '\',\'reject\')">Reject</button></div></div>';
      }).join("") : '<p class="aw-note"><i class="fa-solid fa-circle-check"></i> No wallet withdrawal is waiting.</p>') +
      '<div class="aw-sub">Find a wallet</div><input class="aw-search" placeholder="@tag or name" value="' + esc(q) + '" onkeydown="if(event.key===\'Enter\')lvAwSearch(this.value)">' +
      (d.wallets || []).slice(0, 12).map(function (x) {
        return '<div class="aw-row"><div><b>@' + esc(x.handle) + ' · ' + naira(x.balance_kobo) + '</b><small>' + esc(x.name || "") + " · " + esc(x.role || "") + (x.frozen ? ' · <span class="aw-hold">On hold' + (x.frozen_reason ? ": " + esc(x.frozen_reason) : "") + "</span>" : "") + "</small></div>" +
          '<div class="aw-acts">' + (x.frozen ? '<button class="btn btn-sm" onclick="lvAwFreeze(\'' + esc(x.user_id) + '\',false)">Release</button>' : '<button class="btn btn-sm btn-danger" onclick="lvAwFreeze(\'' + esc(x.user_id) + '\',true)">Put on hold</button>') + "</div></div>";
      }).join("") + "</div>";
  }
  /* ---- Levromart's own wallet: the commission, withdrawn to Levromart's bank with the super admin's password (migration 0035) */
  var LW = null;
  function dayKey(t) { var d = new Date(t); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); }
  function dayLabel(t) {
    var d = new Date(t), now = new Date(), y = new Date(); y.setDate(now.getDate() - 1);
    if (dayKey(d) === dayKey(now)) return "Today"; if (dayKey(d) === dayKey(y)) return "Yesterday";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  }
  function hm(t) { try { return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } }
  function entryRow(e) {
    var k = Number(e.amount_kobo), plus = k > 0, ic, cls, title, sub = hm(e.created_at);
    if (e.kind === "commission") { ic = "fa-percent"; cls = "in"; title = e.shop_name ? "Commission · " + e.shop_name : (e.note || "Commission"); if (e.order_id) sub += " · Order #" + String(e.order_id).slice(0, 8).toUpperCase(); }
    else if (e.kind === "commission_reversed") { ic = "fa-rotate-left"; cls = "back"; title = "Commission taken back" + (e.shop_name ? " · " + e.shop_name : ""); }
    else if (e.kind === "withdrawal") { ic = "fa-building-columns"; cls = e.withdrawal_status === "success" ? "out" : e.withdrawal_status === "failed" || e.withdrawal_status === "reversed" ? "fail" : "wait"; title = "Withdrawal"; sub += " · " + (e.bank_name || "Bank") + " ···" + (e.account_last4 || "") + " · " + ({ success: "Sent", processing: "On its way", failed: "Not sent", reversed: "Returned" }[e.withdrawal_status] || ""); }
    else { ic = "fa-arrow-rotate-left"; cls = "back"; title = "Withdrawal returned"; }
    return '<div class="lwa-row"><span class="lwa-ic ' + cls + '"><i class="fa-solid ' + ic + '"></i></span><div class="lwa-mid"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></div><span class="lwa-amt ' + cls + '">' + (plus ? "+" : "−") + naira(Math.abs(k)) + "</span></div>";
  }
  var lwAll = false;
  window.lvLwMore = function () { lwAll = true; paint(); };
  function historyHtml(full) {
    var out = "", day = "", lastBank = null, list = lwAll ? full : full.slice(0, 10);
    // the bank of each withdrawal, oldest first, to mark where a new payout bank starts
    var newBankAt = {};
    full.slice().reverse().forEach(function (e) { if (e.kind === "withdrawal" && e.recipient_code) { if (lastBank && lastBank !== e.recipient_code) newBankAt[e.id] = true; lastBank = e.recipient_code; } });
    list.forEach(function (e) {
      var k = dayKey(e.created_at);
      if (k !== day) { day = k; out += '<div class="lwa-day">' + esc(dayLabel(e.created_at)) + "</div>"; }
      if (newBankAt[e.id]) out += '<div class="lwa-bank"><i class="fa-solid fa-building-columns"></i> New payout bank: ' + esc(e.bank_name || "") + " ···" + esc(e.account_last4 || "") + "</div>";
      out += entryRow(e);
    });
    if (!lwAll && full.length > list.length) out += '<button type="button" class="lwa-more" onclick="lvLwMore()">Show all ' + full.length + " lines</button>";
    return out || '<p class="aw-note">No commission yet. It appears here as orders paid through Levromart are completed.</p>';
  }
  async function levromartWalletHtml() {
    var r = await sb.rpc("get_levromart_wallet");
    if (r.error || !r.data) return null;
    var d = LW = r.data, a = d.account, c = d.commission || {};
    var wait = a && a.wait_hours > 0;
    return '<div class="aw-card lwa"><div class="lwa-card">' +
      '<div class="lwa-top"><div><small>Levromart commission · available</small><b class="lwa-bal">' + naira(d.balance_kobo) + '</b></div>' +
        (d.can_manage ? '<button type="button" class="lwa-wd" onclick="lvLwWithdraw()"' + (!a || wait || Number(d.balance_kobo) < Number(d.min_withdrawal_kobo || 0) ? " disabled" : "") + '><i class="fa-solid fa-building-columns"></i> Withdraw</button>' : "") + "</div>" +
      '<div class="lwa-bankrow"><i class="fa-solid fa-building-columns"></i><span>' + (a ? esc(a.bank_name || "") + " ···" + esc(a.last4) + " · " + esc(a.account_name) : "No payout account yet") + "</span>" +
        (d.can_manage ? '<button type="button" onclick="lvLwAccount()">' + (a ? "Change" : "Add") + "</button>" : "") + "</div>" +
      (wait ? '<div class="lwa-wait"><i class="fa-solid fa-shield-halved"></i> New payout account: withdrawals open in ' + a.wait_hours + " hour" + (a.wait_hours === 1 ? "" : "s") + ".</div>" : "") +
      '<div class="lwa-tiles"><div><small>Today</small><b>' + naira(c.today_kobo) + '</b></div><div><small>7 days</small><b>' + naira(c.week_kobo) + '</b></div><div><small>30 days</small><b>' + naira(c.month_kobo) + '</b></div><div><small>All time</small><b>' + naira(c.all_kobo) + "</b></div></div>" +
      "</div>" +
      (d.can_manage ? "" : '<p class="aw-note"><i class="fa-solid fa-lock"></i> Only the super admin can withdraw or change the payout account.</p>') +
      '<div class="aw-sub">Commission history</div><div class="lwa-hist">' + historyHtml(d.entries || []) + "</div></div>";
  }
  function pwSheet(title, text, okLabel) {
    return new Promise(function (resolve) {
      var m = document.createElement("div");
      m.className = "lvw-sheet-wrap lw-wrap"; m.id = "lvLwPw";
      m.innerHTML = '<div class="lvw-sheet lw-sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="lvw-sheet-grab" aria-hidden="true"></div><div class="lvw-sheet-head"><h3>' + esc(title) + '</h3><button type="button" class="lvw-eye lvw-eye-dark" data-x aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><div class="lvw-sheet-body">' +
        '<p class="lw-hint">' + esc(text) + '</p><label class="lwa-pwlabel" for="lvLwPwIn">Your password</label><input id="lvLwPwIn" class="lwa-pw" type="password" autocomplete="current-password" placeholder="Enter your password">' +
        '<p class="lw-err" hidden></p><button type="button" class="btn lw-go" data-ok>' + esc(okLabel) + "</button></div></div>";
      document.body.appendChild(m);
      var input = m.querySelector("#lvLwPwIn");
      function done(v) { m.remove(); resolve(v); }
      m.addEventListener("click", function (e) { if (e.target === m || (e.target.closest && e.target.closest("[data-x]"))) done(null); });
      m.querySelector("[data-ok]").onclick = function () { if (!input.value) { var er = m.querySelector(".lw-err"); er.textContent = "Enter your password."; er.hidden = false; return; } done(input.value); };
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") m.querySelector("[data-ok]").click(); });
      setTimeout(function () { try { input.focus(); } catch (_) {} }, 60);
    });
  }
  window.lvLwWithdraw = async function () {
    var d = LW; if (!d || !d.account) return;
    var raw = await showTextPromptDialog("Withdraw commission", "How much? Levromart's wallet has " + naira(d.balance_kobo) + ". It goes to " + (d.account.bank_name || "") + " ···" + d.account.last4 + ".", { okLabel: "Next", placeholder: "Amount in naira, up to " + (Number(d.balance_kobo) / 100).toLocaleString("en-NG") });
    if (!raw) return;
    var kobo = Math.round(Number(String(raw).replace(/[,\s₦]/g, "")) * 100);
    if (!(kobo > 0)) return showToast("Enter an amount.", "error");
    var pw = await pwSheet("Confirm it's you", "Type your password to send " + naira(kobo) + " to " + (d.account.bank_name || "") + " ···" + d.account.last4 + ".", "Withdraw " + naira(kobo));
    if (!pw) return;
    var r = await sb.rpc("withdraw_levromart_commission", { p_amount_kobo: kobo, p_password: pw });
    if (r.error) return showToast(r.error.message || "Could not withdraw.", "error");
    showToast(r.data && r.data.status === "sent" ? "Sent to the bank." : "On its way to the bank.", "success"); paint();
  };
  window.lvLwAccount = async function () {
    var list = [];
    try { var bk = await window.levroData.payments.banks(); list = (bk && Array.isArray(bk.data) && bk.data) || []; } catch (_) {}
    if (!list.length && typeof NIGERIAN_BANKS !== "undefined") list = NIGERIAN_BANKS;
    list = list.slice().sort(function (x, y) { return String(x.name).localeCompare(String(y.name)); });
    var m = document.createElement("div");
    m.className = "lvw-sheet-wrap lw-wrap"; m.id = "lvLwAcct";
    m.innerHTML = '<div class="lvw-sheet lw-sheet" role="dialog" aria-modal="true" aria-label="Levromart payout account"><div class="lvw-sheet-grab" aria-hidden="true"></div><div class="lvw-sheet-head"><h3>Levromart payout account</h3><button type="button" class="lvw-eye lvw-eye-dark" data-x aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><div class="lvw-sheet-body">' +
      '<p class="lw-hint">Levromart\'s commission is withdrawn to this account. For safety, withdrawals open 24 hours after it is added or changed, and every admin is told.</p>' +
      '<select class="lwa-pw" id="lvLwBank"><option value="">Choose the bank</option>' + list.map(function (b) { return '<option value="' + esc(b.code) + '">' + esc(b.name) + "</option>"; }).join("") + "</select>" +
      '<input class="lwa-pw" id="lvLwNum" inputmode="numeric" maxlength="10" placeholder="10-digit account number">' +
      '<div class="lwa-found" hidden></div><p class="lw-err" hidden></p><button type="button" class="btn lw-go" data-ok>Check account</button></div></div>';
    document.body.appendChild(m);
    var found = null, er = m.querySelector(".lw-err"), go = m.querySelector("[data-ok]"), box = m.querySelector(".lwa-found");
    function say(t) { er.textContent = t || ""; er.hidden = !t; }
    function reset() { found = null; box.hidden = true; go.textContent = "Check account"; say(""); }
    m.querySelector("#lvLwBank").onchange = reset; m.querySelector("#lvLwNum").oninput = reset;
    m.addEventListener("click", function (e) { if (e.target === m || (e.target.closest && e.target.closest("[data-x]"))) m.remove(); });
    go.onclick = async function () {
      var code = m.querySelector("#lvLwBank").value, num = m.querySelector("#lvLwNum").value.trim();
      if (!code) return say("Choose the bank.");
      if (!/^\d{10}$/.test(num)) return say("Enter the 10-digit account number.");
      say(""); go.disabled = true;
      try {
        if (!found) {
          var r = await window.levroData.payments.resolveAccount(code, num);
          if (r.error || !r.data) return say((r.error && r.error.message) || "We could not find that account.");
          found = r.data; box.hidden = false;
          box.innerHTML = "<b>" + esc(found.accountName) + "</b><span>" + esc(found.bankName || "") + " · ···" + esc(found.accountLast4 || num.slice(-4)) + "</span>";
          go.textContent = "Yes, save this account"; return;
        }
        var pw = await pwSheet("Confirm it's you", "Type your password to make this Levromart's payout account.", "Save account");
        if (!pw) return;
        var s = await sb.rpc("set_levromart_payout_account", { p_bank_code: code, p_account_number: num, p_confirmed_name: found.accountName, p_password: pw });
        if (s.error) return say(s.error.message || "Could not save.");
        m.remove(); showToast("Saved. Withdrawals to it open in 24 hours.", "success"); paint();
      } finally { go.disabled = false; }
    };
  };

  async function paint() {
    var box = document.getElementById("lvAwBox"); if (!box) return;
    var own = await levromartWalletHtml().catch(function () { return null; });
    var parts = await Promise.all([Promise.resolve(own || ""), walletsHtml().catch(function () { return ""; }), own ? Promise.resolve("") : commissionHtml().catch(function () { return ""; })]);
    if (document.getElementById("lvAwBox")) document.getElementById("lvAwBox").innerHTML = parts.join("");
  }
  window.lvAwRange = function (r) { range = r; paint(); };
  window.lvAwSearch = function (v) { q = String(v || "").trim(); paint(); };
  window.lvAwDecide = async function (id, how) {
    var reason = null;
    if (how === "reject") { reason = await showTextPromptDialog("Reject withdrawal", "Why? The person will see this, and the money goes back into their wallet.", { okLabel: "Reject" }); if (!reason) return; }
    else if (!(await showConfirmDialog("Send this money to their bank now?", { title: "Approve withdrawal", okLabel: "Approve", cancelLabel: "Go back" }))) return;
    var r = await sb.rpc("admin_decide_wallet_withdrawal", { p_id: id, p_decision: how, p_reason: reason });
    if (r.error) return showToast(r.error.message || "Could not save.", "error");
    showToast(how === "approve" ? "Approved. The money is being sent." : "Rejected. The money is back in their wallet.", "success"); paint();
  };
  window.lvAwFreeze = async function (userId, on) {
    var reason = null;
    if (on) { reason = await showTextPromptDialog("Put wallet on hold", "Why? Sending, withdrawing and adding money stop until you release it.", { okLabel: "Put on hold" }); if (!reason) return; }
    var r = await sb.rpc("admin_set_wallet_frozen", { p_user_id: userId, p_frozen: !!on, p_reason: reason });
    if (r.error) return showToast(r.error.message || "Could not save.", "error");
    showToast(on ? "Wallet put on hold." : "Wallet released.", "success"); paint();
  };
  var orig = window.renderAdminPayments;
  if (typeof orig === "function" && !orig.__aw) {
    var w = async function () { var html = await orig.apply(this, arguments); setTimeout(paint, 60); return String(html) + '<div id="lvAwBox" class="aw-box"></div>'; };
    w.__aw = true; window.renderAdminPayments = w;
  }
})();

/* ===== Confirm pop-ups: a dangerous action (log out, delete, cancel an order…) is red and the way out ("Go back") is green;
   for an ordinary action the way out labelled "Cancel" stays red, as everywhere else. ===== */
(function () {
  "use strict";
  var orig = window.showConfirmDialog;
  if (typeof orig !== "function" || orig.__lvc) return;
  var w = function (message, opts) {
    var p = orig.apply(this, arguments);
    try {
      var o = opts || {}, cancel = document.getElementById("confirmModalCancel");
      if (cancel) {
        var danger = !!o.danger || /log ?out|delete|remove|cancel|reject|block|suspend|disable|discard/i.test(String(o.okLabel || ""));
        var ok = document.getElementById("confirmModalOk");
        if (ok && danger) ok.className = "btn btn-danger";
        cancel.classList.toggle("lv-safe", danger);
        if (danger) cancel.classList.remove("lv-cancel");
        if (!o.cancelLabel && danger) cancel.textContent = "Go back";
      }
    } catch (_) {}
    return p;
  };
  w.__lvc = true; window.showConfirmDialog = w;
})();

/* ===== Search: steady results =====
   The same words searched again within a few seconds (a second trigger of the same search) are not redrawn, so the list does
   not blink; pictures in the results fade in once instead of popping. */
(function () {
  "use strict";
  var last = { key: "", at: 0 };
  function wrap() {
    var q = window.runSearchPageQuery;
    if (typeof q !== "function" || q.__lvSteady) return;
    var w = async function (term) {
      var k = String(term || "").trim().toLowerCase() + "|" + (typeof searchPageFilter !== "undefined" ? searchPageFilter : "");
      var has = document.querySelector("#searchPageResults .search-page-section, #searchPageResults .search-page-empty");
      if (k === last.key && Date.now() - last.at < 4000 && has) return;
      last = { key: k, at: Date.now() };
      return q.apply(this, arguments);
    };
    w.__lvSteady = true; w.__lvDual = q.__lvDual; window.runSearchPageQuery = w;
  }
  wrap(); setTimeout(wrap, 1500); setTimeout(wrap, 5000);
})();

/* Comment box grows with the text, up to about six lines */
(function(){
  function grow(t){try{t.style.height="auto";t.style.height=Math.min(t.scrollHeight+2,160)+"px";}catch(_){}}
  document.addEventListener("input",function(e){var t=e.target;if(t&&t.tagName==="TEXTAREA"&&t.closest&&t.closest(".product-comment-compose-row"))grow(t);},true);
  document.addEventListener("focusin",function(e){var t=e.target;if(t&&t.tagName==="TEXTAREA"&&t.closest&&t.closest(".product-comment-compose-row"))grow(t);},true);
})();
