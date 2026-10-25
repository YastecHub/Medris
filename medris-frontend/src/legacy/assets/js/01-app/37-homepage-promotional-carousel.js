// ---------- HOMEPAGE PROMOTIONAL CAROUSEL ----------
// The database table/storage bucket already exist in the Levromart project.
// These bundled images are the initial launch set. Once an admin publishes them
// to the carousel table, the homepage becomes fully database-driven.
const INITIAL_HOME_CAROUSEL_SLIDES = [
  { id: "bundled-support-local", image_url: `https://pub-bc905d4e70404264a256cb3069953205.r2.dev/homepage-carousel/slides/f1b015da-408c-450d-93fb-0d9517b49e3e.png`, alt_text: "Support Local Businesses", sort_order: 10, is_active: true, storage_path: "slides/f1b015da-408c-450d-93fb-0d9517b49e3e.png", bundled: true },
  { id: "bundled-trusted-services", image_url: `https://pub-bc905d4e70404264a256cb3069953205.r2.dev/homepage-carousel/slides/c4eede28-ee51-4bee-bc47-5df821d6ad36.png`, alt_text: "Find Trusted Services", sort_order: 20, is_active: true, storage_path: "slides/c4eede28-ee51-4bee-bc47-5df821d6ad36.png", bundled: true },
  { id: "bundled-quality-products", image_url: `https://pub-bc905d4e70404264a256cb3069953205.r2.dev/homepage-carousel/slides/e2717c23-4210-4d9a-b11d-85ce7b61df5a.png`, alt_text: "Shop Quality Products", sort_order: 30, is_active: true, storage_path: "slides/e2717c23-4210-4d9a-b11d-85ce7b61df5a.png", bundled: true },
  { id: "bundled-nearby-vendors", image_url: `https://pub-bc905d4e70404264a256cb3069953205.r2.dev/homepage-carousel/slides/ff8c621b-ec6c-4ee4-90fe-b6065cfd5619.png`, alt_text: "Explore Nearby Vendors", sort_order: 40, is_active: true, storage_path: "slides/ff8c621b-ec6c-4ee4-90fe-b6065cfd5619.png", bundled: true },
  { id: "bundled-everything", image_url: `https://pub-bc905d4e70404264a256cb3069953205.r2.dev/homepage-carousel/slides/3ca26253-9bce-4c2a-8768-30d51fa97ee5.png`, alt_text: "Everything You Need in One Place", sort_order: 50, is_active: true, storage_path: "slides/3ca26253-9bce-4c2a-8768-30d51fa97ee5.png", bundled: true },
  { id: "bundled-better-choices", image_url: `https://pub-bc905d4e70404264a256cb3069953205.r2.dev/homepage-carousel/slides/b6fe961f-ee94-4fd4-8a84-493fac1ddc06.png`, alt_text: "Better Choices for a Brighter Tomorrow", sort_order: 60, is_active: true, storage_path: "slides/b6fe961f-ee94-4fd4-8a84-493fac1ddc06.png", bundled: true },
];
let homeCarouselSlides = [];
let homeCarouselIndex = 0;

// Small session-scoped TTL cache for rarely-changing public data (carousel slides,
// categories). Returns cached rows for `ttlMs`; `levroCacheClear(prefix)` drops them
// (called after admin edits).
function levroCacheGet(key, ttlMs) {
  try {
    const raw = sessionStorage.getItem("levro-cache:" + key); if (!raw) return null;
    const o = JSON.parse(raw); if (!o || Date.now() - o.at > ttlMs) return null; return o.v;
  } catch (_) { return null; }
}
function levroCacheSet(key, value) { try { sessionStorage.setItem("levro-cache:" + key, JSON.stringify({ at: Date.now(), v: value })); } catch (_) {} }
function levroCacheClear(prefix = "") {
  try { Object.keys(sessionStorage).filter((k) => k.startsWith("levro-cache:" + prefix)).forEach((k) => sessionStorage.removeItem(k)); } catch (_) {}
}
async function loadHomepageCarouselSlides({ includeInactive = false } = {}) {
  try {
    if (!includeInactive) { const hit = levroCacheGet("carousel", 10 * 60 * 1000); if (hit) return hit; }
    let q = sb.from("homepage_carousel_slides").select("id,storage_path,image_url,link_url,alt_text,sort_order,is_active,created_by,created_at,updated_at").order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    if (!includeInactive) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) throw error;
    // An empty table is treated as the bundled launch set. This means the app
    // is immediately populated before the admins publish the initial slides.
    const rows = (data && data.length) ? data : INITIAL_HOME_CAROUSEL_SLIDES.slice();
    if (!includeInactive && data && data.length) levroCacheSet("carousel", rows);
    return rows;
  } catch (e) {
    console.warn("[Levromart] Carousel load failed; using bundled slides.", e);
    return INITIAL_HOME_CAROUSEL_SLIDES.slice();
  }
}

