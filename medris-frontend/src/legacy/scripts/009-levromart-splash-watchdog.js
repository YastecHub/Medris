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
  function fly(splash){
    if (done) return; done = true;
    var src = splash.querySelector(".lv-sp-levi svg.lvs"), fab = document.getElementById("aiChatFab");
    if (!src || reduced() || !visible(fab)) { if (visible(fab)) setTimeout(function(){ welcome(fab); }, 400); return; }
    var target = fab.querySelector(".lv-fab-badge") || fab;
    var a = src.getBoundingClientRect(), t = target.getBoundingClientRect();
    if (!a.width || !t.width) return;
    var w = document.createElement("div"); w.className = "lvs-fly";
    w.style.left = a.left + "px"; w.style.top = a.top + "px"; w.style.width = a.width + "px"; w.style.height = a.height + "px";
    w.innerHTML = src.outerHTML.replace(/\blvs([gr])\b/g, "lvf$1"); document.body.appendChild(w);   // own gradient ids, so the colours survive the splash going away
    var prevOp = fab.style.opacity; fab.style.opacity = "0";
    var dx = (t.left + t.width / 2) - (a.left + a.width / 2), dy = (t.top + t.height / 2) - (a.top + a.height / 2), s = Math.max(.2, Math.min(1, t.width / a.width));
    var side = dx >= 0 ? -1 : 1;
    var anim = w.animate([
      { transform: "translate(0,0) scale(1) rotate(0deg)" },
      { transform: "translate(" + (dx * .1 + side * 40) + "px," + (-40) + "px) scale(1.06) rotate(" + (side * 8) + "deg)", offset: .18 },
      { transform: "translate(" + (dx * .55 + side * 30) + "px," + (dy * .45) + "px) scale(" + ((1 + s) / 2) + ") rotate(" + (-side * 14) + "deg)", offset: .6 },
      { transform: "translate(" + dx + "px," + dy + "px) scale(" + (s * 1.12) + ") rotate(0deg)", offset: .9 },
      { transform: "translate(" + dx + "px," + dy + "px) scale(" + s + ") rotate(0deg)" }
    ], { duration: 1100, easing: "cubic-bezier(.45,.05,.25,1)", fill: "forwards" });
    var kinds = ["", "p", "g"], n = 0, trail = setInterval(function(){
      var r = w.getBoundingClientRect(); if (!r.width) return;
      var d = document.createElement("i"); d.className = "lvs-trail " + kinds[n++ % 3];
      d.style.left = (r.left + r.width * (.3 + Math.random() * .4)) + "px"; d.style.top = (r.top + r.height * (.55 + Math.random() * .35)) + "px";
      document.body.appendChild(d); setTimeout(function(){ d.remove(); }, 750);
    }, 70);
    anim.onfinish = function(){
      clearInterval(trail); w.remove(); fab.style.opacity = prevOp;
      try { fab.animate([{ transform: "scale(1.18)" }, { transform: "scale(.94)" }, { transform: "scale(1)" }], { duration: 420, easing: "ease-out" }); } catch (_) {}
      setTimeout(function(){ welcome(fab); }, 250);
    };
  }
  var splash = document.getElementById("levromartSplash");
  if (!splash || !window.MutationObserver) return;
  if (splash.classList.contains("is-hidden")) return;
  var mo = new MutationObserver(function(){
    if (!splash.classList.contains("is-hidden")) return;
    mo.disconnect();
    // the page is being shown now: give his button a moment to settle into its place
    setTimeout(function(){ requestAnimationFrame(function(){ fly(splash); }); }, 120);
  });
  mo.observe(splash, { attributes: true, attributeFilter: ["class"] });
})();
