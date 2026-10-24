// ---------- LIVE ORDERS ----------
let ordersLiveChannel = null;
let ordersLiveTimer = null;
let ordersLiveRefreshTimer = null;
let lastOrderScrollAt = 0;
let orderScrollWatchBound = false;
function ensureOrderScrollWatch() {
  if (orderScrollWatchBound) return;
  window.addEventListener("scroll", () => { lastOrderScrollAt = performance.now(); }, { passive:true });
  orderScrollWatchBound = true;
}
function refreshVisibleOrderView(force) {
  // Called by event handlers with an event object: only an explicit `true` forces a redraw.
  force = force === true;
  if (!["vendorOrders", "buyerOrders", "orderDetail", "orderHistory"].includes(currentView)) return;
  clearTimeout(ordersLiveRefreshTimer);

  const savedView = currentView;
  const savedParams = { ...(currentViewParams || {}) };

  // An open order detail is a live transaction surface. Do not wait for
  // scrolling to settle or for another timer: a status/payment change should
  // repaint immediately so the buyer/vendor sees the next step at once.
  if (savedView === "orderDetail") {
    ordersLiveRefreshTimer = setTimeout(async () => {
      if (currentView !== savedView) return;
      if (userIsTypingInApp()) { ordersLiveRefreshTimer = setTimeout(() => refreshVisibleOrderView(force), 2500); return; }
      try {
        if (!force && !(await orderViewChangedSince())) return;   // nothing about this order changed: no redraw, no flicker
        await navigate(savedView, { ...(currentViewParams || savedParams) }, false);   // the page as it is NOW, never as it was when the event arrived
      } catch (err) {
        console.warn("[Levromart] Live order-detail refresh failed:", err);
      }
    }, 0);
    return;
  }

  // Order lists still wait briefly for an active scroll gesture so a realtime
  // event cannot make iOS jump while the customer/vendor is reading history.
  ensureOrderScrollWatch();
  const waitForScrollToSettle = () => {
    if (currentView !== savedView) return;
    const elapsed = performance.now() - lastOrderScrollAt;
    if (elapsed < 350) {
      ordersLiveRefreshTimer = setTimeout(waitForScrollToSettle, Math.max(80, 350 - elapsed));
      return;
    }
    ordersLiveRefreshTimer = setTimeout(async () => {
      if (currentView !== savedView) return;
      try { if (!force && !(await orderViewChangedSince())) return; } catch (_) {}   // same orders as on screen: leave the page alone
      if (currentView !== savedView) return;
      document.body.classList.add("orders-refreshing");
      // The tab and filters chosen NOW, not the ones from when the live event arrived: otherwise a tap on another tab made just
      // before the refresh was undone and the list flipped back (the "twitching" between All / Confirmed / Pending).
      try { await navigate(savedView, { ...(currentViewParams || savedParams) }, false); }
      finally { requestAnimationFrame(() => document.body.classList.remove("orders-refreshing")); }
    }, 50);
  };
  waitForScrollToSettle();
}
let ordersVisibilityRefreshBound = false;
function handleOrdersVisibilityRefresh() {
  if (document.hidden || !["vendorOrders","buyerOrders","orderDetail","orderHistory","requestEquipment","vendorRequests"].includes(currentView)) return;
  clearTimeout(ordersLiveRefreshTimer);
  ordersLiveRefreshTimer = setTimeout(refreshAllLiveViews, 250);
}

// True while the person is typing into a field on the page. A live repaint would wipe what they have typed, so it waits.
function userIsTypingInApp() {
  const a = document.activeElement;
  if (!a || !a.closest || !a.closest("#app")) return false;
  const t = a.tagName;
  if (t === "TEXTAREA" || t === "SELECT") return String(a.value || "").length > 0;
  if (t === "INPUT") return !["button", "submit", "checkbox", "radio", "range", "file", "hidden"].includes(a.type) && String(a.value || "").length > 0;
  return false;
}
let requestsLiveTimer = null;
function refreshVisibleRequestView(tries) {
  const v = currentView;
  if (!["requestEquipment", "vendorRequests", "adminDisputes"].includes(v)) return;
  clearTimeout(requestsLiveTimer);
  const params = { ...(currentViewParams || {}) };
  requestsLiveTimer = setTimeout(async () => {
    if (currentView !== v) return;
    if (userIsTypingInApp() && (tries || 0) < 20) { refreshVisibleRequestView((tries || 0) + 1); return; }
    try { await navigate(v, params, false); } catch (err) { console.warn("[Levromart] Live request refresh failed:", err); }
  }, tries ? 2500 : 300);
}
function refreshAllLiveViews() { refreshVisibleOrderView(); refreshVisibleRequestView(0); }

