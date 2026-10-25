// ---------- VENDOR: EDIT PROFILE ----------
async function renderVendorEditProfile() {
  if (!session || profile?.role === "admin" || (profile?.role !== "vendor" && !vendor)) return '<div class="empty-state">Access denied.</div>';
  const { data: v } = await sb.from("vendors").select("*").eq("user_id", session.user.id).is("deleted_at", null).maybeSingle();
  if (!v) { navigate("vendorApply"); return '<p class="muted">Redirecting…</p>'; }
  vendor = v;
  if (!Array.isArray(sectors) || !sectors.length) {
    const { data: sectorRows } = await levroData.catalogue.sectors("sort_order");
    sectors = sectorRows || [];
  }
  const vendorEditSectorOptions = (Array.isArray(sectors) ? sectors : [])
    .filter((sector) => sector?.id && String(sector?.name || "").trim())
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
  const { data: billingPreview } = await sb.rpc("compute_monthly_billing_amount", { p_vendor_id: v.id });
  const bp = (billingPreview && billingPreview[0]) || { listing_count: 0, amount: 0 };
  setTimeout(loadBankOptions, 0);
  setTimeout(() => { if (window.lvPayoutCardInit) window.lvPayoutCardInit(); }, 0);
  setTimeout(() => {
    initVendorLocationMap();
  }, 0);
  setTimeout(() => { toggleVendorDeliveryFeeMode(); updateVeDeliveryPerKmExample(); }, 0);

  return `  ${v.verification_status === "verified" ? `
  <div class="dash-actions" style="max-width:480px;margin:0 auto 1rem;">
    <button class="quick-action outline" onclick="navigate('storefront',{vendorId:'${v.id}'})"><span class="quick-action-icon"><i class='fa-solid fa-store'></i></span><span>Storefront</span></button>
    <button class="quick-action outline" onclick="toggleVendorActive(${v.is_active})"><span class="quick-action-icon"><i class='fa-solid fa-${v.is_active ? "pause" : "play"}'></i></span><span>${v.is_active ? "Pause" : "Resume"}</span></button>
  </div>` : ""}
  <div class="card lv-flat ve-card" style="max-width:480px;margin:0 auto;">
    <h2>Edit business profile</h2>
    <div id="vendorEditError" class="error-text hidden"></div>
    <div class="vendor-cover-editor" style="margin:0 0 1rem;">
      <div class="storefront-cover ${v.cover_url ? "has-custom-cover" : ""}" style="height:130px;border-radius:16px;${v.cover_url ? `background-image:url('${esc(v.cover_url)}');background-size:cover;background-position:center;` : ""}">
        ${v.cover_url ? '<div class="storefront-cover-overlay"></div>' : '<div class="storefront-cover-empty">No custom header image yet</div>'}
        <button type="button" class="storefront-cover-edit" onclick="openVendorCoverActions(event)" title="Edit storefront header" aria-label="Edit storefront header"><i class="fa-solid fa-pen"></i></button>
        <input id="vendorCoverInput" type="file" accept="image/*" class="hidden" onchange="uploadVendorCover(event)" />
      </div>
      <p class="muted" style="font-size:.76rem;margin:.45rem 0 0;">This image is the header of your storefront. Your latest products no longer fill this area automatically.</p>
    </div>
    <div class="vendor-edit-avatar-area">
      <div class="avatar-edit-wrap vendor-edit-avatar-wrap">
        ${profile?.avatar_url ? `<img src="${esc(profile.avatar_url)}" class="avatar-circle" style="width:5rem;height:5rem;object-fit:cover;" alt="${esc(profile.name || v.business_name || "Vendor")}" draggable="false" />` : avatarFallbackHtml(profile?.name || v.business_name || "Vendor", "5rem", "", profile?.name || v.business_name || "Vendor")}
        <button type="button" class="avatar-edit-badge" onclick="openAvatarActions(event)" title="Edit profile picture" aria-label="Edit profile picture"><i class="fa-solid fa-pen"></i></button>
      </div>
      <p class="muted" style="margin:.45rem 0 0;font-size:.76rem;">Your account profile picture is used across your vendor cards and storefront.</p>
    </div>
    <label>Your name *</label><input id="vePersonalName" value="${esc(profile?.name || "")}" />
    <label>Business name *</label><input id="veBusinessName" value="${esc(v.business_name || "")}" />
    <label>Business sector *</label>
    <select id="veSector">
      <option value="">Select a sector</option>
      ${vendorEditSectorOptions.map((sector) => `<option value="${esc(sector.id)}" ${String(sector.id) === String(v.sector_id || "") ? "selected" : ""}>${esc(sector.name)}</option>`).join("")}
    </select>
    <label>Address (leave blank if you're an online-only business)</label><input id="veAddress" value="${esc(v.address || "")}" />
    <label>City</label><input id="veCity" value="${esc(v.city || "")}" />
    <label>Phone *</label><input id="vePhone" type="tel" value="${esc(v.phone || "")}" />
    <label>WhatsApp number *</label><input id="veWhatsapp" type="tel" value="${esc(v.whatsapp_number || "")}" oninput="const w=byId('veWhatsappVisible'); if(w) w.disabled=!this.value.trim();" />
    <div class="switch-row" style="margin-top:.45rem;">
      <span class="switch-label-text">Show WhatsApp number to buyers</span>
      <label class="switch-toggle"><input type="checkbox" id="veWhatsappVisible" ${v.whatsapp_visible !== false ? "checked" : ""} ${v.whatsapp_number ? "" : "disabled"} onchange="toggleVendorWhatsappVisibility()" /><span class="switch-toggle-track"></span></label>
    </div>
    <p class="muted vendor-profile-setting-note">Delivery is configured separately for each product or service listing.</p>
    <label>About your business</label><textarea id="veBio" rows="3">${esc(v.bio || "")}</textarea>
    <div class="flex" style="margin-top:0.8rem;">
      <button class="ve-btn ve-btn-primary" onclick="submitVendorEditProfile()">Save changes</button>
      <button class="ve-btn ve-btn-ghost" onclick="navigate('vendorDashboard')">Cancel</button>
    </div>
  </div>

  <div class="card lv-flat ve-card" style="max-width:480px;margin:1.2rem auto 0;">
    <h2><i class="fa-solid fa-clock"></i> Working hours ${infoPopoverHtml("veHoursInfo", "Customers see these on your storefront. Turn off a day you're closed, or set start/end times for the days you're open.")}</h2>
    <p class="muted" style="font-size:0.85rem;">${v.opening_hours ? esc(v.opening_hours) : "Not set yet."}</p>
    <div class="accordion-section" id="veHoursAccordion">
      <button class="accordion-trigger" onclick="toggleAccordion(this)"><span><i class="fa-solid fa-pen"></i> Edit hours</span><i class="fa-solid fa-chevron-down accordion-chevron"></i></button>
      <div class="accordion-body">
        <div id="veHoursRows">${HOURS_DAYS.map((d) => hoursDayRowHtml(d.key, d.label, v.business_hours ? v.business_hours[d.key] : { closed: false, open: "09:00", close: "18:00" })).join("")}</div>
        <button type="button" class="btn btn-sm btn-outline" style="margin-top:0.6rem;" onclick="copyMondayHoursToAll()"><i class="fa-solid fa-copy"></i> Use Monday's hours for every day</button>
      </div>
    </div>
    <div class="switch-row">
      <span class="switch-label-text">Let buyers message or call you outside these hours ${infoPopoverHtml("veAfterHoursInfo", "Off: the Message and Call buttons show your working hours instead of reaching you while you're closed. On: customers can contact you any time.")}</span>
      <label class="switch-toggle"><input type="checkbox" id="veAllowAfterHours" ${v.allow_after_hours_messages !== false ? "checked" : ""} onchange="toggleVendorAfterHours()" /><span class="switch-toggle-track"></span></label>
    </div>
    <div class="flex" style="margin-top:1rem;">
      <button class="ve-btn ve-btn-primary" onclick="submitVendorEditProfile()">Save changes</button>
    </div>
  </div>

  <div class="card lv-flat ve-card" style="max-width:480px;margin:1.2rem auto 0;">
    <h2><i class="fa-solid fa-location-dot"></i> Shop location ${infoPopoverHtml("veLocationInfo", "This is what customers see on the map and what Levi uses to point people to your nearest listing. Tap \"Use my current location\" while you're actually at the shop, then drag the pin to fine-tune if the GPS lands a little off.")}</h2>
    ${v.lat != null ? `<p class="muted" style="font-size:0.82rem;"><i class="fa-solid fa-circle-check" style="color:var(--success);"></i> Location set.</p>` : `<p class="muted" style="font-size:0.82rem;">Not set yet, customers can't find you on the map until you set this.</p>`}
    <div id="veLocationMap" style="height:220px;border-radius:0.8rem;overflow:hidden;background:var(--border);position:relative;isolation:isolate;z-index:0;margin-top:0.9rem;"></div>
    <input type="hidden" id="veLat" value="${v.lat ?? ""}" />
    <input type="hidden" id="veLng" value="${v.lng ?? ""}" />
    <p class="muted" style="font-size:0.78rem;margin-top:0.55rem;"><i class="fa-solid fa-hand-pointer"></i> Tap anywhere on the map to choose a shop location, or drag the pin.</p>
    <div class="flex" style="margin-top:0.8rem;">
      <button class="ve-btn ve-btn-primary" id="veUseLocationBtn" onclick="useMyLocationForVendor()"><i class="fa-solid fa-location-crosshairs"></i> Use my current location</button>
      <button class="ve-btn ve-btn-ghost" onclick="saveVendorLocationPreset()"><i class="fa-solid fa-bookmark"></i> Save as location</button>
    </div>
    <div class="vendor-location-presets" id="veLocationPresets"></div>
  </div>

  <div class="card lv-flat ve-card" id="payoutSection" style="max-width:480px;margin:1.2rem auto 0;">
    <h2><i class="fa-solid fa-money-bill-transfer"></i> Payout details ${infoPopoverHtml("payoutInfo", `Set your bank account once. Levromart then pays you directly on every order (minus the ${Number(v.commission_pct ?? 3)}% platform commission), no manual transfers needed. The money is sent after the buyer confirms receipt, or after 48 hours with no problem raised. Banks usually credit it the same day or the next business day.`)}</h2>
    <div id="bankError" class="error-text hidden"></div>
    <div id="payoutVerifiedBox"></div>
    <div id="payoutLegacy">${v.paystack_subaccount_code
      ? `<div class="ve-bank"><span class="ve-bank-ico" data-bank-code="${esc(v.bank_code || "")}"><i class="fa-solid fa-building-columns"></i></span><div class="ve-bank-copy"><strong>${esc(v.account_name || "Your account")}</strong><small><span id="payoutBankName">${esc(getBankDisplayName(v.bank_code, v.bank_name))}</span> ${v.account_number ? "···" + esc(v.account_number.slice(-4)) : ""}</small></div><span class="ve-chip ok"><i class="fa-solid fa-circle-check"></i> Payouts on</span></div>`
      : `<div class="ve-bank ve-bank-empty"><span class="ve-bank-ico"><i class="fa-solid fa-triangle-exclamation"></i></span><div class="ve-bank-copy"><strong>Not set up yet</strong><small>Until you add your bank, order payments go to Levromart and you will be paid out manually.</small></div></div>`}</div>
    ${v.paystack_subaccount_code ? `<button type="button" class="ve-btn ve-btn-ghost ve-btn-wide" id="veChangeBankBtn" onclick="lvChangeBank()"><i class="fa-solid fa-pen"></i> Change bank account</button>` : ""}
    <div id="bankFormWrap" class="ve-bankform ${v.paystack_subaccount_code ? "hidden" : ""}">
      <label>Bank</label>
      <button type="button" id="veBankPickerBtn" class="bank-picker-trigger" onclick="openVendorBankPicker()" aria-haspopup="dialog" aria-expanded="false">
        <span id="veBankPickerLabel">${esc(getBankDisplayName(v.bank_code, v.bank_name) || "Select a bank")}</span>
        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
      </button>
      <select id="veBankCode" data-current-bank="${esc(v.bank_code || "")}" class="hidden" aria-hidden="true" tabindex="-1">${NIGERIAN_BANKS.map((b) => `<option value="${esc(b.code)}" ${String(b.code) === String(v.bank_code || "") ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
      <label>Account number</label>
      <input id="veAccountNumber" inputmode="numeric" maxlength="10" placeholder="10-digit account number" value="${esc(v.account_number || "")}" />
      <button class="ve-btn ve-btn-primary ve-btn-wide ${v.paystack_subaccount_code ? "" : "levro-pulse-attention"}" style="margin-top:0.8rem;" id="saveBankBtn" onclick="saveVendorBankDetails()">Save payout details</button>
    </div>
  </div>
`;
}

// Small hardcoded fallback for if the live Paystack bank list can't be
// reached - loadBankOptions() below replaces this with Paystack's full,
// current list (every bank, microfinance bank and fintech they support)
// on every render of this page, so vendors aren't limited to this subset.
const NIGERIAN_BANKS = [
  { name: "9mobile 9Payment Service Bank", code: "120001" },
  { name: "Abbey Mortgage Bank", code: "801" },
  { name: "Above Only MFB", code: "51204" },
  { name: "Abulesoro MFB", code: "51312" },
  { name: "Access Bank", code: "044" },
  { name: "Access Bank (Diamond)", code: "063" },
  { name: "Accion Microfinance Bank", code: "602" },
  { name: "AG Mortgage Bank", code: "90077" },
  { name: "Ahmadu Bello University Microfinance Bank", code: "50036" },
  { name: "Airtel Smartcash PSB", code: "120004" },
  { name: "AKU Microfinance Bank", code: "51336" },
  { name: "ALAT by WEMA", code: "035" },
  { name: "Amju Unique MFB", code: "50926" },
  { name: "Aramoko MFB", code: "50083" },
  { name: "ASO Savings and Loans", code: "401" },
  { name: "Astrapolaris MFB LTD", code: "50094" },
  { name: "Bowen Microfinance Bank", code: "50931" },
  { name: "Carbon", code: "565" },
  { name: "CEMCS Microfinance Bank", code: "50823" },
  { name: "Chanelle Microfinance Bank Limited", code: "50171" },
  { name: "Citibank Nigeria", code: "023" },
  { name: "Corestep MFB", code: "50204" },
  { name: "Coronation Merchant Bank", code: "559" },
  { name: "Crescent MFB", code: "51297" },
  { name: "Ecobank Nigeria", code: "050" },
  { name: "Ekimogun MFB", code: "50263" },
  { name: "Ekondo Microfinance Bank", code: "562" },
  { name: "Eyowo", code: "50126" },
  { name: "FairMoney Microfinance Bank", code: "51318" },
  { name: "Fidelity Bank", code: "070" },
  { name: "Firmus MFB", code: "51314" },
  { name: "First Bank of Nigeria", code: "011" },
  { name: "First City Monument Bank", code: "214" },
  { name: "FirstTrust Mortgage Bank Nigeria", code: "413" },
  { name: "FSDH Merchant Bank Limited", code: "501" },
  { name: "Gateway Mortgage Bank LTD", code: "812" },
  { name: "Globus Bank", code: "00103" },
  { name: "GoMoney", code: "100022" },
  { name: "Guaranty Trust Bank", code: "058" },
  { name: "Hackman Microfinance Bank", code: "51251" },
  { name: "Hasal Microfinance Bank", code: "50383" },
  { name: "Heritage Bank", code: "030" },
  { name: "HopePSB", code: "120002" },
  { name: "Ibile Microfinance Bank", code: "51244" },
  { name: "Infinity MFB", code: "50457" },
  { name: "Jaiz Bank", code: "301" },
  { name: "Kadpoly MFB", code: "50502" },
  { name: "Keystone Bank", code: "082" },
  { name: "Kredi Money MFB LTD", code: "50200" },
  { name: "Kuda Bank", code: "50211" },
  { name: "Lagos Building Investment Company Plc.", code: "90052" },
  { name: "Links MFB", code: "50549" },
  { name: "Living Trust Mortgage Bank", code: "031" },
  { name: "Lotus Bank", code: "303" },
  { name: "MAINSTREET MICROFINANCE BANK", code: "090171" },
  { name: "Mayfair MFB", code: "50563" },
  { name: "Mint MFB", code: "50304" },
  { name: "Money Master PSB", code: "946" },
  { name: "Moniepoint MFB", code: "50515" },
  { name: "MTN Momo PSB", code: "120003" },
  { name: "MUTUAL BENEFITS MICROFINANCE BANK", code: "090190" },
  { name: "NDCC MICROFINANCE BANK", code: "090679" },
  { name: "NET MICROFINANCE BANK", code: "51361" },
  { name: "Nigerian Navy Microfinance Bank Limited", code: "51142" },
  { name: "NPF MICROFINANCE BANK", code: "50629" },
  { name: "OPay Digital Services Limited (OPay)", code: "999992" },
  { name: "Optimus Bank Limited", code: "107" },
  { name: "Paga", code: "100002" },
  { name: "PalmPay", code: "999991" },
  { name: "Parallex Bank", code: "104" },
  { name: "Parkway - ReadyCash", code: "311" },
  { name: "PATHFINDER MICROFINANCE BANK LIMITED", code: "090680" },
  { name: "Paystack-Titan", code: "100039" },
  { name: "Peace Microfinance Bank", code: "50743" },
  { name: "PECANTRUST MICROFINANCE BANK LIMITED", code: "51226" },
  { name: "Personal Trust MFB", code: "51146" },
  { name: "Petra Mircofinance Bank Plc", code: "50746" },
  { name: "Polaris Bank", code: "076" },
  { name: "PremiumTrust Bank", code: "105" },
  { name: "Providus Bank", code: "101" },
  { name: "QuickFund MFB", code: "51293" },
  { name: "Rand Merchant Bank", code: "502" },
  { name: "Refuge Mortgage Bank", code: "90067" },
  { name: "Rubies MFB", code: "125" },
  { name: "Safe Haven MFB", code: "51113" },
  { name: "Signature Bank Ltd", code: "106" },
  { name: "Solid Rock MFB", code: "50800" },
  { name: "Sparkle Microfinance Bank", code: "51310" },
  { name: "Stanbic IBTC Bank", code: "221" },
  { name: "Standard Chartered Bank", code: "068" },
  { name: "Sterling Bank", code: "232" },
  { name: "Suntrust Bank", code: "100" },
  { name: "TAJ Bank", code: "302" },
  { name: "Tangerine Money", code: "51269" },
  { name: "TCF MFB", code: "51211" },
  { name: "Titan Bank", code: "102" },
  { name: "U&C Microfinance Bank Ltd", code: "50840" },
  { name: "Uhuru MFB", code: "51322" },
  { name: "Unaab Microfinance Bank Limited", code: "50870" },
  { name: "Unical MFB", code: "50871" },
  { name: "Unilag Microfinance Bank", code: "51316" },
  { name: "Union Bank of Nigeria", code: "032" },
  { name: "United Bank For Africa", code: "033" },
  { name: "Unity Bank", code: "215" },
  { name: "VFD Microfinance Bank Limited", code: "566" },
  { name: "Wema Bank", code: "035" },
  { name: "Zenith Bank", code: "057" },
];
window.__levroBankOptions = Array.isArray(window.__levroBankOptions) && window.__levroBankOptions.length
  ? window.__levroBankOptions
  : NIGERIAN_BANKS.slice();

function getBankDisplayName(bankCode, storedBankName) {
  const code = String(bankCode || "").trim();
  const source = Array.isArray(window.__levroBankOptions) && window.__levroBankOptions.length
    ? window.__levroBankOptions
    : NIGERIAN_BANKS;
  const mapped = code
    ? source.find((b) => String(b.code) === code)?.name
    : "";
  // IMPORTANT: bank_code is authoritative. A stale bank_name must never
  // override the bank selected/saved by the vendor.
  return mapped || String(storedBankName || "").trim() || (code ? `Bank code ${code}` : "Not provided");
}

function normaliseBankList(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((b) => ({ name: String(b?.name || "").trim(), code: String(b?.code || "").trim() }))
    .filter((b) => b.name && b.code)
    .filter((b) => {
      const key = `${b.code}::${b.name.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function renderVendorBankPicker() {
  const select = byId("veBankCode");
  const label = byId("veBankPickerLabel");
  if (!select || !label) return;
  const selected = select.options[select.selectedIndex];
  label.textContent = selected?.textContent?.trim() || getBankDisplayName(select.value, "");
}

function closeVendorBankPicker() {
  const modal = byId("vendorBankPickerModal");
  if (modal) modal.remove();
  const trigger = byId("veBankPickerBtn");
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}

function selectVendorBank(code, name) {
  const select = byId("veBankCode");
  if (!select) return;
  const option = Array.from(select.options).find((o) => String(o.value) === String(code));
  if (!option) return;
  select.value = String(code);
  select.dataset.currentBank = String(code);
  const label = byId("veBankPickerLabel");
  if (label) label.textContent = name || option.textContent.trim();
  closeVendorBankPicker();
}

function openVendorBankPicker() {
  const select = byId("veBankCode");
  if (!select) return;
  closeVendorBankPicker();

  const banks = Array.from(select.options)
    .map((o) => ({ code: o.value, name: o.textContent.trim() }))
    .filter((b) => b.code && b.name)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const modal = document.createElement("div");
  modal.id = "vendorBankPickerModal";
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
        <button type="button" class="drawer-close-btn" onclick="closeVendorBankPicker()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="vendor-bank-search-wrap">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input id="vendorBankSearch" class="vendor-bank-search" type="search" autocomplete="off" placeholder="Search bank..." aria-label="Search banks" />
      </div>
      <div id="vendorBankPickerList" class="vendor-bank-picker-list"></div>
    </div>`;

  document.body.appendChild(modal);

  const listEl = byId("vendorBankPickerList");
  const searchEl = byId("vendorBankSearch");
  const selectedCode = String(select.value || "");

  const paint = () => {
    const q = String(searchEl?.value || "").trim().toLowerCase();
    const filtered = banks.filter((b) => !q || b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q));
    listEl.innerHTML = filtered.length
      ? filtered.map((b) => `<button type="button" class="vendor-bank-option ${String(b.code) === selectedCode ? "selected" : ""}" onclick="selectVendorBank('${esc(b.code)}','${esc(b.name)}')"><span class="vendor-bank-option-icon"><i class="fa-solid fa-building-columns"></i></span><span class="vendor-bank-option-main"><strong>${esc(b.name)}</strong><small>${esc(b.code)}</small></span>${String(b.code) === selectedCode ? '<i class="fa-solid fa-circle-check vendor-bank-option-check"></i>' : '<i class="fa-solid fa-chevron-right vendor-bank-option-arrow"></i>'}</button>`).join("")
      : `<div class="empty-state" style="padding:2rem 1rem;">No bank matches your search.</div>`;
  };

  searchEl?.addEventListener("input", paint);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeVendorBankPicker(); });
  paint();
  requestAnimationFrame(() => {
    byId("veBankPickerBtn")?.setAttribute("aria-expanded", "true");
    searchEl?.focus();
  });
}

async function loadBankOptions() {
  const select = byId("veBankCode");
  if (!select) return;
  const currentBank = String(select.dataset.currentBank || select.value || "");
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
    window.__levroBankOptions = banks;

    // Keep the live Paystack-backed list authoritative and alphabetically ordered.
    select.innerHTML = banks.map((b) => `<option value="${esc(b.code)}" ${String(b.code) === currentBank ? "selected" : ""}>${esc(b.name)}</option>`).join("");
    if (currentBank && !Array.from(select.options).some((o) => String(o.value) === currentBank)) {
      select.value = currentBank;
      select.dataset.currentBank = currentBank;
    }
    renderVendorBankPicker();
  } catch (e) {
    // The complete fallback is already rendered in the HTML. Never default
    // to Access Bank: preserve the saved bank code if one exists.
    if (currentBank) {
      select.value = currentBank;
      select.dataset.currentBank = currentBank;
    }
    renderVendorBankPicker();
  }
}

