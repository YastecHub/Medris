// ---------- QUANTITY SUGGESTIONS ----------
// A vendor who has the product but not the quantity asked for can suggest what they can supply
// instead of declining the whole order; the customer then accepts it or keeps the original.
function orderCanSuggestQuantity(order) {
  return order && order.status === "pending" && order.order_type === "sale" && !order.package_id && Array.isArray(order.items) && order.items.some((it) => Number(it.quantity) > 1);
}
function orderQtyProposalHtml(order, role) {
  const pr = order && order.quantity_proposal;
  if (!pr || order.status !== "pending" || !Array.isArray(pr.items)) return "";
  const rows = pr.items.filter((l) => Number(l.suggested) !== Number(l.requested)).map((l) => `<li><span>${esc(l.name)}</span><span><s>${Number(l.requested)}</s> <strong>${Number(l.suggested)}</strong></span></li>`).join("");
  const note = pr.note ? `<p class="oqp-note">"${esc(pr.note)}"</p>` : "";
  if (role === "customer") {
    return `<section class="oqp-card"><div class="oqp-head"><span class="oqp-ico"><i class="fa-solid fa-arrows-rotate"></i></span><div><strong>The vendor suggested a different quantity</strong><small>They can supply less than you asked for.</small></div></div><ul class="oqp-list">${rows}</ul>${note}<div class="oqp-actions"><button type="button" class="od-btn od-btn-soft" onclick="respondQuantityProposal('${esc(order.id)}',false)">Keep my order</button><button type="button" class="od-btn od-btn-confirm" onclick="respondQuantityProposal('${esc(order.id)}',true)"><i class="fa-solid fa-check"></i> Accept</button></div></section>`;
  }
  return `<section class="oqp-card oqp-wait"><div class="oqp-head"><span class="oqp-ico"><i class="fa-solid fa-hourglass-half"></i></span><div><strong>Waiting for the customer</strong><small>You suggested a different quantity.</small></div></div><ul class="oqp-list">${rows}</ul>${note}</section>`;
}
async function openSuggestQuantity(orderId) {
  byId("suggestQtyModal")?.remove();
  const { data: order, error } = await sb.from("orders").select("id,status,items:order_items(id,quantity,product:products(name,quantity_available,track_quantity))").eq("id", orderId).maybeSingle();
  if (error || !order) { showToast("Couldn't load this order.", "error"); return; }
  const rows = (order.items || []).map((it) => {
    const stock = it.product?.track_quantity === false ? null : Number(it.product?.quantity_available);
    return `<div class="sq-row"><div class="sq-name"><strong>${esc(it.product?.name || "Item")}</strong><small>Customer asked for ${Number(it.quantity)}${stock != null && Number.isFinite(stock) ? ` · your stock shows ${stock}` : ""}</small></div><input type="number" inputmode="numeric" min="0" max="${Number(it.quantity)}" value="${Number(it.quantity)}" data-sq-item="${esc(it.id)}" data-sq-max="${Number(it.quantity)}" /></div>`;
  }).join("");
  const modal = document.createElement("div");
  modal.id = "suggestQtyModal"; modal.className = "modal";
  modal.innerHTML = `<div class="modal-content" style="max-width:460px;"><h3 style="margin:0 0 .3rem;">Suggest a quantity</h3><p class="muted" style="margin:0 0 .8rem;">Tell the customer how many you can actually supply. They can accept it or keep their original order. Nothing is cancelled.</p><div id="sqError" class="error-text hidden"></div>${rows}<label class="df-label" for="sqNote">Note for the customer <span class="df-hint">(optional)</span></label><textarea id="sqNote" rows="2" maxlength="300" placeholder="e.g. I only have 1 left, more arrives Friday"></textarea><div class="flex" style="justify-content:flex-end;gap:.6rem;margin-top:.8rem;"><button type="button" class="btn btn-sm btn-outline" onclick="byId('suggestQtyModal').remove()">Cancel</button><button type="button" class="btn btn-sm" id="sqSend" onclick="sendSuggestedQuantity('${esc(orderId)}')"><i class="fa-solid fa-paper-plane"></i> Send suggestion</button></div></div>`;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}
