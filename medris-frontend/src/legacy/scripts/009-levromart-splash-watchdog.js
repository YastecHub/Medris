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
    try { var fp = document.getElementById("lv-first-paint"); if (fp) fp.remove(); } catch (_) {}
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

/* Levi on the splash: when the splash clears he flies (a curved swoop with a sparkle trail) down to his floating button
   and says hello once per visit. Skipped when "reduce motion" is on, or when his button is not on the page. */
(function(){
  var done = false;
  function reduced(){ try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; } }
  function visible(el){ if (!el) return false; var r = el.getBoundingClientRect(); var cs = getComputedStyle(el); return r.width > 8 && r.height > 8 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05; }
  function welcome(fab){
    try { if (sessionStorage.getItem("lv-levi-hi")) return; sessionStorage.setItem("lv-levi-hi", "1"); } catch (_) {}
    // once a day at most, and never on top of a pop-up (the pop-up wins)
    try { var seenAt = Number(localStorage.getItem("lv-levi-hi-at") || 0); if (seenAt && Date.now() - seenAt < 20 * 3600 * 1000) return; localStorage.setItem("lv-levi-hi-at", String(Date.now())); } catch (_) {}
    if (document.getElementById("lvPromo")) return;
    var b = document.createElement("div"); b.className = "lvs-hi"; b.setAttribute("role", "status");
    b.innerHTML = '<b>Hi, I’m Levi 👋</b><span>Ask me about products, shops near you or your orders.</span><em>Tap to chat</em>';
    b.style.visibility = "hidden";
    document.body.appendChild(b);
    var gone = false, raf = 0;
    // The bubble hangs on Levi's button and follows it (he can be dragged or slide in), so it is never somewhere else.
    function place(){
      var r = fab.getBoundingClientRect(), vw = window.innerWidth, bw = b.offsetWidth, bh = b.offsetHeight, gap = 12;
      var cx = r.left + r.width / 2, onRight = cx > vw / 2;
      var left = Math.min(Math.max(12, onRight ? cx - bw + 34 : cx - 34), Math.max(12, vw - bw - 12));
      var above = r.top - gap - bh >= 12;
      b.classList.toggle("below", !above);
      b.style.setProperty("--tail", Math.min(Math.max(22, cx - left), Math.max(22, bw - 22)) + "px");
      b.style.left = left + "px"; b.style.top = (above ? r.top - gap - bh : r.bottom + gap) + "px";
    }
    var away = function(e){ if (e && e.target && b.contains(e.target)) return; close(); };
    var EVENTS = ["pointerdown", "touchstart", "mousedown", "keydown", "wheel"];
    function close(){
      if (gone) return; gone = true; cancelAnimationFrame(raf);
      EVENTS.forEach(function(t){ document.removeEventListener(t, away, true); });
      b.classList.remove("on"); setTimeout(function(){ b.remove(); }, 220);
    }
    function frame(){
      if (gone) return;
      if (!visible(fab) || document.getElementById("lvPromo")) return close();
      place(); raf = requestAnimationFrame(frame);
    }
    place(); b.style.visibility = ""; requestAnimationFrame(function(){ b.classList.add("on"); });
    raf = requestAnimationFrame(frame);
    // a tap (or scroll or key) anywhere takes it away at once, without waiting; tapping the bubble itself opens Levi
    EVENTS.forEach(function(t){ document.addEventListener(t, away, { capture: true, passive: true }); });
    b.addEventListener("click", function(){ close(); try { fab.click(); } catch (_) {} });
    setTimeout(close, 4500);   // and it goes by itself after a moment
  }
  // As the splash fades, Levi warps out where he stands: a little lift, then he spins away into a point with a burst of
  // sparkles (the same warp as the map and search buttons). His floating button simply stays where it always is.
  function fly(splash){
    if (done) return; done = true;
    var src = splash.querySelector(".lv-sp-levi svg.lvs"), fab = document.getElementById("aiChatFab");
    var hello = function(){ if (visible(fab)) setTimeout(function(){ welcome(fab); }, 350); };
    if (!src || reduced()) { hello(); return; }
    var a = src.getBoundingClientRect(); if (!a.width) { hello(); return; }
    var w = document.createElement("div"); w.className = "lvs-fly";
    w.style.left = a.left + "px"; w.style.top = a.top + "px"; w.style.width = a.width + "px"; w.style.height = a.height + "px";
    w.innerHTML = src.outerHTML.replace(/\blvs([gr])\b/g, "lvf$1");   // own gradient ids, so the colours survive the splash going away
    document.body.appendChild(w); src.style.visibility = "hidden";
    var anim = w.animate([
      { transform: "scale(1) rotate(0deg)", opacity: 1 },
      { transform: "scale(1.14) rotate(-14deg)", opacity: 1, offset: .28 },
      { transform: "scale(.08) rotate(210deg)", opacity: 0 }
    ], { duration: 460, easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" });
    var cx = a.left + a.width / 2, cy = a.top + a.height / 2, kinds = ["", "p", "g"];
    setTimeout(function(){
      for (var k = 0; k < 10; k++) {
        var d = document.createElement("i"), ang = (k / 10) * Math.PI * 2, dist = a.width * (.55 + Math.random() * .35);
        d.className = "lvs-trail " + kinds[k % 3]; d.style.left = cx + "px"; d.style.top = cy + "px";
        document.body.appendChild(d);
        try { d.animate([{ transform: "translate(0,0) scale(1.4)", opacity: 1 }, { transform: "translate(" + Math.cos(ang) * dist + "px," + Math.sin(ang) * dist + "px) scale(.2)", opacity: 0 }], { duration: 520, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }); } catch (_) {}
        (function(el){ setTimeout(function(){ el.remove(); }, 560); })(d);
      }
    }, 300);
    anim.onfinish = function(){ w.remove(); hello(); };
  }
  var splash = document.getElementById("levromartSplash");
  if (!splash || !window.MutationObserver) return;
  if (splash.classList.contains("is-hidden")) return;
  var mo = new MutationObserver(function(){
    if (!splash.classList.contains("is-hidden")) return;
    mo.disconnect();
    fly(splash);
  });
  mo.observe(splash, { attributes: true, attributeFilter: ["class"] });
})();
