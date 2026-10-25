// ---------- PERSISTENT ROUTE + SCROLL STATE ----------
// A browser/PWA reload destroys the in-memory SPA. Persist the exact route and
// viewport in localStorage so a hard reload does not restart the application
// at Home. sessionStorage remains as a same-tab fallback for older sessions.
(function initPersistentAppState(){
  const ROUTE_KEY = "levromart_persisted_route_v4";
  const SCROLL_KEY = "levromart_persisted_scroll_v4";
  const LEGACY_ROUTE_KEY = "levromart_persisted_route_v3";
  const LEGACY_SCROLL_KEY = "levromart_persisted_scroll_v3";
  let saveRaf = 0;
  let lastRoute = null;

  function readStore(store,key){try{return JSON.parse(store.getItem(key)||"null")}catch(_){return null}}
  function safeRead(key){
    try { const v=readStore(localStorage,key); if(v)return v; } catch(_) {}
    try { const v=readStore(sessionStorage,key); if(v)return v; } catch(_) {}
    return null;
  }
  function safeWrite(key,value){
    try { localStorage.setItem(key,JSON.stringify(value)); } catch(_) {}
    try { sessionStorage.setItem(key,JSON.stringify(value)); } catch(_) {}
  }

  window.__levromartPersistedRoute=function(view,params){
    lastRoute={view:String(view||"home"),params:params&&typeof params==="object"?params:{}};
    // Saved a moment later: reading the scroll position forces the browser to lay the whole page out, which
    // made every tap (search bar, tabs) wait before the next screen could appear.
    clearTimeout(window.__lvRouteSaveT);
    const snap=lastRoute;
    window.__lvRouteSaveT=setTimeout(()=>{
      safeWrite(ROUTE_KEY,snap);
      // Keep the older key in sync so an already-open tab can still resume if it
      // was created by the previous precision-fix build.
      safeWrite(LEGACY_ROUTE_KEY,snap);
      safeWrite(SCROLL_KEY,{x:Number(window.scrollX||0),y:Number(window.scrollY||0),view:snap.view});
    },350);
  };

  function saveScroll(){
    saveRaf=0;
    if(!lastRoute)return;
    safeWrite(ROUTE_KEY,lastRoute);
    safeWrite(LEGACY_ROUTE_KEY,lastRoute);
    const state={x:Number(window.scrollX||0),y:Number(window.scrollY||0),view:lastRoute.view};
    safeWrite(SCROLL_KEY,state);
    safeWrite(LEGACY_SCROLL_KEY,state);
  }

  window.addEventListener("scroll",()=>{
    if(saveRaf)return;
    saveRaf=requestAnimationFrame(saveScroll);
  },{passive:true});
  window.addEventListener("pagehide",saveScroll,{passive:true});
  window.addEventListener("pagehide",()=>{ try { if (typeof commitPendingNotificationReads === "function") void commitPendingNotificationReads(); } catch (_) {} },{passive:true});
  window.addEventListener("beforeunload",saveScroll,{passive:true});

  let initialScrollRestored=false;
  window.__levromartRestoreScroll=function(view){
    if(initialScrollRestored)return false;
    initialScrollRestored=true;
    const saved=safeRead(SCROLL_KEY)||safeRead(LEGACY_SCROLL_KEY);
    if(!saved||String(saved.view||"")!==String(view||""))return false;
    const x=Number.isFinite(Number(saved.x))?Number(saved.x):0;
    const y=Number.isFinite(Number(saved.y))?Number(saved.y):0;
    const restore=()=>window.scrollTo({left:x,top:y,behavior:"auto"});
    requestAnimationFrame(restore);

    return true;
  };

  window.__levromartReadPersistedRoute=function(){
    return safeRead(ROUTE_KEY)||safeRead(LEGACY_ROUTE_KEY)||safeRead("medris_last_view");
  };

  // Used by logout/account reset so a protected page can never be resurrected
  // for the next signed-out session.
  window.__levromartClearPersistedRoute=function(){
    [ROUTE_KEY,SCROLL_KEY,LEGACY_ROUTE_KEY,LEGACY_SCROLL_KEY,"medris_last_view"].forEach(k=>{
      try{localStorage.removeItem(k)}catch(_){}
      try{sessionStorage.removeItem(k)}catch(_){}
    });
    lastRoute=null;
  };
})();

