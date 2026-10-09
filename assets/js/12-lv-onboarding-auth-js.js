/* ---- lv-onboarding-auth-js ---- */
(function(){
  "use strict";
  var KEY="levromart_onboarding_completed", mem=false;
  function $(id){return document.getElementById(id);}
  function isDone(){
    try{ if(localStorage.getItem(KEY)==="true") return true; }catch(e){}
    try{ if(sessionStorage.getItem(KEY)==="true") return true; }catch(e){}
    return mem;
  }
  function setDone(){
    mem=true;
    try{ localStorage.setItem(KEY,"true"); }catch(e){}
    try{ sessionStorage.setItem(KEY,"true"); }catch(e){}
  }

  /* ---------- Onboarding carousel ---------- */
  var root=$("lvOnb"), track=$("lvOnbTrack"), vp=$("lvOnbViewport");
  if(!root||!track||!vp) return;
  var slides=[].slice.call(root.querySelectorAll(".lv-slide"));
  var dots=[].slice.call(root.querySelectorAll(".lv-dot"));
  var nextBtn=$("lvOnbNext"), nextLbl=$("lvOnbNextLabel"), skipBtn=$("lvOnbSkip");
  var N=slides.length, idx=0;
  /* iOS Safari: 100vh includes the collapsing toolbars, so pin the screen to the real visible height */
  function fitH(){ var h=(window.visualViewport&&window.visualViewport.height)||window.innerHeight; if(h) root.style.setProperty("--lv-vh",Math.round(h)+"px"); }
  fitH(); window.addEventListener("resize",fitH); window.addEventListener("orientationchange",function(){setTimeout(fitH,250);});
  if(window.visualViewport) window.visualViewport.addEventListener("resize",fitH);

  function render(){
    track.style.transform="translate3d("+(-idx*100)+"%,0,0)";
    slides.forEach(function(s,i){s.classList.toggle("on",i===idx);s.setAttribute("aria-hidden",i===idx?"false":"true");});
    dots.forEach(function(d,i){d.setAttribute("aria-selected",i===idx?"true":"false");});
    nextLbl.textContent=idx===N-1?"Get Started":"Continue";
    skipBtn.classList.toggle("gone",idx===N-1);
    skipBtn.tabIndex=idx===N-1?-1:0;
  }
  function openAuth(){
    var m=$("loginModal");
    if(m&&!m.classList.contains("hidden")) return;
    if(typeof showLogin==="function") showLogin();
  }
  function showOnb(){
    root.hidden=false;
    document.documentElement.classList.add("lv-lock");
    render();
    try{ root.focus({preventScroll:true}); }catch(e){}
  }
  function hideOnb(){
    root.hidden=true;
    document.documentElement.classList.remove("lv-lock");
  }
  function finish(){ setDone(); hideOnb(); openAuth(); }
  function go(i){
    if(i>=N){ finish(); return; }
    idx=Math.max(0,i); render();
  }
  nextBtn.addEventListener("click",function(){go(idx+1);});
  skipBtn.addEventListener("click",finish);
  dots.forEach(function(d,i){d.addEventListener("click",function(){go(i);});});
  document.addEventListener("keydown",function(e){
    if(root.hidden) return;
    if(e.key==="ArrowRight") go(idx+1);
    else if(e.key==="ArrowLeft") go(idx-1);
  });

  /* swipe: light pointer-events drag, no scroll listeners */
  var sx=0, sy=0, dx=0, dragging=false, locked=false, down=false;
  vp.addEventListener("pointerdown",function(e){
    if(e.pointerType==="mouse"&&e.button!==0) return;
    down=true; dragging=false; locked=false; sx=e.clientX; sy=e.clientY; dx=0;
  });
  vp.addEventListener("pointermove",function(e){
    if(!down) return;
    var mx=e.clientX-sx, my=e.clientY-sy;
    if(!dragging&&!locked){
      if(Math.abs(my)>Math.abs(mx)&&Math.abs(my)>10){locked=true;return;}
      if(Math.abs(mx)>8){dragging=true; track.style.setProperty("transition","none","important"); try{vp.setPointerCapture(e.pointerId);}catch(_){}}
    }
    if(dragging){
      dx=mx;
      if((idx===0&&dx>0)||(idx===N-1&&dx<0)) dx*=.35;
      track.style.transform="translate3d(calc("+(-idx*100)+"% + "+dx+"px),0,0)";
    }
  });
  function endDrag(){
    if(!down) return; down=false;
    if(dragging){
      track.style.removeProperty("transition");
      var w=vp.clientWidth||1, th=Math.min(60,w*.18);
      if(dx<-th) go(idx+1); else if(dx>th) go(idx-1); else render();
    }
    dragging=false;
  }
  vp.addEventListener("pointerup",endDrag);
  vp.addEventListener("pointercancel",endDrag);

  /* ---------- Auth state hook (called from the app's existing onAuthStateChange) ---------- */
  window.__lvOnAuthChange=function(ev,sess){
    if(sess&&sess.user&&(ev==="SIGNED_IN"||ev==="INITIAL_SESSION"||ev==="TOKEN_REFRESHED")){
      setDone();
      if(!root.hidden) hideOnb();
    }
  };

  /* ---------- First-visit / returning-user decision ---------- */
  var href=location.search+location.hash;
  var authReturn=/access_token|refresh_token|type=recovery|error_description|[?&]code=/.test(href);
  var publicLink=/[?&](product|storefront|package|share)=/.test(location.search);
  var UNKNOWN={};
  function readSession(){
    var fromApp=null; try{ fromApp=(typeof session!=="undefined"&&session)||null; }catch(e){}
    if(fromApp) return Promise.resolve(fromApp);
    if(typeof sb==="undefined"||!sb.auth||!sb.auth.getSession) return Promise.resolve(UNKNOWN);
    return Promise.race([
      sb.auth.getSession().then(function(r){return (r&&r.data&&r.data.session)||null;}),
      new Promise(function(res){setTimeout(function(){res(UNKNOWN);},4000);})
    ]).catch(function(){return UNKNOWN;});
  }
  function boot(){
    if(publicLink) return;                       // shared product/store links open directly
    var shownNow=!isDone()&&!authReturn;
    if(shownNow) showOnb();                      // brand-new visitor: no flash of the marketplace
    readSession().then(function(sess){
      if(sess===UNKNOWN) return;                 // offline / slow auth: never trap the user
      if(sess){ setDone(); if(!root.hidden) hideOnb(); return; }
      if(isDone()) { if(root.hidden) openAuth(); }
      else if(root.hidden) showOnb();
    });
  }

  /* ---------- Authentication page behaviour ---------- */
  var COPY={
    login:{e:"Welcome back",h:"Welcome <em>back.</em>",p:"Sign in to your LevroMart account and continue exploring great products, services and opportunities.",btn:"Sign In",sw:"Don't have an account?",swl:"Create Account",next:"register"},
    register:{e:"Join LevroMart",h:"Create your <em>account.</em>",p:"Create your LevroMart account and start discovering what is around you.",btn:"Create Account",sw:"Already have an account?",swl:"Sign In",next:"login"},
    forgot:{e:"Account recovery",h:"Reset your <em>password.</em>",p:"Enter your account email and we will send you a link to set a new password.",btn:"Send Reset Link"}
  };
  function currentMode(){ try{ return authMode; }catch(e){ return "login"; } }
  function syncAuth(){
    var m=currentMode(), c=COPY[m]||COPY.login;
    var el;
    if((el=$("lvAuthEyebrow"))) el.textContent=c.e;
    if((el=$("lvAuthHeadline"))) el.innerHTML=c.h;
    if((el=$("lvAuthSub"))) el.textContent=c.p;
    if((el=$("authSubmitBtn"))) el.textContent=c.btn;
    var sw=$("lvAuthSwitch");
    if(sw){ sw.classList.toggle("hidden",m==="forgot"); if(c.sw){ $("lvSwitchText").textContent=c.sw; $("lvSwitchLink").textContent=c.swl; } }
    var row=$("lvLoginRow"); if(row) row.classList.toggle("hidden",m!=="login");
    var body=$("lvFormBody");
    if(body){ body.classList.remove("lv-in"); void body.offsetWidth; body.classList.add("lv-in"); }
  }
  if(typeof window.applyAuthMode==="function"){
    var origApply=window.applyAuthMode;
    window.applyAuthMode=function(){ var r=origApply.apply(this,arguments); try{syncAuth();}catch(e){} return r; };
  }
  var swl=$("lvSwitchLink");
  if(swl) swl.addEventListener("click",function(e){ e.preventDefault(); var c=COPY[currentMode()]; if(c&&c.next&&typeof setAuthMode==="function") setAuthMode(c.next); });

  /* "Keep me signed in": unchecked => session is dropped when the browser is fully closed */
  function applyKeep(){
    try{
      var c=$("lvKeepSignedIn");
      if(currentMode()==="login"&&c&&!c.checked) localStorage.setItem("lv_session_only","1");
      else localStorage.removeItem("lv_session_only");
    }catch(e){}
  }
  ["submitAuth","signInWithGoogle"].forEach(function(n){
    var o=window[n]; if(typeof o!=="function") return;
    window[n]=function(){ applyKeep(); return o.apply(this,arguments); };
  });

  /* Enter key submits the form */
  var modal=$("loginModal");
  if(modal) modal.addEventListener("keydown",function(e){
    if(e.key!=="Enter"||e.target.tagName!=="INPUT"||e.target.type==="checkbox") return;
    var b=$("authSubmitBtn");
    if(b&&!b.disabled&&typeof window.submitAuth==="function"){ e.preventDefault(); window.submitAuth(); }
  });


  /* The Levi feature tour must not pop over onboarding / the auth page */
  function gateOpen(){ var m=$("loginModal"); return !root.hidden||(m&&!m.classList.contains("hidden")); }
  ["maybeShowTour","showTour"].forEach(function(n){
    var o=window[n]; if(typeof o!=="function") return;
    window[n]=function(){ if(gateOpen()) return; return o.apply(this,arguments); };
  });

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot); else boot();
})();

/* ---- levromart-flat-infinite-js ---- */
(function () {
  "use strict";
  var CARD_SEL = "id, name, category_id, listing_type, sale_price, discount_price, rental_rate, rental_rate_unit, photos, quantity_available, condition, is_service, service_price_unit, payment_timing, payment_deposit_percent, delivery_fee, delivery_fee_mode, delivery_fee_per_km, view_count, vendor:vendors!inner(id, business_name, verification_status, logo_url, delivery_fee, delivery_fee_mode, delivery_fee_per_km, lat, lng), category:categories(sector_id)";
  var SEARCH_SEL = "id,name,photos,sale_price,discount_price,rental_rate,rental_rate_unit,is_service,listing_type,service_price_unit,category:categories(sector_id),vendor:vendors!inner(id,business_name,verification_status,is_active,lat,lng,avg_rating,review_count)";

  // Real-time cart badge: re-read the true count straight after any add.
  window.lmSyncCartCount = async function () {
    try {
      if (typeof session === "undefined" || !session) return;
      window.__cartCountAt = 0;
      var r = await sb.from("cart_items").select("id", { count: "exact", head: true }).eq("buyer_id", session.user.id);
      if (r.error) return;
      window.__cartCountVal = r.count || 0; window.__cartCountAt = Date.now();
      buyerCartCount = r.count || 0; updateCartFab();
    } catch (_) {}
  };

  function infinite(host, load, before) {
    var s = document.createElement("div"); s.className = "lm-sentinel"; s.style.minHeight = "1px";
    host.appendChild(s);
    var busy = false, done = false;
    var io = new IntersectionObserver(async function (es) {
      if (!es[0].isIntersecting || busy || done) return;
      busy = true;
      try { var more = await load(s); if (!more) { done = true; io.disconnect(); s.remove(); } } catch (_) { done = true; io.disconnect(); s.remove(); }
      busy = false;
      if (!done) { io.unobserve(s); io.observe(s); }
    }, { rootMargin: "700px" });
    io.observe(s);
  }

  // ---- Search page: endless "Suggested for you" / "Popular right now"
  function initSearchInfinite(sec) {
    sec.dataset.lmInf = "1";
    var offset = 0, PAGE = 20;
    infinite(sec, async function (sentinel) {
      for (var tries = 0; tries < 4; tries++) {
        var r = await sb.from("products").select(SEARCH_SEL).eq("status", "active")
          .eq("vendor.verification_status", "verified").eq("vendor.is_active", true)
          .order("view_count", { ascending: false }).order("id").range(offset, offset + PAGE - 1);
        if (r.error || !r.data || !r.data.length) return false;
        offset += PAGE;
        var seen = window.__searchResultProducts || new Map();
        var fresh = r.data.filter(function (p) { return !seen.has(String(p.id)); });
        if (fresh.length) { sentinel.insertAdjacentHTML("beforebegin", fresh.map(searchProductRowHtml).join("")); return r.data.length === PAGE; }
        if (r.data.length < PAGE) return false;
      }
      return true;
    });
  }

  // ---- Product page: related products, same category first, then same sector, then everything
  var origDetail = window.renderProductDetail;
  if (typeof origDetail === "function") {
    window.renderProductDetail = async function (productId) {
      var html = await origDetail.apply(this, arguments);
      if (typeof html !== "string") return html;
      return html + '<section class="lm-related" data-pid="' + String(productId).replace(/[^\w-]/g, "") + '"><h3 class="lm-related-title">You may also like</h3><div class="grid lm-related-grid"></div></section>';
    };
  }
  async function initRelated(sec) {
    sec.dataset.lmInit = "1";
    var pid = sec.dataset.pid, grid = sec.querySelector(".lm-related-grid");
    var p = (await sb.from("products").select("id,category_id,category:categories(sector_id)").eq("id", pid).maybeSingle()).data || {};
    var catId = p.category_id, sectorId = p.category && p.category.sector_id, sectorCats = [];
    if (sectorId) { var cs = await sb.from("categories").select("id").eq("sector_id", sectorId); sectorCats = (cs.data || []).map(function (c) { return c.id; }); }
    var stage = catId ? 0 : (sectorCats.length ? 1 : 2), off = 0, PAGE = 12, seen = new Set([pid]);
    async function page() {
      while (stage <= 2) {
        var q = sb.from("products").select(CARD_SEL).eq("status", "active")
          .eq("vendor.verification_status", "verified").eq("vendor.is_active", true)
          .order("view_count", { ascending: false }).order("id");
        if (stage === 0) q = q.eq("category_id", catId); else if (stage === 1) q = q.in("category_id", sectorCats);
        var r = await q.range(off, off + PAGE - 1);
        if (r.error) return false;
        var rows = r.data || [];
        if (rows.length < PAGE) { stage++; off = 0; } else off += PAGE;
        var fresh = rows.filter(function (x) { if (seen.has(x.id)) return false; seen.add(x.id); return true; });
        if (fresh.length) { grid.insertAdjacentHTML("beforeend", fresh.map(productCardHtml).join("")); return true; }
      }
      return false;
    }
    var first = await page();
    if (!first) { sec.remove(); return; }
    infinite(sec, page);
  }

  function scan() {
    document.querySelectorAll(".search-page-section:not([data-lm-inf])").forEach(function (sec) {
      var h = sec.querySelector("h3"); var t = h ? h.textContent : "";
      if (/Suggested for you|Popular right now/i.test(t)) initSearchInfinite(sec);
    });
    document.querySelectorAll(".lm-related:not([data-lm-init])").forEach(function (sec) { initRelated(sec).catch(function () { sec.remove(); }); });
  }
  var host = document.getElementById("app") || document.body, tm = null;
  new MutationObserver(function () { clearTimeout(tm); tm = setTimeout(scan, 120); }).observe(host, { childList: true, subtree: true });
})();

/* ---- levromart-gallery-variety-follow ---- */
/* While the main product photo is swiped, keep the green-outlined variety in view and following it. */
(function(){
  function centerActive(){
    var list=document.querySelector('#productGalleryVarieties .product-gallery-varieties-list'); if(!list) return;
    var a=list.querySelector('.product-gallery-variety.active'); if(!a) return;
    var l=list.getBoundingClientRect(), b=a.getBoundingClientRect();
    var target=list.scrollLeft+(b.left-l.left)-(l.width-b.width)/2;
    if(Math.abs(b.left+b.width/2-(l.left+l.width/2))>2) list.scrollTo({left:Math.max(0,target),behavior:'smooth'});
  }
  function wrap(){
    var orig=window.selectProductVariant; if(typeof orig!=='function'||orig.__lvWrapped) return;
    var w=function(){ var r=orig.apply(this,arguments); try{centerActive();}catch(_){} return r; };
    w.__lvWrapped=true; window.selectProductVariant=w;
  }
  wrap(); document.addEventListener('DOMContentLoaded',wrap); window.addEventListener('load',wrap);
})();

