// ---------- ORDER NOTES ----------
// A small, limited note channel on an order (max 500 chars, 10 per side) so a
// customer and vendor can sort out the practical bits without an open chat.
async function loadOrderNotes(orderId) {
  const { data } = await sb.from("order_notes").select("id,sender_id,body,created_at").eq("order_id", orderId).order("created_at", { ascending: true }).limit(60);
  return data || [];
}
function orderNoteRowsHtml(notes, isCustomer) {
  if (!notes.length) return '<p class="muted" style="margin:.2rem 0 .6rem;font-size:.85rem;">No notes yet.</p>';
  return `<div class="order-notes-list">${notes.map((n) => {
    const mine = n.sender_id === session?.user?.id;
    const who = mine ? "You" : (isCustomer ? "Vendor" : "Customer");
    const when = new Date(n.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return `<div class="order-note ${mine ? "mine" : "theirs"}"><span class="order-note-who">${esc(who)} · ${esc(when)}</span><p>${linkifyChatText(maskSensitiveNumbers(n.body))}</p></div>`;
  }).join("")}</div>`;
}
async function hydrateOrderNotes(orderId) {
  const card = byId("orderNotesCard");
  if (!card || card.dataset.orderId !== String(orderId)) return;
  let notes = [];
  try { notes = await loadOrderNotes(orderId); } catch (_) {}
  const open = card.dataset.open === "1";
  if (!notes.length && !open) return;
  const isCustomer = card.dataset.isCustomer === "1";
  card.classList.remove("hidden");
  card.innerHTML = `<h3 style="margin-top:0;"><i class="fa-regular fa-note-sticky"></i> Notes</h3>${orderNoteRowsHtml(notes, isCustomer)}${open ? `<button type="button" class="btn btn-sm btn-outline" onclick="openOrderNoteBox('${esc(orderId)}')"><i class="fa-solid fa-pen"></i> ${notes.length ? (isCustomer ? "Add a note" : "Reply") : (isCustomer ? "Send a note to vendor" : "Send a note")}</button>` : ""}`;
}
async function openOrderNoteBox(orderId) {
  if (!session) { showLogin(); return; }
  byId("orderNoteModal")?.remove();
  const card = byId("orderNotesCard");
  const isCustomer = card ? card.dataset.isCustomer === "1" : true;
  const modal = document.createElement("div");
  modal.id = "orderNoteModal";
  modal.className = "modal open";
  modal.innerHTML = `<div class="modal-content order-note-modal">
    <div class="modal-header"><h3><i class="fa-regular fa-note-sticky"></i> ${isCustomer ? "Note to vendor" : "Reply"}</h3><button type="button" class="icon-btn" aria-label="Close" onclick="byId('orderNoteModal')?.remove()"><i class="fa-solid fa-xmark"></i></button></div>
    <div id="orderNoteThread" class="order-note-thread"><p class="muted" style="font-size:.85rem;">Loading…</p></div>
    <textarea id="orderNoteInput" rows="3" maxlength="500" placeholder="${isCustomer ? "Write a short note for the vendor…" : "Write your reply…"}"></textarea>
    <p id="orderNoteError" class="error-text hidden"></p>
    <div class="flex" style="justify-content:flex-end;gap:.5rem;margin-top:.6rem;"><button type="button" class="btn btn-sm btn-outline" onclick="byId('orderNoteModal')?.remove()">Cancel</button><button type="button" class="btn btn-sm" id="orderNoteSendBtn" onclick="sendOrderNote('${esc(orderId)}',${isCustomer ? "true" : "false"})"><i class="fa-solid fa-paper-plane"></i> Send note</button></div>
  </div>`;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  try {
    const notes = await loadOrderNotes(orderId);
    const t = byId("orderNoteThread");
    if (t) t.innerHTML = notes.length ? orderNoteRowsHtml(notes, isCustomer) : "";
  } catch (_) { const t = byId("orderNoteThread"); if (t) t.innerHTML = ""; }
  setTimeout(() => byId("orderNoteInput")?.focus(), 50);
}
async function sendOrderNote(orderId, isCustomer) {
  const input = byId("orderNoteInput"), err = byId("orderNoteError"), btn = byId("orderNoteSendBtn");
  if (!input || !btn) return;
  const raw = input.value.trim();
  err?.classList.add("hidden");
  if (!raw) { if (err) { err.textContent = "Write something first."; err.classList.remove("hidden"); } return; }
  const safe = maskOrBlockContactInfo(raw);
  if (safe === null) { if (err) { err.textContent = "Please keep phone numbers and outside contact details out of notes."; err.classList.remove("hidden"); } return; }
  btn.disabled = true;
  try {
    const { error } = await sb.rpc("add_order_note", { p_order_id: orderId, p_body: safe });
    if (error) throw error;
    byId("orderNoteModal")?.remove();
    showToast(isCustomer ? "Note sent to the vendor." : "Reply sent.", "success");
    hydrateOrderNotes(orderId);
  } catch (e) {
    if (err) { err.textContent = e.message || "Couldn't send the note. Please try again."; err.classList.remove("hidden"); }
    btn.disabled = false;
  }
}

