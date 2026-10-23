/* ---- app-like motion: pages slide/fade in, and a re-render that changes nothing no longer wipes and redraws the screen ---- */
(function(){
  "use strict";
  var app=document.getElementById("app"); if(!app) return;
  var desc=Object.getOwnPropertyDescriptor(Element.prototype,"innerHTML"); if(!desc||!desc.set) return;
  var reduce=false; try{ reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(_){}
  var TABS={home:1,vendors:1,search:1,notifications:1,vendorOrders:1,buyerOrders:1,buyerProfile:1,vendorDashboard:1,requestEquipment:1,vendorRequests:1,cart:1,wishlist:1,messages:1};
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
     sig:function(n){ return Array.prototype.map.call(n.querySelectorAll(".home-promotional-slide:not([data-clone])"),function(b){ var i=b.querySelector("img"); return (i?(i.getAttribute("src")||""):"")+"|"+(b.getAttribute("data-link-url")||""); }).join(";"); },
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
      var prevView=last.view, self=this;
      KEEP.forEach(function(k){ var n=self.querySelector(k.sel); if(n) stash[k.sel]={node:n,sig:k.sig(n),scroll:k.scroll(n)}; });
      var liveBar=document.getElementById("lvCampusBar"); if(liveBar) window.__lvBarStash=liveBar;
      desc.set.call(this,v);
      KEEP.forEach(function(k){
        var st=stash[k.sel], nw=self.querySelector(k.sel);
        if(st&&nw&&nw!==st.node&&k.sig(nw)===st.sig){ nw.replaceWith(st.node); k.after(st.node,st.scroll); }
      });
      last={html:html,gen:g,view:vw};
      installSmart(this);
      if(reduce||!this.animate) return;
      if(sameNav){ animate(this,[{opacity:.6},{opacity:1}],150); return; }
      var chat=document.body&&document.body.classList.contains("chat-full-page");
      var tabSwitch=!!(TABS[prevView]&&TABS[vw]);
      if(chat) animate(this,[{opacity:0},{opacity:1}],180);
      else if(tabSwitch&&!goingBack) animate(this,[{opacity:0,transform:"translateY(8px)"},{opacity:1,transform:"none"}],170);
      else if(goingBack) animate(this,[{opacity:0,transform:"translateX(-22px)"},{opacity:1,transform:"none"}],190);
      else animate(this,[{opacity:0,transform:"translateX(26px)"},{opacity:1,transform:"none"}],190);
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
      openModal('<div class="lv-pm-head"><h3 id="lvPmTitle">We could not start the payment</h3></div><p class="lv-pm-err" role="alert">' + esc((r.error && r.error.message) || "Please try again.") + '</p><div class="lv-pm-actions"><button type="button" class="btn" onclick="document.getElementById(\'lvPayModal\')?.remove()">Close</button></div>');
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

  // After Paystack: "Confirming your payment…", then Paid or not completed. Used by the popup and the return link.
  window.lvConfirmPaystack = async function (reference, orderId) {
    openModal('<div class="lv-pm-head"><h3 id="lvPmTitle">Confirming your payment…</h3></div><p class="muted" role="status" aria-live="polite">This usually takes a few seconds. Please do not close the app.</p><div class="lv-pm-spin" aria-hidden="true"></div>');
    var outcome = await window.levroData.payments.confirm(reference);
    closeModal();
    if (outcome === "paid") showToast("Paid. Thank you!", "success");
    else if (outcome === "failed") showToast("Payment not completed. You were not charged. Please try again.", "error");
    else showToast("We could not confirm that payment yet. It may still be processing; check your order in a minute.", "info");
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
        if (!paid) return html;
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