async function saveVendorBankDetails() {
  const errorEl = byId("bankError");
  errorEl.classList.add("hidden");
  const bankSelect = byId("veBankCode");
  const accountInput = byId("veAccountNumber");
  const bankCode = String(bankSelect?.value || "").trim();
  const accountNumber = String(accountInput?.value || "").trim();
  const bankName = String(bankSelect?.selectedOptions?.[0]?.textContent || "").trim();
  if (!/^\d{10}$/.test(accountNumber)) {
    errorEl.textContent = "Enter a valid 10-digit account number.";
    errorEl.classList.remove("hidden");
    return;
  }
  const btn = byId("saveBankBtn");
  if (btn?.disabled) return;
  if (!bankCode || !bankName) {
    errorEl.textContent = "Choose a bank.";
    errorEl.classList.remove("hidden");
    return;
  }
  const owner = vendor?.id;
  if (!owner || !session?.user?.id || !session?.access_token) {
    errorEl.textContent = "Your vendor session has expired. Please sign in again.";
    errorEl.classList.remove("hidden");
    return;
  }
  if (btn) btn.disabled = true;
  try {
    // First let Paystack verify/create the payout subaccount from the exact
    // selection the vendor made. No local payout fields are changed yet.
    const res = await fetch("/api/vendor-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-subaccount", accessToken: session.access_token, bankCode, accountNumber }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not save payout details.");

    const subaccountCode = String(json.subaccount_code || json.subaccount?.subaccount_code || "").trim();
    if (!subaccountCode) throw new Error("Paystack verified the account but did not return a payout account code. Please try again.");
    const verifiedAccountName = String(json.account_name || json.subaccount?.account_name || "").trim();

    // Persist the complete, exact payout configuration on the vendor row.
    // This is the missing step that caused the old-account/new-selection mismatch.
    const { error: payoutSaveError } = await sb.from("vendors").update({
      bank_code: bankCode,
      bank_name: bankName,
      account_name: verifiedAccountName || null,
      account_number: accountNumber,
      paystack_subaccount_code: subaccountCode
    }).eq("id", owner).eq("user_id", session.user.id);
    if (payoutSaveError) throw new Error(`Paystack verified the account, but Levromart could not save the payout details: ${payoutSaveError.message}`);

    // Read back from the database and verify what was actually persisted.
    const { data: saved, error: readError } = await sb.from("vendors")
      .select("*").eq("id", owner).eq("user_id", session.user.id).single();
    if (readError) throw new Error("Payout account was saved, but the saved details could not be verified. Please reopen Payout details before retrying.");
    if (String(saved.bank_code || "") !== bankCode || String(saved.account_number || "") !== accountNumber || String(saved.paystack_subaccount_code || "") !== subaccountCode) {
      throw new Error("The payout account was not saved exactly as selected. Please retry before accepting payouts.");
    }

    if (vendor?.id === owner) vendor = saved;
    const keepScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    if (currentView !== "vendorEditProfile") return;
    showToast(`Payouts set up successfully for ${saved.account_name || verifiedAccountName || "this account"}.`, "success");
    await navigate("vendorEditProfile", {}, false);
    requestAnimationFrame(() => window.scrollTo({ top: keepScrollY, left: 0, behavior: "auto" }));
  } catch (err) {
    errorEl.textContent = err?.message || "Could not save payout details.";
    errorEl.classList.remove("hidden");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Distance mode charges purely by the per-km rate (see compute_delivery_fee)
// -- the flat "Delivery fee" field only ever applies in flat mode, or as a
// fallback if the shop has no pinned location yet, so its label switches to
// say that instead of implying it stacks on top of the per-km rate too.
function toggleVendorDeliveryFeeMode() {
  const isDistance = byId("veDeliveryFeeMode").value === "distance";
  byId("veDeliveryPerKmRow").classList.toggle("hidden", !isDistance);
  const label = byId("veDeliveryFeeLabel");
  if (label) label.childNodes[0].textContent = isDistance ? "Fallback flat fee (only used if location isn't set) " : "Delivery fee ";
  if (isDistance) updateVeDeliveryPerKmExample();
}
function updateVeDeliveryPerKmExample() {
  const el = byId("veDeliveryPerKmExample");
  if (!el) return;
  const rate = Number(byId("veDeliveryPerKm")?.value) || 0;
  if (rate <= 0) { el.textContent = ""; return; }
  const at = (km) => naira(Math.round((rate * km) / 50) * 50);
  el.textContent = `Example: ${at(1)} at 1km, ${at(3)} at 3km, ${at(5)} at 5km.`;
}
// Every other switch on this page (location sharing, Levi, sound) saves the
// instant you flip it -- this one used to be bundled into the "Save
// changes" button below with the text fields instead, so flipping it and
// refreshing before pressing that separate button looked exactly like the
// toggle "not sticking". Now it saves itself immediately, same as the rest.
async function toggleVendorAfterHours() {
  const checkbox = byId("veAllowAfterHours");
  const checked = checkbox.checked;
  const { error } = await sb.from("vendors").update({ allow_after_hours_messages: checked }).eq("id", vendor.id);
  if (error) { showToast(error.message, "error"); checkbox.checked = !checked; return; }
  vendor.allow_after_hours_messages = checked;
  showToast(checked ? "Customers can now message or call you outside working hours." : "After-hours contact turned off.", "success");
}
async function toggleVendorWhatsappVisibility() {
  const checkbox = byId("veWhatsappVisible");
  const number = byId("veWhatsapp")?.value.trim() || "";
  if (!checkbox) return;
  if (checkbox.checked && !number) { checkbox.checked = false; showToast("Add a WhatsApp number first.", "info"); return; }
  const { error } = await sb.from("vendors").update({ whatsapp_visible: checkbox.checked }).eq("id", vendor.id);
  if (error) { checkbox.checked = !checkbox.checked; showToast(error.message, "error"); return; }
  vendor.whatsapp_visible = checkbox.checked;
  showToast(checkbox.checked ? "WhatsApp contact is now visible to buyers." : "WhatsApp contact hidden from buyers.", "success");
}

async function submitVendorEditProfile() {
  const errorEl = byId("vendorEditError");
  errorEl.classList.add("hidden");
  const personalName = byId("vePersonalName")?.value.trim() || "";
  const business_name = byId("veBusinessName").value.trim();
  const sector_id = byId("veSector")?.value || "";
  const phone = byId("vePhone").value.trim();
  if (!personalName || !business_name || !phone || !(byId("veWhatsapp")?.value || "").trim()) {
    errorEl.textContent = "Your name, business name, phone and WhatsApp number are required.";
    errorEl.classList.remove("hidden");
    return;
  }
  if (personalName !== (profile?.name || "")) {
    const { error: nameError } = await sb.from("users").update({ name: personalName }).eq("id", session.user.id);
    if (nameError) { errorEl.textContent = nameError.message; errorEl.classList.remove("hidden"); return; }
    profile.name = personalName;
  }
  const business_hours = collectBusinessHoursFromForm();
  const { error } = await sb.from("vendors").update({
    business_name,
    sector_id: sector_id || null,
    address: byId("veAddress").value.trim() || null,
    city: byId("veCity").value.trim() || null,
    phone,
    whatsapp_number: byId("veWhatsapp").value.trim() || null,
    whatsapp_visible: !!byId("veWhatsappVisible")?.checked && !!byId("veWhatsapp").value.trim(),
    opening_hours: summarizeBusinessHours(business_hours) || null,
    business_hours,
    allow_after_hours_messages: byId("veAllowAfterHours").checked,
    bio: byId("veBio").value.trim() || null,
  }).eq("id", vendor.id);
  if (error) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); return; }
  vendor.business_name = business_name;
  vendor.sector_id = sector_id || null;
  vendor.phone = phone;
  vendor.whatsapp_number = byId("veWhatsapp").value.trim() || null;
  vendor.whatsapp_visible = !!byId("veWhatsappVisible")?.checked && !!vendor.whatsapp_number;
  vendor.business_hours = business_hours;
  vendor.allow_after_hours_messages = byId("veAllowAfterHours").checked;
  updateAuthUI();
  const keepScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  showToast("Business profile saved.", "success");
  await navigate("vendorEditProfile", {}, false);
  requestAnimationFrame(() => window.scrollTo({ top: keepScrollY, left: 0, behavior: "auto" }));
}