/* ---- levromart-search-vendor-row ---- */
(function(){
  var KEY="lv_recent_vendors", MAX=14;
  function rd(){try{var a=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(a)?a:[];}catch(_){return [];}}
  function wr(a){try{localStorage.setItem(KEY,JSON.stringify(a.slice(0,MAX)));}catch(_){}}
  function ee(x){return (typeof esc==="function")?esc(x):String(x==null?"":x).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
  function item(v){
    var nm=v.business_name||"Vendor";
    var ini=ee(typeof initials==="function"?initials(nm).slice(0,2):String(nm).trim().charAt(0).toUpperCase());
    var hue=typeof stableAvatarHue==="function"?stableAvatarHue(v.id||nm):0;
    var ico=v.logo_url?'<img src="'+ee(v.logo_url)+'" alt="" loading="lazy" draggable="false" onerror="this.remove()">':ini;
    return '<button type="button" class="lv-svr-item" data-vid="'+ee(v.id)+'"><span class="lv-svr-ico" style="'+(v.logo_url?'':'background:hsl('+hue+' 55% 91%)!important;color:hsl('+hue+' 55% 26%)!important;')+'">'+ico+'</span><span class="lv-svr-name">'+ee(v.business_name||"Vendor")+'</span></button>';
  }
  // remember vendors opened from the search page
  function hookNav(){
    var o=window.navigate; if(typeof o!=="function"||o.__lvSv) return;
    var w=function(view,params){
      try{ if(view==="storefront"&&params&&params.vendorId&&typeof currentView!=="undefined"&&currentView==="search"){
        var id=String(params.vendorId); wr([id].concat(rd().filter(function(x){return x!==id;})));
      } }catch(_){}
      return o.apply(this,arguments);
    };
    w.__lvSv=true; window.navigate=w;
  }
  hookNav(); window.addEventListener("load",hookNav);
  var raf=0;
  function autoScroll(row){
    if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var paused=false,t=0,pos=0;
    function pause(){paused=true;clearTimeout(t);} function resume(){clearTimeout(t);t=setTimeout(function(){pos=row.scrollLeft;paused=false;},1800);}
    row.addEventListener("touchstart",pause,{passive:true});row.addEventListener("touchend",resume,{passive:true});
    row.addEventListener("pointerdown",pause);row.addEventListener("pointerup",resume);row.addEventListener("wheel",function(){pause();resume();},{passive:true});
    cancelAnimationFrame(raf);
    (function step(){
      if(!row.isConnected) return;
      if(!paused){ pos+=0.35; var half=row.scrollWidth/2; if(half>0&&pos>=half) pos-=half; row.scrollLeft=pos; }
      raf=requestAnimationFrame(step);
    })();
  }
  async function build(){
    var host=document.getElementById("searchPageResults");
    if(!host||document.getElementById("lvSearchVendors")||typeof sb==="undefined") return;
    if((document.getElementById("searchPageInput")||{}).value) return;
    var ids=rd(), vendors=[], recent=false, recentV=[];
    var wrap=document.createElement("div"); wrap.id="lvSearchVendors"; wrap.className="lv-svr";
    try{
      var r2=await sb.from("vendors").select("id,business_name,logo_url").eq("verification_status","verified").eq("is_active",true).limit(80);
      vendors=(r2.data||[]).sort(function(){return Math.random()-.5;});
    }catch(_){return;}
    if(!vendors.length||document.getElementById("lvSearchVendors")||!document.getElementById("searchPageResults")) return;
    if((document.getElementById("searchPageInput")||{}).value) return;
    var items=vendors.map(item).join(""); recent=false;
    wrap.innerHTML=(recentV.length?'<div class="lv-svr-head"><strong>Recently viewed</strong><button type="button" class="lv-svr-clear">Clear all</button></div><div class="lv-svr-row lv-svr-recent">'+recentV.map(item).join("")+'</div>':'')+'<div class="lv-svr-head"><strong>Suggested vendors</strong></div><div class="lv-svr-row">'+items+'</div>';
    host.insertAdjacentElement("afterbegin",wrap);
    var row=wrap.querySelector(".lv-svr-row:not(.lv-svr-recent)");
    wrap.addEventListener("click",function(e){
      var c=e.target.closest(".lv-svr-clear"); if(c){wr([]);wrap.remove();return;}
      var b=e.target.closest(".lv-svr-item"); if(b) navigate("storefront",{vendorId:b.getAttribute("data-vid")});
    });

    
  }
  function wrapSug(){
    var o=window.renderSearchPageSuggestions; if(typeof o!=="function"||o.__lvSv) return;
    var w=function(force){ if(!force){try{build();}catch(_){}} return o.apply(this,arguments); };
    w.__lvSv=true; window.renderSearchPageSuggestions=w;
  }
  wrapSug(); window.addEventListener("load",wrapSug);
})();
/* Vendors map: tapping a marker must never move the page. */
(function(){
  var until=0,keep=0;
  function inMap(t){return t&&t.closest&&t.closest("#vendorsMap,.leaflet-popup,.leaflet-marker-icon");}
  function arm(e){ if(!inMap(e.target)) return; keep=window.scrollY; until=Date.now()+1200; [0,50,120,250,450,800,1100].forEach(function(ms){setTimeout(fix,ms);}); }
  function fix(){ if(Date.now()<until+50 && Math.abs((window.scrollY||0)-keep)>2) window.scrollTo(0,keep); }
  ["pointerdown","touchstart","click"].forEach(function(ev){document.addEventListener(ev,arm,true);});
  window.addEventListener("scroll",function(){ if(Date.now()<until) fix(); },{passive:true});
  document.addEventListener("focusin",function(e){ if(inMap(e.target)&&e.target.focus){ /* keep preventScroll */ } },true);
  // markers: no keyboard-focus jump
  var tries=0,iv=setInterval(function(){
    if(window.L&&L.Marker&&!L.Marker.__lvNoKb){ L.Marker.__lvNoKb=true; L.Marker.mergeOptions({keyboard:false}); }
    if(window.L&&L.Popup&&!L.Popup.__lvNoPan){ L.Popup.__lvNoPan=true; L.Popup.mergeOptions({autoPan:false}); }
    if((window.L&&L.Marker.__lvNoKb)||++tries>60) clearInterval(iv);
  },500);
})();

/* ---- lm-b3-js ---- */
/* Trending Now row: endless horizontal loop (3 copies, silently re-centred) */
(function(){
  function setup(row){
    if(row.__lmLoop||row.children.length<4) return;
    row.__lmLoop=true;
    var orig=[].slice.call(row.children);
    [0,1].forEach(function(){orig.forEach(function(n){var c=n.cloneNode(true);c.setAttribute("aria-hidden","true");row.appendChild(c);});});
    var snap=row.style.scrollSnapType; row.style.scrollSnapType="none";
    requestAnimationFrame(function(){
      var w=row.scrollWidth/3; if(!w){return;}
      row.scrollLeft=w; row.style.scrollSnapType=snap;
      row.addEventListener("scroll",function(){
        var w=row.scrollWidth/3, x=row.scrollLeft;
        if(x<w*0.4) row.scrollLeft=x+w; else if(x>w*1.6) row.scrollLeft=x-w;
      },{passive:true});
    });
  }
  var t=0;
  function scan(){ t=0; document.querySelectorAll("#app .hscroll.trending-scroll:not(.service-trending-scroll)").forEach(setup); }
  new MutationObserver(function(){ if(!t) t=setTimeout(scan,150); }).observe(document.documentElement,{childList:true,subtree:true});
})();
/* 30-second in-app reminders (while the app is open): unread chats, unfinished orders */
(function(){
  function run(){
    try{
      if(document.hidden||typeof session==="undefined"||!session) return;
      Promise.resolve(typeof refreshNotifications==="function"?refreshNotifications():null).catch(function(){}).then(function(){
        var m=Number(typeof unreadMessageCount!=="undefined"?unreadMessageCount:0)||0;
        var o=(Number(typeof buyerPendingOrderCount!=="undefined"?buyerPendingOrderCount:0)||0)+(Number(typeof vendorPendingOrderCount!=="undefined"?vendorPendingOrderCount:0)||0);
        var v=typeof currentView!=="undefined"?currentView:"";
        if(m>0&&!/message|chat|conversation/i.test(v)) showToast("You have "+m+" unread message"+(m===1?"":"s"),"info");
        if(o>0&&!/order/i.test(v)) showToast(o+" order"+(o===1?"":"s")+" still need"+(o===1?"s":"")+" attention","info");
      });
    }catch(_){}
  }
  setInterval(run,30000);
})();
/* DM chat: scroll-down arrow (only when scrolled up); search page suggestions never vanish */
(function(){
  function wire(){
    var m=document.getElementById("chatMessages");
    if(!m||m.dataset.lmDown==="1") return;
    m.dataset.lmDown="1";
    var host=m.parentElement; if(!host) return;
    if(getComputedStyle(host).position==="static") host.style.position="relative";
    var b=document.createElement("button"); b.type="button"; b.className="lm-chat-down hidden"; b.setAttribute("aria-label","Scroll to latest message"); b.innerHTML='<i class="fa-solid fa-arrow-down"></i>';
    b.onclick=function(){ m.scrollTo({top:m.scrollHeight,behavior:"smooth"}); };
    host.appendChild(b);
    function upd(){ b.classList.toggle("hidden", m.scrollHeight-m.scrollTop-m.clientHeight<140); }
    m.addEventListener("scroll",upd,{passive:true}); upd();
  }
  var tries=0;
  function searchGuard(){
    var res=document.getElementById("searchPageResults"), inp=document.getElementById("searchPageInput");
    if(!res||!inp||inp.value.trim()){tries=0;return;}
    if(!res.querySelector(".search-page-section")&&tries<4&&typeof renderSearchPageSuggestions==="function"){ tries++; try{renderSearchPageSuggestions();}catch(_){} }
  }
  var t=0;
  new MutationObserver(function(){ if(t) return; t=setTimeout(function(){ t=0; wire(); },120); }).observe(document.documentElement,{childList:true,subtree:true});
  setInterval(searchGuard,2500);
})();
/* stagger-in for the vendor application page */
(function(){
  var t=0;
  function go(){
    t=0; var p=document.querySelector("#app .va-page"); if(!p||p.dataset.lmAnim==="1"||!p.animate) return; p.dataset.lmAnim="1";
    var ch=p.querySelector(".va-char"); if(ch) try{ ch.animate([{transform:"translateY(0)"},{transform:"translateY(-9px)"},{transform:"translateY(0)"}],{duration:4600,iterations:Infinity,easing:"ease-in-out"}); }catch(_){}
    [].slice.call(p.querySelectorAll(".va-chip")).forEach(function(c,i){ try{ c.animate([{transform:"translateY(0)"},{transform:"translateY(-7px)"},{transform:"translateY(0)"}],{duration:3200+i*700,iterations:Infinity,easing:"ease-in-out"}); }catch(_){} });
    [].slice.call(p.children).slice(0,14).forEach(function(c,i){ try{ c.animate([{opacity:0,transform:"translateY(14px)"},{opacity:1,transform:"none"}],{duration:420,delay:i*55,easing:"cubic-bezier(.2,.8,.2,1)",fill:"backwards"}); }catch(_){} });
  }
  new MutationObserver(function(){ if(!t) t=setTimeout(go,60); }).observe(document.documentElement,{childList:true,subtree:true});
})();
window.lmFilterFollowing=function(q){q=String(q||"").trim().toLowerCase();document.querySelectorAll(".customer-following-card").forEach(function(c){c.style.display=(!q||c.textContent.toLowerCase().indexOf(q)>-1)?"":"none";});};
/* suggested vendors: endless manual loop (3 copies, silently re-centred) */
(function(){
  function setup(row){
    if(row.__lmLoop||row.children.length<4) return; row.__lmLoop=true;
    var orig=[].slice.call(row.children);
    [0,1].forEach(function(){orig.forEach(function(n){var c=n.cloneNode(true);c.setAttribute("aria-hidden","true");c.tabIndex=-1;row.appendChild(c);});});
    requestAnimationFrame(function(){
      var w=row.scrollWidth/3; if(!w) return; row.scrollLeft=w;
      row.addEventListener("scroll",function(){ var w=row.scrollWidth/3,x=row.scrollLeft; if(x<w*0.4) row.scrollLeft=x+w; else if(x>w*1.6) row.scrollLeft=x-w; },{passive:true});
    });
  }
  var t=0;
  new MutationObserver(function(){ if(t) return; t=setTimeout(function(){ t=0; document.querySelectorAll("#lvSearchVendors .lv-svr-row:not(.lv-svr-recent)").forEach(setup); },150); }).observe(document.documentElement,{childList:true,subtree:true});
})();
window.lmConvTab=function(t){var l=document.querySelector(".admin-conv-list");if(l)l.setAttribute("data-tab",t);document.querySelectorAll("[data-conv-tab]").forEach(function(a){a.classList.toggle("active",a.getAttribute("data-conv-tab")===t);});};
/* presence heartbeat: tells the server the app is open, so pushes stay inside the app */
(function(){
  var last=0;
  function beat(){ try{ if(typeof session!=="undefined"&&session&&!document.hidden&&Date.now()-last>15000){ last=Date.now(); Promise.resolve(sb.rpc("touch_presence")).catch(function(){}); } }catch(_){} }
  setInterval(beat,20000); document.addEventListener("visibilitychange",function(){ if(document.hidden){ try{ if(session) Promise.resolve(sb.rpc("clear_presence")).catch(function(){}); }catch(_){} last=0; } else beat(); });
  window.addEventListener("pagehide",function(){ try{ if(session) sb.rpc("clear_presence"); }catch(_){} });
  window.addEventListener("load",function(){ setTimeout(beat,2500); });
})();

/* ===== Admin skin helpers: body[data-view], expandable table rows, nav badges ===== */
(function(){
  const origNav=window.navigate;
  if(typeof origNav==="function"&&!origNav.__lvView){
    const w=async function(view,...rest){ try{document.body.setAttribute("data-view",String(view||"home"));}catch(_){} return origNav.call(this,view,...rest); };
    w.__lvView=true; window.navigate=w;
  }
  const MAPS=[
    {sig:["name","email"],t:"name",s:"email",c:"status"},
    {sig:["product","vendor"],t:"product",s:"vendor",c:"status"},
    {sig:["person","event"],t:"person",s:"email",c:"event"},
    {sig:["admin","action"],t:"target",s:"admin",c:"action"},
  ];
  function tag(table){
    const heads=[...table.querySelectorAll("thead th")].map(th=>th.textContent.trim().toLowerCase());
    if(!heads.length) return;
    const m=MAPS.find(m=>m.sig.every(x=>heads.includes(x)));
    if(!m) return;
    table.classList.add("ad-xt");
    const idx=k=>heads.indexOf(k);
    const ti=idx(m.t),si=idx(m.s),ci=idx(m.c);
    table.querySelectorAll("tbody tr").forEach(tr=>{
      if(tr.dataset.adx==="1") return;
      const tds=[...tr.children];
      if(tds.length!==heads.length){ tr.dataset.adx="1"; return; }
      tds.forEach((td,i)=>{
        const h=heads[i]; td.dataset.label=h.replace(/^\w/,c=>c.toUpperCase());
        if(i===ti) td.classList.add("ad-t"); else if(i===si) td.classList.add("ad-s"); else if(i===ci) td.classList.add("ad-c");
        else if(h==="#") td.classList.add("ad-n");
        else if(h==="action"){ td.classList.add("ad-a"); td.removeAttribute("data-label"); }
      });
      tr.dataset.adx="1";
    });
  }
  let t=null;
  function scan(){ t=null; if(!/^admin/.test(document.body.getAttribute("data-view")||"")) return; document.querySelectorAll("#app table").forEach(tag); }
  new MutationObserver(()=>{ if(!t) t=setTimeout(scan,60); }).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener("click",(e)=>{
    const tr=e.target.closest&&e.target.closest("table.ad-xt tr");
    if(!tr||!tr.parentElement||tr.parentElement.tagName!=="TBODY") return;
    if(e.target.closest("button,a,select,input,textarea")) return;
    tr.classList.toggle("open");
  });
  // total badge on the "Admin section" picker + keep it fresh
  function syncPick(){
    const pick=document.querySelector("#app .admin-nav-pick"); if(!pick) return;
    let n=0; document.querySelectorAll("#app .admin-dash-tabs .dash-tab-dot:not(.hidden)").forEach(d=>{ const v=parseInt(String(d.textContent).replace(/\D/g,""),10); if(v>0) n+=v; });
    let dot=pick.querySelector(".admin-nav-pick-dot");
    if(n>0){ if(!dot){ dot=document.createElement("span"); dot.className="admin-nav-pick-dot"; pick.appendChild(dot); } dot.textContent=n>99?"99+":String(n); }
    else dot?.remove();
  }
  setInterval(()=>{ if(/^admin/.test(document.body.getAttribute("data-view")||"")){ try{window.hydrateAdminAttention?.();}catch(_){} syncPick(); } },2500);
  document.addEventListener("DOMContentLoaded",()=>{ try{document.body.setAttribute("data-view",window.currentView||"home");}catch(_){} });
})();

/* ---- levromart-dual-search ---- */
/* Dual live search: the vendor strip and the product list both follow what is typed, on the same page. */
(function(){
  var pool=null, poolAt=0, loading=null;
  function ee(x){return (typeof esc==="function")?esc(x):String(x==null?"":x).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
  function item(v){
    var nm=v.business_name||"Vendor";
    var ini=ee(typeof initials==="function"?initials(nm).slice(0,2):String(nm).trim().charAt(0).toUpperCase());
    var hue=typeof stableAvatarHue==="function"?stableAvatarHue(v.id||nm):0;
    var ico=v.logo_url?'<img src="'+ee(v.logo_url)+'" alt="" loading="lazy" draggable="false" onerror="this.remove()">':ini;
    return '<button type="button" class="lv-svr-item" data-vid="'+ee(v.id)+'"><span class="lv-svr-ico" style="'+(v.logo_url?'':'background:hsl('+hue+' 55% 91%)!important;color:hsl('+hue+' 55% 26%)!important;')+'">'+ico+'</span><span class="lv-svr-name">'+ee(nm)+'</span></button>';
  }
  function loadPool(){
    if(pool&&Date.now()-poolAt<300000) return Promise.resolve(pool);
    if(loading) return loading;
    loading=Promise.resolve(sb.from("vendors").select("id,business_name,logo_url").eq("verification_status","verified").eq("is_active",true).is("deleted_at",null).limit(500)).then(function(r){ pool=r.data||[]; poolAt=Date.now(); loading=null; return pool; },function(){loading=null;return pool||[];});
    return loading;
  }
  function match(v,term){
    var n=String(v.business_name||"").toLowerCase(), t=term.toLowerCase();
    if(n.indexOf(t)>-1) return n.indexOf(t)===0?0:1;
    var ws=t.split(/\s+/).filter(Boolean); if(ws.length>1&&ws.every(function(w){return n.indexOf(w)>-1;})) return 2;
    return -1;
  }
  function local(term){
    if(!pool) return [];
    return pool.map(function(v){return {v:v,k:match(v,term)};}).filter(function(x){return x.k>=0;}).sort(function(a,b){return a.k-b.k||String(a.v.business_name).localeCompare(String(b.v.business_name));}).map(function(x){return x.v;});
  }
  function strip(){
    var host=document.getElementById("searchPageResults"); if(!host) return null;
    var w=document.getElementById("lvSearchVendors");
    if(!w){ w=document.createElement("div"); w.id="lvSearchVendors"; w.className="lv-svr"; host.insertAdjacentElement("afterbegin",w);
      w.addEventListener("click",function(e){ var b=e.target.closest(".lv-svr-item"); if(b) navigate("storefront",{vendorId:b.getAttribute("data-vid")}); }); }
    return w;
  }
  function paint(list,term){
    if(searchPageFilter!=="all"&&searchPageFilter!=="vendors"){ document.getElementById("lvSearchVendors")?.remove(); return; }
    var w=strip(); if(!w) return;
    w.dataset.typed="1";
    w.innerHTML='<div class="lv-svr-head"><strong>Suggested vendors</strong></div>'+(list.length?'<div class="lv-svr-row">'+list.slice(0,24).map(item).join("")+'</div>':'<p class="muted" style="margin:.2rem 0 .4rem;font-size:.85rem;">No vendors match "'+ee(term)+'"</p>');
  }
  var lastTerm="";
  function instant(){
    var term=(document.getElementById("searchPageInput")||{}).value||""; term=term.trim(); lastTerm=term;
    if(!term||typeof sb==="undefined") return;
    if(!pool){ loadPool().then(function(){ if(lastTerm===term) paint(local(term),term); }); return; }
    paint(local(term),term);
  }
  // the heading above the products follows the same wording
  function retitle(){
    document.querySelectorAll("#searchPageResults .search-page-section>h3").forEach(function(h){
      if(/^Products \(/.test(h.textContent)) h.textContent="Suggested for you";
      if(/^Vendors \(/.test(h.textContent)) h.closest(".search-page-section").remove();
    });
  }
  function wrap(){
    var s=window.scheduleSearchPageQuery;
    if(typeof s==="function"&&!s.__lvDual){ var ws=function(){ var r=s.apply(this,arguments); try{instant();}catch(_){} return r; }; ws.__lvDual=true; window.scheduleSearchPageQuery=ws; }
    var q=window.runSearchPageQuery;
    if(typeof q==="function"&&!q.__lvDual){
      var wq=async function(term){
        var out=await q.apply(this,arguments);
        try{
          term=String(term||"").trim(); var cur=((document.getElementById("searchPageInput")||{}).value||"").trim();
          if(term&&term===cur){
            retitle();
            // refine with server matches (names + shops that sell what was typed)
            if(searchPageFilter==="all"||searchPageFilter==="vendors"){
              var enc=term.toLowerCase(), ids=[];
              try{ var hit=searchResultCache&&searchResultCache.get("v2:6:"+enc); }catch(_){}
              var byName=await sb.from("vendors").select("id,business_name,logo_url").eq("verification_status","verified").eq("is_active",true).is("deleted_at",null).ilike("business_name","%"+term+"%").limit(24);
              var list=(byName.data||[]).slice(); var seen={}; list.forEach(function(v){seen[v.id]=1;});
              try{ var pr=await searchCached("p2:20:"+enc,function(){return sb.rpc("search_products_full_v2",{p_query:term,p_limit:20});},null,false); ids=[...new Set((pr||[]).map(function(r){return r.vendor_id;}).filter(Boolean))].filter(function(i){return !seen[i];}).slice(0,12); }catch(_){}
              if(ids.length){ var ex=await sb.from("vendors").select("id,business_name,logo_url").in("id",ids).eq("verification_status","verified").eq("is_active",true); (ex.data||[]).forEach(function(v){list.push(v);}); }
              local(term).forEach(function(v){ if(!seen[v.id]&&!list.some(function(x){return x.id===v.id;})) list.push(v); });
              var cur2=((document.getElementById("searchPageInput")||{}).value||"").trim();
              if(cur2===term) paint(list,term);
            }
          }
        }catch(_){}
        return out;
      };
      wq.__lvDual=true; window.runSearchPageQuery=wq;
    }
    var r=window.renderSearchPageSuggestions;
    if(typeof r==="function"&&!r.__lvDualR){
      var wr=function(force){ if(!force){ var w=document.getElementById("lvSearchVendors"); if(w&&w.dataset.typed) w.remove(); } return r.apply(this,arguments); };
      wr.__lvDualR=true; wr.__lvSv=r.__lvSv; window.renderSearchPageSuggestions=wr;
    }
  }
  wrap(); window.addEventListener("load",function(){wrap();setTimeout(wrap,500);});
  document.addEventListener("input",function(e){ if(e.target&&e.target.id==="searchPageInput") loadPool(); },true);
})();

/* ---- script ---- */
/* Listing form: visible auto-save status and flush on leaving the app. */
(function(){
  function root(el){return el&&el.closest?el.closest('#productModal,#packageModal'):null}
  function kind(r){return r.id==='packageModal'?'package':'product'}
  function say(r,txt,ok){const s=r.querySelector('.lf-saved');if(!s)return;s.classList.toggle('ok',!!ok);s.querySelector('span').textContent=txt;const i=s.querySelector('i');i.className=ok?'fa-solid fa-circle-check':'fa-solid fa-cloud-arrow-up'}
  function flush(r){try{window.__captureListingDraftForModal&&window.__captureListingDraftForModal(kind(r));return true}catch(_){return false}}
  const timers=new WeakMap();
  function onEdit(e){
    const r=root(e.target);if(!r||r.classList.contains('hidden')||e.target.type==='file')return;
    say(r,'Saving…',false);clearTimeout(timers.get(r));
    timers.set(r,setTimeout(()=>{flush(r);say(r,'Draft auto-saved on this device',true)},700));
  }
  document.addEventListener('input',onEdit,true);
  document.addEventListener('change',onEdit,true);
  function flushOpen(){document.querySelectorAll('#productModal:not(.hidden),#packageModal:not(.hidden)').forEach(r=>{if(r.dataset.discardDraft!=='1')flush(r)})}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flushOpen()});
  window.addEventListener('pagehide',flushOpen);
  /* Tell the vendor when an earlier draft came back. */
  new MutationObserver(()=>{document.querySelectorAll('#productModal:not(.hidden),#packageModal:not(.hidden)').forEach(r=>{
    if(r.dataset.lfSaidRestored==='1'||r.dataset.draftRestored!=='1')return;r.dataset.lfSaidRestored='1';
    let has=false;try{has=Object.keys(localStorage).some(k=>k.startsWith('levromart-listing-form-draft-v5')&&k.includes(':'+kind(r)+':new'))}catch(_){}
    if(has)say(r,'Your saved draft was restored',true);
  });document.querySelectorAll('#productModal.hidden,#packageModal.hidden').forEach(r=>{delete r.dataset.lfSaidRestored})}).observe(document.body,{attributes:true,attributeFilter:['class','data-draft-restored'],subtree:true});
})();

/* ---- script ---- */
/* Listing page: keep Save/Cancel bar last in the form, and survive a refresh. */
(function(){
  const KEY='levromart-listing-page-open-v1';
  function pin(){document.querySelectorAll('#productModal .lm-actions,#packageModal .lm-actions').forEach(a=>{const p=a.parentElement;if(p&&p.lastElementChild!==a)p.appendChild(a)})}
  ['productModal','packageModal'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    const c=el.querySelector('.modal-content');
    if(c)new MutationObserver(()=>{if(!el.classList.contains('hidden'))pin()}).observe(c,{childList:true,subtree:true});
  });
  function track(){
    try{
      const pm=document.getElementById('productModal'),kg=document.getElementById('packageModal');
      let st=null;
      if(pm&&!pm.classList.contains('hidden'))st={k:'product',id:(typeof editingProductId!=='undefined'&&editingProductId)||null,svc:!!document.getElementById('prodIsService')?.checked};
      else if(kg&&!kg.classList.contains('hidden'))st={k:'package',id:(typeof editingPackageId!=='undefined'&&editingPackageId)||null};
      if(st){localStorage.setItem(KEY,JSON.stringify(st));pin()}else localStorage.removeItem(KEY);
    }catch(_){}
  }
  new MutationObserver(track).observe(document.body,{attributes:true,subtree:true,attributeFilter:['class']});
  document.addEventListener('change',e=>{if(e.target&&e.target.id==='prodIsService')track()},true);
  /* After a refresh, reopen the page the vendor was on. */
  let st=null;try{st=JSON.parse(localStorage.getItem(KEY)||'null')}catch(_){}
  if(!st)return;
  let tries=0;
  const t=setInterval(async()=>{
    tries++;
    if(tries>150){clearInterval(t);return}
    try{
      if(!(typeof session!=='undefined'&&session&&typeof vendor!=='undefined'&&vendor))return;
      if(typeof openAddProductModal!=='function'||typeof openAddPackageModal!=='function')return;
      clearInterval(t);
      await new Promise(r=>setTimeout(r,700));
      if(st.k==='package'){ if(st.id&&typeof openEditPackageModal==='function')await openEditPackageModal(st.id); else await openAddPackageModal(); }
      else if(st.id&&typeof openEditProductModal==='function')await openEditProductModal(st.id);
      else{window.__lfWant=st.svc?'service':'product';await window.openAddProductModal();}
      pin();
    }catch(_){}
  },300);
})();

/* ---- script ---- */
/* Listing drafts: also keep the photos the vendor picked (IndexedDB) so a refresh or closed app loses nothing. */
(function(){
  const DB='levromart-lf-files',ST='f';
  function db(){return new Promise((res,rej)=>{try{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(ST);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}catch(e){rej(e)}})}
  function uid(){try{return session?.user?.id||'guest'}catch(_){return 'guest'}}
  const k=kind=>uid()+':'+kind+':new';
  async function put(kind,val){try{const d=await db();const tx=d.transaction(ST,'readwrite');val?tx.objectStore(ST).put(val,k(kind)):tx.objectStore(ST).delete(k(kind))}catch(_){}}
  async function get(kind){try{const d=await db();return await new Promise(r=>{const q=d.transaction(ST).objectStore(ST).get(k(kind));q.onsuccess=()=>r(q.result);q.onerror=()=>r(null)})}catch(_){return null}}
  function isNew(kind){try{return kind==='product'?!editingProductId:!editingPackageId}catch(_){return false}}
  function saveFiles(kind){
    if(!isNew(kind))return;
    if(kind==='package'){const main=[...(window.__newPackagePhotoFiles||[])];put('package',main.length?{main}:null);return}
    const main=[...(window.__newProductPhotoFiles||[])],variants={};
    (window.__productVariants||[]).forEach(v=>{const f=v._imageFile||window.__productVariantPhotoFiles?.[v._localKey];if(f&&v._localKey)variants[v._localKey]=f});
    put('product',(main.length||Object.keys(variants).length)?{main,variants}:null);
  }
  const openKind=()=>document.querySelector('#productModal:not(.hidden)')?'product':document.querySelector('#packageModal:not(.hidden)')?'package':null;
  let t;function later(){clearTimeout(t);t=setTimeout(()=>{const kd=openKind();if(kd)saveFiles(kd)},700)}
  document.addEventListener('change',e=>{if(e.target&&e.target.closest&&e.target.closest('#productModal,#packageModal'))later()},true);
  document.addEventListener('click',e=>{if(e.target&&e.target.closest&&e.target.closest('#productModal,#packageModal'))later()},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){const kd=openKind();if(kd)saveFiles(kd)}});
  window.addEventListener('pagehide',()=>{const kd=openKind();if(kd)saveFiles(kd)});
  /* forget files whenever the draft is cleared (Cancel or a successful save) */
  ['clearListingDraft','clearNewListingDraft'].forEach(n=>{const o=window[n];if(typeof o!=='function')return;window[n]=function(kind,id){const r=o.apply(this,arguments);try{const kd=kind||'product';if(n==='clearListingDraft'?(!id||id==='new'):true)put(kd,null)}catch(_){}return r}});
  async function restore(kind){
    if(!isNew(kind))return;
    const rec=await get(kind);if(!rec)return;
    if(kind==='package'){
      if(rec.main?.length&&!(window.__newPackagePhotoFiles||[]).length){window.__newPackagePhotoFiles=rec.main;try{syncNewPackagePhotoInput();renderNewPackagePhotos()}catch(_){}}
      return;
    }
    if(rec.main?.length&&!(window.__newProductPhotoFiles||[]).length){window.__newProductPhotoFiles=rec.main;try{syncNewProductPhotoInput();renderNewProductPhotos();renderProductDisplayPicture()}catch(_){}}
    const vs=window.__productVariants||[];window.__productVariantPhotoFiles=window.__productVariantPhotoFiles||{};
    let n=0;vs.forEach(v=>{const f=rec.variants?.[v._localKey];if(f&&!v._imageFile){v._imageFile=f;v._previewUrl=URL.createObjectURL(f);window.__productVariantPhotoFiles[v._localKey]=f;n++}});
    if(n){try{renderProductVariantPricing()}catch(_){}}
  }
  new MutationObserver(()=>{
    ['productModal','packageModal'].forEach(id=>{const r=document.getElementById(id);if(!r)return;
      if(r.classList.contains('hidden')){delete r.dataset.lfFiles;return}
      if(r.dataset.draftRestored==='1'&&r.dataset.lfFiles!=='1'&&/^Add/.test(r.querySelector('h3')?.textContent||'')){r.dataset.lfFiles='1';restore(id==='packageModal'?'package':'product')}
    });
  }).observe(document.body,{attributes:true,subtree:true,attributeFilter:['class','data-draft-restored']});
})();

