// ---------- VENDOR ORDER DETAILS (redesigned page) ----------
// Same data, same privacy rules and same actions as before: the customer stays anonymous
// until the vendor accepts, no phone numbers, no earnings maths here. Only the layout is new.
function vendorOrderTopHtml(order, ctx) {
  const isDelivery = order.delivery_method === "delivery";
  const isService = !!order.service_offer_id || (order.items || []).some((it) => it.product?.is_service);
  const isPackage = !!order.package_id;
  const isRental = order.order_type === "rental";
  const tone = odTone(order);
  const shortId = `#${String(order.id || "").slice(0, 8).toUpperCase()}`;
  const stageIdx = odStageIndex(order);
  const st = String(order.status || "");
  const v = order.vendor || {};
  const items = order.items || [];
  const img = (item) => {
    const src = item.product?.photos?.[0];
    return src ? `<img class="od-item-img" src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'od-item-img od-item-img-empty',innerHTML:'<i class=&quot;fa-solid fa-image&quot;></i>'}))">`
      : `<span class="od-item-img od-item-img-empty"><i class="fa-solid ${item.product?.is_service ? "fa-hand-holding-heart" : "fa-image"}"></i></span>`;
  };
  const typeLabel = isService ? "Service order" : isPackage ? "Package order" : isRental ? "Rental order" : "Sale order";
  // ---- header
  let h = `<div class="od-header"><button type="button" class="od-back" onclick="navigate('vendorOrders',{status:'all'})" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button>
    <div class="od-header-title"><strong>Order Details</strong><span>${esc(shortId)}</span></div>
    <div class="od-menu-wrap"><button type="button" class="od-more" onclick="toggleOrderDetailMenu(event)" aria-label="More"><i class="fa-solid fa-ellipsis"></i></button>
      <div class="od-menu hidden" id="odMenu"><button type="button" onclick="copyOrderId('${esc(order.id)}')"><i class="fa-regular fa-copy"></i> Copy order ID</button><button type="button" onclick="openOrderIssueForm()"><i class="fa-solid fa-flag"></i> Report an issue</button></div></div></div>`;
  // ---- status card
  h += `<section class="od-card od-status od-tone-${tone}"><div class="od-status-icon"><i class="fa-solid ${tone === "cancelled" ? "fa-ban" : tone === "done" ? "fa-circle-check" : tone === "pending" ? "fa-hourglass-half" : tone === "paid" ? "fa-money-check-dollar" : "fa-box-open"}"></i></div>
    <div class="od-status-copy"><span class="od-kicker">Order Status</span><strong class="od-status-name">${esc(odStatusLabel(order))}</strong>${order.created_at ? `<span class="od-placed">${esc(typeLabel)} · ${esc(orderDateTimeStr(order.created_at))}</span>` : `<span class="od-placed">${esc(typeLabel)}</span>`}</div>
    <span class="od-pill od-pill-${tone}">${esc(odStatusLabel(order))}</span></section>`;
  // ---- state alert
  const alerts = {
    pending: { icon: "fa-hourglass-half", head: "Customer is waiting for your confirmation", body: "Confirm the order to see who they are and message them in the app, or decline it if you can't fulfil it." },
    confirmed: { icon: "fa-circle-check", head: "You accepted this order", body: ctx.feePaid ? "Payment is in. Get the order ready and hand it over." : "Waiting for the customer to pay you and report the payment." },
    handed_over: { icon: "fa-truck-fast", head: isDelivery ? "Order is out for delivery" : "Order handed over", body: isRental ? "Mark it returned once the equipment is back with you." : ctx.feePaid ? "Paid. Waiting for the customer to confirm they received it. Your money is sent to your bank once they confirm (or automatically after 24 hours)." : "The order completes once the customer confirms and payment is settled." },
    returned: { icon: "fa-rotate-left", head: "Equipment returned", body: "Waiting for the customer to confirm so the order can complete." },
    completed: { icon: "fa-circle-check", head: "Order completed", body: "This order is done. Thank you for selling on Levromart." },
    cancelled: { icon: "fa-circle-xmark", head: "This order was cancelled", body: "No further action is needed." },
    disputed: { icon: "fa-scale-balanced", head: "An issue was reported", body: "An admin is reviewing this order. Add your side of the story below." },
    payment_unresolved: { icon: "fa-hourglass-half", head: "Payment needs your attention", body: "Check your account and confirm or dispute the reported payment below." },
  };
  const al = order.__paymentUnresolved && st !== "cancelled" && st !== "completed" ? alerts.payment_unresolved : alerts[st];
  h += orderQtyProposalHtml(order, "vendor");
  if (al) h += `<section class="od-info od-vendor-alert od-tone-${order.__paymentUnresolved && st !== "cancelled" && st !== "completed" ? "unresolved" : tone}" role="status"><span class="od-info-icon"><i class="fa-solid ${al.icon}"></i></span><div><strong>${esc(al.head)}</strong><p>${esc(al.body)}</p></div></section>`;
  // ---- main actions (same handlers as before)
  if (st === "pending") {
    if (orderCanSuggestQuantity(order)) h += `<div class="od-actions"><button type="button" class="od-btn od-btn-soft" onclick="openSuggestQuantity('${esc(order.id)}')"><i class="fa-solid fa-arrows-rotate"></i> Suggest quantity</button></div>`;
    h += `<div class="od-actions od-actions-pair"><button type="button" class="od-btn od-btn-danger" onclick="vendorDeclineOrder('${esc(order.id)}','pending')"><i class="fa-regular fa-circle-xmark"></i> Decline Order</button><button type="button" class="od-btn od-btn-confirm" onclick="confirmOrderAsVendor('${esc(order.id)}')"><i class="fa-solid fa-check"></i> Confirm Order</button></div>`;
  } else if (st === "confirmed" && !orderIsFullyPaid(order)) {
    h += `<div class="od-actions"><button type="button" class="od-btn od-btn-outline-danger" onclick="vendorDeclineOrder('${esc(order.id)}','confirmed')"><i class="fa-regular fa-circle-xmark"></i> Cancel Order</button></div>`;
  } else if (st === "handed_over" && isRental) {
    h += `<div class="od-actions"><button type="button" class="od-btn od-btn-primary" onclick="updateOrderStatus('${esc(order.id)}','returned')"><i class="fa-solid fa-rotate-left"></i> Mark Returned</button></div>`;
  }
  // ---- customer information (anonymous until accepted)
  const mapReady = isDelivery && ctx.canSeeLocation && order.buyer_lat != null && order.buyer_lng != null;
  const distTxt = mapReady && v.lat != null && v.lng != null ? formatDistanceKm(haversineKm(Number(order.buyer_lat), Number(order.buyer_lng), Number(v.lat), Number(v.lng))) : "";
  h += `<section class="od-card order-buyer-card">`;
  if (ctx.accepted) {
    const nm = ctx.contact?.name || "Customer";
    h += `<div class="od-vendor">${avatarFallbackHtml(nm, "3.4rem", "od-vendor-logo", nm, order.buyer_id || nm)}
      <div class="od-vendor-copy"><strong>${esc(nm)}</strong><span class="od-muted">${isDelivery ? "Delivery" : "Pickup"} customer</span></div></div>`;
    h += `<div class="od-cust-actions">${ctx.chatWindowOpen ? `<button type="button" class="od-btn od-btn-light od-btn-small" onclick="messageCustomerFromOrder('${esc(order.id)}')" aria-label="Message customer"><i class="fa-regular fa-comment-dots"></i> Message</button>
      <button type="button" class="od-btn od-btn-light od-btn-small" onclick="callCustomerFromOrder('${esc(order.id)}')" aria-label="Call customer"><i class="fa-solid fa-phone"></i> Call</button>` : ""}
      ${mapReady && v.lat != null && v.lng != null ? `<button type="button" class="od-btn od-btn-light od-btn-small order-buyer-location-btn" data-order-id="${esc(order.id)}" onclick="showOrderBuyerLocation('${esc(order.id)}',${Number(order.buyer_lat)},${Number(order.buyer_lng)},${Number(v.lat)},${Number(v.lng)})"><i class="fa-solid fa-location-dot"></i> <span class="order-buyer-location-btn-label">View Location</span>${distTxt ? ` <small class="od-dist">${esc(distTxt)}</small>` : ""}<i class="order-buyer-location-chevron fa-solid fa-chevron-down" style="font-size:.7em"></i></button>` : ""}</div>`;
    if (!ctx.chatWindowOpen) h += `<p class="od-muted od-closed-note"><i class="fa-regular fa-clock"></i> The in-app chat for this order closed 24 hours after completion.</p>`;
  } else if (st === "pending") {
    h += `<div class="od-anon"><span class="od-anon-ico"><i class="fa-solid fa-user-lock"></i></span><p>A customer has placed this order. Accept it to see who they are and message them in the app.</p></div>`;
    if (mapReady && v.lat != null && v.lng != null) h += `<div class="od-cust-actions"><button type="button" class="od-btn od-btn-light od-btn-small order-buyer-location-btn" data-order-id="${esc(order.id)}" onclick="showOrderBuyerLocation('${esc(order.id)}',${Number(order.buyer_lat)},${Number(order.buyer_lng)},${Number(v.lat)},${Number(v.lng)})"><i class="fa-solid fa-location-dot"></i> <span class="order-buyer-location-btn-label">View Location</span>${distTxt ? ` <small class="od-dist">${esc(distTxt)}</small>` : ""}<i class="order-buyer-location-chevron fa-solid fa-chevron-down" style="font-size:.7em"></i></button></div>`;
  } else {
    h += `<p class="od-muted" style="margin:0">Customer details are not available for this order.</p>`;
  }
  if (mapReady) h += `<div id="orderBuyerLocationWrap-${esc(order.id)}" class="order-buyer-location-wrap hidden"><div class="flex" style="justify-content:space-between;gap:.6rem;align-items:center;"><strong><i class="fa-solid fa-location-dot"></i> Delivery location</strong><span id="orderBuyerLocationStatus-${esc(order.id)}" class="muted"></span></div><div id="orderBuyerLocationMap-${esc(order.id)}" class="order-buyer-location-map"></div></div>`;
  h += `</section>`;
  // ---- progress tracker
  if (stageIdx >= 0) {
    h += `<section class="od-card od-tracker" aria-label="Order progress">${odStagesFor(order).map((s, i) => `<div class="od-step ${i < stageIdx ? "is-done" : i === stageIdx ? "is-current" : ""}"><span class="od-step-dot"><i class="fa-solid ${s.icon}"></i></span><span class="od-step-label">${esc(s.label(isDelivery))}</span>${i === 0 && order.created_at ? `<small>${esc(new Date(order.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</small>` : ""}</div>`).join("")}</section>`;
  }
  if (order.payout_status && order.payout_status !== "not_applicable") {
    h += `<section class="od-strip od-strip-card"><i class="fa-solid fa-shield-halved"></i><span>${esc(PAYOUT_STATUS_SHORT_LABEL[order.payout_status] || (typeof PAYOUT_STATUS_HELP[order.payout_status] === "function" ? PAYOUT_STATUS_HELP[order.payout_status](order.auto_release_at ? new Date(order.auto_release_at).toLocaleDateString("en-GB") : "the release date") : order.payout_status))}</span></section>`;
  }
  // ---- items (package / service orders get a row too)
  const rows = items.length ? items.map((item) => `<div class="od-item">${img(item)}<div class="od-item-copy"><strong>${esc(item.product?.name || "Item")}${item.variant?.name ? ` · ${esc(item.variant.name)}` : ""}</strong><span class="od-muted">Qty: ${Number(item.quantity || 1)}${item.rental_start_date ? ` · ${esc(item.rental_start_date)} → ${esc(item.rental_end_date)}` : ""}</span><b class="od-price">${naira(item.unit_price)}</b></div></div>`).join("")
    : `<div class="od-item"><span class="od-item-img od-item-img-empty"><i class="fa-solid ${isService ? "fa-hand-holding-heart" : "fa-box-open"}"></i></span><div class="od-item-copy"><strong>${esc(order.package?.name || (isService ? "Service" : "Order"))}</strong><span class="od-muted">${esc(typeLabel)}</span><b class="od-price">${naira(order.total_amount)}</b></div></div>`;
  h += `<section class="od-card"><div class="od-card-head"><h3>${isService ? "Service" : "Items"} (${items.length || 1})</h3></div>${rows}</section>`;
  // ---- order summary
  const paid = (order.payments || []).filter((p) => p.status === "paid");
  const reported = (order.payments || []).some((p) => p.status === "pending" && ["buyer_report", "service_offer_report"].includes(String(p.provider_reference || "").trim().toLowerCase()));
  const methodLabel = (() => {
    const m = String(paid[0]?.method || "").toLowerCase();
    if (m === "cash") return "Cash";
    if (m === "transfer") return "Bank transfer";
    if (m === "card") return "Card";
    if (paid.length) return "Paid";
    if (reported) return "Bank transfer (reported)";
    return ["pending", "cancelled"].includes(st) ? "Not paid yet" : "Customer pays you directly";
  })();
  const itemsSubtotal = Math.max(0, Number(order.total_amount || 0) - Number(order.delivery_fee || 0));
  h += `<section class="od-card"><h3>Order Summary</h3><div class="od-pay-grid">
    ${order.delivery_fee > 0 ? `<div><span class="od-muted">${isRental ? "Rental cost" : "Items"}</span><b>${naira(itemsSubtotal)}</b></div><div><span class="od-muted">Delivery fee</span><b>${naira(order.delivery_fee)}</b></div>` : ""}
    <div><span class="od-muted">Total</span><b class="od-price">${naira(order.total_amount)}</b></div>
    ${order.deposit_amount > 0 ? `<div><span class="od-muted">Refundable Deposit</span><b class="od-price">${naira(order.deposit_amount)}</b></div>` : ""}
    <div><span class="od-muted">Payment Method</span><b>${esc(methodLabel)}</b></div></div></section>`;
  // ---- delivery / pickup
  if (isDelivery) {
    const hasPin = order.buyer_lat != null && order.buyer_lng != null;
    const mapHref = hasPin ? `https://www.google.com/maps/search/?api=1&query=${order.buyer_lat},${order.buyer_lng}` : (order.delivery_address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.delivery_address)}` : "");
    h += `<section class="od-card"><div class="od-card-head"><h3><i class="fa-solid fa-location-dot"></i> Delivery Details</h3>${mapReady && v.lat != null && v.lng != null ? `<a class="od-link" href="#" onclick="openOrderLocationInApp('${esc(order.id)}');return false;"><i class="fa-solid fa-map"></i> View on Map <i class="fa-solid fa-chevron-right"></i></a>` : ""}</div>
      <div class="od-delivery"><div><span class="od-muted">Delivery to</span><strong>${esc(order.delivery_address || "Address not provided")}</strong></div>${distTxt ? `<div><span class="od-muted">Distance from your shop</span><strong>${esc(distTxt.replace(/ away$/, ""))}</strong></div>` : ""}</div></section>`;
  } else {
    const addr = [v.address, v.city].filter(Boolean).map(esc).join(", ");
    h += `<section class="od-card"><div class="od-card-head"><h3><i class="fa-solid fa-store"></i> ${isService ? "Service Delivery" : "Pickup Details"}</h3></div>
      <div class="od-delivery"><div><span class="od-muted">${isService ? "Where it happens" : "Customer collects from"}</span><strong>${addr || "Your shop address isn't set yet"}</strong></div></div></section>`;
  }
  // ---- customer note (only when there is one)
  if (order.buyer_note) h += `<section class="od-card od-note-card"><h3><i class="fa-regular fa-message"></i> Customer Note</h3><p>${esc(order.buyer_note)}</p></section>`;
  return h;
}
// Opens the in-app customer-location map (never leaves Levromart).
function openOrderLocationInApp(orderId) {
  const btn = document.querySelector(`.order-buyer-location-btn[data-order-id="${orderId}"]`);
  const wrap = byId(`orderBuyerLocationWrap-${orderId}`);
  if (btn && wrap?.classList.contains("hidden")) btn.click();
  setTimeout(() => (wrap || btn)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
}
function toggleOrderDetailMenu(e) { e?.stopPropagation?.(); byId("odMenu")?.classList.toggle("hidden"); }
document.addEventListener("click", (e) => { if (!e.target.closest?.(".od-menu-wrap")) byId("odMenu")?.classList.add("hidden"); });
async function copyOrderId(id) {
  byId("odMenu")?.classList.add("hidden");
  try { await navigator.clipboard.writeText(String(id)); showToast("Order ID copied.", "success"); } catch (_) { showToast(String(id), "info"); }
}
function openOrderIssueForm() {
  byId("odMenu")?.classList.add("hidden");
  const f = byId("disputeForm");
  if (f) { f.classList.remove("hidden"); f.scrollIntoView({ behavior: "smooth", block: "center" }); }
  else showToast("An issue is already open on this order.", "info");
}
async function renderOrderDetail(orderId, sourcePerspective = "") {
  if (!session) return '<div class="empty-state">Please log in.</div>';
  const { data: order, error } = await sb
    .from("orders")
    .select("*, vendor:vendors(id, business_name, phone, whatsapp_number, whatsapp_visible, address, city, opening_hours, user_id, lat, lng, logo_url, avg_rating, review_count, verification_status), items:order_items(*,variant:product_variants(name),product:products(name,photos,is_service)), payments(*), review:reviews(id), disputes(id, reason, status, admin_notes, vendor_response, created_at, raised_by, attachments), package:vendor_packages(name)")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return '<div class="empty-state">Order not found.</div>';

  const isCustomer = String(order.buyer_id || "") === String(session.user.id || "");
  // Do not rely only on the nested vendor:user_id relationship here. A vendor
  // can legitimately reach an order through the orders RLS policy even when
  // the nested relationship is omitted/null by a restrictive join or when the
  // global vendor object was refreshed through a different code path. Resolve
  // ownership directly against the vendor row before showing Access denied.
  let isVendor = String(order.vendor?.user_id || "") === String(session.user.id || "");
  if (!isVendor && vendor?.id && String(vendor.id) === String(order.vendor_id)) isVendor = true;
  if (!isVendor && profile?.role !== "admin") {
    try {
      const { data: ownedVendor } = await sb.from("vendors")
        .select("id,user_id,verification_status,deleted_at")
        .eq("id", order.vendor_id)
        .eq("user_id", session.user.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (ownedVendor?.id) {
        isVendor = true;
        if (!vendor || String(vendor.id) !== String(ownedVendor.id)) vendor = { ...(vendor || {}), ...ownedVendor };
      }
    } catch (_) { /* the server-side order/RLS checks remain authoritative */ }
  }
  if (!isCustomer && !isVendor && profile?.role !== "admin") return '<div class="empty-state">Access denied.</div>';

  if(order.service_offer_id){
    try{const {data:so}=await sb.from("service_offers").select("id,listing_id,buyer_id,vendor_id,status,current_price,description,round_count,payment_reported_at,order_id,expires_at").eq("id",order.service_offer_id).maybeSingle();order.__serviceOffer=so||null;}catch(_){order.__serviceOffer=null;}
  }
  const openPaymentDispute=(order.disputes||[]).find(d=>d.status==='open' && d.raised_by==='vendor');
  const pendingReportedPayment=(order.payments||[]).find(p=>p.status==='pending' && ['buyer_report','service_offer_report'].includes(String(p.provider_reference||'').trim().toLowerCase()));
  order.__paymentUnresolved=order.status==='payment_unresolved' || !!openPaymentDispute || !!pendingReportedPayment;

  const feeType = order.order_type === "sale" ? "sale_price" : "rental_fee";
  const paymentRows = Array.isArray(order.payments) ? order.payments : [];
  const feePaid = paymentRows.some((p) => String(p.payment_type || "").trim().toLowerCase() === feeType && p.status === "paid");
  const depositPaid = order.deposit_amount === 0 || paymentRows.some((p) => String(p.payment_type || "").trim().toLowerCase() === "deposit" && p.status === "paid");
  const isDeliveryOrder = order.delivery_method === "delivery";
  const paymentTiming = order.payment_timing === "pay_after" ? "pay_after" : "pay_before";
  const isPayAfterDelivery = isDeliveryOrder && paymentTiming === "pay_after";
  const deliveryBaseAmount = Math.max(0, Number(order.total_amount || 0) - Number(order.delivery_fee || 0));
  const deliveryDepositPercent = Math.max(1, Math.min(99, Number(order.payment_deposit_percent ?? 20) || 20));
  const deliveryRemainingPercent = 100 - deliveryDepositPercent;
  const deliveryDepositAmount = Math.round(deliveryBaseAmount * deliveryDepositPercent / 100 * 100) / 100;
  const deliveryDepositPaidAmount = paymentRows.filter((p) => String(p.payment_type || "").trim().toLowerCase() === "delivery_deposit_20" && p.status === "paid").reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const deliveryDepositPaid = deliveryDepositPaidAmount > 0.009;
  // buyer_report_manual_payment records the buyer's transfer as pending until
  // the vendor verifies it. The buyer should nevertheless move forward to the
  // remaining-balance screen immediately after tapping "I've paid" rather than waiting for
  // the vendor's manual confirmation. The payment remains pending server-side.
  const deliveryDepositReported = isCustomer && paymentRows.some((p) => String(p.payment_type || "").trim().toLowerCase() === "delivery_deposit_20" && p.status === "pending");
  const deliveryDepositReadyForBalance = deliveryDepositPaid;
  const deliveryBalanceAmount = Math.max(0, Number(order.total_amount || 0) - deliveryDepositPaidAmount - (deliveryDepositReported && deliveryDepositPaidAmount <= 0.009 ? Number(paymentRows.find((p) => String(p.payment_type || "").trim().toLowerCase() === "delivery_deposit_20" && p.status === "pending")?.amount || 0) : 0));
  const deliveryPaymentsComplete = !isDeliveryOrder || (isPayAfterDelivery ? (deliveryDepositPaid && feePaid) : feePaid);
  // Pickup keeps the existing full-payment flow. Delivery uses two stages:
  // The vendor-selected deposit percentage is paid first, then the remaining order balance.
  // record_offline_payment() (used below) only ever settles a *vendor-initiated*
  // cash/transfer record against an order that's still "confirmed"/"handed_over" --
  // it has no path back to "completed" and can't touch a buyer-reported claim.
  // A payment_unresolved order (the buyer already tapped "I've paid") is handled
  // by its own dedicated confirm/dispute card further down instead, which calls
  // the matching vendor_confirm_reported_payment/vendor_dispute_reported_payment
  // RPCs -- those are the ones that actually flip the order to completed.
  const canRecordPayment = isVendor && !deliveryPaymentsComplete && (order.status === "confirmed" || (isDeliveryOrder && order.status === "handed_over"));
  const canPayOnline = isCustomer && !deliveryPaymentsComplete && order.status === "confirmed";

  let html = `<div class="card">
    <div class="flex" style="justify-content:space-between;align-items:flex-start;">
      <div>
        <h2 style="margin:0;text-transform:capitalize;">${order.order_type} order</h2>
        <p class="muted" style="margin:0.15rem 0 0;">${isVendor ? "Customer order" : esc(order.vendor?.business_name || "")}${order.package?.name ? " · " + esc(order.package.name) : ""}</p>
      </div>
      <span class="badge order-status-badge ${order.__paymentUnresolved ? "order-status-badge-payment-unresolved" : lvOrderStageLabel(order) ? "order-status-badge-paid" : `order-status-badge-${esc(order.status)} ${orderStatusBadgeClass(order.status)}`}" style="text-transform:capitalize;flex-shrink:0;">${order.__paymentUnresolved ? "Payment unresolved" : (lvOrderStageLabel(order) || order.status.replace("_", " "))}</span>
    </div>
    ${order.created_at ? `<p class="muted" style="font-size:0.8rem;margin-top:0.7rem;"><i class="fa-solid fa-calendar-days"></i> Placed ${orderDateTimeStr(order.created_at)}</p>` : ""}
    ${isCustomer&&order.status==='pending'?`<div class="order-follow-up"><p class="muted order-follow-up-note"><em>Vendor hasn’t responded after 5–10 minutes? Tap “Remind vendor” and we’ll nudge them.</em></p><div class="order-follow-up-actions"><button type="button" class="btn btn-sm order-remind-btn" onclick="remindOrderVendor('${esc(order.id)}',this)" title="Send a reminder to the vendor"><i class="fa-solid fa-bell"></i> Remind vendor</button></div></div>`:''}
    ${isVendor&&order.status==='pending'?`<div class="banner banner-warning vendor-order-waiting-banner" style="margin-top:0.6rem;"><strong><i class="fa-solid fa-hourglass-half"></i> Customer waiting for confirmation.</strong><span>The customer is waiting for you to confirm this order.</span></div>`:''}
    ${isCustomer&&['confirmed','handed_over'].includes(order.status)&&!feePaid?`<div class="banner banner-warning payment-not-paid-yet-banner" style="margin-top:0.6rem;"><strong><i class="fa-solid fa-circle-exclamation"></i> Not paid yet.</strong><span>Complete the transfer to the vendor, then tap <strong>“I’ve paid the vendor”</strong> so the payment can be verified.</span></div>`:''}
    ${(order.status === "completed" || order.status === "cancelled") && orderActivityIso(order) ? `<p class="muted" style="font-size:0.8rem;margin-top:0.25rem;"><i class="fa-regular fa-clock"></i> ${esc(orderActivityLabel(order))}</p>` : ""}
    ${(!(isVendor&&order.status==='pending') && ORDER_STATUS_HELP[order.status])
      ? order.status === "pending"
        ? `<div class="banner banner-warning order-status-banner" style="margin-top:0.6rem;"><i class="fa-solid fa-hourglass-half order-status-icon"></i><span class="order-status-text">${esc(ORDER_STATUS_SHORT_LABEL[order.status] || ORDER_STATUS_HELP[order.status])}</span>${ORDER_STATUS_SHORT_LABEL[order.status] ? infoPopoverHtml("orderStatusInfo", esc(ORDER_STATUS_HELP[order.status])) : ""}</div>`
        : `<p class="muted" style="font-size:0.85rem;margin-top:0.4rem;">${esc(ORDER_STATUS_SHORT_LABEL[order.status] || ORDER_STATUS_HELP[order.status])} ${ORDER_STATUS_SHORT_LABEL[order.status] ? infoPopoverHtml("orderStatusInfo", esc(ORDER_STATUS_HELP[order.status])) : ""}</p>`
      : ""}
    ${order.payout_status && order.payout_status !== "not_applicable"
      ? `<div class="banner ${order.payout_status === "held" ? "banner-warning" : order.payout_status === "released" ? "banner-success" : "banner-muted"}" style="margin-top:0.6rem;"><i class="fa-solid fa-shield-halved"></i> ${esc(PAYOUT_STATUS_SHORT_LABEL[order.payout_status] || (PAYOUT_STATUS_HELP[order.payout_status] ? PAYOUT_STATUS_HELP[order.payout_status](order.auto_release_at ? new Date(order.auto_release_at).toLocaleDateString() : "") : order.payout_status))} ${PAYOUT_STATUS_SHORT_LABEL[order.payout_status] ? infoPopoverHtml("payoutStatusInfo", esc(PAYOUT_STATUS_HELP[order.payout_status](order.auto_release_at ? new Date(order.auto_release_at).toLocaleDateString() : ""))) : ""}</div>`
      : ""}
  </div>`;

  html += `<div class="card">
    <h3 style="margin-top:0;">Items</h3>
    ${order.items.map((item, i) => `<div style="${i > 0 ? "border-top:1px solid var(--border);padding-top:0.7rem;margin-top:0.7rem;" : ""}">
      <strong>${esc(item.product?.name || "")}${item.variant?.name ? ` · ${esc(item.variant.name)}` : ""}</strong>
      <p class="muted" style="margin:0.15rem 0 0;">Qty ${item.quantity} · ${naira(item.unit_price)}${item.rental_start_date ? ` · ${item.rental_start_date} → ${item.rental_end_date}` : ""}</p>
      ${isCustomer && order.status === "completed" && item.product_id && !orderHasReview(order) ? `<button type="button" class="btn btn-sm btn-outline" style="margin-top:0.4rem;" onclick="navigate('productDetail',{productId:'${item.product_id}',scrollToReviews:true})"><i class="fa-solid fa-star"></i> Rate this product</button>` : ""}
    </div>`).join("")}
    ${order.buyer_note ? `<div class="divider"></div><p style="margin:0;"><i class="fa-regular fa-message"></i> <strong>${isVendor ? "Customer's note" : "Your note"}:</strong> ${esc(order.buyer_note)}</p>` : ""}
    <div class="divider"></div>
    <div class="grid" style="grid-template-columns:repeat(2,1fr);gap:0.9rem;">
      ${order.delivery_fee > 0 ? `<div><p class="muted" style="margin:0;">Equipment cost</p><strong>${naira(order.total_amount - order.delivery_fee)}</strong></div>
      <div><p class="muted" style="margin:0;">Delivery fee</p><strong>${naira(order.delivery_fee)}</strong></div>` : ""}
      <div><p class="muted" style="margin:0;">Total</p><strong>${naira(order.total_amount)}</strong></div>
      ${order.deposit_amount > 0 ? `<div><p class="muted" style="margin:0;">Refundable deposit</p><strong>${naira(order.deposit_amount)}</strong></div>` : ""}
      <div><p class="muted" style="margin:0;">Delivery</p><strong style="text-transform:capitalize;">${order.delivery_method}${order.delivery_address ? " · " + esc(order.delivery_address) : ""}</strong>
      </div>
    </div>
    ${order.delivery_method === "delivery" && order.vendor?.lat != null && order.vendor?.lng != null ? `<p class="muted" id="orderEtaLine" style="font-size:0.8rem;margin-top:0.6rem;"></p>` : ""}
  </div>`;
  if (order.delivery_method === "delivery" && order.vendor?.lat != null && order.vendor?.lng != null) {
    window.__orderEtaVendor = { lat: order.vendor.lat, lng: order.vendor.lng };
    setTimeout(updateOrderDeliveryEta, 0);
  }

  // Customers get the redesigned page; vendors and admins keep the working layout below.
  const newView = isCustomer && !isVendor && profile?.role !== "admin";
  const chatOpenStates = ["confirmed", "payment_unresolved", "handed_over", "returned", "disputed"].includes(String(order.status || "")) || (order.status === "completed" && Date.now() - new Date(order.completed_at || order.status_changed_at || order.created_at || 0).getTime() < 24 * 3600 * 1000);
  if (newView) html = customerOrderTopHtml(order, { isCustomer, sourcePerspective, contactAllowed: chatOpenStates && !!order.vendor_id });
  if (isCustomer) html += orderQtyProposalHtml(order, "customer");
  // Vendors get the matching redesign. Privacy is unchanged: anonymous until accepted, name only after.
  const newVendorView = isVendor && !isCustomer && profile?.role !== "admin";
  const vAccepted = !["pending", "declined", "cancelled", "rejected"].includes(String(order.status || ""));
  const vChatWindowOpen = order.status !== "completed" || (Date.now() - new Date(order.completed_at || order.status_changed_at || order.created_at || 0).getTime() < 24 * 3600 * 1000);
  let vContact = {};
  if (isVendor && vAccepted) {
    try { const { data: contact } = await sb.rpc("get_order_buyer_contact", { p_order_id: orderId }); vContact = (contact && contact[0]) || {}; } catch (_) { vContact = {}; }
  }
  if (newVendorView) html = vendorOrderTopHtml(order, { accepted: vAccepted, chatWindowOpen: vChatWindowOpen, contact: vContact, feePaid, canSeeLocation: ["pending", "confirmed"].includes(String(order.status || "")) });

  if(order.__serviceOffer?.status==='payment_reported' && isVendor){
    html += `<div class="card service-payment-confirm-card"><h3><i class="fa-solid fa-hand-holding-dollar"></i> Service payment reported</h3><p class="muted">The buyer has reported a bank transfer of <strong>${naira(order.__serviceOffer.current_price)}</strong>. Check your account and either confirm receipt or dispute the payment.</p><div class="flex" style="gap:.55rem;flex-wrap:wrap;"><button type="button" class="btn btn-sm" onclick="confirmServiceOfferPayment('${order.__serviceOffer.id}')"><i class="fa-solid fa-check"></i> Confirm payment received</button><button type="button" class="btn btn-sm btn-danger" onclick="disputeServiceOfferPayment('${order.__serviceOffer.id}')"><i class="fa-solid fa-triangle-exclamation"></i> Dispute payment</button></div></div>`;
  } else if(order.__serviceOffer?.status==='payment_reported' && isCustomer){
    html += `<div class="card"><p class="muted"><i class="fa-solid fa-hourglass-half"></i> Payment reported. Waiting for the vendor to confirm receipt or raise a dispute. There is no automatic payment confirmation timer.</p></div>`;
  }
  const buyerReportedPayment=(order.payments||[]).filter(p=>p.status==='pending' && String(p.provider_reference||'').trim().toLowerCase()==='buyer_report').sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0];
  if(buyerReportedPayment && isVendor){
    const paymentLabel=buyerReportedPayment.payment_type==='delivery_deposit_20' ? 'delivery deposit' : buyerReportedPayment.payment_type==='rental_fee' ? 'rental fee' : buyerReportedPayment.payment_type==='deposit' ? 'refundable deposit' : 'payment';
    html += `<div class="card payment-confirmation-card"><div class="flex" style="justify-content:space-between;align-items:flex-start;gap:.7rem;"><div><h3 style="margin:0;"><i class="fa-solid fa-building-columns"></i> Payment reported</h3><p class="muted" style="margin:.35rem 0 0;">The customer says they transferred <strong>${naira(buyerReportedPayment.amount)}</strong> for the ${esc(paymentLabel)}. Check your bank account before confirming.</p></div><span class="badge payment-reported-badge">Awaiting confirmation</span></div><div class="payment-confirmation-actions"><button type="button" class="btn btn-sm payment-confirm-btn" onclick="confirmBuyerReportedPayment('${order.id}')"><i class="fa-solid fa-check"></i> Confirm payment</button><button type="button" class="btn btn-sm btn-danger" onclick="openBuyerPaymentDispute('${order.id}')"><i class="fa-solid fa-triangle-exclamation"></i> Raise dispute</button></div></div>`;
  } else if(buyerReportedPayment && isCustomer){
    html += `<div class="card payment-reported-customer-card"><div class="flex" style="gap:.55rem;align-items:flex-start;"><i class="fa-solid fa-hourglass-half" style="margin-top:.15rem;"></i><div><strong>Payment reported</strong><p class="muted" style="margin:.25rem 0 0;">Your payment of <strong>${naira(buyerReportedPayment.amount)}</strong> has been reported to the vendor. The order is now <strong>Payment unresolved</strong> until the vendor confirms receipt or raises a dispute.</p>${order.vendor_id ? `<div class="order-contact-row"><button type="button" class="btn btn-sm order-action-neutral order-message-vendor-btn" onclick="startConversationWithVendor('${order.vendor_id}')"><i class="fa-solid fa-message"></i> Message vendor</button><button type="button" class="btn btn-sm order-call-btn" onclick="callVendorFromOrder('${order.vendor_id}')"><i class="fa-solid fa-phone"></i> Call</button></div>` : ""}</div></div></div>`;
  }

  if (isVendor && !newVendorView) {
    // Until the vendor accepts, the customer stays anonymous: no name, no
    // phone, no messaging -- just that an order exists and where it's going.
    // After accepting, only the name and in-app messaging are shown; phone
    // numbers are never shown to vendors at all.
    const accepted = vAccepted;
    // Chats close 24h after an order completes, so no new in-app message after that.
    const chatWindowOpen = vChatWindowOpen;
    const c = vContact;
    html += `<div class="card order-buyer-card"><h3><i class="fa-solid fa-address-card"></i> Customer</h3>
      ${accepted ? `<p style="margin-bottom:.45rem;">${esc(c.name || "Customer")}</p>
      ${chatWindowOpen ? `<div class="flex order-buyer-contact-actions order-contact-row" style="gap:.6rem;align-items:center;">
        <button class="order-contact-icon-btn order-contact-message-btn" type="button" onclick="messageCustomerFromOrder('${orderId}')" title="Message customer" aria-label="Message customer"><i class="fa-solid fa-comment-dots"></i><span>Message</span></button>
        <button class="order-call-btn" type="button" onclick="callCustomerFromOrder('${orderId}')" title="Call customer" aria-label="Call customer"><i class="fa-solid fa-phone"></i><span>Call</span></button>
      </div>` : ""}` : (order.status === "pending" ? `<p class="muted" style="margin:0 0 .45rem;">A customer has placed this order. Accept it to see who they are and message them in the app.</p>` : `<p class="muted" style="margin:0 0 .45rem;">Customer details are not available for this order.</p>`)}
      ${isDeliveryOrder && (order.status === "pending" || order.status === "confirmed") && order.buyer_lat != null && order.buyer_lng != null && order.vendor?.lat != null && order.vendor?.lng != null ? `<button class="btn btn-sm btn-outline order-buyer-location-btn order-buyer-location-btn-yellow" type="button" data-order-id="${order.id}" onclick="showOrderBuyerLocation('${order.id}',${Number(order.buyer_lat)},${Number(order.buyer_lng)},${Number(order.vendor.lat)},${Number(order.vendor.lng)})"><i class="fa-solid fa-map-location-dot"></i> <span class="order-buyer-location-btn-label">View customer location</span> <span class="muted" style="font-size:.8em;">(~${formatDistanceKm(haversineKm(Number(order.buyer_lat),Number(order.buyer_lng),Number(order.vendor.lat),Number(order.vendor.lng)))})</span> <i class="order-buyer-location-chevron fa-solid fa-chevron-down" style="font-size:.75em;"></i></button>` : ""}
      ${isDeliveryOrder && isVendor && order.buyer_lat != null && order.buyer_lng != null ? `<div id="orderBuyerLocationWrap-${order.id}" class="order-buyer-location-wrap hidden"><div class="flex" style="justify-content:space-between;gap:.6rem;align-items:center;"><strong><i class="fa-solid fa-location-dot"></i> Delivery location</strong><span id="orderBuyerLocationStatus-${order.id}" class="muted"></span></div><div id="orderBuyerLocationMap-${order.id}" class="order-buyer-location-map"></div></div>` : ""}
    </div>`;
  }

  if (order.delivery_method === "pickup" && isCustomer && !newView) {
    const addr = [order.vendor?.address, order.vendor?.city].filter(Boolean).map(esc).join(", ");
    html += `<div class="card"><h3><i class="fa-solid fa-location-dot"></i> Pickup location</h3>
      ${addr ? `<p>${addr}</p>` : `<p class="muted">This vendor hasn't listed a pickup address yet. Message them to confirm where to collect your order.</p>`}
      ${order.vendor?.opening_hours ? `<p class="muted" style="font-size:0.85rem;"><i class="fa-solid fa-clock"></i> ${esc(order.vendor.opening_hours)}</p>` : ""}
      ${["confirmed", "payment_unresolved", "handed_over", "returned", "disputed"].includes(String(order.status || "")) ? `<div class="order-vendor-message-wrap pickup-message-vendor-wrap">
        <button class="btn btn-sm order-message-vendor-btn" type="button" data-draft="${esc(pickupMessageDraft(order))}" onclick="startConversationWithVendor('${order.vendor.id}', this.dataset.draft)" aria-label="Message vendor to confirm pickup" title="Message vendor to confirm pickup">
          <i class="fa-solid fa-comment-dots"></i> Message vendor to confirm pickup
        </button>
      </div>` : ""}
    </div>`;
  }

  // A payment type can have more than one database row because an online
  // payment attempt may be created as pending before a vendor records the
  // same fee as paid outside Paystack. The order UI should show the current
  // payment state once, not expose every historical attempt as another
  // "Sale price" line. A paid row always wins over pending attempts; when
  // nothing is paid, show the newest pending attempt.
  const displayPayments = (() => {
    // A payment type represents one obligation on this order. Paystack can
    // leave one or more pending attempts behind, while a vendor may later
    // settle that same obligation manually. Never render those attempts as
    // multiple "Sale price" lines. Normalize the type before grouping so
    // legacy/case-variant rows cannot bypass the UI guard. A paid row always
    // wins over pending attempts; if several paid rows somehow exist, show
    // only the newest paid record.
    const grouped = new Map();
    for (const payment of (order.payments || [])) {
      const key = String(payment.payment_type || "").trim().toLowerCase();
      if (!key) continue;
      const current = grouped.get(key);
      const paymentTime = new Date(payment.paid_at || payment.created_at || 0).getTime();
      const currentTime = current ? new Date(current.paid_at || current.created_at || 0).getTime() : -1;
      const shouldReplace = !current
        || (payment.status === "paid" && current.status !== "paid")
        || (payment.status === current.status && paymentTime > currentTime);
      if (shouldReplace) grouped.set(key, payment);
    }
    return Array.from(grouped.values());
  })();
  if (displayPayments.length > 0) {
    html += `<div class="card"><h3 style="margin-top:0;">Payments</h3>
      ${displayPayments.map((p, i) => {
        const paymentName = p.payment_type === "sale_price" ? "Sale price" : p.payment_type === "rental_fee" ? "Rental fee" : p.payment_type === "deposit" ? "Refundable deposit" : p.payment_type === "delivery_deposit_20" ? `${deliveryDepositPercent}% delivery deposit` : String(p.payment_type || "Payment").replace(/_/g, " ");
        const methodName = p.method === "cash" ? "Cash" : p.method === "transfer" ? "Bank transfer" : p.method === "card" ? "Card" : "";
        const buyerReportedPending = isCustomer && p.status === "pending" && String(p.provider_reference || "").trim().toLowerCase() === "buyer_report";
        const displayPaymentStatus = buyerReportedPending ? "Reported" : p.status;
        const displayPaymentStatusClass = buyerReportedPending || p.status === "paid" ? "success" : "";
        return `<div class="flex" style="justify-content:space-between;font-size:0.9rem;${i > 0 ? "border-top:1px solid var(--border);padding-top:0.5rem;margin-top:0.5rem;" : ""}"><span>${esc(paymentName)}${(p.status === "paid" || buyerReportedPending) && methodName ? `<small class="muted" style="display:block;font-size:0.75rem;margin-top:0.15rem;">${esc(methodName)} · ${buyerReportedPending ? "Awaiting vendor confirmation" : (p.provider_reference ? "Paystack" : "Recorded manually")}</small>` : ""}</span><span>${naira(p.amount)} · <span class="badge ${displayPaymentStatusClass}">${esc(displayPaymentStatus)}</span></span></div>`;
      }).join("")}
    </div>`;
  }

  if (canPayOnline) {
    const payableAmount = isPayAfterDelivery
      ? (deliveryDepositReadyForBalance ? deliveryBalanceAmount : deliveryDepositAmount)
      : (feePaid ? Number(order.deposit_amount || 0) : Number(order.total_amount || 0));
    html += `<div class="card ${isDeliveryOrder && deliveryDepositReadyForBalance ? "delivery-balance-payment-card" : ""}"><div class="flex" style="justify-content:space-between;align-items:center;gap:.75rem;flex-wrap:wrap;"><h3 style="margin:0;"><i class="fa-solid fa-credit-card"></i> ${isPayAfterDelivery ? (deliveryDepositReadyForBalance ? "Complete your payment" : "Pay deposit to confirm your order") : isDeliveryOrder ? "Pay before delivery" : "Pay now"}</h3></div>
      ${isPayAfterDelivery ? `<p class="muted delivery-balance-payment-copy" style="margin:.45rem 0 .8rem;">${deliveryDepositReadyForBalance ? (deliveryDepositReported && !deliveryDepositPaid ? `<strong>${deliveryDepositPercent}% payment reported</strong><br>Your ${deliveryDepositPercent}% delivery payment has been reported to the vendor. You can proceed with the remaining <strong>${naira(payableAmount)}</strong> balance.` : `<strong>Remaining ${deliveryRemainingPercent}% payment</strong><br>The vendor has delivered your order. Pay the remaining ${deliveryRemainingPercent}% balance of <strong>${naira(payableAmount)}</strong> to complete your payment.`) : `Pay a ${deliveryDepositPercent}% deposit of <strong>${naira(payableAmount)}</strong> based on the item amount. The delivery fee remains part of the total order balance.`}</p>` : isDeliveryOrder ? "" : `<p class="muted" style="margin:.45rem 0 .8rem;">Paystack is not available yet. Pay the vendor directly for now.</p>`}
      <button class="btn btn-sm ${isDeliveryOrder && deliveryDepositReadyForBalance ? "delivery-balance-direct-btn" : ""}" type="button" onclick="openVendorDirectPayment('${order.id}')" style="width:100%;justify-content:center;margin-top:.5rem;"><i class="fa-solid fa-wallet"></i> ${isPayAfterDelivery && deliveryDepositReadyForBalance ? ("Pay remaining " + deliveryRemainingPercent + "%") : isPayAfterDelivery ? ("Pay " + deliveryDepositPercent + "% deposit") : "Pay"} ${naira(payableAmount)}</button>
    </div>`;
  }

  if (canRecordPayment && !buyerReportedPayment && !pendingReportedPayment) {
    // The vendor no longer records payments by hand: they wait for the customer to
    // report their transfer, then confirm (or dispute) it from the card above.
    html += `<div class="card payment-waiting-card"><h3 style="margin:0 0 .35rem;"><i class="fa-solid fa-hourglass-half"></i> Waiting for the customer to pay</h3><p class="muted" style="margin:0;">Once the customer sends their payment and reports it, you'll be asked to confirm it here.</p></div>`;
  }

  if (isVendor && pendingReportedPayment && !openPaymentDispute && !buyerReportedPayment) {
    const reportedLabel = { sale_price: "sale price", rental_fee: "rental fee", deposit: "refundable deposit", delivery_deposit_20: "delivery deposit" }[String(pendingReportedPayment.payment_type || "")] || "payment";
    html += `<div class="card" style="border-color:var(--warning);">
      <h3 style="margin:0 0 .4rem;"><i class="fa-solid fa-hourglass-half"></i> Payment reported by customer</h3>
      <p class="muted" style="margin:0 0 .8rem;">The customer says they paid <strong>${naira(pendingReportedPayment.amount)}</strong> (${esc(reportedLabel)}) by bank transfer. Check your account, then confirm or dispute it.</p>
      <div id="reportedPaymentError" class="error-text hidden"></div>
      <div class="flex" style="gap:.6rem;flex-wrap:wrap;">
        <button class="btn btn-sm" onclick="vendorConfirmReportedPayment('${order.id}')"><i class="fa-solid fa-check-circle"></i> Confirm payment received</button>
        <button class="btn btn-sm btn-danger" type="button" onclick="byId('reportedPaymentDisputeForm').classList.remove('hidden');this.classList.add('hidden');">Dispute this payment</button>
      </div>
      <div id="reportedPaymentDisputeForm" class="hidden" style="margin-top:.7rem;">
        <textarea id="reportedPaymentDisputeReason" rows="2" placeholder="Why can't you confirm this payment?"></textarea>
        <button class="btn btn-sm btn-danger" style="margin-top:.5rem;" onclick="vendorDisputeReportedPayment('${order.id}')">Submit dispute</button>
      </div>
    </div>`;
  }

  let odBottomBar = "";
  let odReportBlock = "";   // on the redesigned pages the report link sits under the action buttons
  if (newView) {
    const parts = orderActionButtonsHtml(order, isCustomer, isVendor, feePaid, { parts: true });
    if (parts.main) html += `<div class="order-action-wrap od-action-wrap">${parts.main}</div>`;
    odBottomBar = parts.bottom ? `<div class="od-bottom-bar">${parts.bottom}</div>` : "";
  } else if (!newVendorView) {
    html += `<div class="order-action-wrap" style="margin-top:1.35rem;display:flex;gap:.85rem;flex-wrap:wrap;align-items:center;">${orderActionButtonsHtml(order, isCustomer, isVendor, feePaid)}</div>`;
  }

  if (isCustomer && order.status === "completed" && !orderHasReview(order)) {
    html += `<div class="card"><h3>Leave a review</h3>
      <div id="reviewError" class="error-text hidden"></div>
      ${starRatingWidgetHtml(5)}
      <input type="hidden" id="reviewRating" value="5" />
      <textarea id="reviewComment" rows="2" placeholder="How was the order and vendor?"></textarea>
      <button class="btn btn-sm" onclick="submitReview('${order.id}','${order.vendor.id}')">Submit review</button>
    </div>`;
  }

  const dispute = (order.disputes || [])[0];
  if (dispute) {
    html += `<div class="card" style="border-color:var(--danger);margin-top:1rem;">
      <div class="flex" style="justify-content:space-between;"><h3 style="margin:0;"><i class='fa-solid fa-triangle-exclamation'></i> Dispute</h3><span class="badge">${esc(dispute.status)}</span></div>
      <p style="margin:0.5rem 0;"><strong>Reason:</strong> ${esc(dispute.reason)}</p>
      ${disputeEvidenceHtml(dispute.attachments)}
      ${dispute.vendor_response ? `<p style="margin:0.5rem 0;"><strong>Vendor response:</strong> ${esc(dispute.vendor_response)}</p>` : ""}
      ${dispute.admin_notes ? `<p style="margin:0.5rem 0;"><strong>Resolution notes:</strong> ${esc(dispute.admin_notes)}</p>` : ""}
      ${isVendor ? `
        <div id="vendorDisputeResponseArea" style="margin-top:0.5rem;">
          <div id="vendorDisputeError" class="error-text hidden"></div>
          <textarea id="vendorDisputeResponse" rows="2" placeholder="Give your side of the story…">${esc(dispute.vendor_response || "")}</textarea>
          <button class="btn btn-sm" onclick="submitVendorDisputeResponse('${dispute.id}','${order.id}')">${dispute.vendor_response ? "Update response" : "Submit response"}</button>
        </div>` : ""}
    </div>`;
  } else if ((isCustomer || isVendor) && order.status !== "cancelled" && !(isVendor && pendingReportedPayment && !openPaymentDispute)) {
    const reportBlock = `<div class="${(newView || newVendorView) ? "od-report" : ""}" ${(newView || newVendorView) ? "" : 'style="margin-top:1rem;"'}>
      <a href="#" class="od-report-link" onclick="byId('disputeForm').classList.remove('hidden');this.classList.add('hidden');return false;" style="color:var(--danger);">Report an issue with this order</a>
      <div id="disputeForm" class="card hidden" style="border-color:var(--danger);margin-top:0.5rem;">
        <div id="disputeError" class="error-text hidden"></div>
        <textarea id="disputeReason" rows="3" placeholder="Describe what went wrong"></textarea>
        <div class="dispute-photos"><div class="dispute-photos-head"><span><i class="fa-solid fa-camera"></i> Photos of the item</span><small class="muted">Optional, up to 3</small></div>
          <div id="disputePhotoList" class="dispute-photo-list"></div>
          <input type="file" id="disputePhotoInput" accept="image/*" multiple class="hidden" onchange="pickDisputePhotos(this)">
          <button type="button" class="btn btn-sm btn-outline" id="disputeAddPhotoBtn" onclick="byId('disputePhotoInput').click()"><i class="fa-solid fa-image"></i> Add photos <small>(0/3)</small></button></div>
        <button class="btn btn-sm btn-danger" id="disputeSubmitBtn" onclick="fileDispute('${order.id}')">Submit report</button>
      </div>
    </div>`;
    if (newView || newVendorView) odReportBlock = reportBlock; else html += reportBlock;
  }

  if (newView || newVendorView) return `<div class="od-page">${html}${odBottomBar}${odReportBlock}</div>`;
  return html;
}

