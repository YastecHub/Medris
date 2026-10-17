// ---------- NOTIFICATIONS (real, persisted, realtime) ----------
let notifChannel = null;
let notifRenderEpoch = 0;
function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

let notifViewMode = "all"; // inbox | archived | trash
let notifSelectMode = false;
let notifSelectedIds = new Set();

function updateRequestOfferBadge() {
  document.querySelectorAll('[data-profile-label="Requests"] .profile-request-badge').forEach(el => {
    if (requestOfferBadgeCount > 0) { el.textContent = requestOfferBadgeCount > 9 ? "9+" : String(requestOfferBadgeCount); el.classList.remove("hidden"); } else el.classList.add("hidden");
  });
}

async function __refreshNotificationsNow(renderPanel = true, includeSlow = true) {
  if (!session || !profile) {
    notifCount = 0;
    byId("notifWrap")?.classList.add("hidden");
    byId("messagesWrap")?.classList.add("hidden");
    return;
  }
  // Buyers/vendors get their Notifications in the bottom nav instead, and a
  // header Messages icon. Admins have neither a bottom-nav Notifications tab
  // nor Messages, so they get a header notification bell instead.
  byId("notifWrap")?.classList.toggle("hidden", profile?.role !== "admin");
  byId("messagesWrap")?.classList.toggle("hidden", profile?.role === "admin");

  // Independent badge/count reads run concurrently so one slow table cannot
  // hold up unrelated UI state.
  const unreadQ = levroData.notifications.unreadCount(session.user.id);
  const ordFresh = !!(window.__ordCnt && window.__ordCnt.uid === session.user.id && Date.now() - window.__ordCnt.at < 15000);
  const vendorQ = ordFresh ? Promise.resolve({ count: window.__ordCnt.v }) : vendor ? vendorAttentionCount() : Promise.resolve({ count: 0 });
  const vendorProductCountQ = (vendor && includeSlow) ? sb.from("products").select("id", { count: "exact", head: true }).eq("vendor_id", vendor.id) : Promise.resolve(null);
  // "Today" is computed in the viewer's own local time (matches the same
  // toDateString() approach vendorEarningsInPeriod already uses for its
  // "today" filter) rather than a UTC day boundary, so a vendor in Lagos
  // sees today's views reset at their own midnight, not at 1am WAT.
  const todayStartLocal = new Date(); todayStartLocal.setHours(0, 0, 0, 0);
  const vendorProfileViewsTodayQ = (vendor && includeSlow) ? sb.from("vendor_profile_view_events").select("id", { count: "exact", head: true }).eq("vendor_id", vendor.id).gte("viewed_at", todayStartLocal.toISOString()) : Promise.resolve(null);
  const buyerQ = ordFresh ? Promise.resolve({ count: window.__ordCnt.b }) : sb.from("orders").select("id", { count: "exact", head: true }).eq("buyer_id", session.user.id).in("status", NON_TERMINAL_ORDER_STATUSES);
  // Slow-changing numbers (following count, lifetime order count, suggestions,
  // product count, profile views) are only re-read about once a minute.
  const followingQ = (profile?.role !== "admin" && includeSlow) ? levroData.follows.count(session.user.id) : Promise.resolve(profile?.role !== "admin" ? null : { count: 0 });
  const totalOrdersQ = (profile?.role !== "admin" && includeSlow) ? sb.from("orders").select("id", { count: "exact", head: true }).eq("buyer_id", session.user.id) : Promise.resolve(profile?.role !== "admin" ? null : { count: 0 });
  const suggestionQ = !includeSlow ? Promise.resolve(null) : profile?.role === "admin" ? sb.rpc("get_platform_suggestions") : vendor ? sb.rpc("get_vendor_suggestions") : Promise.resolve({ data: [] });
  // The chat list and the cart count are re-read at most every 30s unless something just
  // changed (a new notification, a cart edit) -- they used to be fetched on every refresh.
  const convFresh = Array.isArray(window.__convRaw) && Date.now() - (window.__convRawAt || 0) < 30000;
  const conversationsQ = convFresh ? Promise.resolve({ data: window.__convRaw }) : sb.rpc("list_my_conversations").then((r) => { if (!r.error) { window.__convRaw = r.data; window.__convRawAt = Date.now(); } return r; });
  const cartFresh = typeof window.__cartCountVal === "number" && Date.now() - (window.__cartCountAt || 0) < 30000;
  const cartQ = profile?.role === "admin" ? Promise.resolve({ count: 0 }) : cartFresh ? Promise.resolve({ count: window.__cartCountVal }) : levroData.cart.count(session.user.id).then((r) => { if (!r.error) { window.__cartCountVal = r.count || 0; window.__cartCountAt = Date.now(); } return r; });
  let requestSeenAt = ""; try { requestSeenAt = sessionStorage.getItem("levromart-request-offers-seen-at") || ""; } catch (_) {}
  const requestOfferQ = profile?.role !== "admin" ? levroData.notifications.offerCount(session.user.id, requestSeenAt || "1970-01-01T00:00:00.000Z") : Promise.resolve({ count: 0 });

  const vendorOrdersTodayQ = (vendor && includeSlow) ? sb.from("orders").select("id", { count: "exact", head: true }).eq("vendor_id", vendor.id).gte("created_at", todayStartLocal.toISOString()) : Promise.resolve(null);
  const [unreadRes, vendorRes, buyerRes, suggestionRes, conversationsRes, cartRes, requestOfferRes, vendorProductCountRes, followingRes, totalOrdersRes, vendorProfileViewsTodayRes, vendorOrdersTodayRes] = await Promise.all([
    unreadQ, vendorQ, buyerQ, suggestionQ, conversationsQ, cartQ, requestOfferQ, vendorProductCountQ, followingQ, totalOrdersQ, vendorProfileViewsTodayQ, vendorOrdersTodayQ
  ]);
  if (vendorOrdersTodayRes) vendorOrdersToday = vendor ? (vendorOrdersTodayRes?.count || 0) : 0;
  if (!ordFresh) window.__ordCnt = { at: Date.now(), uid: session.user.id, v: vendorRes?.count || 0, b: buyerRes?.count || 0 };
  if (vendorProductCountRes) vendorProductCount = vendor ? (vendorProductCountRes?.count || 0) : 0;
  else if (!vendor) vendorProductCount = 0;
  if (vendorProfileViewsTodayRes) vendorProfileViewsToday = vendor ? (vendorProfileViewsTodayRes?.count || 0) : 0;
  else if (!vendor) vendorProfileViewsToday = 0;

  notifCount = Number(unreadRes?.count || 0);
  const dot = byId("notifDot");
  if (dot) {
    if (notifCount > 0) { dot.textContent = notifCount > 9 ? "9+" : notifCount; dot.classList.remove("hidden"); }
    else dot.classList.add("hidden");
  }
  vendorPendingOrderCount = vendor ? (vendorRes?.count || 0) : 0;
  buyerPendingOrderCount = buyerRes?.count || 0;
  if (followingRes) buyerFollowingCount = followingRes?.count || 0;
  if (totalOrdersRes) buyerTotalOrderCount = totalOrdersRes?.count || 0;
  if (suggestionRes) unreadSuggestionCount = (suggestionRes?.data || []).filter((x) => String(x.status || "").toLowerCase() === "new").length;
  unreadMessageCount = (conversationsRes?.data || []).reduce((sum, c) => sum + (c.unread_count > 0 ? 1 : 0), 0);
  try { window.__lvSetChatIcon && window.__lvSetChatIcon((conversationsRes?.data || []).length > 0); } catch (_) {}
  const messagesDot = byId("messagesDot");
  if (messagesDot) {
    if (unreadMessageCount > 0) { messagesDot.textContent = unreadMessageCount > 9 ? "9+" : unreadMessageCount; messagesDot.classList.remove("hidden"); }
    else messagesDot.classList.add("hidden");
  }
  buyerCartCount = profile?.role !== "admin" ? (cartRes?.count || 0) : 0;
  requestOfferBadgeCount = Number(requestOfferRes?.count || 0);
  updateRequestOfferBadge();
  updateCartFab();

  // Mark incoming messages as delivered, at most once a minute (this was a write on every refresh).
  if (Date.now() - (window.__lastDeliveredStamp || 0) > 60000) {
    window.__lastDeliveredStamp = Date.now();
    sb.from("messages").update({ delivered_at: new Date().toISOString() }).is("delivered_at", null).neq("sender_id", session.user.id).then(() => {}).catch(() => {});
  }
  renderBottomNav();
  // The profile panel's stats (pending orders, followers, etc.) are built
  // from these same globals inside updateAuthUI(), but opening the panel
  // just toggles a drawer's visibility -- it never re-renders. Without this,
  // whichever values were current the last time updateAuthUI() happened to
  // run (e.g. a stale count from before this refresh even started) is what
  // stayed on screen indefinitely, showing 0 for a follower count that was
  // simply never fetched yet at that point.
  updateAuthUI();
  if (renderPanel && getNotifHost()) await renderNotifPanel();
}
// refreshNotifications used to run ~13 queries on EVERY call and is called from
// ~40 places (every incoming message, notification, order change, cart change,
// tab focus...). It now (1) shares one in-flight run between concurrent callers,
// (2) coalesces bursts into one trailing run, and (3) re-reads the slow-changing
// counts only once a minute.
let __notifRun = null, __notifAgain = false, __notifAgainPanel = false, __notifLastStart = 0, __notifLastSlow = 0, __notifTrailTimer = null;
const NOTIF_MIN_GAP_MS = 3000, NOTIF_SLOW_EVERY_MS = 60000;
function refreshNotifications(renderPanel = true) {
  if (__notifRun) { __notifAgain = true; __notifAgainPanel = __notifAgainPanel || !!renderPanel; return __notifRun; }
  const since = Date.now() - __notifLastStart;
  if (!renderPanel && since < NOTIF_MIN_GAP_MS) {
    // Too soon after the last one: schedule a single trailing refresh instead.
    __notifAgain = true;
    if (!__notifTrailTimer) __notifTrailTimer = setTimeout(() => { __notifTrailTimer = null; __notifAgain = false; refreshNotifications(false).catch(() => {}); }, NOTIF_MIN_GAP_MS - since + 50);
    return Promise.resolve();
  }
  __notifLastStart = Date.now();
  const slow = Date.now() - __notifLastSlow > NOTIF_SLOW_EVERY_MS;
  if (slow) __notifLastSlow = Date.now();
  __notifRun = (async () => {
    try { return await __refreshNotificationsNow(renderPanel, slow); }
    finally {
      __notifRun = null;
      if (__notifAgain && !__notifTrailTimer) {
        const wantPanel = __notifAgainPanel; __notifAgain = false; __notifAgainPanel = false;
        __notifTrailTimer = setTimeout(() => { __notifTrailTimer = null; refreshNotifications(wantPanel).catch(() => {}); }, NOTIF_MIN_GAP_MS);
      }
    }
  })();
  return __notifRun;
}
async function renderNotifPanel(opts = {}) {
  const renderToken = ++notifRenderEpoch;
  const panel = getNotifHost();
  if (!panel) return;
  try {
  if (!session?.user?.id) {
    panel.innerHTML = '<p class="muted">Sign in to view your notifications.</p>';
    return;
  }
  const notifCacheKey = `levromart-notifications-cache-v2:${session.user.id}`;
  let cachedNotifItems = [];
  try { cachedNotifItems = JSON.parse(localStorage.getItem(notifCacheKey) || '[]'); } catch (_) { cachedNotifItems = []; }
  // The tab row itself must appear in this instant fast-paint too, even
  // without unread badge counts yet (those need the fresh fetch below to
  // classify). Otherwise the tabs pop into existence a moment later once the
  // real render lands, which read as the tabs/stars "flickering" on open.
  const cachedNotificationTabs=[['all','All'],['personal','Personal'],...(profile?.role!=='admin'&&!vendor?.id?[['orders','Orders']]:[]),...(vendor?.id?[['myListings','My Listings']]:[]),['vendors','Vendors']];
  if(!cachedNotificationTabs.some(([key])=>key===notifViewMode))notifViewMode='all';
  const cachedTabsHtml=`<div class="notif-tabs" role="tablist" aria-label="Notification categories">${cachedNotificationTabs.map(([key,label])=>`<button type="button" role="tab" aria-selected="${notifViewMode===key?"true":"false"}" class="notif-tab ${notifViewMode===key?"active":""}" onclick="switchNotifView('${key}')">${label}</button>`).join('')}</div>`;
  // Switching tabs reuses the list that is already on screen (no repaint without badges, no refetch).
  const reuse = !!(opts && opts.reuse && window.__notifRaw && window.__notifRaw.uid === session.user.id && Date.now() - window.__notifRaw.at < 300000);
  if (reuse) {
    /* keep the current DOM until the new tab is ready */
  } else if (Array.isArray(cachedNotifItems) && cachedNotifItems.length) {
    const cachedList = cachedNotifItems.map(n => {
      const avatar = n.actor_avatar_url ? `<img src="${esc(n.actor_avatar_url)}" class="avatar-circle" style="width:2.15rem;height:2.15rem;object-fit:cover;flex:none;" alt="" draggable="false" />` : n.actor_name ? avatarFallbackHtml(n.actor_name, "2.15rem", "notification-avatar-fallback", n.actor_name, n.actor_id || n.actor_name) : notificationSystemIconHtml(n);
      return `<div class="notif-item-wrap" data-id="${esc(n.id)}"><button type="button" class="notif-item ${n.read ? '' : 'unread'}" data-id="${esc(n.id)}" data-view="${esc(n.target_view || 'home')}" data-params='${esc(JSON.stringify(n.target_params || {}))}' data-actor-name="${esc(n.actor_name || '')}" data-actor-avatar="${esc(n.actor_avatar_url || '')}" onclick="handleNotifItemClick(event,'${esc(n.id)}')">${avatar}<span class="notif-copy"><strong>${esc(n.title || 'Notification')}</strong>${n.body ? `<span class="muted" style="font-size:.8rem;">${esc(n.notification_category === 'new_follower' ? (n.actor_name || n.body) : maskSensitiveNumbers(n.body))}</span>` : ''}<span class="muted" style="font-size:.72rem;">${timeAgo(n.created_at)}</span></span></button></div>`;
    }).join('');
    panel.innerHTML = currentView === "notifications" ? cachedTabsHtml + cachedList : cachedList;
  } else {
    panel.innerHTML = '';
  }
  queueVisibleNotificationReads();
  // The backend still retains archived/deleted fields for compatibility, but
  // the user-facing notification experience is now a smart activity stream.
  // We never mutate or destructively migrate those legacy fields here.
  // This must fetch enough rows to cover every unread notification, not just
  // a recent-history window -- the header/bottom-nav badge counts ALL unread
  // rows with no cap, but this list is the only thing that ever marks a
  // notification read (via queueVisibleNotificationReads()). A small limit
  // here meant a busy account (e.g. an admin) could pile up more unread rows
  // than this query ever fetched, so the badge could never reach zero no
  // matter how many times the page was opened -- the backlog beyond the
  // limit was simply never seen or marked read.
  // Every unread one (so the badge can always reach zero) plus the last 30 days of read
  // ones, capped -- older read notifications are no longer re-downloaded on every open.
  const readSince = new Date(Date.now() - 30 * 86400000).toISOString();
  let q = levroData.notifications.panel(session.user.id, readSince);
  let rawItems, error;
  if (reuse) rawItems = window.__notifRaw.items;
  else {
    ({ data: rawItems, error } = await q);
    if (!error && Array.isArray(rawItems)) {
      try { localStorage.setItem(notifCacheKey, JSON.stringify(rawItems.slice(0,150))); } catch (_) {}
    }
  }
  const currentVendorId=String(vendor?.id||'');
  const owners=new Map();
  // These two lookups don't depend on each other -- running them one after
  // another (await inside the loop) meant every notifications open paid
  // for both round trips back to back instead of overlapping them.
  if (reuse && window.__notifRaw.owners) window.__notifRaw.owners.forEach((v, k) => owners.set(k, v));
  else await Promise.all([['product','products'],['package','vendor_packages']].map(async ([kind,table])=>{
    // Listing owners never change, so remember them for the whole session.
    const ownerCache=(window.__notifOwnerCache ||= new Map());
    const ids=[...new Set((rawItems||[]).map(n=>{const p=n.target_params||{},m=n.metadata||{};return kind==='product'?(p.productId||p.product_id||m.product_id):(p.packageId||p.package_id||m.package_id)}).filter(Boolean))];
    ids.forEach(id=>{const c=ownerCache.get(`${kind}:${id}`);if(c)owners.set(`${kind}:${id}`,c);});
    const missing=ids.filter(id=>!ownerCache.has(`${kind}:${id}`));
    if(!missing.length)return;
    const {data,error:ownerError}=await sb.from(table).select('id,vendor_id').in('id',missing);
    if(ownerError)console.warn('Notification ownership lookup failed',ownerError);
    (data||[]).forEach(r=>{const v=String(r.vendor_id);owners.set(`${kind}:${r.id}`,v);ownerCache.set(`${kind}:${r.id}`,v);});
  }));
  if (!reuse && Array.isArray(rawItems)) window.__notifRaw = { uid: session.user.id, at: Date.now(), items: rawItems, owners: new Map(owners) };
  const classifyNotification=n=>{
    const p=n.target_params||{},m=n.metadata||{},type=String(n.type||n.notification_type||n.notification_category||'').toLowerCase();
    const kind=String(m.kind||m.entity_type||n.notification_category||type).toLowerCase();
    const owner=String(n.vendor_id||m.vendor_id||p.vendorId||p.vendor_id||owners.get(`product:${p.productId||p.product_id||m.product_id}`)||owners.get(`package:${p.packageId||p.package_id||m.package_id}`)||'');
    if(m.order_id||p.orderId||p.order_id||/^(order|payment|request|offer)(_|$)/.test(type)||['orderDetail','buyerOrders','vendorOrders'].includes(n.target_view))return currentVendorId?'myListings':'orders';
    const listing=/product|listing|package|service|variant|variety|comment|like|save|wishlist/.test(kind)||!!p.productId||!!p.packageId;
    if(listing&&owner&&owner===currentVendorId)return 'myListings';
    if(owner&&owner!==currentVendorId&&(listing||/vendor/.test(kind)))return 'vendors';
    return 'personal';
  };
  const notificationTabs=[['all','All'],['personal','Personal'],...(profile?.role!=='admin'&&!vendor?.id?[['orders','Orders']]:[]),...(vendor?.id?[['myListings','My Listings']]:[]),['vendors','Vendors']];
  if(!notificationTabs.some(([key])=>key===notifViewMode))notifViewMode='all';
  const unreadByCategory={personal:0,orders:0,myListings:0,vendors:0};(rawItems||[]).forEach(n=>{if(!n.read){const c=classifyNotification(n);if(c in unreadByCategory)unreadByCategory[c]++;}});
  const tabHtml=(key,label)=>{const count=key==="all"?(rawItems||[]).filter(n=>!n.read).length:Number(unreadByCategory[key]||0);return `<button type="button" role="tab" aria-selected="${notifViewMode===key?"true":"false"}" class="notif-tab ${notifViewMode===key?"active":""}" onclick="switchNotifView('${key}')">${label}${count?`<span class="notif-tab-badge">${count>9?"9+":count}</span>`:""}</button>`};
  const items = (rawItems || []).filter((n) => {
    if (notifViewMode === "vendors") return classifyNotification(n) === "vendors";
    if (notifViewMode === "myListings") return classifyNotification(n) === "myListings";
    if (notifViewMode === "orders") return classifyNotification(n) === "orders";
    if (notifViewMode === "personal") return classifyNotification(n) === "personal";
    return true;
  });
  if (renderToken !== notifRenderEpoch || panel !== getNotifHost()) return;
  if (error) {
    // Do not turn a temporary database/network error into a fake empty state.
    // Keep the drawer honest and let the user retry by reopening/switching tabs.
    window.__notifPanelIds = [];
    panel.innerHTML = `<div class="notifications-page-tools"><strong>Notifications</strong></div><div class="notif-tabs">${notificationTabs.map(([key,label]) => `<button class="notif-tab ${notifViewMode === key ? "active" : ""}" onclick="switchNotifView('${key}')">${label}</button>`).join("")}</div><p class="muted" style="padding:1rem;text-align:center;">Couldn’t load notifications right now. Please try again.</p>`;
    panel.classList.toggle("selecting", false);
    return;
  }
  window.__notifPanelIds = (items || []).map((n) => n.id);

  const modeLabel = ({ all: "Notifications", personal: "Personal", orders: vendor?.id ? "Orders & Requests" : "Orders", myListings: "My Listings", vendors: "Vendors" })[notifViewMode] || "Notifications";
  const tabs = `<div class="notif-tabs" role="tablist" aria-label="Notification categories">${notificationTabs.map(([key,label])=>tabHtml(key,label)).join("")}</div>`;

  const isNotificationsPage = currentView === "notifications";
  const topBar = notifSelectMode
    ? `<div class="notif-select-bar">
        <button type="button" class="icon-btn" onclick="exitNotifSelectMode()" aria-label="Cancel selection"><i class="fa-solid fa-xmark"></i></button>
        <strong>${notifSelectedIds.size} selected</strong>
        <div class="notif-selection-actions">
          <button type="button" class="notif-action-btn" aria-label="${notifSelectedIds.size === (window.__notifPanelIds || []).length ? "Deselect all" : "Select all"}" title="${notifSelectedIds.size === (window.__notifPanelIds || []).length ? "Deselect all" : "Select all"}" onclick="toggleSelectAllNotifs()"><i class="fa-solid ${notifSelectedIds.size === (window.__notifPanelIds || []).length ? "fa-square-minus" : "fa-square-check"}"></i></button>
          <button type="button" class="notif-action-btn notif-selection-action" title="Mark read" onclick="batchMarkNotifsRead(true)" ${notifSelectedIds.size ? "" : "disabled"}><i class="fa-solid fa-envelope-open"></i></button>
          <button type="button" class="notif-action-btn notif-selection-action" title="Mark unread" onclick="batchMarkNotifsRead(false)" ${notifSelectedIds.size ? "" : "disabled"}><i class="fa-solid fa-envelope"></i></button>
        </div>
      </div>`
    : isNotificationsPage
      ? `${tabs}`
      : `<div class="drawer-header"><h4>${modeLabel}</h4>
        <div class="notif-header-actions">
          <button type="button" class="icon-btn" onclick="toggleInlineMenu('notifMoreMenu',event)" aria-label="Notification actions"><i class="fa-solid fa-ellipsis"></i></button>
          <button type="button" class="drawer-close-btn" onclick="closeAllPanels()" aria-label="Close"><i class='fa-solid fa-xmark'></i></button>
          <div class="ms-list hidden messages-more-menu" id="notifMoreMenu">
            <button type="button" class="ms-item" onclick="enterNotifSelectMode();toggleInlineMenu('notifMoreMenu',event)"><i class="fa-solid fa-check-double"></i> Select notifications</button>
            <button type="button" class="ms-item" onclick="enterNotifSelectMode();toggleSelectAllNotifs();toggleInlineMenu('notifMoreMenu',event)"><i class="fa-solid fa-square-check"></i> Select all notifications</button>

          </div>
        </div>
      </div>
      ${tabs}`;

  const emptyMsg = { all: "You're all caught up.", personal: "No personal notifications yet.", orders: vendor?.id ? "No order or request activity yet." : "No order activity yet.", myListings: "No activity on your listings yet.", vendors: "No vendor activity yet." }[notifViewMode] || "You're all caught up.";
  const hasUnread = (rawItems || []).some((n) => !n.read);
  const markAllBar = "";
  const list = (items && items.length)
    ? items.map((n) => `<div class="notif-item-wrap" data-id="${n.id}">
        <button type="button" class="notif-item ${n.read ? "" : "unread"} ${notifSelectMode && notifSelectedIds.has(n.id) ? "selected" : ""}" data-id="${n.id}" data-view="${esc(n.target_view || "home")}" data-params='${esc(JSON.stringify(n.target_params || {}))}' data-actor-name="${esc(n.actor_name || "")}" data-actor-avatar="${esc(n.actor_avatar_url || "")}" aria-selected="${notifSelectMode && notifSelectedIds.has(n.id) ? "true" : "false"}" onclick="handleNotifItemClick(event,'${n.id}')">
          ${notifSelectMode ? `<span class="notif-select-check"><i class="fa-solid fa-check"></i></span>` : ""}
          ${n.actor_avatar_url ? `<img src="${esc(n.actor_avatar_url)}" class="avatar-circle" style="width:2.1rem;height:2.1rem;object-fit:cover;flex:none;" />` : n.actor_name ? avatarFallbackHtml(n.actor_name, "2.1rem", "notification-avatar-fallback", n.actor_name, n.actor_id || n.actor_name) : notificationSystemIconHtml(n)}
          <span class="notif-copy"><strong style="display:block;">${esc(n.title)}</strong>${n.body ? `<span class="muted" style="font-size:0.8rem;">${esc(n.notification_category === "new_follower" ? (n.actor_name || n.body) : maskSensitiveNumbers(n.body))}</span><br/>` : ""}<span class="muted" style="font-size:0.72rem;">${timeAgo(n.created_at)}</span></span>
        </button>
      </div>`).join("")
    : `<p class="muted" style="padding:0.4rem;">${emptyMsg}</p>`;

  panel.innerHTML = `${topBar}${markAllBar}<div class="notif-list-scroll">${list}</div>`;
  // Keep unread styling visible while the notification surface is open; leaving the surface commits these IDs as read.
  queueVisibleNotificationReads();
  panel.classList.toggle("selecting", notifSelectMode);
  if (isNotificationsPage) {
    const actions = byId("notificationsPageHeaderActions");
    if (actions) actions.innerHTML = "";
  }
  } catch (err) {
    console.error("Notification rendering failed", err);
    if (renderToken !== notifRenderEpoch || panel !== getNotifHost()) return;
    window.__notifPanelIds = [];
    panel.innerHTML = '<p class="muted">Couldn’t load notifications right now. <button type="button" class="btn btn-outline" onclick="renderNotifPanel()">Try again</button></p>';
  }
}

