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
  const hasPayout = typeof window.vendorHasPayoutAccount === "function"
    ? window.vendorHasPayoutAccount(v)
    : !!(v && (v.paystack_subaccount_code || v.transfer_recipient_code || v.payout_verified_at || (v.account_number && v.bank_code)));

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
    <label>WhatsApp number *</label><input id="veWhatsapp" type="tel" value="${esc(v.whatsapp_number || "")}" oninput="const wa=byId('veWhatsappAlerts'); if(wa) wa.disabled=!this.value.trim();" />
    <div class="switch-row" style="margin-top:.45rem;">
      <span class="switch-label-text">Send new-order alerts to my WhatsApp</span>
      <label class="switch-toggle"><input type="checkbox" id="veWhatsappAlerts" ${v.whatsapp_alerts !== false ? "checked" : ""} ${v.whatsapp_number ? "" : "disabled"} onchange="toggleVendorWhatsappAlerts()" /><span class="switch-toggle-track"></span></label>
    </div>
    <p class="muted vendor-profile-setting-note">When on, Levromart sends one short WhatsApp message to the number above when you get a new order. It never shares the order details with anyone else. It is on by default; turn it off any time.</p>
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
      <span class="switch-label-text">Let buyers place orders outside these hours ${infoPopoverHtml("veAfterHoursInfo", "On (default): customers can order any time. Off: they can only order while you are open (if you have set working hours).")}</span>
      <label class="switch-toggle"><input type="checkbox" id="veAllowAfterHours" ${v.allow_after_hours_orders !== false ? "checked" : ""} onchange="toggleVendorAfterHours()" /><span class="switch-toggle-track"></span></label>
    </div>
    <div class="switch-row" style="margin-top:.6rem;">
      <span class="switch-label-text">Show when I'm online ${infoPopoverHtml("veOnlineInfo", "On (default): customers see 'Online now' or 'Last seen ...' under your shop's name. Off: nobody sees when you are online or when you were last here.")}</span>
      <label class="switch-toggle"><input type="checkbox" id="veShowOnline" ${v.show_online_status !== false ? "checked" : ""} onchange="toggleVendorShowOnline()" /><span class="switch-toggle-track"></span></label>
    </div>
    <div class="ve-field" style="margin-top:1rem;">
      <label class="ve-label" for="veOrderExpiry">How long do you need to confirm a new order?</label>
      <select id="veOrderExpiry" class="ve-input">${[[30, "30 minutes (default)"], [60, "1 hour"], [120, "2 hours (good for food and snacks)"], [180, "3 hours"], [1440, "1 day"], [2880, "2 days"], [10080, "1 week"], [0, "Never cancel by itself"]].map(([m, l]) => `<option value="${m}" ${Number(v.order_expiry_minutes ?? 30) === m ? "selected" : ""}>${l}</option>`).join("")}</select>
      <p class="muted" style="font-size:0.8rem;margin:0.3rem 0 0;">If you don't confirm in time, the order cancels itself and the customer is told. Customers see a countdown.</p>
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
    <div id="payoutLegacy">${hasPayout
      ? `<div class="ve-bank"><span class="ve-bank-ico" data-bank-code="${esc(v.bank_code || "")}"><i class="fa-solid fa-building-columns"></i></span><div class="ve-bank-copy"><strong>${esc(v.account_name || "Your account")}</strong><small><span id="payoutBankName">${esc(getBankDisplayName(v.bank_code, v.bank_name))}</span> ${v.account_number ? "···" + esc(v.account_number.slice(-4)) : ""}</small></div><span class="ve-chip ok"><i class="fa-solid fa-circle-check"></i> Payouts on</span></div>`
      : `<div class="ve-bank ve-bank-empty"><span class="ve-bank-ico"><i class="fa-solid fa-triangle-exclamation"></i></span><div class="ve-bank-copy"><strong>Not set up yet</strong><small>Until you add your bank, order payments go to Levromart and you will be paid out manually.</small></div></div>`}</div>
    ${hasPayout ? `<button type="button" class="ve-btn ve-btn-ghost ve-btn-wide" id="veChangeBankBtn" onclick="lvChangeBank()"><i class="fa-solid fa-pen"></i> Change bank account</button>` : ""}
    <div id="bankFormWrap" class="ve-bankform ${hasPayout ? "hidden" : ""}">
      <label>Bank</label>
      <button type="button" id="veBankPickerBtn" class="bank-picker-trigger" onclick="openVendorBankPicker()" aria-haspopup="dialog" aria-expanded="false">
        <span id="veBankPickerLabel">${esc(getBankDisplayName(v.bank_code, v.bank_name) || "Select a bank")}</span>
        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
      </button>
      <select id="veBankCode" data-current-bank="${esc(v.bank_code || "")}" class="hidden" aria-hidden="true" tabindex="-1">${NIGERIAN_BANKS.map((b) => `<option value="${esc(b.code)}" ${String(b.code) === String(v.bank_code || "") ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
      <label>Account number</label>
      <input id="veAccountNumber" inputmode="numeric" maxlength="10" placeholder="10-digit account number" value="${esc(v.account_number || "")}" />
      <button class="ve-btn ve-btn-primary ve-btn-wide ${hasPayout ? "" : "levro-pulse-attention"}" style="margin-top:0.8rem;" id="saveBankBtn" onclick="saveVendorBankDetails()">Save payout details</button>
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
async function toggleVendorShowOnline() {
  const checkbox = byId("veShowOnline");
  const checked = checkbox.checked;
  const { error } = await sb.from("vendors").update({ show_online_status: checked }).eq("id", vendor.id);
  if (error) { showToast(error.message, "error"); checkbox.checked = !checked; return; }
  vendor.show_online_status = checked;
  showToast(checked ? "Customers can see when you're online." : "Your online status is now hidden.", "success");
}
async function toggleVendorAfterHours() {
  const checkbox = byId("veAllowAfterHours");
  const checked = checkbox.checked;
  const { error } = await sb.from("vendors").update({ allow_after_hours_orders: checked }).eq("id", vendor.id);
  if (error) { showToast(error.message, "error"); checkbox.checked = !checked; return; }
  vendor.allow_after_hours_orders = checked;
  showToast(checked ? "Customers can now order from you outside working hours." : "Orders outside working hours are off.", "success");
}

// Customers: ask for a WhatsApp number (reminders and order updates reach them there). "Later" is allowed, but the
// question comes back every time the app is opened until a number is saved.
let lvAskingCustomerWa = false;
function lvAskCustomerWhatsapp() {
  if (lvAskingCustomerWa || !session || !profile || profile.role === "admin" || profile.role === "vendor") return;
  if (typeof vendor !== "undefined" && vendor) return;
  if (profile.whatsapp_number) return;
  if (byId("lvCwaModal")) return;
  lvAskingCustomerWa = true;
  const m = document.createElement("div");
  m.id = "lvCwaModal";
  m.className = "lv-dlg-back";
  m.innerHTML = `<div class="lv-dlg" role="dialog" aria-modal="true" aria-label="Add your WhatsApp number">
    <span class="lv-dlg-ic lv-dlg-ic-wa"><i class="fa-brands fa-whatsapp"></i></span>
    <h3>Add your WhatsApp number</h3>
    <p>So your orders and reminders reach you faster.</p>
    <label class="lv-dlg-field"><i class="fa-solid fa-phone"></i><input id="lvCwaInput" type="tel" inputmode="tel" placeholder="e.g. 08012345678" /></label>
    <div id="lvCwaErr" class="error-text hidden"></div>
    <div class="lv-dlg-act">
      <button type="button" class="lv-dlg-btn soft" id="lvCwaLater"><i class="fa-regular fa-clock"></i> Later</button>
      <button type="button" class="lv-dlg-btn go" id="lvCwaSave"><i class="fa-solid fa-check"></i> Save</button>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => { m.remove(); lvAskingCustomerWa = false; };
  byId("lvCwaLater").onclick = close;
  byId("lvCwaSave").onclick = async () => {
    const number = byId("lvCwaInput").value.trim().replace(/[\s().-]/g, "");
    const err = byId("lvCwaErr");
    if (!/^\+?\d{10,15}$/.test(number)) { err.textContent = "Please enter a valid phone number."; err.classList.remove("hidden"); return; }
    const { error } = await sb.from("users").update({ whatsapp_number: number }).eq("id", session.user.id);
    if (error) { err.textContent = error.message; err.classList.remove("hidden"); return; }
    profile.whatsapp_number = number;
    close();
    showToast("Saved. Thank you!", "success");
  };
}

// A shop without a WhatsApp number is asked for one when it opens its dashboard (new-order alerts go there).
let lvAskingWhatsapp = false;
async function lvAskWhatsapp() {
  if (lvAskingWhatsapp || typeof vendor === "undefined" || !vendor || vendor.whatsapp_number) return;
  lvAskingWhatsapp = true;
  try {
    const val = await showTextPromptDialog("Add your WhatsApp number", "New orders are sent to your WhatsApp so you never miss a sale. Enter the number you use on WhatsApp.", { placeholder: "e.g. 08012345678", okLabel: "Save" });
    if (val == null) return;
    const number = String(val).trim().replace(/[\s().-]/g, "");
    if (!/^\+?\d{10,15}$/.test(number)) { showToast("That doesn't look like a phone number.", "error"); return; }
    const { error } = await sb.from("vendors").update({ whatsapp_number: number, whatsapp_alerts: true }).eq("id", vendor.id);
    if (error) { showToast(error.message, "error"); return; }
    vendor.whatsapp_number = number; vendor.whatsapp_alerts = true;
    showToast("Saved. New orders will be sent to your WhatsApp.", "success");
  } finally { lvAskingWhatsapp = false; }
}

async function toggleVendorWhatsappAlerts() {
  const checkbox = byId("veWhatsappAlerts");
  const number = byId("veWhatsapp")?.value.trim() || "";
  if (!checkbox) return;
  if (checkbox.checked && !number) { checkbox.checked = false; showToast("Add a WhatsApp number first.", "info"); return; }
  const { error } = await sb.from("vendors").update({ whatsapp_alerts: checkbox.checked }).eq("id", vendor.id);
  if (error) { checkbox.checked = !checkbox.checked; showToast(error.message, "error"); return; }
  vendor.whatsapp_alerts = checkbox.checked;
  showToast(checkbox.checked ? "WhatsApp order alerts are on." : "WhatsApp order alerts are off.", "success");
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
    whatsapp_visible: false,
    opening_hours: summarizeBusinessHours(business_hours) || null,
    business_hours,
    allow_after_hours_orders: byId("veAllowAfterHours").checked,
    ...(Number(byId("veOrderExpiry")?.value ?? 30) !== Number(vendor.order_expiry_minutes ?? 30) ? { order_expiry_minutes: Number(byId("veOrderExpiry").value) } : {}),
    bio: byId("veBio").value.trim() || null,
  }).eq("id", vendor.id);
  if (error) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); return; }
  vendor.business_name = business_name;
  vendor.sector_id = sector_id || null;
  vendor.phone = phone;
  vendor.whatsapp_number = byId("veWhatsapp").value.trim() || null;
  vendor.whatsapp_visible = false;
  vendor.business_hours = business_hours;
  vendor.allow_after_hours_orders = byId("veAllowAfterHours").checked;
  vendor.order_expiry_minutes = Number(byId("veOrderExpiry")?.value ?? 30);
  try { localStorage.setItem("lv-expiry-set:" + vendor.id, "1"); } catch (e) {}
  updateAuthUI();
  const keepScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  showToast("Business profile saved.", "success");
  await navigate("vendorEditProfile", {}, false);
  requestAnimationFrame(() => window.scrollTo({ top: keepScrollY, left: 0, behavior: "auto" }));
}

