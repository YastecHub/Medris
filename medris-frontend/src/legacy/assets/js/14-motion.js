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
      '<div class="lvp-grab" aria-hidden="true"></div>' +
      '<div class="lvp-top"><span class="lvp-badge"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> Secure payment</span><button type="button" class="lvp-x" aria-label="Close" onclick="document.getElementById(\'lvPayModal\')?.remove()"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="lvp-amt-label" id="lvPmTitle">You pay</div><div class="lvp-amt">' + esc(naira(d.amountNaira)) + '</div>' +
      '<ul class="lvp-rows"><li><span>Order amount</span><b>' + esc(naira(d.orderAmountNaira)) + '</b></li><li><span>Payment fee</span><b>' + esc(naira(d.feeNaira)) + '</b></li></ul>' +
      '<p class="lvp-note"><i class="fa-solid fa-lock" aria-hidden="true"></i><span>Your money is held safely by Levromart. The vendor is paid only after you confirm you have your order.</span></p>' +
      '<button type="button" class="lvp-pay" id="lvPmGo">Pay ' + esc(naira(d.amountNaira)) + '</button>' +
      '<button type="button" class="lvp-cancel" onclick="document.getElementById(\'lvPayModal\')?.remove()">Cancel</button>', "lvp"
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
  var tab = "payouts", range = "today", picked = false;
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
  window.lvPayTab = function (t) { tab = t; picked = true; navigate("adminPayments", {}, false); };
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
    return '<div class="lv-ap-row"><div class="lv-ap-main"><b>' + naira(Number(w.amount_kobo) / 100) + "</b> " + chip + '<span class="badge ' + (w.status === "approved" ? "badge-success" : rej ? "badge-danger" : "badge-warning") + '">' + esc({ requested: "Waiting", approved: w.kind === "instant" ? "Sent at once" : "Approved", rejected: "Rejected" }[w.status] || w.status) + "</span> " + chg +
      "<small>" + esc(w.business_name || "") + " · " + when(w.created_at) + (age ? " · shop " + age + " day" + (age === 1 ? "" : "s") + " old" : "") + (w.bank_name ? " · " + esc(w.bank_name) + (w.account_name ? " (" + esc(w.account_name) + ")" : "") : "") + (rej && w.reject_reason ? " · Reason: " + esc(w.reject_reason) : "") + "</small>" + links + '</div><div class="lv-ap-acts">' + acts + "</div></div>";
  }
  window.lvPayRange = function (r) { range = r; navigate("adminPayments", {}, false); };

  function payoutRow(p) {
    var acts = "";
    if (["on_hold", "failed", "reversed"].indexOf(p.status) >= 0) acts += '<button class="btn btn-sm" onclick="lvPayAct(\'release\',\'' + esc(p.id) + '\')">Release</button>';
    if (p.status === "pending" || p.status === "failed") acts += '<button class="btn btn-sm btn-outline" onclick="lvPayAct(\'hold\',\'' + esc(p.id) + '\')">Hold</button>';
    // payouts are sent by Paystack on their own; "paid by hand" is only for a payout that failed or came back
    if (["failed", "reversed"].indexOf(p.status) >= 0) acts += '<button class="btn btn-sm btn-outline" onclick="lvPayAct(\'manual\',\'' + esc(p.id) + '\')">Paid outside Levromart</button>';
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
    var rows, wd = await sb.rpc("admin_list_withdrawals", { p_status: null });
    var wdRows = (wd && wd.data) || [], wdOpen = wdRows.filter(function (x) { return x.status === "requested"; }).length;
    var su = await sb.rpc("get_setup_status");
    var missing = (su && su.data && su.data.missing) || [];
    var cr = await sb.rpc("admin_list_cancellations", { p_status: null });
    var crRows = (cr && cr.data) || [], crOpen = crRows.filter(function (x) { return x.status === "requested"; }).length;
    if (window.lvPayPaint) window.lvPayPaint(wdOpen + crOpen);
    if (!picked && wdOpen) tab = "withdrawals"; else if (!picked && crOpen) tab = "cancellations";
    if (tab === "cancellations") rows = { data: crRows };
    else if (tab === "withdrawals") rows = { data: wdRows };
    else if (tab === "payouts") rows = await a.payouts(q);
    else if (tab === "held") rows = await a.payouts({ limit: 40, status: "on_hold" });
    else if (tab === "failed") rows = await a.payouts({ limit: 40, status: "failed" });
    else if (tab === "payments") rows = await a.transactions(q);
    else if (tab === "refunds") rows = await a.refunds(q);
    else rows = await a.reports();
    var list = ((rows && rows.data) || []).map(tab === "cancellations" ? cancelRow : tab === "withdrawals" ? withdrawalRow : tab === "payments" ? txRow : tab === "refunds" ? refundRow : tab === "checks" ? reportRow : payoutRow).join("") || '<p class="muted" style="text-align:center;">Nothing here.</p>';
    var tabs = [["withdrawals", "Withdrawals" + (wdOpen ? " (" + wdOpen + ")" : "")], ["cancellations", "Cancel requests" + (crOpen ? " (" + crOpen + ")" : "")], ["payouts", "Payouts"], ["held", "On hold" + (h.held_payouts ? " (" + h.held_payouts + ")" : "")], ["failed", "Failed" + (h.failed_payouts ? " (" + h.failed_payouts + ")" : "")], ["payments", "Payments"], ["refunds", "Refunds"], ["checks", "Daily checks"]];
    var pending = wdOpen + crOpen;
    var tiles = [["Collected", t.collected, "fa-arrow-down"], ["Refunded", t.refunded, "fa-rotate-left"], ["Paid to vendors", t.paidToVendors, "fa-arrow-up-right-from-square"], ["Commission", t.commission, "fa-percent"]];
    return nav + '<div class="ap-head"><h2>Payments</h2>' + (pending ? '<span class="ap-need"><b>' + pending + "</b> waiting for you</span>" : '<span class="ap-ok"><i class="fa-solid fa-circle-check"></i> All clear</span>') + "</div>" +
      (missing.length ? '<details class="ap-setup"><summary><i class="fa-solid fa-screwdriver-wrench"></i> ' + missing.length + ' feature' + (missing.length === 1 ? "" : "s") + ' not switched on yet</summary><p>Ask your engineer to apply these database changes:</p><ul>' + missing.map(function (m) { return "<li><b>" + esc(m.version) + "</b> " + esc(m.what) + "</li>"; }).join("") + "</ul></details>" : "") +
      (h.needsAttention ? '<div class="ap-note ap-warn" role="status"><i class="fa-solid fa-triangle-exclamation"></i> <span><b>' + h.needsAttention + ' thing(s) need attention.</b> Stuck or failed payouts and refunds, or a mismatch in the last daily check.</span></div>' : "") +
      '<div class="ap-card"><div class="ap-range">' + [["today", "Today"], ["week", "7 days"], ["month", "30 days"]].map(function (r) { return '<button class="' + (r[0] === range ? "active" : "") + '" onclick="lvPayRange(\'' + r[0] + '\')">' + r[1] + "</button>"; }).join("") + "</div>" +
      '<div class="ap-tiles">' + tiles.map(function (x) { return '<div class="ap-tile"><small>' + x[0] + "</small><b>" + naira(x[1]) + "</b></div>"; }).join("") + "</div></div>" +
      '<div class="ap-tabs" role="tablist">' + tabs.map(function (x) { var on = x[0] === tab; var m = /^(.*?)(?: \((\d+)\))?$/.exec(x[1]); return '<button role="tab" class="' + (on ? "active" : "") + '" onclick="lvPayTab(\'' + x[0] + '\')">' + esc(m[1]) + (m[2] ? '<i class="ap-n' + (x[0] === "withdrawals" || x[0] === "cancellations" ? " red" : "") + '">' + m[2] + "</i>" : "") + "</button>"; }).join("") + "</div>" +
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
        '<span class="lv-wv-badge"><i class="fa-solid fa-award"></i> Vendor of the week</span>' +
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
    { k: "store", act: "vendors", link: "?levro=vendors", label: "Your campus online store", h1: "Your campus", h2: "online store.", sub: "Shop products, book services and rent items from vendors on your campus.", cta: "Buy \u00b7 Sell \u00b7 Rent", ph: "follow", tiles: ["fa-cart-shopping", "fa-box", "fa-bag-shopping", "fa-tag", "star"] },
    { k: "follow", act: "links", link: "/links", label: "Follow us everywhere", h1: "Follow us", h2: "everywhere.", sub: 'Same name on every platform: <b>@levromart</b>', cta: "", ph: "store", tiles: ["star", "fa-bag-shopping", "fa-cart-shopping"], social: true, foot: "Tap our link in bio \u00b7 levromart.com/links" },
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
        sb.from("vendor_payouts").select("order_id,amount_kobo,status,hold_reason,withdrawal_id,created_at,updated_at").eq("vendor_id", v.id),
        sb.from("commission_charges").select("order_id,amount,status,created_at,paid_at").eq("vendor_id", v.id).order("created_at", { ascending: false }).limit(300),
        sb.rpc("get_vendor_commission_owed", { p_vendor_id: v.id }),
        sb.rpc("get_vendor_commission_deadline", { p_vendor_id: v.id }),
        sb.from("withdrawal_requests").select("id,status,kind,amount_kobo,has_dispute,reject_reason,created_at,decided_at").eq("vendor_id", v.id).order("created_at", { ascending: false }).limit(30)
      ]);
      var orders = (res[0] && res[0].data) || [], payouts = (res[1] && res[1].data) || [], charges = (res[2] && res[2].data) || [];
      var owed = Number((res[3] && res[3].data) || 0), dueAt = res[4] && res[4].data && res[4].data[0] ? res[4].data[0].earliest_due_at : null;
      var payoutBy = {}; payouts.forEach(function (p) { payoutBy[p.order_id] = p; });
      var commBy = {}; charges.forEach(function (c) { commBy[c.order_id] = (commBy[c.order_id] || 0) + Number(c.amount || 0); });
      var requests = (res[5] && res[5].data) || [];
      var tx = [], pending = 0, onWay = 0, paidOut = 0, ready = 0, held = 0, asked = 0, heldReason = "";
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
          else if (pay.status === "on_hold" && pay.hold_reason === "Waiting for the vendor to withdraw") state = o.status === "disputed" ? "held" : pay.withdrawal_id ? "asked" : "ready";
          else if (pay.status === "on_hold") { state = "held"; if (!heldReason) heldReason = pay.hold_reason || ""; }
          else state = "onway";
        } else if (o.status === "disputed") state = "held";
        else if (o.status === "completed") state = "onway";
        else state = "pending";
        if (state === "pending") pending += amount; else if (state === "ready") ready += amount; else if (state === "held") held += amount; else if (state === "asked") asked += amount; else if (state === "onway") onWay += amount; else paidOut += amount;
        var names = (o.items || []).map(function (i) { return i && i.product && i.product.name; }).filter(Boolean);
        var title = names.length ? names[0] + (names.length > 1 ? " +" + (names.length - 1) + " more" : "") : "Order";
        tx.push({ id: o.id, state: state, amount: amount, gross: gross, comm: comm, date: date, title: title });
      });
      tx.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
      var commissionTotal = charges.reduce(function (s, c) { return s + (c.status === "waived" ? 0 : Number(c.amount || 0)); }, 0);
      var data = { pending: pending, ready: ready, held: held, requests: requests, asked: asked, heldReason: heldReason, onWay: onWay, paidOut: paidOut, tx: tx, charges: charges, owed: owed, dueAt: dueAt, commissionTotal: commissionTotal, rate: Number(v.commission_pct ?? 3), hasPayout: !!(v.paystack_subaccount_code || v.transfer_recipient_code) };
      cache = { at: Date.now(), data: data };
      writeStored(data);
      return data;
    })().catch(function () { return null; }).finally(function () { loading = null; });
    return loading;
  }

  var LABEL = { pending: "Pending", ready: "Ready to withdraw", asked: "Awaiting approval", held: "On hold (dispute)", onway: "On its way", paid: "Paid out" };
  function card(d, compact) {
    var eye = hidden();
    var balance = d ? d.pending + d.onWay + (d.ready || 0) + (d.held || 0) + (d.asked || 0) : 0;
    return '<div class="lvw-card' + (compact ? " is-compact" : "") + '">' +
      '<div class="lvw-top"><span class="lvw-label"><i class="fa-solid fa-wallet"></i> Wallet</span>' +
      '<button type="button" class="lvw-eye" onclick="lvWalletToggle()" aria-label="' + (eye ? "Show amounts" : "Hide amounts") + '"><i class="fa-regular ' + (eye ? "fa-eye-slash" : "fa-eye") + '"></i></button></div>' +
      '<div class="lvw-bal-label">Balance not yet in your bank</div>' +
      '<div class="lvw-bal">' + (d ? money(balance) : '<span class="lvw-skel"></span>') + '</div>' +
      '<div class="lvw-split">' +
        '<div><span>Pending</span><b>' + (d ? money(d.pending) : "—") + '</b><small>until the buyer confirms</small></div>' +
        '<div><span>Ready</span><b>' + (d ? money(d.ready) : "—") + '</b><small>you can withdraw</small></div>' +
        '<div><span>On its way</span><b>' + (d ? money(d.onWay) : "—") + '</b><small>to your bank</small></div>' +
      '</div>' +
      (d && d.held > 0 ? '<div class="lvw-paidline lvw-asked"><i class="fa-solid fa-circle-exclamation"></i> On hold <b>' + money(d.held) + '</b>' + (d.heldReason ? ' · ' + esc(d.heldReason) : ' · dispute') + '</div>' : '') +
      (d && d.asked > 0 ? '<div class="lvw-paidline lvw-asked"><i class="fa-solid fa-hourglass-half"></i> Waiting for Levromart to approve your withdrawal <b>' + money(d.asked) + '</b></div>' : '') +
      '<div class="lvw-paidline">Paid out so far <b>' + (d ? money(d.paidOut) : "—") + '</b></div>' +
      '<div class="lvw-actions"><button type="button" class="lvw-btn lvw-btn-withdraw" onclick="lvWalletWithdraw()"><i class="fa-solid fa-building-columns"></i> Withdraw</button>' +
      '<button type="button" class="lvw-btn lvw-btn-ghost" onclick="navigate(\'vendorWallet\')"><i class="fa-solid fa-clock-rotate-left"></i> History</button>' +
      '<button type="button" class="lvw-btn lvw-btn-ghost" onclick="lvWalletHow()"><i class="fa-solid fa-circle-question"></i> Help</button>' +
      '</div>' +
      (d && !d.hasPayout ? '<button type="button" class="lvw-warn" onclick="lvGoToPayout()"><i class="fa-solid fa-triangle-exclamation"></i> Add your bank account so we can pay you <i class="fa-solid fa-chevron-right"></i></button>' : "") +
    '</div>';
  }
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
  setInterval(function () { if (!document.hidden && document.querySelector("[data-lv-wallet]") && Date.now() - lastLive > 15000) liveRefresh(); }, 20000);
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
          '<div class="lvw-li"><strong>' + esc(t.title) + '</strong><small>#' + esc(String(t.id).slice(0, 8).toUpperCase()) + " · " + LABEL[t.state] + " · " + esc(when(t.date)) + '</small>' + (t.comm ? '<small>Sale ' + esc(money(t.gross)) + ' − commission ' + esc(money(t.comm)) + '</small>' : "") + '</div>' +
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
    h += '<div class="lvw-wd-row"><span>Sent to your bank right now</span><b>' + NOW(inst) + '</b></div><small>Money paid for 48 hours ago or more.</small>' +
      '<div class="lvw-wd-row"><span>Needs Levromart\'s approval</span><b>' + NOW(appr) + '</b></div><small>Paid less than 48 hours ago. We check and reply, you will get a message.</small>';
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
      '<li><b>Ready.</b> The order is complete. Tap <b>Withdraw</b> to send it to your bank. Money paid 48 hours ago or more goes straight away; newer money is checked by Levromart first. An order with a dispute is held until it is settled.</li>' +
      '<li><b>On its way.</b> Your money is being sent to your bank. Bank transfers normally arrive the next business day; weekends and public holidays can add a day or two.</li>' +
      '<li><b>Paid out.</b> The money has been sent to your bank account.</li>' +
      '</ul>');
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
      return '<div class="lvw" data-lv-wallet="full">' + card((cache || (readStored(), cache)) && cache.data, false) + "</div>" + html;
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
  function card(d) {
    var pa = pendingAcct(), has = d && d.has_account, bal = d ? Number(d.available_kobo) : 0, pend = d ? Number(d.processing_kobo) : 0;
    return '<div class="lvw-card is-compact lvrw-card"><div class="lvw-top"><span class="lvw-label"><i class="fa-solid fa-rotate-left"></i> Refunds wallet</span></div>' +
      '<div class="lvw-bal-label">' + (has ? "Available to withdraw" : pa ? "Your refund account is saved" : "Refunds go here once you add a bank account") + '</div>' +
      '<div class="lvw-bal">' + (d || failed ? money(bal) : '<span class="lvw-skel"></span>') + '</div>' +
      (pend ? '<div class="lvrw-note">' + money(pend) + ' on its way to your bank</div>' : "") +
      '<div class="lvw-actions">' +
        (has ? '<button type="button" class="lvw-btn lvw-btn-withdraw" onclick="lvRefundWithdraw()"><i class="fa-solid fa-building-columns"></i> Withdraw</button>' : '<button type="button" class="lvw-btn lvw-btn-withdraw" onclick="lvRefundAccount()"><i class="fa-solid ' + (pa ? "fa-pen" : "fa-plus") + '"></i> ' + (pa ? "Change bank account" : "Add bank account") + '</button>') +
        '<button type="button" class="lvw-btn lvw-btn-ghost" onclick="lvRefundHistory()"><i class="fa-solid fa-clock-rotate-left"></i> History</button>' +
      '</div>' +
      (has ? '<div class="lvrw-acct"><i class="fa-solid fa-building-columns"></i> ' + esc(d.account.bank_name) + " · ···" + esc(d.account.last4) + ' <button type="button" onclick="lvRefundAccount()">Change</button></div>' : "") +
    '</div>';
  }
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

  window.lvRefundAccount = async function (fromPopup) {
    var m = sheet(fromPopup ? "Where should we send your refunds?" : "Refund bank account",
      '<p class="muted" style="margin:0 0 .8rem;font-size:.88rem;line-height:1.45">If an order is cancelled or a problem is settled in your favour, the money is put in your refunds wallet. You can withdraw it to this account any time. It must be an account in your own name. Check the details carefully: Levromart is not responsible for money sent to an account that was entered wrongly.</p>' +
      '<label class="lvrw-l">Bank</label><button type="button" class="lvrw-bankbtn" id="lvrwBankBtn"><span class="ve-bank-ico" id="lvrwBankIco"><i class="fa-solid fa-building-columns"></i></span><span id="lvrwBankLabel" class="lvrw-bank-label">Choose your bank</span><i class="fa-solid fa-chevron-down"></i></button>' +
      '<label class="lvrw-l">Account number</label><input id="lvrwNum" class="lvrw-in" inputmode="numeric" maxlength="10" placeholder="10 digits" autocomplete="off">' +
      '<p id="lvrwMsg" class="lvw-sheet-msg" hidden></p><div id="lvrwName" class="lvrw-name" hidden></div>' +
      '<button type="button" class="btn lvw-wd-go" id="lvrwGo">Check account</button>' + (fromPopup ? '<p class="muted" style="margin:.7rem 0 0;font-size:.78rem;text-align:center">This is required so any refund can reach you.</p>' : ""));
    if (fromPopup) {   // required: no close button, no tap-outside, no "Later"
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
      return '<div class="lvw lvrw" data-lv-rwallet>' + card(cache && cache.data) + "</div>" + str;
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

  // every customer must add a refund account: the form opens, cannot be closed, and comes back until one is saved
  async function ask() {
    if (document.hidden || !signedIn()) return;
    if (pendingAcct()) return;
    if (document.querySelector(".modal.open, #lvrwSheet, #lvCampus, #levromartSplash:not(.is-hidden), .onboarding-overlay, .lvw-sheet-wrap")) return;
    var d = await load(false);
    if (!d || d.has_account || pendingAcct()) return;
    window.lvRefundAccount(true);   // required: it comes back until a refund account is saved
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
      showToast("Couldn't open your current photo. Choose a new one instead.", "error");
      var inp = document.getElementById("avatarFileInput"); if (inp) inp.click();
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
      showToast("Couldn't open your current header. Choose a new one instead.", "error");
      var inp = document.getElementById("vendorCoverInput"); if (inp) inp.click();
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
  function showStickers() {
    document.querySelectorAll(".product-comment-body:not([data-stk])").forEach(function (b) {
      var m = /^::s:([0-9a-f-]+)::$/.exec((b.textContent || "").trim());
      b.dataset.stk = "1";
      if (m) b.innerHTML = '<img class="lv-stk" src="/stickers/' + m[1] + '.webp" alt="sticker" width="96" height="96" loading="lazy" decoding="async">';
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
      var panel = document.createElement("div"); panel.className = "lv-stk-panel hidden";
      STK.forEach(function (code) {
        var sb2 = document.createElement("button"); sb2.type = "button"; sb2.setAttribute("aria-label", "Send sticker");
        sb2.innerHTML = '<img src="/stickers/' + code + '.webp" alt="" width="48" height="48" loading="lazy" decoding="async">';
        sb2.onclick = function () { if (!session) { try { showLogin(); } catch (_) {} return; } panel.classList.add("hidden"); ta.value = "::s:" + code + "::"; ta.dispatchEvent(new Event("input", { bubbles: true })); send.click(); };
        panel.appendChild(sb2);
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
