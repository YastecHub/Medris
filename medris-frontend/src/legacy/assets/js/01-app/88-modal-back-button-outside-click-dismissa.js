// ---------- MODAL BACK-BUTTON / OUTSIDE-CLICK DISMISSAL ----------
// A handful of plain, non-destructive popups should close like a native
// sheet: tap outside, or press the phone's back button, same as tapping
// Cancel. Deliberately NOT applied to confirmModal/adminPasswordModal/
// deleteAccountModal/resetPasswordModal - those need an explicit choice,
// not an accidental dismiss.
let dismissibleModalId = null;
const DISMISSIBLE_MODAL_CLOSERS = {
  productModal: closeProductModal,
  packageModal: closePackageModal,
  loginModal: hideLogin,
  installPromptModal: dismissInstallPrompt,
  notifPromptModal: dismissNotifPrompt,
  tourModal: finishTour,
  suggestionModal: closeSuggestionModal,
  locationPromptModal: () => resolveLocationPrompt(false),
  storefrontShareModal: closeStorefrontShareModal,
};
function trackModalOpened(id) {
  dismissibleModalId = id;
  history.pushState({ dismissibleModal: id }, "", location.href);
}
document.addEventListener("click", (e) => {
  if (!dismissibleModalId || e.target.id !== dismissibleModalId) return;
  DISMISSIBLE_MODAL_CLOSERS[dismissibleModalId]?.();
  if (history.state?.dismissibleModal) { window.__ignoreNextPopstate = true; setTimeout(() => { window.__ignoreNextPopstate = false; }, 800); }
  history.back();
});

// If the app was opened straight onto an inner page (reload, push-notification link, shared link), put Home underneath it so the
// phone's back button walks back to Home instead of leaving the app.
function seedHomeBelowCurrentPage() {
  try {
    const st = history.state;
    if (window.__homeSeeded || !st || !st.view || st.view === "home" || st.dismissibleModal) return;
    window.__homeSeeded = true;
    const url = location.href;
    history.replaceState({ view: "home", params: {} }, "", location.pathname);
    history.pushState(st, "", url);
  } catch (_) {}
}
setTimeout(seedHomeBelowCurrentPage, 1500);
window.addEventListener("pageshow", () => setTimeout(seedHomeBelowCurrentPage, 400));
window.addEventListener("popstate", (e) => {
  if (window.__ignoreNextPopstate) { window.__ignoreNextPopstate = false; return; }
  if (msgSelectMode) { msgSelectMode = false; msgSelectedIds.clear(); }
  if (notifSelectMode) { notifSelectMode = false; notifSelectedIds.clear(); }
  if (dismissibleModalId) {
    DISMISSIBLE_MODAL_CLOSERS[dismissibleModalId]?.();
    return;
  }
  if (e.state && e.state.view) navigate(e.state.view, e.state.params || {}, false);
  else navigate("home", {}, false);
});

