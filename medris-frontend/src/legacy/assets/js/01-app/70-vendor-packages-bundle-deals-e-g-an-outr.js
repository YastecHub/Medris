// ---------- VENDOR PACKAGES (bundle deals, e.g. an "Outreach Kit") ----------
let editingPackageId = null;

async function renderVendorPackages(embedded = false) {
  if (!session || profile?.role === "admin" || (profile?.role !== "vendor" && !vendor)) return '<div class="empty-state">Access denied.</div>';
  const { data: v } = await sb.from("vendors").select("*").eq("user_id", session.user.id).is("deleted_at", null).maybeSingle();
  if (!v) { navigate("vendorApply"); return '<p class="muted">Redirecting…</p>'; }
  vendor = v;

  const [{ data: packages, error:packageError }, { data: monthlyPackageSubmissions }] = await Promise.all([
    sb.from("vendor_packages").select("*, items:package_items(quantity, product:products(name))").eq("vendor_id", v.id).order("created_at", { ascending: false }),
    sb.from("monthly_listing_submissions").select("listing_id,status,submitted_at,review_note").eq("vendor_id", v.id).eq("kind","package").order("submitted_at", { ascending: false }).limit(100)
  ]);
  const pendingMonthlyPackageIds = new Set((monthlyPackageSubmissions || []).filter(x => x.status === "pending").map(x => String(x.listing_id)));

  let html = `<div class="flex" style="justify-content:space-between;">
    <div><h2>Packages</h2><p class="muted" style="margin:0;">Bundle a few products into one fixed-price deal, like an outreach kit.</p></div>
    <button class="btn" onclick="openAddPackageModal()">+ Add package</button>
  </div>`;
  if (v.verification_status !== "verified") html += `<p class="muted">Packages won't appear publicly until your vendor account is verified.</p>`;

  if(packageError)return html+errorStateHtml(packageError);
  if (!packages || packages.length === 0) { html += `<div class="empty-state">No packages yet. Bundle products you already sell into one fixed-price deal to stand out.</div>`; return html; }

    html += `<div class="grid">${packages.map((pkg) => `<div class="card package-card">
     ${Array.isArray(pkg.photos) && pkg.photos[0] ? `<img class="package-photo-main" src="${esc(pkg.photos[0])}" alt="${esc(pkg.name)}" loading="lazy" />` : `<div class="package-gallery-placeholder" style="height:120px;margin-bottom:.65rem;"><i class="fa-solid fa-box-open"></i>&nbsp; No package photo</div>`}
    <div class="flex" style="justify-content:space-between;"><strong>${esc(pkg.name)}</strong><span class="badge ${pkg.status === "active" ? "success" : "warning"}">${esc(pkg.status)}</span></div>
    ${pkg.description ? `<p class="muted" style="margin:0.3rem 0;">${esc(pkg.description)}</p>` : ""}
    <p class="muted" style="font-size:0.85rem;">${(pkg.items || []).map((it) => `${it.quantity}× ${esc(it.product?.name || "")}`).join(", ") || "No items yet"}</p>
    ${pkg.billing_model === "monthly" && pendingMonthlyPackageIds.has(String(pkg.id)) ? `<p class="muted monthly-vendor-pending-note"><i class="fa-solid fa-clock"></i> Receipt submitted · awaiting admin approval</p>` : pkg.billing_model === "monthly" && pkg.billing_status === "cancelled" ? `<p class="muted monthly-vendor-rejected-note"><i class="fa-solid fa-circle-exclamation"></i> Monthly listing deactivated. Submit a new ₦999 receipt to restore it.</p>` : ""}
    <p style="margin:0.4rem 0;"><strong>${naira(pkg.price)}</strong></p>
    <div class="flex">
      <button class="btn btn-sm" onclick="openEditPackageModal('${pkg.id}')"><i class='fa-solid fa-pen'></i> Edit</button>
      ${pkg.status === "active" ? `<button class="btn btn-sm" style="background:#6b7280;" onclick="setPackageStatus('${pkg.id}','paused')">Pause</button>` : (pkg.billing_model === "monthly" ? (pendingMonthlyPackageIds.has(String(pkg.id)) ? `<button class="btn btn-sm btn-outline" disabled><i class="fa-solid fa-clock"></i> Receipt submitted</button>` : `<button class="btn btn-sm" onclick="startListingMonthlyPayment('package','${pkg.id}')"><i class="fa-solid fa-receipt"></i> ${pkg.billing_status === "pending_payment" ? "Submit ₦999 receipt" : "Renew ₦999"}</button>`) : `<button class="btn btn-sm" onclick="setPackageStatus('${pkg.id}','active')">Activate</button>`)}
      <button class="btn btn-sm btn-danger" onclick="deletePackage('${pkg.id}')"><i class='fa-solid fa-trash'></i> Delete</button>
    </div>
  </div>`).join("")}</div>`;
  return html;
}