function handleHomeCarouselImageError(img, failedIndex) {
  if (!img) return;
  img.dataset.failed = "1";
  const fallback = homeCarouselSlides.find((slide, idx) => idx !== failedIndex && slide?.image_url && slide.image_url !== img.src && !slide.__failed);
  if (fallback) {
    img.onerror = null;
    img.src = fallback.image_url;
    return;
  }
  img.onerror = null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420"><rect width="1200" height="420" fill="#0f172a"/><circle cx="920" cy="120" r="180" fill="#3fb97f" fill-opacity=".22"/><circle cx="980" cy="180" r="110" fill="#3fb97f" fill-opacity=".18"/><text x="80" y="215" font-family="Arial, sans-serif" font-size="48" font-weight="700" fill="#ffffff">Levromart</text><text x="80" y="270" font-family="Arial, sans-serif" font-size="28" fill="#4FBE94">Explore the marketplace</text></svg>`;
  img.src = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  img.closest(".home-promotional-slide")?.classList.add("image-failed");
}
function renderHomepageCarouselHtml(slides) {
  const usable = (slides || []).filter(s => s?.image_url).slice(0, 12);
  if (!usable.length) return "";
  if (usable.length !== homeCarouselSlides.length) window.__levroCarouselDom = null;
  homeCarouselSlides = usable;
  const slideHtml = (s, i, clone) => `<button type="button" class="home-promotional-slide" data-carousel-index="${i}" ${clone ? 'data-clone="1" tabindex="-1" aria-hidden="true"' : ""} data-link-url="${esc(s.link_url || "")}" onclick="handleHomeCarouselSlideClick(event,${i})" aria-label="${esc(s.alt_text || `Promotion ${i + 1}`)}"><img src="${esc(s.image_url)}" alt="${clone ? "" : esc(s.alt_text || "Levromart promotion")}" ${i === 0 && !clone ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async" draggable="false" onerror="handleHomeCarouselImageError(this,${i})"></button>`;
  // With more than one banner the row is a seamless loop: a copy of the last
  // banner sits before the first and a copy of the first after the last, so
  // there is always a banner peeking in on BOTH sides of the one in focus.
  const loop = usable.length > 1;
  const slidesHtml = (loop ? slideHtml(usable[usable.length - 1], usable.length - 1, true) : "")
    + usable.map((s, i) => slideHtml(s, i, false)).join("")
    + (loop ? slideHtml(usable[0], 0, true) : "");
  const dots = usable.map((s, i) => `<button type="button" class="home-promotional-dot ${i === 0 ? "active" : ""}" onclick="activateHomeCarouselSlide(${i})" aria-label="Go to slide ${i + 1}"></button>`).join("");
  return `<section class="home-promotional-carousel" id="homePromotionalCarousel" aria-label="Levromart promotions">
    <div class="home-promotional-viewport" id="homePromotionalViewport" data-loop="${loop ? 1 : 0}">
      <div class="home-promotional-track" id="homePromotionalTrack">${slidesHtml}</div>
    </div>
    ${loop ? `<div class="home-promotional-dots" id="homePromotionalDots">${dots}</div>` : ""}
  </section>`;
}

