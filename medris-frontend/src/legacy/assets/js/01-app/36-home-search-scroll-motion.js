// ---------- HOME SEARCH SCROLL MOTION ----------
let homeSearchMotionReady = false;
let homeSearchMotionRaf = 0;
let homeSearchMotionIdle = 0;
let homeSearchMotionLastY = 0;
function initHomeSearchScrollMotion(){
  resetHomeSearchScrollMotion();
  if (getLevromartMotionPreference()==="calm") return;
  const wrap = document.querySelector("#app .levro-home-search-wrap");
  const search = wrap?.querySelector(".hero-search");
  if (!wrap || !search) return;

  const header = document.querySelector("body > header");
  const appEl = document.getElementById("app");
  const syncDockTop = () => {
    const rect = header?.getBoundingClientRect();
    const top = Math.ceil((rect?.bottom ?? 64) + 6);
    document.documentElement.style.setProperty("--levro-search-dock-top", `${top}px`);
    // Switching the search bar from position:relative (centered by margin:auto
    // inside #app's own padded content box) to position:fixed (centered
    // against the viewport via left:50%) used two different reference boxes.
    // Whenever #app's content width differed even slightly from the viewport
    // width, the bar visibly snapped sideways the instant it docked -- the
    // "dip"/horizontal jump. Measuring #app's actual box and feeding it in as
    // the fixed bar's left/width keeps it pinned to the exact same spot.
    if (appEl) {
      const appRect = appEl.getBoundingClientRect();
      const cs = getComputedStyle(appEl);
      const padLeft = parseFloat(cs.paddingLeft) || 0;
      const padRight = parseFloat(cs.paddingRight) || 0;
      document.documentElement.style.setProperty("--levro-search-dock-left", `${appRect.left + padLeft}px`);
      document.documentElement.style.setProperty("--levro-search-dock-width", `${Math.max(0, appRect.width - padLeft - padRight)}px`);
    }
  };
  syncDockTop();

  let idleTimer = 0;
  let rafId = 0;
  let lastY = window.scrollY || 0;

  const restoreNormal = () => {
    wrap.classList.remove("home-search-fixed", "home-search-scrolling");
    document.body.classList.remove("home-search-active");
  };

  const onScroll = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const y = window.scrollY || window.pageYOffset || 0;
      lastY = y;
      // header is position:fixed, so its rect is constant across scroll -
      // only resync on resize/orientation change, not on every scroll frame.
      if (y <= 8) {
        restoreNormal();
        return;
      }
      wrap.classList.add("home-search-fixed", "home-search-scrolling");
      document.body.classList.add("home-search-active");
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!search.matches(":focus-within")) wrap.classList.remove("home-search-scrolling");
      }, 180);
    });
  };

  const onFocus = () => {
    clearTimeout(idleTimer);
    wrap.classList.add("home-search-fixed");
    wrap.classList.remove("home-search-scrolling");
    document.body.classList.add("home-search-active");
    syncDockTop();
  };

  const onResize = () => syncDockTop();

  window.addEventListener("scroll", onScroll, {passive:true});
  window.addEventListener("resize", onResize, {passive:true});
  search.addEventListener("focus", onFocus, true);
  search.addEventListener("blur", () => {
    lastY = window.scrollY || window.pageYOffset || 0;
    if (lastY <= 8) restoreNormal();
  }, true);

  wrap._homeSearchScrollCleanup = () => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    search.removeEventListener("focus", onFocus, true);
    clearTimeout(idleTimer);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    restoreNormal();
  };
}
function resetHomeSearchScrollMotion(){
  homeSearchMotionReady = false;
  if (homeSearchMotionRaf) cancelAnimationFrame(homeSearchMotionRaf);
  homeSearchMotionRaf = 0;
  clearTimeout(homeSearchMotionIdle);
  homeSearchMotionIdle = 0;
  document.querySelectorAll(".levro-home-search-wrap").forEach(el=>el._homeSearchScrollCleanup?.());
  document.body.classList.remove("home-search-active");
  document.querySelectorAll(".home-search-scrolling,.home-search-pinned,.home-search-fixed").forEach(el=>el.classList.remove("home-search-scrolling","home-search-pinned","home-search-fixed"));
}