async function uploadVendorCover(event) {
  const input = event.target, file = input.files?.[0];
  const clear = () => setTimeout(() => { try { input.value = ""; } catch (_) {} }, 6000);   // cleared late: some phones lose the file if it is cleared at once
  if (!file || !vendor) { try { input.value = ""; } catch (_) {} return; }
  const isImage = String(file.type || "").startsWith("image/") || (!file.type && /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name || ""));
  if (!isImage) { try { input.value = ""; } catch (_) {} showToast("Please choose an image file.", "error"); return; }
  showToast("Opening your photo…", "info");
  try { const small = await lvPrepareImageFile(file, 2000); pendingVendorCoverFile = small; openVendorCoverCropModal(small); }
  catch (e) { showToast("Couldn't open that photo. Try another one.", "error"); }
  finally { clear(); }
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

// ---------- SHOP TEAM (owner adds managers / staff; members work from a small "team workspace") ----------
// Rules live in the database (migrations 0057-0060): a manager handles orders, chat and listings, staff handle orders and
// chat; bank details, wallet, billing and settings stay with the owner. The customer always sees the shop's name.
window.lvMyTeams = window.lvMyTeams || [];
window.lvTeamInvites = window.lvTeamInvites || [];
async function lvLoadMyTeams() {
  try {
    if (!session) { window.lvMyTeams = []; window.lvTeamInvites = []; return; }
    const [t, i] = await Promise.all([sb.rpc("get_my_shop_teams"), sb.rpc("get_my_team_invites")]);
    window.lvMyTeams = Array.isArray(t.data) ? t.data : [];
    window.lvTeamInvites = Array.isArray(i.data) ? i.data : [];
  } catch (_) { window.lvMyTeams = []; window.lvTeamInvites = []; }
  if (window.lvTeamInvites.length) setTimeout(lvShowTeamInvite, 1200);
}
// A generated login address (business accounts, phone sign-ups) is never shown to people
function lvShownEmail(e) { const v = String(e || ""); return /@accounts\.levromart\.app$/i.test(v) ? "" : v; }

