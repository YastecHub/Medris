(function(){
  // Keep the branded splash brief, but never diagnose a missing app bundle
  // as a slow internet connection. A failed script or initialisation problem
  // is an application-loading issue, not proof that the user's network is slow.
  function hide(){
    var el=document.getElementById("levromartSplash");
    if(!el)return;
    el.classList.add("is-hidden");
    el.setAttribute("aria-hidden","true");
  }
  // Reveal the page after a short, fixed window. App initialisation can
  // continue underneath and take over when it is ready.
  setTimeout(function(){
    try{ window.__levroSplashHidden=true; }catch(_){}
    hide();
  },4500);
})();