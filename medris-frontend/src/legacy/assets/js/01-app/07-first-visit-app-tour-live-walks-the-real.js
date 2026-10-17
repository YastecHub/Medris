// ---------- FIRST-VISIT APP TOUR (Levi walks you round the real app) ----------
// Rebuilt to be quick and never in the way: every step points at a real element on the real page, the explanation
// card is a bottom/top sheet that can never run off the screen (Back / Next are always tappable), the page jumps
// straight to each target (no slow gliding) and nothing waits on a network call.
// Messages / Orders / Notifications live in different places per account type, so those steps are resolved per role.
const HOME_TOUR_STEPS = [
  { icon: "fa-hand-sparkles", title: "Hi, I'm Levi", body: "Let me show you around. It takes about a minute, and you can skip any time.", selector: null },
  { icon: "fa-magnifying-glass", title: "Search anything", body: "Search the whole marketplace, then narrow it with the All, Products, Vendors, Services and Packages tabs.", selector: ".header-search-row" },
  { icon: "fa-shapes", title: "Browse by category", body: "Tap a category and everything below narrows to it. Tap it again to go back to normal.", selector: ".levro-home-cat-rail" },
  { icon: "fa-images", title: "Offers and news", body: "Swipe the banners, or just wait, they move on their own.", selector: ".home-promotional-carousel" },
  { icon: "fa-bolt", title: "Quick actions", body: "Shortcuts to shopping, services, rentals, vendors, item requests and chat.", selector: ".levro-home-quick-actions" },
  { icon: "fa-store", title: "Find vendors near you", body: "Open Vendors to see every verified vendor, on a map or a list, closest first.", selector: `#bottomNav .bottom-nav-item[onclick*="'vendors'"]` },
  "ORDERS_TOUR_STEP",
  "MESSAGES_TOUR_STEP",
  "NOTIFICATIONS_TOUR_STEP",
  {
    icon: "fa-user", title: "Your profile", body: "Your account, orders, saved items, settings, and this tour, all live in this panel.",
    selector: "#profilePanel",
    onEnter: () => { try { toggleProfilePanel(); } catch (_) {} },
    onExit: () => { try { closeAllPanels(); } catch (_) {} },
  },
  { icon: "fa-comments", title: "That's me, right there", body: "Tap me any time to ask what to buy or how anything works. Long-press me to hide me; triple-tap the page to bring me back.", selector: "#aiChatFab" },
];
function buildMessagesTourStep() {
  if (!session || profile?.role === "admin") return null;
  return { icon: "fa-comment-dots", title: "Message a vendor", body: "Chat opens once a vendor accepts your order, so you can sort out details together. Your number is never shared.", selector: "#messagesWrap" };
}
function buildOrdersTourStep() {
  if (!session || profile?.role === "admin") return null;
  return { icon: "fa-receipt", title: "Your orders", body: "Follow every order from here. Finished and cancelled ones sit under the history button.", selector: `#bottomNav .bottom-nav-item[onclick*="Orders"]` };
}
function buildNotificationsTourStep() {
  if (!session) return null;
  if (profile?.role === "admin") return { icon: "fa-bell", title: "Your notifications", body: "Tap the bell for orders, disputes and platform activity as they happen.", selector: "#notifWrap" };
  return { icon: "fa-bell", title: "Stay in the loop", body: "Orders, offers and updates show up under Notifications in your bottom bar.", selector: `#bottomNav .bottom-nav-item[onclick*="navigate('notifications')"]` };
}
function resolveTourSteps(steps) {
  return steps.map((s) => s === "ORDERS_TOUR_STEP" ? buildOrdersTourStep() : s === "MESSAGES_TOUR_STEP" ? buildMessagesTourStep() : s === "NOTIFICATIONS_TOUR_STEP" ? buildNotificationsTourStep() : s).filter(Boolean);
}
// Vendors get one extra step on their own dashboard.
const VENDOR_TOUR_STEP = { icon: "fa-store", title: "Your shop at a glance", body: "Listings, reviews, rating and followers, the same numbers customers see. Commission owed and days left show here too.", selector: ".commission-card, .storefront-stats", view: "vendorDashboard" };
let LIVE_TOUR_STEPS = HOME_TOUR_STEPS.filter((s) => typeof s !== "string");
let liveTourStep = 0;
let liveTourRunToken = 0;
let liveTourBusy = false;