(async function init() {
  applyHorizontalBrowsePreference();
  prepareLevromartSplash();
  const splashEmergencyTimer=setTimeout(()=>{const el=byId("levromartSplash");if(el&&!window.__levroSplashHidden){el.classList.add("is-hidden");el.setAttribute("aria-hidden","true");console.warn("[Levromart] Splash watchdog released startup after a bounded timeout.");}},1400);
  // Absolute backstop: whatever else happens, the splash can never stay on
  // screen longer than this. The two hides below are the real triggers.

  try {
  initTheme();
  initAccent();
  ensureCurrentInterfaceDefaults();
  applyLevromartFontScale();
  initSound();
  initLocationSetting();
  initLeviVisible();
  initAiChatMic();
  initBottomNavScrollMotion();
  initFloatingScrollVisibility();
  byId("footerYear").textContent = new Date().getFullYear();
  history.replaceState({ view: "home", params: {} }, "", location.pathname + location.search);
  // Never hold the first paint hostage to an Auth network round-trip.
  // Supabase restores a cached session locally; if the network is unavailable,
  // Home can still render from the offline catalogue immediately.
  await Promise.race([
    refreshAuthStateOnce(),
    new Promise(resolve => setTimeout(resolve, 400))
  ]).catch(() => {});
  resumeManualResetWatcher();

  if(session){const legalOk=await Promise.race([window.__levroCheckLegalConsent?.(),new Promise(r=>setTimeout(()=>r(true),600))]);if(legalOk===false){hideLevromartSplash();return;}}
  if(session) window.__levroCheckPayoutSetup?.();
  if(session) window.__levroCheckCommissionDueReminder?.();

  const urlParams = new URLSearchParams(location.search);
  // The SPA route is also encoded in the browser URL for every ordinary view.
  // This is the hard-reload backstop: even if Safari/PWA storage is discarded,
  // the browser still knows exactly which Levromart screen was open.
  const persistedUrlView = urlParams.get("appView");
  if (persistedUrlView) {
    const allowedPersistedViews = new Set(["home","profile","vendors","storefront","productDetail","packageDetail","wishlist","cart","requestEquipment","buyerOrders","orderHistory","messages","settings","vendorDashboard","vendorProducts","vendorPackages","vendorEarnings","vendorOrders","vendorEditProfile","vendorRequests","notifications","adminPanel","adminCarousel","adminLinkLibrary","adminInventory","adminDisputes","adminSupportRequests","adminPeople","adminFeedback","adminUsers","adminFinance","adminLog","vendorSuggestionsInbox","customerFollowing","supportRequest","contactUs","leaderboard","adminPoints","search","terms","privacy","refundPolicy","suspended","adminMonthlyListings"]);
    let persistedParams = {};
    try { persistedParams = JSON.parse(urlParams.get("appParams") || "{}"); } catch (_) {}
    if (allowedPersistedViews.has(persistedUrlView)) {
      history.replaceState({ view: persistedUrlView, params: persistedParams }, "", `${location.pathname}?appView=${encodeURIComponent(persistedUrlView)}&appParams=${encodeURIComponent(JSON.stringify(persistedParams))}`);
      await navigate(persistedUrlView, persistedParams, false);
      return;
    }
  }
  if (urlParams.get("product")) {
    const productId = urlParams.get("product");
    history.replaceState({ view: "productDetail", params: { productId } }, "", location.pathname + "?product=" + encodeURIComponent(productId));
    await navigate("productDetail", { productId }, false);
    return;
  }
  if (urlParams.get("storefront")) {
    const vendorId = urlParams.get("storefront");
    history.replaceState({ view: "storefront", params: { vendorId } }, "", location.pathname + "?storefront=" + encodeURIComponent(vendorId));
    await navigate("storefront", { vendorId }, false);
    return;
  }
  if (urlParams.get("package")) {
    const packageId = urlParams.get("package");
    history.replaceState({ view: "packageDetail", params: { packageId } }, "", location.pathname + "?package=" + encodeURIComponent(packageId));
    await navigate("packageDetail", { packageId }, false);
    return;
  }
  // Admin-generated carousel destination links. Public destinations open
  // directly; authenticated destinations use the existing login gate.
  if (urlParams.get("levro")) {
    const deepView = urlParams.get("levro");
    const section = urlParams.get("section") || "";
    if (deepView === "notifications" || deepView === "profile") {
      if (!session) { showLogin(); return; }
      if (deepView === "notifications") {
        lastNotificationReturnView = "home";
        await navigate("notifications", {}, false);
      } else {
        history.replaceState({ view: "home", params: {} }, "", location.pathname);
        await navigate("home", {}, false);
        setTimeout(() => openProfileOrShop(), 60);
      }
      return;
    }
    if (deepView === "orders") {
      history.replaceState({ view: "home", params: {} }, "", location.pathname);
      if (!session) { showLogin(); return; }
      await navigate(profile?.role === "admin" ? "adminFinance" : (vendor ? "vendorOrders" : "buyerOrders"), vendor ? {status:"all",perspective:"sales"} : {}, false);
      return;
    }
    if (["cart","messages","vendorDashboard","vendorProducts","vendorPackages","vendorOrders","vendorEditProfile","vendorRequests","settings","supportRequest","vendors","leaderboard","vendorApply","wishlist","adminPanel","adminCarousel","adminLinkLibrary","adminInventory","adminPeople","adminFinance","adminDisputes","adminSupportRequests","adminFeedback","adminUsers","adminLog","adminMonthlyListings","vendorSuggestionsInbox","notifications"].includes(deepView)) {
      history.replaceState({ view: "home", params: {} }, "", location.pathname);
      const authViews = ["cart","messages","vendorDashboard","vendorProducts","vendorPackages","vendorOrders","vendorEditProfile","vendorRequests","settings","supportRequest","wishlist","adminPanel","adminCarousel","adminLinkLibrary","adminInventory","adminPeople","adminFinance","adminDisputes","adminSupportRequests","adminFeedback","adminUsers","adminLog","adminMonthlyListings","vendorSuggestionsInbox","notifications"];
      if (!session && authViews.includes(deepView)) { showLogin(); return; }
      await navigate(deepView, {}, false);
      if (deepView === "vendors" && urlParams.get("map") === "1") {
        setTimeout(() => { try { switchVendorsView("map"); } catch (_) {} }, 80);
      }
      return;
    }
    if (deepView === "home") {
      history.replaceState({ view: "home", params: {} }, "", location.pathname);
      await navigate("home", {}, false);
      setTimeout(() => {
        if (section === "services" || section === "packages" || section === "products") { try { switchHomeListingTab(section); } catch (_) {} }
        const anchor = section === "browse" || section === "services" || section === "packages" || section === "products" ? byId("browseSection") : null;
        if (anchor) anchor.scrollIntoView({behavior:"smooth", block:"start"});
      }, 80);
      return;
    }
  }
  if (urlParams.get("share")) {
    const token = urlParams.get("share");
    history.replaceState({ view: "sharedAiChat", params: { token } }, "", location.pathname);
    await navigate("sharedAiChat", { token }, false);
    return;
  }

  if (urlParams.get("paid") === "1" && urlParams.get("reference")) {
    const reference = urlParams.get("reference");
    const orderId = urlParams.get("orderId");
    history.replaceState({ view: "home", params: {} }, "", location.pathname);
    // payments started with "Pay now (Paystack)": the new backend checks with Paystack and settles (issue #96)
    if (/^lvm_ord_/.test(reference) && window.lvConfirmPaystack) { await window.lvConfirmPaystack(reference, orderId); return; }
    showVerifyingPaymentScreen();
    try {
      const res = await fetch(`/api/verify-payment?reference=${encodeURIComponent(reference)}`);
      const json = await res.json();
      if (json.status === "success") showToast("Payment received, thank you!", "success");
      else showToast("We couldn't confirm that payment yet. It may still be processing.", "info");
    } catch (e) {
      showToast("Couldn't reach the payment verification service.", "error");
    }
    if (orderId) { await navigate("orderDetail", { orderId }); return; }
  }

  if (urlParams.get("commissionPaid") === "1" && urlParams.get("reference")) {
    const reference = urlParams.get("reference");
    history.replaceState({ view: "home", params: {} }, "", location.pathname);
    showVerifyingPaymentScreen();
    try {
      const res = await fetch(`/api/verify-payment?reference=${encodeURIComponent(reference)}`);
      const json = await res.json();
      if (json.status === "success") showToast("Commission settled, thank you!", "success");
      else showToast("We couldn't confirm that payment yet. It may still be processing.", "info");
    } catch (e) {
      showToast("Couldn't reach the payment verification service.", "error");
    }
    await navigate("vendorEditProfile");
    return;
  }

  if (urlParams.get("billingSetup") === "1" && urlParams.get("reference")) {
    const reference = urlParams.get("reference");
    history.replaceState({ view: "home", params: {} }, "", location.pathname);
    showVerifyingPaymentScreen();
    try {
      const res = await fetch(`/api/verify-payment?reference=${encodeURIComponent(reference)}`);
      const json = await res.json();
      if (json.status === "success") showToast("Monthly billing set up. Your card is saved.", "success");
      else showToast("We couldn't confirm that payment yet. It may still be processing.", "info");
    } catch (e) {
      showToast("Couldn't reach the payment verification service.", "error");
    }
    await navigate("vendorEditProfile");
    return;
  }

  // Deep link from an order-notification email
  if (urlParams.get("order")) {
    const orderId = urlParams.get("order");
    history.replaceState({ view: "home", params: {} }, "", location.pathname);
    if (session) { await navigate("orderDetail", { orderId }); return; }
    showLogin();
  }

  // Generic deep link from any notification email (see api/notify-email.js)
  if (urlParams.get("nview")) {
    const view = urlParams.get("nview");
    let params = {};
    try { params = JSON.parse(urlParams.get("nparams") || "{}"); } catch (e) {}
    history.replaceState({ view: "home", params: {} }, "", location.pathname);
    if (session) { await navigate(view, params); return; }
    showLogin();
  }

  // No deep-link param claimed this load - resume the exact in-app route
  // from the current tab session instead of restarting at Home. This also
  // deliberately includes Home so every page/route has consistent reload
  // semantics.
  let resumed = false;
  try {
    const last = window.__levromartReadPersistedRoute?.();
    if (last && last.view) { await navigate(last.view, last.params || {}, false); resumed = true; }
  } catch (e) {}
  if (!resumed) {
    try {
      await navigate("home");
    } catch (e) {
      // Final first-paint guard: a failed Home render must never leave the
      // user with an empty app shell or a permanent splash screen.
      const app = byId("app");
      if (app) app.innerHTML = homeFallbackHtml("We could not load the marketplace right now. Your data is safe, try again.");
      console.error("[Levromart] Initial Home navigation failed:", e);
    }
  }

  // Offer the installable app to every visitor, not just after login - give
  // Chrome a moment to fire beforeinstallprompt first.
  awaitingInstallPromptForLogin = true;
  setTimeout(maybeShowInstallPrompt, 2500);
  // Returning, already-logged-in visitors who dismissed the install prompt
  // in an earlier session won't see it again, so give the notification
  // prompt its own independent chance to show too.
  setTimeout(maybeShowNotifPrompt, 3200);
  // Same idea for the first-visit tour - it's chained after the notification
  // prompt normally, but this catches anyone who already cleared both of the
  // earlier popups in a previous session.
  setTimeout(maybeShowTour, 4000);
  } finally {
    clearTimeout(splashEmergencyTimer);
    hideLevromartSplash();
  }
})();