// ---------- a small bottom sheet for choices ----------
function lvSheet(title, sub, actions) {
  document.getElementById("lvSheet")?.remove();
  const el = document.createElement("div");
  el.id = "lvSheet"; el.className = "tm-sheet-wrap";
  el.innerHTML = `<div class="tm-sheet-dim" data-x></div><div class="tm-sheet" role="dialog" aria-modal="true"><span class="tm-sheet-grab"></span>
    <h3 class="tm-sheet-t">${esc(title)}</h3>${sub ? `<p class="tm-sheet-s">${esc(sub)}</p>` : ""}
    ${actions.map((a, i) => `<button type="button" class="tm-sheet-a${a.danger ? " danger" : ""}" data-i="${i}"><i class="fa-solid ${esc(a.icon || "fa-circle")}"></i><span>${esc(a.label)}</span></button>`).join("")}
    <button type="button" class="tm-sheet-close" data-x>Close</button></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("on"));
  const close = () => { el.classList.remove("on"); setTimeout(() => el.remove(), 180); };
  el.querySelectorAll("[data-x]").forEach((b) => (b.onclick = close));
  el.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => { close(); actions[Number(b.getAttribute("data-i"))].run(); }));
}

// "<Shop> invited you to their team" - the person decides (nobody is added without saying yes)
function lvShowTeamInvite() {
  const list = window.lvTeamInvites || [];
  const inv = list[0];
  if (!inv || document.getElementById("lvInviteModal") || !session) return;
  const isMgr = inv.role === "manager";
  const m = document.createElement("div");
  m.id = "lvInviteModal"; m.className = "lvinv"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true");
  m.innerHTML = `<div class="lvinv-card">
    <div class="lvinv-av">${lvAvInner(inv.logo_url, inv.business_name)}</div>
    <p class="lvinv-kicker">Team invitation${list.length > 1 ? ` · 1 of ${list.length}` : ""}</p>
    <h3 class="lvinv-name">${esc(inv.business_name)}</h3>
    <p class="lvinv-text">has invited you to join their team</p>
    <span class="lvinv-role"><i class="fa-solid ${isMgr ? "fa-user-gear" : "fa-user-check"}"></i> ${isMgr ? "Manager" : "Staff"}</span>
    <p class="lvinv-perm">${isMgr ? "You'll help with orders, chats and the shop's listings." : "You'll help with orders and chats."}</p>
    <div class="lvinv-actions"><button type="button" class="lvinv-no" id="lvInvNo">Decline</button><button type="button" class="lvinv-yes" id="lvInvYes">Accept</button></div>
    <button type="button" class="lvinv-later" id="lvInvLater">Decide later</button>
    <p class="lvinv-hint">You can answer later from <b>Team invitations</b> in your profile menu.</p></div>`;
  document.body.appendChild(m);
  const answer = async (accept) => {
    m.querySelectorAll("button").forEach((b) => (b.disabled = true));
    const r = await sb.rpc("respond_team_invite", { p_vendor_id: inv.vendor_id, p_accept: accept });
    m.remove();
    if (r.error) { showToast(r.error.message, "error"); }
    else showToast(accept ? `You joined ${inv.business_name}. Find it in your profile menu.` : "Invitation declined.", "success");
    await lvLoadMyTeams();
    try { updateAuthUI(); } catch (_) {}
  };
  byId("lvInvYes").onclick = () => answer(true);
  byId("lvInvNo").onclick = () => answer(false);
  byId("lvInvLater").onclick = () => m.remove();
}
function lvTeamOverlay(id, title, bodyHtml, sub) {
  document.getElementById(id)?.remove();
  const el = document.createElement("div");
  el.id = id; el.className = "tm-page";
  el.innerHTML = `<div class="tm-wrap"><div class="tm-top"><button type="button" class="tm-back" data-lv-close aria-label="Back"><i class="fa-solid fa-chevron-left"></i></button><div class="tm-top-t"><h2 class="tm-title">${esc(title)}</h2>${sub ? `<p class="tm-sub">${esc(sub)}</p>` : ""}</div></div><div data-lv-body>${bodyHtml}</div></div>`;
  document.body.appendChild(el);
  const onPop = () => { el.remove(); window.removeEventListener("popstate", onPop, true); };
  try { history.pushState(Object.assign({}, history.state, { lvOverlay: id }), ""); window.addEventListener("popstate", onPop, true); } catch (_) {}
  el.querySelector("[data-lv-close]").onclick = () => { if (history.state && history.state.lvOverlay === id) history.back(); else { el.remove(); try { window.removeEventListener("popstate", onPop, true); } catch (_) {} } };
  return el;
}
const LV_ROLE_LABEL = { manager: "Manager", staff: "Staff" };
const lvInitial = (n) => esc(String(n || "?").trim().charAt(0).toUpperCase() || "?");
// a person's or shop's picture, or their initial when they have none
const lvAvInner = (url, name) => (url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${lvInitial(name)}'))">` : lvInitial(name));

