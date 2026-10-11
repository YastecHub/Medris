// ---------- MY DETAILS (any logged-in buyer/vendor's own contact info) ----------
async function renderBuyerProfile() {
  if (!session || !profile || profile.role === "admin" || vendor) return '<div class="empty-state">Access denied.</div>';
  const [{ count: totalOrders }, { count: followingCount }] = await Promise.all([
    sb.from("orders").select("id", { count: "exact", head: true }).eq("buyer_id", session.user.id),
    levroData.follows.count(session.user.id),
  ]);
  const wishlistCount = (favoriteIds?.size || 0) + (packageFavoriteIds?.size || 0);
  const memberSince = profile.created_at ? new Date(profile.created_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "";

  // Customers have no public storefront, so no cover banner either.
  let html = `<div class="vendor-profile-header-card buyer-profile-card">
    <div class="vendor-profile-header-body">
      <div class="vendor-profile-header-avatar-row">
        ${profile.avatar_url ? `<img src="${esc(profile.avatar_url)}" class="avatar-circle vendor-profile-header-avatar" alt="${esc(profile.name || "Profile")}" draggable="false" />` : avatarFallbackHtml(profile.name || profile.email, "4.4rem", "vendor-profile-header-avatar", profile.name || profile.email)}
        <span class="buyer-profile-row-actions"><button type="button" class="btn btn-sm btn-outline vendor-profile-edit-btn" onclick="navigate('editProfile')" title="Edit my details" aria-label="Edit my details"><i class="fa-solid fa-pen"></i></button><button type="button" class="buyer-profile-settings-btn" onclick="navigate('settings')" aria-label="Settings" title="Settings">${window.LV_SETTINGS_SVG}</button></span>
      </div>
      <h2 class="vendor-profile-header-name">${esc(profile.name || "")}</h2>
      ${memberSince ? `<p class="vendor-profile-header-personal">Member since ${memberSince}</p>` : ""}
      ${profile.city ? `<p class="vendor-profile-header-location"><i class="fa-solid fa-location-dot"></i> ${esc(profile.city)}</p>` : ""}
    </div>
  </div>

  <div class="lv-group">
    <h3 class="lv-group-title">Activity</h3>
    ${lvLinkRow("fa-receipt", "My orders", Number(buyerPendingOrderCount || 0) > 0 ? `${buyerPendingOrderCount} pending` : `${totalOrders || 0}`, "navigate('buyerOrders')")}
    ${lvLinkRow("fa-heart", "Wishlist", `${wishlistCount} saved`, "navigate('wishlist')")}
    ${lvLinkRow("fa-store", "Vendors you follow", `${followingCount || 0}`, "navigate('customerFollowing')")}
  </div>
  <div class="lv-group">
    <h3 class="lv-group-title">Account</h3>
    ${lvLinkRow("fa-id-card", "My details", "", "navigate('editProfile')")}
    ${lvLinkRow("fa-location-dot", "Location", profile.city ? esc(profile.city) : "Add city", "navigate('editProfile')")}
  </div>
  <div class="lv-group">
    <h3 class="lv-group-title">More</h3>
    ${lvLinkRow("fa-bag-shopping", "Request an item", "", "navigate('requestEquipment')")}
    ${lvLinkRow("fa-compass", "Take a tour", "", "showTour()")}
    ${lvLinkRow("fa-headset", "Support", "", "navigate('supportRequest')")}
    ${lvLinkRow(window.LV_SETTINGS_SVG, "Settings &amp; Privacy", "", "navigate('settings')")}
  </div>`;

  return html;
}

function epAvatarInner() {
  return profile?.avatar_url
    ? `<img src="${esc(profile.avatar_url)}" class="avatar-circle ep-avatar-img" alt="${esc(profile.name || "Profile")}" draggable="false" />`
    : avatarFallbackHtml(profile?.name || profile?.email, "100%", "ep-avatar-img", profile?.name || profile?.email);
}
function epPhotoBlockHtml(big) {
  return `<div class="ep-photo${big ? " ep-photo-big" : ""}">
    <button type="button" class="ep-avatar-btn" onclick="openEpAvatarActions(event)" aria-label="Change profile picture"><span id="epAvatarBox" class="ep-avatar-box">${epAvatarInner()}</span><span class="ep-cam"><i class="fa-solid fa-camera"></i></span></button>
    <input type="file" id="epAvatarInput" accept="image/*" class="hidden" onchange="uploadAvatar(event)" />
    <button type="button" class="ep-link" onclick="openEpAvatarActions(event)">${profile?.avatar_url ? "Change photo" : "Add a photo"}</button>
  </div>`;
}
function epBannerBlockHtml() {
  const v = vendor;
  if (!v) return "";
  return `<div class="ep-banner">
    <label>Shop banner</label>
    <div class="storefront-cover ${v.cover_url ? "has-custom-cover" : ""}" style="height:130px;border-radius:14px;${v.cover_url ? `background-image:url('${esc(v.cover_url)}');background-size:cover;background-position:center;` : ""}">
      ${v.cover_url ? '<div class="storefront-cover-overlay"></div>' : '<div class="storefront-cover-empty">No banner yet</div>'}
      <button type="button" class="storefront-cover-edit" onclick="openVendorCoverActions(event)" title="Edit shop banner" aria-label="Edit shop banner"><i class="fa-solid fa-pen"></i></button>
      <input id="vendorCoverInput" type="file" accept="image/*" class="hidden" onchange="uploadVendorCover(event)" />
    </div>
  </div>`;
}
function openEpAvatarActions(event) {
  event?.stopPropagation?.();
  const has = !!profile?.avatar_url;
  openMediaActionSheet("Profile picture", [
    { label: "Edit", icon: "fa-crop-simple", note: has ? "Crop or reposition your current picture." : "Choose a picture first.", disabled: !has, action: "editCurrentAvatar();" },
    { label: has ? "Replace" : "Choose a photo", icon: "fa-camera", note: "Pick a picture and adjust it.", action: "closeMediaActionSheet();byId('epAvatarInput')?.click();" },
    { label: "Remove", icon: "fa-trash-can", note: "Remove your current picture.", danger: true, disabled: !has, action: "closeMediaActionSheet();removeProfileAvatar();" },
  ]);
}
window.lvAvatarChanged = function () {
  const box = byId("epAvatarBox");
  if (box) box.innerHTML = epAvatarInner();
  document.querySelectorAll(".ep-link").forEach((b) => { if (/photo/i.test(b.textContent)) b.textContent = profile?.avatar_url ? "Change photo" : "Add a photo"; });
};
function renderEditProfile() {
  if (!session || !profile) return '<div class="empty-state">Please log in.</div>';
  return `<div class="ep-page lv-flat">
  <h2 class="page-title"><i class="fa-solid fa-id-card"></i> My details ${infoPopoverHtml("editProfileInfo", "Keep this up to date. It's what fills in automatically at checkout, so a typo here won't follow you into every future order.")}</h2>
  ${epPhotoBlockHtml(false)}
  ${epBannerBlockHtml()}
  <div id="editProfileError" class="error-text hidden"></div>
  <label>Full name</label>
  <input type="text" id="epName" value="${esc(profile.name || "")}" />
  <label>Phone number *</label>
  <input type="tel" id="epPhone" value="${esc(profile.phone || "")}" required />
  <label>City</label>
  <input type="text" id="epCity" value="${esc(profile.city || "")}" />
  <label>Delivery address</label>
  <textarea id="epAddress" rows="2" placeholder="e.g. Elkanemi Hostel, Block A, Room A12">${esc(profile.address || "")}</textarea>
  <button class="btn" id="epSaveBtn" style="margin-top:1.1rem;width:100%;" onclick="submitEditProfile()"><i class="fa-solid fa-check"></i> Save changes</button>
  ${vendor ? `<div class="ep-section"><h3><i class="fa-solid fa-store"></i> Your shop</h3>
    <p class="muted">Business name, sector, opening hours, location and delivery settings.</p>
    <button class="btn btn-outline" style="width:100%;" onclick="navigate('vendorEditProfile')">Edit business profile</button></div>` : ""}
  ${!vendor && profile.role !== "admin" ? `<div class="ep-section"><h3><i class="fa-solid fa-store"></i> Want to sell on Levromart?</h3>
    <p class="muted">Open your own storefront and start listing products or services.</p>
    <button class="btn btn-outline" onclick="navigate('vendorApply')">Apply to become a vendor</button></div>` : ""}
  </div>`;
}
