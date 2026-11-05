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

/* Levi on the splash: when the splash clears he flies (a curved swoop with a sparkle trail) down to his floating button
   and says hello once per visit. Skipped when "reduce motion" is on, or when his button is not on the page. */
(function(){
  var done = false;
  function reduced(){ try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; } }
  function visible(el){ if (!el) return false; var r = el.getBoundingClientRect(); var cs = getComputedStyle(el); return r.width > 8 && r.height > 8 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05; }
  function welcome(fab){
    try { if (sessionStorage.getItem("lv-levi-hi")) return; sessionStorage.setItem("lv-levi-hi", "1"); } catch (_) {}
    var r = fab.getBoundingClientRect(), right = r.left + r.width / 2 > window.innerWidth / 2;
    var b = document.createElement("div"); b.className = "lvs-hi" + (right ? " r" : " l"); b.setAttribute("role", "status");
    b.innerHTML = '<button type="button" class="lvs-hi-x" aria-label="Close">×</button><b>Hi, I’m Levi 👋</b><span>Welcome to Levromart! Ask me anything: products, shops near you, prices or your orders.</span><em>Tap me to chat</em>';
    var top = Math.max(12, r.top - 12);
    b.style.bottom = (window.innerHeight - top) + "px";
    if (right) b.style.right = Math.max(12, window.innerWidth - r.right) + "px"; else b.style.left = Math.max(12, r.left) + "px";
    document.body.appendChild(b);
    requestAnimationFrame(function(){ b.classList.add("on"); });
    var gone = false, close = function(){ if (gone) return; gone = true; b.classList.remove("on"); setTimeout(function(){ b.remove(); }, 300); };
    b.addEventListener("click", function(e){ if (e.target.closest(".lvs-hi-x")) return close(); close(); try { fab.click(); } catch (_) {} });
    setTimeout(close, 7000);
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