// Self-serve cancel-with-refund is only offered within this many hours of
// paying -- matches the server-side check in api/order-payout-action.js
// (buyer-cancel), which is the one that actually enforces it. Past this
// window the vendor may already be getting the order ready, so cancelling
// needs a dispute instead.
const BUYER_CANCEL_WINDOW_HOURS = 5;
let editOrderBusy = false;
async function openEditOrderModal(orderId) {
  if (!session?.user?.id || editOrderBusy) return;
  editOrderBusy = true;
  try {
    const { data: order, error } = await sb.from("orders")
      .select("id,buyer_id,vendor_id,status,order_type,package_id,total_amount,delivery_method,delivery_address,delivery_phone,buyer_note,delivery_fee,items:order_items(id,product_id,quantity,unit_price,product:products(name))")
      .eq("id", orderId).eq("buyer_id", session.user.id).maybeSingle();
    if (error) throw error;
    if (!order) throw new Error("Order not found.");
    if (order.status !== "pending") throw new Error("This order can only be edited while it is waiting for vendor confirmation.");
    if (order.package_id) throw new Error("Package orders cannot be edited after checkout.");
    if (!Array.isArray(order.items) || !order.items.length) throw new Error("This order has no editable items.");

    let modal = byId("editOrderModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "editOrderModal";
      modal.className = "modal hidden";
      document.body.appendChild(modal);
    }
    const rows = order.items.map((item, i) => `
      <div class="edit-order-item-row">
        <div class="edit-order-item-copy"><strong>${esc(item.product?.name || "Item")}</strong><span class="muted">${naira(item.unit_price)} each</span></div>
        <label class="edit-order-qty-label">Quantity<input class="edit-order-qty" data-order-item-id="${esc(item.id)}" type="number" min="0" step="1" value="${Number(item.quantity) || 0}" inputmode="numeric" /></label>
      </div>`).join("");
    const deliveryFields = order.delivery_method === "delivery" ? `
      <div class="edit-order-section">
        <h4>Delivery details</h4>
        <label>Delivery address<input id="editOrderAddress" type="text" value="${esc(order.delivery_address || "")}" placeholder="Delivery address" /></label>
      </div>` : "";
    modal.innerHTML = `<div class="modal-content edit-order-modal-content">
      <div class="drawer-header"><div><span class="muted">Order edit</span><h3 style="margin:.1rem 0 0;">Edit your order</h3></div><button type="button" class="icon-btn" onclick="closeEditOrderModal()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
      <p class="muted edit-order-intro">You can change the quantities or correct your delivery details while the vendor is still deciding whether to accept the order.</p>
      <div id="editOrderError" class="error-text hidden"></div>
      <div class="edit-order-items">${rows}</div>
      <div class="edit-order-section"><h4>Note for the vendor</h4><textarea id="editOrderNote" rows="3" placeholder="Add or correct a note for the vendor…">${esc(order.buyer_note || "")}</textarea></div>
      ${deliveryFields}
      <div class="edit-order-total"><span>New total</span><strong id="editOrderTotal">${naira(order.total_amount)}</strong></div>
      <p class="muted" style="font-size:.76rem;margin:.55rem 0 0;">The vendor will receive an immediate notification when you save the changes.</p>
      <div class="edit-order-actions"><button type="button" class="btn btn-outline" onclick="closeEditOrderModal()">Cancel</button><button type="button" class="btn" id="editOrderSaveBtn" onclick="saveEditedOrder('${esc(order.id)}')"><i class="fa-solid fa-check"></i> Save changes</button></div>
    </div>`;
    modal.classList.remove("hidden");
    modal.dataset.orderId = order.id;
    modal.dataset.deliveryFee = String(Number(order.delivery_fee || 0));
    modal.dataset.originalTotal = String(Number(order.total_amount || 0));
    modal.dataset.originalItems = JSON.stringify(order.items.map(it => ({ id: it.id, qty: Number(it.quantity || 0), price: Number(it.unit_price || 0) })));
    modal.querySelectorAll(".edit-order-qty").forEach(input => input.addEventListener("input", updateEditOrderTotal));
    updateEditOrderTotal();
  } catch (err) {
    showToast(err?.message || "Could not open the order editor.", "error");
  } finally {
    editOrderBusy = false;
  }
}