async function sendSuggestedQuantity(orderId) {
  const err = byId("sqError"), btn = byId("sqSend");
  err?.classList.add("hidden");
  const items = [...document.querySelectorAll("#suggestQtyModal [data-sq-item]")].map((i) => ({ id: i.dataset.sqItem, quantity: Math.floor(Number(i.value)), max: Number(i.dataset.sqMax) }));
  if (items.some((i) => !Number.isFinite(i.quantity) || i.quantity < 0 || i.quantity > i.max)) { if (err) { err.textContent = "Enter a number from 0 up to what the customer asked for."; err.classList.remove("hidden"); } return; }
  btn.disabled = true;
  const { error } = await sb.rpc("vendor_suggest_order_quantity", { p_order_id: orderId, p_items: items.map(({ id, quantity }) => ({ id, quantity })), p_note: byId("sqNote")?.value.trim() || null });
  if (error) { if (err) { err.textContent = error.message; err.classList.remove("hidden"); } btn.disabled = false; return; }
  byId("suggestQtyModal")?.remove();
  showToast("Suggestion sent to the customer.", "success");
  navigate("orderDetail", { orderId }, false);
}
async function respondQuantityProposal(orderId, accept) {
  if (!(await showConfirmDialog(accept ? "Accept the vendor's suggested quantity? Your order total will update." : "Keep your original order? The vendor can still confirm or decline it.", { title: accept ? "Accept suggestion" : "Keep my order", okLabel: accept ? "Accept" : "Keep my order" }))) return;
  const { error } = await sb.rpc("buyer_respond_quantity_proposal", { p_order_id: orderId, p_accept: !!accept });
  if (error) { showToast(error.message, "error"); return; }
  showToast(accept ? "Order updated with the suggested quantity." : "Original order kept.", "success");
  navigate("orderDetail", { orderId }, false);
}
async function confirmOrderAsVendor(orderId) {
  const confirmed = await showConfirmDialog(
    "Confirm this order? The customer will be notified you've accepted it and told to proceed with payment/pickup.",
    { title: "Confirm order", okLabel: "Yes, confirm" }
  );
  if (!confirmed) return;
  const { error } = await sb.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "confirmed" });
  if (error) { showToast(error.message, "error"); return; }
  showToast("Order confirmed.", "success");
  // If payout isn't set up yet, send the vendor straight there -- money for
  // this order can't reach them otherwise once it's paid.
  if (vendor && !vendor.paystack_subaccount_code) {
    await window.openVendorPayoutSetup?.();
    return;
  }
  await navigate("orderDetail", { orderId });
}

// Covers both declining a still-pending order and cancelling one the vendor
// already (mistakenly) confirmed -- vendor_decline_order on the server
// accepts either status and records the reason for the buyer. Any
// already-paid fee/deposit is refunded automatically (see
// api/order-payout-action.js's vendor-decline action).
async function vendorDeclineOrder(orderId, fromStatus) {
  const isConfirmed = fromStatus === "confirmed";
  // once the buyer has paid, the shop cannot cancel by itself: it asks Levromart
  if (isConfirmed) {
    try {
      const { data: paidRows } = await sb.from("payments").select("id").eq("order_id", orderId).eq("status", "paid").in("payment_type", ["sale_price", "rental_fee", "delivery_deposit_20"]).limit(1);
      if (paidRows && paidRows.length) { window.lvAskCancel(orderId); return; }
    } catch (_) {}
  }
  const proceed = await showConfirmDialog(
    isConfirmed
      ? "Use this only to undo a mistake. The customer will be told, and any payment they already made is refunded automatically."
      : "The customer will be told, and this order cannot be brought back.",
    { title: isConfirmed ? "Cancel this order?" : "Decline this order?", okLabel: isConfirmed ? "Yes, cancel it" : "Yes, decline", cancelLabel: "Go back", danger: true }
  );
  if (!proceed) return;
  const reason = await showTextPromptDialog(
    isConfirmed ? "Why are you cancelling?" : "Why are you declining?",
    "This message is sent to the customer, so let them know what happened. You can leave it blank.",
    { placeholder: "Write a short message…", okLabel: "Send", chips: ["Out of stock", "Not available on that date", "Cannot deliver to your area", "Price has changed"], icon: "fa-comment-dots", danger: true }
  );
  if (reason === null) return;
  try {
    const res = await fetch("/api/order-payout-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vendor-decline", orderId, accessToken: session.access_token, reason }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not decline this order.");
    if (json.refundError) showToast("Order cancelled. There was a hiccup issuing the refund, our team will sort it out.", "info");
    else if (json.refunded) showToast("Order cancelled and refunded.", "success");
    else showToast(isConfirmed ? "Order cancelled." : "Order declined.", "success");
    await navigate("orderDetail", { orderId });
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function confirmHandOverOrder(orderId) {
  const { data: orderForHandover } = await sb.from("orders").select("delivery_method").eq("id",orderId).maybeSingle();
  const isDelivery = orderForHandover?.delivery_method === "delivery";
  const confirmed = await showConfirmDialog(
    isDelivery ? "Confirm that you have actually delivered this order to the customer. This changes the order to Delivered and tells the customer to complete the remaining payment." : "Confirm that you have physically handed this order to the customer. This changes the order to Handed over and tells the customer to confirm receipt. Only continue if the handover has actually happened.",
    { title: isDelivery ? "Mark as delivered" : "Mark as handed over", okLabel: isDelivery ? "Yes, mark delivered" : "Yes, mark handed over" }
  );
  if (!confirmed) return;
  showToast("Updating order…", "info");
  const { error } = await sb.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "handed_over" });
  if (error) { showToast(error.message, "error"); return; }
  showToast(isDelivery ? "Order marked as delivered." : "Order marked as handed over.", "success");
  await navigate("orderDetail", { orderId });
}