async function uploadVendorCover(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || !vendor) return;
  if (!file.type.startsWith("image/")) { showToast("Please choose an image file.", "error"); return; }
  try { const small = await lvPrepareImageFile(file, 2000); pendingVendorCoverFile = small; openVendorCoverCropModal(small); }
  catch (e) { showToast("Couldn't open that photo. Try another one.", "error"); }
}
// Phone photos are huge (12MP+, sometimes HEIC). Reading them whole into the crop screen can crash a phone's browser and
// bounce the person back to the home page, so the picked photo is shrunk to a sensible size first (orientation fixed too).
async function lvPrepareImageFile(file, maxSide = 2000) {
  try {
    let bmp = null;
    if (window.createImageBitmap) { try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) { bmp = null; } }
    let w, h, src;
    if (bmp) { w = bmp.width; h = bmp.height; src = bmp; }
    else {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("decode")); i.src = url; });
        w = img.naturalWidth; h = img.naturalHeight; src = img;
      } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
    }
    const k = Math.min(1, maxSide / Math.max(w, h));
    if (k === 1 && file.size < 1.5 * 1024 * 1024 && /jpe?g|png|webp/i.test(file.type)) { try { bmp?.close?.(); } catch (_) {} return file; }
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const c = document.createElement("canvas"); c.width = cw; c.height = ch;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(src, 0, 0, cw, ch);
    try { bmp?.close?.(); } catch (_) {}
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
    c.width = c.height = 0;
    if (!blob) return file;
    return new File([blob], (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch (_) { return file; }
}
async function removeVendorCover(event) {
  event?.stopPropagation?.();
  if (!vendor) return;
  const confirmed = await showConfirmDialog("Remove your storefront header image?", { title: "Remove storefront header", okLabel: "Remove", danger: true });
  if (!confirmed) return;
  const { error } = await sb.from("vendors").update({ cover_url: null }).eq("id", vendor.id);
  if (error) { showToast(error.message || "Could not remove storefront header.", "error"); return; }
  await sb.storage.from("vendor-logos").remove([`${vendor.id}/cover.jpg`,`${vendor.id}/cover.jpeg`,`${vendor.id}/cover.png`,`${vendor.id}/cover.webp`]).catch(()=>{});
  vendor.cover_url = null;
  if (currentView === "vendorEditProfile") await navigate("vendorEditProfile", {}, false);
  else if (currentView === "editProfile" || currentView === "profileSetup") await navigate(currentView, {}, false);
  else if (currentView === "storefront") await navigate("storefront", { vendorId: vendor.id }, false);
  showToast("Storefront header removed.", "success");
}


async function uploadVendorLogo(event) {
  const file = event.target.files[0];
  if (!file || !vendor) return;
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `vendor-logos/${vendor.id}/logo.${ext}`;
  let uploadBlob = file;
  try { if (typeof window.compressImage === "function") uploadBlob = await window.compressImage(file, { maxWidth: 800, maxHeight: 800 }); } catch (_) {}
  let publicUrl;
  try { publicUrl = await uploadToR2(uploadBlob, path, uploadBlob.type || file.type); }
  catch (upErr) { showToast(upErr.message, "error"); return; }
  const url = `${publicUrl}?t=${Date.now()}`;
  const { error } = await sb.from("vendors").update({ logo_url: url }).eq("id", vendor.id);
  if (error) { showToast(error.message, "error"); return; }
  vendor.logo_url = url;
  navigate("vendorEditProfile", {}, false);
  showToast("Business logo updated.", "success");
}
async function removeVendorLogo(event) {
  event?.stopPropagation?.();
  if (!vendor) return;
  const confirmed = await showConfirmDialog("Remove your business logo?", { title: "Remove logo", okLabel: "Remove", danger: true });
  if (!confirmed) return;
  const { error } = await sb.from("vendors").update({ logo_url: null }).eq("id", vendor.id);
  if (error) { showToast(error.message || "Could not remove the business logo.", "error"); return; }
  vendor.logo_url = null;
  await navigate("vendorEditProfile", {}, false);
  showToast("Business logo removed.", "success");
}


let veMap = null;
let veMarker = null;
async function initVendorLocationMap() {
  const mapEl = byId("veLocationMap");
  if (!mapEl || !vendor) return;
  try {
    await loadLeaflet();
  } catch (err) {
    mapEl.innerHTML = `<p class="muted" style="padding:1rem;">${esc(err.message)}</p>`;
    return;
  }
  const hasLocation = vendor.lat != null && vendor.lng != null;
  const startLat = hasLocation ? vendor.lat : 6.5244;
  const startLng = hasLocation ? vendor.lng : 3.3792;
  veMap = window.L.map("veLocationMap").setView([startLat, startLng], hasLocation ? 15 : 11);
  addBasemapTileLayer(veMap);
  veMarker = window.L.marker([startLat, startLng], { draggable: true, icon: vendorMapIcon() }).addTo(veMap);
  const applyMapPoint = (lat,lng) => { byId("veLat").value=lat; byId("veLng").value=lng; if(veMarker)veMarker.setLatLng([lat,lng]); };
  veMarker.on("dragend", () => { const pos = veMarker.getLatLng(); applyMapPoint(pos.lat,pos.lng); });
  veMap.on("click", (e) => applyMapPoint(e.latlng.lat,e.latlng.lng));
  // Mobile browsers can initially lay out the map inside a card before its
  // dimensions are final. Recalculate immediately and again after the page
  // has painted so the saved vendor location is visible without tapping the map.
  setTimeout(() => veMap?.invalidateSize({ pan: false }), 0);
  setTimeout(() => veMap?.invalidateSize({ pan: false }), 180);
  renderVendorLocationPresets();
}

function vendorLocationPresetKey(){return "levromart-vendor-location-presets:"+(vendor?.id||"");}
function getVendorLocationPresets(){try{return JSON.parse(localStorage.getItem(vendorLocationPresetKey())||"[]").filter(x=>Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lng))).slice(0,3);}catch(e){return [];}}
function renderVendorLocationPresets(){
  const el=byId("veLocationPresets"); if(!el)return;
  const list=getVendorLocationPresets();
  if(!list.length){el.innerHTML="";return;}
  el.innerHTML='<div class="muted" style="font-size:.78rem;margin-top:.75rem;">Saved locations</div>'+list.map((x,i)=>{
    const name=esc(x.name||("Location "+(i+1)));
    return '<div class="saved-location-row"><button type="button" class="btn btn-sm btn-outline saved-location-select" onclick="selectVendorLocationPreset('+i+')"><i class="fa-solid fa-location-dot"></i> '+name+'</button><button type="button" class="saved-location-delete" onclick="deleteVendorLocationPreset('+i+')" aria-label="Delete saved location" title="Delete saved location"><i class="fa-solid fa-trash"></i></button></div>';
  }).join("");
}
function saveVendorLocationPreset(){
  const lat=parseFloat(byId("veLat")?.value), lng=parseFloat(byId("veLng")?.value);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)){showToast("Choose a location on the map first.","error");return;}
  const list=getVendorLocationPresets();
  if(list.length>=3){showToast("You can save up to 3 locations.","info");return;}
  const name="Location "+(list.length+1); list.push({name,lat,lng});
  try{localStorage.setItem(vendorLocationPresetKey(),JSON.stringify(list));}catch(e){}
  renderVendorLocationPresets(); showToast(name+" saved on this device.","success");
}
function deleteVendorLocationPreset(index){
  const list=getVendorLocationPresets(); if(index<0||index>=list.length)return;
  list.splice(index,1); list.forEach((x,i)=>x.name="Location "+(i+1));
  try{localStorage.setItem(vendorLocationPresetKey(),JSON.stringify(list));}catch(e){}
  renderVendorLocationPresets(); showToast("Saved location removed.","success");
}
function selectVendorLocationPreset(index){
  const x=getVendorLocationPresets()[index]; if(!x)return;
  byId("veLat").value=x.lat; byId("veLng").value=x.lng;
  if(veMarker)veMarker.setLatLng([x.lat,x.lng]); if(veMap)veMap.setView([x.lat,x.lng],16);
  showToast((x.name||"Saved location")+" selected. Drag the pin to fine-tune or use the current-location action to update the active shop location.","info");
}

