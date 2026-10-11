// ---------- REQUEST FORM HANDLERS ----------
function updateRequestFormFields() {
  const type = document.querySelector('input[name="reqType"]:checked')?.value || "buy";
  const wrap = byId("reqDatesWrap");
  if (wrap) wrap.classList.toggle("hidden", type === "buy");
  if (type === "buy") {
    const from = byId("reqFrom");
    const to = byId("reqTo");
    if (from) from.value = "";
    if (to) to.value = "";
  }
}

function requestSectorRows() {
  const all = Array.isArray(sectors) ? sectors : [];
  return all.filter(Boolean);
}
function closeRequestSectorPicker() {
  document.getElementById("reqSectorPickerModal")?.remove();
  byId("reqSectorPicker")?.setAttribute("aria-expanded", "false");
}
function openRequestSectorPicker(event) {
  event?.preventDefault?.(); event?.stopPropagation?.();
  const existing = document.getElementById("reqSectorPickerModal");
  if (existing) { closeRequestSectorPicker(); return; }
  const rows = requestSectorRows();
  const selected = byId("reqSector")?.value || "";
  const modal = document.createElement("div");
  modal.id = "reqSectorPickerModal";
  modal.className = "req-sector-picker-modal";
  modal.innerHTML = `<div class="req-sector-picker-sheet" role="dialog" aria-modal="true" aria-label="Choose request sector">
    <div class="req-category-picker-head"><div><strong>Choose a sector</strong><small>Search the sectors already available on Levromart.</small></div><button type="button" class="icon-btn" aria-label="Close" onclick="closeRequestSectorPicker()"><i class="fa-solid fa-xmark"></i></button></div>
    <div class="req-category-search req-sector-search"><i class="fa-solid fa-magnifying-glass"></i><input id="reqSectorSearch" type="search" autocomplete="off" placeholder="Search sectors…" /></div>
    <div id="reqSectorResults" class="req-category-results"></div>
  </div>`;
  document.body.appendChild(modal);
  byId("reqSectorPicker")?.setAttribute("aria-expanded", "true");
  const render = () => {
    const q = String(byId("reqSectorSearch")?.value || "").trim().toLowerCase();
    const filtered = rows.filter(r => !q || String(r.name || "").toLowerCase().includes(q));
    const results = byId("reqSectorResults");
    if (!results) return;
    results.innerHTML = `<button type="button" class="req-picker-row ${!selected ? "selected" : ""}" data-value=""><span>Any</span><i class="fa-solid fa-check"></i></button>` + filtered.map(item => `<button type="button" class="req-picker-row ${String(item.id)===String(byId("reqSector")?.value||"")?"selected":""}" data-value="${esc(item.id)}"><span>${esc(item.name)}</span><i class="fa-solid fa-check"></i></button>`).join("") || `<div class="req-category-empty">No matching sectors.</div>`;
    results.querySelectorAll(".req-picker-row").forEach(btn => btn.addEventListener("click", () => {
      const value = btn.dataset.value || "";
      if (byId("reqSector")) byId("reqSector").value = value;
      const sector = rows.find(r => String(r.id) === String(value));
      if (byId("reqSectorLabel")) byId("reqSectorLabel").textContent = sector?.name || "Any";
      closeRequestSectorPicker();
      updateRequestCategoryOptions();
    }));
  };
  modal.addEventListener("click", e => { if (e.target === modal) closeRequestSectorPicker(); });
  byId("reqSectorSearch")?.addEventListener("input", render);
  setTimeout(() => { byId("reqSectorSearch")?.focus(); }, 30);
  render();
}
function requestCategoryRows() {
  const all = Array.isArray(window.__categories) ? window.__categories : [];
  const sectorId = byId("reqSector")?.value || "";
  return all.filter(c => c.parent_category_id && (!sectorId || String(c.sector_id || "") === String(sectorId)));
}
function updateRequestCategoryOptions() {
  const current = byId("reqCategory")?.value || "";
  const rows = requestCategoryRows();
  const valid = rows.some(c => String(c.id) === String(current));
  if (!valid) {
    if (byId("reqCategory")) byId("reqCategory").value = "";
    if (byId("reqCategoryLabel")) byId("reqCategoryLabel").textContent = "Choose one…";
  } else {
    const selected = rows.find(c => String(c.id) === String(current));
    if (selected && byId("reqCategoryLabel")) byId("reqCategoryLabel").textContent = selected.name;
  }
}
function closeRequestCategoryPicker() {
  document.getElementById("reqCategoryPickerModal")?.remove();
  byId("reqCategoryPicker")?.setAttribute("aria-expanded", "false");
}
function openRequestCategoryPicker(event) {
  event?.preventDefault?.(); event?.stopPropagation?.();
  const existing = document.getElementById("reqCategoryPickerModal");
  if (existing) { closeRequestCategoryPicker(); return; }
  const rows = requestCategoryRows();
  const selected = byId("reqCategory")?.value || "";
  const modal = document.createElement("div");
  modal.id = "reqCategoryPickerModal";
  modal.className = "req-category-picker-modal";
  modal.innerHTML = `<div class="req-category-picker-sheet" role="dialog" aria-modal="true" aria-label="Choose request category">
    <div class="req-category-picker-head"><div><strong>Choose a category</strong><small>Search the categories already available on Levromart.</small></div><button type="button" class="icon-btn" aria-label="Close" onclick="closeRequestCategoryPicker()"><i class="fa-solid fa-xmark"></i></button></div>
    <div class="req-category-search"><i class="fa-solid fa-magnifying-glass"></i><input id="reqCategorySearch" type="search" autocomplete="off" placeholder="Search rice, phone, medical…" /></div>
    <div id="reqCategoryResults" class="req-category-results"></div>
  </div>`;
  document.body.appendChild(modal);
  byId("reqCategoryPicker")?.setAttribute("aria-expanded", "true");
  const render = () => {
    const q = String(byId("reqCategorySearch")?.value || "").trim().toLowerCase();
    const filtered = rows.filter(c => {
      const text = `${c.name || ""} ${c.description || ""}`.toLowerCase();
      return !q || text.includes(q);
    });
    const results = byId("reqCategoryResults");
    if (!results) return;
    results.innerHTML = filtered.length ? filtered.map(c => `<button type="button" class="req-category-option ${String(c.id)===String(selected)?"selected":""}" data-category-id="${esc(c.id)}"><span><strong>${esc(c.name)}</strong>${c.description ? `<small>${esc(c.description)}</small>` : ""}</span><i class="fa-solid ${String(c.id)===String(selected)?"fa-circle-check":"fa-chevron-right"}"></i></button>`).join("") : `<div class="req-category-empty">No matching existing categories.</div>`;
    results.querySelectorAll(".req-category-option").forEach(btn => btn.addEventListener("click", () => {
      const id = btn.dataset.categoryId;
      const item = rows.find(c => String(c.id) === String(id));
      if (!item) return;
      byId("reqCategory").value = item.id;
      byId("reqCategoryLabel").textContent = item.name;
      closeRequestCategoryPicker();
    }));
  };
  byId("reqCategorySearch")?.addEventListener("input", render);
  modal.addEventListener("click", e => { if (e.target === modal) closeRequestCategoryPicker(); });
  render();
  setTimeout(() => byId("reqCategorySearch")?.focus(), 30);
}

