// ---------- CUSTOMER ORDER DETAILS (redesigned page) ----------
// Same data and the same actions as before -- only the presentation is rebuilt:
// status first, what happens next, what was ordered, what was paid, where it goes, who sells it.
const OD_STAGES = [
  { key: "placed", icon: "fa-cart-shopping", label: () => "Order placed" },
  { key: "confirmed", icon: "fa-box", label: () => "Confirmed" },
  { key: "handed", icon: "fa-truck-fast", label: (d) => d ? "Out for delivery" : "Handed over" },
  { key: "done", icon: "fa-circle-check", label: (d) => d ? "Delivered" : "Completed" },
];
function odIsPayAfter(order) { return String(order.payment_timing || "") === "pay_after"; }
// Pay-before orders get their own "Paid" step after "Confirmed" (the money is in before anything is handed over).
const OD_STAGES_PAY_BEFORE = [
  OD_STAGES[0], OD_STAGES[1],
  { key: "paid", icon: "fa-wallet", label: () => "Paid" },
  OD_STAGES[2], OD_STAGES[3],
];
function odStagesFor(order) {
  if (!odIsPayAfter(order)) return OD_STAGES_PAY_BEFORE;
  const pct = Math.max(1, Math.min(99, Number(order.payment_deposit_percent ?? 20) || 20));
  return [
    OD_STAGES[0], OD_STAGES[1],
    { key: "deposit", icon: "fa-wallet", label: () => `${pct}% paid` },
    { key: "handed", icon: "fa-truck-fast", label: (d) => d ? "Out for delivery" : "Handed over" },
    { key: "balance", icon: "fa-money-bill-transfer", label: () => `Pay remaining ${100 - pct}%` },
    OD_STAGES[3],
  ];
}
function odStageIndex(order) {
  if (odIsPayAfter(order)) {
    const pays = Array.isArray(order.payments) ? order.payments : [];
    const paid = (t) => pays.some((p) => String(p.payment_type || "").trim().toLowerCase() === t && p.status === "paid");
    const reported = (t) => pays.some((p) => String(p.payment_type || "").trim().toLowerCase() === t && p.status === "pending");
    const feeT = order.order_type === "rental" ? "rental_fee" : "sale_price";
    const depositPaid = paid("delivery_deposit_20"), balancePaid = paid(feeT);
    switch (String(order.status || "")) {
      case "pending": return 0;
      case "confirmed": case "payment_unresolved": case "disputed":
        if (depositPaid && balancePaid) return 5;           // everything paid, waiting for "I've received"
        return depositPaid ? 2 : 1;                         // "N% paid" once the deposit is confirmed
      case "handed_over": case "returned":
        if (balancePaid) return 5;                          // delivered, waiting for the buyer's confirmation
        return reported(feeT) ? 4 : 3;                      // out for delivery -> paying the remaining part
      case "completed": return 6;                           // every step done
      default: return -1;
    }
  }
  const rows = Array.isArray(order.payments) ? order.payments : [];
  const feeType = order.order_type === "rental" ? "rental_fee" : "sale_price";
  const feePaid = rows.some((p) => String(p.payment_type || "").trim().toLowerCase() === feeType && p.status === "paid");
  switch (String(order.status || "")) {
    case "pending": return 0;
    case "confirmed": case "payment_unresolved": case "disputed": return feePaid ? 2 : 1;   // "Paid" once the payment is confirmed
    case "handed_over": case "returned": return 3;
    case "completed": return 4;
    default: return -1;
  }
}
function odTone(order) {
  if (order.__paymentUnresolved) return "unresolved";
  if (lvOrderStageLabel(order)) return "paid";
  return ({ pending: "pending", confirmed: "confirmed", handed_over: "handed", returned: "handed", completed: "done", cancelled: "cancelled", disputed: "disputed", payment_unresolved: "unresolved" })[order.status] || "pending";
}
// What a "confirmed" order is waiting on, so the badge says "Payment confirmed" / "Deposit confirmed · balance due"
// instead of falling back to plain "Confirmed" after the vendor confirms a payment. Display only: statuses are unchanged.
function lvOrderStageLabel(order) {
  if (!order || order.__paymentUnresolved || order.status !== "confirmed") return "";
  const rows = Array.isArray(order.payments) ? order.payments : [];
  const paid = (t) => rows.some((p) => String(p.payment_type || "").trim().toLowerCase() === t && p.status === "paid");
  const feeType = order.order_type === "sale" ? "sale_price" : "rental_fee";
  const payAfter = order.delivery_method === "delivery" && order.payment_timing === "pay_after";
  if (payAfter) {
    if (paid(feeType)) return "Payment confirmed";
    if (paid("delivery_deposit_20")) return "Deposit confirmed · balance due";
    return "";
  }
  return paid(feeType) ? "Payment confirmed" : "";
}
function odStatusLabel(order) {
  if (order.__paymentUnresolved) return "Payment unresolved";
  const stage = lvOrderStageLabel(order);
  if (stage) return stage;
  return String(order.status || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
function odInfoCard(order, isDelivery) {
  const t = String(order.status || "");
  if (order.__paymentUnresolved) return { icon: "fa-hourglass-half", head: "Payment needs verification", body: "The vendor is checking your payment. If they don't respond within 24 hours, Levromart steps in." };
  if (t === "pending") return { icon: "fa-hourglass-half", head: "Your order has been placed successfully!", body: "The vendor will review it and you will be notified as soon as they accept." };
  if (odIsPayAfter(order) && t === "confirmed") { const pct = Math.max(1, Math.min(99, Number(order.payment_deposit_percent ?? 20) || 20)); return { icon: "fa-wallet", head: `Pay the first ${pct}% to start`, body: `This is a pay-after-delivery order. Pay ${pct}% now; the remaining ${100 - pct}% is paid after delivery.` }; }
  if (odIsPayAfter(order) && t === "handed_over") { const pct = Math.max(1, Math.min(99, Number(order.payment_deposit_percent ?? 20) || 20)); return { icon: "fa-money-bill-transfer", head: `Second payment: remaining ${100 - pct}%`, body: "Your first payment is done. Pay the remaining balance to complete this order." }; }
  if (t === "confirmed" && typeof orderIsFullyPaid === "function" && orderIsFullyPaid(order)) return { icon: "fa-wallet", head: "Payment received", body: "The vendor is getting your order ready. You will see it move to “Out for delivery” as soon as they send it." };
  if (t === "confirmed") return { icon: "fa-circle-check", head: "The vendor accepted your order", body: "Pay the vendor, then tap “I’ve paid the vendor” so they can hand your order over." };
  if (t === "handed_over") return { icon: "fa-truck-fast", head: isDelivery ? "Your order is on its way" : "Your order has been handed over", body: order.order_type === "rental" ? "Return the equipment when you're done. The vendor will mark it returned." : "Check everything, then confirm once you've received it. If you do nothing and raise no issue, it is marked received automatically after 48 hours." };
  if (t === "returned") return { icon: "fa-rotate-left", head: "Equipment is back with the vendor", body: "Confirm to complete the order and release the deposit." };
  if (t === "completed") return { icon: "fa-circle-check", head: "Order completed", body: "Thank you for shopping on Levromart." };
  if (t === "cancelled") return { icon: "fa-circle-xmark", head: "This order was cancelled", body: "Any online payment is refunded to you." };
  if (t === "disputed") return { icon: "fa-scale-balanced", head: "An issue was reported", body: "An admin is reviewing this order. We'll update you here." };
  return null;
}
function customerOrderTopHtml(order, ctx) {
  const isDelivery = order.delivery_method === "delivery";
  const tone = odTone(order);
  const shortId = `#${String(order.id || "").slice(0, 8).toUpperCase()}`;
  const stageIdx = odStageIndex(order);
  const info = odInfoCard(order, isDelivery);
  const v = order.vendor || {};
  const actionBack = ctx.sourcePerspective === "purchases" ? "navigate('vendorOrders',{status:'all',perspective:'purchases'})" : "navigate('buyerOrders')";
  const img = (item) => {
    const src = item.product?.photos?.[0];
    return src ? `<img class="od-item-img" src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'od-item-img od-item-img-empty',innerHTML:'<i class=&quot;fa-solid fa-image&quot;></i>'}))">`
      : `<span class="od-item-img od-item-img-empty"><i class="fa-solid fa-image"></i></span>`;
  };
  // ---- header
  let h = `<div class="od-header"><button type="button" class="od-back" onclick="${actionBack}" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button>
    <div class="od-header-title"><strong>Order Details</strong><span>${esc(shortId)}</span></div>
    <div class="od-menu-wrap"><button type="button" class="od-more" onclick="toggleOrderDetailMenu(event)" aria-label="More"><i class="fa-solid fa-ellipsis"></i></button>
      <div class="od-menu hidden" id="odMenu"><button type="button" onclick="copyOrderId('${esc(order.id)}')"><i class="fa-regular fa-copy"></i> Copy order ID</button><button type="button" onclick="openOrderIssueForm()"><i class="fa-solid fa-flag"></i> Report an issue</button></div></div></div>`;
  // ---- status card
  h += `<section class="od-card od-status od-tone-${tone}"><div class="od-status-icon"><i class="fa-solid ${tone === "cancelled" ? "fa-ban" : tone === "done" ? "fa-circle-check" : tone === "paid" ? "fa-money-check-dollar" : "fa-box-open"}"></i></div>
    <div class="od-status-copy"><span class="od-kicker">Order Status</span><strong class="od-status-name">${esc(odStatusLabel(order))}</strong>${order.created_at ? `<span class="od-placed">Placed ${esc(orderDateTimeStr(order.created_at))}</span>` : ""}</div>
    <span class="od-pill od-pill-${tone}">${esc(odStatusLabel(order))}</span>
    ${order.status === "pending" ? `<div class="od-strip"><i class="fa-regular fa-clock"></i><span>Vendor hasn’t responded after 5–10 minutes? Tap <strong>Remind vendor</strong> and we’ll nudge them.</span></div>` : ""}
  </section>`;
  // ---- main actions
  const canContact = !!ctx.contactAllowed && order.vendor_id;
  if (order.status === "pending" || canContact) {
    h += `<div class="od-actions">${order.status === "pending" ? `<button type="button" class="od-btn od-btn-primary" onclick="remindOrderVendor('${esc(order.id)}',this)"><i class="fa-solid fa-bell"></i> Remind vendor</button>` : ""}
      ${canContact ? `<button type="button" class="od-btn od-btn-light" onclick="startConversationWithVendor('${esc(order.vendor_id)}')"><i class="fa-regular fa-comment-dots"></i> Message</button><button type="button" class="od-btn od-btn-light" onclick="callVendorFromOrder('${esc(order.vendor_id)}')"><i class="fa-solid fa-phone"></i> Call</button>` : ""}</div>`;
  }
  // ---- progress tracker
  if (stageIdx >= 0) {
    h += `<section class="od-card od-tracker" aria-label="Order progress">${odStagesFor(order).map((st, i) => `<div class="od-step ${i < stageIdx ? "is-done" : i === stageIdx ? "is-current" : ""}"><span class="od-step-dot"><i class="fa-solid ${st.icon}"></i></span><span class="od-step-label">${esc(st.label(isDelivery))}</span>${i === 0 && order.created_at ? `<small>${esc(new Date(order.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</small>` : ""}</div>`).join("")}</section>`;
  }
  // ---- state information
  if (info) h += `<section class="od-info od-tone-${tone}"><span class="od-info-icon"><i class="fa-solid ${info.icon}"></i></span><div><strong>${esc(info.head)}</strong><p>${esc(info.body)}</p></div></section>`;
  if (order.payout_status && order.payout_status !== "not_applicable") {
    h += `<section class="od-strip od-strip-card"><i class="fa-solid fa-shield-halved"></i><span>${esc(PAYOUT_STATUS_SHORT_LABEL[order.payout_status] || (typeof PAYOUT_STATUS_HELP[order.payout_status] === "function" ? PAYOUT_STATUS_HELP[order.payout_status](order.auto_release_at ? new Date(order.auto_release_at).toLocaleDateString("en-GB") : "the release date") : order.payout_status))}</span></section>`;
  }
  // ---- items
  const items = order.items || [];
  h += `<section class="od-card"><div class="od-card-head"><h3>Items (${items.length})</h3>${v.id ? `<a href="#" class="od-link" onclick="navigate('storefront',{vendorId:'${esc(v.id)}'});return false;"><i class="fa-solid fa-store"></i> View Vendor Store <i class="fa-solid fa-chevron-right"></i></a>` : ""}</div>
    ${items.map((item) => `<div class="od-item">${img(item)}<div class="od-item-copy"><strong>${esc(item.product?.name || "")}${item.variant?.name ? ` · ${esc(item.variant.name)}` : ""}</strong><span class="od-muted">Qty: ${Number(item.quantity || 1)}${item.rental_start_date ? ` · ${esc(item.rental_start_date)} → ${esc(item.rental_end_date)}` : ""}</span><b class="od-price">${naira(item.unit_price)}</b>
      ${ctx.isCustomer && order.status === "completed" && item.product_id && !orderHasReview(order) ? `<button type="button" class="od-btn od-btn-light od-btn-small" onclick="navigate('productDetail',{productId:'${item.product_id}',scrollToReviews:true})"><i class="fa-solid fa-star"></i> Rate this product</button>` : ""}</div></div>`).join("")}
    ${order.buyer_note ? `<p class="od-note"><i class="fa-regular fa-message"></i> <strong>Your note:</strong> ${esc(order.buyer_note)}</p>` : ""}
  </section>`;
  // ---- payment summary
  const paid = (order.payments || []).filter((p) => p.status === "paid");
  const methodLabel = (() => {
    const m = String(paid[0]?.method || "").toLowerCase();
    if (m === "cash") return "Cash";
    if (m === "transfer") return "Bank transfer";
    if (m === "card") return "Card";
    return paid.length ? "Paid" : (["pending", "cancelled"].includes(order.status) ? "Not paid yet" : "Pay the vendor directly");
  })();
  h += `<section class="od-card"><h3>Payment Summary</h3><div class="od-pay-grid">
    <div><span class="od-muted">Total Amount</span><b class="od-price">${naira(order.total_amount)}</b></div>
    ${order.delivery_fee > 0 ? `<div><span class="od-muted">Delivery fee</span><b>${naira(order.delivery_fee)}</b></div>` : ""}
    ${order.deposit_amount > 0 ? `<div><span class="od-muted">Refundable Deposit</span><b class="od-price">${naira(order.deposit_amount)}</b></div>` : ""}
    <div><span class="od-muted">Payment Method</span><b>${esc(methodLabel)}</b></div></div></section>`;
  // ---- delivery / pickup
  if (isDelivery) {
    const hasPin = order.buyer_lat != null && order.buyer_lng != null;
    const mapHref = hasPin ? `https://www.google.com/maps/search/?api=1&query=${order.buyer_lat},${order.buyer_lng}` : (order.delivery_address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.delivery_address)}` : "");
    const hasEta = v.lat != null && v.lng != null;
    h += `<section class="od-card"><div class="od-card-head"><h3><i class="fa-solid fa-location-dot"></i> Delivery Information</h3>${hasEta && v.id ? `<a class="od-link" href="#" onclick="openVendorDistanceMap('${esc(v.id)}');return false;"><i class="fa-solid fa-map"></i> View on Map <i class="fa-solid fa-chevron-right"></i></a>` : ""}</div>
      <div class="od-delivery"><div><span class="od-muted">Delivery to</span><strong>${esc(order.delivery_address || "Address not provided")}</strong></div>
      ${hasEta ? `<div class="od-eta"><span class="od-muted">Estimated delivery</span><strong id="orderEtaLine"></strong></div>` : ""}</div></section>`;
  } else {
    const addr = [v.address, v.city].filter(Boolean).map(esc).join(", ");
    h += `<section class="od-card"><div class="od-card-head"><h3><i class="fa-solid fa-location-dot"></i> Pickup Location</h3></div>
      <div class="od-delivery"><div><span class="od-muted">Collect from</span><strong>${addr || "The vendor hasn't listed a pickup address yet"}</strong>${v.opening_hours ? `<span class="od-muted"><i class="fa-regular fa-clock"></i> ${esc(v.opening_hours)}</span>` : ""}</div></div>
      ${ctx.contactAllowed && v.id ? `<button type="button" class="od-btn od-btn-light" style="margin-top:.7rem" data-draft="${esc(pickupMessageDraft(order))}" onclick="startConversationWithVendor('${esc(v.id)}', this.dataset.draft)"><i class="fa-regular fa-comment-dots"></i> Message vendor to confirm pickup</button>` : ""}</section>`;
  }
  // ---- vendor
  if (v.id) {
    const rating = Number(v.avg_rating || 0), reviews = Number(v.review_count || 0);
    h += `<section class="od-card"><h3><i class="fa-solid fa-store"></i> Vendor Information</h3><div class="od-vendor">
      ${v.logo_url ? `<img class="od-vendor-logo" src="${esc(v.logo_url)}" alt="" loading="lazy" decoding="async">` : avatarFallbackHtml(v.business_name || "Vendor", "3rem", "od-vendor-logo", v.business_name || "Vendor")}
      <div class="od-vendor-copy"><strong>${esc(v.business_name || "Vendor")} ${v.verification_status === "verified" ? `<i data-vt="${esc(v.id)}" class="fa-solid fa-circle-check od-verified" title="Verified vendor"></i>` : ""}</strong><span class="od-muted"><i class="fa-solid fa-star od-star"></i> ${reviews ? `${rating.toFixed(1)} (${reviews} review${reviews === 1 ? "" : "s"})` : "No reviews yet"}</span></div>
      <div class="od-vendor-actions">${ctx.contactAllowed ? `<button type="button" class="od-btn od-btn-light od-btn-small" onclick="startConversationWithVendor('${esc(v.id)}')"><i class="fa-regular fa-comment-dots"></i> Message</button>` : ""}<button type="button" class="od-btn od-btn-light od-btn-small" onclick="navigate('storefront',{vendorId:'${esc(v.id)}'})"><i class="fa-solid fa-store"></i> View Store</button></div></div></section>`;
  }
  return h;
}