async function handleNotifItemClick(event, id) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const clicked = event?.currentTarget;
  if (clicked?.dataset.longPressConsumed === '1') { delete clicked.dataset.longPressConsumed; return; }
  if (notifSelectMode) {
    toggleNotifSelect(String(id));
    return;
  }
  const item = event?.currentTarget || getNotifHost()?.querySelector(`.notif-item[data-id="${CSS.escape(String(id))}"]`);
  if (!item) return;
  let params = {};
  try { params = JSON.parse(item.dataset.params || "{}"); } catch (_) {}
  await queueNotificationRead(id);
  closeAllPanels();
  if ((item.dataset.view || "home") === "messages" && params?.conversationId) {
    const conversationId = String(params.conversationId);
    // Refresh the inbox snapshot first so the destination always has the
    // exact conversation and its latest messages, even after a cold start or
    // when the notification was generated while the inbox list was stale.
    try { await refreshConversationInboxInBackground(); } catch (_) {}
    try {
      const {data:latestMessagesDesc}=await sb.from('messages').select('*').eq('conversation_id',conversationId).order('created_at',{ascending:false}).limit(200);
      const latestMessages=Array.isArray(latestMessagesDesc)?latestMessagesDesc.slice().reverse():latestMessagesDesc;
      if(Array.isArray(latestMessages)) lastSeenMessagesByConv.set(conversationId,latestMessages);
    } catch (_) {}
    navigate('messages',{conversationId});
    return;
  }
  navigate(item.dataset.view || 'home', params);
}