// ---------- Team page (the shop owner) ----------
async function lvOpenTeamPage() {
  if (!session || typeof vendor === "undefined" || !vendor) { showToast("Only shop owners can manage a team.", "info"); return; }
  const el = lvTeamOverlay("lvTeamPage", "Team", `<p class="muted">Loading…</p>`, vendor.business_name || "");
  const draw = async () => {
    const { data, error } = await sb.rpc("list_shop_team");
    const rows = Array.isArray(data) ? data : [];
    const active = rows.filter((m) => m.status !== "pending"), pending = rows.filter((m) => m.status === "pending");
    const body = el.querySelector("[data-lv-body]");
    const member = (m) => `<div class="tm-member"><div class="tm-av">${lvAvInner(m.avatar_url, m.name)}</div>
        <div class="tm-grow"><div class="tm-name">${esc(m.name || "Member")}</div>
          <div class="tm-member-meta"><span class="tm-chip ${m.role === "manager" ? "violet" : ""}">${esc(LV_ROLE_LABEL[m.role] || m.role)}</span>${m.status === "pending" ? `<span class="tm-chip amber">Waiting for reply</span>` : ""}</div></div>
        <button type="button" class="tm-more" data-more="${esc(m.user_id)}" aria-label="Options for ${esc(m.name || "member")}"><i class="fa-solid fa-ellipsis"></i></button></div>`;
    body.innerHTML = `
      ${error ? `<div class="tm-err">${esc(/not valid/i.test(error.message || "") ? "Teams aren't switched on yet. Please try again shortly." : error.message)}</div>` : ""}
      <div class="tm-hero tm-hero-soft"><div class="tm-hero-ic"><i class="fa-solid fa-people-group"></i></div><div><div class="tm-hero-name">${active.length ? `${active.length} ${active.length === 1 ? "person" : "people"} on your team` : "Build your team"}</div><div class="tm-hero-sub">${pending.length ? `${pending.length} invitation${pending.length === 1 ? "" : "s"} waiting for a reply` : "Share the work of running your shop"}</div></div></div>
      ${active.length ? `<p class="tm-label">Members</p><div class="tm-list">${active.map(member).join("")}</div>` : ""}
      ${pending.length ? `<p class="tm-label">Waiting for a reply</p><div class="tm-list">${pending.map(member).join("")}</div>` : ""}
      ${!rows.length ? `<div class="tm-empty"><i class="fa-solid fa-user-plus"></i><b>No one on your team yet</b>Invite someone below to help with orders and chats.</div>` : ""}
      <p class="tm-label">Invite someone</p>
      <div class="tm-card">
        <input id="lvTeamWho" class="tm-input" type="text" inputmode="email" autocomplete="off" placeholder="Their e-mail or phone number" />
        <div class="tm-roles" id="lvTeamRoles">
          <button type="button" class="tm-role on" data-role="staff"><i class="fa-solid fa-user-check"></i><b>Staff</b><span>Orders and chats</span></button>
          <button type="button" class="tm-role" data-role="manager"><i class="fa-solid fa-user-gear"></i><b>Manager</b><span>Orders, chats and listings</span></button></div>
        <div id="lvTeamErr" class="tm-err hidden"></div>
        <button type="button" class="tm-btn block" id="lvTeamAdd"><i class="fa-regular fa-paper-plane"></i> Send invitation</button>
        <p class="tm-fine">They'll get a notification and must accept before they can see anything. Wallet, bank details and settings always stay with you.</p></div>`;
    let role = "staff";
    body.querySelectorAll("[data-role]").forEach((b) => (b.onclick = () => { role = b.getAttribute("data-role"); body.querySelectorAll("[data-role]").forEach((x) => x.classList.toggle("on", x === b)); }));
    body.querySelectorAll("[data-more]").forEach((b) => (b.onclick = () => {
      const uid = b.getAttribute("data-more"); const m = rows.find((x) => x.user_id === uid); if (!m) return;
      const acts = [];
      if (m.status !== "pending") {
        acts.push(m.role === "manager"
          ? { label: "Make staff", icon: "fa-arrow-down", run: () => setRole(uid, "staff", m.name) }
          : { label: "Make manager", icon: "fa-arrow-up", run: () => setRole(uid, "manager", m.name) });
      }
      acts.push({ label: m.status === "pending" ? "Cancel invitation" : "Remove from team", icon: "fa-user-minus", danger: true, run: () => removeMember(uid, m.status === "pending") });
      lvSheet(m.name || "Member", `${LV_ROLE_LABEL[m.role] || m.role}${m.status === "pending" ? " · waiting for a reply" : ""}`, acts);
    }));
    byId("lvTeamAdd").onclick = async () => {
      const err = byId("lvTeamErr"); err.classList.add("hidden");
      const btn = byId("lvTeamAdd"); btn.disabled = true;
      const r = await sb.rpc("add_shop_team_member", { p_identifier: byId("lvTeamWho").value.trim(), p_role: role });
      btn.disabled = false;
      if (r.error) { err.textContent = /not valid/i.test(r.error.message || "") ? "Teams aren't switched on yet. Please try again shortly." : r.error.message; err.classList.remove("hidden"); return; }
      showToast("Invitation sent. They'll be asked to accept.", "success");
      draw();
    };
  };
  const setRole = async (uid, role, name) => {
    const r = await sb.rpc("set_shop_team_role", { p_user_id: uid, p_role: role });
    if (r.error) showToast(r.error.message, "error"); else showToast(role === "manager" ? `${name || "They"} is now a manager.` : `${name || "They"} is now staff.`, "success");
    draw();
  };
  const removeMember = async (uid, isPending) => {
    const ok = await showConfirmDialog(isPending ? "The invitation will be cancelled." : "They will lose access to your shop.", { title: isPending ? "Cancel this invitation?" : "Remove this person?", okLabel: isPending ? "Cancel invitation" : "Remove" });
    if (!ok) return;
    const r = await sb.rpc("remove_shop_team_member", { p_user_id: uid });
    if (r.error) showToast(r.error.message, "error"); else { showToast(isPending ? "Invitation cancelled." : "Removed.", "success"); draw(); }
  };
  draw();
}