async function openAddPackageModal() {
  editingPackageId = null;
  await showPackageModal();
}
async function openEditPackageModal(packageId) {
  editingPackageId = packageId;
  await showPackageModal();
}

async function showPackageModal() {
  byId("packageError").classList.add("hidden");
  byId("pkgExistingPhotos").innerHTML = "";
  byId("pkgNewPhotoPreviews").innerHTML = "";
  byId("pkgPhotoFiles").value = "";
  window.__existingPackagePhotos = [];
  window.__newPackagePhotoFiles = [];

  // The product list for the picker is cached briefly and fetched alongside everything else, so the
  // card opens straight away instead of waiting on the network first.
  const cachedPkgProducts = window.__pkgProductsCache && Date.now() - window.__pkgProductsCache.at < 120000 ? window.__pkgProductsCache.rows : null;
  const productsP = Promise.resolve(sb.from("products").select("id, name, sale_price")
    .eq("vendor_id", vendor.id).eq("status", "active").not("sale_price", "is", null).order("name"))
    .then(({ data }) => { const rows = data || []; window.__pkgProductsCache = { at: Date.now(), rows }; return rows; }).catch(() => cachedPkgProducts || []);

  let selectedQty = {};
  if (editingPackageId) {
    const { data: pkg, error } = await sb.from("vendor_packages").select("*, items:package_items(product_id, quantity)").eq("id", editingPackageId).single();
    const { data: engagement } = await sb.from("package_engagement_settings").select("like_visibility,allow_comments,comment_audience").eq("package_id",editingPackageId).maybeSingle();
    if (error || !pkg) { showToast(error?.message || "Package not found.", "error"); return; }
    byId("packageModalTitle").textContent = "Edit Package";
    byId("pkgName").value = pkg.name || "";
    byId("pkgDesc").value = pkg.description || "";
    byId("pkgPrice").value = pkg.price ?? "";
    if (byId("pkgBillingModel")) byId("pkgBillingModel").value = pkg.billing_model || "commission";
    byId("pkgLikeVisibility").value=engagement?.like_visibility||"everyone";byId("pkgAllowComments").checked=engagement?.allow_comments!==false;byId("pkgCommentAudience").value=engagement?.comment_audience||"everyone";
    window.__existingPackagePhotos = Array.isArray(pkg.photos) ? pkg.photos.filter(Boolean) : [];
    renderExistingPackagePhotos();
    (pkg.items || []).forEach((it) => { selectedQty[it.product_id] = it.quantity; });
  } else {
    byId("packageModalTitle").textContent = "Add New Package";
    if (byId("pkgBillingModel")) byId("pkgBillingModel").value = "commission";
    byId("pkgLikeVisibility").value="everyone";byId("pkgAllowComments").checked=true;byId("pkgCommentAudience").value="everyone";
    byId("pkgName").value = "";
    byId("pkgDesc").value = "";
    byId("pkgPrice").value = "";
  }

  const renderPkgItems = (myProducts) => {
    byId("pkgItemsList").innerHTML = (myProducts && myProducts.length)
      ? myProducts.map((p) => `<div class="pkg-item-row">
        <input type="checkbox" class="pkg-item-check" id="pkgCheck-${p.id}" ${selectedQty[p.id] ? "checked" : ""} onchange="togglePkgItemQty('${p.id}')" />
        <span style="flex:1;">${esc(p.name)} <span class="muted">(${naira(p.sale_price)})</span></span>
        <input type="number" id="pkgQty-${p.id}" value="${selectedQty[p.id] || 1}" min="1" class="${selectedQty[p.id] ? "" : "hidden"}" />
      </div>`).join("")
      : `<p class="muted" style="margin:0;">You don't have any sellable products yet. Add one first from My Products.</p>`;
  };
  if (cachedPkgProducts) renderPkgItems(cachedPkgProducts);
  else byId("pkgItemsList").innerHTML = `<p class="muted" style="margin:0;">Loading your products…</p>`;
  syncPackageEngagementSettingsUI();
  byId("packageModal").classList.remove("hidden");
  trackModalOpened("packageModal");
  const freshRows = await productsP;
  const sameList = cachedPkgProducts && cachedPkgProducts.length === freshRows.length && cachedPkgProducts.every((r, i) => r.id === freshRows[i].id);
  if (!sameList && !byId("packageModal").classList.contains("hidden")) {
    document.querySelectorAll("#pkgItemsList .pkg-item-check").forEach((c) => { if (c.checked) { const id = c.id.replace("pkgCheck-", ""); selectedQty[id] = Number(byId("pkgQty-" + id)?.value) || 1; } });
    renderPkgItems(freshRows);
  }
}
function renderExistingPackagePhotos() {
  const wrap = byId("pkgExistingPhotos");
  if (!wrap) return;
  wrap.innerHTML = (window.__existingPackagePhotos || []).map((url, index) =>
    `<div class="photo-thumb"><img src="${esc(url)}" alt="Package photo ${index + 1}" /><button type="button" class="photo-remove" onclick="removeExistingPackagePhoto(${index})" title="Remove" aria-label="Remove package photo"><i class="fa-solid fa-xmark"></i></button></div>`
  ).join("");
}
function removeExistingPackagePhoto(index) {
  window.__existingPackagePhotos = (window.__existingPackagePhotos || []).filter((_, i) => i !== index);
  renderExistingPackagePhotos();
}
function syncNewPackagePhotoInput() {
  const input = byId("pkgPhotoFiles");
  if (!input) return;
  try {
    const dt = new DataTransfer();
    (window.__newPackagePhotoFiles || []).forEach((file) => dt.items.add(file));
    input.files = dt.files;
  } catch (_) {}
}
function renderNewPackagePhotos() {
  const wrap = byId("pkgNewPhotoPreviews");
  if (!wrap) return;
  wrap.innerHTML = "";
  (window.__newPackagePhotoFiles || []).forEach((f, index) => {
    const url = URL.createObjectURL(f);
    const node = document.createElement("div");
    node.className = "photo-thumb";
    node.innerHTML = `<img src="${url}" alt="${esc(f.name || "Package image")}" /><button type="button" class="photo-remove" onclick="removeNewPackagePhoto(${index})" title="Remove photo" aria-label="Remove photo"><i class="fa-solid fa-xmark"></i></button><span class="photo-pending-badge">new</span>`;
    wrap.appendChild(node);
  });
}
function previewNewPackagePhotos() {
  const files = [...(byId("pkgPhotoFiles")?.files || [])].filter((f) => f.type?.startsWith("image/"));
  window.__newPackagePhotoFiles = [...(window.__newPackagePhotoFiles || []), ...files];
  syncNewPackagePhotoInput();
  renderNewPackagePhotos();
}
function removeNewPackagePhoto(index) {
  const files = window.__newPackagePhotoFiles || [];
  if (index < 0 || index >= files.length) return;
  window.__newPackagePhotoFiles = files.filter((_, i) => i !== index);
  syncNewPackagePhotoInput();
  renderNewPackagePhotos();
}
(function setupPackagePhotoDropzone() {
  document.addEventListener("dragover", (e) => {
    const zone = e.target.closest && e.target.closest("#packagePhotoDropzone");
    if (zone) { e.preventDefault(); zone.classList.add("drag-over"); }
  });
  document.addEventListener("dragleave", (e) => {
    const zone = e.target.closest && e.target.closest("#packagePhotoDropzone");
    if (zone) zone.classList.remove("drag-over");
  });
  document.addEventListener("drop", (e) => {
    const zone = e.target.closest && e.target.closest("#packagePhotoDropzone");
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove("drag-over");
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type?.startsWith("image/"));
    if (!files.length) return;
    window.__newPackagePhotoFiles = [...(window.__newPackagePhotoFiles || []), ...files];
    syncNewPackagePhotoInput();
    renderNewPackagePhotos();
  });
})();

