/* ---- app-like motion: pages slide/fade in, and a re-render that changes nothing no longer wipes and redraws the screen ---- */
(function(){
  "use strict";
  var app=document.getElementById("app"); if(!app) return;
  var desc=Object.getOwnPropertyDescriptor(Element.prototype,"innerHTML"); if(!desc||!desc.set) return;
  var reduce=false; try{ reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(_){}
  var TABS={home:1,vendors:1,search:1,notifications:1,vendorOrders:1,buyerOrders:1,buyerProfile:1,vendorDashboard:1,requestEquipment:1,vendorRequests:1,cart:1,wishlist:1,messages:1};
  var NAVPOS={home:0,vendors:1,vendorsMap:1,requestEquipment:2,vendorRequests:2,notifications:3,buyerOrders:4,vendorOrders:4};
  var last={html:null,gen:-1,view:null}, goingBack=false, animTimer=null;
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
        if(document.hidden||Date.now()<homeCarouselResumeAt) return;
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
          var html=String(v);
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
      var g=gen(), vw=view(), html=String(v);
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
    { sel: "#aiChatPanel:not(.hidden)", close: function () { try { toggleAiChat(); } catch (_) {} }, back: null },
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
    return window.levroData.payments.config().then(function (r) { onCache = !!(r && r.data && r.data.paystackCheckout); onAt = Date.now(); return onCache; }, function () { return false; });
  }
  window.lvPaystackOn = paystackOn;
  function closeModal() { var m = document.getElementById("lvPayModal"); if (m) m.remove(); }
  function openModal(html) {
    closeModal();
    var m = document.createElement("div");
    m.id = "lvPayModal"; m.className = "modal lv-pm open";
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
    openModal(
      '<div class="lv-pm-head"><h3 id="lvPmTitle"><span class="lv-pm-ico" aria-hidden="true"><i class="fa-solid fa-credit-card"></i></span>Pay ' + esc(naira(d.amountNaira)) + '</h3><button type="button" class="icon-btn" aria-label="Close" onclick="document.getElementById(\'lvPayModal\')?.remove()"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<ul class="lv-pm-sum"><li><span>Order amount</span><b>' + esc(naira(d.orderAmountNaira)) + '</b></li><li><span>Paystack fee</span><b>' + esc(naira(d.feeNaira)) + '</b></li><li class="tot"><span>You pay</span><b>' + esc(naira(d.amountNaira)) + '</b></li></ul>' +
      '<p class="lv-pm-secure"><i class="fa-solid fa-lock" aria-hidden="true"></i><span>Secured by Paystack. The vendor is paid after you confirm you have your order.</span></p>' +
      '<div class="lv-pm-actions"><button type="button" class="btn btn-outline" onclick="document.getElementById(\'lvPayModal\')?.remove()">Cancel</button><button type="button" class="btn" id="lvPmGo">Continue to Paystack</button></div>'
    );
    var go = document.getElementById("lvPmGo");
    go.addEventListener("click", function () {
      if (go.disabled) return; go.disabled = true; go.textContent = "Opening Paystack…";   // a second tap must not open a second payment
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
    if (outcome === "paid" && info.settled && !/^(applied|already_paid|ok)$/.test(String(info.settled))) showToast("Paystack confirmed your payment, but we could not update your order yet. Please screenshot this and send it to support. Code: " + String(info.settled).slice(0, 140), "error");
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
      box.innerHTML = d && d.verified
        ? '<div class="banner banner-success" style="margin-top:0.6rem;"><strong><i class="fa-solid fa-circle-check"></i> Account verified.</strong> ' + esc(d.accountName || "") + " · " + esc(d.bankName || "") + " ···" + esc(d.accountLast4 || "") + "</div>"
        : '<div class="banner banner-warning" style="margin-top:0.6rem;"><strong><i class="fa-solid fa-triangle-exclamation"></i> Account not verified.</strong> Add your bank below and confirm the name to be paid.</div>';
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
    return html + '<section class="lv-payouts" id="lvPayoutList" aria-live="polite"></section>';
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
  var tab = "payouts", range = "today";
  function naira(n) { try { return "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 }); } catch (_) { return "₦" + n; } }
  function when(t) { try { return new Date(t).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } }
  function api() { return window.levroData && window.levroData.adminPayments; }
  var STATUS = { pending: "Waiting", processing: "On its way", success: "Sent", on_hold: "On hold", failed: "Failed", reversed: "Returned by bank", paid_manually: "Paid by hand", initialized: "Started", abandoned: "Abandoned", refunded: "Refunded", partially_refunded: "Part refunded", processed: "Done" };
  function pill(s) { var good = s === "success" || s === "processed" || s === "paid_manually"; var bad = s === "failed" || s === "reversed"; return '<span class="badge ' + (good ? "badge-success" : bad ? "badge-danger" : "badge-warning") + '">' + esc(STATUS[s] || s) + "</span>"; }

  function ask(title, label, withAmount, onOk) {
    var m = document.createElement("div");
    m.className = "modal lv-pm open"; m.id = "lvAdminAsk";
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
      if (res && res.error) { var er2 = document.getElementById("lvAskErr"); er2.textContent = res.error.message || "Something went wrong."; er2.classList.remove("hidden"); return; }
      m.remove(); showToast("Done.", "success"); navigate("adminPayments", {}, false);
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
    else if (kind === "refund") ask("Refund this order", "Reason for the refund", true, function (t, amt) { return a.refund(id, { amountNaira: amt, reason: t }); });
  };
  window.lvPayTab = function (t) { tab = t; navigate("adminPayments", {}, false); };
  window.lvPayRange = function (r) { range = r; navigate("adminPayments", {}, false); };

  function payoutRow(p) {
    var acts = "";
    if (["on_hold", "failed", "reversed"].indexOf(p.status) >= 0) acts += '<button class="btn btn-sm" onclick="lvPayAct(\'release\',\'' + esc(p.id) + '\')">Release</button>';
    if (p.status === "pending" || p.status === "failed") acts += '<button class="btn btn-sm btn-outline" onclick="lvPayAct(\'hold\',\'' + esc(p.id) + '\')">Hold</button>';
    if (["pending", "on_hold", "failed", "reversed"].indexOf(p.status) >= 0) acts += '<button class="btn btn-sm btn-outline" onclick="lvPayAct(\'manual\',\'' + esc(p.id) + '\')">Paid by hand</button>';
    return '<div class="lv-ap-row"><div class="lv-ap-main"><b>' + naira(p.amount) + "</b> " + pill(p.status) + "<small>" + esc(p.business_name || "") + " · " + when(p.created_at) + (p.hold_reason ? " · " + esc(p.hold_reason) : "") + (p.last_error ? " · " + esc(p.last_error) : "") + '</small><a class="lv-ap-link" onclick="navigate(\'orderDetail\',{orderId:\'' + esc(p.order_id) + '\'})">Open order</a></div><div class="lv-ap-acts">' + acts + "</div></div>";
  }
  function txRow(t) {
    var can = t.order_id && (t.status === "success" || t.status === "partially_refunded");
    return '<div class="lv-ap-row"><div class="lv-ap-main"><b>' + naira(t.amount) + "</b> " + pill(t.status) + "<small>" + esc(String(t.purpose).replace("_", " ")) + " · " + esc(t.business_name || "") + " · " + when(t.paid_at || t.created_at) + '</small></div><div class="lv-ap-acts">' + (can ? '<button class="btn btn-sm btn-outline" onclick="lvPayAct(\'refund\',\'' + esc(t.order_id) + '\')">Refund</button>' : "") + "</div></div>";
  }
  function refundRow(r) { return '<div class="lv-ap-row"><div class="lv-ap-main"><b>' + naira(r.amount) + "</b> " + pill(r.status) + "<small>" + esc(r.reason || "") + " · " + when(r.created_at) + (r.last_error ? " · " + esc(r.last_error) : "") + "</small></div></div>"; }
  function reportRow(r) {
    var rep = r.report || {}; var list = (rep.problems || []).map(function (p) { return "<li>" + esc(p.detail) + "</li>"; }).join("");
    return '<div class="lv-ap-row lv-ap-col"><div class="lv-ap-main"><b>' + esc(String(r.window_start).slice(0, 10)) + "</b> " + (r.problems ? '<span class="badge badge-danger">' + r.problems + " to check</span>" : '<span class="badge badge-success">All matched</span>') + "<small>" + (rep.error ? esc(rep.error) : (rep.checked || 0) + " payments checked") + "</small></div>" + (list ? "<ul class=\"lv-ap-list\">" + list + "</ul>" : "") + "</div>";
  }

  window.renderAdminPayments = async function () {
    var a = api();
    var nav = typeof adminNavHtml === "function" ? adminNavHtml("adminPayments") : "";
    if (!a) return nav + '<div class="empty-state">Payments are not available right now.</div>';
    var sum = await a.summary();
    if (sum.error) return nav + '<div class="empty-state">' + esc(sum.error.message || "Only admins can see payments.") + "</div>";
    var s = sum.data, h = s.health, t = s[range];
    var q = { limit: 40 };
    var rows;
    if (tab === "payouts") rows = await a.payouts(q);
    else if (tab === "held") rows = await a.payouts({ limit: 40, status: "on_hold" });
    else if (tab === "failed") rows = await a.payouts({ limit: 40, status: "failed" });
    else if (tab === "payments") rows = await a.transactions(q);
    else if (tab === "refunds") rows = await a.refunds(q);
    else rows = await a.reports();
    var list = ((rows && rows.data) || []).map(tab === "payments" ? txRow : tab === "refunds" ? refundRow : tab === "checks" ? reportRow : payoutRow).join("") || '<p class="muted" style="text-align:center;">Nothing here.</p>';
    var tabs = [["payouts", "Payouts"], ["held", "On hold" + (h.held_payouts ? " (" + h.held_payouts + ")" : "")], ["failed", "Failed" + (h.failed_payouts ? " (" + h.failed_payouts + ")" : "")], ["payments", "Payments"], ["refunds", "Refunds"], ["checks", "Daily checks"]];
    return nav + '<h2 style="text-align:center;"><i class="fa-solid fa-credit-card"></i> Payments</h2>' +
      (h.needsAttention ? '<div class="banner banner-warning" role="status"><strong><i class="fa-solid fa-triangle-exclamation"></i> ' + h.needsAttention + ' thing(s) need attention.</strong> Stuck or failed payouts and refunds, or mismatches in the last daily check.</div>' : '<div class="banner banner-success" role="status"><i class="fa-solid fa-circle-check"></i> Everything is matching.</div>') +
      '<div class="segmented-tabs">' + [["today", "Today"], ["week", "7 days"], ["month", "30 days"]].map(function (r) { return '<button class="' + (r[0] === range ? "active" : "") + '" onclick="lvPayRange(\'' + r[0] + '\')">' + r[1] + "</button>"; }).join("") + "</div>" +
      '<div class="lv-ap-totals">' + [["Collected", t.collected], ["Refunded", t.refunded], ["Paid to vendors", t.paidToVendors], ["Levromart commission", t.commission]].map(function (x) { return '<div class="stat"><div class="n">' + naira(x[1]) + '</div><div class="muted">' + x[0] + "</div></div>"; }).join("") + "</div>" +
      '<div class="segmented-tabs" style="margin-top:1rem;">' + tabs.map(function (x) { return '<button class="' + (x[0] === tab ? "active" : "") + '" onclick="lvPayTab(\'' + x[0] + '\')">' + esc(x[1]) + "</button>"; }).join("") + "</div>" +
      '<div class="lv-ap-list-wrap">' + list + "</div>";
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
  var vendorsSnap = null;   // the Vendors page as it looked when we left it (grid/list only), so Back can show it at once
  function remember() {
    try {
      var a = document.getElementById("app"), m = null; try { m = localStorage.getItem("levromart_vendors_view"); } catch (_) {}
      if (a && view0() === "vendors" && m !== "map" && a.querySelector("#vendorsGrid .vd-card, #vendorsGrid > *:not(.vd-skel)")) vendorsSnap = a.innerHTML;
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
    window.navigate = async function (view, params, pushHistory) {
      var prev = depth(), pushes = pushHistory !== false && !(pushHistory && typeof pushHistory === "object" && pushHistory.replace === true);
      if (pushes) remember();
      // Going Back: keep the page as tall as it was, so the saved spot exists straight away (the list fills in afterwards)
      // and we do not first show the top and then scroll down.
      var heldBody = false;
      if (pushHistory === false) {
        try { var hk = keyOf(false), hh = hk != null ? heights[hk] : 0; if (hh > 0) { document.body.style.minHeight = hh + "px"; heldBody = true; } } catch (_) {}
      }
      if (pushHistory === false && view === "vendors" && vendorsSnap && view0() !== "vendors") {
        try { document.getElementById("app").innerHTML = vendorsSnap; } catch (_) {}
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
  function dress() {
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
  // hand-picked pairs (no greens): the banners cycle through these, each one a step apart, and fade between them
  var PAL = [["#6d28d9", "#be185d"], ["#1d4ed8", "#7c3aed"], ["#e11d48", "#f97316"], ["#0e7490", "#1e3a8a"], ["#c2410c", "#9d174d"], ["#4338ca", "#0ea5e9"], ["#be123c", "#6d28d9"]];
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
        prodCache[vid] = { at: Date.now(), rows: rows }; return rows;
      }).catch(function () { return []; });
  }
  function pick3(pool) { var a = pool.slice(), out = []; while (a.length && out.length < 3) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]); return out; }
  function thumbsHtml(rows) { return rows.map(function (p) { return '<img data-pid="' + esc2(p.id) + '" src="' + esc2(p.photos[0]) + '" alt="" decoding="async">'; }).join(""); }
  function tilesHtml(rows) { return rows.map(function (p) { return '<span class="lv-wv-tile" data-pid="' + esc2(p.id) + '"><img src="' + esc2(p.photos[0]) + '" alt="" decoding="async"><b>' + esc2(p.name) + "</b><i>" + esc2(naira(p)) + "</i></span>"; }).join(""); }
  function naira(p) { try { var v = typeof effectivePrice === "function" ? effectivePrice(p) : (p.discount_price || p.sale_price); v = Number(v); return v > 0 ? "₦" + v.toLocaleString("en-NG") : ""; } catch (_) { return ""; } }
  function logoHtml(w, cls) {
    var ini = esc2(String(w.business_name || "?").trim().slice(0, 2).toUpperCase());
    return '<span class="lv-wv-logo ' + (cls || "") + '">' + (w.logo_url ? '<img src="' + esc2(w.logo_url) + '" alt="" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement(\'b\'),{textContent:\'' + ini + '\'}))">' : "<b>" + ini + "</b>") + "</span>";
  }
  function slide(kind, w, rows, hue) {
    var id = esc2(w.vendor_id), nm = esc2(w.business_name);
    var open = ' class="home-promotional-slide lv-wv lv-wv-' + kind + '" data-wv="' + id + '" data-wv-kind="' + kind + '" style="' + palette({ a: 0, b: 1, c: 2 }[kind]) + '" onclick="lvWvTap(event,\'' + kind + '\',\'' + id + '\')" aria-label="';
    var thumbs = thumbsHtml(rows);
    if (kind === "a") {
      return "<button type=\"button\"" + open + "Vendor of the week: " + nm + '"><span class="lv-wv-in">' +
        '<span class="lv-wv-badge"><i class="fa-solid fa-crown"></i> Vendor of the week</span>' +
        logoHtml(w, "lv-wv-logo-big") +
        '<span class="lv-wv-name">' + nm + "</span>" +
        '<span class="lv-wv-sub">' + (Number(w.points) ? "Won last week with " + Number(w.points).toLocaleString("en-NG") + " points" : "Last week\u2019s winner") + "</span>" +
        (thumbs ? '<span class="lv-wv-thumbs">' + thumbs + "</span>" : "") +
        '<span class="lv-wv-cta">View storefront <i class="fa-solid fa-arrow-right"></i></span></span></button>';
    }
    if (kind === "b") {
      var tiles = tilesHtml(rows);
      return "<button type=\"button\"" + open + "Shop " + nm + '"><span class="lv-wv-in">' +
        '<span class="lv-wv-badge"><i class="fa-solid fa-fire"></i> Fresh from the winner</span>' +
        logoHtml(w, "lv-wv-logo-sm") +
        '<span class="lv-wv-name lv-wv-name-sm">' + nm + "</span>" +
        '<span class="lv-wv-tiles">' + tiles + "</span>" +
        '<span class="lv-wv-more">Tap to shop all <i class="fa-solid fa-arrow-right"></i></span></span></button>';
    }
    return "<button type=\"button\"" + open + "Follow " + nm + '"><span class="lv-wv-in">' +
      '<span class="lv-wv-badge"><i class="fa-solid fa-heart"></i> Don\'t miss a drop</span>' +
      logoHtml(w, "lv-wv-logo-big") +
      '<span class="lv-wv-name">Follow ' + nm + "</span>" +
      '<span class="lv-wv-sub">Be first to see new products, deals and updates.</span>' +
      (thumbs ? '<span class="lv-wv-thumbs lv-wv-thumbs-r">' + thumbs + "</span>" : "") +
      '<span class="lv-wv-cta lv-wv-cta-follow"><i class="fa-solid fa-user-plus"></i> Follow</span></span></button>';
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
    { k: "join", act: "join", link: "https://chat.whatsapp.com/DVCSNKkZ6AIHtKYyMPWxHs", label: "Join the community", h1: "Join the", h2: "community.", sub: "Be first to hear new vendors, offers and campus updates on WhatsApp.", cta: "Tap to join the group", ph: "join", tiles: ["fa-cart-shopping", "fa-bag-shopping", "star"] },
    { k: "sell", act: "vendorApply", link: "?levro=vendorApply", label: "Sell to your whole campus", h1: "Sell to your", h2: "whole campus.", sub: "Open your shop in minutes. List products, get orders, grow.", cta: "Become a vendor", ph: "sell", tiles: ["fa-box", "star", "fa-tag", "fa-cart-shopping"] },
    { k: "store", act: "vendors", link: "?levro=vendors", label: "Your campus online store", h1: "Your campus", h2: "online store.", sub: "Shop products, book services and rent items from vendors on your campus.", cta: "Buy \u00b7 Sell \u00b7 Rent", ph: "store", tiles: ["fa-cart-shopping", "fa-box", "fa-bag-shopping", "fa-tag", "star"] },
    { k: "follow", act: "links", link: "/links", label: "Follow us everywhere", h1: "Follow us", h2: "everywhere.", sub: 'Same name on every platform: <b>@levromart</b>', cta: "", ph: "follow", tiles: ["star", "fa-bag-shopping", "fa-cart-shopping"], social: true, foot: "Tap our link in bio \u00b7 levromart.com/links" },
    { k: "win", act: "leaderboard", link: "?levro=leaderboard", label: "Win a full week of promotion", h1: "Win a full week", h2: "of promotion.", sub: "Be seen by more customers. Be Vendor of the Week.", cta: "", ph: "win", tiles: ["fa-cart-shopping", "star", "fa-tag", "fa-bag-shopping"], soon: true, foot: '<i class="fa-solid fa-globe"></i> levromart.com' },
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
      (d.cta ? '<span class="lv-fy-cta">' + d.cta + (d.cta.indexOf("\u00b7") < 0 ? ' <i class="fa-solid fa-arrow-right"></i>' : "") + "</span>" : "") +
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
        if (car && c && c.w && c.w.vendor_id && Date.now() - c.at < 43200000) {
          logoPal = c.pal || null; var pool = c.pool || []; window.__lvWvPool = pool;
          var rows = pick3(pool), extra = [slide("a", c.w, rows, 0)]; if (rows.length) extra.push(slide("b", c.w, rows, 0)); extra.push(slide("c", c.w, rows, 0));
          car.setAttribute("data-wv-key", c.w.vendor_id + "|" + (logoPal ? logoPal[0] : "") + "|" + (pool.length ? 1 : 0));
          compose(car, extra);
        }
        return box.innerHTML;
      } catch (_) { return html; }
    };
  }
  async function inject() {
    if (busy || Date.now() - (window.__lvCarTouchedAt || 0) < 15000) return;
    var car = document.getElementById("homePromotionalCarousel"); if (!car || typeof window.lvVendorSpot !== "function") return;
    busy = true;
    try {
      var spot = await window.lvVendorSpot();
      var w = spot && spot.winner;   // the vendor who WON last week keeps the banners for this whole week (not whoever is leading right now)
      car = document.getElementById("homePromotionalCarousel"); if (!car) return;
      if (!w || !w.vendor_id || !w.business_name) { try { localStorage.removeItem("lv-wv-cache"); } catch (_) {} car.querySelectorAll("[data-wv]").length && removeAll(car); return; }
      var pool = await products(w.vendor_id), rows = pick3(pool); window.__lvWvPool = pool;
      var h = await logoHue(w.logo_url);
      logoPal = (h != null && (h < 70 || h > 170)) ? [rgbHex(h), rgbHex(h + 40)] : null;
      car = document.getElementById("homePromotionalCarousel"); if (!car) return;
      var key = w.vendor_id + "|" + (logoPal ? logoPal[0] : "") + "|" + (pool.length ? 1 : 0);
      if (car.getAttribute("data-wv-key") === key) return;
      var extra = [slide("a", w, rows, h)]; if (rows.length) extra.push(slide("b", w, rows, h)); extra.push(slide("c", w, rows, h));
      car.setAttribute("data-wv-key", key);
      try { localStorage.setItem("lv-wv-cache", JSON.stringify({ at: Date.now(), w: { vendor_id: w.vendor_id, business_name: w.business_name, logo_url: w.logo_url, points: w.points }, pal: logoPal, pool: pool.map(function (p) { return { id: p.id, name: p.name, photos: [p.photos[0]], sale_price: p.sale_price, discount_price: p.discount_price, is_service: p.is_service }; }) })); } catch (_) {}
      rebuild(car, extra);
    } catch (_) {} finally { busy = false; }
  }
  function removeAll(car) { car.removeAttribute("data-wv-key"); rebuild(car, []); }
  var t = 0;
  new MutationObserver(function () { if (t || busy) return; if (!document.getElementById("homePromotionalCarousel")) return; t = setTimeout(function () { t = 0; inject(); }, 120); }).observe(document.body, { childList: true, subtree: true });
  setInterval(function () { if (!document.hidden) inject(); }, 120000);
  // every few seconds: new products on the flyers, new colours on the banners
  function swapProducts() {
    var pool = window.__lvWvPool; if (document.hidden || !pool || pool.length < 4) return;
    var rows = pick3(pool);
    document.querySelectorAll(".lv-wv-thumbs, .lv-wv-tiles").forEach(function (box) {
      box.classList.remove("lv-wv-swap"); void box.offsetWidth;
      box.innerHTML = box.classList.contains("lv-wv-thumbs") ? thumbsHtml(rows) : tilesHtml(rows);
      box.classList.add("lv-wv-swap");
    });
  }
  function swapColours() {
    if (document.hidden) return; palStep++;
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
  setInterval(function () { if (!document.hidden) { step++; paint(); } }, 9000);
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
    p.classList.add("hidden"); p.style.removeProperty("transform"); p.style.removeProperty("transition");
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
      if (Date.now() - (touched.get(row) || 0) < 30000) return;
      var first = row.firstElementChild, gap = parseFloat(getComputedStyle(row).columnGap) || 12;
      var step = first ? first.getBoundingClientRect().width + gap : row.clientWidth * 0.8;
      var atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 6;
      try { row.scrollTo({ left: atEnd ? 0 : row.scrollLeft + step, behavior: "smooth" }); } catch (_) {}
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
    var list=document.querySelectorAll(".lv-wv.lv-wv-a,.lv-wv.lv-wv-b,.lv-wv.lv-wv-c"); if(!list.length) return;
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
      window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
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
  var cache = null, loading = null, filter = "all";
  function hidden() { try { return localStorage.getItem(HIDE) === "1"; } catch (_) { return false; } }
  function setHidden(v) { try { localStorage.setItem(HIDE, v ? "1" : "0"); } catch (_) {} }
  function money(n) { return hidden() ? "₦ ••••" : "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function when(d) { try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " + new Date(d).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" }); } catch (_) { return ""; } }

  var FEE_TYPES = { sale_price: 1, rental_fee: 1, delivery_deposit_20: 1 };
  async function load(force) {
    if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
    if (loading) return loading;
    loading = (async function () {
      var v = typeof vendor !== "undefined" ? vendor : null;
      if (!v || !v.id) return null;
      var res = await Promise.all([
        sb.from("orders").select("id,status,created_at,completed_at,payments(payment_type,amount,status,method,provider_reference,paid_at)").eq("vendor_id", v.id).neq("status", "cancelled").order("created_at", { ascending: false }).limit(300),
        sb.from("vendor_payouts").select("order_id,amount_kobo,status,created_at,updated_at").eq("vendor_id", v.id),
        sb.from("commission_charges").select("order_id,amount").eq("vendor_id", v.id)
      ]);
      var orders = (res[0] && res[0].data) || [], payouts = (res[1] && res[1].data) || [], charges = (res[2] && res[2].data) || [];
      var payoutBy = {}; payouts.forEach(function (p) { payoutBy[p.order_id] = p; });
      var commBy = {}; charges.forEach(function (c) { commBy[c.order_id] = (commBy[c.order_id] || 0) + Number(c.amount || 0); });
      var tx = [], pending = 0, onWay = 0, paidOut = 0;
      orders.forEach(function (o) {
        var paid = (o.payments || []).filter(function (p) { return p.status === "paid" && FEE_TYPES[p.payment_type] && (p.method === "card" || /^(lvm_ord_|medris_)/.test(String(p.provider_reference || ""))); });
        if (!paid.length) return;
        var gross = paid.reduce(function (s, p) { return s + Number(p.amount || 0); }, 0);
        var comm = commBy[o.id] || 0, net = Math.max(0, gross - comm);
        var at = paid.map(function (p) { return p.paid_at; }).filter(Boolean).sort().pop() || o.created_at;
        var legacy = paid.every(function (p) { return /^medris_/.test(String(p.provider_reference || "")); });
        var pay = payoutBy[o.id], state, amount = net, date = at;
        if (legacy) {   // the older checkout: Paystack pays the shop's bank directly, the next business day
          state = Date.now() - new Date(at).getTime() < 2 * 86400000 ? "onway" : "paid";
        } else if (pay) {
          if (pay.status === "success" || pay.status === "paid_manually") { state = "paid"; if (Number(pay.amount_kobo) > 0) amount = Number(pay.amount_kobo) / 100; date = pay.updated_at || pay.created_at; }
          else state = "onway";
        } else if (o.status === "completed") state = "onway";
        else state = "pending";
        if (state === "pending") pending += amount; else if (state === "onway") onWay += amount; else paidOut += amount;
        tx.push({ id: o.id, state: state, amount: amount, comm: comm, date: date, orderStatus: o.status });
      });
      tx.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
      var data = { pending: pending, onWay: onWay, paidOut: paidOut, tx: tx, hasPayout: !!(v.paystack_subaccount_code || v.transfer_recipient_code) };
      cache = { at: Date.now(), data: data };
      return data;
    })().catch(function () { return null; }).finally(function () { loading = null; });
    return loading;
  }

  var LABEL = { pending: "Pending", onway: "On its way", paid: "Paid out" };
  function card(d, compact) {
    var eye = hidden();
    var balance = d ? d.pending + d.onWay : 0;
    return '<div class="lvw-card' + (compact ? " is-compact" : "") + '">' +
      '<div class="lvw-top"><span class="lvw-label"><i class="fa-solid fa-wallet"></i> Wallet</span>' +
      '<button type="button" class="lvw-eye" onclick="lvWalletToggle()" aria-label="' + (eye ? "Show amounts" : "Hide amounts") + '"><i class="fa-regular ' + (eye ? "fa-eye-slash" : "fa-eye") + '"></i></button></div>' +
      '<div class="lvw-bal-label">Balance not yet in your bank</div>' +
      '<div class="lvw-bal">' + (d ? money(balance) : '<span class="lvw-skel"></span>') + '</div>' +
      '<div class="lvw-split">' +
        '<div><span>Pending</span><b>' + (d ? money(d.pending) : "—") + '</b><small>until the buyer confirms</small></div>' +
        '<div><span>On its way</span><b>' + (d ? money(d.onWay) : "—") + '</b><small>to your bank</small></div>' +
        '<div><span>Paid out</span><b>' + (d ? money(d.paidOut) : "—") + '</b><small>all time</small></div>' +
      '</div>' +
      '<div class="lvw-actions"><button type="button" class="lvw-btn" onclick="lvWalletHistory()"><i class="fa-solid fa-clock-rotate-left"></i> History</button>' +
      '<button type="button" class="lvw-btn lvw-btn-ghost" onclick="lvWalletHow()"><i class="fa-solid fa-circle-info"></i> How it works</button>' +
      (compact ? "" : '<button type="button" class="lvw-btn lvw-btn-ghost" onclick="openVendorPayoutSetup && openVendorPayoutSetup()"><i class="fa-solid fa-building-columns"></i> Bank</button>') + '</div>' +
      (d && !d.hasPayout ? '<button type="button" class="lvw-warn" onclick="openVendorPayoutSetup && openVendorPayoutSetup()"><i class="fa-solid fa-triangle-exclamation"></i> Add your bank account so we can pay you <i class="fa-solid fa-chevron-right"></i></button>' : "") +
    '</div>';
  }
  function paint() {
    var d = cache && cache.data;
    document.querySelectorAll("[data-lv-wallet]").forEach(function (el) { el.innerHTML = card(d, el.getAttribute("data-lv-wallet") === "compact"); });
  }
  async function refresh(force) {
    if (typeof vendor === "undefined" || !vendor) return;
    paint();
    await load(force);
    paint();
    var m = document.getElementById("lvwSheet"); if (m) m.querySelector(".lvw-sheet-body").innerHTML = sheetBody();
  }
  window.lvWalletToggle = function () { setHidden(!hidden()); paint(); var m = document.getElementById("lvwSheet"); if (m) m.querySelector(".lvw-sheet-body").innerHTML = sheetBody(); };

  function sheetBody() {
    var d = cache && cache.data;
    if (!d) return '<p class="muted" style="text-align:center;padding:1.5rem 0">Loading…</p>';
    var chips = [["all", "All"], ["pending", "Pending"], ["onway", "On its way"], ["paid", "Paid out"]];
    var rows = d.tx.filter(function (t) { return filter === "all" || t.state === filter; });
    return '<div class="lvw-sum"><div><span>Pending</span><b>' + money(d.pending) + '</b></div><div><span>On its way</span><b>' + money(d.onWay) + '</b></div><div><span>Paid out</span><b>' + money(d.paidOut) + '</b></div></div>' +
      '<div class="lvw-chips">' + chips.map(function (c) { return '<button type="button" class="lvw-chip' + (filter === c[0] ? " on" : "") + '" onclick="lvWalletFilter(\'' + c[0] + '\')">' + c[1] + '</button>'; }).join("") + '</div>' +
      (rows.length ? '<ul class="lvw-list">' + rows.map(function (t) {
        return '<li onclick="document.getElementById(\'lvwSheet\')?.remove();navigate(\'orderDetail\',{orderId:\'' + esc(t.id) + '\'})"><span class="lvw-ico ' + t.state + '"><i class="fa-solid ' + (t.state === "paid" ? "fa-arrow-down-long" : t.state === "onway" ? "fa-paper-plane" : "fa-hourglass-half") + '"></i></span>' +
          '<div class="lvw-li"><strong>Order #' + esc(String(t.id).slice(0, 8).toUpperCase()) + '</strong><small>' + LABEL[t.state] + " · " + esc(when(t.date)) + (t.comm ? " · after " + esc(money(t.comm)) + " commission" : "") + '</small></div>' +
          '<b class="lvw-amt ' + t.state + '">' + money(t.amount) + '</b></li>';
      }).join("") + '</ul>' : '<div class="lvw-empty"><i class="fa-regular fa-credit-card"></i><strong>Nothing here yet</strong><span>Payments made through Levromart appear here.</span></div>');
  }
  window.lvWalletFilter = function (f) { filter = f; var m = document.getElementById("lvwSheet"); if (m) m.querySelector(".lvw-sheet-body").innerHTML = sheetBody(); };
  function openSheet(title, bodyHtml, withEye) {
    var old = document.getElementById("lvwSheet"); if (old) old.remove();
    var m = document.createElement("div");
    m.id = "lvwSheet"; m.className = "modal lvw-sheet-wrap open";
    m.innerHTML = '<div class="modal-content lvw-sheet" role="dialog" aria-modal="true"><div class="lvw-sheet-head"><h3>' + esc(title) + '</h3>' + (withEye ? '<button type="button" class="lvw-eye" onclick="lvWalletToggle()" aria-label="Show or hide amounts"><i class="fa-regular fa-eye"></i></button>' : "") + '<button type="button" class="lvw-eye" onclick="document.getElementById(\'lvwSheet\').remove()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><div class="lvw-sheet-body">' + bodyHtml + '</div></div>';
    m.addEventListener("click", function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
  }
  window.lvWalletHistory = function () { filter = "all"; openSheet("Wallet history", sheetBody(), true); refresh(true); };
  window.lvWalletHow = function () {
    openSheet("How your wallet works",
      '<ul class="lvw-how"><li><b>Pending.</b> The buyer has paid through Levromart. We hold the money until they confirm they received the order, or 48 hours pass with no problem raised.</li>' +
      '<li><b>On its way.</b> The order is complete and your money is being sent to your bank. Bank transfers normally arrive the next business day; weekends and public holidays can add a day or two.</li>' +
      '<li><b>Paid out.</b> The money has been sent to your bank account.</li>' +
      '<li>Amounts are after Levromart\'s commission. Orders you were paid for directly (bank transfer to you) do not appear here.</li></ul>', false);
  };

  function wrapRenderers() {
    function wrapFn(name, build) {
      var f = window[name]; if (typeof f !== "function" || f.__lvw) return;
      var w = async function () { var html = await f.apply(this, arguments); var out = build(String(html == null ? "" : html), arguments); if (out !== null) setTimeout(function () { refresh(false); }, 30); return out === null ? html : out; };
      w.__lvw = true; window[name] = w;
    }
    // the shop's own full profile: the wallet takes the place of the top banner
    wrapFn("renderVendorDashboard", function (html) {
      if (typeof vendor === "undefined" || !vendor || html.indexOf("vendor-profile-header-card") < 0) return null;
      return '<div class="lvw" data-lv-wallet="full">' + card(cache && cache.data, false) + "</div>" + html;
    });
    // orders from customers: a slimmer wallet on top (not on "My purchases")
    wrapFn("renderVendorOrders", function (html, args) {
      if (typeof vendor === "undefined" || !vendor || (args[5] === "purchases") || html.indexOf("empty-state") === 0 && html.length < 200) return null;
      return '<div class="lvw" data-lv-wallet="compact">' + card(cache && cache.data, true) + "</div>" + html;
    });
  }
  wrapRenderers(); setTimeout(wrapRenderers, 1200); setTimeout(wrapRenderers, 4000);
})();