// Self-serve cancel for a confirmed-but-not-yet-handed-over order. Safe to
// automate because nothing's been handed over yet; if the customer already
// paid, this also triggers an immediate Paystack refund. Once the vendor
// marks it handed over, cancelling requires a dispute instead.
async function buyerCancelOrder(orderId, feePaid) {
  const msg = feePaid
    ? "You can cancel until the vendor marks the order out for delivery. You will get back what you paid for the order. Paystack's payment fee is not refunded."
    : "Cancel this order? You have not paid yet, so there is nothing to refund.";
  if (!(await showConfirmDialog(msg, { title: "Cancel this order?", okLabel: "Yes, cancel it", cancelLabel: "Keep order", danger: true }))) return;
  try {
    const { data, error } = await sb.rpc("buyer_cancel_order", { p_order_id: orderId });
    if (error) throw new Error(error.message || "Could not cancel this order.");
    if (data?.refunded) showToast("Order cancelled. Your refund is on its way.", "success");
    else showToast("Order cancelled.", "success");
    await navigate("orderDetail", { orderId });
  } catch (err) {
    showToast(err.message, "error");
  }
}

let notReceivedOrderId = null;
function showNotReceivedModal(orderId) {
  notReceivedOrderId = orderId;
  byId("notReceivedPassword").value = "";
  byId("notReceivedError").classList.add("hidden");
  byId("notReceivedModal").classList.remove("hidden");
  trackModalOpened("notReceivedModal");
}
function closeNotReceivedModal() {
  byId("notReceivedModal").classList.add("hidden");
  if (dismissibleModalId === "notReceivedModal") dismissibleModalId = null;
}
async function submitNotReceived() {
  const errorEl = byId("notReceivedError");
  errorEl.classList.add("hidden");
  const password = byId("notReceivedPassword").value;
  if (!password) { errorEl.textContent = "Enter your password to confirm."; errorEl.classList.remove("hidden"); return; }
  const btn = byId("notReceivedSubmit");
  btn.disabled = true;
  try {
    // Re-authenticating (same pattern as the voluntary change-password
    // flow) is the proof-of-identity for a report this consequential -
    // it can trigger a refund out of the platform's own balance.
    const { error: reauthError } = await sb.auth.signInWithPassword({ email: session.user.email, password });
    if (reauthError) { errorEl.textContent = "Password is incorrect."; errorEl.classList.remove("hidden"); btn.disabled = false; return; }
    const { error } = await sb.rpc("raise_dispute", { p_order_id: notReceivedOrderId, p_reason: "Customer reports this order was never received." });
    if (error) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); btn.disabled = false; return; }
    byId("notReceivedModal").classList.add("hidden");
    showToast("Reported. An admin will review this.", "success");
    navigate("orderDetail", { orderId: notReceivedOrderId });
  } finally {
    btn.disabled = false;
  }
}

// The buyer's "I've received this" / "Confirm & complete" action - unlike
// every other status change, this one also has to actually move money, so
// it goes through a serverless endpoint instead of a plain RPC call.
async function confirmReceivedOrder(orderId) {
  if (!(await showConfirmDialog("Confirm that you have received this order. This completes the order. Only continue after you have actually received it.", { title: "Confirm I've received it", okLabel: "Yes, I've received it" }))) return;
  try {
    const { error } = await sb.rpc("buyer_confirm_received", { p_order_id: orderId });
    if (error) throw error;
    showToast("Order completed. Thank you!", "success");
  } catch (err) { showToast(err.message || "Couldn't confirm. Please try again.", "error"); }
  navigate("orderDetail", { orderId });
  setTimeout(() => { try { window.maybePromptLevromartReview?.(true); } catch (_) {} }, 900);
}
async function confirmReceiveOrder(orderId) {
  if (!(await showConfirmDialog("Confirm that you have physically received this order. This completes the order once all required payments have been paid. Only continue after you have actually received it.", { title: "Confirm I've received it", okLabel: "Yes, I've received it" }))) return;
  showToast("Confirming…", "info");
  try {
    const { data: currentOrder, error: orderError } = await sb.from("orders").select("id,delivery_method,order_type").eq("id",orderId).maybeSingle();
    if (orderError) throw orderError;
    if (currentOrder?.delivery_method === "delivery") {
      const { data: freshPayments, error: paymentError } = await sb.from("payments").select("payment_type,status").eq("order_id",orderId);
      if (paymentError) throw paymentError;
      const feeType = currentOrder.order_type === "rental" ? "rental_fee" : "sale_price";
      const depositPaid = (freshPayments||[]).some(p=>p.payment_type==="delivery_deposit_20"&&p.status==="paid");
      const balancePaid = (freshPayments||[]).some(p=>p.payment_type===feeType&&p.status==="paid");
      if (!depositPaid || !balancePaid) throw new Error("Both the ${deliveryDepositPercent}% delivery deposit and remaining balance must be paid before this order can be completed.");
      const { error } = await sb.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "completed" });
      if (error) throw error;
      showToast("Order completed. Both payments are recorded.", "success");
    } else {
      const res = await fetch("/api/order-payout-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release", orderId, accessToken: session.access_token }) });
      const json = await res.json(); if (!res.ok) throw new Error(json.error || "Could not complete this order.");
      if (json.transferred) showToast("Order completed. Payment released to the vendor.", "success");
      else if (json.payoutError) showToast("Order completed. There was a hiccup releasing payment, our team will sort it out.", "info");
      else showToast("Order completed.", "success");
    }
  } catch (err) { showToast(err.message, "error"); }
  navigate("orderDetail", { orderId });
  setTimeout(() => { try { window.maybePromptLevromartReview?.(true); } catch (_) {} }, 900);
}


