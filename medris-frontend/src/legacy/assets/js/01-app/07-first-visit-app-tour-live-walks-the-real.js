// ---------- FIRST-VISIT APP TOUR (live - walks the real pages, spotlights real elements) ----------
// Each step (except the intro/outro) names a real selector on a real page.
// The tour navigates there with the actual navigate() function and points
// at the actual DOM element - nothing here is a mockup or a slide.
// Messages and Notifications live in different places depending on account
// type (Messages: header icon for buyers/vendors, nothing for admins/guests;
// Notifications: header bell for admins only, a bottom-nav tab for
// buyers/vendors, nothing for guests) -- these two steps are placeholder
// strings, resolved to a real step (or dropped) per-role in showTour().
const HOME_TOUR_STEPS = [
  { icon: "fa-hand-sparkles", title: "Hi, I'm Levi", body: "I'll walk you through the app myself, live, on the actual site. Just follow me around.", selector: null, view: "home" },
  { icon: "fa-house", title: "This is Home", body: "Tap Home in the bottom bar any time, from anywhere in the app, and I'll bring you straight back here.", selector: `#bottomNav .bottom-nav-item[onclick*="navigate('home')"]`, view: "home" },
  { icon: "fa-magnifying-glass", title: "Search anything", body: "Tap here to search the whole marketplace, then narrow it with the All, Products, Vendors, Services and Packages tabs. Recent searches are remembered for you.", selector: ".header-search-row", view: "home" },
  { icon: "fa-shapes", title: "Browse by category", body: "These are the categories vendors are actually selling in right now. Tap one and everything below, trending items, vendors, services, packages and Browse everything, narrows to it. Tap it again to go back to normal.", selector: ".levro-home-cat-rail", view: "home" },
  { icon: "fa-images", title: "Offers and news", body: "Swipe the banners left or right, or just wait, they move along on their own and pause the moment you touch them.", selector: ".home-promotional-carousel", view: "home" },
  { icon: "fa-bolt", title: "Quick actions", body: "These six shortcuts take you straight to shopping, services, rentals, trusted vendors, item requests, and direct chat, without digging through the marketplace.", selector: ".levro-home-quick-actions", view: "home" },
  {
    icon: "fa-map-location-dot", title: "Find vendors near you", body: "Every verified vendor, plotted on a real map, closest first. Tap any pin, or any card up here, to open that vendor's storefront.",
    selector: "#vendorsMapWrap, .vendors-map-vendor-rail", view: "vendors",
    onEnter: async () => { try { await switchVendorsView("map"); } catch (_) {} },
  },
  { icon: "fa-compass", title: "Get around from here", body: "The bottom bar is always one tap away, wherever you are on the site.", selector: "#bottomNav", view: "home" },
  "ORDERS_TOUR_STEP",
  "MESSAGES_TOUR_STEP",
  {
    icon: "fa-user", title: "Your profile, one tap away", body: "Your account, your orders, your saved items and settings, all live in this panel, wherever you are in the app.",
    selector: "#profilePanel", view: "home",
    onEnter: () => { try { toggleProfilePanel(); } catch (_) {} },
    onExit: () => { try { closeAllPanels(); } catch (_) {} },
  },
  { icon: "fa-comments", title: "That's me, right there", body: "Tap this any time to talk to me. Ask what to buy, and I'll point you straight to a vendor, or explain how anything on here works. In my way? Long-press me to hide me, and triple-tap anywhere on the page to bring me back.", selector: "#aiChatFab", view: "home" },
  "NOTIFICATIONS_TOUR_STEP",
];
function buildMessagesTourStep() {
  if (!session || profile?.role === "admin") return null;
  return { icon: "fa-comment-dots", title: "Message a vendor directly", body: "Chat opens with a vendor once they accept your order, so you can sort out the details together. You can also call them in-app with the phone button, your number is never shared. The chat closes 24 hours after the order is completed; your messages are kept and return if you order from that vendor again.", selector: "#messagesWrap", view: "home" };
}
function buildOrdersTourStep() {
  if (!session || profile?.role === "admin") return null;
  return { icon: "fa-receipt", title: "Your orders", body: "Follow every order from here. Finished and cancelled orders sit under the history button, where you can search by product or shop and filter by Completed or Cancelled.", selector: `#bottomNav .bottom-nav-item[onclick*="Orders"]`, view: "home" };
}
function buildNotificationsTourStep() {
  if (!session) return null;
  if (profile?.role === "admin") {
    return { icon: "fa-bell", title: "Your notifications", body: "Tap the bell up here any time to see orders, disputes and platform activity as they happen.", selector: "#notifWrap", view: "home" };
  }
  return { icon: "fa-bell", title: "Stay in the loop", body: "Notifications live in your bottom bar, tap here any time to see orders, offers and updates.", selector: `#bottomNav .bottom-nav-item[onclick*="navigate('notifications')"]`, view: "home" };
}
function resolveTourSteps(steps) {
  return steps.map((s) => s === "ORDERS_TOUR_STEP" ? buildOrdersTourStep() : s === "MESSAGES_TOUR_STEP" ? buildMessagesTourStep() : s === "NOTIFICATIONS_TOUR_STEP" ? buildNotificationsTourStep() : s).filter(Boolean);
}
// Shown only to vendors, appended after the shared home steps: your full
// profile page carries the same at-a-glance stats (listings, reviews,
// rating, followers) that customers see on your public storefront.
const VENDOR_TOUR_STEP = { icon: "fa-store", title: "Your shop, at a glance", body: "Your full profile shows your listings, reviews, rating and followers, the same numbers customers see when they visit your storefront. When you owe commission, the amount and the days left show right here, and we remind you 5, 3, 2 and 1 days before the deadline so nothing gets paused.", selector: ".commission-card, .storefront-stats", view: "vendorDashboard" };
// Placeholder only -- showTour() rebuilds this with resolveTourSteps() once
// session/profile/vendor (declared with let further down this same script)
// are actually live; calling resolveTourSteps() here at parse time would hit
// their temporal dead zone.
let LIVE_TOUR_STEPS = HOME_TOUR_STEPS.filter((s) => typeof s !== "string");
let liveTourStep = 0;
let liveTourRunToken = 0;
let liveTourBusy = false;
function tourIsVisible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity || 1) > 0 && r.width > 0 && r.height > 0;
}

