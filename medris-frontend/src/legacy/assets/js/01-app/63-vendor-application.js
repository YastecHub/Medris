// ---------- VENDOR APPLICATION ----------
function filterVendorApplySectors() {
  const select = byId("vaSector");
  const q = String(byId("vaSectorSearch")?.value || "").trim().toLowerCase();
  if (!select) return;
  const current = select.value;
  const options = Array.isArray(window.__vendorApplySectorOptions) ? window.__vendorApplySectorOptions : [];
  const filtered = q ? options.filter((sector) => String(sector.name || "").toLowerCase().includes(q)) : options;
  select.innerHTML = `<option value="">Select a sector</option>${filtered.map((sector) => `<option value="${sector.id}">${esc(sector.name)}</option>`).join("")}<option value="__other__">Other +</option>`;
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  if (select.value === "__other__") toggleVendorOtherSector();
}
function toggleVendorOtherSector() {
  const other = byId("vaSector")?.value === "__other__";
  byId("vaOtherSectorWrap")?.classList.toggle("hidden", !other);
  if (other) setTimeout(() => byId("vaOtherSector")?.focus(), 0);
  else if (byId("vaOtherSector")) byId("vaOtherSector").value = "";
}
async function renderVendorApply() {
  if (!session) return '<div class="empty-state">Please log in to apply as a vendor.</div>';
  if (profile?.role === "admin") return '<div class="empty-state">Admin accounts can\'t own a vendor store on Levromart.</div>';
  const { data: existing } = await sb.from("vendors").select("id").eq("user_id", session.user.id).is("deleted_at", null).maybeSingle();
  if (existing) { navigate("vendorDashboard"); return '<p class="muted">Redirecting…</p>'; }

  if (!sectors.length) { const { data } = await levroData.catalogue.sectors("name"); sectors = data || []; }
  const normalSectorMap = new Map();
  (sectors || []).forEach((sector) => {
    const name = String(sector?.name || "").trim();
    const slug = String(sector?.slug || "").trim().toLowerCase();
    if (!name || name.toLowerCase() === "other" || slug === "other") return;
    if (!normalSectorMap.has(name.toLowerCase())) normalSectorMap.set(name.toLowerCase(), sector);
  });
  const vendorApplySectorOptions = [...normalSectorMap.values()].sort((a,b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
  window.__vendorApplySectorOptions = vendorApplySectorOptions;
  setTimeout(loadVendorApplyPayoutBankOptions, 0);
  return `<div class="card vendor-application-form" style="max-width:480px;margin:0 auto;">
    <h2>Apply as a vendor</h2>
    <p class="muted">Tell us about your business. An admin will review this manually.</p>
    <div id="vendorApplyError" class="error-text hidden"></div>
    <label>Which sector is your business in? *</label>
    <input id="vaSectorSearch" type="search" placeholder="Search business sectors..." autocomplete="off" oninput="filterVendorApplySectors()" />
    <select id="vaSector" onchange="toggleVendorOtherSector()"><option value="">Select a sector</option>${vendorApplySectorOptions.map((sec) => `<option value="${sec.id}">${esc(sec.name)}</option>`).join("")}<option value="__other__">Other +</option></select>
    <div id="vaOtherSectorWrap" class="hidden" style="margin-top:.45rem;"><input id="vaOtherSector" type="text" placeholder="Enter your business sector..." autocomplete="off" /></div>
    <label>Business name *</label><input id="vaBusinessName" />
    <label>Address (leave blank if you're an online-only business)</label><input id="vaAddress" />
    <label>City</label><input id="vaCity" value="Lagos" />
    <label>Phone *</label><input id="vaPhone" type="tel" />
    <label>WhatsApp number</label><input id="vaWhatsapp" type="tel" />
    <label>CAC number</label><input id="vaCac" />
    <label>CAC document (optional upload)</label><input id="vaDoc" type="file" accept="application/pdf,image/*" />
    <label>About your business</label><textarea id="vaBio" rows="3" placeholder="If you're online-only, mention that here: how buyers reach you, delivery area, etc."></textarea>
    <h3 style="margin-top:1.2rem;">Payout account (optional)</h3>
    <p class="muted" style="margin:0 0 .5rem;">Add this now and your payouts are ready the moment your application is approved, no separate step afterward. You can also skip this and set it up later.</p>
    <label>Bank</label>
    <button type="button" id="vaPayoutBankPickerBtn" class="bank-picker-trigger" onclick="openVendorApplyPayoutBankPicker()" aria-haspopup="dialog" aria-expanded="false">
      <span id="vaPayoutBankPickerLabel">Select a bank (optional)</span>
      <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
    </button>
    <select id="vaPayoutBankCode" class="hidden" aria-hidden="true" tabindex="-1">${NIGERIAN_BANKS.map((b) => `<option value="${esc(b.code)}">${esc(b.name)}</option>`).join("")}</select>
    <label>Account number</label>
    <input id="vaPayoutAccountNumber" inputmode="numeric" maxlength="10" placeholder="10-digit account number (optional)" />
    <button class="btn" style="margin-top:0.8rem;" onclick="submitVendorApply()">Submit application</button>
  </div>`;
}
function renderVendorApplyPayoutBankPicker() {
  const select = byId("vaPayoutBankCode");
  const label = byId("vaPayoutBankPickerLabel");
  if (!select || !label) return;
  const selected = select.options[select.selectedIndex];
  label.textContent = selected?.textContent?.trim() || getBankDisplayName(select.value, "") || "Select a bank (optional)";
}
function closeVendorApplyPayoutBankPicker() {
  byId("vendorApplyPayoutBankPickerModal")?.remove();
  byId("vaPayoutBankPickerBtn")?.setAttribute("aria-expanded", "false");
}
function selectVendorApplyPayoutBank(code, name) {
  const select = byId("vaPayoutBankCode");
  if (!select) return;
  const option = Array.from(select.options).find((o) => String(o.value) === String(code));
  if (!option) return;
  select.value = String(code);
  const label = byId("vaPayoutBankPickerLabel");
  if (label) label.textContent = name || option.textContent.trim();
  closeVendorApplyPayoutBankPicker();
}
function openVendorApplyPayoutBankPicker() {
  const select = byId("vaPayoutBankCode");
  if (!select) return;
  closeVendorApplyPayoutBankPicker();
  const banks = Array.from(select.options)
    .map((o) => ({ code: o.value, name: o.textContent.trim() }))
    .filter((b) => b.code && b.name)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const modal = document.createElement("div");
  modal.id = "vendorApplyPayoutBankPickerModal";
  modal.className = "modal vendor-bank-picker-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="modal-content vendor-bank-picker-content">
      <div class="vendor-bank-picker-head">
        <div>
          <div class="vendor-bank-picker-title"><i class="fa-solid fa-building-columns"></i><span>Select payout bank</span></div>
          <div class="muted" style="font-size:.76rem;margin-top:.2rem;">${banks.length} supported banks and financial institutions</div>
        </div>
        <button type="button" class="drawer-close-btn" onclick="closeVendorApplyPayoutBankPicker()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="vendor-bank-search-wrap">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input id="vaPayoutBankSearch" class="vendor-bank-search" type="search" autocomplete="off" placeholder="Search bank..." aria-label="Search banks" />
      </div>
      <div id="vaPayoutBankPickerList" class="vendor-bank-picker-list"></div>
    </div>`;
  document.body.appendChild(modal);
  const listEl = byId("vaPayoutBankPickerList");
  const searchEl = byId("vaPayoutBankSearch");
  const selectedCode = String(select.value || "");
  const paint = () => {
    const q = String(searchEl?.value || "").trim().toLowerCase();
    const filtered = banks.filter((b) => !q || b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q));
    listEl.innerHTML = filtered.length
      ? filtered.map((b) => `<button type="button" class="vendor-bank-option ${String(b.code) === selectedCode ? "selected" : ""}" onclick="selectVendorApplyPayoutBank('${esc(b.code)}','${esc(b.name)}')"><span class="vendor-bank-option-icon"><i class="fa-solid fa-building-columns"></i></span><span class="vendor-bank-option-main"><strong>${esc(b.name)}</strong><small>${esc(b.code)}</small></span>${String(b.code) === selectedCode ? '<i class="fa-solid fa-circle-check vendor-bank-option-check"></i>' : '<i class="fa-solid fa-chevron-right vendor-bank-option-arrow"></i>'}</button>`).join("")
      : `<div class="empty-state" style="padding:2rem 1rem;">No bank matches your search.</div>`;
  };
  searchEl?.addEventListener("input", paint);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeVendorApplyPayoutBankPicker(); });
  paint();
  requestAnimationFrame(() => {
    byId("vaPayoutBankPickerBtn")?.setAttribute("aria-expanded", "true");
    searchEl?.focus();
  });
}
async function loadVendorApplyPayoutBankOptions() {
  const select = byId("vaPayoutBankCode");
  if (!select) return;
  try {
    const res = await fetch("/api/vendor-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list-banks", country: "nigeria", currency: "NGN", perPage: 100 }),
    });
    const json = await res.json();
    if (!res.ok || !Array.isArray(json.banks) || !json.banks.length) throw new Error("Bank list unavailable");
    const banks = normaliseBankList(json.banks);
    if (!banks.length) throw new Error("Bank list unavailable");
    select.innerHTML = banks.map((b) => `<option value="${esc(b.code)}">${esc(b.name)}</option>`).join("");
    renderVendorApplyPayoutBankPicker();
  } catch (e) {
    // The hardcoded NIGERIAN_BANKS fallback already rendered in the HTML
    // stays as-is if the live Paystack list can't be reached.
  }
}

async function submitVendorApply() {
  const errorEl = byId("vendorApplyError");
  errorEl.classList.add("hidden");
  const business_name = byId("vaBusinessName").value.trim();
  const address = byId("vaAddress").value.trim();
  const phone = byId("vaPhone").value.trim();
  const sectorSelection = byId("vaSector")?.value || "";
  const customSector = byId("vaOtherSector")?.value.trim() || "";
  if (!business_name || !phone) {
    errorEl.textContent = "Business name and phone are required.";
    errorEl.classList.remove("hidden");
    return;
  }
  if (!sectorSelection) {
    errorEl.textContent = "Please select your business sector.";
    errorEl.classList.remove("hidden");
    return;
  }
  if (sectorSelection === "__other__" && !customSector) {
    errorEl.textContent = "Enter your business sector to continue.";
    errorEl.classList.remove("hidden");
    return;
  }

  // Payout details on this form are optional, but if either half was
  // touched, both must be valid -- a bank chosen with no account number
  // (or vice versa) can't be turned into a subaccount.
  const payoutBankCode = String(byId("vaPayoutBankCode")?.value || "").trim();
  const payoutBankName = String(byId("vaPayoutBankPickerLabel")?.textContent || "").trim();
  const payoutAccountNumber = String(byId("vaPayoutAccountNumber")?.value || "").trim();
  const wantsPayoutSetup = !!(payoutBankCode || payoutAccountNumber);
  if (wantsPayoutSetup && (!payoutBankCode || !/^\d{10}$/.test(payoutAccountNumber))) {
    errorEl.textContent = "Choose a bank and enter a valid 10-digit account number, or leave both payout fields blank.";
    errorEl.classList.remove("hidden");
    return;
  }

  try {
    let verification_docs = [];
    let sectorId = sectorSelection;
    if (sectorSelection === "__other__") {
      const { data: customSectorId, error: customSectorError } = await sb.rpc("get_or_create_custom_sector", { p_name: customSector });
      if (customSectorError) throw new Error(customSectorError.message);
      sectorId = customSectorId;
      if (!sectorId) throw new Error("We couldn't save that custom business sector. Please try again.");
    }
    const file = byId("vaDoc").files[0];
    if (file) {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${session.user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage.from("vendor-docs").upload(path, file, { contentType: file.type });
      if (upErr) throw new Error(`Document upload failed: ${upErr.message}`);
      verification_docs = [path];
    }

    const { data: createdVendor, error } = await sb.from("vendors").insert({
      user_id: session.user.id,
      sector_id: sectorId,
      business_name,
      address: address || null,
      city: byId("vaCity").value.trim() || null,
      phone,
      whatsapp_number: byId("vaWhatsapp").value.trim() || null,
      cac_number: byId("vaCac").value.trim() || null,
      bio: byId("vaBio").value.trim() || null,
      verification_docs,
    }).select("id").single();
    if (error) throw new Error(error.message);

    await refreshAuthState();

    // The application itself is already submitted at this point -- a
    // payout-setup failure from here on is reported but must never look
    // like the application failed too.
    let payoutSetUp = false;
    let payoutWarning = "";
    if (wantsPayoutSetup) {
      try {
        const res = await fetch("/api/vendor-payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create-subaccount", accessToken: session.access_token, bankCode: payoutBankCode, accountNumber: payoutAccountNumber }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Could not set up payouts.");
        const subaccountCode = String(json.subaccount_code || json.subaccount?.subaccount_code || "").trim();
        if (!subaccountCode) throw new Error("Paystack verified the account but did not return a payout account code.");
        const verifiedAccountName = String(json.account_name || json.subaccount?.account_name || "").trim();
        const { error: payoutSaveError } = await sb.from("vendors").update({
          bank_code: payoutBankCode,
          bank_name: payoutBankName,
          account_name: verifiedAccountName || null,
          account_number: payoutAccountNumber,
          paystack_subaccount_code: subaccountCode,
        }).eq("id", createdVendor.id).eq("user_id", session.user.id);
        if (payoutSaveError) throw new Error(payoutSaveError.message);
        payoutSetUp = true;
        await refreshAuthState();
      } catch (payoutErr) {
        payoutWarning = payoutErr?.message || "Could not set up payouts from the details provided.";
      }
    }

    if (payoutSetUp) {
      showToast("Application submitted and payouts are ready to go.", "success");
      navigate("vendorDashboard");
    } else if (wantsPayoutSetup) {
      showToast(`Application submitted, but payout setup failed: ${payoutWarning}`, "error");
      navigate("vendorEditProfile");
    } else {
      showToast("Application submitted. Let's set up how you get paid.", "success");
      navigate("vendorEditProfile");
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  }
}

