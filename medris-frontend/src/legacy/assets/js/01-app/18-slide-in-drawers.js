// ---------- SLIDE-IN DRAWERS ----------
function closeAllPanels() {
  const wasNotificationSurface = currentView === "notifications" || byId("notifPanel")?.classList.contains("open");
  try { window.closeLevromartTransientFilters?.(); } catch (_) {}
  closeAllInfoPopovers();
  document.querySelectorAll(".side-drawer.open").forEach((d) => { d.classList.remove("open"); d.style.transform = ""; d.classList.remove("profile-page-reveal"); });
  byId("drawerBackdrop")?.classList.remove("open");
  document.body.classList.remove("profile-reveal-open", "profile-reveal-dragging");
  document.body.style.removeProperty("--profile-reveal-x");
  if(wasNotificationSurface) void commitPendingNotificationReads();
}
function openDrawer(id) {
  try { window.closeLevromartHeaderSearch?.(); } catch (_) {}
  const target = byId(id);
  if (!target) return;
  const wasOpen = target.classList.contains("open");
  closeAllPanels();
  if (!wasOpen) {
    target.classList.add("open");
    byId("drawerBackdrop")?.classList.add("open");
    playSound("open");
  }
}
function toggleSettingsPanel() { navigate("settings"); }

// Manual, always-available versions of the one-time auto-popups - so
// someone who dismissed the popup (or whose browser fired it before they
// were ready) still has a way to install the app / turn on notifications
// later, instead of only ever getting one shot at it.
function renderSettingsAppRows() {
  const renderInstall = (targetId) => {
    const row = byId(targetId);
    if (!row) return;
    if (isStandalone()) {
      row.innerHTML = `<i class="fa-solid fa-mobile-screen-button settings-row-icon"></i><span class="settings-row-copy"><strong>App installation</strong><small>Levromart is installed on this device.</small></span><span class="settings-status-pill">Installed</span>`;
    } else if (deferredInstallPrompt) {
      row.innerHTML = `<i class="fa-solid fa-mobile-screen-button settings-row-icon"></i><span class="settings-row-copy"><strong>Download the app</strong><small>Install Levromart for a faster app-like experience.</small></span><button class="settings-inline-btn active" onclick="runInstallPrompt().then(() => renderSettingsAppRows())">Install</button>`;
    } else if (isIos()) {
      row.innerHTML = `<i class="fa-solid fa-mobile-screen-button settings-row-icon"></i><span class="settings-row-copy"><strong>Download the app</strong><small>Tap Share <i class="fa-solid fa-arrow-up-from-bracket"></i> then choose “Add to Home Screen”.</small></span>`;
    } else {
      row.innerHTML = `<i class="fa-solid fa-mobile-screen-button"></i><span><strong>Download the app</strong><small>Install from your browser when the install option becomes available.</small></span>`;
    }
  };
  const renderNotif = (targetId) => {
    const row = byId(targetId);
    if (!row) return;
    if (!pushSupported()) {
      row.innerHTML = `<i class="fa-solid fa-bell settings-row-icon"></i><span class="settings-row-copy"><strong>Notifications</strong><small>Notifications are not supported in this browser.</small></span>`;
    } else if (isIos() && !isStandalone()) {
      row.innerHTML = `<i class="fa-solid fa-bell settings-row-icon"></i><span class="settings-row-copy"><strong>Notifications</strong><small>On iPhone, add Levromart to your Home Screen before enabling push notifications.</small></span><button class="settings-inline-btn" onclick="showToast('Use Share → Add to Home Screen, open the installed Levromart app, then turn notifications on.', 'info')">How</button>`;
    } else if (Notification.permission === "granted") {
      row.innerHTML = `<i class="fa-solid fa-bell settings-row-icon"></i><span class="settings-row-copy"><strong>Notifications</strong><small>Levromart notifications are enabled on this device.</small></span><span class="settings-status-pill active">On</span>`;
      syncPushSubscription().catch(() => {});
    } else if (Notification.permission === "denied") {
      row.innerHTML = `<i class="fa-solid fa-bell settings-row-icon"></i><span class="settings-row-copy"><strong>Notifications</strong><small>Blocked by your browser. Enable them in site settings.</small></span>`;
    } else {
      row.innerHTML = `<i class="fa-solid fa-bell settings-row-icon"></i><span class="settings-row-copy"><strong>Notifications</strong><small>Get updates about orders and important activity.</small></span><button class="settings-inline-btn" onclick="enablePushNotifications().then(() => renderSettingsAppRows())">Turn on</button>`;
    }
  };
  renderInstall("settingsInstallRow");
  renderNotif("settingsNotifRow");
  renderInstall("settingsInstallPageRow");
  renderNotif("settingsNotifPageRow");
  renderAiConsentRow();
}