// ---------- Several businesses from one login ----------
// "Add business" creates another business account linked to this login (server: api/delete-account.js). The owner switches
// between them without logging in again; each business keeps its own earnings, bank details, team and verification.
window.lvBiz = window.lvBiz || { isBusiness: false, count: 0, unread: 0, list: [], max: 5 };
async function lvLoadBusinessLinks() {
  try {
    if (!session) { window.lvBiz = { isBusiness: false, count: 0, unread: 0, list: [], max: 5 }; return; }
    const { data, error } = await sb.from("business_links").select("business_user_id, owner_id");
    if (error || !Array.isArray(data)) { window.lvBiz = { isBusiness: false, count: 0, unread: 0, list: [], max: 5 }; return; }
    const me = session.user.id;
    const isBusiness = data.some((l) => l.business_user_id === me), count = data.filter((l) => l.owner_id === me).length;
    window.lvBiz = Object.assign({ unread: 0, list: [], max: 5 }, { isBusiness, count });
    if (isBusiness || count > 0) {
      // the other accounts' pictures, state and unread notifications (only asked for people who actually have businesses)
      try {
        const d = await lvBizCall("list-businesses");
        const list = Array.isArray(d.businesses) ? d.businesses : [];
        window.lvBiz = { isBusiness: !!d.isBusiness, count: d.isBusiness ? 0 : list.length, list, owner: d.owner || null, max: d.max || 5, unread: list.reduce((n, b) => n + Number(b.unread || 0), 0), at: Date.now() };
      } catch (_) {}
    }
  } catch (_) { window.lvBiz = { isBusiness: false, count: 0, unread: 0, list: [], max: 5 }; }
  try { lvPaintBizBadge(); } catch (_) {}
}
// Instagram-style: a small number on your picture when your other accounts have something new
function lvPaintBizBadge() {
  const b = document.getElementById("avatarBtn"); if (!b) return;
  const n = Number((window.lvBiz && window.lvBiz.unread) || 0);
  let d = b.querySelector(".lv-biz-dot");
  if (!n) { if (d) d.remove(); return; }
  if (!d) { d = document.createElement("span"); d.className = "lv-biz-dot"; b.appendChild(d); }
  d.textContent = n > 9 ? "9+" : String(n);
}
(function () {
  const u0 = window.updateAuthUI;
  if (typeof u0 === "function" && !u0.__lvbiz) {
    const u1 = function () { const r = u0.apply(this, arguments); try { lvPaintBizBadge(); } catch (_) {} return r; };
    u1.__lvbiz = true; window.updateAuthUI = u1; try { updateAuthUI = u1; } catch (_) {}
  }
  setInterval(() => {
    if (document.visibilityState !== "visible" || typeof session === "undefined" || !session || !window.lvBiz || !(window.lvBiz.isBusiness || window.lvBiz.count > 0)) return;
    lvLoadBusinessLinks().then(() => { try { updateAuthUI(); } catch (_) {} });
  }, 90000);
})();
async function lvBizCall(action, extra) {
  const r = await fetch("/api/delete-account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ action, accessToken: session.access_token }, extra || {})) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || "Something went wrong. Please try again."); e.data = d; throw e; }
  return d;
}
// become the other account (fresh start so nothing of the previous one stays on screen)
async function lvUseSession(s, view) {
  const { error } = await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  if (error) throw error;
  try { localStorage.setItem("lv-after-switch", view || "home"); } catch (_) {}
  location.href = "/";
}
function lvAfterSwitch() {
  let v = ""; try { v = localStorage.getItem("lv-after-switch") || ""; localStorage.removeItem("lv-after-switch"); } catch (_) {}
  if (v && typeof navigate === "function") navigate(v);
}
function lvOpenAddBusiness() {
  if (!session) return;
  const el = lvTeamOverlay("lvAddBiz", "Add a business", `
    <div class="tm-hero tm-hero-soft"><div class="tm-hero-ic"><i class="fa-solid fa-store"></i></div><div><div class="tm-hero-name">A new business</div><div class="tm-hero-sub">Its own shop, orders, earnings, bank details and team</div></div></div>
    <div class="tm-card">
      <label class="tm-field-l" for="lvBizName">Business name</label>
      <input id="lvBizName" class="tm-input" type="text" maxlength="80" placeholder="e.g. Book Hub" autocomplete="off" />
      <div id="lvBizErr" class="tm-err hidden"></div>
      <button type="button" class="tm-btn block" id="lvBizGo" style="margin-top:.9rem">Create business</button></div>
    <p class="tm-fine" style="padding:0 .4rem">Your details are filled in for you. You can switch between your businesses any time from <b>Businesses</b> in your profile menu, without logging in again.</p>`);
  byId("lvBizGo").onclick = async () => {
    const name = byId("lvBizName").value.trim(); const err = byId("lvBizErr"); err.classList.add("hidden");
    if (name.length < 2) { err.textContent = "Enter the business name."; err.classList.remove("hidden"); return; }
    const btn = byId("lvBizGo"); btn.disabled = true; btn.textContent = "Creating…";
    try {
      const d = await lvBizCall("create-business", { name });
      await lvUseSession(d.session, "vendorApply");
    } catch (e) { btn.disabled = false; btn.textContent = "Create business"; err.textContent = e.message; err.classList.remove("hidden"); }
  };
  setTimeout(() => byId("lvBizName")?.focus(), 150);
  return el;
}
function lvDeleteBusiness(b, back) {
  if (!b) return;
  const ov = lvTeamOverlay("lvDelBiz", "Delete this business?", "", "This cannot be undone");
  const body = ov.querySelector("[data-lv-body]");
  body.innerHTML = `<div class="tm-hero tm-hero-soft"><div class="tm-av" style="width:3.2rem;height:3.2rem">${lvAvInner(b.logo, b.name)}</div><div><div class="tm-hero-name">${esc(b.name)}</div><div class="tm-hero-sub">${b.status === "verified" ? "Verified shop" : b.status === "setup_needed" ? "Not set up yet" : "Under review"}</div></div></div>
    <div class="tm-card"><b>What happens</b><div class="tm-sub">Its listings, followers, chats, wallet and everything else in this business are removed. It is not possible while it still has an order that is not finished, money in its wallet or commission to pay.</div></div>
    <label class="tm-label">Type your password to confirm</label><input type="password" id="lvDelBizPw" class="tm-input" autocomplete="current-password" placeholder="Your password">
    <div id="lvDelBizErr" class="tm-err" hidden></div>
    <button type="button" class="tm-btn danger block" id="lvDelBizGo"><i class="fa-regular fa-trash-can"></i> Delete ${esc(b.name)}</button>`;
  byId("lvDelBizGo").onclick = async function () {
    const pw = byId("lvDelBizPw").value; const err = byId("lvDelBizErr"); err.hidden = true;
    if (!pw) { err.textContent = "Enter your password."; err.hidden = false; return; }
    this.disabled = true;
    try { await lvBizCall("delete-business", { targetUserId: b.userId, password: pw }); showToast("Business deleted.", "success"); ov.remove(); if (back) back.remove(); lvOpenSwitchBusiness(); }
    catch (e) { this.disabled = false; err.textContent = e.message; err.hidden = false; }
  };
}
async function lvOpenSwitchBusiness() {
  if (!session) return;
  const el = lvTeamOverlay("lvSwitchBiz", "Businesses", `<p class="muted">Loading…</p>`, "Switch between your accounts");
  const body = el.querySelector("[data-lv-body]");
  const chip = (st) => st === "verified" ? `<span class="tm-chip">Verified</span>` : st === "setup_needed" ? `<span class="tm-chip amber">Set up needed</span>` : `<span class="tm-chip blue">Under review</span>`;
  const badge = (n) => (Number(n) > 0 ? `<span class="tm-unread" aria-label="${Number(n)} new">${Number(n) > 99 ? "99+" : Number(n)}</span>` : "");
  try {
    const d = await lvBizCall("list-businesses");
    const max = d.max || 5;
    const go = async (userId, view, btn) => {
      btn.style.opacity = ".6"; btn.disabled = true;
      try { const r = await lvBizCall("switch-business", { targetUserId: userId }); await lvUseSession(r.session, view); }
      catch (e) { btn.style.opacity = ""; btn.disabled = false; showToast(e.message, "error"); }
    };
    if (d.isBusiness) {
      const owner = d.businesses[0] || { userId: "", name: "your main account", logo: null, unread: 0 };
      body.innerHTML = `<p class="tm-label">You are in a business</p>
        <button type="button" class="tm-biz" data-go="${esc(owner.userId)}" data-view="home"><div class="tm-av">${lvAvInner(owner.logo, owner.name)}</div><div class="tm-grow"><div class="tm-name">Back to ${esc(owner.name)}</div><div class="tm-member-meta"><span class="tm-chip grey">Your main account</span></div></div>${badge(owner.unread)}<i class="fa-solid fa-chevron-right tm-go"></i></button>
        <p class="tm-fine" style="padding:0 .4rem">Orders, earnings, bank details and the team of this business are separate from your main account.</p>`;
    } else {
      const list = d.businesses || [];
      const room = list.length < max;
      body.innerHTML = `<div class="tm-hero tm-hero-soft"><div class="tm-hero-ic"><i class="fa-solid fa-store"></i></div><div><div class="tm-hero-name">${list.length} of ${max} businesses</div><div class="tm-hero-sub">${room ? "Add up to " + (max - list.length) + " more on this login" : "You've reached the limit of " + max}</div></div></div>
        ${list.length ? `<p class="tm-label">Your businesses</p><div class="tm-list">${list.map((b) => `<button type="button" class="tm-biz" data-go="${esc(b.userId)}" data-view="${b.status === "setup_needed" ? "vendorApply" : "vendorDashboard"}"><div class="tm-av">${lvAvInner(b.logo, b.name)}</div><div class="tm-grow"><div class="tm-name">${esc(b.name)}</div><div class="tm-member-meta">${chip(b.status)}</div></div>${badge(b.unread)}<i class="fa-solid fa-chevron-right tm-go"></i></button>`).join("")}</div>` : `<div class="tm-empty"><i class="fa-solid fa-store"></i><b>No other businesses yet</b>Add one to run a second shop from this login.</div>`}
        <button type="button" class="tm-btn block${room ? "" : " ghost"}" id="lvSwAdd" ${room ? "" : "disabled"}><i class="fa-solid fa-plus"></i> Add business</button>`;
      byId("lvSwAdd").onclick = () => lvOpenAddBusiness();
    }
    body.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.getAttribute("data-go"), b.getAttribute("data-view"), b)));
    if (!d.isBusiness && (d.businesses || []).length) {
      body.insertAdjacentHTML("beforeend", `<p class="tm-label" style="margin-top:1.2rem">Remove a business</p><div class="tm-list">${d.businesses.map((b) => `<div class="tm-biz tm-biz-del"><div class="tm-av">${lvAvInner(b.logo, b.name)}</div><div class="tm-grow"><div class="tm-name">${esc(b.name)}</div></div><button type="button" class="tm-btn danger" data-del-biz="${esc(b.userId)}"><i class="fa-regular fa-trash-can"></i> Delete</button></div>`).join("")}</div>`);
      body.querySelectorAll("[data-del-biz]").forEach((x) => (x.onclick = () => lvDeleteBusiness((d.businesses || []).find((b) => b.userId === x.getAttribute("data-del-biz")), el)));
    }
    // opening this page refreshes the badge
    window.lvBiz = Object.assign({}, window.lvBiz, { unread: (d.businesses || []).reduce((n, b) => n + Number(b.unread || 0), 0), list: d.businesses || [] });
    try { lvPaintBizBadge(); updateAuthUI(); } catch (_) {}
  } catch (e) { body.innerHTML = `<div class="tm-err">${esc(e.message)}</div>`; }
}
// A business's shop application starts with the owner's phone, WhatsApp, city and CAC number filled in
(function () {
  new MutationObserver(function () {
    const el = document.getElementById("vaPhone");
    if (!el || el.dataset.lvPre) return;
    el.dataset.lvPre = "1";
    try {
      const o = window.lvBiz && window.lvBiz.isBusiness && window.lvBiz.owner; if (!o) return;
      const put = (id, v) => { const x = document.getElementById(id); if (x && !String(x.value || "").trim() && v) x.value = v; };
      put("vaPhone", o.phone); put("vaWhatsapp", o.whatsapp); put("vaCac", o.cac); put("vaBusinessName", profile && profile.name);
      const c = document.getElementById("vaCity"); if (c && o.city && /^lagos$/i.test(String(c.value || "").trim())) c.value = o.city;
      const first = document.querySelector(".va-sec"); if (first && !document.getElementById("vaPrefillNote")) first.insertAdjacentHTML("beforebegin", '<div id="vaPrefillNote" class="va-prefill"><i class="fa-solid fa-wand-magic-sparkles"></i> We filled in your details from your main account. Check them and submit.</div>');
    } catch (_) {}
  }).observe(document.body, { childList: true, subtree: true });
})();

