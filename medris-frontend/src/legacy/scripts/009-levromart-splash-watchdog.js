
(function(){
  // This watchdog intentionally lives before the large application bundle.
  // If a later script has a parse/runtime error, a network dependency stalls,
  // or a future patch breaks init(), the black splash must still disappear.
  var started=Date.now();
  function hide(){
    var el=document.getElementById("levromartSplash");
    if(!el)return;
    el.classList.add("is-hidden");
    el.setAttribute("aria-hidden","true");
  }
  // Do not hide the branded surface merely because window.load fired. The
  // app may still be preparing its first route; exposing the raw header at
  // that point produces the ugly green logo rectangles/empty controls.
  // init() hides this surface in its finally block once routing is ready.
  // Hard limit: the splash is never on screen for more than about 4.5 seconds, whatever the app is still waiting for (the sign-in check,
  // the network, a slow phone). The app is drawn underneath and fills in as its data arrives.
  // The one exception: while our own style files have not all arrived (slow connection), keep the splash up to 10 s, because the page
  // without its styles is the half-built screen nobody should see.
  function styled(){
    try{
      if(document.readyState==="loading") return false;
      var l=document.querySelectorAll('link[rel="stylesheet"][href*="/assets/css/"]');
      for(var i=0;i<l.length;i++) if(!l[i].sheet && navigator.onLine!==false) return false;
      return true;
    }catch(_){ return true; }
  }
  setTimeout(function tick(){ if(!styled() && Date.now()-started<10000){ setTimeout(tick,200); return; } try{ window.__levroSplashHidden=true; }catch(_){} hide(); },4500);

})();