function switchNotifView(mode) {
  const allowed = new Set(["all","personal","orders","myListings","vendors"]);
  if (!allowed.has(mode)) mode = "all";
  if (mode === "myListings" && !vendor?.id) mode = "personal";
  if (mode === "orders" && vendor?.id) mode = "myListings";
  notifViewMode = mode;
  exitNotifSelectMode(false);
  renderNotifPanel({ reuse: true });
}

function enterNotifSelectMode(id) {
  notifSelectMode = true;
  notifSelectedIds = id ? new Set([String(id)]) : new Set();
  renderNotifPanel();
}

function toggleNotifSelect(id) {
  if (!notifSelectMode) return;
  id = String(id);
  if (notifSelectedIds.has(id)) notifSelectedIds.delete(id);
  else notifSelectedIds.add(id);
  if (notifSelectedIds.size === 0) {
    exitNotifSelectMode();
    return;
  }
  const panel = getNotifHost();
  panel?.querySelectorAll(".notif-item").forEach((row) => {
    const selected = notifSelectedIds.has(String(row.dataset.id));
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", selected ? "true" : "false");
    row.querySelector(".notif-select-check")?.classList.toggle("active", selected);
  });
  const bar = panel?.querySelector(".notif-select-bar");
  const count = bar?.querySelector("strong");
  if (count) count.textContent = `${notifSelectedIds.size} selected`;
  const allVisible = getVisibleNotifIds().length > 0 && getVisibleNotifIds().every((x) => notifSelectedIds.has(String(x)));
  const selectAllBtn = bar?.querySelector("button[aria-label=\"Select all\"], button[aria-label=\"Deselect all\"]");
  if (selectAllBtn) {
    selectAllBtn.setAttribute("aria-label", allVisible ? "Deselect all" : "Select all");
    selectAllBtn.title = allVisible ? "Deselect all" : "Select all";
    const icon = selectAllBtn.querySelector("i");
    if (icon) icon.className = `fa-solid ${allVisible ? "fa-square-minus" : "fa-square-check"}`;
  }
  updateNotifSelectionActions();
}