async function loadCommissionBreakdown(){
  const box=byId("commissionBreakdown");
  if(!box||!vendor?.id)return;
  box.innerHTML='<div class="vendor-commission-breakdown-head">Loading your outstanding commission breakdown…</div>';
  try{
    const {data,error}=await sb.rpc("get_vendor_commission_breakdown",{p_vendor_id:vendor.id});
    if(error)throw error;
    const rows=Array.isArray(data)?data:[];
    if(!rows.length){box.innerHTML='<div class="vendor-commission-breakdown-head">No outstanding commission charges found.</div>';return;}
    const groups=new Map();
    rows.forEach(r=>{
      const key=r.order_id||r.charge_id;
      if(!groups.has(key))groups.set(key,{order_id:r.order_id,sold_at:r.sold_at,buyer_name:r.buyer_name||"Buyer",payment_amount:Number(r.payment_amount||0),commission_amount:Number(r.commission_amount||0),products:[]});
      const g=groups.get(key);
      g.payment_amount=Number(r.payment_amount||0);
      g.commission_amount=Number(r.commission_amount||0);
      if(r.buyer_name)g.buyer_name=r.buyer_name;
      (Array.isArray(r.products)?r.products:[]).forEach(item=>{
        const name=String(item.product_name||"Unnamed product"),unit=Number(item.unit_price||0),qty=Number(item.quantity||0);
        const existing=g.products.find(x=>x.name===name&&x.unit===unit);
        if(existing)existing.qty=Math.max(existing.qty,qty); else g.products.push({name,qty,unit});
      });
    });
    let total=0;
    const cards=[...groups.values()].map(g=>{
      total+=g.commission_amount;
      const date=g.sold_at?new Date(g.sold_at).toLocaleString([], {day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"Date unavailable";
      const lines=g.products.length
        ? g.products.map(x=>`<li>${'<span class="vc-ico"><i class="fa-solid fa-cart-shopping"></i></span>'}<span class="vc-label">${esc(x.qty+"× "+x.name)}</span><span class="vc-amt">${naira(x.qty*x.unit)}</span></li>`).join("")
        : '<li><span class="vc-ico"><i class="fa-solid fa-cart-shopping"></i></span><span class="vc-label">Order items unavailable</span><span class="vc-amt">-</span></li>';
      const autoDispute = g.auto_completed_at ? `<button type="button" class="btn btn-sm btn-outline vendor-commission-dispute-btn" onclick="openCommissionDispute('${esc(g.order_id||"")}')"><i class="fa-solid fa-scale-balanced"></i> Raise dispute</button>` : "";
      return `<div class="vendor-commission-item vc-collapsed">
        <div class="vendor-commission-item-top" role="button" tabindex="0" aria-expanded="false" onclick="toggleCommissionItem(this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleCommissionItem(this)}"><span class="vc-ico"><i class="fa-solid fa-store"></i></span><div class="vc-top-text"><div class="vendor-commission-item-title">${g.products.length===1?esc(g.products[0].name):g.products.length>1?`${g.products.length} products`:"Sale"}</div><div class="vendor-commission-item-date">Completed ${esc(date)}</div></div><strong>${naira(g.commission_amount)}</strong><i class="fa-solid fa-chevron-down vc-item-chev"></i></div>
        <div class="vc-item-body"><div class="vendor-commission-buyer"><span class="vc-ico"><i class="fa-solid fa-user"></i></span><span>Buyer</span><strong>${esc(g.buyer_name||"Buyer")}</strong></div>
        <ul class="vendor-commission-products">${lines}</ul>
        <div class="vendor-commission-math vc-transport"><span class="vc-ico"><i class="fa-solid fa-truck"></i></span><span class="vc-label">Total sale + transportation</span><strong>${naira(g.payment_amount)}</strong></div>
        <div class="vendor-commission-math vc-commission"><span class="vc-ico"><i class="fa-solid fa-percent"></i></span><span class="vc-label">Commission calculation</span><strong>3% × ${naira(g.payment_amount)} = ${naira(g.commission_amount)}</strong></div>
        ${autoDispute}
      </div></div>`;
    }).join("");
    box.innerHTML=`<div class="vendor-commission-breakdown-head"><span class="vc-ico"><i class="fa-solid fa-chart-pie"></i></span><span class="vc-label">Outstanding commission: ${groups.size} sale${groups.size===1?"":"s"}</span><span class="vc-pill">${groups.size} sale${groups.size===1?"":"s"}</span></div><div class="vendor-commission-breakdown-list">${cards}</div><div class="vendor-commission-total"><span class="vc-ico"><i class="fa-solid fa-coins"></i></span><div class="vc-top-text"><span>Total commission owed</span><small>From ${groups.size} sale${groups.size===1?"":"s"}</small></div><strong>${naira(total)}</strong></div><button type="button" class="btn btn-sm vendor-commission-pay-now" onclick="payCommission()"><i class="fa-solid fa-credit-card"></i> Continue to pay ${naira(total)}</button>`;
  }catch(err){
    box.innerHTML=`<div class="vendor-commission-breakdown-head" style="color:var(--danger,#ef4444)">Could not load the commission breakdown. ${esc(err?.message||"Please try again.")}</div>`;
  }
}
function toggleCommissionItem(head){
  const item=head.closest(".vendor-commission-item"); if(!item)return;
  const collapsed=item.classList.toggle("vc-collapsed");
  head.setAttribute("aria-expanded",String(!collapsed));
}
async function openCommissionDispute(orderId){
  if(!orderId)return;
  await navigate("orderDetail",{orderId});
  setTimeout(()=>{
    try{
      const link=[...document.querySelectorAll('a')].find(a=>String(a.textContent||'').toLowerCase().includes('report an issue with this order'));
      if(link){link.click();return;}
      const form=byId('disputeForm');
      if(form)form.classList.remove('hidden');
    }catch(_){}
  },80);
}

async function toggleCommissionBreakdown(){
  const box=byId("commissionBreakdown"),btn=byId("payCommissionBtn");
  if(!box)return;
  const opening=box.classList.contains("hidden");
  box.classList.toggle("hidden",!opening);
  if(btn){
    btn.setAttribute("aria-expanded",String(opening));
    btn.innerHTML=opening?'<i class="fa-solid fa-receipt"></i> Hide commission breakdown':'<i class="fa-solid fa-receipt"></i> Review commission breakdown';
  }
  if(opening)await loadCommissionBreakdown();
}

async function payCommission() {
  const errorEl = byId("commissionError");
  // This function is also called from the global commission-lock popup, where
  // the breakdown button does not exist. Never let a missing button prevent
  // the Paystack checkout from starting.
  const buttons = [...document.querySelectorAll('[onclick*="payCommission()"]')];
  const btn = byId("payCommissionBtn") || buttons.find(b => !b.disabled) || null;
  if (errorEl) errorEl.classList.add("hidden");
  if (btn) btn.disabled = true;
  try {
    if (!session?.access_token) throw new Error("Please sign in again to pay your commission.");
    const res = await fetch("/api/vendor-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pay-commission", accessToken: session.access_token }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not start commission payment.");
    const checkoutUrl = json.authorization_url || json.checkout_url || json.url;
    if (!checkoutUrl) throw new Error("Paystack checkout could not be created. Please try again.");
    // Send the vendor straight to the Paystack checkout returned by the
    // server; there is no intermediate payout/settings page.
    window.location.assign(checkoutUrl);
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message || "Could not start commission payment.";
      errorEl.classList.remove("hidden");
    } else {
      showToast(err.message || "Could not start commission payment.", "error");
    }
    if (btn) btn.disabled = false;
  }
}

async function submitVendorBillingModel(billingModel) {
  const keepScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  const { error } = await sb.rpc("set_vendor_billing_model", { p_billing_model: billingModel });
  if (error) { showToast(error.message, "error"); return; }
  if (vendor) vendor.billing_model = billingModel;
  await navigate("vendorEditProfile", {}, false);
  requestAnimationFrame(() => window.scrollTo({ top: keepScrollY, left: 0, behavior: "auto" }));
}

async function setupMonthlyBilling() {
  const errorEl = byId("billingError");
  const btn = byId("setupBillingBtn");
  errorEl.classList.add("hidden");
  btn.disabled = true;
  try {
    const res = await fetch("/api/vendor-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setup-monthly-billing", accessToken: session.access_token }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not start billing setup.");
    window.location.href = json.authorization_url;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
    btn.disabled = false;
  }
}

async function payOnline(orderId) {
  const errorEl = byId("payOnlineError");
  const btn = byId("payOnlineBtn");
  errorEl.classList.add("hidden");
  btn.disabled = true;
  try {
    const res = await fetch("/api/initiate-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, accessToken: session.access_token }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not start payment.");
    window.location.href = json.authorization_url;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
    btn.disabled = false;
  }
}

async function recordOfflinePayment(orderId, remainingPercent = null) {
  const errorEl = byId("recordPaymentError"); errorEl.classList.add("hidden");
  const paymentType = byId("rpType")?.value; const amount = Number(byId("rpAmount")?.value); const method = byId("rpMethod")?.value;
  if (!paymentType || !Number.isFinite(amount) || amount <= 0 || !method) { errorEl.textContent = "Enter a valid payment amount and method."; errorEl.classList.remove("hidden"); return; }
  const paymentLabel = paymentType === "sale_price" ? "sale price" : paymentType === "rental_fee" ? "rental fee" : paymentType === "delivery_deposit_20" ? "delivery deposit" : "refundable deposit";
  const methodLabel = method === "cash" ? "cash" : "bank transfer";
  const isRemainingDeliveryPayment = paymentType !== "delivery_deposit_20" && paymentType !== "deposit" && byId("rpType")?.value === paymentType && !!byId("rpType")?.closest(".delivery-balance-payment-card");
  const safeRemainingPercent = Number.isFinite(Number(remainingPercent)) ? Number(remainingPercent) : null;
  const confirmMessage = isRemainingDeliveryPayment
    ? `You are confirming the customer's remaining ${safeRemainingPercent ?? 100}% payment of ${naira(amount)} by ${methodLabel}. Only continue if you have actually received this full amount. This will mark the remaining balance as PAID.`
    : `Confirm that you actually received ${naira(amount)} for the ${paymentLabel} by ${methodLabel}. This records the payment as PAID outside Paystack and settles this payment obligation.`;
  if (!(await showConfirmDialog(confirmMessage, { title: isRemainingDeliveryPayment ? `Confirm ${safeRemainingPercent ?? 100}% payment` : "Mark as paid manually", okLabel: isRemainingDeliveryPayment ? `Yes, confirm ${safeRemainingPercent ?? 100}% paid` : "Yes, mark paid" }))) return;
  const { error } = await sb.rpc("record_offline_payment", { p_order_id: orderId, p_payment_type: paymentType, p_amount: amount, p_method: method });
  if (error) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); return; }
  // record_offline_payment atomically marks an eligible final payment as paid and
  // completes the order on the server. Do not issue a second completed transition
  // here; doing so can race the realtime refresh and produce "completed to completed".
  showToast(isRemainingDeliveryPayment ? `${safeRemainingPercent ?? 100}% payment recorded. Order completed.` : "Payment recorded as paid.", "success");
  // Once the vendor records the remaining balance, the payment workflow is done
  // and the order is terminal. Return them directly to their Orders list.
  await navigate(isRemainingDeliveryPayment ? "vendorOrders" : "orderDetail", isRemainingDeliveryPayment ? {} : { orderId });
}