// Safety net for a dropped or sleeping socket: while an order screen is open, a tiny query compares a fingerprint of
// the order(s) every few seconds and repaints only when something really changed (status, payment, proposal...).
let orderSignatureTimer = null;
const __orderSigs = new Map();
async function currentOrderSignature() {
  const uid = session?.user?.id; if (!uid) return null;
  if (currentView === "orderDetail") {
    const id = currentViewParams?.orderId; if (!id) return null;
    const [o, pays] = await Promise.all([
      sb.from("orders").select("status,status_changed_at,payment_unresolved_at,completed_at,cancelled_at,quantity_proposal,total_amount,payment_timing,delivery_fee").eq("id", id).maybeSingle(),
      sb.from("payments").select("id,status,amount").eq("order_id", id),
    ]);
    if (o.error) return null;
    return "d:" + id + JSON.stringify(o.data || {}) + JSON.stringify((pays.data || []).map((x) => [x.id, x.status, x.amount]));
  }
  if (["buyerOrders", "vendorOrders", "orderHistory"].includes(currentView)) {
    let q = sb.from("orders").select("id,status,status_changed_at,total_amount").order("created_at", { ascending: false }).limit(150);
    q = vendor?.id ? q.or(`buyer_id.eq.${uid},vendor_id.eq.${vendor.id}`) : q.eq("buyer_id", uid);
    const { data, error } = await q;
    if (error) return null;
    return "l:" + (data || []).map((r) => `${r.id}|${r.status}|${r.status_changed_at}|${r.total_amount}`).join(",");
  }
  return null;
}
// True when the orders/payments behind the open screen differ from what was last drawn (or nothing was recorded yet).
async function orderViewChangedSince() {
  const key = currentView + ":" + (currentViewParams?.orderId || "");
  const sig = await currentOrderSignature();
  if (sig == null) return true;
  const prev = __orderSigs.get(key);
  __orderSigs.set(key, sig);
  return prev === undefined || prev !== sig;
}
let orderPollTick = 0;
function startOrderSignaturePoll() {
  if (orderSignatureTimer) return;
  // Realtime does the instant work; this check only catches a dropped or sleeping connection. An open order is checked
  // every 4 seconds (the query is two tiny selects), order lists every 12.
  orderSignatureTimer = setInterval(async () => {
    if (document.hidden || !session) return;
    if (!["orderDetail", "buyerOrders", "vendorOrders", "orderHistory"].includes(currentView)) { __orderSigs.clear(); return; }
    if (currentView !== "orderDetail" && (++orderPollTick % 3) !== 0) return;
    const key = currentView + ":" + (currentViewParams?.orderId || "");
    try {
      const sig = await currentOrderSignature();
      if (sig == null) return;
      const prev = __orderSigs.get(key);
      __orderSigs.set(key, sig);
      if (prev !== undefined && prev !== sig) refreshVisibleOrderView(true);
    } catch (_) {}
  }, 4000);
}

let orderBadgeTimer = null;
// Any order change also moves the Orders badge and the pending counts in the profile menu.
function onOrderLiveEvent() {
  refreshVisibleOrderView();
  clearTimeout(orderBadgeTimer);
  orderBadgeTimer = setTimeout(() => { try { window.__ordCnt = null; refreshNotifications(false).then(() => { try { renderBottomNav(); } catch (_) {} }).catch(() => {}); } catch (_) {} }, 700);
}
let liveResubTimer = null;
let liveEverSubscribed = false;
function subscribeOrderUpdates() {
  for (const ch of (window.__liveAuxChannels || [])) { try { sb.removeChannel(ch); } catch (e) {} }
  window.__liveAuxChannels = [];
  if (ordersLiveChannel) { try { sb.removeChannel(ordersLiveChannel); } catch (e) {} ordersLiveChannel = null; }
  if (ordersLiveTimer) { clearInterval(ordersLiveTimer); ordersLiveTimer = null; }
  clearTimeout(liveResubTimer);
  if (!session) return;

  // Each group lives on its own channel: one table that cannot be streamed must never take the others down with it.
  const status = (name) => (st) => {
    window["__" + name + "RealtimeStatus"] = st;
    if (st === "SUBSCRIBED") {
      window.__liveResubTries = 0;
      // After a dropped connection nothing was replayed, so catch up straight away.
      if (liveEverSubscribed) refreshAllLiveViews();
      liveEverSubscribed = true;
    } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") {
      console.warn("[Levromart] Live updates (" + name + ") unavailable:", st);
      clearTimeout(liveResubTimer);
      // Back off (5 s, 10 s, 20 s ... up to 2 min) so a connection that cannot be made does not rebuild the channels and redraw the page over and over.
      window.__liveResubTries = Math.min((window.__liveResubTries || 0) + 1, 5);
      liveResubTimer = setTimeout(() => { if (session) subscribeOrderUpdates(); }, Math.min(120000, 5000 * 2 ** (window.__liveResubTries - 1)));
    }
  };
  const uid = session.user.id, stamp = Date.now();

  ordersLiveChannel = sb.channel(`orders-live-${uid}-${stamp}`);
  if (profile?.role !== "admin") {
    // A vendor can be a seller and a buyer at once, so listen on both sides.
    if (vendor?.id) ordersLiveChannel.on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `vendor_id=eq.${vendor.id}` }, onOrderLiveEvent);
    ordersLiveChannel.on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `buyer_id=eq.${uid}` }, onOrderLiveEvent);
  } else {
    ordersLiveChannel.on("postgres_changes", { event: "*", schema: "public", table: "orders" }, onOrderLiveEvent);
  }
  ordersLiveChannel.on("postgres_changes", { event: "*", schema: "public", table: "payments" }, onOrderLiveEvent);
  ordersLiveChannel.subscribe(status("orders"));

  const aux = sb.channel(`order-extras-${uid}-${stamp}`);
  for (const table of ["order_items", "order_notes", "service_offers", "disputes"]) aux.on("postgres_changes", { event: "*", schema: "public", table }, () => refreshVisibleOrderView(true));
  aux.subscribe(status("orderExtras"));

  const req = sb.channel(`requests-live-${uid}-${stamp}`);
  for (const table of ["equipment_requests", "request_offers", "disputes"]) req.on("postgres_changes", { event: "*", schema: "public", table }, () => refreshVisibleRequestView(0));
  req.subscribe(status("requests"));
  window.__liveAuxChannels = [aux, req];

  startOrderSignaturePoll();
  if (!ordersVisibilityRefreshBound) {
    document.addEventListener("visibilitychange", handleOrdersVisibilityRefresh, { passive:true });
    window.addEventListener("focus", handleOrdersVisibilityRefresh, { passive:true });
    window.addEventListener("online", refreshAllLiveViews, { passive:true });
    ordersVisibilityRefreshBound = true;
  }
}