// Tap outside the selected rows (or use browser back) to cancel batch selection.
// Toolbar controls remain interactive and are excluded from this dismissal.
function clearBatchSelectionOnOutsideTap(e) {
  const t = e?.target;
  if (!t || !msgSelectMode && !notifSelectMode) return;
  if (t.closest?.(".conv-list-item, .notif-item, .messages-selection-toolbar, .notif-select-bar")) return;
  if (t.closest?.(".modal, .drawer, .ai-chat-panel, input, textarea, select")) return;
  if (msgSelectMode) { msgSelectMode = false; msgSelectedIds.clear(); filterMsgList(); updateMsgSelectionBar(); }
  if (notifSelectMode) { notifSelectMode = false; notifSelectedIds.clear(); renderNotifPanel(); }
}
document.addEventListener("click", clearBatchSelectionOnOutsideTap);

function updateNotifSelectionActions() {
  const bar = getNotifHost()?.querySelector(".notif-select-bar");
  if (!bar) return;
  const hasSelection = notifSelectedIds.size > 0;
  bar.querySelectorAll(".notif-selection-action").forEach((btn) => {
    btn.disabled = !hasSelection;
    btn.setAttribute("aria-disabled", hasSelection ? "false" : "true");
  });
}

function getVisibleNotifIds() {
  return (window.__notifPanelIds || []).map(String);
}
function toggleSelectAllNotifs() {
  const allIds = getVisibleNotifIds();
  if (!allIds.length) return;
  const allSelected = allIds.every((id) => notifSelectedIds.has(String(id)));
  notifSelectMode = true;
  notifSelectedIds = allSelected ? new Set() : new Set(allIds.map(String));
  if (notifSelectedIds.size === 0) {
    exitNotifSelectMode();
    return;
  }
  renderNotifPanel();
}
function exitNotifSelectMode(rerender = true) {
  notifSelectMode = false;
  notifSelectedIds.clear();
  if (rerender) renderNotifPanel();
}