async function waitForTourTarget(selector, maxMs = 2500) {
  if (!selector) return null;
  const started = performance.now();
  while (performance.now() - started < maxMs) {
    // Vendor steps must resolve to the first *real, visible* card after the
    // vendors page has rendered. querySelector alone can catch an off-screen,
    // hidden or stale card and make the spotlight appear to point at nothing.
    const nodes = [...document.querySelectorAll(selector)];
    const el = nodes.find(tourIsVisible) || null;
    if (el) return el;
    await new Promise(requestAnimationFrame);
  }
  return null;
}

function clearTourTargetLock() {
  document.querySelectorAll(".tour-target-locked").forEach(el => {
    el.classList.remove("tour-target-locked");
    el.removeAttribute("data-tour-target");
  });
}

function lockTourTarget(el) {
  clearTourTargetLock();
  if (!el) return;
  el.classList.add("tour-target-locked");
  el.setAttribute("data-tour-target", "true");
}

let tourTransitionTimer = null;
function cancelTourTransition() {
  if (tourTransitionTimer) { clearTimeout(tourTransitionTimer); tourTransitionTimer = null; }
}

async function showTour() {
  cancelTourTransition();
  liveTourRunToken++;
  const token = liveTourRunToken;
  LIVE_TOUR_STEPS = vendor ? [...resolveTourSteps(HOME_TOUR_STEPS), VENDOR_TOUR_STEP] : resolveTourSteps(HOME_TOUR_STEPS);
  liveTourStep = 0;
  liveTourBusy = true;
  clearTourTargetLock();
  closeAllPanels();
  // Start from a clean state: bottom bar visible, no keyboard/search mode, page at the top.
  document.body.classList.remove("search-input-active", "levro-kbd-open");
  document.body.classList.add("tour-active");
  byId("bottomNav")?.classList.remove("nav-scroll-hide", "nav-scroll-shrink");
  const modal = byId("tourModal");
  modal?.classList.remove("hidden");
  trackModalOpened("tourModal");
  try {
    // Always start from a clean, freshly-rendered Home scrolled to the very
    // top -- starting from wherever the user happened to be (mid-scroll, or
    // a different page entirely) meant the first couple of steps had to
    // visibly jump the page around just to reach a known position before
    // the tour could even properly begin.
    window.scrollTo(0, 0);
    await navigate("home", {}, false);
    window.scrollTo(0, 0);
    if (token !== liveTourRunToken) return;
    await runTourStep(token);
  } finally {
    if (token === liveTourRunToken) liveTourBusy = false;
  }
}