// The list/table switch is gone: orders are always shown as cards.
function orderListControlsHtml(total) { return ""; }
function setOrderListView(mode) {
  orderListViewMode = "cards";
  renderOrderListWrap();
}
function toggleOrderListExpanded() {
  orderListExpanded = !orderListExpanded;
  renderOrderListWrap();
}
function renderOrderListWrap() {
  const wrap = byId("orderListWrap");
  if (!wrap) return;
  wrap.innerHTML = orderListHtml(
    window.__orderListOrders || [],
    !!window.__orderListIsCustomer,
    window.__orderListSourcePerspective || null
  );
}
function orderListHtml(orders, isCustomerView, sourcePerspective = null) {
  if (!orders || orders.length === 0) {
    const onlyHistory = isCustomerView && window.__orderHistoryEmpty === false;
    const steps = isCustomerView
      ? [["fa-magnifying-glass", "Find it", "Browse products and services from campus vendors", "#6d28d9"], ["fa-hand-holding-dollar", "Pay safely", "Pay the vendor and report it in the app", "#e11d48"], ["fa-box-open", "Get it", "Confirm when it arrives and rate the vendor", "#0e7490"]]
      : [["fa-share-nodes", "Share your shop", "Send your storefront link to buyers", "#6d28d9"], ["fa-bell", "Get orders", "You are notified the moment someone orders", "#e11d48"], ["fa-sack-dollar", "Get paid", "Confirm payment and hand the order over", "#0e7490"]];
    const acts = isCustomerView
      ? `<div class="oe-actions"><button type="button" class="btn" onclick="navigate('home')"><i class="fa-solid fa-bag-shopping"></i> Start shopping</button><button type="button" class="btn btn-outline" onclick="navigate('vendors')"><i class="fa-solid fa-store"></i> Find vendors</button></div>`
      : "";
    const stepHtml = `<div class="oe-steps">${steps.map((x, i) => `<div class="oe-step" style="--oe:${x[3]};animation-delay:${i * 90}ms"><span class="oe-ico"><i class="fa-solid ${x[0]}"></i></span><b>${x[1]}</b><small>${x[2]}</small></div>`).join("")}</div>`;
    return `<div class="empty-state orders-empty orders-empty-live"><span class="orders-empty-icon oe-float">${typeof lvIllus === "function" ? lvIllus("box", 84) : '<i class="fa-solid fa-box-open"></i>'}</span><strong>${onlyHistory ? "No active orders" : "No orders yet"}</strong><span class="muted">${onlyHistory ? "Finished orders are under History." : isCustomerView ? "Orders you place will show up here." : "Orders from your customers will show up here."}</span>${acts}${stepHtml}</div>`;
  }
  const total = orders.length;
  const shown = orderListExpanded ? orders : orders.slice(0, ORDER_LIST_PAGE_SIZE);
  const moreBtn = total > ORDER_LIST_PAGE_SIZE
    ? `<button class="btn btn-sm btn-outline" style="width:100%;margin-top:0.5rem;" onclick="toggleOrderListExpanded()">${orderListExpanded ? `<i class="fa-solid fa-chevron-up"></i> Show less` : `<i class="fa-solid fa-chevron-down"></i> Show all ${total} orders`}</button>`
    : "";
  if (orderListViewMode === "table") {
    return `<div class="table-wrap" style="max-height:26rem;overflow-y:auto;"><table class="data-table"><thead><tr>
      <th>${isCustomerView ? "Vendor" : "Customer"}</th><th>Type</th><th>Amount</th><th>Date</th><th>Status</th>
    </tr></thead><tbody>${shown.map((o) => `<tr onclick="navigate('orderDetail',{orderId:'${o.id}'${sourcePerspective ? `,source:'${sourcePerspective}'` : ''}})" style="cursor:pointer;">
      <td>${isCustomerView ? esc(o.vendor?.business_name || "") : esc(o.buyer?.name || "")}</td>
      <td style="text-transform:capitalize;">${esc(o.order_type)}</td>
      <td>${naira(o.total_amount)}</td>
      <td>${orderActivityIso(o) ? esc(orderActivityLabel(o)) : ""}</td>
      <td><span class="badge ${orderStatusBadgeClass(o.status)}">${o.status.replace("_", " ")}</span></td>
    </tr>`).join("")}</tbody></table></div>${moreBtn}`;
  }
  return shown.map((o) => {
    const itemNames = (o.items || []).map((it) => `${it.product?.name || "Item"}${Number(it.quantity || 0) > 1 ? ` ×${it.quantity}` : ""}`).join(", ");
    const productIds = [...new Set((o.items || []).map((it) => it.product?.id || it.product_id).filter(Boolean))].join(", ");
    const partyName = isCustomerView ? (o.vendor?.business_name || "Vendor") : (o.buyer?.name || "Customer");
    const orderNumber = o.id ? `#${String(o.id).slice(0, 8).toUpperCase()}` : "";
    const firstItem = (o.items || [])[0];
    const itemPhoto = firstItem?.product?.photos?.[0];
    const fallbackPhoto = isCustomerView ? o.vendor?.logo_url : "";
    const mediaHtml = (itemPhoto || fallbackPhoto)
      ? `<img src="${esc(itemPhoto || fallbackPhoto)}" alt="" loading="lazy" decoding="async" draggable="false">`
      : `<i class="fa-solid ${firstItem?.product?.is_service ? "fa-hand-holding-heart" : "fa-box"}"></i>`;
    const locationText = isCustomerView ? (o.vendor?.city || "") : (o.delivery_address || (o.delivery_method === "pickup" ? "Pickup" : ""));
    return `<button type="button" class="order-list-card" onclick="navigate('orderDetail',{orderId:'${o.id}'${sourcePerspective ? `,source:'${sourcePerspective}'` : ''}})"><span class="order-card-media">${mediaHtml}</span><span class="order-list-main"><span class="order-card-top-row">${orderNumber ? `<small class="order-card-number">${esc(orderNumber)}</small>` : ""}${orderActivityIso(o) ? `<small class="order-card-date"><i class="fa-regular fa-clock"></i> ${esc(orderActivityLabel(o))}</small>` : ""}</span><strong>${isCustomerView ? esc(partyName) : `Customer: ${esc(partyName)}`}</strong><span>Order: ${esc(o.order_type)} · ${naira(o.total_amount)}</span>${!isCustomerView && itemNames ? `<span class="order-list-item">Item: ${esc(itemNames)}</span>` : ""}${!isCustomerView && productIds ? `<small class="order-list-product-id">Product ID: ${esc(productIds)}</small>` : ""}${locationText ? `<small class="order-card-location"><i class="fa-solid fa-location-dot"></i> ${esc(locationText)}</small>` : ""}</span><span class="badge ${lvOrderStageLabel(o) ? "order-status-badge-paid" : orderStatusBadgeClass(o.status)} order-list-status">${esc(lvOrderStageLabel(o)) || (o.status === "cancelled" ? "Cancelled" : o.status === "completed" ? "Completed" : esc(o.status.replace("_", " ")))}</span></button>`;
  }).join("") + moreBtn;
}