// A buyer-reported manual payment (order.status === "payment_unresolved") is
// its own case, distinct from record_offline_payment() above: it has to
// settle the specific claim the buyer already filed, and -- when it's the
// final payment due -- actually flip the order to completed, which
// record_offline_payment never does.
async function vendorConfirmReportedPayment(orderId) {
  const errorEl = byId("reportedPaymentError");
  if (!(await showConfirmDialog("Confirm that you actually received this payment? This will complete the order if it's the final payment due.", { title: "Confirm payment received", okLabel: "Yes, confirm" }))) return;
  const { data, error } = await sb.rpc("vendor_confirm_reported_payment", { p_order_id: orderId });
  if (error) { if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); } else showToast?.(error.message, "error"); return; }
  showToast?.(data?.order_completed ? "Payment confirmed. Order completed." : "Payment confirmed.", "success");
  await navigate("orderDetail", { orderId }, false);
}
async function vendorDisputeReportedPayment(orderId) {
  const errorEl = byId("reportedPaymentError");
  errorEl?.classList.add("hidden");
  const reason = byId("reportedPaymentDisputeReason")?.value.trim();
  if (!reason) { showToast?.("Please explain why you're disputing this payment.", "error"); return; }
  const { error } = await sb.rpc("vendor_dispute_reported_payment", { p_order_id: orderId, p_reason: reason });
  if (error) { if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); } else showToast?.(error.message, "error"); return; }
  showToast?.("Payment disputed. Levromart will review it.", "success");
  await navigate("orderDetail", { orderId }, false);
}