/* ---- comments-bottom-sheet ---- */
/* Comments open as a bottom sheet (like Instagram): thread scrolls, composer stays pinned, tap outside or drag down to close. */
(function(){
  const SHEET_ID="lvCs";
  function closeSheet(){
    const w=document.getElementById(SHEET_ID); if(!w) return;
    const panel=w.querySelector(".lv-cs-body>*");
    const home=w._home;
    if(panel&&home&&home.parent){ if(home.next&&home.next.parentNode===home.parent) home.parent.insertBefore(panel,home.next); else home.parent.appendChild(panel); }
    w.remove(); document.body.classList.remove("lv-cs-open");
  }
  function openSheet(panel,fn,id,title){
    closeSheet();
    const w=document.createElement("div"); w.id=SHEET_ID;
    w.innerHTML='<div class="lv-cs-back"></div><div class="lv-cs-card" role="dialog" aria-modal="true" aria-label="Comments"><div class="lv-cs-head"><span class="lv-cs-handle"></span><strong>'+title+'</strong><button type="button" class="lv-cs-x" aria-label="Close comments"><i class="fa-solid fa-xmark"></i></button></div><div class="lv-cs-body"></div></div>';
    w._home={parent:panel.parentNode,next:panel.nextSibling};
    w.querySelector(".lv-cs-body").appendChild(panel);
    document.body.appendChild(w); document.body.classList.add("lv-cs-open");
    const close=()=>fn(id);
    w.querySelector(".lv-cs-back").addEventListener("click",close);
    w.querySelector(".lv-cs-x").addEventListener("click",close);
    /* drag the header down to dismiss */
    const card=w.querySelector(".lv-cs-card"),head=w.querySelector(".lv-cs-head");
    let y0=null,dy=0;
    head.addEventListener("touchstart",e=>{y0=e.touches[0].clientY;dy=0;card.style.transition="none"},{passive:true});
    head.addEventListener("touchmove",e=>{if(y0==null)return;dy=Math.max(0,e.touches[0].clientY-y0);card.style.transform="translateY("+dy+"px)"},{passive:true});
    head.addEventListener("touchend",()=>{if(y0==null)return;card.style.transition="";card.style.transform="";if(dy>110)close();y0=null});
  }
  function wrap(name,panelId,title){
    const orig=window[name]; if(typeof orig!=="function"||orig.__cs) return;
    const fn=function(id){
      const panel=document.getElementById(panelId);
      if(!panel) return orig.apply(this,arguments);
      const wasOpen=!panel.classList.contains("hidden");
      if(wasOpen){ closeSheet(); return orig.apply(this,arguments); }
      const r=orig.apply(this,arguments);
      openSheet(panel,fn,id,title);
      return r;
    };
    fn.__cs=true; window[name]=fn;
  }
  function install(){ wrap("toggleProductComments","productCommentsPanel","Comments"); wrap("togglePackageComments","packageCommentsPanel","Comments"); }
  install(); window.addEventListener("load",install);
  /* a stale sheet must not survive leaving the page */
  window.addEventListener("popstate",closeSheet);
  document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&document.getElementById(SHEET_ID)){ document.querySelector("#"+SHEET_ID+" .lv-cs-x")?.click(); } });
})();

/* ---- comment-composer-autosize ---- */
/* slim one-line comment box that grows only as you type */
(function(){
  function grow(t){ t.style.height="auto"; t.style.height=Math.min(t.scrollHeight,112)+"px"; }
  document.addEventListener("input",e=>{ const t=e.target; if(t&&t.matches&&t.matches(".product-comment-compose-row textarea")) grow(t); },true);
  function slim(){ document.querySelectorAll(".product-comment-compose-row textarea").forEach(t=>{ if(t.rows!==1) t.rows=1; }); }
  new MutationObserver(slim).observe(document.body,{childList:true,subtree:true}); slim();
  document.addEventListener("keydown",e=>{
    const t=e.target; if(!(t&&t.matches&&t.matches(".product-comment-compose-row textarea")))return;
    if(e.key==="Enter"&&!e.shiftKey&&!(window.matchMedia&&matchMedia("(pointer:coarse)").matches)){ e.preventDefault(); t.closest(".product-comment-compose-row")?.querySelector("button")?.click(); }
  },true);
})();

/* ---- search-history-on-open ---- */
/* Opening a search result remembers what was typed, so it shows up under "Recent searches" next time. */
document.addEventListener("click",function(e){
  var t=e.target; if(!t||!t.closest) return;
  if(!t.closest("#searchPageResults")) return;
  if(t.closest(".search-page-chip,.search-page-history-head,.search-page-error,.search-page-filter")) return;
  if(!t.closest('[role="link"],a,.product-card-wrap,.vd-card,.vendor-card,.search-result-row,.sr-row,[onclick*="navigate("]')) return;
  var inp=document.getElementById("searchPageInput"); var term=inp&&inp.value.trim();
  if(term&&typeof writeSearchHistory==="function") writeSearchHistory(term);
},true);

/* ---- comment-count-live ---- */
/* The comment count on a product/package page loads on its own and keeps itself current (live + light polling). */
(function(){
  var state={id:null,kind:null,chan:null,timer:null};
  function el(){ return document.getElementById("productCommentsCount")||document.getElementById("packageCommentsCount"); }
  async function fetchCount(kind,id){
    try{
      var tbl=kind==="package"?"package_comments":"product_comments", col=kind==="package"?"package_id":"product_id";
      var r=await sb.from(tbl).select("id",{count:"exact",head:true}).eq(col,id);
      if(!r.error&&typeof r.count==="number") return r.count;
    }catch(_){}
    return null;
  }
  async function refresh(){
    var e=el(); if(!e){ stop(); return; }
    var kind=e.id==="packageCommentsCount"?"package":"product";
    var id=e.dataset.productId||e.dataset.packageId||(kind==="package"?(window.currentViewParams&&currentViewParams.packageId):(window.currentProductDetail&&currentProductDetail.id));
    if(!id) return;
    var n=await fetchCount(kind,id);
    var again=el(); if(n==null||!again) return;
    again.textContent=String(n);
    try{ (kind==="package"?window.__packageCommentCounts:window.__productCommentCounts).set(String(id),n); }catch(_){}
  }
  function stop(){
    if(state.chan){ try{ sb.removeChannel(state.chan); }catch(_){} }
    if(state.timer) clearInterval(state.timer);
    state={id:null,kind:null,chan:null,timer:null};
  }
  function start(){
    var e=el(); if(!e) { if(state.id) stop(); return; }
    var kind=e.id==="packageCommentsCount"?"package":"product";
    var id=e.dataset.productId||e.dataset.packageId||(kind==="package"?(window.currentViewParams&&currentViewParams.packageId):(window.currentProductDetail&&currentProductDetail.id));
    if(!id) return;
    if(state.id===String(id)&&state.kind===kind) return;
    stop(); state.id=String(id); state.kind=kind;
    refresh();
    try{
      state.chan=sb.channel("cc-"+kind+"-"+id).on("postgres_changes",{event:"*",schema:"public",table:kind==="package"?"package_comments":"product_comments",filter:(kind==="package"?"package_id":"product_id")+"=eq."+id},function(){ refresh(); }).subscribe();
    }catch(_){}
    state.timer=setInterval(function(){ if(!document.hidden) refresh(); },20000);
  }
  new MutationObserver(function(){ if(start._t) return; start._t=setTimeout(function(){ start._t=0; start(); },250); }).observe(document.body,{childList:true,subtree:true});
  document.addEventListener("visibilitychange",function(){ if(!document.hidden) refresh(); });
  start();
})();