// Full-screen branded takeover for genuine no-connectivity (the browser's
// own online/offline signal -- airplane mode, no SIM data, Wi-Fi off), kept
// completely separate from ordinary slow-request handling so a weak signal
// never triggers it, only an actually-dead one. Home is the one page with
// a real offline experience of its own (a cached browseable copy), so it
// steps aside there instead of covering it -- see renderHome().
function showLevromartOfflineOverlay(){
  const el = byId("levromartOfflineOverlay");
  if (!el) return;
  el.classList.add("show");
  el.setAttribute("aria-hidden", "false");
}
function hideLevromartOfflineOverlay(){
  const el = byId("levromartOfflineOverlay");
  if (!el) return;
  el.classList.remove("show");
  el.setAttribute("aria-hidden", "true");
}
window.retryLevromartConnection = function(ev){
  if (navigator.onLine) {
    hideLevromartOfflineOverlay();
    navigate(currentView || "home", {}, false).catch(()=>{});
    return;
  }
  const btn = ev?.currentTarget;
  if (btn) {
    btn.classList.add("levro-offline-shake");
    setTimeout(() => btn.classList.remove("levro-offline-shake"), 420);
  }
  showToast("Still no connection -- check your Wi-Fi or mobile data.", "info");
};

// Offline/online state: if a connection returns after an offline browse,
// quietly refresh Home in the background without making the tap wait.
(function(){
  let offlineWasShown = false;
  function refreshOfflineState(){
    if (navigator.onLine) {
      hideLevromartOfflineOverlay();
      if (offlineWasShown && currentView === "home") navigate("home", {}, false).catch(()=>{});
      offlineWasShown = false;
      return;
    }
    offlineWasShown = true;
    if (currentView !== "home") showLevromartOfflineOverlay();
  }
  window.addEventListener("online", () => { __levroOfflineEventSeen = false; refreshOfflineState(); }, { passive:true });
  window.addEventListener("offline", () => { __levroOfflineEventSeen = true; refreshOfflineState(); }, { passive:true });
  if (navigator.onLine === false) __levroOfflineEventSeen = true;
  refreshOfflineState();
})();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshPushSubscription();
}, { passive: true });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      await reg.update().catch(() => {});
      // Wait for an active worker so iOS/Android doesn't race subscription
      // creation against service-worker activation.
      await navigator.serviceWorker.ready;
      if (session && profile && pushSupported() && Notification.permission === "granted") {
        await syncPushSubscription(reg).catch(() => {});
      }
    } catch (e) {}
  });
}