async function runTourStep(token = liveTourRunToken) {
  if (token !== liveTourRunToken) return;
  const step = LIVE_TOUR_STEPS[liveTourStep];
  if (!step) return;

  clearTourTargetLock();

  if (step.view && step.view !== currentView) {
    await navigate(step.view, {});
    if (token !== liveTourRunToken) return;
    // Let the destination render and its deferred loaders populate before we
    // attempt to lock the spotlight onto anything.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  }

  const icon = byId("tourIcon");
  const title = byId("tourTitle");
  const body = byId("tourBody");
  const dots = byId("tourDots");
  const back = byId("tourBackBtn");
  const next = byId("tourNextBtn");
  const callout = byId("tourCallout");
  const hole = byId("tourSpotlightHole");
  if (!icon || !title || !body || !dots || !back || !next || !callout || !hole) return;

  try { await step.onEnter?.(); } catch (_) {}
  await new Promise(requestAnimationFrame);
  if (token !== liveTourRunToken) return;

  const tourModalEl = byId("tourModal");
  let coveredForScroll = false;
  let el = null;
  if (step.selector) {
    el = await waitForTourTarget(step.selector, 2500);
    if (token !== liveTourRunToken) return;
    if (el) {
      const cs = getComputedStyle(el);
      const isFixed = cs.position === "fixed" || cs.position === "sticky" || el === byId("bottomNav");
      if (!isFixed) {
        // Jumping the scroll position while the spotlight hole and callout
        // stayed visible at their old coordinates meant the page content
        // visibly shifted underneath them for a frame or two before the
        // hole caught up -- exactly what read as "scrolling" instead of a
        // clean step-to-step transition. Cover the whole page with a plain,
        // opaque surface for the duration of the jump so nothing moves in
        // view; the hole/callout only reappear once already correctly
        // positioned on the new spot.
        // Glide to the target: scroll smoothly while the spotlight follows the element
        // every frame, so nothing disappears and reappears between steps.
        tourModalEl?.classList.add("tour-tracking");
        const holeEl = byId("tourSpotlightHole");
        holeEl?.classList.remove("centered");
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        const t0 = performance.now();
        let last = null, still = 0;
        while (performance.now() - t0 < 1100) {
          await new Promise(requestAnimationFrame);
          if (token !== liveTourRunToken) return;
          const r = el.getBoundingClientRect();
          if (holeEl && r.width > 0) {
            const pad = 8;
            holeEl.style.top = `${Math.max(5, r.top - pad)}px`; holeEl.style.left = `${Math.max(5, r.left - pad)}px`;
            holeEl.style.width = `${Math.max(1, r.width + pad * 2)}px`; holeEl.style.height = `${Math.max(1, r.height + pad * 2)}px`;
          }
          if (last !== null && Math.abs(r.top - last) < 0.5) { if (++still > 5) break; } else still = 0;
          last = r.top;
        }
        tourModalEl?.classList.remove("tour-tracking");
      }
      lockTourTarget(el);
    }
  }

  if (token !== liveTourRunToken) return;

  // Smoothly replace only the contents of the guide. This avoids the old
  // transform/position race where the callout could briefly duplicate or land
  // in the centre while the target was changing views.
  callout.classList.remove("tour-enter");
  callout.classList.add("tour-switching");
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (token !== liveTourRunToken) return;

  icon.className = `fa-solid ${step.icon}`;
  title.textContent = step.title;
  body.textContent = step.body;
  dots.replaceChildren(...LIVE_TOUR_STEPS.map((_, i) => {
    const d = document.createElement("span");
    d.className = `tour-dot${i === liveTourStep ? " active" : ""}`;
    return d;
  }));
  back.classList.toggle("hidden", liveTourStep === 0);
  next.textContent = liveTourStep === LIVE_TOUR_STEPS.length - 1 ? "Get started" : "Next";

  const rect = el?.getBoundingClientRect?.() || null;
  positionTourSpotlight(rect, step.selector === "#bottomNav");
  void callout.offsetWidth;
  callout.classList.remove("tour-switching");
  callout.classList.add("tour-enter");
  if (coveredForScroll) {
    void tourModalEl?.offsetWidth;
    tourModalEl?.classList.remove("tour-covering");
  }
}

function positionTourSpotlight(rect, forceAbove = false) {
  const hole = byId("tourSpotlightHole");
  const callout = byId("tourCallout");
  if (!hole || !callout) return;
  const vh = window.innerHeight, vw = window.innerWidth;

  if (!rect || rect.width <= 0 || rect.height <= 0) {
    hole.classList.add("centered");
    callout.classList.add("centered");
    callout.style.top = "50%";
    callout.style.left = "50%";
    callout.style.transform = "translate(-50%, -50%)";
    return;
  }

  const pad = 8;
  const top = Math.max(5, rect.top - pad);
  const left = Math.max(5, rect.left - pad);
  const right = Math.min(vw - 5, rect.right + pad);
  const bottom = Math.min(vh - 5, rect.bottom + pad);

  hole.classList.remove("centered");
  hole.style.top = `${top}px`;
  hole.style.left = `${left}px`;
  hole.style.width = `${Math.max(1, right - left)}px`;
  hole.style.height = `${Math.max(1, bottom - top)}px`;

  callout.classList.remove("centered");
  callout.style.transform = "none";
  const width = Math.min(callout.offsetWidth || 286, vw - 24);
  const height = Math.min(callout.offsetHeight || 220, vh - 24);
  const gap = 16, edge = 12;
  const aboveSpace = top - edge;
  const belowSpace = vh - bottom - edge;
  let y;
  if (forceAbove || belowSpace < height + gap) {
    y = top - gap - height;
    if (y < edge && belowSpace >= height + gap) y = bottom + gap;
  } else {
    y = bottom + gap;
  }
  if (y < edge) y = Math.max(edge, Math.min(vh - height - edge, (vh - height) / 2));
  if (y > vh - height - edge) y = vh - height - edge;

  let x = left + ((right - left) / 2) - (width / 2);
  x = Math.max(edge, Math.min(x, vw - width - edge));
  callout.style.top = `${Math.round(y)}px`;
  callout.style.left = `${Math.round(x)}px`;
}

function tourReposition() {
  if (byId("tourModal")?.classList.contains("hidden")) return;
  const step = LIVE_TOUR_STEPS[liveTourStep];
  const el = step?.selector ? [...document.querySelectorAll(step.selector)].find(tourIsVisible) : null;
  if (el && step.selector) lockTourTarget(el);
  positionTourSpotlight(el?.getBoundingClientRect?.() || null, step?.selector === "#bottomNav");
}
window.addEventListener("resize", () => {
  cancelTourTransition();
  requestAnimationFrame(tourReposition);
});

// A step that switches views (map, vendor dashboard) does a real navigation
// and data fetch -- with no visible change until that resolves, tapping Next
// read as frozen for a second or more, not just slow. Showing a spinner the
// instant it's tapped doesn't make the wait shorter, but it stops it looking
// broken. runTourStep() already restores the correct label once the step
// actually lands, so this only needs to force the spinner on and guarantee
// the button is never left stuck disabled if something goes wrong.
async function tourNext() {
  if (liveTourBusy) return;
  const btn = byId("tourNextBtn");
  if (btn) { btn.disabled = true; }  // no spinner: the label stays put while the spotlight glides
  try {
    try { await LIVE_TOUR_STEPS[liveTourStep]?.onExit?.(); } catch (_) {}
    if (liveTourStep >= LIVE_TOUR_STEPS.length - 1) { finishTour(); return; }
    liveTourBusy = true;
    const token = ++liveTourRunToken;
    liveTourStep += 1;
    await runTourStep(token);
    if (token === liveTourRunToken) liveTourBusy = false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function tourBack() {
  if (liveTourBusy || liveTourStep <= 0) return;
  const btn = byId("tourNextBtn");
  if (btn) { btn.disabled = true; }
  const back = byId("tourBackBtn");
  if (back) back.style.opacity = "0.5";
  try {
    try { await LIVE_TOUR_STEPS[liveTourStep]?.onExit?.(); } catch (_) {}
    liveTourBusy = true;
    const token = ++liveTourRunToken;
    liveTourStep -= 1;
    await runTourStep(token);
    if (token === liveTourRunToken) liveTourBusy = false;
  } finally {
    if (btn) btn.disabled = false;
    if (back) back.style.opacity = "";
  }
}

function finishTour() {
  document.body.classList.remove("tour-active");
  try { LIVE_TOUR_STEPS[liveTourStep]?.onExit?.(); } catch (_) {}
  cancelTourTransition();
  clearTourTargetLock();
  liveTourRunToken++;
  liveTourBusy = false;
  byId("tourModal")?.classList.add("hidden");
  localStorage.setItem("levromart-tour-seen", "1");
  if (dismissibleModalId === "tourModal") dismissibleModalId = null;
  if (session) {
    const panel = byId("aiChatPanel");
    if (panel && panel.classList.contains("hidden")) {
      panel.classList.remove("hidden");
      playSound("open");
      if (aiChatMessages.length === 0) showAiChatGreeting();
    }
  }
}
function skipTour() { finishTour(); }
function maybeShowTour() {
  if (localStorage.getItem("levromart-tour-seen")) return;
  if (dismissibleModalId) return; // another popup (install/notif) is already up, or the tour already is
  showTour();
}

let session = null;   // supabase auth session
let profile = null;   // row from public.users for the signed-in user
let vendor = null;    // row from public.vendors for the signed-in user, if any
let editingProductId = null;
let duplicatingProductId = null;
let currentProductDetail = null; // whatever renderProductDetail last loaded, reused by buyNow/confirmRental for the confirmation dialog
let authMode = "login"; // 'login' | 'register'
let notifCount = 0;
let requestOfferBadgeCount = 0;
let vendorPendingOrderCount = 0;
let buyerPendingOrderCount = 0;
let buyerFollowingCount = 0;
let buyerTotalOrderCount = 0;
let vendorProductCount = 0;
let vendorProfileViewsToday = 0;
let vendorOrdersToday = 0;
// Only orders still awaiting the vendor's own action (accept, then hand
// over) keep the nav badge lit -- once it's handed over/returned/disputed,
// the ball is in the customer's (or admin's) court, not something that needs
// a vendor to keep seeing a red flag for.
const NON_TERMINAL_ORDER_STATUSES = ["pending", "confirmed", "payment_unresolved"];
let unreadMessageCount = 0;
let unreadSuggestionCount = 0;
let buyerCartCount = 0;
let notifTarget = null; // { view, params }
let favoriteIds = new Set();
let packageFavoriteIds = new Set();
let homeListingTab = "products";
let storefrontCatalogTab = "products";
let storefrontCategoryFilter = "";