/* ---- carousel-blur-backdrop ---- */
/* Banners keep their full artwork (no cropping); the taller frame is filled with a soft blurred copy of the same picture. */
(function(){
  function tag(){
    document.querySelectorAll("#app .home-promotional-slide").forEach(function(s){
      var img=s.querySelector("img"); if(!img) return;
      var src=img.currentSrc||img.src; if(!src||s.dataset.bg===src) return;
      s.dataset.bg=src; s.style.setProperty("--slide-bg",'url("'+src.replace(/"/g,"%22")+'")');
    });
  }
  var t=0;
  new MutationObserver(function(){ if(t) return; t=setTimeout(function(){ t=0; tag(); },200); }).observe(document.body,{childList:true,subtree:true});
  tag();
})();

/* ---- comment-mentions ---- */
/* @mentions in comments: pick a vendor while typing "@", replies pre-fill "@Name", tagged names are highlighted. */
(function(){
  var names=new Set(); window.__lvVendorNames=names;
  function esc2(t){ return String(t==null?"":t).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  window.lvMentionHtml=function(text,author){
    var html=esc2(text); if(author) names.add(String(author));
    if(html.indexOf("@")<0) return html;
    var list=Array.from(names).filter(function(n){return n&&n.length>1;}).sort(function(a,b){return b.length-a.length;});
    list.forEach(function(n){
      var token="@"+esc2(n); var i=html.toLowerCase().indexOf(token.toLowerCase());
      while(i>=0){ var real=html.substr(i,token.length); var rep='<span class="lv-mention" role="link" tabindex="0" data-name="'+real.slice(1)+'">'+real+'</span>'; html=html.slice(0,i)+rep+html.slice(i+token.length); i=html.toLowerCase().indexOf(token.toLowerCase(),i+rep.length); }
    });
    return html;
  };
  var box=null,seq=0,timer=0,cur=null;
  function hide(){ if(box){ box.remove(); box=null; } cur=null; }
  function show(ta,rows,start){
    hide(); if(!rows.length) return;
    cur={ta:ta,start:start};
    box=document.createElement("div"); box.className="lv-mention-list"; box.setAttribute("role","listbox");
    box.innerHTML=rows.map(function(v,i){ return '<button type="button" class="lv-mention-item" data-i="'+i+'">'+(v.logo_url?'<img src="'+esc2(v.logo_url)+'" alt="">':'<span class="lv-mention-ini">'+esc2((v.business_name||"?").charAt(0).toUpperCase())+'</span>')+'<span>'+esc2(v.business_name)+'</span></button>'; }).join("");
    var host=ta.closest(".product-comment-composer")||ta.parentNode; host.style.position=host.style.position||"relative"; host.appendChild(box);
    box.addEventListener("mousedown",function(e){ e.preventDefault(); });
    box.addEventListener("click",function(e){
      var b=e.target.closest(".lv-mention-item"); if(!b) return; var v=rows[+b.dataset.i];
      var before=ta.value.slice(0,cur.start), after=ta.value.slice(ta.selectionStart||ta.value.length);
      var ins="@"+v.business_name+" "; names.add(v.business_name);
      ta.value=before+ins+after; var pos=(before+ins).length; ta.focus(); try{ta.setSelectionRange(pos,pos);}catch(_){}
      ta.dispatchEvent(new Event("input",{bubbles:true})); hide();
    });
  }
  document.addEventListener("input",function(e){
    var ta=e.target; if(!ta||!ta.matches||!ta.matches(".product-comment-compose-row textarea")) return;
    var pos=ta.selectionStart==null?ta.value.length:ta.selectionStart, upto=ta.value.slice(0,pos);
    var at=upto.lastIndexOf("@");
    if(at<0||(at>0&&!/\s/.test(upto.charAt(at-1)))){ hide(); return; }
    var q=upto.slice(at+1); if(/\n/.test(q)||q.length>40){ hide(); return; }
    clearTimeout(timer); var my=++seq;
    timer=setTimeout(async function(){
      try{
        var req=sb.from("vendors").select("id,business_name,logo_url").eq("verification_status","verified").eq("is_active",true);
        if(q.trim()) req=req.ilike("business_name","%"+q.trim().replace(/[%_]/g,"")+"%");
        var r=await req.order("business_name").limit(6);
        if(my!==seq) return; var rows=(r&&r.data)||[]; rows.forEach(function(v){names.add(v.business_name); (window.__lvVendorIds=window.__lvVendorIds||new Map()).set(String(v.business_name).toLowerCase(),v.id);}); show(ta,rows,at);
      }catch(_){ }
    },160);
  },true);
  document.addEventListener("click",function(e){
    if(box&&!e.target.closest(".lv-mention-list")&&!e.target.closest(".product-comment-compose-row")) hide();
    if(box&&e.target.closest&&e.target.closest(".product-comment-compose-row .btn")) hide();
    var m=e.target.closest&&e.target.closest(".lv-mention"); if(m){ e.preventDefault(); e.stopPropagation(); openMention(m.dataset.name||m.textContent.replace(/^@/,"")); }
  },true);
  setInterval(function(){ if(box&&(!cur||!cur.ta.isConnected||!cur.ta.value||cur.ta.value.indexOf("@")<0)) hide(); },250);
  async function openMention(name){
    name=String(name||"").trim(); if(!name) return;
    var id=window.__lvVendorIds&&window.__lvVendorIds.get(name.toLowerCase());
    if(!id){ try{ var r=await sb.from("vendors").select("id").eq("verification_status","verified").eq("is_active",true).ilike("business_name",name.replace(/[%_]/g,"")).limit(1); id=r&&r.data&&r.data[0]&&r.data[0].id; }catch(_){ } }
    if(!id) return;
    document.querySelector("#lvCs .lv-cs-x")&&document.querySelector("#lvCs .lv-cs-x").click();
    setTimeout(function(){ try{ navigate("storefront",{vendorId:id}); }catch(_){} },60);
  }
  window.__lvVendorIds=window.__lvVendorIds||new Map();
  /* reply -> prefill "@Name " (LinkedIn style) */
  function wrapReply(name){
    var o=window[name]; if(typeof o!=="function"||o.__m) return;
    var f=function(id){
      var r=o.apply(this,arguments);
      try{
        var row=document.querySelector('.product-comment-row[data-comment-id="'+String(id).replace(/"/g,"")+'"] .product-comment-head strong');
        var who=row&&row.textContent.trim();
        setTimeout(function(){
          var ta=document.querySelector(".product-comment-compose-row textarea"); if(!ta||!who) return;
          names.add(who); var tag="@"+who+" ";
          if(!ta.value.trim()||/^@[^@]*\s$/.test(ta.value)&&ta.value.length<80) ta.value=tag; else if(ta.value.indexOf(tag)!==0) ta.value=tag+ta.value;
          ta.focus(); try{ta.setSelectionRange(ta.value.length,ta.value.length);}catch(_){}
          ta.dispatchEvent(new Event("input",{bubbles:true}));
        },120);
      }catch(_){}
      return r;
    };
    f.__m=true; window[name]=f;
  }
  function install(){ wrapReply("replyToProductComment"); wrapReply("replyToPackageComment"); }
  install(); window.addEventListener("load",install);
})();

/* ---- mention-preload ---- */
(function(){
  var loaded=false,done=false;
  async function load(){
    if(loaded||typeof sb==="undefined") return; loaded=true;
    try{
      for(var off=0;off<6000;off+=1000){
        var r=await sb.from("vendors").select("id,business_name").eq("verification_status","verified").eq("is_active",true).order("id").range(off,off+999);
        var d=(r&&r.data)||[]; d.forEach(function(v){ if(!v.business_name) return; window.__lvVendorNames.add(v.business_name); window.__lvVendorIds.set(String(v.business_name).toLowerCase(),v.id); });
        if(d.length<1000) break;
      }
      done=true;
    }catch(_){ loaded=false; }
    process();
  }
  function process(){
    if(!done) return;
    document.querySelectorAll(".product-comment-body:not([data-mp])").forEach(function(el){
      var t=el.textContent||""; if(t.indexOf("@")<0){ el.dataset.mp="1"; return; }
      el.innerHTML=window.lvMentionHtml(t); el.dataset.mp="1";
    });
  }
  var t=0;
  new MutationObserver(function(m){ if(t) return; t=setTimeout(function(){ t=0; if(document.querySelector(".product-comment-body")){ load(); process(); } },150); }).observe(document.body,{childList:true,subtree:true});
})();

/* ---- comment-edit-menu ---- */
/* three-dots menu on your own comments: Edit / Copy / Delete */
(function(){
  var TOP=2147483600;
  function tbl(k){return k==="package"?"package_comments":"product_comments";}
  function close(id){var e=document.getElementById(id);if(e)e.remove();}
  function sheet(id,html){
    close(id);
    var w=document.createElement("div");w.id=id;w.className="lv-cm";
    w.innerHTML='<div class="lv-cm-back"></div><div class="lv-cm-card" role="dialog" aria-modal="true">'+html+'</div>';
    document.body.appendChild(w);
    w.querySelector(".lv-cm-back").addEventListener("click",function(){close(id);});
    return w;
  }
  function rowOf(id){return document.querySelector('.product-comment-row[data-comment-id="'+String(id).replace(/"/g,"")+'"]');}
  function textOf(id){var r=rowOf(id);var b=r&&r.querySelector(".product-comment-body");return b?(b.dataset.raw||b.textContent||"").trim():"";}
  window.lvCommentMenu=function(kind,id){
    var w=sheet("lvCmMenu",
      '<span class="lv-cm-handle"></span>'+
      '<button type="button" data-a="edit"><i class="fa-solid fa-pen"></i><span>Edit comment</span></button>'+
      '<button type="button" data-a="copy"><i class="fa-regular fa-copy"></i><span>Copy text</span></button>'+
      '<button type="button" data-a="delete" class="danger"><i class="fa-solid fa-trash"></i><span>Delete comment</span></button>'+
      '<button type="button" data-a="cancel" class="cancel">Cancel</button>');
    w.querySelector(".lv-cm-card").addEventListener("click",function(e){
      var b=e.target.closest("button[data-a]");if(!b)return;var a=b.dataset.a;close("lvCmMenu");
      if(a==="edit")openEdit(kind,id);
      else if(a==="copy"){var t=textOf(id);try{navigator.clipboard.writeText(t).then(function(){showToast("Copied.","success");});}catch(_){}}
      else if(a==="delete"){(kind==="package"?window.deletePackageComment:window.deleteProductComment)(id);}
    });
  };
  function openEdit(kind,id){
    var w=sheet("lvCmEdit",
      '<span class="lv-cm-handle"></span><strong class="lv-cm-title">Edit comment</strong>'+
      '<textarea rows="4" maxlength="1000" aria-label="Edit your comment"></textarea>'+
      '<div class="lv-cm-row"><button type="button" class="cancel" data-a="x">Cancel</button><button type="button" class="save" data-a="save">Save</button></div>');
    var ta=w.querySelector("textarea");ta.value=textOf(id);
    setTimeout(function(){try{ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}catch(_){}},60);
    w.querySelector(".lv-cm-card").addEventListener("click",async function(e){
      var b=e.target.closest("button[data-a]");if(!b)return;
      if(b.dataset.a==="x"){close("lvCmEdit");return;}
      var v=ta.value.trim();
      if(!v){showToast("A comment can't be empty.","error");return;}
      if(v===textOf(id)){close("lvCmEdit");return;}
      b.disabled=true;b.textContent="Saving…";
      var now=new Date().toISOString();
      var r=await sb.from(tbl(kind)).update({content:v,updated_at:now}).eq("id",id).eq("user_id",session.user.id).select("id");
      if(r.error||!r.data||!r.data.length){b.disabled=false;b.textContent="Save";showToast((r.error&&r.error.message)||"Could not save your edit.","error");return;}
      close("lvCmEdit");
      var row=rowOf(id);
      if(row){
        var body=row.querySelector(".product-comment-body");
        if(body){body.innerHTML=window.lvMentionHtml?window.lvMentionHtml(v,""):v.replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
        var head=row.querySelector(".product-comment-head");
        if(head&&!head.querySelector(".lv-edited")){var s=document.createElement("span");s.className="muted lv-edited";s.textContent="· edited";head.appendChild(s);}
      }
      showToast("Comment updated.","success");
    });
  }
})();

/* ---- pd-top-comment ---- */
/* comment button between heart and share: opens the comments sheet straight away */
window.lvOpenProductComments=function(id){
  var p=document.getElementById("productCommentsPanel");
  if(!p){ showToast("Comments aren't available here.","error"); return; }
  if(p.classList.contains("hidden")&&window.toggleProductComments) window.toggleProductComments(id);
};

/* ---- notif-prompt-relogin ---- */
/* logging out and back in counts as a fresh login: ask again if notifications are still off */
try{sb.auth.onAuthStateChange(function(ev){ if(ev==="SIGNED_OUT") window.__notifPromptShownFor=null; });}catch(_){}

/* ---- lv-campus-js ---- */
(function(){
  "use strict";
  var SUBS=[],DATA=null,loading=null,KIND={U:"University",P:"Polytechnic",E:"College of Education",C:"College"};
  function esc2(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function load(){
    if(DATA) return Promise.resolve(DATA);
    if(loading) return loading;
    loading=fetch("/campuses.json").then(function(r){return r.json();}).then(function(rows){
      DATA=rows.map(function(r){var o={id:r[0],name:r[1],kind:r[2],fund:r[3],state:r[4],city:r[5],abbr:r[6],logo:!!r[7]};
        o.hay=(o.name+" "+o.abbr+" "+o.city+" "+o.state+" "+(KIND[o.kind]||"")).toLowerCase().replace(/[^a-z0-9 ]+/g," ");return o;});
      return Promise.resolve().then(function(){return sb.rpc("campus_school_names");}).then(function(x){
        SUBS=(x&&x.data)||[];
        SUBS.forEach(function(n){ if(n.status!=="approved") return; var id="custom:"+n.name;
          DATA.push({id:id,name:n.name,kind:"U",fund:"",state:"",city:"",abbr:"",logo:false,custom:true,hay:n.name.toLowerCase().replace(/[^a-z0-9 ]+/g," ")}); });
        return DATA;
      }).catch(function(){return DATA;});
    }).catch(function(){loading=null;DATA=[];return DATA;});
    return loading;
  }
  var byIdCache=null;
  function rec(id){
    if(!id) return null;
    if(id==="none") return {id:"none",name:"Not on a campus",none:true};
    if(id==="all") return {id:"all",name:"All campuses",all:true};
    if(String(id).indexOf("custom:")===0) return {id:id,name:String(id).slice(7),custom:true};
    if(!DATA) return null;
    if(!byIdCache){byIdCache=new Map();DATA.forEach(function(r){byIdCache.set(r.id,r);});}
    return byIdCache.get(id)||null;
  }
  function hue(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return h;}
  function inits(r){
    var a=(r.abbr||"").trim(); if(a&&a.length<=5) return a.slice(0,4).toUpperCase();
    var w=String(r.name||"").replace(/\b(of|the|and|for|university|college|polytechnic|federal|state)\b/gi," ").trim().split(/\s+/).filter(Boolean);
    return ((w[0]||"?")[0]+((w[1]||"")[0]||"")).toUpperCase();
  }
  function logoHtml(r,big){
    if(r&&r.logo) return '<img src="/campus-logos/'+esc2(r.id)+'.webp" alt="" loading="lazy" decoding="async" onerror="this.parentNode.innerHTML=lvCampusIni(this.dataset.n||\'\')" data-n="'+esc2(r.id)+'">';
    return iniHtml(r);
  }
  function iniHtml(r){
    if(!r) return '<i class="fa-solid fa-location-dot"></i>';
    if(r.none) return '<i class="fa-solid fa-house"></i>';
    if(r.all) return '<i class="fa-solid fa-earth-africa"></i>';
    var h=hue(r.id||r.name||"x");
    return '<span class="lvc-ini" style="background:linear-gradient(135deg,hsl('+h+',58%,46%),hsl('+((h+40)%360)+',62%,34%))">'+esc2(inits(r))+'</span>';
  }
  window.lvCampusIni=function(id){return iniHtml(rec(id));};
  window.lvCampuses=load;
  window.lvCampusById=function(id){return rec(id);};
  window.lvMyCampusId=function(){
    var p=null; try{p=(typeof profile!=="undefined"&&profile)?profile.campus_id:null;}catch(_){}
    if(p) return p; try{return localStorage.getItem("lv-campus")||"";}catch(_){return "";}
  };
  window.lvViewCampus=function(){try{return localStorage.getItem("lv-view-campus")||"all";}catch(_){return "all";}};
  window.lvCampusBtnHtml=function(id,label){
    var r=rec(id);
    return '<span class="ico">'+(r&&!r.none?(r.custom?'<i class="fa-solid fa-graduation-cap"></i>':logoHtml(r)):'<i class="fa-solid fa-graduation-cap"></i>')+'</span><span class="t">'+(r?esc2(r.name)+(r.state?'<small>'+esc2([r.city,r.state].filter(Boolean).join(", "))+'</small>':''):'<span style="color:var(--text-muted)">'+esc2(label||"Choose your campus")+'</span>')+'</span><i class="fa-solid fa-chevron-down" style="color:var(--text-muted);font-size:.8rem"></i>';
  };

  var MASCOT='<svg viewBox="0 0 80 80" width="74" height="74" aria-hidden="true"><defs><linearGradient id="lvcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#0f9d6a"/></linearGradient></defs>'
   +'<ellipse cx="40" cy="74" rx="20" ry="4" fill="rgba(0,0,0,.12)"/><circle cx="40" cy="46" r="27" fill="url(#lvcg)"/><circle cx="40" cy="46" r="27" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"/>'
   +'<g class="lvc-eye"><ellipse cx="31" cy="46" rx="4" ry="5" fill="#073b2a"/><circle cx="32.3" cy="44" r="1.4" fill="#fff"/></g><g class="lvc-eye"><ellipse cx="49" cy="46" rx="4" ry="5" fill="#073b2a"/><circle cx="50.3" cy="44" r="1.4" fill="#fff"/></g>'
   +'<path d="M32 56q8 8 16 0" stroke="#073b2a" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="24" cy="54" r="4" fill="rgba(255,255,255,.28)"/><circle cx="56" cy="54" r="4" fill="rgba(255,255,255,.28)"/>'
   +'<polygon points="40,12 68,24 40,36 12,24" fill="#0b2a20"/><path d="M26 29v9q14 8 28 0v-9l-14 6z" fill="#123d2e"/><g class="lvc-tassel"><path d="M62 22v14" stroke="#fbbf24" stroke-width="2.4" stroke-linecap="round"/><circle cx="62" cy="38" r="3" fill="#fbbf24"/></g></svg>';
  window.lvMascotSvg=MASCOT;
  var LINES=["Hi! I'm Levi 🎓 Pick your campus and I'll show you what's near you.","Tap your school's logo — it only takes a second.","Visiting another campus? Browse it any time from the Home page.","Can't find your school? Add it at the bottom — we'll sort it out."];

  // ---- is this school already on the list (or already suggested)?
  var STOP={of:1,the:1,and:1,for:1,university:1,college:1,polytechnic:1,school:1,federal:1,state:1,institute:1,uni:1,univ:1,poly:1,"in":1,at:1,nigeria:1,science:1,sciences:1,technology:1,education:1};
  function toks(s){return String(s||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").split(/\s+/).filter(Boolean);}
  function dupCandidates(input){
    var all=toks(input), key=all.filter(function(t){return !STOP[t];}), joined=all.join(""), out=[];
    if(!key.length) key=all;
    function tokIn(t,hayToks){ return hayToks.some(function(h){return h===t||(t.length>=4&&(h.indexOf(t)===0||t.indexOf(h)===0&&h.length>=4));}); }
    function score(name,abbr){
      var ht=toks(name), hk=ht.filter(function(t){return !STOP[t];}), ab=String(abbr||"").toLowerCase().replace(/[^a-z0-9]/g,"");
      if(ht.join("")===joined) return 100;
      if(ab&&ab.length>=2&&(all.indexOf(ab)>=0||joined===ab)) return 90;
      if(key.every(function(t){return tokIn(t,ht);})&&key.length>=1) return 70+Math.min(key.length,3)+10*Math.min(1,key.length/Math.max(1,hk.length));
      if(hk.length>=2&&hk.every(function(t){return tokIn(t,all);})) return 60;
      var ov=key.filter(function(t){return tokIn(t,ht);}).length; if(key.length>=2&&ov>=2&&ov/key.length>=.6) return 50;
      return 0;
    }
    (DATA||[]).forEach(function(r){ var sc=score(r.name,r.abbr); if(sc) out.push({r:r,sc:sc}); });
    (SUBS||[]).forEach(function(n){ if(n.status==="approved") return; var sc=score(n.name,""); if(sc) out.push({r:{id:"custom:"+n.name,name:n.name,custom:true,pending:true},sc:sc}); });
    out.sort(function(a,b){return b.sc-a.sc;}); return out.slice(0,5).map(function(x){return x.r;});
  }
  function dupDrawer(root,name,cands,onUse){
    var old=root.querySelector(".lvc-dup"); if(old) old.remove();
    var d=document.createElement("div"); d.className="lvc-dup";
    d.innerHTML='<div class="lvc-dup-back"></div><div class="lvc-dup-sheet"><div class="lvc-dup-grab"></div><h3>Is this your school?</h3><p>These look like “'+esc2(name)+'”. Pick yours so everyone ends up on the same page.</p><div class="lvc-dup-list">'
     +cands.map(function(r,i){return '<button type="button" class="lvc-dup-row" data-i="'+i+'"><span class="lvc-logo">'+(r.custom?'<i class="fa-solid fa-graduation-cap"></i>':logoHtml(r))+'</span><span class="t"><b>'+esc2(r.name)+'</b>'+(r.pending?'<small>Added by another student · awaiting confirmation</small>':(r.state?'<small>'+esc2([r.city,r.state].filter(Boolean).join(", "))+'</small>':''))+'</span><i class="fa-solid fa-chevron-right"></i></button>';}).join("")
     +'</div><button type="button" class="lvc-dup-new">No, add “'+esc2(name)+'” as a new school</button><small class="lvc-dup-note">New schools are checked by Levromart before they’re confirmed.</small></div>';
    root.appendChild(d); requestAnimationFrame(function(){d.classList.add("on");});
    function shut(){d.classList.remove("on");setTimeout(function(){d.remove();},220);}
    d.querySelector(".lvc-dup-back").addEventListener("click",shut);
    d.querySelector(".lvc-dup-new").addEventListener("click",function(){shut();onUse(rec("custom:"+name));});
    d.querySelector(".lvc-dup-list").addEventListener("click",function(e){var b=e.target.closest("[data-i]");if(!b)return;var r=cands[+b.dataset.i];shut();onUse(r.custom?rec(r.id):rec(r.id));});
  }
  window.lvOpenCampusPicker=function(opts){
    opts=opts||{}; var existing=document.getElementById("lvCampus"); if(existing) existing.remove();
    var w=document.createElement("div"); w.id="lvCampus"; w.setAttribute("role","dialog"); w.setAttribute("aria-modal","true");
    w.innerHTML='<div class="lvc-top">'+(opts.required?'<span style="width:.4rem"></span>':'<button type="button" class="lvc-x" aria-label="Close"><i class="fa-solid fa-arrow-left"></i></button>')+'<div class="lvc-title">'+esc2(opts.title||"Choose your campus")+'</div>'+(opts.skippable?'<button type="button" class="lvc-skip">Not now</button>':'')+'</div>'
     +'<div class="lvc-hero"><div class="lvc-mascot" role="button" aria-label="Levi">'+MASCOT+'</div><div class="lvc-bubble">'+esc2(LINES[0])+'</div></div>'
     +'<div class="lvc-search"><div class="lvc-sbox"><i class="fa-solid fa-magnifying-glass"></i><input type="search" placeholder="Search your school, e.g. UNILAG" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" class="lvc-clear" aria-label="Clear"><i class="fa-solid fa-xmark"></i></button></div></div>'
     +'<div class="lvc-chips"></div><div class="lvc-scroll"><div class="lvc-count"></div><div class="lvc-grid"></div><div class="lvc-empty" style="display:none"></div><div class="lvc-sentinel" style="height:1px"></div></div>'
     +'<div class="lvc-foot">'+(opts.multi?'<button type="button" data-a="clear">Clear</button><button type="button" class="pri" data-a="done">Done</button>':'')+(opts.multi?'':(opts.allowAll?'<button type="button" class="pri" data-a="all"><i class="fa-solid fa-earth-africa"></i> All campuses</button>':'')+(opts.allowNone?'<button type="button" data-a="none"><i class="fa-solid fa-house"></i> Not on a campus</button>':'')+'<button type="button" data-a="custom"><i class="fa-solid fa-plus"></i> My school isn\'t here</button>')+'</div>'
     +'<div class="lvc-custom"><strong>Add your school</strong><input type="text" placeholder="Type your school\'s full name" maxlength="80"><div style="display:flex;gap:.6rem"><button type="button" class="lvc-chip" data-a="cancel" style="flex:1;padding:.75rem">Cancel</button><button type="button" class="lvc-chip on" data-a="addok" style="flex:1;padding:.75rem">Use this school</button></div></div>';
    document.body.appendChild(w); document.documentElement.style.overflow="hidden";
    var $=function(s){return w.querySelector(s);};
    var grid=$(".lvc-grid"),cnt=$(".lvc-count"),emp=$(".lvc-empty"),input=$(".lvc-sbox input"),clr=$(".lvc-clear"),chips=$(".lvc-chips"),sc=$(".lvc-scroll");
    var filter="all",q="",list=[],shown=0,PAGE=60,cur=opts.current||"";
    var multi=!!opts.multi,chosen=new Set(opts.selected||[]);
    function doneLabel(){var d=w.querySelector('[data-a="done"]');if(d)d.textContent="Done"+(chosen.size?" ("+chosen.size+")":"");}
    function close(){w.remove();document.documentElement.style.overflow="";if(io)io.disconnect();}
    function pick(r){close(); if(opts.onPick) opts.onPick(r);}
    var kinds=[["all","All"],["U","Universities"],["P","Polytechnics"],["E","Colleges of Education"],["C","Other colleges"]];
    chips.innerHTML=kinds.map(function(k){return '<button type="button" class="lvc-chip'+(k[0]===filter?' on':'')+'" data-k="'+k[0]+'">'+k[1]+'</button>';}).join("");
    function itemHtml(r){
      var sub=r.abbr&&r.abbr.length<=8?r.abbr:"";
      return '<button type="button" class="lvc-item'+((multi?chosen.has(r.id):r.id===cur)?' sel':'')+'" data-id="'+esc2(r.id)+'"><span class="lvc-logo">'+logoHtml(r)+'<span class="lvc-tick"><i class="fa-solid fa-check"></i></span></span><span class="lvc-name">'+esc2(r.name.replace(/,\s*[A-Z][a-z]+( State)?$/,""))+'</span>'+(sub?'<span class="lvc-sub">'+esc2(sub)+'</span>':'')+'</button>';
    }
    function apply(){
      var toks=q.toLowerCase().replace(/[^a-z0-9 ]+/g," ").split(/\s+/).filter(Boolean);
      list=(DATA||[]).filter(function(r){
        if(filter!=="all"&&r.kind!==filter) return false;
        for(var i=0;i<toks.length;i++) if(r.hay.indexOf(toks[i])<0) return false; return true;});
      if(toks.length){var t0=toks.join(" ");list.sort(function(a,b){
        function sc(r){var ab=(r.abbr||"").toLowerCase();return ab===t0?0:(r.name.toLowerCase().indexOf(t0)===0?1:(ab.indexOf(t0)===0?2:3));}
        return sc(a)-sc(b)||a.name.localeCompare(b.name);});}
      shown=0; grid.innerHTML=""; sc.scrollTop=0; more();
      cnt.textContent=list.length+(list.length===1?" school":" schools");
      emp.style.display=list.length?"none":"block";
      emp.innerHTML=list.length?"":'<i class="fa-regular fa-face-frown" style="font-size:1.6rem"></i><p>No school matches "'+esc2(q)+'".<br>Try a shorter name, or add your school below.</p>';
    }
    function more(){ if(shown>=list.length) return; var next=list.slice(shown,shown+PAGE); shown+=next.length; grid.insertAdjacentHTML("beforeend",next.map(itemHtml).join("")); }
    var io=null; if("IntersectionObserver" in window){io=new IntersectionObserver(function(es){if(es[0].isIntersecting)more();},{root:sc,rootMargin:"600px"});io.observe($(".lvc-sentinel"));}
    else sc.addEventListener("scroll",function(){if(sc.scrollTop+sc.clientHeight>sc.scrollHeight-800)more();},{passive:true});
    load().then(function(){ if(!document.body.contains(w)) return; if(cur&&!q){ } apply(); });
    var t=null; input.addEventListener("input",function(){clr.style.display=input.value?"block":"none";clearTimeout(t);t=setTimeout(function(){q=input.value.trim();apply();},120);});
    clr.addEventListener("click",function(){input.value="";clr.style.display="none";q="";apply();input.focus();});
    chips.addEventListener("click",function(e){var b=e.target.closest("[data-k]");if(!b)return;filter=b.dataset.k;chips.querySelectorAll(".lvc-chip").forEach(function(c){c.classList.toggle("on",c===b);});apply();});
    grid.addEventListener("click",function(e){var b=e.target.closest("[data-id]");if(!b)return;
      if(multi){var id=b.dataset.id;if(chosen.has(id))chosen.delete(id);else chosen.add(id);b.classList.toggle("sel",chosen.has(id));doneLabel();return;}
      var r=rec(b.dataset.id);if(r)pick(r);});
    var xb=$(".lvc-x"); if(xb) xb.addEventListener("click",function(){close();if(opts.onClose)opts.onClose();});
    if(multi) setTimeout(doneLabel,0);
    var sk=$(".lvc-skip"); if(sk) sk.addEventListener("click",function(){close();if(opts.onSkip)opts.onSkip();});
    var mas=$(".lvc-mascot"),bub=$(".lvc-bubble"),li=0;
    mas.addEventListener("click",function(){mas.classList.remove("hop");void mas.offsetWidth;mas.classList.add("hop");li=(li+1)%LINES.length;bub.textContent=LINES[li];});
    var custom=$(".lvc-custom"),cin=custom.querySelector("input");
    w.querySelector(".lvc-foot").addEventListener("click",function(e){var b=e.target.closest("[data-a]");if(!b)return;var a=b.dataset.a;
      if(a==="done"){close();if(opts.onDone)opts.onDone(Array.from(chosen));} else if(a==="clear"){chosen.clear();grid.querySelectorAll(".lvc-item.sel").forEach(function(n){n.classList.remove("sel");});doneLabel();} else if(a==="all") pick(rec("all")); else if(a==="none") pick(rec("none")); else if(a==="custom"){custom.classList.add("on");setTimeout(function(){cin.focus();},60);}});
    custom.addEventListener("click",function(e){var b=e.target.closest("[data-a]");if(!b)return;
      if(b.dataset.a==="cancel") custom.classList.remove("on");
      else{var v=cin.value.trim().replace(/\s+/g," ");if(v.length<3){cin.focus();return;}
        var cands=dupCandidates(v);
        if(!cands.length){pick(rec("custom:"+v));return;}
        dupDrawer(w,v,cands,function(r){pick(r);});}});
    if(opts.focusSearch) setTimeout(function(){input.focus();},300);
  };

  // ---- saving the chosen campus
  window.lvSaveCampus=async function(id){
    try{localStorage.setItem("lv-campus",id);}catch(_){}
    var uid=null; try{uid=session&&session.user&&session.user.id;}catch(_){}
    if(!uid){ try{var g=await sb.auth.getSession();uid=g&&g.data&&g.data.session&&g.data.session.user.id;}catch(_){} }
    if(!uid){ try{localStorage.setItem("lv-campus-pending",id);}catch(_){} return false; }
    var r=await sb.from("users").update({campus_id:id}).eq("id",uid);
    if(r.error){ try{localStorage.setItem("lv-campus-pending",id);}catch(_){} throw r.error; }
    try{localStorage.removeItem("lv-campus-pending");}catch(_){}
    if(String(id).indexOf("custom:")===0){
      try{
        var sr=await sb.rpc("submit_campus_school",{p_name:String(id).slice(7)});
        var row=sr&&sr.data&&(Array.isArray(sr.data)?sr.data[0]:sr.data);
        if(row&&row.status==="merged"&&row.merged_into){ await sb.from("users").update({campus_id:row.merged_into}).eq("id",uid); id=row.merged_into; try{localStorage.setItem("lv-campus",id);}catch(_){} }
        else if(row&&row.status==="pending"){ try{showToast("Thanks! We'll confirm your school shortly.","success");}catch(_){} }
      }catch(_){}
    }
    try{ if(profile) profile.campus_id=id; }catch(_){}
    try{ if(vendor) vendor.campus_id=id; }catch(_){}
    return true;
  };

  // ---- a "Your campus" row inside forms
  function fieldHtml(id){return '<div class="lv-campus-field"><button type="button" class="lv-campus-btn" data-lvcf>'+window.lvCampusBtnHtml(id)+'</button></div>';}
  function mountField(anchorEl,opt){
    if(!anchorEl||anchorEl.parentNode.querySelector("[data-lvcf-wrap='"+opt.key+"']")) return;
    var lab=document.createElement("label"); lab.textContent=opt.label||"Your campus"; lab.setAttribute("data-lvcf-wrap",opt.key);
    var wrap=document.createElement("div"); wrap.setAttribute("data-lvcf-wrap",opt.key); wrap.innerHTML=fieldHtml(opt.get());
    anchorEl.insertAdjacentElement("afterend",wrap); anchorEl.insertAdjacentElement("afterend",lab);
    var paint=function(){ wrap.innerHTML=fieldHtml(opt.get()); };
    wrap.addEventListener("click",function(e){ if(!e.target.closest("[data-lvcf]")) return;
      load().then(function(){ window.lvOpenCampusPicker({title:opt.title||"Choose your campus",current:opt.get(),allowNone:true,onPick:function(r){Promise.resolve(opt.set(r.id)).then(paint);}}); }); });
    load().then(paint);
  }
  window.__lvSignupCampus=window.__lvSignupCampus||"";
  function scan(){
    var sx=document.getElementById("signupExtraFields");
    var city=document.getElementById("loginCity");
    if(city) mountField(city,{key:"signup",get:function(){return window.__lvSignupCampus;},set:function(id){window.__lvSignupCampus=id;return Promise.resolve();},title:"Which campus are you on?"});
    ["vaCity","veCity"].forEach(function(cid){
      var el=document.getElementById(cid);
      if(el&&window.lvMountVendorCampus) window.lvMountVendorCampus(el,cid);
    });
    mountHomeBar();
  }

  // ---- campus bar on Home
  function barHtml(){
    var v=window.lvViewCampus(),mine=window.lvMyCampusId(),r=v==="all"?null:rec(v);
    var chev='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    var pin='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
    return '<button type="button" class="lvcb-main" aria-label="Choose a campus"><span class="ico">'+(r?logoHtml(r):pin)+'</span><span class="t"><b>'+esc2(r?r.name:"All campuses")+'</b></span><span class="chev">'+chev+'</span></button>'
      +'<div class="seg" role="tablist"><button type="button" role="tab" data-m="mine" aria-selected="'+(mine&&v===mine)+'" class="'+(mine&&v===mine?'on':'')+'">Mine</button><button type="button" role="tab" data-m="all" aria-selected="'+(v==="all")+'" class="'+(v==="all"?'on':'')+'">All</button></div>'
      +'<button type="button" class="lvcb-trophy" data-lb="1" aria-label="Vendor of the Week" title="Vendor of the Week"><i class="fa-solid fa-trophy"></i></button>';
  }
  function setView(id){
    try{localStorage.setItem("lv-view-campus",id);}catch(_){}
    var bar=document.getElementById("lvCampusBar");
    if(bar){ var h0=barHtml(); bar.innerHTML=h0; bar.__lvH=h0; spotIcon(bar); }
    try{window.lvApplyCampusScope&&window.lvApplyCampusScope();}catch(_){}
    try{ if(document.getElementById("vendorsMap")&&typeof renderVendorsMap==="function") setTimeout(renderVendorsMap,60); }catch(_){}
    setTimeout(function(){ try{window.lvApplyCampusScope&&window.lvApplyCampusScope();}catch(_){} },30);
    // fast path: re-filter the catalogue already in memory and repaint only the grid
    try{
      var grid=document.getElementById("productGrid");
      var mem=window.__homeBrowseIdxMem, raw=null;
      if(mem){ var slot=Math.floor(Date.now()/600000); raw=mem.get("levro-browse-idx3:"+slot+":all:all")||null; }
      var plainHome=!(typeof currentSectorId!=="undefined"&&currentSectorId)&&!(typeof currentHomeCategoryId!=="undefined"&&currentHomeCategoryId);
      if(grid&&raw&&plainHome&&typeof filterHomeProducts==="function"){
        var idx=id==="all"?raw:raw.filter(function(x){return x.campus_id===id||x.ops_scope==="all"||(x.ops_scope==="multiple"&&Array.isArray(x.ops)&&x.ops.indexOf(id)>-1);});
        window.__homeBrowseIndex=idx; window.__homeFullIndex=idx;
        try{
          var allCats=window.__levroAllCategories||[], rail=document.querySelector("#app .levro-home-cat-rail");
          if(rail&&allCats.length&&typeof homeCategoryRailHtml==="function"){
            var have=new Set(idx.map(function(x){return String(x.category_id);}));
            var cats=allCats.filter(function(c){return c.parent_category_id&&have.has(String(c.id));});
            if(cats.length){ window.__levroRailCategories=cats; var tmp=document.createElement("div"); tmp.innerHTML=homeCategoryRailHtml(cats); rail.replaceWith(tmp.firstElementChild); }
          }
        }catch(_){}
        grid.style.transition="opacity .12s"; grid.style.opacity=".45";
        Promise.resolve(filterHomeProducts()).catch(function(){}).then(function(){ grid.style.opacity=""; });
        return;
      }
    }catch(_){}
    window.__homeFullIndex=null;
    try{navigate("home",{},false);}catch(_){}
  }
  // the trophy button turns into a crown when there is a Vendor of the Week
  function spotIcon(bar){
    try{ if(!window.lvVendorSpot) return; window.lvVendorSpot().then(function(sp){ var b=bar.querySelector(".lvcb-trophy"); if(!b||!sp) return; var w=sp.winner; var i=b.querySelector("i"); if(w){ i.className="fa-solid fa-crown"; b.title="Vendor of the Week: "+w.business_name; b.setAttribute("aria-label",b.title); } }); }catch(_){}
  }
  function mountHomeBar(){
    var grid=document.getElementById("productGrid"); if(!grid) return;
    var bar=document.getElementById("lvCampusBar");
    if(bar){ if(!bar.dataset.painted) {bar.innerHTML=barHtml();bar.dataset.painted="1";} return; }
    var anchor=document.getElementById("homePromotionalViewport"); anchor=anchor&&(anchor.closest("section")||anchor.parentElement);
    anchor=anchor||document.getElementById("browseSection"); if(!anchor||!anchor.parentNode) return;
    var kept=window.__lvBarStash;
    if(kept&&!kept.isConnected&&kept.dataset.painted){   // reuse the bar from the last Home visit: its logo is already decoded, so nothing blinks
      window.__lvBarStash=null; bar=kept; anchor.parentNode.insertBefore(bar,anchor);
      var h=barHtml(); if(bar.__lvH!==h){ bar.innerHTML=h; bar.__lvH=h; spotIcon(bar); }
      return;
    }
    bar=document.createElement("div"); bar.id="lvCampusBar"; anchor.parentNode.insertBefore(bar,anchor);
    load().then(function(){var h=barHtml();bar.innerHTML=h;bar.__lvH=h;bar.dataset.painted="1"; spotIcon(bar);});
    bar.addEventListener("click",function(e){
      if(e.target.closest("[data-lb]")){ try{navigate("leaderboard");}catch(_){} return; }
      var seg=e.target.closest("[data-m]");
      if(seg){ var m=seg.dataset.m; if(m==="all") setView("all"); else { var mine=window.lvMyCampusId(); if(mine&&mine!=="none") setView(mine); else window.lvOpenCampusPicker({title:"Choose your campus",current:"",allowNone:true,onPick:function(r){window.lvSaveCampus(r.id).catch(function(){}).then(function(){ if(r.id!=="none") setView(r.id); else bar.innerHTML=barHtml(); });}}); } return; }
      if(e.target.closest(".lvcb-main")) load().then(function(){ window.lvOpenCampusPicker({title:"Browse a campus",current:window.lvViewCampus(),allowAll:true,onPick:function(r){setView(r.all?"all":r.id);}}); });
    });
  }

  // ---- ask people who haven't chosen yet
  var asked=false,vAsked=false;
  function gate(){
    try{
      if(!vAsked&&typeof session!=="undefined"&&session&&typeof vendor!=="undefined"&&vendor&&vendor.id&&typeof profile!=="undefined"&&profile&&profile.role!=="admin"&&!document.getElementById("lvCampus")&&!document.getElementById("lvSetup")&&typeof window.lvVendorSetup==="function"){
        vAsked=true; window.lvVendorSetup(); return;
      }
      if(asked||typeof session==="undefined"||!session||typeof profile==="undefined"||!profile) return;
      if(document.getElementById("lvCampus")||(document.getElementById("loginModal")&&!document.getElementById("loginModal").classList.contains("hidden"))) return;
      if(profile.campus_id) return;
      if(typeof vendor!=="undefined"&&vendor&&vendor.id) return;
      var pend=null; try{pend=localStorage.getItem("lv-campus-pending");}catch(_){}
      if(pend){ window.lvSaveCampus(pend).catch(function(){}); asked=true; return; }
      var skipAt=0; try{skipAt=Number(sessionStorage.getItem("lv-campus-skip")||0);}catch(_){}
      if(skipAt) return;
      if(profile.role==="admin") return;
      asked=true;
      load().then(function(){ window.lvOpenCampusPicker({title:"Which campus are you on?",current:"",allowNone:true,skippable:true,
        onPick:function(r){window.lvSaveCampus(r.id).then(function(){try{showToast("Campus saved.","success");}catch(_){}}).catch(function(){try{showToast("Couldn't save your campus.","error");}catch(_){}});},
        onSkip:function(){try{sessionStorage.setItem("lv-campus-skip","1");}catch(_){}}}); });
    }catch(_){}
  }
  try{ new MutationObserver(function(){ scan(); }).observe(document.body,{childList:true,subtree:true}); }catch(_){}
  setInterval(gate,2500); setTimeout(scan,600);
  try{ sb.auth.onAuthStateChange(function(ev){ if(ev==="SIGNED_OUT"){ try{localStorage.removeItem("lv-view-campus");}catch(_){} asked=false; window.__lvSignupCampus=""; try{sessionStorage.removeItem("lv-campus-skip");}catch(_){} } }); }catch(_){}
})();

/* ---- request-photos-js ---- */
/* photos on buyer requests + the vendor's "which requests do I receive" setting */
window.__reqPhotos=window.__reqPhotos||[];
function reqPhotosPaint(){
  var box=document.getElementById("reqPhotoBox"); if(!box) return;
  var list=window.__reqPhotos||[];
  var pick="document.getElementById('reqPhotoInput').click()";
  if(!list.length){
    box.className="req-photos empty";
    box.innerHTML='<button type="button" class="req-drop" onclick="'+pick+'"><span class="rd-ico"><i class="fa-solid fa-cloud-arrow-up"></i></span><b>Add photos</b><small>Up to 4 · helps vendors send the right offer</small></button>';
    return;
  }
  box.className="req-photos";
  box.innerHTML=list.map(function(p,i){return '<div class="req-ph"><img src="'+p.url+'" alt=""><button type="button" aria-label="Remove photo" onclick="reqPhotoRemove('+i+')"><i class="fa-solid fa-xmark"></i></button></div>';}).join("")
   +(list.length<4?'<button type="button" class="req-ph add" onclick="'+pick+'"><i class="fa-solid fa-plus"></i><span>Add</span></button>':'');
}
async function reqPhotosPicked(e){
  var files=Array.prototype.slice.call(e.target.files||[]); e.target.value="";
  var room=4-(window.__reqPhotos||[]).length;
  for(var i=0;i<files.length&&i<room;i++){
    var f=files[i]; if(!/^image\//.test(f.type)) continue;
    try{ var small=await lvPrepareImageFile(f,1600); window.__reqPhotos.push({file:small,url:URL.createObjectURL(small)}); }
    catch(_){ showToast("Couldn't read one of the photos.","error"); }
  }
  if(files.length>room) showToast("You can add up to 4 photos.","info");
  reqPhotosPaint();
}
function reqPhotoRemove(i){ var p=(window.__reqPhotos||[]).splice(i,1)[0]; if(p) try{URL.revokeObjectURL(p.url);}catch(_){} reqPhotosPaint(); }
function reqPhotosHtml(photos){
  var l=Array.isArray(photos)?photos.filter(Boolean):[]; if(!l.length) return "";
  window.__reqPhotoSets=window.__reqPhotoSets||[]; var k=window.__reqPhotoSets.push(l)-1;
  return '<div class="req-ph-row">'+l.map(function(u,i){return '<button type="button" class="req-ph-thumb" onclick="event.stopPropagation();reqPhotoOpen('+k+','+i+')"><img src="'+esc(u)+'" alt="Requested item photo" loading="lazy"></button>';}).join("")+'</div>';
}
function reqPhotoOpen(k,i){
  var l=(window.__reqPhotoSets||[])[k]||[]; if(!l.length) return;
  var w=document.createElement("div"); w.className="req-lightbox";
  w.innerHTML='<button type="button" class="x" aria-label="Close"><i class="fa-solid fa-xmark"></i></button><div class="strip">'+l.map(function(u){return '<img src="'+esc(u)+'" alt="">';}).join("")+'</div><div class="n">'+(i+1)+' / '+l.length+'</div>';
  document.body.appendChild(w);
  var strip=w.querySelector(".strip"); strip.scrollLeft=strip.clientWidth*i;
  strip.addEventListener("scroll",function(){w.querySelector(".n").textContent=(Math.round(strip.scrollLeft/strip.clientWidth)+1)+" / "+l.length;},{passive:true});
  w.addEventListener("click",function(e){ if(e.target===w||e.target.closest(".x")) w.remove(); });
}
async function setVendorRequestPref(v){
  if(!vendor||!vendor.id) return;
  var r=await sb.from("vendors").update({request_pref:v}).eq("id",vendor.id);
  if(r.error){ showToast(r.error.message||"Couldn't save that setting.","error"); return; }
  vendor.request_pref=v;
  showToast(v==="all"?"You'll see all customer requests.":v==="sector"?"You'll only see requests in your sector.":"Customer requests are off.","success");
  try{ await navigate("vendorRequests",{},false); }catch(_){}
}

/* ---- lv-campus2-js ---- */
(function(){
  "use strict";
  var LEVELS=[["Undergraduate",["100 Level","200 Level","300 Level","400 Level","500 Level","600 Level"]],["Pre-degree / Foundation",["JUPEB","IJMB","Pre-degree","Remedial / Foundation"]],["Polytechnic / College",["ND 1","ND 2","HND 1","HND 2","NCE 1","NCE 2","NCE 3","Diploma / Certificate"]],["Postgraduate",["PGD","Masters (MSc / MA / MBA)","MPhil","PhD"]]];
  function e2(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function V(){try{return(typeof vendor!=="undefined"&&vendor&&vendor.id)?vendor:null;}catch(_){return null;}}
  function toast(m,t){try{showToast(m,t||"info");}catch(_){}}

  // ---------- where the vendor operates
  function getOps(){var v=V();if(v) return {scope:v.operating_scope||"one",list:(v.operating_campuses||[]).slice()};
    try{return JSON.parse(localStorage.getItem("lv-vendor-ops")||"null")||{scope:"one",list:[]};}catch(_){return {scope:"one",list:[]};}}
  function saveOps(st){
    var v=V(); var major=window.lvMyCampusId();
    if(st.scope==="multiple"&&major&&major!=="none"&&st.list.indexOf(major)<0) st.list.push(major);
    try{localStorage.setItem("lv-vendor-ops",JSON.stringify(st));}catch(_){}
    if(!v){ try{localStorage.setItem("lv-vendor-ops-pending","1");}catch(_){} return Promise.resolve(); }
    return sb.from("vendors").update({operating_scope:st.scope,operating_campuses:st.list}).eq("id",v.id).then(function(r){ if(r.error) throw r.error; v.operating_scope=st.scope; v.operating_campuses=st.list; });
  }
  function pickMany(st,done){
    window.lvCampuses().then(function(){ window.lvOpenCampusPicker({title:"Campuses you sell on",multi:true,selected:st.list,onDone:function(ids){st.list=ids;done(st);}}); });
  }
  function chipsHtml(st){
    if(st.scope!=="multiple") return "";
    var major=window.lvMyCampusId(); var ids=st.list.slice(); if(major&&major!=="none"&&ids.indexOf(major)<0) ids.unshift(major);
    return '<div class="lvv-chips">'+ids.map(function(id){var r=window.lvCampusById(id);return '<span>'+e2(r?(r.abbr&&r.abbr.length<=8?r.abbr:r.name):id)+'</span>';}).join("")+'</div>';
  }
  function blockHtml(){
    var st=getOps(),major=window.lvMyCampusId();
    return '<label>Major campus</label><div class="lv-campus-field"><button type="button" class="lv-campus-btn" data-a="major">'+window.lvCampusBtnHtml(major&&major!=="none"?major:"","Choose your major campus")+'</button></div>'
     +'<p class="lvv-hint">Your major campus is the one shown on your store, vendor cards and featured listings.</p>'
     +'<label>Where do you sell?</label><div class="lvv-seg">'+[["one","One campus"],["multiple","Selected campuses"],["all","All campuses"]].map(function(o){return '<button type="button" data-s="'+o[0]+'" class="'+(st.scope===o[0]?'on':'')+'">'+o[1]+'</button>';}).join("")+'</div>'
     +(st.scope==="multiple"?'<button type="button" class="lv-campus-btn" data-a="many"><span class="ico"><i class="fa-solid fa-list-check"></i></span><span class="t">'+(st.list.length?st.list.length+" campus"+(st.list.length===1?"":"es")+" selected":"Choose campuses")+'<small>Tick every campus you deliver to or sell on</small></span><i class="fa-solid fa-chevron-down" style="color:var(--text-muted);font-size:.8rem"></i></button>'+chipsHtml(st):'')
     +'<p class="lvv-hint">'+(st.scope==="one"?"Customers on your campus will see your products.":st.scope==="multiple"?"Customers on every campus you tick will see your products.":"Customers on every campus will see your products.")+'</p>';
  }
  window.lvMountVendorCampus=function(anchor){
    var host=anchor.parentNode; if(host.querySelector("[data-lvv]")) return;
    var wrap=document.createElement("div"); wrap.className="lvv"; wrap.setAttribute("data-lvv","1");
    anchor.insertAdjacentElement("afterend",wrap);
    function paint(){ wrap.innerHTML=blockHtml(); }
    window.lvCampuses().then(function(){ paint(); mountSV(wrap); });
    wrap.addEventListener("click",function(e){
      var b=e.target.closest("[data-a],[data-s]"); if(!b) return;
      if(b.dataset.a==="major"){ window.lvCampuses().then(function(){ window.lvOpenCampusPicker({title:"Your major campus",current:window.lvMyCampusId(),onPick:function(r){ window.lvSaveCampus(r.id).then(paint).catch(function(){toast("Couldn't save your campus.","error");}); }}); }); }
      else if(b.dataset.s){ var st=getOps(); st.scope=b.dataset.s; saveOps(st).then(function(){ paint(); if(st.scope==="multiple"&&!st.list.length) pickMany(st,function(s2){saveOps(s2).then(paint).catch(function(){toast("Couldn't save.","error");});}); }).catch(function(){toast("Couldn't save.","error");}); }
      else if(b.dataset.a==="many"){ var st2=getOps(); pickMany(st2,function(s3){saveOps(s3).then(paint).catch(function(){toast("Couldn't save.","error");});}); }
    });
  };
  window.lvMountSV=mountSV;
  // asked right after a vendor picks their major campus
  window.lvVendorScopeSheet=function(){
    var old=document.getElementById("lvScope"); if(old) old.remove();
    var w=document.createElement("div"); w.id="lvScope"; w.className="lv-cm";
    w.innerHTML='<div class="lv-cm-back"></div><div class="lv-cm-card lv-scope-card" role="dialog" aria-modal="true"><span class="lv-cm-handle"></span><strong class="lv-cm-title">Where do you sell?</strong>'
     +'<button type="button" class="opt" data-s="one"><span>Only my campus</span><small>Just the campus you picked</small></button>'
     +'<button type="button" class="opt" data-s="multiple"><span>Selected campuses</span><small>Choose the campuses you sell on</small></button>'
     +'<button type="button" class="opt" data-s="all"><span>All campuses</span><small>Everyone on the app can buy from you</small></button></div>';
    document.body.appendChild(w);
    w.addEventListener("click",function(e){ var b=e.target.closest("[data-s]"); if(!b) return;
      var st=getOps(); st.scope=b.dataset.s; w.remove();
      saveOps(st).then(function(){ if(st.scope==="multiple") pickMany(st,function(s2){saveOps(s2).catch(function(){});}); toast("Saved.","success"); }).catch(function(){toast("Couldn't save.","error");}); });
  };

  // ---------- student verification
  var svMem={};
  function levelOptions(sel){return '<option value="">Select your level</option>'+LEVELS.map(function(g){return '<optgroup label="'+g[0]+'">'+g[1].map(function(l){return '<option '+(l===sel?'selected':'')+'>'+l+'</option>';}).join("")+'</optgroup>';}).join("");}
  function mountSV(after,cb){
    if(after.parentNode.querySelector("[data-lvsv]")) return;
    var box=document.createElement("div"); box.className="lv-sv"; box.setAttribute("data-lvsv","1");
    after.insertAdjacentElement("afterend",box);
    var v=V(), row=null, files={id:null,bio:null}, face=null, warmed=false;
    function stBadge(){ if(!row) return ""; var t={pending:["pending","fa-hourglass-half","Under review"],approved:["approved","fa-circle-check","Verified student"],rejected:["rejected","fa-circle-xmark","Needs attention"]}[row.status]||["pending","fa-hourglass-half","Under review"];
      return '<span class="st '+t[0]+'"><i class="fa-solid '+t[1]+'"></i> '+t[2]+'</span>'+(window.lvFaceStatusHtml?' '+window.lvFaceStatusHtml(row):'')+(row.status==="rejected"&&row.review_note?'<div class="note">'+e2(row.review_note)+'</div>':""); }
    function faceBtn(r){
      var haveDocs=!!((files.id||r.id_card_url)&&(files.bio||r.biodata_url)), done=!!(face||r.selfie_url);
      if(haveDocs&&!warmed){ warmed=true; try{ if(window.lvFacePreload&&!(navigator.connection&&navigator.connection.saveData)){ window.lvFacePreload(); window.lvFacePrepDocs([files.id?files.id.file:r.id_card_url, files.bio?files.bio.file:r.biodata_url].filter(Boolean)); } }catch(_){} }
      return '<button type="button" class="face-btn '+(done?'done':(haveDocs?'':'off'))+'" data-face="1"><span class="fi">'+(face?'<img src="'+face.url+'" alt="">':'<i class="fa-solid fa-face-smile"></i>')+'</span><span class="t"><b>'+(done?'Face check done':'Verify your face')+'</b><small>'+(done?'Tap to retake':'Step 4 · a quick selfie and a blink')+'</small></span><i class="fa-solid '+(done?'fa-circle-check':'fa-chevron-right')+'"></i></button>';
    }
    function paint(){
      if(row&&row.status==="approved"){ box.innerHTML='<h4>Student verification</h4>'+stBadge()+'<p class="sub">Your student details have been verified. A "Verified student" badge shows on your store.</p>'; if(cb) cb(); return; }
      var r=row||{};
      box.innerHTML='<h4>Student verification</h4><p class="sub">Show customers you\'re a real student. Your documents are only seen by LevroMart admins.</p>'+stBadge()
       +'<label>Matric / registration number</label><input id="svMatric" value="'+e2(r.matric_number||"")+'" placeholder="e.g. 190401001" autocomplete="off">'
       +'<label>Faculty</label><input id="svFaculty" value="'+e2(r.faculty||"")+'" placeholder="e.g. Engineering" autocomplete="off">'
       +'<label>Department</label><input id="svDept" value="'+e2(r.department||"")+'" placeholder="e.g. Computer Science" autocomplete="off">'
       +'<label>Level of study</label><select id="svLevel">'+levelOptions(r.level)+'</select>'
       +'<div class="up"><button type="button" data-f="id" class="'+((files.id||r.id_card_url)?'has':'')+'">'+((files.id||r.id_card_url)?'<img src="'+(files.id?files.id.url:e2(r.id_card_url))+'" alt=""><span>School ID card</span>':'<i class="fa-regular fa-id-card"></i>School ID card')+'</button>'
       +'<button type="button" data-f="bio" class="'+((files.bio||r.biodata_url)?'has':'')+'">'+((files.bio||r.biodata_url)?'<img src="'+(files.bio?files.bio.url:e2(r.biodata_url))+'" alt=""><span>Biodata page</span>':'<i class="fa-regular fa-file-lines"></i>Biodata page')+'</button></div>'
       +faceBtn(r)
       +'<input type="file" accept="image/*" class="hidden" id="svFile">'
       +'<button type="button" class="btn go" data-go="1">'+(row?"Resubmit for review":"Submit for verification")+'</button>';
    }
    function load(){
      if(!v){ try{var p=JSON.parse(localStorage.getItem("lv-sv-pending")||"null"); if(p) row={matric_number:p.matric,faculty:p.faculty,department:p.department,level:p.level,id_card_url:p.idUrl,biodata_url:p.bioUrl,selfie_url:p.selfieUrl,face_match:p.faceMatch,status:"pending"};}catch(_){} paint(); return; }
      sb.from("vendor_student_verification").select("*").eq("vendor_id",v.id).maybeSingle().then(function(r){ row=r&&r.data||null; paint(); });
    }
    var cur=null;
    box.addEventListener("click",function(e){
      if(e.target.closest("[data-face]")){ doFace(); return; }
      var f=e.target.closest("[data-f]"); if(f){ cur=f.dataset.f; document.getElementById("svFile")||0; box.querySelector("#svFile").click(); return; }
      if(e.target.closest("[data-go]")) submit(e.target.closest("[data-go]"));
    });
    box.addEventListener("change",async function(e){
      if(e.target.id!=="svFile"||!cur) return; var file=e.target.files[0]; e.target.value=""; if(!file) return;
      var keep={m:box.querySelector("#svMatric").value,f:box.querySelector("#svFaculty").value,d:box.querySelector("#svDept").value,l:box.querySelector("#svLevel").value};
      try{ var small=await lvPrepareImageFile(file,1400); files[cur]={file:small,url:URL.createObjectURL(small)}; }catch(_){ toast("Couldn't read that photo.","error"); }
      row=row||null; paint(); box.querySelector("#svMatric").value=keep.m; box.querySelector("#svFaculty").value=keep.f; box.querySelector("#svDept").value=keep.d; box.querySelector("#svLevel").value=keep.l;
    });
    function keepInputs(){ return {m:box.querySelector("#svMatric").value,f:box.querySelector("#svFaculty").value,d:box.querySelector("#svDept").value,l:box.querySelector("#svLevel").value}; }
    function restoreInputs(k){ box.querySelector("#svMatric").value=k.m; box.querySelector("#svFaculty").value=k.f; box.querySelector("#svDept").value=k.d; box.querySelector("#svLevel").value=k.l; }
    async function doFace(){
      var r=row||{};
      if(!((files.id||r.id_card_url)&&(files.bio||r.biodata_url))){ toast("Upload your ID card and biodata page first.","error"); return; }
      if(!window.lvFaceCheck){ toast("Face check isn't available right now.","error"); return; }
      var keep=keepInputs();
      var docs=[files.id?files.id.file:r.id_card_url, files.bio?files.bio.file:r.biodata_url].filter(Boolean);
      var res=await window.lvFaceCheck({docs:docs});
      while(res&&res.retry){ res=await window.lvFaceCheck({docs:docs}); }
      if(!res||!res.blob) return;
      face=res; paint(); restoreInputs(keep);
      if(res.match==="mismatch") toast("The photo doesn't look like your ID yet. You can retake it, or submit and an admin will review.","info");
      else toast("Face check done.","success");
    }
    async function submit(btn){
      var m=box.querySelector("#svMatric").value.trim(),f=box.querySelector("#svFaculty").value.trim(),d=box.querySelector("#svDept").value.trim(),l=box.querySelector("#svLevel").value;
      if(!m||!f||!d||!l){ toast("Fill in your matric number, faculty, department and level.","error"); return; }
      var hasId=files.id||(row&&row.id_card_url), hasBio=files.bio||(row&&row.biodata_url);
      if(!hasId||!hasBio){ toast("Upload your ID card and biodata page.","error"); return; }
      if(!face&&!(row&&row.selfie_url)){ toast("Complete the face check (step 4).","error"); return; }
      var old=btn.innerHTML; btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Sending…';
      try{
        var uid=session&&session.user&&session.user.id, base="vendor-logos/verification/"+(v?v.id:uid)+"/", ts=Date.now();
        // the three photos upload at the same time
        var out=await Promise.all([
          files.id?uploadToR2(files.id.file,base+"id-"+ts+".jpg","image/jpeg"):Promise.resolve(row.id_card_url),
          files.bio?uploadToR2(files.bio.file,base+"bio-"+ts+".jpg","image/jpeg"):Promise.resolve(row.biodata_url),
          face?uploadToR2(face.blob,base+"face-"+ts+".jpg","image/jpeg"):Promise.resolve(row.selfie_url)
        ]);
        var idUrl=out[0],bioUrl=out[1],selfieUrl=out[2];
        var fd=face?{face_distance:face.distance,face_match:face.match,face_liveness:face.liveness}:{face_distance:row.face_distance,face_match:row.face_match,face_liveness:row.face_liveness};
        var idFile=files.id?files.id.file:null, bioFile=files.bio?files.bio.file:null;
        if(v){
          var rec=Object.assign({vendor_id:v.id,matric_number:m,faculty:f,department:d,level:l,id_card_url:idUrl,biodata_url:bioUrl,selfie_url:selfieUrl,face_checked_at:new Date().toISOString(),face_v:2,status:"pending",review_note:null,updated_at:new Date().toISOString()},fd);
          var up=await sb.from("vendor_student_verification").upsert(rec,{onConflict:"vendor_id"});
          if(up.error) throw up.error;
          row=Object.assign({},rec); files={id:null,bio:null}; face=null;
          toast("Submitted. We'll review your documents shortly.","success"); if(cb) setTimeout(cb,300);
          // quietly read the ID card text so the reviewer can see whether the matric number / name appear on it
          if(window.lvOcrRead&&(idFile||bioFile)){
            window.lvOcrRead([idFile,bioFile].filter(Boolean),m,(typeof profile!=="undefined"&&profile&&profile.name)||"").then(function(o){
              if(!o) return;
              return sb.from("vendor_student_verification").update({ocr_matric_found:o.matric,ocr_name_found:o.name,ocr_text:o.text,ocr_checked_at:new Date().toISOString(),status:"pending"}).eq("vendor_id",v.id);
            }).catch(function(){});
          }
        } else {
          localStorage.setItem("lv-sv-pending",JSON.stringify({matric:m,faculty:f,department:d,level:l,idUrl:idUrl,bioUrl:bioUrl,selfieUrl:selfieUrl,faceDistance:fd.face_distance,faceMatch:fd.face_match,faceLiveness:fd.face_liveness}));
          row={matric_number:m,faculty:f,department:d,level:l,id_card_url:idUrl,biodata_url:bioUrl,selfie_url:selfieUrl,face_match:fd.face_match,status:"pending"}; files={id:null,bio:null}; face=null;
          toast("Saved. It will be submitted with your application.","success");
        }
        paint();
      }catch(err){ btn.disabled=false; btn.innerHTML=old; toast((err&&err.message)||"Couldn't submit. Try again.","error"); }
    }
    load();
  }

  // ---------- apply things that were saved before the vendor row existed
  setInterval(async function(){
    var v=V(); if(!v) return;
    try{
      if(localStorage.getItem("lv-vendor-ops-pending")==="1"){ localStorage.removeItem("lv-vendor-ops-pending"); var st=JSON.parse(localStorage.getItem("lv-vendor-ops")||"null"); if(st) await saveOps(st); }
      var p=JSON.parse(localStorage.getItem("lv-sv-pending")||"null");
      if(p){ localStorage.removeItem("lv-sv-pending"); var r=await sb.from("vendor_student_verification").upsert({vendor_id:v.id,matric_number:p.matric,faculty:p.faculty,department:p.department,level:p.level,id_card_url:p.idUrl,biodata_url:p.bioUrl,selfie_url:p.selfieUrl||null,face_distance:p.faceDistance==null?null:p.faceDistance,face_match:p.faceMatch||null,face_liveness:p.faceLiveness==null?null:p.faceLiveness,face_checked_at:p.selfieUrl?new Date().toISOString():null,status:"pending"},{onConflict:"vendor_id"}); if(r.error) localStorage.setItem("lv-sv-pending",JSON.stringify(p)); }
    }catch(_){}
  },4000);

  // ---------- campus chip on vendor cards, vendors page and storefronts
  function shortName(r){
    if(!r) return "";
    var a=(r.abbr||"").trim(); if(a&&a!=="-"&&a.length<=8) return a;
    var w=String(r.name||"").split(/[\s,]+/).filter(function(x){return x&&!/^(of|the|and|for|in|at|&)$/i.test(x);});
    if(w.length>=3){ var ac=w.map(function(x){return x[0];}).join("").toUpperCase(); if(ac.length>=3&&ac.length<=7) return ac; }
    var n=String(r.name||""); return n.length>16?n.slice(0,15).trim()+"…":n;
  }
  window.lvCampusShort=function(id){return shortName(window.lvCampusById(id));};
  var VMAP=null,VAT=0,VLOAD=null;
  function vmap(){
    if(VMAP&&Date.now()-VAT<180000) return Promise.resolve(VMAP);
    if(VLOAD) return VLOAD;
    VLOAD=Promise.all([window.lvCampuses(),sb.from("vendors").select("id,campus_id,student_verified,operating_scope,operating_campuses").is("deleted_at",null).limit(5000)]).then(function(a){
      var m=new Map(); ((a[1]&&a[1].data)||[]).forEach(function(x){m.set(String(x.id),x);}); VMAP=m; VAT=Date.now(); VLOAD=null; return m; }).catch(function(){VLOAD=null;return VMAP||new Map();});
    return VLOAD;
  }
  function chipFor(x,full){
    var r=x.campus_id?window.lvCampusById(x.campus_id):null; if(!r&&!x.student_verified) return null;
    var el=document.createElement("span"); el.className="lv-camp-line";
    var inner="";
    if(r){ var logo=r.logo?'<img src="/campus-logos/'+e2(r.id)+'.webp" alt="" loading="lazy">':'<span style="width:100%;height:100%;display:grid;place-items:center;background:hsl('+((function(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return h;})(r.id))+',55%,42%)">'+e2((r.abbr||r.name).slice(0,2).toUpperCase())+'</span>';
      inner+='<span class="lcl-i">'+logo+'</span><span class="lcl-t">'+e2(full?r.name:(r.abbr&&r.abbr.length<=8?r.abbr:r.name))+'</span>'; }
    if(x.student_verified) inner+='<span class="lcl-v" title="Verified student"><i class="fa-solid fa-user-graduate"></i></span>';
    el.innerHTML=inner; return el;
  }
  function vendorIdOf(card){
    if(card.dataset&&card.dataset.vendorId) return card.dataset.vendorId;
    var oc=card.getAttribute&&card.getAttribute("onclick")||""; var m=/vendorId:\s*'([^']+)'/.exec(oc)||/focusVendorOnMap\('([^']+)'/.exec(oc); return m?m[1]:"";
  }
  // replace "Lagos" / "Ibadan" on the card with the vendor's campus
  function swapLocation(card,x){
    if(!x.campus_id) return false; var r=window.lvCampusById(x.campus_id); if(!r) return false;
    var el=card.querySelector(".vendor-home-city,.vd-loc,.vc2-where,.vendor-directory-city"); if(!el) return false;
    var label=shortName(r), tn=null, w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    while(w.nextNode()){ if(w.currentNode.nodeValue.trim()){ tn=w.currentNode; break; } }
    if(!tn) return false;
    var rest=tn.nodeValue.indexOf(" · "); tn.nodeValue=(el.matches(".vc2-where")?"":" ")+label+(rest>0?tn.nodeValue.slice(rest):"");
    el.classList.add("lv-loc-campus"); el.title=r.name;
    var ic=el.querySelector("i"); if(ic) ic.className="fa-solid fa-graduation-cap";
    return true;
  }
  function curVid(){ try{ if(typeof currentViewParams!=="undefined"&&currentViewParams&&currentViewParams.vendorId) return currentViewParams.vendorId; }catch(_){} try{ if(window.currentViewParams&&window.currentViewParams.vendorId) return window.currentViewParams.vendorId; }catch(_){} var el=document.querySelector("[data-vendor-id]"); return el&&el.dataset.vendorId||""; }
  var SCOPE_SEL=".vd-card,.vc2,.vendor-card,.homepage-vendor-card,.sr-vendor-row,.product-card-wrap,.vendors-map-vendor-chip";
  function inScope(x,view){ return x.campus_id===view||x.operating_scope==="all"||(x.operating_scope==="multiple"&&Array.isArray(x.operating_campuses)&&x.operating_campuses.indexOf(view)>-1); }
  function applyScope(map){
    document.querySelectorAll(".lv-out-empty").forEach(function(n){n.classList.remove("lv-out-empty");});
    var view=window.lvViewCampus&&window.lvViewCampus()||"all";
    var skip=!!document.querySelector(".storefront-meta");
    var cards=document.querySelectorAll(SCOPE_SEL), parents=new Set();
    cards.forEach(function(card){
      var id=vendorIdOf(card)||(card.dataset&&card.dataset.vendorId)||""; var out=false;
      if(!skip&&view!=="all"&&id){
        var x=map.get(String(id)); var own=false; try{own=typeof isOwnVendorId==="function"&&isOwnVendorId(id);}catch(_){}
        out=!!x&&!own&&!inScope(x,view);
      }
      card.classList.toggle("lv-out",out); if(out&&card.parentElement) parents.add(card.parentElement);
      card.setAttribute("data-lvs","1");
    });
    parents.forEach(function(par){
      if(par.querySelector(SCOPE_SEL.split(",").map(function(q){return q+":not(.lv-out)";}).join(","))) return;
      var prev=par.previousElementSibling; if(prev&&prev.matches&&prev.matches("h3.section-title,.section-title")) prev.classList.add("lv-out-empty");
      var sec=par.closest("section")||par; 
      if(!sec.querySelector(SCOPE_SEL.split(",").map(function(q){return q+":not(.lv-out)";}).join(","))) sec.classList.add("lv-out-empty"); else par.classList.add("lv-out-empty");
    });
  }
  window.lvApplyCampusScope=function(){ vmap().then(applyScope); };
  window.lvVendorInScope=function(id){
    var view=window.lvViewCampus&&window.lvViewCampus()||"all"; if(view==="all"||!id||!VMAP) return true;
    var x=VMAP.get(String(id)); if(!x) return true;
    try{ if(typeof isOwnVendorId==="function"&&isOwnVendorId(id)) return true; }catch(_){}
    return inScope(x,view);
  };
  var busy=false,again=false;
  function revealAll(){
    document.querySelectorAll(SCOPE_SEL).forEach(function(c){ if(!c.hasAttribute("data-lvs")) c.setAttribute("data-lvs","1"); });
    document.querySelectorAll(".storefront-meta .sf-loc:not([data-lvc])").forEach(function(e){ e.setAttribute("data-lvc","1"); });
  }
  function runDecorate(map){
      document.querySelectorAll(".vd-card,.vc2,.vendor-card,.homepage-vendor-card,.sr-vendor-row").forEach(function(card){
        if(card.dataset.lvc) return; var id=vendorIdOf(card); if(!id) return; var x=map.get(String(id)); card.dataset.lvc="1"; if(!x) return;
        var swapped=swapLocation(card,x);
        var nm=card.querySelector(".vd-name,.vc2-name,.vendor-home-copy>strong,strong");
        if(x.student_verified&&nm&&!nm.querySelector(".lv-svi")){ var ic=document.createElement("i"); ic.className="fa-solid fa-user-graduate lv-svi"; ic.title="Verified student"; ic.setAttribute("aria-label","Verified student"); nm.appendChild(document.createTextNode(" ")); nm.appendChild(ic); }
        if(!swapped){ var c=chipFor({campus_id:x.campus_id,student_verified:false},false); if(c) card.appendChild(c); }
      });
      applyScope(map);
      var sfl=document.querySelector(".storefront-meta .sf-loc");
      if(sfl&&!sfl.dataset.lvc){ var sv=curVid(); var xs=map.get(String(sv)); sfl.dataset.lvc="1"; if(xs){ var rr=xs.campus_id&&window.lvCampusById(xs.campus_id); if(rr){ sfl.innerHTML=(rr.logo?'<img class="sf-camp-logo" src="/campus-logos/'+e2(rr.id)+'.webp" alt="">':'<i class="fa-solid fa-graduation-cap"></i>')+' '+e2(shortName(rr)); sfl.title=rr.name; } } }
      var row=document.querySelector(".storefront-name-row");
      if(row&&!row.dataset.lvc){ var sid=curVid(); var x2=map.get(String(sid)); row.dataset.lvc="1"; if(x2){ var c2=x2.student_verified?chipFor({campus_id:null,student_verified:true},false):null; if(c2){ c2.style.marginLeft=".5rem"; row.appendChild(c2); } } }
  }
  var failTimer=null;
  function armFailsafe(){ clearTimeout(failTimer); failTimer=setTimeout(revealAll,1500); }
  function decorate(){
    if(VMAP&&VMAP.size){
      try{ runDecorate(VMAP); }catch(_){ revealAll(); }
      if(Date.now()-VAT>180000) vmap().then(function(m){ if(m&&m.size) try{runDecorate(m);}catch(_){} });
      return;
    }
    if(busy){ again=true; return; } busy=true; armFailsafe();
    vmap().then(function(map){
      if(!map.size){ VMAP=null; revealAll(); return; }
      try{ runDecorate(map); }catch(_){ revealAll(); }
    }).catch(revealAll).finally(function(){busy=false; if(again){again=false; setTimeout(decorate,30);}});
  }
  window.lvRefreshVendorMap=function(){VMAP=null;VAT=0;decorate();};
  try{ new MutationObserver(function(recs){
    // runs before the browser paints, so new vendor/product cards are labelled and campus-filtered before anyone sees them
    var hit=false;
    for(var k=0;k<recs.length&&!hit;k++){ var an=recs[k].addedNodes; for(var m=0;m<an.length;m++){ var n=an[m]; if(n.nodeType===1&&((n.matches&&n.matches(SCOPE_SEL+",.storefront-meta,.sf-loc"))||(n.querySelector&&n.querySelector(SCOPE_SEL+",.storefront-meta")))){ hit=true; break; } } }
    if(hit){ decorate(); armFailsafe(); }
  }).observe(document.body,{childList:true,subtree:true}); }catch(_){}
  // load the vendor list early so the first cards are ready the moment they appear
  (function warm(n){ if(typeof sb!=="undefined"&&sb&&sb.from){ vmap().then(function(){ decorate(); }); } else if(n<20) setTimeout(function(){warm(n+1);},250); })(0);
  setTimeout(decorate,800);

  // ---------- vendor request campus scope
  window.setVendorRequestCampus=async function(scope){
    var v=V(); if(!v) return;
    var r=await sb.from("vendors").update({request_campus_scope:scope}).eq("id",v.id);
    if(r.error){ toast(r.error.message||"Couldn't save that.","error"); return; }
    v.request_campus_scope=scope;
    if(scope==="selected"&&(!v.operating_campuses||!v.operating_campuses.length)){ toast("Choose the campuses you operate in from your business profile.","info"); }
    toast(scope==="mine"?"Requests from your campus only.":scope==="selected"?"Requests from your selected campuses.":"Requests from all campuses.","success");
    try{ await navigate("vendorRequests",{},false); }catch(_){}
  };
})();

/* ---- lv-setup-js ---- */
(function(){
  "use strict";
  function e3(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function toast(m,t){try{showToast(m,t||"info");}catch(_){}}
  function V(){try{return(typeof vendor!=="undefined"&&vendor&&vendor.id)?vendor:null;}catch(_){return null;}}

  // ---------- compulsory vendor setup: campus -> where you sell -> student verification
  window.lvVendorSetup=async function(){
    var v=V(); if(!v||document.getElementById("lvSetup")) return;
    await window.lvCampuses();
    var svRow=null; try{ var r=await sb.from("vendor_student_verification").select("status").eq("vendor_id",v.id).maybeSingle(); svRow=r&&r.data; }catch(_){}
    // existing campus chosen earlier by the owner: carry it onto the store
    if(!v.campus_id&&profile&&profile.campus_id&&profile.campus_id!=="none"){ try{ await sb.from("vendors").update({campus_id:profile.campus_id}).eq("id",v.id); v.campus_id=profile.campus_id; }catch(_){} }
    var needCampus=!v.campus_id||v.campus_id==="none", needScope=!v.campus_setup_done, needSv=!svRow||svRow.status==="rejected";
    if(!needCampus&&!needScope&&!needSv) return;
    var step=needCampus?1:(needScope?2:3);
    var w=document.createElement("div"); w.id="lvSetup"; document.body.appendChild(w); document.documentElement.style.overflow="hidden";
    var ops={scope:v.operating_scope||"one",list:(v.operating_campuses||[]).slice()};
    function cleanup(){ w.remove(); document.documentElement.style.overflow=""; }
    function dots(){ return '<div class="st-dots">'+[1,2,3].map(function(i){return '<i class="'+(i<=step?'on':'')+'"></i>';}).join("")+'</div>'; }
    function chipsOf(){ if(ops.scope!=="multiple") return ""; var ids=ops.list.slice(); if(v.campus_id&&ids.indexOf(v.campus_id)<0) ids.unshift(v.campus_id);
      return '<div class="lvv-chips">'+ids.map(function(id){var r=window.lvCampusById(id);return '<span>'+e3(r?window.lvCampusShort(id):id)+'</span>';}).join("")+'</div>'; }
    function hero(msg){ return '<div class="st-hero"><div class="m">'+(window.lvMascotSvg||"")+'</div><div class="b">'+msg+'</div></div>'; }
    function perks(list){ return '<ul class="st-perks">'+list.map(function(x){return '<li><span><i class="fa-solid '+x[0]+'"></i></span><div><b>'+x[1]+'</b><small>'+x[2]+'</small></div></li>';}).join("")+'</ul>'; }
    function render(){
      var head='<div class="st-top">'+dots()+'<div class="st-step">Step '+step+' of 3</div>';
      var body="",foot="";
      if(step===1){
        head+='<h2>Which campus is your business on?</h2><p class="st-sub">This is your major campus. It shows on your store, vendor cards and featured listings.</p></div>';
        body=hero("Hi! Pick your school and students nearby will find you first.")+'<div class="lv-campus-field"><button type="button" class="lv-campus-btn" data-a="major">'+window.lvCampusBtnHtml(v.campus_id&&v.campus_id!=="none"?v.campus_id:"","Choose your campus")+'</button></div>'
          +perks([["fa-location-dot","Be seen first on your campus","Students browsing your campus see your store before anyone else."],["fa-graduation-cap","Campus badge on your store","Your school shows on your store, vendor cards and featured listings."],["fa-users","Reach the right buyers","Customers trust sellers from their own school."]]);
        foot='<button type="button" class="btn" data-a="next1">Continue</button>';
      } else if(step===2){
        head+='<h2>Where do you sell?</h2><p class="st-sub">Customers on these campuses will see your products.</p></div>';
        body=hero("Sell on one campus or many. You can change this any time.")+[["one","Only my campus","Just "+e3(window.lvCampusShort(v.campus_id)||"your campus")],["multiple","Selected campuses","Tick every campus you sell on"],["all","All campuses","Everyone on LevroMart can buy from you"]].map(function(o){return '<button type="button" class="st-opt '+(ops.scope===o[0]?'on':'')+'" data-s="'+o[0]+'"><b>'+o[1]+'</b><small>'+o[2]+'</small></button>';}).join("")
          +(ops.scope==="multiple"?'<button type="button" class="lv-campus-btn" data-a="many" style="margin-top:.4rem"><span class="ico"><i class="fa-solid fa-list-check"></i></span><span class="t">'+(ops.list.length?ops.list.length+" selected":"Choose campuses")+'<small>Tap to search and tick</small></span><i class="fa-solid fa-chevron-down" style="color:var(--text-muted);font-size:.8rem"></i></button>'+chipsOf():'');
        foot='<button type="button" class="btn btn-outline" data-a="back2" style="flex:0 0 5rem">Back</button><button type="button" class="btn" data-a="next2">Continue</button>';
      } else {
        head+='<h2>Verify you\'re a student</h2><p class="st-sub">Add your student details and upload your ID card and biodata page. Only LevroMart admins see them.</p></div>';
        body=hero("Verified students earn more trust and more orders.")+perks([["fa-shield-heart","Get a Verified student badge","Shown on your store and vendor cards once approved."],["fa-lock","Your documents stay private","Only LevroMart admins can see your ID and biodata."],["fa-bolt","Reviewed quickly","Our team checks submissions as they come in."]])+'<div id="stSv"></div>'; foot=(needCampus||needScope?'<button type="button" class="btn btn-outline" data-a="back3" style="flex:0 0 5rem">Back</button>':'')+'<button type="button" class="st-out" data-a="logout">Log out</button>';
      }
      w.innerHTML=head+'<div class="st-body">'+body+'</div><div class="st-foot">'+foot+'</div>';
      if(step===3){ var host=w.querySelector("#stSv"); var anchor=document.createElement("div"); host.appendChild(anchor); window.lvMountSV(anchor,function(){ finish(); }); }
    }
    async function finish(){
      try{ await sb.from("vendors").update({campus_setup_done:true}).eq("id",v.id); v.campus_setup_done=true; }catch(_){}
      cleanup(); toast("You're all set. Customers can now see your campus.","success"); try{window.lvRefreshVendorMap&&window.lvRefreshVendorMap();}catch(_){}
    }
    w.addEventListener("click",async function(e){
      var b=e.target.closest("[data-a],[data-s]"); if(!b) return; var a=b.dataset.a;
      if(b.dataset.s){ ops.scope=b.dataset.s; render(); if(ops.scope==="multiple"&&!ops.list.length) b=null,pickMany(); return; }
      if(a==="major"){ window.lvOpenCampusPicker({title:"Your major campus",current:v.campus_id,onPick:async function(r){ if(r.none||r.all) return; try{ await window.lvSaveCampus(r.id); v.campus_id=r.id; render(); }catch(_){ toast("Couldn't save your campus.","error"); } }}); }
      else if(a==="next1"){ if(!v.campus_id||v.campus_id==="none"){ toast("Choose your campus to continue.","error"); return; } step=needScope?2:3; render(); }
      else if(a==="many"){ pickMany(); }
      else if(a==="back2"){ if(needCampus){ step=1; render(); } }
      else if(a==="next2"){
        if(ops.scope==="multiple"&&!ops.list.length){ toast("Tick at least one campus.","error"); return; }
        if(ops.scope==="multiple"&&v.campus_id&&ops.list.indexOf(v.campus_id)<0) ops.list.push(v.campus_id);
        var up=await sb.from("vendors").update({operating_scope:ops.scope,operating_campuses:ops.list}).eq("id",v.id); if(up.error){ toast("Couldn't save. Try again.","error"); return; }
        v.operating_scope=ops.scope; v.operating_campuses=ops.list;
        if(needSv){ step=3; render(); } else finish();
      }
      else if(a==="back3"){ step=needScope?2:1; render(); }
      else if(a==="logout"){ try{ await sb.auth.signOut(); }catch(_){} cleanup(); location.reload(); }
    });
    function pickMany(){ window.lvOpenCampusPicker({title:"Campuses you sell on",multi:true,selected:ops.list,onDone:function(ids){ ops.list=ids; render(); }}); }
    render();
  };

  // ---------- admin: Campuses
  var ADM=null;
  function shortOf(id){ return window.lvCampusShort(id)||id; }
  function logoOf(r){ return r&&r.logo?'<img src="/campus-logos/'+e3(r.id)+'.webp" alt="" loading="lazy">':(r?e3(shortOf(r.id).slice(0,2).toUpperCase()):'<i class="fa-solid fa-circle-question"></i>'); }
  function svTag(v){ var s=v.svs; if(v.student_verified||s==="approved") return '<span class="ac-tag ok"><i class="fa-solid fa-user-graduate"></i> Verified student</span>'; if(s==="pending") return '<span class="ac-tag pend">Review pending</span>'; if(s==="rejected") return '<span class="ac-tag none">Rejected</span>'; return '<span class="ac-tag none">Not submitted</span>'; }
  function scopeTxt(v){ return v.operating_scope==="all"?"Sells on all campuses":v.operating_scope==="multiple"?(function(n){return "Sells on "+n+" campus"+(n===1?"":"es");})(((v.operating_campuses||[]).length)||1):"Sells on this campus only"; }
  function vendorRow(v){
    var init=e3(String(v.business_name||"?").slice(0,2).toUpperCase());
    return '<button type="button" class="ac-row" data-v="'+e3(v.id)+'"><span class="ac-ico">'+(v.logo_url?'<img src="'+e3(v.logo_url)+'" alt="" loading="lazy">':init)+'</span><span class="ac-t"><b>'+e3(v.business_name)+'</b><small>'+scopeTxt(v)+(v.is_active?"":" · Paused")+'</small><span style="display:block;margin-top:.25rem">'+svTag(v)+(v.verification_status!=="verified"?'<span class="ac-tag mut">'+e3(v.verification_status)+'</span>':'')+'</span></span><i class="fa-solid fa-chevron-right ac-chev"></i></button>';
  }
  function paintList(host){
    var q=(host.querySelector("input")||{}).value||""; q=q.trim().toLowerCase();
    var by=ADM.by,list=host.querySelector("#acList"),mode=ADM.mode;
    var groups=Object.keys(by).filter(function(k){return k!=="__none";}).map(function(k){var r=window.lvCampusById(k)||{id:k,name:k.replace(/^custom:/,"")};return {id:k,r:r,vs:by[k]};});
    groups=groups.filter(function(g){ if(mode==="review") return g.vs.some(function(v){return v.svs==="pending";}); return !q||(g.r.name+" "+(g.r.abbr||"")+" "+(g.r.state||"")).toLowerCase().indexOf(q)>=0||g.vs.some(function(v){return String(v.business_name||"").toLowerCase().indexOf(q)>=0;}); });
    groups.sort(function(a,b){return b.vs.length-a.vs.length||String(a.r.name).localeCompare(b.r.name);});
    var none=by.__none||[];
    var html="";
    if(none.length&&!q&&mode!=="review") html+='<button type="button" class="ac-row" data-g="__none"><span class="ac-ico" style="color:#dc2626"><i class="fa-solid fa-triangle-exclamation"></i></span><span class="ac-t"><b>No campus chosen yet</b><small>Vendors still to complete setup</small></span><span class="ac-n" style="color:#dc2626">'+none.length+'</span><i class="fa-solid fa-chevron-right ac-chev"></i></button>';
    html+=groups.map(function(g){var pend=g.vs.filter(function(v){return v.svs==="pending";}).length,ver=g.vs.filter(function(v){return v.student_verified;}).length;
      return '<button type="button" class="ac-row" data-g="'+e3(g.id)+'"><span class="ac-ico">'+logoOf(g.r)+'</span><span class="ac-t"><b>'+e3(shortOf(g.id))+'</b><small>'+e3(g.r.name)+'</small><small>'+ver+' verified'+(pend?' · <span style="color:#d97706;font-weight:700">'+pend+' to review</span>':'')+'</small></span><span class="ac-n">'+g.vs.length+'</span><i class="fa-solid fa-chevron-right ac-chev"></i></button>';}).join("");
    list.innerHTML=html||'<p class="muted" style="padding:1rem 0">No campuses match.</p>';
  }
  function paintDetail(host,gid){
    var vs=gid==="__none"?(ADM.by.__none||[]):(ADM.by[gid]||[]);
    var r=gid==="__none"?null:(window.lvCampusById(gid)||{id:gid,name:gid.replace(/^custom:/,"")});
    var also=gid==="__none"?[]:ADM.all.filter(function(v){return v.campus_id!==gid&&(v.operating_scope==="all"||(v.operating_scope==="multiple"&&(v.operating_campuses||[]).indexOf(gid)>=0));});
    var list=host.querySelector("#acList"); host.querySelector("#acTop").style.display="none";
    list.innerHTML='<button type="button" class="ac-back" data-back="1"><i class="fa-solid fa-arrow-left"></i> All campuses</button>'
     +'<div class="ac-h"><span class="ac-ico" style="width:3.2rem;height:3.2rem">'+(r?logoOf(r):'<i class="fa-solid fa-triangle-exclamation" style="color:#dc2626"></i>')+'</span><div><h3>'+(r?e3(r.name):'No campus chosen yet')+'</h3><span class="muted" style="font-size:.8rem">'+vs.length+' vendor'+(vs.length===1?'':'s')+(r&&r.state?' · '+e3(r.state):'')+'</span></div></div>'
     +(vs.length?vs.map(vendorRow).join(""):'<p class="muted">No vendors yet.</p>')
     +(also.length?'<div class="ac-sec">Also sells here ('+also.length+')</div>'+also.map(vendorRow).join(""):"");
  }
  function loadSubs(host){
    var box=host.querySelector("#acSubs"); if(!box) return;
    sb.rpc("admin_campus_submissions").then(function(r){
      var rows=(r&&r.data)||[]; if(!rows.length){ box.innerHTML=""; return; }
      box.innerHTML='<div class="ac-sec" style="margin-top:0">New schools to confirm ('+rows.length+')</div>'+rows.map(function(x){
        return '<div class="ac-sub"><div class="ac-sub-h"><span class="ac-ico"><i class="fa-solid fa-graduation-cap"></i></span><div><b>'+e3(x.name)+'</b><small>'+(Number(x.users_count)||0)+' student'+(Number(x.users_count)===1?'':'s')+' · '+(Number(x.vendors_count)||0)+' vendor'+(Number(x.vendors_count)===1?'':'s')+'</small></div></div>'
          +'<div class="ac-sub-a"><button type="button" class="ok" data-sub="approve" data-n="'+e3(x.name_norm)+'">Approve</button><button type="button" data-sub="merge" data-n="'+e3(x.name_norm)+'">Same as…</button><button type="button" class="no" data-sub="reject" data-n="'+e3(x.name_norm)+'">Reject</button></div></div>';}).join("");
      box.dataset.rows=JSON.stringify(rows);
    }).catch(function(){});
  }
  function subAction(host,act,norm){
    var done=function(msg){ try{showToast(msg,"success");}catch(_){} loadSubs(host); };
    var fail=function(e){ try{showToast((e&&e.message)||"Couldn't save that.","error");}catch(_){} };
    if(act==="approve"){ sb.rpc("admin_review_campus_school",{p_norm:norm,p_action:"approve"}).then(function(r){ if(r.error) return fail(r.error); done("School approved."); }); }
    else if(act==="reject"){ if(!confirm("Reject this school? Everyone who picked it will be set to 'Not on a campus'.")) return; sb.rpc("admin_review_campus_school",{p_norm:norm,p_action:"reject"}).then(function(r){ if(r.error) return fail(r.error); done("School rejected."); }); }
    else if(act==="merge"){ window.lvCampuses().then(function(){ window.lvOpenCampusPicker({title:"Which school is it?",current:"",onPick:function(t){ sb.rpc("admin_review_campus_school",{p_norm:norm,p_action:"merge",p_target:t.id}).then(function(r){ if(r.error) return fail(r.error); done("Merged into "+t.name+"."); }); }}); }); }
  }
  window.renderAdminCampuses=async function(){
    var html='<h2><i class="fa-solid fa-graduation-cap"></i> Campuses</h2><p class="muted">Vendors grouped by their major campus.</p>'+adminNavHtml("adminCampuses")+'<div id="acHost"><p class="muted" style="margin:1rem 0"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</p></div>';
    setTimeout(async function(){
      var host=document.getElementById("acHost"); if(!host) return;
      try{
        await window.lvCampuses();
        var res=await Promise.all([sb.from("vendors").select("id,business_name,logo_url,campus_id,operating_scope,operating_campuses,verification_status,is_active,student_verified,campus_setup_done").is("deleted_at",null).limit(5000),sb.from("vendor_student_verification").select("vendor_id,status")]);
        if(res[0].error) throw res[0].error;
        var svm=new Map(((res[1].data)||[]).map(function(x){return [x.vendor_id,x.status];}));
        var all=(res[0].data||[]).map(function(v){v.svs=svm.get(v.id)||null;return v;});
        var by={}; all.forEach(function(v){ var k=v.campus_id&&v.campus_id!=="none"?v.campus_id:"__none"; (by[k]=by[k]||[]).push(v); });
        ADM={all:all,by:by,mode:"all"};
        var total=all.length,set=all.length-(by.__none||[]).length,ver=all.filter(function(v){return v.student_verified;}).length,pend=all.filter(function(v){return v.svs==="pending";}).length;
        host.innerHTML='<div id="acSubs"></div><div id="acTop"><div class="ac-stats"><div class="ac-stat"><b>'+total+'</b><span>Vendors</span></div><div class="ac-stat ok"><b>'+set+'</b><span>With a campus</span></div><div class="ac-stat '+((by.__none||[]).length?'bad':'')+'"><b>'+(by.__none||[]).length+'</b><span>No campus yet</span></div><div class="ac-stat ok"><b>'+ver+'</b><span>Verified students</span></div><div class="ac-stat '+(pend?'warn':'')+'"><b>'+pend+'</b><span>Verifications to review</span></div><div class="ac-stat"><b>'+Object.keys(by).filter(function(k){return k!=="__none";}).length+'</b><span>Campuses with vendors</span></div></div>'
          +'<div class="ac-tools"><input type="search" placeholder="Search a campus or vendor…"><button type="button" class="ac-chip on" data-m="all">All</button><button type="button" class="ac-chip" data-m="review">To review</button></div></div><div id="acList"></div>';
        paintList(host); loadSubs(host);
        host.addEventListener("input",function(e){ if(e.target.matches("input")) paintList(host); });
        host.addEventListener("click",function(e){
          var sa=e.target.closest("[data-sub]"); if(sa){ subAction(host,sa.dataset.sub,sa.dataset.n); return; }
          var m=e.target.closest("[data-m]"); if(m){ ADM.mode=m.dataset.m; host.querySelectorAll("[data-m]").forEach(function(c){c.classList.toggle("on",c===m);}); paintList(host); return; }
          var g=e.target.closest("[data-g]"); if(g){ paintDetail(host,g.dataset.g); window.scrollTo({top:0}); return; }
          if(e.target.closest("[data-back]")){ host.querySelector("#acTop").style.display=""; paintList(host); return; }
          var v=e.target.closest("[data-v]"); if(v){
            var vv=(ADM.all||[]).filter(function(x){return String(x.id)===String(v.dataset.v);})[0];
            if(vv&&vv.svs&&window.lvAdminSvReview){ window.lvAdminSvReview(vv.id,vv.business_name,function(){ try{navigate("adminCampuses",{},false);}catch(_){} }); }
            else { try{navigate("storefront",{vendorId:v.dataset.v});}catch(_){} }
          }
        });
      }catch(err){ host.innerHTML='<div class="empty-state">Couldn\'t load campuses. '+e3(err&&err.message||"")+'</div>'; }
    },0);
    return html;
  };
})();


/* ---- instant tab feedback: the tapped tab lights up at once, before the page finishes loading ---- */
(function(){
  document.addEventListener("click",function(e){
    var t=e.target&&e.target.closest&&e.target.closest(".order-status-pill,.vendor-orders-perspective-tabs button,.vendor-request-tab");
    if(!t||t.classList.contains("active")) return;
    var sib=t.parentNode&&t.parentNode.children; if(!sib) return;
    for(var i=0;i<sib.length;i++){ if(sib[i].classList&&(sib[i].tagName==="BUTTON"||sib[i].getAttribute("role")==="tab")) sib[i].classList.toggle("active",sib[i]===t); }
    var wrap=document.getElementById("orderListWrap"); if(wrap&&t.closest(".order-status-pills-rail,.vendor-orders-perspective-tabs")){ wrap.style.transition="opacity .12s"; wrap.style.opacity=".4"; }
  },true);
})();