function tourIsVisible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
}
function tourFind(selector) { return selector ? [...document.querySelectorAll(selector)].find(tourIsVisible) || null : null; }
async function waitForTourTarget(selector, maxMs = 900) {
  const t0 = performance.now();
  for (;;) {
    const el = tourFind(selector);
    if (el || performance.now() - t0 > maxMs) return el;
    await new Promise(requestAnimationFrame);
  }
}
// the Levi badge with a blinking eye (same mascot as the map / campus picker)
let tourBlinkTimer = null;
function tourBlink() {
  clearTimeout(tourBlinkTimer);
  const eye = document.querySelector("#lvTour .lvt-mascot .lvc-eye");
  if (!eye || !eye.animate || byId("lvTour")?.classList.contains("hidden")) return;
  try { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (_) {}
  eye.style.transformBox = "fill-box"; eye.style.transformOrigin = "center";
  try { eye.animate([{ transform: "scaleY(1)" }, { transform: "scaleY(.1)", offset: .5 }, { transform: "scaleY(1)" }], { duration: 220, easing: "ease-in-out" }); } catch (_) {}
  tourBlinkTimer = setTimeout(tourBlink, 2600 + Math.random() * 2200);
}
function clearTourTargetLock() {
  document.querySelectorAll(".tour-target-locked").forEach((el) => { el.classList.remove("tour-target-locked"); el.removeAttribute("data-tour-target"); });
}
function lockTourTarget(el) { clearTourTargetLock(); if (el) { el.classList.add("tour-target-locked"); el.setAttribute("data-tour-target", "true"); } }

function tourPlace(el) {
  const hole = byId("lvTourHole"), sheet = byId("lvTourSheet");
  if (!hole || !sheet) return;
  const vh = innerHeight, vw = innerWidth;
  if (!el) { hole.classList.add("none"); sheet.classList.remove("top"); return; }
  const r = el.getBoundingClientRect(), pad = 6;
  const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
  const w = Math.min(vw - 8, r.width + pad * 2) , h = Math.min(vh - 8, r.height + pad * 2);
  hole.classList.remove("none");
  hole.style.transform = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
  hole.style.width = Math.round(Math.min(w, vw - left - 4)) + "px";
  hole.style.height = Math.round(h) + "px";
  // the card sits on whichever half of the screen the target is NOT in
  sheet.classList.toggle("top", r.top + r.height / 2 > vh * 0.55);
}

async function showTour() {
  liveTourRunToken++;
  const token = liveTourRunToken;
  LIVE_TOUR_STEPS = vendor ? [...resolveTourSteps(HOME_TOUR_STEPS), VENDOR_TOUR_STEP] : resolveTourSteps(HOME_TOUR_STEPS);
  liveTourStep = 0;
  clearTourTargetLock();
  closeAllPanels();
  document.body.classList.remove("search-input-active", "levro-kbd-open");
  document.body.classList.add("tour-active");
  byId("bottomNav")?.classList.remove("nav-scroll-hide", "nav-scroll-shrink");
  const root = byId("lvTour");
  if (!root) return;
  const m = root.querySelector(".lvt-mascot");
  if (m && !m.firstChild) m.innerHTML = window.lvMascotSvg || "";
  root.classList.remove("hidden");
  trackModalOpened("tourModal");
  liveTourBusy = true;
  try {
    if (currentView !== "home") await navigate("home", {}, false);
    window.scrollTo(0, 0);
    if (token !== liveTourRunToken) return;
    await runTourStep(token);
  } finally { if (token === liveTourRunToken) liveTourBusy = false; }
  tourBlink();
}

async function runTourStep(token = liveTourRunToken) {
  if (token !== liveTourRunToken) return;
  const step = LIVE_TOUR_STEPS[liveTourStep];
  if (!step) return;
  const root = byId("lvTour"), sheet = byId("lvTourSheet");
  if (!root || !sheet) return;
  clearTourTargetLock();
  // 1. words first: the card updates at once so tapping Next always feels instant
  byId("lvTourIcon").className = `fa-solid ${step.icon}`;
  byId("lvTourTitle").textContent = step.title;
  byId("lvTourBody").textContent = step.body;
  byId("lvTourDots").replaceChildren(...LIVE_TOUR_STEPS.map((_, i) => { const d = document.createElement("span"); d.className = "lvt-dot" + (i === liveTourStep ? " on" : ""); return d; }));
  byId("lvTourBack").classList.toggle("lvt-hide", liveTourStep === 0);
  byId("lvTourNext").textContent = liveTourStep === LIVE_TOUR_STEPS.length - 1 ? "Get started" : "Next";
  // 2. get to the right place
  if (step.view && step.view !== currentView) { try { await navigate(step.view, {}); } catch (_) {} if (token !== liveTourRunToken) return; }
  try { await step.onEnter?.(); } catch (_) {}
  if (token !== liveTourRunToken) return;
  // 3. find the real element, bring it into view with a plain jump, and point at it
  const el = await waitForTourTarget(step.selector);
  if (token !== liveTourRunToken) return;
  if (el) {
    const cs = getComputedStyle(el);
    if (!(cs.position === "fixed" || cs.position === "sticky" || el.closest("#bottomNav,#profilePanel,.side-drawer"))) {
      const r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > innerHeight - 70) { try { el.scrollIntoView({ behavior: "instant", block: "center" }); } catch (_) { el.scrollIntoView({ block: "center" }); } }
    }
    lockTourTarget(el);
  }
  await new Promise(requestAnimationFrame);
  if (token !== liveTourRunToken) return;
  tourPlace(el);
}

function tourReposition() {
  if (byId("lvTour")?.classList.contains("hidden")) return;
  tourPlace(tourFind(LIVE_TOUR_STEPS[liveTourStep]?.selector));
}
window.addEventListener("resize", () => requestAnimationFrame(tourReposition));

async function tourGo(delta) {
  if (liveTourBusy) return;
  const step = LIVE_TOUR_STEPS[liveTourStep];
  try { await step?.onExit?.(); } catch (_) {}
  if (delta > 0 && liveTourStep >= LIVE_TOUR_STEPS.length - 1) { finishTour(); return; }
  if (delta < 0 && liveTourStep <= 0) return;
  liveTourBusy = true;
  const token = ++liveTourRunToken;
  liveTourStep += delta;
  try { await runTourStep(token); } finally { if (token === liveTourRunToken) liveTourBusy = false; }
}
function tourNext() { return tourGo(1); }
function tourBack() { return tourGo(-1); }

function finishTour() {
  document.body.classList.remove("tour-active");
  try { LIVE_TOUR_STEPS[liveTourStep]?.onExit?.(); } catch (_) {}
  clearTimeout(tourBlinkTimer);
  clearTourTargetLock();
  liveTourRunToken++;
  liveTourBusy = false;
  byId("lvTour")?.classList.add("hidden");
  try { localStorage.setItem("levromart-tour-seen", "1"); } catch (_) {}
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