async function submitEquipmentRequest() {
  if (!session?.user?.id) {
    showToast("Please log in to post a request.", "error");
    return;
  }
  const btn = document.querySelector('#app button[onclick="submitEquipmentRequest()"]');
  const errorEl = byId("reqError");
  const type = document.querySelector('input[name="reqType"]:checked')?.value || "buy";
  const title = String(byId("reqTitle")?.value || "").trim();
  const description = String(byId("reqDesc")?.value || "").trim();
  const categoryId = byId("reqCategory")?.value || "";
  const city = String(byId("reqCity")?.value || "").trim();
  const neededFrom = byId("reqFrom")?.value || null;
  const neededTo = byId("reqTo")?.value || null;

  if (errorEl) { errorEl.textContent = ""; errorEl.classList.add("hidden"); }
  if (!title) {
    if (errorEl) { errorEl.textContent = "Please tell us what you need."; errorEl.classList.remove("hidden"); }
    byId("reqTitle")?.focus();
    return;
  }
  if (!categoryId) {
    if (errorEl) { errorEl.textContent = "Please choose a category."; errorEl.classList.remove("hidden"); }
    byId("reqCategory")?.focus();
    return;
  }
  if (type === "rent" && neededFrom && neededTo && neededTo < neededFrom) {
    if (errorEl) { errorEl.textContent = "The rental end date cannot be before the start date."; errorEl.classList.remove("hidden"); }
    byId("reqTo")?.focus();
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Posting…'; }
  try {
    const photoUrls = [];
    const picked = Array.isArray(window.__reqPhotos) ? window.__reqPhotos : [];
    for (let i = 0; i < picked.length; i++) {
      if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Uploading photo ${i + 1}/${picked.length}…`;
      const url = await uploadToR2(picked[i].file, `product-photos/requests/${session.user.id}/${Date.now()}-${i}.jpg`, "image/jpeg");
      photoUrls.push(url);
    }
    // Do not chain .select() onto the insert. An INSERT can be permitted by
    // RLS while the follow-up SELECT is not; that made successful requests
    // look like they had failed on some accounts. The request is reloaded
    // from the normal request view immediately after this insert.
    const { error } = await sb.from("equipment_requests").insert({
      buyer_id: session.user.id,
      title,
      description: description || null,
      category_id: categoryId || null,
      city: city || null,
      needed_from: type === "rent" ? (neededFrom || null) : null,
      needed_to: type === "rent" ? (neededTo || null) : null,
      request_type: type,
      photos: photoUrls,
      campus_id: (() => { const c = window.lvMyCampusId ? window.lvMyCampusId() : ""; return c && c !== "none" ? c : null; })(),
      buyer_name: profile?.name || session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || null,
      buyer_avatar_url: profile?.avatar_url || session.user.user_metadata?.avatar_url || null,
    });
    if (error) throw error;
    showToast(type === "buy" ? "Buy request posted successfully." : "Rental request posted successfully.", "success");
    await navigate("requestEquipment");
    // Keep dates/controls correct after the route re-renders.
    setTimeout(updateRequestFormFields, 0);
    return true;
  } catch (err) {
    console.error("[Levromart] Equipment request failed:", err);
    if (errorEl) {
      errorEl.textContent = err?.message || "Your request could not be posted right now.";
      errorEl.classList.remove("hidden");
    }
    showToast(err?.message || "Your request could not be posted.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "Post request"; }
  }
}

async function cancelEquipmentRequest(requestId) {
  if (!session?.user?.id || !requestId) return;
  const { error } = await sb.from("equipment_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .eq("buyer_id", session.user.id)
    .eq("status", "open");
  if (error) { showToast(error.message || "Couldn’t cancel the request.", "error"); return; }
  showToast("Request cancelled.", "success");
  navigate("requestEquipment", {}, { replace: true });
}

