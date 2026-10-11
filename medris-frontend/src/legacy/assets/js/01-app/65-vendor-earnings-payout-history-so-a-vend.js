// ---------- VENDOR: EARNINGS (payout history, so a vendor can verify
// what Levromart has actually paid them against their own records) ----------
let vendorEarningsPeriod = "today";
const VENDOR_EARNINGS_PERIODS = { today: "Today", week: "This week", month: "This month", all: "All time" };
function vendorEarningsNet(totalAmount, commissionPct) {
  return Math.round(Number(totalAmount || 0) * (1 - commissionPct / 100));
}
// Paystack settles a subaccount split the next business day after the
// buyer's payment (T+1) - not whenever our own order status happened to
// change to "handed over". Weekends push it to the following Monday.
// This is our best estimate of when it actually lands, since Paystack
// doesn't send us a separate settlement webhook to confirm the exact date.
function estimatePayoutDate(paidAtStr) {
  if (!paidAtStr) return null;
  const d = new Date(paidAtStr);
  d.setDate(d.getDate() + 1);
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2);
  else if (day === 0) d.setDate(d.getDate() + 1);
  return d;
}
function vendorEarningsInPeriod(dateStr, period) {
  const d = new Date(dateStr);
  const now = new Date();
  if (period === "today") return d.toDateString() === now.toDateString();
  if (period === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);
    return d >= start;
  }
  if (period === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  return true;
}
async function renderVendorEarnings() {
  if (!session || profile?.role === "admin" || (profile?.role !== "vendor" && !vendor)) return '<div class="empty-state">Access denied.</div>';
  const { data: v } = await sb.from("vendors").select("*").eq("user_id", session.user.id).is("deleted_at", null).maybeSingle();
  if (!v) { navigate("vendorApply"); return '<p class="muted">Redirecting…</p>'; }
  vendor = v;
  vendorEarningsPeriod = "today";

  const { data: orders } = await sb.from("orders")
    .select("id, total_amount, order_type, payout_released_at, buyer:users(name), items:order_items(quantity, unit_price, product:products(name)), payments(created_at, status)")
    .eq("vendor_id", v.id).eq("payout_status", "released").not("payout_released_at", "is", null)
    .order("payout_released_at", { ascending: false });
  window.__vendorEarningsOrders = orders || [];
  // Completed sales (what the vendor has actually made), independent of payout timing.
  const { data: soldOrders } = await sb.from("orders")
    .select("id, total_amount, order_type, completed_at, status_changed_at, created_at, items:order_items(quantity, product:products(name))")
    .eq("vendor_id", v.id).eq("status", "completed").order("created_at", { ascending: false }).limit(1000);
  window.__vendorSoldOrders = (soldOrders || []).map((o) => ({ ...o, soldAt: o.completed_at || o.status_changed_at || o.created_at }));

  let html = `<h2 style="text-align:center;"><i class="fa-solid fa-sack-dollar"></i> Earnings</h2>
  <p class="muted" style="text-align:center;max-width:420px;margin:0 auto 1rem;">In and out, at a glance. Check this against your own records.</p>`;
  html += `<div class="segmented-tabs" id="vendorEarningsTabs">
    ${Object.entries(VENDOR_EARNINGS_PERIODS).map(([p, label]) => `<button class="${p === "today" ? "active" : ""}" data-earn-period="${p}" onclick="switchVendorEarningsPeriod('${p}')">${label}</button>`).join("")}
  </div>`;
  html += `<input type="text" placeholder="Search earnings…" style="max-width:320px;margin-top:0.8rem;" oninput="filterTableRowsBySearch(this,'.vendorEarningsTableWrap')" />`;
  html += `<div id="vendorEarningsBody" style="margin-top:1.2rem;"></div>`;
  setTimeout(renderVendorEarningsBody, 0);
  return html;
}
function switchVendorEarningsPeriod(period) {
  vendorEarningsPeriod = period;
  document.querySelectorAll("#vendorEarningsTabs [data-earn-period]").forEach((btn) => btn.classList.toggle("active", btn.dataset.earnPeriod === period));
  renderVendorEarningsBody();
}
function renderVendorEarningsBody() {
  const body = byId("vendorEarningsBody");
  if (!body) return;
  const all = window.__vendorEarningsOrders || [];
  const withDates = all.map((o) => {
    const paidTimestamps = (o.payments || []).filter((p) => p.status === "paid").map((p) => p.created_at).sort();
    const buyerPaidAt = paidTimestamps[0] || null;
    const payoutDate = estimatePayoutDate(buyerPaidAt) || new Date(o.payout_released_at);
    return { ...o, buyerPaidAt, payoutDate };
  });
  const filtered = withDates.filter((o) => vendorEarningsInPeriod(o.payoutDate, vendorEarningsPeriod));
  const commissionPct = Number(vendor.commission_pct ?? 3);

  // ---- Sales summary + chart for the selected period (completed orders)
  const sales = (window.__vendorSoldOrders || []).filter((o) => vendorEarningsInPeriod(o.soldAt, vendorEarningsPeriod));
  const salesTotal = sales.reduce((n, o) => n + Number(o.total_amount || 0), 0);
  const periodLabel = VENDOR_EARNINGS_PERIODS[vendorEarningsPeriod];
  const chartRange = vendorEarningsPeriod === "all" ? "all" : vendorEarningsPeriod;
  const salesHtml = `<div class="earn-stats"><div class="earn-stat"><span>Sales · ${esc(periodLabel.toLowerCase())}</span><b>${naira(salesTotal)}</b></div><div class="earn-stat"><span>Completed orders</span><b>${sales.length}</b></div></div>
    <div id="earnChart" class="earn-chart"></div>
    ${sales.length ? `<h3 class="earn-h">Completed sales</h3><div class="earn-list">${sales.slice(0, 60).map((o) => { const names = (o.items || []).map((it) => `${esc(it.product?.name || "Item")} ×${it.quantity}`).join(", ") || (o.order_type === "rental" ? "Rental" : "Sale"); return `<button type="button" class="earn-row" onclick="navigate('orderDetail',{orderId:'${o.id}',source:'sales'})"><span class="earn-row-main"><strong>${names}</strong><small>${esc(new Date(o.soldAt).toLocaleDateString("en-NG", { weekday: "short", month: "short", day: "numeric" }))}</small></span><b>${naira(o.total_amount)}</b></button>`; }).join("")}</div>` : `<div class="empty-state">No sales in this period yet.</div>`}`;
  const drawChart = () => { const host = byId("earnChart"); if (host) host.appendChild(buildRevenueChart(sales.map((o) => ({ created_at: o.soldAt, total_amount: o.total_amount })), chartRange, { field: "total_amount", label: `Sales · ${periodLabel.toLowerCase()}` })); };

  if (!filtered.length) { body.innerHTML = salesHtml; drawChart(); return; }

  const periodTotal = filtered.reduce((s, o) => s + vendorEarningsNet(o.total_amount, commissionPct), 0);
  let html = salesHtml + `<h3 class="earn-h">Payouts</h3><div class="stat" style="max-width:280px;margin:0 auto 1.4rem;"><div class="n">${naira(periodTotal)}</div><div class="muted">Paid to you · ${VENDOR_EARNINGS_PERIODS[vendorEarningsPeriod].toLowerCase()}</div></div>`;

  const byDate = new Map();
  filtered.forEach((o) => {
    const dateKey = o.payoutDate.toLocaleDateString("en-NG", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(o);
  });

  byDate.forEach((dayOrders, dateKey) => {
    const dayTotal = dayOrders.reduce((s, o) => s + vendorEarningsNet(o.total_amount, commissionPct), 0);
    html += `<div class="category-group-header flex" style="justify-content:space-between;">
      <span>${esc(dateKey)}</span><span>${naira(dayTotal)}</span>
    </div>`;
    html += `<div class="table-wrap vendorEarningsTableWrap"><table class="data-table"><thead><tr><th>Item(s)</th><th>Customer</th><th style="text-align:center;"><i class="fa-solid fa-arrow-down" style="color:#16a34a;"></i> Customer paid</th><th style="text-align:center;"><i class="fa-solid fa-arrow-up" style="color:var(--primary);"></i> Paid to you</th><th style="text-align:center;">Amount</th></tr></thead><tbody>`;
    dayOrders.forEach((o) => {
      const items = (o.items || []).map((it) => `${esc(it.product?.name || "Item")} ×${it.quantity}`).join(", ") || (o.order_type === "rental" ? "Rental" : "Sale");
      html += `<tr onclick="navigate('orderDetail',{orderId:'${o.id}',source:'sales'})" style="cursor:pointer;">
        <td>${items}</td>
        <td>${esc(o.buyer?.name || "-")}</td>
        <td style="text-align:center;">${o.buyerPaidAt ? esc(formatEarningsDateTime(o.buyerPaidAt)) : '<span class="muted">-</span>'}</td>
        <td style="text-align:center;">${esc(o.payoutDate.toLocaleDateString("en-NG", { weekday: "short", month: "short", day: "numeric" }))}</td>
        <td style="text-align:center;">${naira(vendorEarningsNet(o.total_amount, commissionPct))}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  });

  html += `<p class="muted" style="font-size:0.76rem;text-align:center;margin-top:0.8rem;">Estimated amounts, after Levromart's ${commissionPct}% commission, before Paystack's own fee, so the actual amount may be a touch lower.</p>`;
  body.innerHTML = html;
  drawChart();
}
function formatEarningsDateTime(dateStr) {
  return new Date(dateStr).toLocaleString("en-NG", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

