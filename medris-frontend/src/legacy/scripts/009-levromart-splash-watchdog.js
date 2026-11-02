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
    // any page that has drawn something counts, not only Home
    return !!(app && (app.querySelector("#lv-startup-recovery") || (app.children.length && (app.textContent.trim().length || app.querySelector("img,svg,canvas,iframe")))));
  }
  function release() {
    try { window.__levroSplashHidden = true; } catch (_) {}
    hide();
  }
  function mark(splash, stage) {
    try {
      var lis = splash.querySelectorAll(".lv-slow-steps li");
      for (var i = 0; i < lis.length; i++) {
        var k = lis[i].getAttribute("data-s");
        var on = k === "net" || (k === "css" && stage >= 1) || (k === "ui" && stage >= 2);
        lis[i].className = on ? "on" : "";
      }
    } catch (_) {}
  }
  (function tick() {
    var waited = Date.now() - started, splash = document.getElementById("levromartSplash");
    var isStyled = styled(), isUsable = usable();
    // on a weak network the splash stays up (never the half-built, unstyled page) and shows what is happening
    if (splash && waited > 4500 && !(isStyled && isUsable)) { splash.classList.add("is-slow"); mark(splash, isStyled ? (isUsable ? 2 : 1) : 0); if (waited > 25000) splash.classList.add("is-stuck"); }
    if (!isStyled && waited < 90000) { setTimeout(tick, 200); return; }
    if (isUsable) { release(); return; }
    // the app's own startup check (30-navigation.js) redraws the page once and shows the message only if it stays empty
    if (waited >= 60000) { release(); return; }
    setTimeout(tick, 250);
  })();
})();
