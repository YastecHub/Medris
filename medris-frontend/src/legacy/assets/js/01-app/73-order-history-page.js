// ---------- ORDER HISTORY PAGE ----------
// A real page (not a cramped popup): search box + All / Completed / Cancelled
// tabs over the finished orders the Orders page already loaded. Filtering is
// done on that in-memory list, so typing never costs a request.
function rememberOrderHistory(key, orders, isCustomerView, source) {
  (window.__orderHistoryData ||= {})[key] = { orders: orders || [], isCustomerView, source, at: Date.now() };
  window.__orderHistoryCtx = key;
}
function openOrderHistory() {
  navigate("orderHistory", { perspective: window.__orderHistoryCtx || "" });
}
async function renderOrderHistoryPage(perspective) {
  if (!session) return '<div class="empty-state">Please log in.</div>';
  const key = perspective === "sales" || perspective === "purchases" ? perspective : "";
  let data = window.__orderHistoryData?.[key];
  if (!data || Date.now() - data.at > 2 * 60 * 1000) {
    // Opened directly (refresh / deep link) or the list is stale: rebuild it
    // with the same renderer the Orders page uses, which refills the cache.
    try {
      if (key === "sales") await renderVendorOrders("all", "all", "all", "", "");
      else await renderCustomerOrders("all", "all", "all", "", "", key === "purchases");
    } catch (_) {}
    data = window.__orderHistoryData?.[key];
  }
  const orders = data?.orders || [];
  window.__orderHistoryPage = { ...(data || { isCustomerView: true, source: null }), orders, tab: "all", term: "" };
  let tries = 0;
  const paintWhenReady = () => { if (byId("orderHistoryPageList")) paintOrderHistoryList(); else if (tries++ < 20) requestAnimationFrame(paintWhenReady); };
  requestAnimationFrame(paintWhenReady);
  const count = (st) => orders.filter((o) => (st === "all" ? true : o.status === st)).length;
  const tab = (id, label) => `<button type="button" class="catalog-type-tab order-history-tab ${id === "all" ? "active" : ""}" data-tab="${id}" onclick="setOrderHistoryTab('${id}')">${label} <span class="tab-count">(${count(id)})</span></button>`;
  return `<div class="order-history-page">
    <div class="orders-title-row"><h2>Order history</h2></div>
    <div class="order-history-search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input type="search" id="orderHistoryPageSearch" placeholder="Search by product, shop or order…" autocomplete="off" enterkeyhint="search" oninput="scheduleOrderHistoryFilter()" /></div>
    <div class="catalog-type-tabs order-history-tabs" role="tablist">${tab("all", "All")}${tab("completed", "Completed")}${tab("cancelled", "Cancelled")}</div>
    <div id="orderHistoryPageList"></div>
  </div>`;
}
function setOrderHistoryTab(id) {
  if (!window.__orderHistoryPage) return;
  window.__orderHistoryPage.tab = id;
  document.querySelectorAll(".order-history-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  paintOrderHistoryList();
}
let orderHistoryFilterTimer = null;
function scheduleOrderHistoryFilter() {
  clearTimeout(orderHistoryFilterTimer);
  orderHistoryFilterTimer = setTimeout(() => {
    if (window.__orderHistoryPage) window.__orderHistoryPage.term = String(byId("orderHistoryPageSearch")?.value || "").trim().toLowerCase();
    paintOrderHistoryList();
  }, 120);
}
function paintOrderHistoryList() {
  const st = window.__orderHistoryPage;
  const host = byId("orderHistoryPageList");
  if (!st || !host) return;
  const words = st.term.split(/\s+/).filter(Boolean);
  const rows = st.orders.filter((o) => (st.tab === "all" || o.status === st.tab) && (!words.length || words.every((w) => orderHistorySearchText(o, st.isCustomerView).includes(w))));
  host.innerHTML = rows.length
    ? orderHistoryInnerHtml(rows, st.isCustomerView, st.source)
    : `<div class="empty-state orders-empty"><span class="orders-empty-icon"><i class="fa-solid fa-clock-rotate-left"></i></span><strong>${st.orders.length ? "No matching orders" : "No finished orders yet"}</strong><span class="muted">${st.orders.length ? "Try a different word or tab." : "Completed and cancelled orders will appear here."}</span></div>`;
}

function toggleOrdersMore(btn) {
  const wrap = btn?.closest?.(".orders-more-wrap");
  const menu = wrap?.querySelector(".orders-more-menu");
  if (!menu) return;
  const open = menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !open);
  wrap.querySelector(".orders-icon-btn")?.setAttribute("aria-expanded", String(open));
}
document.addEventListener("click", (e) => {
  if (e.target.closest?.(".orders-more-wrap")) return;
  document.querySelectorAll(".orders-more-menu:not(.hidden)").forEach((m) => m.classList.add("hidden"));
});