let vendorReviewModalOrderId = null;
let vendorReviewModalVendorId = null;
let vendorReviewModalOpening = false;
function showVendorReviewModal(orderId, vendorId, vendorName) {
  // Review entry is intentionally inline on the order page; don't interrupt buyers with a popup.
  return;
  if (!session?.user?.id || !orderId || !vendorId) return;
  if (vendorReviewModalOpening) return;
  const modal = byId("vendorReviewModal");
  if (!modal) return;
  vendorReviewModalOrderId = String(orderId);
  vendorReviewModalVendorId = String(vendorId);
  vendorReviewModalOpening = true;
  byId("vendorReviewModalVendor").textContent = `Rate your experience with ${vendorName}.`;
  byId("vendorReviewModalError").classList.add("hidden");
  byId("vendorReviewModalComment").value = "";
  byId("vendorReviewModalRating").value = "5";
  byId("vendorReviewModalStars").innerHTML = starRatingWidgetHtml(5).replace('id="starRatingWidget"','id="vendorReviewModalStarRating"').replace(/onclick="setStarRating\((\d+)\)"/g, 'onclick="setVendorReviewModalRating($1)"').replace(/onmouseenter="previewStars\((\d+)\)"/g, '').replace(/onmouseleave="resetStarPreview\(\)"/g, '');
  modal.classList.remove("hidden");
  vendorReviewModalOpening = false;
}
function closeVendorReviewModal() {
  const modal = byId("vendorReviewModal");
  if (modal) modal.classList.add("hidden");
  vendorReviewModalOrderId = null;
  vendorReviewModalVendorId = null;
}
function setVendorReviewModalRating(n) {
  byId("vendorReviewModalRating").value = n;
  document.querySelectorAll("#vendorReviewModalStarRating i").forEach((el) => el.classList.toggle("active", Number(el.dataset.star) <= n));
  playSound("click");
}
async function submitVendorReviewModal() {
  const orderId = vendorReviewModalOrderId;
  const vendorId = vendorReviewModalVendorId;
  if (!orderId || !vendorId || !session?.user?.id) return;
  const errorEl = byId("vendorReviewModalError");
  const btn = byId("vendorReviewModalSubmit");
  errorEl.classList.add("hidden");
  btn.disabled = true;
  const { error } = await sb.from("reviews").insert({
    order_id: orderId,
    buyer_id: session.user.id,
    vendor_id: vendorId,
    rating: Number(byId("vendorReviewModalRating").value || 5),
    comment: byId("vendorReviewModalComment").value.trim() || null,
  });
  if (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove("hidden");
    btn.disabled = false;
    return;
  }
  closeVendorReviewModal();
  try {
    const key='levromart_review_completed_v1';
    const a=JSON.parse(localStorage.getItem(key)||'[]'); const id=String(orderId);
    if(!a.includes(id)){a.push(id);localStorage.setItem(key,JSON.stringify(a.slice(-250)));}
  } catch (_) {}
  window.__reviewPromptDismissedOrderId=String(orderId);
  window.__closeLevromartReviewPrompt?.();
  forgetOrderPageCaches(orderId);
  showToast("Thanks for reviewing this vendor!", "success");
  navigate("orderDetail", { orderId });
}