function closeEditOrderModal() {
  byId("editOrderModal")?.classList.add("hidden");
}

function updateEditOrderTotal() {
  const modal = byId("editOrderModal");
  const totalEl = byId("editOrderTotal");
  if (!modal || !totalEl) return;
  let total = Number(modal.dataset.deliveryFee || 0);
  modal.querySelectorAll(".edit-order-qty").forEach(input => {
    const qty = Math.max(0, parseInt(input.value || "0", 10) || 0);
    const original = JSON.parse(modal.dataset.originalItems || "[]").find(x => String(x.id) === String(input.dataset.orderItemId));
    total += qty * Number(original?.price || 0);
  });
  totalEl.textContent = naira(total);
}

async function saveEditedOrder(orderId) {
  const modal = byId("editOrderModal"), btn = byId("editOrderSaveBtn"), errorEl = byId("editOrderError");
  if (!modal || !btn) return;
  errorEl?.classList.add("hidden");
  const items = [...modal.querySelectorAll(".edit-order-qty")].map(input => ({
    order_item_id: input.dataset.orderItemId,
    quantity: Math.max(0, parseInt(input.value || "0", 10) || 0),
  }));
  if (!items.some(it => it.quantity > 0)) {
    if (errorEl) { errorEl.textContent = "Keep at least one item in the order."; errorEl.classList.remove("hidden"); }
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
  try {
    const { error } = await sb.rpc("edit_pending_order", {
      p_order_id: orderId,
      p_items: items,
      p_buyer_note: byId("editOrderNote")?.value?.trim() || null,
      p_delivery_address: byId("editOrderAddress")?.value?.trim() || null,
      p_delivery_phone: null,
    });
    if (error) throw error;
    closeEditOrderModal();
    showToast("Order updated. The vendor has been notified.", "success");
    refreshNotifications();
    await navigate("orderDetail", { orderId }, false);
  } catch (err) {
    if (errorEl) { errorEl.textContent = err?.message || "Could not update this order."; errorEl.classList.remove("hidden"); }
    else showToast(err?.message || "Could not update this order.", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Save changes';
  }
}

async function showOrderBuyerLocation(orderId, buyerLat, buyerLng, vendorLat, vendorLng) {
  const wrap = byId(`orderBuyerLocationWrap-${orderId}`);
  const mapEl = byId(`orderBuyerLocationMap-${orderId}`);
  const statusEl = byId(`orderBuyerLocationStatus-${orderId}`);
  if (!wrap || !mapEl) return;
  // Tapping the button again folds the map back up so it doesn't take over the page.
  const toggleBtn = document.querySelector(`.order-buyer-location-btn[data-order-id="${orderId}"]`);
  const setToggleLabel = (open) => {
    const lbl = toggleBtn?.querySelector(".order-buyer-location-btn-label");
    if (lbl) lbl.textContent = open ? "Hide customer location" : "View customer location";
    const chev = toggleBtn?.querySelector(".order-buyer-location-chevron");
    if (chev) chev.className = `order-buyer-location-chevron fa-solid ${open ? "fa-chevron-up" : "fa-chevron-down"}`;
  };
  if (!wrap.classList.contains("hidden")) {
    wrap.classList.add("hidden");
    setToggleLabel(false);
    return;
  }
  wrap.classList.remove("hidden");
  setToggleLabel(true);
  await loadLeaflet();

  const customerPoint = [Number(buyerLat), Number(buyerLng)];
  const vendorPoint = vendorLat != null && vendorLng != null ? [Number(vendorLat), Number(vendorLng)] : null;
  if (statusEl) {
    const km = vendorPoint ? haversineKm(vendorPoint[0], vendorPoint[1], customerPoint[0], customerPoint[1]) : null;
    statusEl.textContent = km != null ? `${formatDistanceKm(km)} from your shop` : "Customer location captured for this delivery.";
  }

  let map = mapEl._levroOrderBuyerMap;
  if (!map) {
    map = window.L.map(mapEl, { attributionControl: true, zoomControl: true, zoomControlOptions: { position: "topleft" } });
    map.attributionControl.setPrefix(false);
    addBasemapTileLayer(map);
    const RecenterControl = window.L.Control.extend({
      options: { position: "topright" },
      onAdd() {
        const btn = window.L.DomUtil.create("button", "order-buyer-map-recenter-control");
        btn.type = "button";
        btn.title = "Center on customer location";
        btn.setAttribute("aria-label", "Center map on customer location");
        btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i>';
        window.L.DomEvent.disableClickPropagation(btn);
        window.L.DomEvent.on(btn, "click", (e) => {
          window.L.DomEvent.stop(e);
          map.setView(customerPoint, Math.max(map.getZoom(), 15), { animate: true, duration: .35 });
        });
        return btn;
      }
    });
    map.addControl(new RecenterControl());
    mapEl._levroOrderBuyerMap = map;
  } else {
    map.eachLayer(layer => {
      if (layer instanceof window.L.Marker || layer instanceof window.L.CircleMarker || layer instanceof window.L.Polyline) map.removeLayer(layer);
    });
  }

  const buyerMarker = window.L.marker(customerPoint, { icon: customerMapIcon() }).addTo(map);
  buyerMarker.bindPopup("Customer delivery location").openPopup();
  const points = [customerPoint];
  if (vendorPoint) {
    const vendorMarker = window.L.marker(vendorPoint, { icon: vendorMapIcon() }).addTo(map);
    vendorMarker.bindPopup("Your shop");
    points.push(vendorPoint);

    // Draw the direct trace immediately so the relationship is visible even
    // before the optional road-routing request returns.
    const routeLine = window.L.polyline([vendorPoint, customerPoint], {
      color: "#3fb97f", weight: 4, opacity: .82, lineCap: "round", lineJoin: "round", dashArray: "10 8", className: "order-buyer-route"
    }).addTo(map);
    mapEl._levroOrderBuyerRoute = routeLine;
    const lineKm = haversineKm(vendorPoint[0], vendorPoint[1], customerPoint[0], customerPoint[1]);
    routeLine.bindTooltip(formatDistanceKm(lineKm), { permanent: true, direction: "center", className: "order-map-distance-label" });
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${vendorPoint[1]},${vendorPoint[0]};${customerPoint[1]},${customerPoint[0]}?overview=full&geometries=geojson`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      const json = await res.json().catch(() => null);
      const coords = json?.routes?.[0]?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length > 1) routeLine.setLatLngs(coords.map(c => [Number(c[1]), Number(c[0])]));
    } catch (_) {}
  }

  if (points.length > 1) map.fitBounds(window.L.latLngBounds(points), { padding: [42,42], maxZoom: 15, animate: false });
  else map.setView(customerPoint, Math.max(map.getZoom(), 15), { animate: false });
  requestAnimationFrame(() => requestAnimationFrame(() => map?.invalidateSize(true)));
}

function orderActionButtonsHtml(order, isCustomer, isVendor, feePaid, opts = {}) {
  const buttons = [];
  const bottom = [];   // Edit / Cancel live in the bottom bar of the redesigned page
  const isDeliveryOrder = order.delivery_method === "delivery";
  const feeType = order.order_type === "sale" ? "sale_price" : "rental_fee";
  const payments = Array.isArray(order.payments) ? order.payments : [];
  const deliveryDepositPaid = payments.some((p) => String(p.payment_type || "").trim().toLowerCase() === "delivery_deposit_20" && p.status === "paid");
  const deliveryBalancePaid = payments.some((p) => String(p.payment_type || "").trim().toLowerCase() === feeType && p.status === "paid");
  const paymentComplete = isDeliveryOrder ? (deliveryDepositPaid && deliveryBalancePaid) : feePaid;
  if (isVendor) {
    if (order.status === "pending") { buttons.push(`<button class="btn btn-sm order-action-confirm" onclick="confirmOrderAsVendor('${order.id}')">Confirm order</button>`); if (orderCanSuggestQuantity(order)) buttons.push(`<button class="btn btn-sm btn-outline" onclick="openSuggestQuantity('${order.id}')"><i class="fa-solid fa-arrows-rotate"></i> Suggest quantity</button>`); buttons.push(`<button class="btn btn-sm btn-danger order-action-decline" onclick="vendorDeclineOrder('${order.id}','pending')">Decline</button>`); }
    // Once the vendor has confirmed the order, do NOT render another
    // "Confirm order" / handover action here. The payment card above is the
    // single source of truth for the next vendor action: mark the selected
    // payment obligation as paid (delivery deposit first, then the remaining
    // balance; pickup uses the full payment). A "Cancel order" escape hatch
    // still needs to exist though, in case the vendor confirmed by mistake.
    if (order.status === "confirmed") buttons.push(`<button class="btn btn-sm btn-danger order-action-decline" onclick="vendorDeclineOrder('${order.id}','confirmed')">Cancel order</button>`);
    if (order.status === "handed_over" && order.order_type === "rental") buttons.push(`<button class="btn btn-sm order-action-neutral" onclick="updateOrderStatus('${order.id}','returned')">Mark returned</button>`);
  }
  // The "Payment reported" card already carries its own Message vendor button, so skip this one then.
  const paymentReportCardShown = payments.some((p) => p.status === "pending" && String(p.provider_reference || "").trim().toLowerCase() === "buyer_report");
  if (!opts.parts && isCustomer && order.vendor_id && !paymentReportCardShown && (["confirmed", "payment_unresolved", "handed_over", "returned", "disputed"].includes(String(order.status || "")) || (order.status === "completed" && Date.now() - new Date(order.completed_at || order.status_changed_at || order.created_at || 0).getTime() < 24 * 3600 * 1000))) {
    buttons.push(`<div class="order-contact-row" style="width:100%;"><button class="btn btn-sm order-action-neutral order-message-vendor-btn" type="button" onclick="startConversationWithVendor('${order.vendor_id}')"><i class="fa-solid fa-message"></i> Message vendor</button><button class="btn btn-sm order-call-btn" type="button" onclick="callVendorFromOrder('${order.vendor_id}')"><i class="fa-solid fa-phone"></i> Call</button></div>`);
  }
  if (isCustomer && order.status === "pending") {
    const editBtn = (order.order_type !== "sale" || !order.package_id) ? `<button class="btn btn-sm order-action-edit" onclick="openEditOrderModal('${order.id}')"><i class="fa-solid fa-pen"></i> Edit order</button>` : "";
    if (opts.parts) {
      if (editBtn) bottom.push(`<button type="button" class="od-btn od-btn-soft" onclick="openEditOrderModal('${order.id}')"><i class="fa-solid fa-pen"></i> Edit Order</button>`);
      bottom.push(`<button type="button" class="od-btn od-btn-danger" onclick="updateOrderStatus('${order.id}','cancelled')"><i class="fa-regular fa-circle-xmark"></i> Cancel Order</button>`);
    } else buttons.push(`<div class="order-action-pair"><button class="btn btn-sm btn-danger order-action-cancel" onclick="updateOrderStatus('${order.id}','cancelled')">Cancel order</button>${editBtn}</div>`);
  }
  if (isCustomer && order.status === "confirmed") {
    const paidRow = payments.find((p) => String(p.payment_type || "").trim().toLowerCase() === feeType && p.status === "paid");
    const servicePaymentReported = order.__serviceOffer?.status === "payment_reported";
    if (!isDeliveryOrder && !paidRow && !servicePaymentReported) {
      const pickupPayAmount = Number(order.total_amount || 0);
      buttons.push(`<button class="btn btn-sm pickup-pay-vendor-btn" onclick="openVendorDirectPayment('${order.id}')"><i class="fa-solid fa-wallet"></i> Pay ${naira(pickupPayAmount)}</button>`);
    }
    const hoursSincePaid = paidRow ? (Date.now() - new Date(paidRow.paid_at || paidRow.created_at).getTime()) / 3600000 : 0;
    if (servicePaymentReported) {
      buttons.push(`<p class="muted" style="font-size:0.82rem;margin:0;"><i class="fa-solid fa-hourglass-half"></i> Payment reported. Waiting for the vendor to confirm receipt.</p>`);
    } else if (paymentComplete) {
      /* fully paid: the buyer can no longer cancel; the order completes when they confirm receipt (or automatically after 24h) */
    } else if (!paidRow || hoursSincePaid <= BUYER_CANCEL_WINDOW_HOURS) {
      if (opts.parts) bottom.push(`<button type="button" class="od-btn od-btn-danger" onclick="buyerCancelOrder('${order.id}',${paymentComplete ? "true" : "false"})"><i class="fa-regular fa-circle-xmark"></i> Cancel Order</button>`);
      else buttons.push(`<button class="btn btn-sm btn-danger order-action-cancel" onclick="buyerCancelOrder('${order.id}',${paymentComplete ? "true" : "false"})">Cancel order</button>`);
    } else {
      buttons.push(`<p class="muted" style="font-size:0.82rem;margin:0;"><i class="fa-solid fa-circle-info"></i> The ${BUYER_CANCEL_WINDOW_HOURS}-hour self-serve cancellation window has passed. Report an issue below if something's wrong.</p>`);
    }
  }
  {
    const lmPaidAll = (isDeliveryOrder && order.payment_timing === "pay_after") ? paymentComplete : feePaid;
    const lmDup = order.status === "handed_over" && order.order_type === "sale" && !isDeliveryOrder;
    if (isCustomer && order.awaiting_confirmation_since && ["confirmed", "handed_over"].includes(order.status) && order.order_type !== "rental" && !order.service_offer_id && String(order.payout_status || "not_applicable") === "not_applicable" && lmPaidAll && !lmDup) {
      const due = new Date(new Date(order.awaiting_confirmation_since).getTime() + 24 * 3600 * 1000);
      buttons.push(`<button class="btn btn-sm" onclick="confirmReceivedOrder('${order.id}')"><i class="fa-solid fa-check"></i> I've received this</button>`);
      buttons.push(notReceivedButtonHtml(order));
      buttons.push(`<p class="muted" style="font-size:.8rem;margin:.2rem 0 0;"><i class="fa-solid fa-clock"></i> Payment confirmed. If you don't respond or report a problem, this order completes automatically on ${esc(due.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}.</p>`);
    }
  }
  if (isCustomer && order.status === "handed_over" && order.order_type === "rental" && !isDeliveryOrder) buttons.push(`<button class="btn btn-sm" onclick="updateOrderStatus('${order.id}','returned')">I've returned this equipment</button>`);
  if (isCustomer && order.status === "handed_over" && isDeliveryOrder) {
    // Delivery orders complete automatically when the vendor confirms the
    // remaining-balance payment. The customer does not need a separate
    // "Confirm & complete" / "I've received this" action.
    if (!deliveryBalancePaid) {
      const depositPaidAmount = payments.filter((p) => String(p.payment_type || "").trim().toLowerCase() === "delivery_deposit_20" && p.status === "paid").reduce((sum,p)=>sum+Number(p.amount||0),0);
      const balance = Math.max(0, Number(order.total_amount || 0) - depositPaidAmount);
      buttons.push(`<button class="btn btn-sm order-action-neutral" onclick="openVendorDirectPayment('${order.id}')"><i class="fa-solid fa-building-columns"></i> Complete payment · ${naira(balance)}</button>`);
    }
  }
  if (isCustomer && order.status === "handed_over" && order.order_type === "sale" && !isDeliveryOrder) {
    if (feePaid) { buttons.push(`<button class="btn btn-sm order-action-neutral" onclick="confirmReceiveOrder('${order.id}')"><i class="fa-solid fa-check"></i> I've received this</button>`); buttons.push(notReceivedButtonHtml(order)); }
    else buttons.push(`<p class="muted" style="font-size:0.82rem;margin:0;"><i class="fa-solid fa-hourglass-half"></i> Waiting on payment before this order can be completed.</p>`);
  }
  if (isCustomer && order.status === "returned" && order.order_type === "rental") {
    if (feePaid) { buttons.push(`<button class="btn btn-sm order-action-neutral" onclick="confirmReceiveOrder('${order.id}')"><i class="fa-solid fa-check"></i> Confirm &amp; complete</button>`); buttons.push(notReceivedButtonHtml(order)); }
    else buttons.push(`<p class="muted" style="font-size:0.82rem;margin:0;"><i class="fa-solid fa-hourglass-half"></i> Waiting on payment before this order can be completed.</p>`);
  }
  if (opts.parts) return { main: buttons.join(""), bottom: bottom.join("") };
  return buttons.join("");
}

// The buyer's "I have not received this" escape hatch - deliberately held
// back for a few hours after handover (real deliveries take time) and
// gated behind re-entering the account password (raising a dispute has
// real consequences for the vendor, so it shouldn't be one accidental tap).
const NOT_RECEIVED_WAIT_HOURS = 5;
function notReceivedButtonHtml(order) {
  if (!order.awaiting_confirmation_since) return "";
  const hoursSince = (Date.now() - new Date(order.awaiting_confirmation_since).getTime()) / 3600000;
  if (hoursSince < NOT_RECEIVED_WAIT_HOURS) return "";
  return `<button class="btn btn-sm btn-danger" onclick="showNotReceivedModal('${order.id}')"><i class="fa-solid fa-triangle-exclamation"></i> I have not received this</button>`;
}

const ORDER_STATUS_HELP = {
  pending: "Your order has been placed. You haven't been charged yet. Payment becomes available when the vendor accepts.",
  confirmed: "The vendor has accepted the order. Payment has not been verified yet; complete the required payment and report it using “I’ve paid the vendor”.",
  handed_over: "The equipment has physically been handed to the customer (picked up or delivered). For rentals, either side can mark it \"returned\" once it's back with the vendor. For sales, the customer confirms receipt to complete the order and release payment.",
  returned: "The rented equipment is back with the vendor. The buyer confirms to complete the order and release payment.",
  completed: "This order is finished.",
  cancelled: "This order was cancelled.",
  payment_unresolved: "Payment has been reported or requires payment verification. The vendor must confirm the payment or raise a dispute. If the vendor does neither within 24 hours, Levromart will escalate it to admin.",
  disputed: "An issue was reported on this order. An admin is reviewing it.",
};
// Short labels for the longer entries above -- the label shows inline, the
// full explanation moves behind an "i" popover instead of sitting on the
// page as a paragraph. Statuses not listed here are already short enough
// to just show in full.
const ORDER_STATUS_SHORT_LABEL = {
  pending: "Your order has been placed.",
  handed_over: "Item handed over",
  returned: "Equipment back with vendor",
  payment_unresolved: "Payment needs verification",
};

const PAYOUT_STATUS_HELP = {
  held: (date) => `Payment is being held by Levromart until you confirm receipt. It'll release automatically on ${date} even if you forget.`,
  released: () => `Payment has been released to the vendor.`,
  refunded: () => `This payment was refunded back to the customer.`,
};
const PAYOUT_STATUS_SHORT_LABEL = {
  held: "Payment held by Levromart",
};

const orderReminderBusy=new Set();
async function remindOrderVendor(orderId,button){
  if(!session?.user?.id||orderReminderBusy.has(orderId))return;
  orderReminderBusy.add(orderId);if(button)button.disabled=true;
  try{
    const {data:order,error}=await sb.from('orders').select('id,buyer_id,status,vendor_id,vendor:vendors(user_id)').eq('id',orderId).eq('buyer_id',session.user.id).single();if(error)throw error;
    if(order.status!=='pending'||!order.vendor?.user_id)throw new Error('This order no longer needs a reminder.');
    const {error:sendError}=await sb.rpc('send_order_reminder',{p_order_id:order.id});if(sendError)throw sendError;
    unlockNotificationAudio();
    if(audioCtx?.state==='running')playReminderChime();
    else if(audioCtx)audioCtx.resume().then(()=>playReminderChime()).catch(()=>{});
    showToast('Reminder sent to vendor.','success');
  }catch(err){showToast(err.message||'Could not send reminder. Please message the vendor.','error');}
  finally{orderReminderBusy.delete(orderId);if(button)button.disabled=false;}
}
async function updateOrderStatus(orderId, newStatus) {
  if (newStatus === "cancelled") {
    const confirmed = await showConfirmDialog(
      "Decline this order? The buyer will be notified and the order cannot be restored through this action.",
      { title: "Decline order", okLabel: "Yes, decline", danger: true }
    );
    if (!confirmed) return;
  }
  const { error } = await sb.rpc("transition_order_status", { p_order_id: orderId, p_new_status: newStatus });
  if (error) { showToast(error.message, "error"); return; }
  await navigate("orderDetail", { orderId });
}