function renderAiConsentRow() {
  const row = byId("settingsAiConsentRow");
  if (!row || !profile) return;
  const on = !!profile.ai_data_consent;
  row.innerHTML = on
    ? `<span><i class="fa-solid fa-robot"></i> Help improve Levi</span><button class="btn btn-sm btn-outline" onclick="setAiDataConsent(false)"><i class="fa-solid fa-check"></i> On</button>`
    : `<span><i class="fa-solid fa-robot"></i> Help improve Levi</span><button class="btn btn-sm" onclick="setAiDataConsent(true)">Turn on</button>`;
}
async function setAiDataConsent(value) {
  value = !!value;
  if (!session?.user?.id || !profile) return;
  // Update local state immediately so the toggle never remains visually stale.
  const previous = !!profile.ai_data_consent;
  profile.ai_data_consent = value;
  renderAiConsentRow();
  const pageRow = byId("settingsAiConsentPageRow");
  if (pageRow) {
    pageRow.innerHTML = `<i class="fa-solid fa-chart-line settings-row-icon"></i><span class="settings-row-copy"><strong>Help improve Levi</strong><small>Your product-improvement preference</small></span><button class="settings-inline-btn ${value ? 'active' : ''}" onclick="setAiDataConsent(${!value})">${value ? 'On' : 'Off'}</button>`;
  }
  const { error } = await sb.from("users").update({ ai_data_consent: value }).eq("id", session.user.id);
  if (error) {
    profile.ai_data_consent = previous;
    renderAiConsentRow();
    hydrateSettingsPage();
    showToast(error.message, "error");
    return;
  }
  showToast(value ? "Thanks, your chats may now be reviewed to improve Levi." : "Turned off. Your chats stay private again.", "success");
}
let pendingNotificationReads = new Set();
async function queueNotificationRead(id){
  if(!session?.user?.id || !id) return;
  pendingNotificationReads.add(String(id));
}
function queueVisibleNotificationReads(){
  const host=getNotifHost();
  if(!host || !session?.user?.id) return;
  host.querySelectorAll(".notif-item.unread[data-id]").forEach((el)=>{
    const id=String(el.dataset.id||"").trim();
    if(id) pendingNotificationReads.add(id);
  });
}
async function commitPendingNotificationReads(){
  if(!session?.user?.id || !pendingNotificationReads.size) return;
  const ids=[...pendingNotificationReads]; pendingNotificationReads.clear();
  // Viewing the "All" tab shows every notification with no category filter,
  // so leaving it is "I've seen everything" -- but the pending-id list above
  // is still bounded by whatever this fetch actually returned. A busy
  // account can outpace any fixed page size, leaving genuinely-viewed rows
  // beyond it stuck unread forever and the badge count permanently wrong no
  // matter how often the page is opened. Mark the whole inbox read here
  // instead of just the ids that happened to be on screen.
  const { error } = notifViewMode === "all"
    ? await levroData.notifications.markAllRead(session.user.id)
    : await levroData.notifications.markReadForUser(session.user.id, ids);
  if(error){ids.forEach(id=>pendingNotificationReads.add(String(id)));console.warn("[Levromart] Notification read-state commit failed:",error);return;}
  refreshNotifications(false).catch(()=>{});
}