async function batchMarkNotifsRead(read) {
  const ids = [...notifSelectedIds].map(String);
  if (!ids.length) { showToast("Select at least one notification first.", "info"); return; }
  notifRenderEpoch++;
  const panel = getNotifHost();
  const rows = ids.map((id) => panel?.querySelector(`.notif-item[data-id="${CSS.escape(String(id))}"]`)).filter(Boolean);
  const oldUnread = new Map(rows.map((row) => [String(row.dataset.id), row.classList.contains("unread")]));
  rows.forEach((row) => { row.classList.toggle("unread", !read); row.classList.remove("selected"); row.setAttribute("aria-selected", "false"); });
  const count = ids.length;
  exitNotifSelectMode(false);
  showToast(`${count} notification${count === 1 ? "" : "s"} marked ${read ? "read" : "unread"}.`, "success");
  const { error } = await levroData.notifications.setRead(ids, read);
  if (error) {
    oldUnread.forEach((wasUnread, id) => panel?.querySelector(`.notif-item[data-id="${CSS.escape(String(id))}"]`)?.classList.toggle("unread", wasUnread));
    renderNotifPanel();
    showToast(error.message || "Couldn't update notifications.", "error");
  } else {
    refreshNotifications(false).catch(() => {});
  }
}





let markAllNotifsBusy=false;
async function markSingleNotifRead(id) { return queueNotificationRead(id); }

