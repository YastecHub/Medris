(function(){
  var started = Date.now();
  function hide() {
    var splash = document.getElementById("levromartSplash");
    if (!splash) return;
    splash.classList.add("is-hidden");
    splash.setAttribute("aria-hidden", "true");
  }
  function styled() {
    try {
      if (document.readyState === "loading") return false;
      var links = document.querySelectorAll('link[rel="stylesheet"][href*="/assets/css/"]');
      for (var i = 0; i < links.length; i++) if (!links[i].sheet && navigator.onLine !== false) return false;
      return true;
    } catch (_) { return true; }
  }
  function usable() {
    var app = document.getElementById("app");
    return !!(app && app.querySelector(".levro-home-startup, .levro-home-hero, .home-promotional-carousel, #browseSection, #lv-startup-recovery"));
  }
  function fallback() {
    var app = document.getElementById("app");
    if (!app || usable()) return;
    app.innerHTML = '<section id="lv-startup-recovery" role="alert" style="min-height:45vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem 1.25rem;gap:.75rem"><strong>LevroMart could not finish starting</strong><span>Please check your connection and try again.</span><button type="button" class="btn" onclick="location.reload()">Retry</button></section>';
  }
  function release() {
    try { window.__levroSplashHidden = true; } catch (_) {}
    hide();
  }
  (function tick() {
    var waited = Date.now() - started;
    if (!styled() && waited < 10000) { setTimeout(tick, 200); return; }
    if (usable()) { release(); return; }
    if (waited >= 9000) { fallback(); release(); return; }
    setTimeout(tick, 250);
  })();
})();