let lastNotificationReturnView="home"; let lastNotificationReturnParams={};
function getNotifHost() { return currentView === "notifications" ? byId("notificationsPage") : byId("notifPanel"); }
function toggleNotifPanel() {
  requestOfferBadgeCount = 0; updateRequestOfferBadge();
  try { sessionStorage.setItem("levromart-request-offers-seen-at", new Date().toISOString()); } catch (_) {}
  notifViewMode = "all"; exitNotifSelectMode(false);
  // Opening Notifications is a viewing action. Keep unread state intact until the user leaves.
  if(session?.user?.id) refreshNotifications(false).catch(()=>{});
  if(currentView!=="notifications"){lastNotificationReturnView=currentView||"home";lastNotificationReturnParams={...(currentViewParams||{})};}
  navigate("notifications");
}
function toggleProfilePanel() { openDrawer("profilePanel"); }
function openProfileOrShop() {
  // Tapping the avatar always opens the quick-access panel first, LinkedIn
  // style; the panel's own header links into the full profile/shop page.
  toggleProfilePanel();
}


// Backdrop/centre swipe gestures for the two right-hand drawers. Opening:
// swipe right -> profile, swipe left -> notifications. Closing an open drawer:
// swipe right. We deliberately ignore cards, maps, tables, horizontal rails,
// form controls and other interactive surfaces so their own gestures remain intact.
(function setupDrawerDragGestures(){
  if (window.__drawerDragGesturesReady) return;
  window.__drawerDragGesturesReady = true;
  const MIN_DRAG = 42;
  const AXIS_RATIO = 1.15;
  const START_ZONE = 0.50;
  const isBlocked = (target) => {
    if (!target?.closest) return false;
    return !!target.closest([
      '#aiChatPanel','#aiChatFab','#cartFab','#vendorsMap','#vendorsMapWrap','#veMap',
      'header','.bottom-nav','.site-footer',
      'button','a','input','textarea','select','label',
      '.card','.product-card-wrap','.vendor-card','.package-card',
      '.grid','.hscroll','.cat-row','.storefront-product-strip','.table-wrap','table',
      '.leaflet','.modal','.modal-content',
      '.chat-page-wrap','.chat-messages','.chat-input-wrap',
      '[contenteditable="true"]','.swiper','.carousel','.gallery',
      '[data-no-drawer-gesture]'
    ].join(','));
  };
  const getOpen = () => ({
    profile: byId('profilePanel')?.classList.contains('open') || false,
    notif: byId('notifPanel')?.classList.contains('open') || false
  });
  let drag = null;
  const begin = (e) => {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') return;
    const open = getOpen();
    const target = e.target;

    if (open.profile || open.notif) {
      const side = open.profile ? 'left' : 'right';
      const panel = open.profile ? byId('profilePanel') : byId('notifPanel');
      // While a drawer is open, only the drawer's non-interactive/background
      // surface can start the close drag. Product rows, buttons, maps, etc.
      // keep their normal touch behaviour.
      if (!panel || !panel.contains(target) || isBlocked(target)) return;
      drag = { id:e.pointerId, x:e.clientX, y:e.clientY, side, mode:'close', panel, active:false };
      try { panel.setPointerCapture?.(e.pointerId); } catch (_) {}
      return;
    }

    // Swiping the page no longer opens the profile or notification panels (it fired by accident, e.g. while pinching or tapping);
    // they open from their icons only. Dragging an already open panel closed still works (handled above).
    return;
    // Opening: choose the drawer by which half of the background the drag
    // starts in. This intentionally avoids the extreme screen edge so Android
    // back gestures do not compete with Levromart's drawer gesture.
    if (isBlocked(target)) return;
    const startLeft = e.clientX < window.innerWidth * START_ZONE;
    const side = startLeft ? 'left' : 'right';
    const panel = side === 'left' ? byId('profilePanel') : byId('notifPanel');
    if (!panel) return;
    drag = { id:e.pointerId, x:e.clientX, y:e.clientY, side, mode:'open', panel, active:false };
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id || e.pointerType === 'mouse' || e.pointerType === 'pen') return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.active) {
      if (Math.hypot(dx,dy) < 6) return;
      if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) { drag = null; return; }
      const correctDirection = drag.mode === 'open'
        ? (drag.side === 'left' ? dx > 0 : dx < 0)
        : (drag.side === 'left' ? dx < 0 : dx > 0);
      if (!correctDirection) { drag = null; return; }
      drag.active = true;
      drag.panel.style.transition = 'none';
      drag.panel.style.willChange = 'transform';
      try { drag.panel.setPointerCapture?.(e.pointerId); } catch (_) {}
    }
    const w = drag.panel.getBoundingClientRect().width || Math.min(380, window.innerWidth * .91);
    let tx;
    if (drag.mode === 'open') {
      const distance = drag.side === 'left' ? Math.max(0, dx) : Math.min(0, dx);
      const progress = Math.min(1, Math.abs(distance) / w);
      tx = drag.side === 'left' ? -w + (w * progress) : w - (w * progress);
    } else {
      const distance = drag.side === 'left' ? Math.min(0, dx) : Math.max(0, dx);
      tx = distance;
    }
    drag.panel.style.transform = `translateX(${tx}px)`;
    e.preventDefault?.();
  };
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const w = d.panel?.getBoundingClientRect().width || Math.min(380, window.innerWidth * .91);
    const progress = Math.min(1, Math.abs(dx) / Math.max(w,1));
    const velocityEnough = Math.abs(dx) >= 22 && Math.abs(dx) / Math.max(1, (performance.now() - (d.startedAt || performance.now()))) > .25;
    const enough = Math.abs(dx) >= MIN_DRAG || progress >= .22 || velocityEnough;
    const correct = d.mode === 'open'
      ? (d.side === 'left' ? dx > 0 : dx < 0)
      : (d.side === 'left' ? dx < 0 : dx > 0);
    d.panel.style.transition = 'transform .24s cubic-bezier(.22,.8,.2,1)';
    d.panel.style.willChange = '';
    d.panel.style.transform = '';
    if (d.active && enough && correct && Math.abs(dx) > Math.abs(dy) * AXIS_RATIO) {
      if (d.mode === 'open') d.side === 'left' ? openProfileOrShop() : toggleNotifPanel();
      else closeAllPanels();
    }
    drag = null;
  };
  document.addEventListener('pointerdown', (e) => { if (e.isPrimary !== false) { begin(e); if (drag) drag.startedAt = performance.now(); } }, {passive:true});
  document.addEventListener('pointermove', move, {passive:false});
  document.addEventListener('pointerup', end, {passive:true});
  document.addEventListener('pointercancel', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.panel.style.transition = '';
    drag.panel.style.willChange = '';
    drag.panel.style.transform = '';
    drag = null;
  }, {passive:true});
})();

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAllPanels(); });

// Swipe left/right ANYWHERE on the page (not just the bottom bar) moves to
// the next/previous bottom-nav tab - e.g. swipe from Home and land on
// Messages, without touching the bar itself. This replaces an earlier
// swipe-anywhere gesture that opened the notification/profile panels
// instead; that was confusing (an invisible trigger for a side effect that
// looked unrelated to the swipe) and is gone now - panels open via their
// icon buttons only, swiping always means "change page." The outermost
// sliver of each edge is left alone so it doesn't fight the phone's own OS
// back-gesture, and touches starting inside scrollable rails, form
// controls, drawers, or modals are ignored so this never hijacks a
// carousel swipe, a table's own horizontal scroll, or a text selection.