let notifChannelUserId=null;
function subscribeNotifications() {
  const userId=session?.user?.id||null;if(notifChannel&&notifChannelUserId===userId)return;notifChannelUserId=userId;
  if (notifChannel) { sb.removeChannel(notifChannel); notifChannel = null; }
  if (!session) return;
  notifChannel = sb.channel(`notifications-${session.user.id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` }, (payload) => {
      // A new-message notification for the chat that is already open on screen:
      // no pop-up, no sound (like WhatsApp) -- just pull the message into the
      // thread right away and quietly mark the notification as read.
      const nParams = payload.new.target_params || {};
      window.__convRawAt = 0;
      window.__ordCnt = null;
      if (String(payload.new.type || "") === "incoming_call") {
        try { window.__levroIncomingCall?.(payload.new); } catch (_) {}
        refreshNotifications(false);
        return;
      }
      if (String(payload.new.type || "") === "new_message" && currentView === "messages" && !document.hidden
          && activeConversationId && String(nParams.conversationId || "") === String(activeConversationId)) {
        try { window.__levroReconcileChatNow?.(); } catch (_) {}
        Promise.resolve(levroData.notifications.markRead(payload.new.id)).catch(() => {});
        refreshNotifications(false);
        return;
      }
      playNotificationSound(payload.new);
      try { if (!document.hidden) navigator.vibrate?.([150, 80, 150]); } catch (_) {}
      showToast(payload.new.title, "info");
      refreshNotifications();
      // An order was just completed: ask for the review right away.
      if (String(payload.new.type || "") === "order_status_changed") setTimeout(() => { try { window.maybePromptLevromartReview?.(true); } catch (_) {} }, 1500);
      // Vendor approval/rejection and admin promotion/demotion change the
      // account's authoritative role. Refresh it immediately so the user does
      // not have to close/reopen the app before navigation and permissions
      // reflect the new state.
      const roleChangingTypes = new Set(["vendor_approved", "vendor_rejected", "vendor_deleted", "promoted_admin", "demoted_admin"]);
      if (roleChangingTypes.has(String(payload.new.type || ""))) {
        refreshAuthState().then(() => {
          if (currentView === "vendorApply" && profile?.role === "vendor") navigate("vendorDashboard", {}, false);
          else if (["vendorDashboard", "vendorProducts", "vendorOrders", "vendorEditProfile", "vendorSuggestionsInbox"].includes(currentView) && profile?.role !== "vendor") navigate("home", {}, false);
        }).catch((e) => console.warn("[Levromart] Role-change refresh failed:", e));
      }
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'notifications',filter:`user_id=eq.${session.user.id}`},()=>refreshNotifications().catch(err=>console.warn('Notification refresh failed',err)))
    .subscribe(status=>{window.__notificationRealtimeStatus=status;if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Notification realtime unavailable',status);});
}
// Mobile browsers commonly suspend a backgrounded tab's websocket, and
// Postgres-changes realtime has no history to replay on reconnect -- any
// notification that arrived while the app was backgrounded is just gone
// from the live channel's point of view. That's why a notification could
// sit unseen until the person happened to open the notifications page
// (which does its own fresh fetch) instead of showing up the moment it
// was created. Catch up with a real fetch, and force a fresh channel
// (the stale one may still look "connected" while actually dead), every
// time the app comes back to the foreground.
document.addEventListener('visibilitychange',()=>{
  if(document.hidden||!session)return;
  refreshNotifications(false).catch(()=>{});
  notifChannelUserId=null;
  subscribeNotifications();
},{passive:true});

function invalidateMarketplaceState(){
  routeHtmlCache.clear();window.__homeBrowseCatalog=[];window.__allHomePackages=[];window.__homePackages=[];
  try{localStorage.removeItem(OFFLINE_HOME_CACHE_KEY);}catch(err){console.warn('Marketplace cache invalidation failed',err);}
}
let marketplaceLiveChannel=null,marketplaceLiveUser=null,marketplaceRefreshBusy=false,marketplaceRefreshAgain=false;
async function refreshMarketplaceRegions(){
  if(marketplaceRefreshBusy){marketplaceRefreshAgain=true;return;}marketplaceRefreshBusy=true;
  try{do{marketplaceRefreshAgain=false;const view=currentView;
    if(view==='home')await filterHomeProducts();
    if(view==='adminMonthlyListings'){
      const html=await renderAdminMonthlyListings();if(currentView===view){const tpl=document.createElement('template');tpl.innerHTML=html;
        document.querySelectorAll('#app [data-monthly-kind]').forEach(old=>{const next=tpl.content.querySelector(`[data-monthly-kind="${old.dataset.monthlyKind}"]`);if(next){next.classList.toggle('hidden',old.classList.contains('hidden'));old.replaceWith(next)}});
      }
    }
    if(view==='vendorProducts'){
      const host=document.querySelector('[data-vendor-listing-section="packages"]');if(host){const html=await renderVendorPackages(true);if(host.isConnected&&currentView===view)host.innerHTML=html;}
    }
    await refreshMonthlyPendingCount();
  }while(marketplaceRefreshAgain);}catch(err){console.warn('Marketplace realtime refresh failed',err);}finally{marketplaceRefreshBusy=false;}
}
// Marketplace realtime fires for ANY row change by ANY user. Re-fetching on every
// event multiplied traffic with the number of people online, so work is
// coalesced (one run per ~4s burst) and skipped while the tab is hidden (it
// runs once when the tab comes back).
let __mktTimer=null; const __mktPending=new Set();
function scheduleMarketplaceWork(kind){
  __mktPending.add(kind);
  if(document.hidden||__mktTimer)return;
  __mktTimer=setTimeout(()=>{
    __mktTimer=null;
    const kinds=[...__mktPending]; __mktPending.clear();
    if(kinds.includes('likes'))void hydrateProductLikeCountsInView();
    if(kinds.includes('variants'))void hydrateProductVariantIndicatorsInView();
    if(kinds.includes('regions'))void refreshMarketplaceRegions();
  },4000);
}
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&__mktPending.size&&!__mktTimer)scheduleMarketplaceWork('flush'); },{passive:true});
function subscribeMarketplaceUpdates(){
  const user=session?.user?.id||null;if(marketplaceLiveChannel&&marketplaceLiveUser===user)return;
  if(marketplaceLiveChannel){sb.removeChannel(marketplaceLiveChannel);marketplaceLiveChannel=null;}marketplaceLiveUser=user;if(!user)return;
  let channel=sb.channel(`marketplace-${user}`);
  for(const table of ['favorites','products','product_variants','vendor_packages','vendors','monthly_listing_submissions'])channel=channel.on('postgres_changes',{event:'*',schema:'public',table},payload=>{
    if(table==='favorites'){scheduleMarketplaceWork('likes');return;}
    invalidateMarketplaceState();
    if(table==='vendors'){const v=payload.new?.id?payload.new:payload.old;if(payload.eventType==='DELETE'||v.deleted_at||v.is_active===false)document.querySelectorAll(`[data-vendor-id="${CSS.escape(String(v.id))}"]`).forEach(el=>{if(el.classList.contains('vendor-card'))el.remove()});if(v.id===vendor?.id)refreshAuthState().catch(err=>console.warn('Vendor role refresh failed',err));}
    if(table==='product_variants')scheduleMarketplaceWork('variants');
    scheduleMarketplaceWork('regions');
  });
  marketplaceLiveChannel=channel.subscribe(status=>{window.__marketplaceRealtimeStatus=status;if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Marketplace realtime unavailable: check publication and RLS',status);});
}