// ---------- Team workspace (a team member working for a shop) ----------
function lvTeamOrderCard(o) {
  const st = o.status;
  const label = { pending: "New order", confirmed: "Accepted", handed_over: "Handed over", completed: "Completed", cancelled: "Cancelled", disputed: "Dispute", payment_unresolved: "Payment issue", returned: "Returned" }[st] || st;
  const chipCls = st === "pending" ? "amber" : st === "handed_over" ? "blue" : st === "cancelled" || st === "disputed" || st === "payment_unresolved" ? "red" : "";
  const who = o.buyer_name ? esc(o.buyer_name) : "A customer";
  const actions = st === "pending"
    ? `<button type="button" class="tm-btn" data-act="confirmed">Accept</button><button type="button" class="tm-btn ghost" data-act="decline">Decline</button>`
    : st === "confirmed"
      ? `<button type="button" class="tm-btn" data-act="handed_over">Mark handed over</button><button type="button" class="tm-btn danger" data-act="decline">Cancel</button>`
      : st === "handed_over" ? `<div class="tm-sub">Waiting for the customer to confirm.</div>`
      : st === "cancelled" ? `<button type="button" class="tm-btn" data-avail><i class="fa-regular fa-paper-plane"></i> Still available</button>` : "";
  return `<div class="tm-card" data-oid="${esc(o.id)}" data-st="${esc(st)}">
    <div class="tm-row"><span class="tm-chip ${chipCls}">${esc(label)}</span><span class="tm-grow"></span><span class="tm-money">₦${Number(o.total_amount || 0).toLocaleString()}</span></div>
    <div class="tm-meta"><span><i class="fa-regular fa-user"></i> ${who}</span><span><i class="fa-solid ${o.delivery_method === "delivery" ? "fa-truck" : "fa-shop"}"></i> ${o.delivery_method === "delivery" ? "Delivery" : "Pickup"}</span><span><i class="fa-regular fa-clock"></i> ${esc(timeAgo(o.created_at))}</span></div>
    <div class="tm-items">${esc(o.items || "")}</div><div class="tm-actions">${actions}<button type="button" class="tm-btn ghost" data-open>Full details</button></div></div>`;
}
async function lvOpenTeamWorkspace(vendorId, shopName, role) {
  const team = (window.lvMyTeams || []).find((t) => t.vendor_id === vendorId);
  const myRole = role || (team && team.role) || "staff";
  const el = lvTeamOverlay("lvTeamWorkspace", shopName || "Shop", `<p class="muted">Loading…</p>`);
  const body = el.querySelector("[data-lv-body]");
  let tab = "orders", timer = null, ordFilter = "active";
  const hero = () => `<div class="tm-card tm-hero"><div class="tm-av">${lvAvInner(team && team.logo_url, shopName)}</div><div><div class="tm-hero-name">${esc(shopName || "Shop")}</div><div class="tm-hero-sub">You work here as ${esc((LV_ROLE_LABEL[myRole] || "Staff").toLowerCase())}</div></div></div>`;
  const tabs = () => `<div class="tm-seg"><button type="button" class="${tab === "orders" ? "on" : ""}" data-tab="orders">Orders</button><button type="button" class="${tab === "chats" ? "on" : ""}" data-tab="chats">Chats</button>${myRole === "manager" ? `<button type="button" class="${tab === "listings" ? "on" : ""}" data-tab="listings">Listings</button>` : ""}</div>`;
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  const bindTabs = () => body.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.getAttribute("data-tab"); stop(); draw(); }));
  new MutationObserver((_, ob) => { if (!document.body.contains(el)) { stop(); ob.disconnect(); } }).observe(document.body, { childList: true });

  const drawOrders = async () => {
    const { data, error } = await sb.rpc("get_team_shop_orders", { p_vendor_id: vendorId, p_active_only: ordFilter === "active" });
    const rows = Array.isArray(data) ? data : [];
    const shown = ordFilter === "cancelled" ? rows.filter((r) => r.status === "cancelled") : rows;
    body.innerHTML = hero() + tabs() + `<div class="tm-seg tm-seg-s"><button type="button" class="${ordFilter === "active" ? "on" : ""}" data-of="active">Active</button><button type="button" class="${ordFilter === "all" ? "on" : ""}" data-of="all">All</button><button type="button" class="${ordFilter === "cancelled" ? "on" : ""}" data-of="cancelled">Cancelled</button></div>` + (error ? `<div class="tm-err">${esc(error.message)}</div>` : "") +
      (shown.length ? shown.map(lvTeamOrderCard).join("") : `<div class="tm-card tm-empty"><i class="fa-solid fa-bag-shopping"></i><b>${ordFilter === "cancelled" ? "No cancelled orders" : "No orders here"}</b>New orders will show up here.</div>`) +
      `<button type="button" class="tm-btn ghost block" id="lvTeamRefresh"><i class="fa-solid fa-rotate"></i> Refresh</button>`;
    bindTabs();
    byId("lvTeamRefresh").onclick = draw;
    body.querySelectorAll("[data-of]").forEach((b) => (b.onclick = () => { ordFilter = b.getAttribute("data-of"); stop(); draw(); }));
    body.querySelectorAll("[data-oid]").forEach((card) => (card.onclick = (ev) => {
      if (ev.target.closest("[data-act],[data-avail]")) return;
      const oid = card.getAttribute("data-oid"); stop(); el.remove();
      try { navigate("orderDetail", { orderId: oid }); } catch (_) {}
    }));
    body.querySelectorAll("[data-oid] [data-avail]").forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); sendStillAvailable(b.closest("[data-oid]").getAttribute("data-oid"), b); }));
    body.querySelectorAll("[data-oid] [data-act]").forEach((b) => (b.onclick = async () => {
      const card = b.closest("[data-oid]"); const oid = card.getAttribute("data-oid"); const act = b.getAttribute("data-act");
      b.disabled = true;
      try {
        if (act === "decline") { await vendorDeclineOrder(oid, card.getAttribute("data-st")); }
        else {
          const r = await sb.rpc("transition_order_status", { p_order_id: oid, p_new_status: act });
          if (r.error) showToast(r.error.message, "error"); else showToast(act === "confirmed" ? "Order accepted." : "Marked as handed over.", "success");
        }
      } catch (e) { showToast(e.message || "Something went wrong.", "error"); }
      draw();
    }));
  };
  const drawChats = async () => {
    const { data, error } = await sb.rpc("get_team_shop_chats", { p_vendor_id: vendorId });
    const rows = Array.isArray(data) ? data : [];
    body.innerHTML = hero() + tabs() + (error ? `<div class="tm-err">${esc(error.message)}</div>` : "") +
      (rows.length ? rows.map((c) => `<button type="button" class="tm-card tm-row" data-conv="${esc(c.id)}" data-name="${esc(c.buyer_name || "Customer")}" data-av="${esc(c.buyer_avatar || "")}" style="width:100%;text-align:left;cursor:pointer;color:inherit"><div class="tm-av">${lvAvInner(c.buyer_avatar, c.buyer_name)}</div><div class="tm-grow"><div class="tm-name">${esc(c.buyer_name || "Customer")}</div><div class="tm-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.last_body || "")}</div></div>${c.unread > 0 ? `<span class="tm-unread">${c.unread}</span>` : ""}</button>`).join("") : `<div class="tm-card tm-empty"><i class="fa-regular fa-comments"></i><b>No chats yet</b>Customer messages will show up here.</div>`);
    bindTabs();
    body.querySelectorAll("[data-conv]").forEach((b) => (b.onclick = () => openThread(b.getAttribute("data-conv"), b.getAttribute("data-name"), b.getAttribute("data-av"))));
  };
  const openThread = async (convId, name, avatarUrl) => {
    stop();
    const paint = async (keepDraft) => {
      const draft = keepDraft ? (byId("lvTeamMsg")?.value || "") : "";
      const { data, error } = await sb.rpc("get_team_chat_messages", { p_conversation_id: convId });
      const msgs = Array.isArray(data) ? data : [];
      body.innerHTML = `<div class="tm-row" style="margin-bottom:.6rem"><button type="button" class="tm-iconbtn" id="lvTeamBackChats" aria-label="Back to chats"><i class="fa-solid fa-chevron-left"></i></button><div class="tm-av" style="width:36px;height:36px;font-size:.9rem">${lvAvInner(avatarUrl, name)}</div><div class="tm-name">${esc(name)}</div></div>
        ${error ? `<div class="tm-err">${esc(error.message)}</div>` : ""}
        <div class="tm-card"><div id="lvTeamThread" class="tm-thread">${msgs.map((m) => `<div class="tm-bubble ${m.from_customer ? "in" : "out"}">${esc(m.body)}</div>`).join("") || `<div class="tm-sub">No messages yet.</div>`}</div></div>
        <div class="tm-compose"><input id="lvTeamMsg" class="tm-input" type="text" maxlength="2000" placeholder="Reply as the shop…" value="${esc(draft)}" /><button type="button" class="tm-btn" id="lvTeamSend" aria-label="Send"><i class="fa-solid fa-paper-plane"></i></button></div>`;
      const th = byId("lvTeamThread"); if (th) th.scrollTop = th.scrollHeight;
      byId("lvTeamBackChats").onclick = () => { stop(); tab = "chats"; draw(); };
      const send = async () => {
        const inp = byId("lvTeamMsg"); const text = inp.value.trim(); if (!text) return;
        byId("lvTeamSend").disabled = true;
        const r = await sb.rpc("team_send_message", { p_conversation_id: convId, p_body: text });
        if (r.error) { showToast(r.error.message, "error"); byId("lvTeamSend").disabled = false; return; }
        paint(false);
      };
      byId("lvTeamSend").onclick = send;
      byId("lvTeamMsg").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } };
    };
    await paint(false);
    timer = setInterval(() => { if (document.body.contains(el) && !byId("lvTeamMsg")?.value) paint(true); }, 8000);
  };
  // managers can pause, resume and delete the shop's listings (adding and editing stay in the owner's own screens for now)
  const drawListings = async () => {
    const { data, error } = await sb.from("products").select("id,name,photos,sale_price,status,is_service").eq("vendor_id", vendorId).order("created_at", { ascending: false }).limit(80);
    const rows = Array.isArray(data) ? data : [];
    body.innerHTML = hero() + tabs() + (error ? `<div class="tm-err">${esc(error.message)}</div>` : "") +
      (rows.length ? rows.map((p) => `<div class="tm-card tm-lst" data-pid="${esc(p.id)}"><div class="tm-row"><span class="tm-lst-ph">${p.photos && p.photos[0] ? `<img src="${esc(p.photos[0])}" alt="" loading="lazy">` : `<i class="fa-solid fa-image"></i>`}</span><div class="tm-grow"><b>${esc(p.name)}</b><div class="tm-sub">${p.sale_price ? "₦" + Number(p.sale_price).toLocaleString() + " · " : ""}${esc(p.status === "active" ? "Live" : p.status === "paused" ? "Paused" : String(p.status))}</div></div></div><div class="tm-actions"><button type="button" class="tm-btn ghost" data-lact="${p.status === "active" ? "paused" : "active"}">${p.status === "active" ? "Pause" : "Resume"}</button><button type="button" class="tm-btn danger" data-lact="delete">Delete</button></div></div>`).join("") : `<div class="tm-card tm-empty"><i class="fa-solid fa-box-open"></i><b>No listings yet</b>The owner's listings will show here.</div>`);
    bindTabs();
    body.querySelectorAll("[data-pid] [data-lact]").forEach((b) => (b.onclick = async () => {
      const pid = b.closest("[data-pid]").getAttribute("data-pid"), act = b.getAttribute("data-lact");
      if (act === "delete" && !window.confirm("Delete this listing for good?")) return;
      b.disabled = true;
      const r = act === "delete" ? await sb.from("products").delete().eq("id", pid) : await sb.from("products").update({ status: act }).eq("id", pid);
      if (r.error) showToast(r.error.message || "That did not work.", "error"); else showToast(act === "delete" ? "Listing deleted." : act === "paused" ? "Listing paused." : "Listing is live again.", "success");
      drawListings();
    }));
  };
  const draw = () => (tab === "chats" ? drawChats() : tab === "listings" ? drawListings() : drawOrders());
  draw();
}