// Carousel banners are managed through a plain "Link URL" text box with no
// documentation of the app's internal ?levro=view&section=x query-param
// syntax -- realistically nobody types that, they type a plain destination
// like "Vendors", "Shop Now" or "https://levromart.com/vendors". Those never
// matched the strict same-path+query-param check below, so they fell through
// to window.open() on every single click, which reads as (and on a PWA can
// genuinely trigger) a full page reload instead of an in-app navigation.
// Recognise the obvious intent first, before ever treating the link as a
// generic external URL.
const HOME_CAROUSEL_KEYWORD_ROUTES = [
  [/\bvendor/, () => navigate("vendors", {}, true)],
  [/\bproduct|\bshop\b|\bbuy\b/, () => navigate("home", {}, true).then(() => setTimeout(() => { try { switchHomeListingTab("products"); } catch (_) {} byId("browseSection")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80))],
  [/\bservice/, () => navigate("home", {}, true).then(() => setTimeout(() => { try { switchHomeListingTab("services"); } catch (_) {} byId("browseSection")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80))],
  [/\bpackage/, () => navigate("home", {}, true).then(() => setTimeout(() => { try { switchHomeListingTab("packages"); } catch (_) {} byId("browseSection")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80))],
  [/\border/, () => { if (!session) { showLogin(); return; } navigate(profile?.role === "admin" ? "adminFinance" : (vendor ? "vendorOrders" : "buyerOrders"), vendor ? { status: "all", perspective: "sales" } : {}, true); }],
  [/\bcart|\bbasket/, () => navigate("cart", {}, true)],
  [/\bmessage|\bchat/, () => { if (!session) { showLogin(); return; } navigate("messages", {}, true); }],
  [/\bsetting/, () => { if (!session) { showLogin(); return; } navigate("settings", {}, true); }],
  [/\bwishlist|\bfavou?rite/, () => { if (!session) { showLogin(); return; } navigate("wishlist", {}, true); }],
  [/\brequest/, () => navigate("requestEquipment", {}, true)],
  [/\bsupport|\bhelp\b/, () => { if (!session) { showLogin(); return; } navigate("supportRequest", {}, true); }],
  [/\bhome\b|\bbrowse everything/, () => navigate("home", {}, true)],
];
function resolveHomeCarouselKeywordRoute(raw) {
  const keyword = String(raw || "").toLowerCase().replace(/^https?:\/\/[^/]+/, "").replace(/[^a-z]+/g, " ").trim();
  if (!keyword) return null;
  return HOME_CAROUSEL_KEYWORD_ROUTES.find(([re]) => re.test(keyword))?.[1] || null;
}
function handleHomeCarouselSlideClick(event, index) {
  if (homeCarouselJustDragged) { event.preventDefault(); return; }
  const slide = event.currentTarget;
  // Tapping a banner that's only peeking in from the side brings it to the
  // middle first; tapping the banner in focus follows its link.
  const viewport = byId("homePromotionalViewport");
  if (viewport && viewport.dataset.loop === "1") {
    const step = homeCarouselStep(viewport);
    const dom = Array.from(slide.parentElement.children).indexOf(slide);
    if (step && Math.abs(viewport.scrollLeft - dom * step) > step * 0.35) {
      event.preventDefault();
      viewport.scrollTo({ left: dom * step, behavior: "smooth" });
      return;
    }
  }
  const url = slide?.dataset?.linkUrl || "";
  if (!url) return;
  const keywordAction = resolveHomeCarouselKeywordRoute(url);
  if (keywordAction) { event.preventDefault(); keywordAction(); return; }
  try {
    const target = new URL(url, location.href);
    const sameApp = target.origin === location.origin && target.pathname === location.pathname;
    if (sameApp && (target.searchParams.has("levro") || target.searchParams.has("storefront") || target.searchParams.has("package") || target.searchParams.has("section"))) {
      event.preventDefault();
      // Keep carousel navigation inside the SPA. Do not assign/reload the
      // document just because a banner points at another in-app destination.
      if (target.searchParams.has("storefront")) {
        navigate("storefront", { vendorId: target.searchParams.get("storefront") });
        return;
      }
      if (target.searchParams.has("package")) {
        navigate("packageDetail", { packageId: target.searchParams.get("package") });
        return;
      }
      const deepView = target.searchParams.get("levro") || "home";
      const section = target.searchParams.get("section") || "";
      if (deepView === "notifications" || deepView === "profile") {
        if (!session) { showLogin(); return; }
        if (deepView === "notifications") { lastNotificationReturnView = "home"; navigate("notifications", {}, true); }
        else navigate("home", {}, true).then(() => setTimeout(() => openProfileOrShop(), 60));
        return;
      }
      if (deepView === "orders") {
        if (!session) { showLogin(); return; }
        navigate(profile?.role === "admin" ? "adminFinance" : (vendor ? "vendorOrders" : "buyerOrders"), vendor ? {status:"all",perspective:"sales"} : {}, true);
        return;
      }
      if (deepView === "home") {
        navigate("home", {}, true).then(() => setTimeout(() => {
          if (section === "services" || section === "packages" || section === "products") { try { switchHomeListingTab(section); } catch (_) {} }
          const anchor = section === "browse" || section === "services" || section === "packages" || section === "products" ? byId("browseSection") : null;
          if (anchor) anchor.scrollIntoView({behavior:"smooth", block:"start"});
        }, 80));
        return;
      }
      if (["cart","messages","vendorDashboard","vendorProducts","vendorPackages","vendorOrders","vendorEditProfile","vendorWallet","vendorRequests","settings","supportRequest","vendors","leaderboard","vendorApply","wishlist","adminPanel","adminCarousel","adminLinkLibrary","adminInventory","adminPeople","adminFinance","adminDisputes","adminSupportRequests","adminPasswordResets","adminFeedback","adminUsers","adminLog","adminMonthlyListings","vendorSuggestionsInbox","notifications","customerFollowing"].includes(deepView)) {
        const authViews = ["cart","messages","vendorDashboard","vendorProducts","vendorPackages","vendorOrders","vendorEditProfile","vendorWallet","vendorRequests","settings","supportRequest","wishlist","adminPanel","adminCarousel","adminLinkLibrary","adminInventory","adminPeople","adminFinance","adminDisputes","adminSupportRequests","adminPasswordResets","adminFeedback","adminUsers","adminLog","adminMonthlyListings","vendorSuggestionsInbox","notifications"];
        if (!session && authViews.includes(deepView)) { showLogin(); return; }
        navigate(deepView, {}, true);
        return;
      }
    }
    window.open(target.href, "_blank", "noopener,noreferrer");
  } catch (_) {}
}
// The promotional banners are a native scroll-snap row (the browser does the
// touch, momentum and snapping). They advance by themselves every few seconds
// and stop the moment a finger or mouse is on them, while the tab is hidden or
// while the row is scrolled off-screen. Banner N is centred, with its
// neighbours peeking in at both edges; the row loops seamlessly.
const HOME_CAROUSEL_INTERVAL_MS = 5000;
let homeCarouselJustDragged = false;
let homeCarouselTimer = null;
function homeCarouselStep(viewport) {
  const first = viewport.querySelector(".home-promotional-slide");
  const second = first?.nextElementSibling;
  if (!first) return 0;
  return second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
}
function homeCarouselGoTo(viewport, domIndex, smooth = true) {
  const step = homeCarouselStep(viewport);
  if (step) viewport.scrollTo({ left: domIndex * step, behavior: smooth ? "smooth" : "instant" });
}
function activateHomeCarouselSlide(index) {
  const viewport = byId("homePromotionalViewport");
  if (!viewport) return;
  const loop = viewport.dataset.loop === "1";
  homeCarouselGoTo(viewport, (Number(index) || 0) + (loop ? 1 : 0));
  homeCarouselPause(4000);
}
let homeCarouselResumeAt = 0;
function homeCarouselPause(ms) { homeCarouselResumeAt = Date.now() + ms; }
function initHomepageCarousel() {
  if (homeCarouselTimer) { clearInterval(homeCarouselTimer); homeCarouselTimer = null; }
  const viewport = byId("homePromotionalViewport");
  if (viewport && viewport.dataset.carouselBound === "1") { window.lvResumeCarousel?.(); return; }   // kept alive from before: just restart autoplay
  if (!viewport) return;
  viewport.dataset.carouselBound = "1";
  const loop = viewport.dataset.loop === "1";
  const count = viewport.querySelectorAll(".home-promotional-slide:not([data-clone])").length;
  const dots = Array.from(document.querySelectorAll("#homePromotionalDots .home-promotional-dot"));
  let ticking = false, current = 0, settleTimer = null, visible = true;
  { const sv = Number(window.__levroCarouselDom); if (loop && Number.isFinite(sv) && sv >= 1 && sv <= count) { current = sv - 1; dots.forEach((d, i) => d.classList.toggle("active", i === current)); } }

  const place = (domIndex) => {                       // instant jump, snap off for a frame
    viewport.style.scrollSnapType = "none";
    homeCarouselGoTo(viewport, domIndex, false);
    requestAnimationFrame(() => { viewport.style.scrollSnapType = ""; });
  };
  // Re-rendering Home (coming back from another page) must not make the row jump:
  // put it straight back on the banner that was showing, in the same frame.
  const saved = Number(window.__levroCarouselDom);
  const startDom = loop ? (Number.isFinite(saved) && saved >= 1 && saved <= count ? saved : 1) : 0;
  const dotFor = (domIndex) => loop ? (domIndex - 1 + count) % count : domIndex;
  const syncDots = () => {
    ticking = false;
    const step = homeCarouselStep(viewport);
    if (!step) return;
    window.__levroCarouselDom = Math.round(viewport.scrollLeft / step);
    const idx = dotFor(Math.round(viewport.scrollLeft / step));
    if (idx === current) return;
    current = idx;
    dots.forEach((d, i) => d.classList.toggle("active", i === idx));
  };
  // Once scrolling settles on a copy, jump to the identical real banner.
  const settle = () => {
    const step = homeCarouselStep(viewport);
    if (!step || !loop) return;
    const idx = Math.round(viewport.scrollLeft / step);
    if (idx === 0) place(count);
    else if (idx === count + 1) place(1);
  };
  viewport.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(syncDots); }
    clearTimeout(settleTimer); settleTimer = setTimeout(settle, 110);
  }, { passive: true });

  if (loop) { if (homeCarouselStep(viewport)) place(startDom); else requestAnimationFrame(() => place(startDom)); }

  // Anything the user does with the row holds autoplay off for a few seconds.
  const hold = () => homeCarouselPause(6000);
  viewport.addEventListener("touchstart", hold, { passive: true });
  viewport.addEventListener("touchmove", hold, { passive: true });
  viewport.addEventListener("wheel", hold, { passive: true });

  // Mouse users can't swipe: let them drag the row, without breaking clicks.
  let down = false, sx = 0, sl = 0, moved = false;
  viewport.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") return;
    down = true; moved = false; sx = e.clientX; sl = viewport.scrollLeft; hold();
    try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - sx;
    if (!moved && Math.abs(dx) < 6) return;
    if (!moved) { moved = true; viewport.classList.add("dragging"); }
    viewport.scrollLeft = sl - dx;
  }, { passive: true });
  const stop = () => {
    if (!down) return;
    down = false;
    viewport.classList.remove("dragging");
    if (moved) {
      homeCarouselJustDragged = true;
      setTimeout(() => { homeCarouselJustDragged = false; }, 120);
      const step = homeCarouselStep(viewport);
      if (step) viewport.scrollTo({ left: Math.round(viewport.scrollLeft / step) * step, behavior: "smooth" });
    }
    hold();
  };
  viewport.addEventListener("pointerup", stop, { passive: true });
  viewport.addEventListener("pointercancel", stop, { passive: true });

  if (!loop || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting !== false; }, { threshold: 0.35 }).observe(viewport);
  }
  homeCarouselPause(HOME_CAROUSEL_INTERVAL_MS);
  homeCarouselTimer = setInterval(() => {
    if (!viewport.isConnected) { clearInterval(homeCarouselTimer); homeCarouselTimer = null; return; }
    if (document.hidden || !visible || Date.now() < homeCarouselResumeAt) return;
    const step = homeCarouselStep(viewport);
    if (!step) return;
    const idx = Math.round(viewport.scrollLeft / step);
    homeCarouselGoTo(viewport, idx + 1);
  }, HOME_CAROUSEL_INTERVAL_MS);
}