function togglePkgItemQty(productId) {
  const checked = byId(`pkgCheck-${productId}`).checked;
  byId(`pkgQty-${productId}`)?.classList.toggle("hidden", !checked);
}

function closePackageModal(options = {}) {
  if(byId('packageModal')?.dataset.discardDraft==='1'){options.skipDraft=true;delete byId('packageModal').dataset.discardDraft;}
  delete byId('packageModal').dataset.draftRestored;
  if (!options.skipDraft && typeof window.__captureListingDraftForModal === "function") {
    try { window.__captureListingDraftForModal("package"); } catch (_) {}
  }
  byId("packageModal").classList.add("hidden");
  if (dismissibleModalId === "packageModal") dismissibleModalId = null;
}

function syncPackageEngagementSettingsUI(){byId("pkgCommentAudienceWrap")?.classList.toggle("hidden",!byId("pkgAllowComments")?.checked);}
async function savePackageEngagementSettings(id){if(!id||!vendor?.id)return;const {error}=await sb.from("package_engagement_settings").upsert({package_id:id,vendor_id:vendor.id,like_visibility:byId("pkgLikeVisibility")?.value||"everyone",allow_comments:!!byId("pkgAllowComments")?.checked,comment_audience:byId("pkgCommentAudience")?.value||"everyone"},{onConflict:"package_id"});if(error)throw error;}
async function savePackage() {
  const errorEl = byId("packageError");
  errorEl.classList.add("hidden");
  const btn = byId("savePackageBtn");
  if(btn.disabled)return;
  btn.disabled = true;
  btn.dataset.originalLabel = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;

  try {
    const name = byId("pkgName").value.trim();
    const price = byId("pkgPrice").value ? Number(byId("pkgPrice").value) : null;
    if (!name) throw new Error("Package name is required.");
    if (!price || price <= 0) throw new Error("Enter a package price.");

    const items = [...document.querySelectorAll(".pkg-item-check:checked")].map((cb) => {
      const productId = cb.id.replace("pkgCheck-", "");
      return { product_id: productId, quantity: parseInt(byId(`pkgQty-${productId}`).value) || 1 };
    });
    if (items.length === 0) throw new Error("Pick at least one product for this package.");

    const newFiles = [...(window.__newPackagePhotoFiles || byId("pkgPhotoFiles")?.files || [])];
    const newPhotoUrls = await Promise.all(newFiles.map(async (file) => {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `product-photos/${vendor.id}/packages/${crypto.randomUUID()}.${ext}`;
      let uploadBlob = file;
      try { if (typeof window.compressImage === "function") uploadBlob = await window.compressImage(file, { maxWidth: 1600, maxHeight: 1600 }); } catch (_) {}
      try { return await uploadToR2(uploadBlob, path, uploadBlob.type || file.type); }
      catch (upErr) { throw new Error(`Photo upload failed: ${upErr.message}`); }
    }));
    const photos = [...(window.__existingPackagePhotos || []), ...newPhotoUrls];
    const billing_model = byId("pkgBillingModel")?.value || "commission";
    const isNewPackage = !editingPackageId;
    const payload = { vendor_id: vendor.id, name, description: byId("pkgDesc").value.trim() || null, price, photos };
    if (isNewPackage) {
      payload.billing_model = billing_model;
      payload.billing_status = billing_model === "monthly" ? "pending_payment" : "active";
      if (billing_model === "monthly") payload.status = "paused";
    }
    if (isNewPackage && billing_model === "monthly") {
      window.__manualMonthlyNewDraft = {
        kind: "package", vendor_id: vendor.id,
        fields: { ...payload, status: "paused", billing_status: "pending_payment", billing_reference: null, billing_paid_until: null },
        items: items.map((it) => ({ ...it })), photos,
        engagement: {
          like_visibility: byId("pkgLikeVisibility")?.value || "everyone",
          allow_comments: !!byId("pkgAllowComments")?.checked,
          comment_audience: byId("pkgCommentAudience")?.value || "everyone"
        }
      };
      closePackageModal();
      await openManualMonthlyPayment("package", null, { isNew: true, draft: window.__manualMonthlyNewDraft });
      return;
    }

    let packageId = editingPackageId;
    let savedPackageRow = null;
    if (packageId) {
      const { data: updatedPackage, error } = await sb.from("vendor_packages").update(payload).eq("id", packageId).select("*").single();
      if (error) throw error;
      savedPackageRow = updatedPackage || null;
      const {error:removeError}=await sb.from("package_items").delete().eq("package_id", packageId);if(removeError)throw removeError;
    } else {
      const { data, error } = await sb.from("vendor_packages").insert(payload).select("*").single();
      if (error) throw error;
      packageId = data.id;
      savedPackageRow = data || null;
    }
    const savedDraftIdentity=editingPackageId||'new';editingPackageId=packageId;
    const {error:itemsError}=await sb.from('package_items').insert(items.map(it=>({...it,package_id:packageId})));
    if(itemsError)throw new Error(`Package saved, but its items could not be saved: ${itemsError.message}. Your draft is retained; retry Save.`);
    savePackageEngagementSettings(packageId).catch(err=>showToast(`Package saved; engagement settings need retry: ${err.message}`,'info'));
    window.__lastSavedPackageRow=savedPackageRow;window.clearListingDraft?.('package',savedDraftIdentity);invalidateMarketplaceState();
    closePackageModal({skipDraft:true});
    if(['vendorProducts','vendorPackages'].includes(currentView))await navigate(currentView,{},false);
    showToast('Package saved.','success');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalLabel || "Save package";
    delete btn.dataset.originalLabel;
  }
}

async function setPackageStatus(id, status) {
  const { error } = await sb.from("vendor_packages").update({ status }).eq("id", id).eq("vendor_id", vendor.id);
  if (error) { showToast(error.message, "error"); return; }
  invalidateMarketplaceState();
  navigate(currentView === "vendorProducts" ? "vendorProducts" : "vendorPackages", {}, false);
}
async function deletePackage(id) {
  if (!(await showConfirmDialog("Delete this package permanently? This can't be undone.", { title: "Delete package", okLabel: "Delete", danger: true }))) return;
  const { error } = await sb.from("vendor_packages").delete().eq("id", id).eq("vendor_id", vendor.id);
  if (error) { showToast(error.message, "error"); return; }
  invalidateMarketplaceState();
  navigate(currentView === "vendorProducts" ? "vendorProducts" : "vendorPackages", {}, false);
}