function starRatingWidgetHtml(current) {
  let stars = "";
  for (let i = 1; i <= 5; i++) {
    stars += `<i class="fa-solid fa-star${i <= current ? " active" : ""}" data-star="${i}" onclick="setStarRating(${i})" onmouseenter="previewStars(${i})" onmouseleave="resetStarPreview()"></i>`;
  }
  return `<div class="star-rating" id="starRatingWidget">${stars}</div>`;
}
function renderStarPreview(n) {
  document.querySelectorAll("#starRatingWidget i").forEach((el) => el.classList.toggle("active", Number(el.dataset.star) <= n));
}
function setStarRating(n) { byId("reviewRating").value = n; renderStarPreview(n); playSound("click"); }
function previewStars(n) { renderStarPreview(n); }
function resetStarPreview() { renderStarPreview(Number(byId("reviewRating")?.value || 5)); }

function backToPaymentFromReview(orderId) {
  navigate("orderDetail", { orderId }, false).then(() => {
    setTimeout(() => { try { openVendorDirectPayment(orderId); } catch (_) {} }, 60);
  }).catch(() => {});
}

async function renderLeaveReview(orderId) {
  if (!session?.user?.id || !orderId) return '<div class="empty-state">Access denied.</div>';
  const { data: order, error } = await sb.from("orders")
    .select("id,status,buyer_id,vendor_id,order_type,delivery_method,payment_timing,vendor:vendors(id,business_name),payments(payment_type,amount,status,provider_reference,created_at)")
    .eq("id", orderId).eq("buyer_id", session.user.id).maybeSingle();
  if (error || !order) return `<div class="empty-state">${esc(error?.message || "Order not found.")}</div>`;
  const reviewFeeType = order.order_type === "rental" ? "rental_fee" : "sale_price";
  const reviewPaid = (order.payments || []).some(p => String(p.payment_type||"").toLowerCase() === reviewFeeType && p.status === "paid");
  if (order.status !== "completed" || !reviewPaid) {
    return `<div class="card" style="max-width:620px;margin:1rem auto;text-align:center;"><h2 style="margin-top:0;">Payment not verified yet</h2><p class="muted">You can leave a review only after the vendor or Levromart verifies the required payment and the order is completed.</p><button type="button" class="btn btn-sm btn-outline" onclick="navigate('orderDetail',{orderId:'${order.id}'},false)"><i class="fa-solid fa-arrow-left"></i> Back to order</button></div>`;
  }
  const { data: existingReview } = await sb.from("reviews").select("id").eq("order_id", order.id).eq("buyer_id", session.user.id).maybeSingle();
  if (existingReview) return `<div class="card" style="max-width:620px;margin:1rem auto;text-align:center;"><h2 style="margin-top:0;">Review already submitted</h2><p class="muted">You've already reviewed this order.</p><button type="button" class="btn btn-sm btn-outline" onclick="navigate('orderDetail',{orderId:'${order.id}'},false)"><i class="fa-solid fa-arrow-left"></i> Back to order</button></div>`;
  const vendorName = esc(order.vendor?.business_name || "this vendor");
  return `<div class="card leave-review-page" style="max-width:620px;margin:1rem auto;"><div class="banner banner-success" style="margin-bottom:.85rem;text-align:center;"><strong><i class="fa-solid fa-circle-check"></i> Payment verified. Order completed.</strong></div><div style="text-align:center;"><h2 style="margin:0;">Leave a review</h2><p class="muted" style="margin:.35rem 0 1rem;">How was your experience with ${vendorName}?</p></div><div id="reviewError" class="error-text hidden"></div>${starRatingWidgetHtml(5)}<input type="hidden" id="reviewRating" value="5" /><textarea id="reviewComment" rows="4" placeholder="Tell us about your experience with the order and vendor…"></textarea><div class="leave-review-actions" style="display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap;margin-top:.8rem;"><button type="button" class="btn btn-sm btn-outline" onclick="navigate('orderDetail',{orderId:'${order.id}'},false)"><i class="fa-solid fa-arrow-left"></i> Back to order</button><button type="button" class="btn btn-sm" onclick="submitReview('${order.id}','${order.vendor?.id || order.vendor_id}')"><i class="fa-solid fa-paper-plane"></i> Submit review</button></div></div>`;
}