async function locateVendorMapOnly() {
  try {
    const loc = await getCurrentPositionOnce();
    if (veMap) veMap.setView([loc.lat, loc.lng], Math.max(16, veMap.getZoom?.() || 16), { animate: true });
    if (veMap && veMarker) veMarker.setLatLng([loc.lat, loc.lng]);
    showToast("Map centered on your current location.", "info");
  } catch (err) { showToast(err?.message || "Could not get your current location.", "error"); }
}

async function useMyLocationForVendor() {
  const btn = byId("veUseLocationBtn");
  if (!btn) return;
  const confirmed = await showConfirmDialog("Use your current device location as your shop location? This will replace the shop location currently saved on Levromart.", { title: "Use current location", okLabel: "Use this location" });
  if (!confirmed) return;
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Locating…`;
  try {
    const loc = await getCurrentPositionOnce();
    const { error } = await sb.from("vendors").update({ lat: loc.lat, lng: loc.lng }).eq("id", vendor.id);
    if (error) throw error;
    vendor.lat = loc.lat; vendor.lng = loc.lng;
    byId("veLat").value = loc.lat; byId("veLng").value = loc.lng;
    if (veMap && veMarker) { veMarker.setLatLng([loc.lat, loc.lng]); veMap.setView([loc.lat, loc.lng], 16); }
    showToast("Current location saved as your shop location.", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}
async function saveVendorLocation() {
  const lat = parseFloat(byId("veLat").value);
  const lng = parseFloat(byId("veLng").value);
  if (isNaN(lat) || isNaN(lng)) { showToast("Set a location on the map first.", "error"); return; }
  const { error } = await sb.from("vendors").update({ lat, lng }).eq("id", vendor.id);
  if (error) { showToast(error.message, "error"); return; }
  vendor.lat = lat;
  vendor.lng = lng;
  showToast("Shop location saved. Customers can now find you on the map.", "success");
}


// "Change bank account": opens the bank form and scrolls straight to it, so nobody has to hunt for it
function lvChangeBank() {
  const wrap = byId("bankFormWrap");
  if (!wrap) return;
  wrap.classList.remove("hidden");
  byId("veChangeBankBtn")?.classList.add("hidden");
  setTimeout(() => {
    wrap.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => { try { byId("veAccountNumber")?.focus({ preventScroll: true }); } catch (_) {} }, 450);
  }, 40);
}