// Once a buyer has reviewed an order, nothing on the order page should ask for a review again, even from a cached copy.
function orderHasReview(order) {
  if (!order) return false;
  if (Array.isArray(order.review) ? order.review.length > 0 : !!order.review) return true;
  try { return JSON.parse(localStorage.getItem("levromart_review_completed_v1") || "[]").includes(String(order.id)); } catch (_) { return false; }
}
function forgetOrderPageCaches(orderId) {
  const id = String(orderId || ""); if (!id) return;
  try { for (const k of [...routeHtmlCache.keys()]) if (k.startsWith("orderDetail:") && k.includes(id)) routeHtmlCache.delete(k); } catch (_) {}
  for (const store of [sessionStorage, localStorage]) {
    try { for (const k of Object.keys(store)) if (k.startsWith(ROUTE_HTML_SNAPSHOT_PREFIX + "orderDetail:") && k.includes(id)) store.removeItem(k); } catch (_) {}
  }
}
async function submitReview(orderId, vendorId) {
  const errorEl = byId("reviewError");
  errorEl.classList.add("hidden");
  const { error } = await sb.from("reviews").insert({
    order_id: orderId, buyer_id: session.user.id, vendor_id: vendorId,
    rating: Number(byId("reviewRating").value),
    comment: byId("reviewComment").value.trim() || null,
  });
  if (error) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); return; }
  try {
    const key='levromart_review_completed_v1';
    const a=JSON.parse(localStorage.getItem(key)||'[]'); const id=String(orderId);
    if(!a.includes(id)){a.push(id);localStorage.setItem(key,JSON.stringify(a.slice(-250)));}
  } catch (_) {}
  window.__reviewPromptDismissedOrderId=String(orderId);
  window.__closeLevromartReviewPrompt?.();
  forgetOrderPageCaches(orderId);
  byId("reviewError")?.closest(".card")?.remove();
  navigate("orderDetail", { orderId });
}

