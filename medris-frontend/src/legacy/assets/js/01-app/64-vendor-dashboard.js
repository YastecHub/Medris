// ---------- VENDOR DASHBOARD ----------
// One clear card for the vendor: how much is owed, how long is left, and a bar
// showing how much of the 7-day window has gone. Turns amber near the end and
// red once overdue. (The countdown text itself is filled in by the shared
// ".levro-commission-deadline" ticker.)
function commissionCardHtml(owed, overdue, dueAt, copy) {
  const WINDOW = 7 * 86400000;
  const left = dueAt ? new Date(dueAt).getTime() - Date.now() : null;
  const used = left == null ? 0 : Math.max(0, Math.min(100, Math.round(100 * (1 - left / WINDOW))));
  const urgency = overdue ? "overdue" : (left != null && left <= 3 * 86400000 ? "soon" : "ok");
  return `<div class="commission-card commission-${urgency}" style="max-width:480px;margin:1rem auto 0;">
    <div class="commission-card-top"><span class="commission-card-label"><i class="fa-solid fa-hand-holding-dollar"></i> Commission you owe</span><button type="button" class="vendor-commission-info" title="About commission" aria-label="About commission" onclick="levroCommissionInfo()"><i class="fa-solid fa-info"></i></button></div>
    <div class="commission-card-amount">${naira(owed)}</div>
    <div class="commission-card-clock"><i class="fa-regular fa-clock"></i><strong class="levro-commission-deadline">Calculating…</strong></div>
    <div class="commission-card-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${used}"><span style="width:${used}%"></span></div>
    <p class="commission-card-copy">${copy}</p>
    <div id="commissionError" class="error-text hidden"></div>
    <button class="btn btn-sm" id="payCommissionBtn" onclick="toggleCommissionBreakdown()" aria-expanded="false"><i class="fa-solid fa-receipt"></i> Review commission breakdown</button>
    <div id="commissionBreakdown" class="vendor-commission-breakdown hidden" aria-live="polite"></div>
  </div>`;
}

async function renderVendorDashboard() {
  if (!session || profile?.role === "admin" || (profile?.role !== "vendor" && !vendor)) return '<div class="empty-state">Access denied.</div>';
  const { data: v } = await sb.from("vendors").select("*").eq("user_id", session.user.id).is("deleted_at", null).maybeSingle();
  if (!v) { navigate("vendorApply"); return '<p class="muted">Redirecting…</p>'; }
  vendor = v;

  // Backfill a previously uploaded account photo to the public vendor avatar.
  // This repairs rows whose earlier update was skipped because the global
  // vendor object had not been hydrated when the photo was saved.
  if (profile?.avatar_url && v.logo_url !== profile.avatar_url) {
    const { error: avatarSyncError } = await sb.from("vendors")
      .update({ logo_url: profile.avatar_url })
      .eq("id", v.id).eq("user_id", session.user.id);
    if (!avatarSyncError) {
      v.logo_url = profile.avatar_url;
      vendor.logo_url = profile.avatar_url;
    } else {
      console.warn("Vendor dashboard avatar backfill failed:", avatarSyncError);
    }
  }

  let statusBanner = "";
  if (v.verification_status === "pending") statusBanner = `<div class="banner banner-warning"><strong><i class='fa-solid fa-hourglass-half'></i> Verification pending.</strong> Your shop is under review. Once approved you can list products.</div>`;
  else if (v.verification_status === "rejected") statusBanner = `<div class="banner banner-danger"><strong>Application not approved.</strong> Contact support if this seems wrong.</div>`;
  else if (!v.is_active) statusBanner = `<div class="banner banner-muted"><strong><i class='fa-solid fa-pause'></i> Storefront paused.</strong> Customers can't see your shop or products right now.</div>`;
  const verifiedTick = v.verification_status === "verified"
    ? `<span data-vt="${v.id}" class="verified-tick" title="Verified vendor" onclick="navigate('storefront',{vendorId:'${v.id}'})"><i class="fa-solid fa-circle-check"></i></span>`
    : "";

  const [{ data: orders }, { data: products }, { data: owed }, { data: commissionDeadline }, { data: followerCounts }] = await Promise.all([
    sb.from("orders").select("status, total_amount, created_at").eq("vendor_id", v.id),
    sb.from("products").select("id, view_count, is_service, status").eq("vendor_id", v.id),
    sb.rpc("get_vendor_commission_owed", { p_vendor_id: v.id }),
    sb.rpc("get_vendor_commission_deadline", { p_vendor_id: v.id }),
    sb.rpc("get_vendor_follower_counts", { p_vendor_ids: [v.id] }),
  ]);
  const totalOrders = orders?.length ?? 0;
  const revenue = orders?.filter((o) => o.status === "completed").reduce((s, o) => s + o.total_amount, 0) ?? 0;
  const totalViews = (products || []).reduce((s, p) => s + (p.view_count || 0), 0);
  const liveProducts = (products || []).filter((p) => p.status !== "removed");
  const hubProducts = liveProducts.filter((p) => !p.is_service).length;
  const hubServices = liveProducts.filter((p) => p.is_service).length;
  const hubDiscarded = (products || []).length - liveProducts.length;
  let hubPackages = 0;
  try { const { count } = await sb.from("vendor_packages").select("id", { count: "exact", head: true }).eq("vendor_id", v.id); hubPackages = count || 0; } catch (_) {}
  const { data: favCounts } = (products || []).length
    ? await sb.rpc("get_favorite_counts", { p_product_ids: products.map((p) => p.id) })
    : { data: [] };
  const totalFavorites = (favCounts || []).reduce((s, r) => s + r.count, 0);
  const totalListings = (products || []).filter((p) => p.status !== "removed").length;
  const totalFollowers = Number(followerCounts?.[0]?.follower_count || 0);
  const commissionOwed = Number(owed || 0);
  const earliestCommissionDueAt = commissionDeadline?.[0]?.earliest_due_at || null;
  const commissionIsOverdue = !!earliestCommissionDueAt && new Date(earliestCommissionDueAt).getTime() <= Date.now();

  const monthlyPending = Number(window.__monthlyPendingCount || 0);

  // ---------- 1. Profile header ----------
  let html = `<div class="vendor-profile-header-card">
    <div class="storefront-cover vendor-profile-header-cover ${v.cover_url ? "has-custom-cover" : "lv-gen-cover"}" ${v.cover_url ? `style="background-image:url('${esc(v.cover_url)}');"` : lvGenCoverAttrs(profile?.name || v.business_name || "Vendor", profile?.avatar_url || null)}>
      ${lvCoverActionsHtml("navigate('vendorEditProfile')", `lvOpenProfileShare('vendor','${v.id}')`)}
    </div>
    <div class="vendor-profile-header-body">
      <div class="vendor-profile-header-avatar-row">
        ${profile?.avatar_url ? `<img src="${esc(profile.avatar_url)}" class="avatar-circle vendor-profile-header-avatar" alt="${esc(profile.name || v.business_name || "Vendor")}" draggable="false" />` : avatarFallbackHtml(profile?.name || v.business_name || "Vendor", "4.4rem", "vendor-profile-header-avatar", profile?.name || v.business_name || "Vendor")}
      </div>
      <h2 class="vendor-profile-header-name">${esc(v.business_name)} ${verifiedTick}</h2>
      ${profile?.name ? `<p class="vendor-profile-header-personal">${esc(profile.name)}</p>` : ""}
      ${v.city ? `<p class="vendor-profile-header-location"><i class="fa-solid fa-location-dot"></i> ${esc(v.city)}</p>` : ""}
      ${v.bio ? `<p class="vendor-profile-header-bio">${esc(v.bio)}</p>` : ""}
      <div class="storefront-stats">
        <span><strong>${totalListings}</strong> listing${totalListings === 1 ? "" : "s"}</span>
        <button type="button" class="storefront-stat-link" onclick="navigate('storefront',{vendorId:'${v.id}'});setTimeout(()=>scrollToVendorReviews(),300);"><strong>${v.review_count || 0}</strong> review${Number(v.review_count || 0) === 1 ? "" : "s"}</button>
        <button type="button" class="storefront-stat-link" onclick="navigate('storefront',{vendorId:'${v.id}'});setTimeout(()=>scrollToVendorReviews(),300);"><strong>★ ${Number(v.avg_rating ?? 0).toFixed(1)}</strong> rating</button>
        <button type="button" class="storefront-stat-link" onclick="navigate('vendorFollowers')"><strong>${totalFollowers.toLocaleString()}</strong> follower${totalFollowers === 1 ? "" : "s"}</button>
      </div>
      <div class="lv-profile-actions lv-vendor-profile-actions">
        <button type="button" class="lv-profile-action active" aria-current="page" onclick="navigate('vendorDashboard')"><i class="fa-solid fa-user-gear"></i> My account</button>
        <button type="button" class="lv-profile-action" onclick="navigate('storefront',{vendorId:'${v.id}'})"><i class="fa-solid fa-arrow-up-right-from-square"></i> Public profile</button>
      </div>
    </div>
  </div>`;

  // ---------- 2. Analytics ----------
  html += `<hr class="vendor-profile-divider" />
  <div class="vendor-profile-section">
    <h3 class="lv-group-title">Statistics</h3>
    <div class="lv-stat-grid">
      ${lvStatTile("1f6d2", `${totalOrders}`, "Total orders", "navigate('vendorOrders')")}
      ${lvStatTile("1f48e", naira(revenue), "Revenue", "navigate('vendorEarnings')")}
      ${lvStatTile("1f4e6", `${totalListings}`, "Listings", "navigate('vendorProducts')")}
      ${lvStatTile("1f465", `${totalFollowers}`, "Followers", "navigate('vendorFollowers')")}
      ${lvStatTile("1f4c8", `${totalViews}`, "Product views", "")}
      ${lvStatTile("1f381", `${totalFavorites}`, "Wishlist saves", "")}
    </div>
    <div id="vendorRevenueChartArea" style="margin-top:0.6rem;"></div>
    <button type="button" class="vendor-profile-see-more" onclick="navigate('vendorEarnings')">See full earnings <i class="fa-solid fa-chevron-right"></i></button>
  </div>`;

  const recentCompleted = (orders || []).filter((o) => o.status === "completed");
  setTimeout(() => {
    const area = byId("vendorRevenueChartArea");
    // A racy auth check can cause this whole render to run twice for one
    // navigation (see the protectedRouteViews retry below), and each run
    // schedules its own timeout that finds the same, only-ever-one node by
    // id -- appending without clearing first left two charts stacked in it.
    if (area) { area.innerHTML = ""; area.appendChild(buildRevenueChart(recentCompleted, "all", { field: "total_amount", label: "Revenue per day (last 14 days)" })); }
  }, 0);

  // ---------- 3. Commission (only when owed) ----------
  // Commission is taken from each payout by Levromart: a shop never pays it by hand, so no "you owe" card is shown.
  if (false && commissionOwed > 0) {
    html += commissionCardHtml(commissionOwed, commissionIsOverdue, commissionDeadline?.[0]?.earliest_due_at, commissionIsOverdue ? "Your 7-day payment window has elapsed and your storefront is paused until this balance is settled." : "Pay anytime before the deadline. Your storefront stays active until then, and we will remind you 5, 3, 2 and 1 days before.");
  }
  html += statusBanner;
  if (v.verification_status === "verified" && (v.lat == null || v.lng == null)) {
    html += `<div class="banner banner-warning" style="max-width:700px;margin:1rem auto 0;"><strong><i class="fa-solid fa-location-dot"></i> Add your shop location</strong><p style="margin:.35rem 0 .65rem;">Your storefront cannot appear on the vendor map until a shop location is saved.</p><button class="btn btn-sm" onclick="navigate('vendorEditProfile')"><i class="fa-solid fa-map-location-dot"></i> Set shop location</button></div>`;
  }

  // ---------- 4. Seller hub: listings overview, management tools, more options ----------
  const hubRow = (icon, title, sub, value, onclick) => `<button type="button" class="vh-row" onclick="${onclick}"><span class="vh-row-ico">${String(icon).charAt(0) === "<" ? icon : `<i class="fa-solid ${icon}" aria-hidden="true"></i>`}</span><span class="vh-row-copy"><strong>${title}</strong>${sub ? `<small>${sub}</small>` : ""}</span>${value ? `<span class="vh-row-val">${value}</span>` : ""}<i class="fa-solid fa-chevron-right vh-chev" aria-hidden="true"></i></button>`;
  const goTab = (tab) => `try{localStorage.setItem('levromart-vendor-listing-tab','${tab}')}catch(_){};navigate('vendorProducts')`;
  const hubStat = (icon, n, label, tab) => `<button type="button" class="vh-stat" onclick="${goTab(tab)}"><span class="vh-stat-ico"><i class="fa-solid ${icon}" aria-hidden="true"></i></span><span><b>${n}</b><small>${label}</small></span><i class="fa-solid fa-chevron-right vh-chev" aria-hidden="true"></i></button>`;
  html += `<hr class="vendor-profile-divider" />
  <div class="vh-hub">
    <span class="vl-eyebrow"><i class="fa-solid fa-store"></i> Seller dashboard</span>
    <h2 class="vh-title">My Listings</h2>
    <p class="vh-sub">Manage your products, services and packages in one place.</p>
    <button type="button" class="vl-add vl-add-wide" onclick="openAddProductModal()"><i class="fa-solid fa-plus"></i> Add New Listing</button>
    <div class="vh-stats">${hubStat("fa-box", hubProducts, "Products", "products")}${hubStat("fa-hand-holding-heart", hubServices, "Services", "services")}${hubStat("fa-box-open", hubPackages, "Packages", "packages")}</div>
    <div class="vh-section-head"><h3><i class="fa-solid fa-layer-group"></i> My listings</h3><button type="button" onclick="${goTab("all")}">Manage all <i class="fa-solid fa-chevron-right"></i></button></div>
    <div class="vh-tabs" role="tablist">
      <button type="button" role="tab" onclick="${goTab("products")}"><i class="fa-solid fa-box"></i> Products <em>${hubProducts}</em></button>
      <button type="button" role="tab" onclick="${goTab("services")}"><i class="fa-solid fa-hand-holding-heart"></i> Services <em>${hubServices}</em></button>
      <button type="button" role="tab" onclick="${goTab("packages")}"><i class="fa-solid fa-box-open"></i> Packages <em>${hubPackages}</em></button>
    </div>
    <div class="vl-discarded"><span class="vl-discarded-ico"><i class="fa-solid fa-trash-can"></i></span><div><strong>Discarded items${hubDiscarded ? ` (${hubDiscarded})` : ""}</strong><p>Products removed from your live catalogue stay here when order history prevents permanent deletion.</p></div><button type="button" onclick="navigate('vendorProducts').then(()=>setTimeout(()=>toggleVendorDiscarded(null,true),250))" aria-label="View discarded items">View <i class="fa-solid fa-chevron-right"></i></button></div>
    <h3 class="vh-group">Management tools</h3>
    <div class="vh-list">
      ${hubRow("fa-list-check", "Manage listings", "View, edit or delete your products, services and packages.", "", goTab("all"))}
      ${hubRow("fa-calendar-days", "Monthly listing", "Track your listing activity and performance.", monthlyPending > 0 ? `${monthlyPending} pending` : "Up to date", "navigate('vendorProducts')")}
    </div>
    <h3 class="vh-group">Reviews &amp; ratings</h3>
    ${lvRatingCardHtml(v)}
    <h3 class="vh-group">Working hours</h3>
    ${lvHoursCardHtml(v)}
    <h3 class="vh-group">More options</h3>
    <div class="vh-list">
      ${hubRow("fa-comments", "Requests", "View and respond to customer requests.", "", "navigate('vendorRequests')")}
      ${hubRow("fa-lightbulb", "Suggestions", "Tips to grow your business on Levromart.", unreadSuggestionCount > 0 ? `<span class="vh-badge">${unreadSuggestionCount > 9 ? "9+" : unreadSuggestionCount}</span>` : "", "navigate('vendorSuggestionsInbox')")}
      ${hubRow("fa-headset", "Support", "Get help or contact our support team.", "", "navigate('supportRequest')")}
    </div>
    <div class="vh-list vh-list-single">${hubRow(window.LV_SETTINGS_SVG, "Settings &amp; Privacy", "Manage your account, notifications and privacy.", "", "navigate('settings')")}</div>
  </div>`;

  return html;
}

// A statistic tile: a 3D icon (the same family as the category icons), the value large, the label small; a button when it leads somewhere.
function lvStatTile(icon3d, value, label, onclick) {
  const inner = `<span class="lv-stat-ico">${typeof lv3d === "function" ? lv3d(icon3d) : ""}</span><strong class="lv-stat-val">${value}</strong><small class="lv-stat-label">${label}</small>`;
  return onclick ? `<button type="button" class="lv-stat" onclick="${onclick}">${inner}</button>` : `<div class="lv-stat">${inner}</div>`;
}
// The shop's average rating, its stars and the number of reviews; opens the reviews on the public profile.
function lvRatingCardHtml(v) {
  const avg = Number(v.avg_rating || 0), count = Number(v.review_count || 0);
  const stars = [1, 2, 3, 4, 5].map((i) => `<i class="fa-${avg >= i - 0.25 ? "solid fa-star" : avg >= i - 0.75 ? "solid fa-star-half-stroke" : "regular fa-star"}" aria-hidden="true"></i>`).join("");
  return `<button type="button" class="lv-rating-card" onclick="navigate('storefront',{vendorId:'${v.id}'});setTimeout(()=>scrollToVendorReviews(),300)" aria-label="Rating ${avg.toFixed(1)} out of 5 from ${count} reviews">
    <span class="lv-rating-avg">${avg.toFixed(1)}</span>
    <span class="lv-rating-copy"><span class="lv-rating-stars">${stars}</span><small>${count ? `${count} review${count === 1 ? "" : "s"}` : "No reviews yet"}</small></span>
    <span class="lv-rating-go">See reviews <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></span>
  </button>`;
}
// Working hours day by day (today marked), from the structured hours; the old text summary when that is all there is.
function lvHoursCardHtml(v) {
  const hours = v.business_hours && typeof v.business_hours === "object" ? v.business_hours : null;
  const today = typeof nowInLagos === "function" ? nowInLagos().dayKey : "";
  const rows = hours
    ? HOURS_DAYS.map(({ key, label }) => { const d = hours[key]; const open = d && !d.closed; return `<li class="${key === today ? "is-today" : ""}${open ? "" : " is-closed"}"><span>${label}${key === today ? " <em>Today</em>" : ""}</span><b>${open ? `${formatTime12(d.open)} – ${formatTime12(d.close)}` : "Closed"}</b></li>`; }).join("")
    : `<li><span>${v.opening_hours ? esc(v.opening_hours) : "Not set yet"}</span></li>`;
  return `<div class="lv-hours-card"><ul>${rows}</ul><button type="button" class="lv-hours-edit" onclick="navigate('vendorEditProfile')"><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit hours</button></div>`;
}

async function toggleVendorActive(currentlyActive) {
  if (!vendor?.id) return;
  if (!currentlyActive) {
    const { data: deadline, error: deadlineError } = await sb.rpc("get_vendor_commission_deadline", { p_vendor_id: vendor.id });
    if (deadlineError) { showToast(deadlineError.message, "error"); return; }
    const dueAt = deadline?.[0]?.earliest_due_at;
    if (dueAt && vendor.commission_pause_reason !== 'admin_override' && new Date(dueAt).getTime() <= Date.now()) {
      const { data: owed, error: owedError } = await sb.rpc("get_vendor_commission_owed", { p_vendor_id: vendor.id });
      if (owedError) { showToast(owedError.message, "error"); return; }
      // Same ₦100 floor as the rest of the commission-pause logic -- Paystack
      // won't transfer under that anyway.
      if (Number(owed || 0) >= 100) {
        vendor.is_active = false; vendor.commission_paused = true; vendor.commission_pause_reason = "commission_overdue";
        showCommissionPaywall(Number(owed || 0));
        return;
      }
    }
  }
  const { error } = await sb.rpc("vendor_set_storefront_active", { p_active: !currentlyActive });
  if (error) { showToast(error.message, "error"); return; }
  vendor.is_active = !currentlyActive;
  if (!currentlyActive) { vendor.commission_paused = false; vendor.commission_pause_reason = null; }
  navigate("vendorDashboard");
}


// ---------- PROFILE SHARE: a QR card for each storefront ----------
// The shop's own link as a QR code, coloured from the shop's picture, the shop's picture in the middle of the code,
// a few of its products and the Levromart logo. Share the link, copy it, or save the card as a picture.
// A customer (no storefront) shares an invitation to Levromart the same way.
const LV_SHARE_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>`;
const LV_EDIT_PROFILE_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 15H7a4 4 0 0 0-4 4v2"/><path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/><circle cx="10" cy="7" r="4"/></svg>`;
// Edit and Share, at the top right of the profile banner.
function lvCoverActionsHtml(editAction, shareAction) {
  return `<div class="lv-cover-actions"><button type="button" class="lv-cover-btn" onclick="${editAction}" title="Edit profile" aria-label="Edit profile">${LV_EDIT_PROFILE_ICON}</button><button type="button" class="lv-cover-btn" onclick="${shareAction}" title="Share profile" aria-label="Share profile">${LV_SHARE_ICON}</button></div>`;
}
function lvLoadQrLib() {
  if (window.qrcode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/lib/qrcode-generator-1.4.4.js";
    s.onload = () => (window.qrcode ? resolve() : reject(new Error("QR code could not load")));
    s.onerror = () => reject(new Error("QR code could not load. Check your connection."));
    document.head.appendChild(s);
  });
}
// Loads a picture the canvas may read: directly, or through the app's image proxy when the direct read is blocked.
async function lvLoadReadableImage(src) {
  if (!src) return null;
  try {
    const blob = typeof window.lvLoadImageBlob === "function" ? await window.lvLoadImageBlob(src) : null;
    if (blob) return await lvLoadImage(URL.createObjectURL(blob));
  } catch (_) {}
  return lvLoadImage(src);
}
function lvLoadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
// A sharper copy of a Google account photo (they arrive at 96px).
function lvSharpPic(url) { return url ? String(url).replace(/=s\d+-c$/, "=s400-c") : url; }
// Draws the QR code: rounded dots and rounded corner eyes in a diagonal gradient, a white circle left in the middle for the
// picture (shown on top as a normal image so any picture works), or the initials when there is no picture.
function lvDrawQr(canvas, text, colours, initials, centreImg) {
  const qr = window.qrcode(0, "H"); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), size = canvas.width, pad = Math.round(size * 0.06), cell = (size - pad * 2) / n;
  const x = canvas.getContext("2d");
  x.clearRect(0, 0, size, size); x.fillStyle = "#fff"; x.fillRect(0, 0, size, size);
  const grad = x.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, colours[0]); grad.addColorStop(0.55, colours[1]); grad.addColorStop(1, colours[2]);
  const hole = Math.ceil(n * 0.26) | 1, h0 = Math.floor((n - hole) / 2);
  const inEye = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  x.fillStyle = grad;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!qr.isDark(r, c) || inEye(r, c) || (r >= h0 && r < h0 + hole && c >= h0 && c < h0 + hole)) continue;
    x.beginPath(); x.arc(pad + (c + 0.5) * cell, pad + (r + 0.5) * cell, cell * 0.42, 0, Math.PI * 2); x.fill();
  }
  const rr = (X, Y, W, R) => { x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + W, R); x.arcTo(X + W, Y + W, X, Y + W, R); x.arcTo(X, Y + W, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath(); };
  [[0, 0], [0, n - 7], [n - 7, 0]].forEach(([r, c]) => {
    const X = pad + c * cell, Y = pad + r * cell;
    rr(X, Y, cell * 7, cell * 2.2); x.fillStyle = grad; x.fill();
    rr(X + cell, Y + cell, cell * 5, cell * 1.6); x.fillStyle = "#fff"; x.fill();
    rr(X + cell * 2, Y + cell * 2, cell * 3, cell * 1.1); x.fillStyle = grad; x.fill();
  });
  const cx = size / 2, rad = (hole * cell) / 2 - cell * 0.4;
  x.beginPath(); x.arc(cx, cx, rad + cell * 0.5, 0, Math.PI * 2); x.fillStyle = "#fff"; x.fill();
  x.save(); x.beginPath(); x.arc(cx, cx, rad, 0, Math.PI * 2); x.clip();
  if (centreImg) { const sq = Math.min(centreImg.width, centreImg.height); x.drawImage(centreImg, (centreImg.width - sq) / 2, (centreImg.height - sq) / 2, sq, sq, cx - rad, cx - rad, rad * 2, rad * 2); }
  else if (initials) { x.fillStyle = grad; x.fillRect(cx - rad, cx - rad, rad * 2, rad * 2); x.fillStyle = "#fff"; x.font = `800 ${Math.round(rad * 0.8)}px system-ui,sans-serif`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(initials, cx, cx + 1); }
  x.restore();
  return rad / size;   // the picture's radius as a share of the code's width
}
// The small map picture at the top of a "find it on the map" share card
const LV_MAPQR_BANNER = '<svg class="lvqr-mapart" viewBox="0 0 300 92" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="300" height="92" fill="#e7f1ec"/><ellipse cx="248" cy="82" rx="62" ry="24" fill="#cfe7f5"/><g stroke="#fff" stroke-linecap="round" fill="none"><path d="M0 62 L300 30" stroke-width="9"/><path d="M96 0 L128 92" stroke-width="7"/><path d="M200 0 L176 92" stroke-width="6"/><path d="M0 18 L210 70" stroke-width="5"/></g><path d="M150 14c-11 0-19 8-19 18 0 14 19 34 19 34s19-20 19-34c0-10-8-18-19-18Z" fill="var(--g2,#7c3aed)"/><circle cx="150" cy="32" r="7" fill="#fff"/></svg>';
async function lvOpenProfileShare(kind, targetId) {
  document.getElementById("lvqrSheet")?.remove();
  const isProduct = kind === "product" && targetId;
  const isMap = kind === "map" && targetId;      // a link and code that open the Vendors map on this shop
  const isShop = (kind === "vendor" || isMap) && targetId;
  let name = "", link = "", pic = null, cover = null, products = [], priceText = "", byName = "", shopId = isShop ? targetId : null;
  if (isProduct) {
    const { data: pr } = await sb.from("products").select("id,name,photos,sale_price,discount_price,rental_rate,rental_rate_unit,is_service,listing_type,service_price_unit,vendor:vendors!inner(id,user_id,business_name,logo_url)").eq("id", targetId).maybeSingle();
    if (!pr) return showToast("This product could not be found.", "error");
    name = pr.name || "Product"; link = productPublicUrl(pr.id); cover = (Array.isArray(pr.photos) && pr.photos[0]) || null;
    byName = pr.vendor?.business_name || "";
    try { const [v2] = await lvAttachOwnerAvatars([pr.vendor]); pic = lvVendorPic(v2); } catch (_) { pic = pr.vendor?.logo_url || null; }
    try { priceText = pr.is_service ? `${naira(effectivePrice(pr))}${servicePriceSuffix(pr)}` : pr.sale_price != null ? naira(effectivePrice(pr)) : pr.rental_rate != null ? `${naira(pr.rental_rate)}/${pr.rental_rate_unit}` : ""; } catch (_) {}
    shopId = pr.vendor?.id;
  } else if (isShop) {
    const v = typeof vendor !== "undefined" && vendor && String(vendor.id) === String(targetId) ? vendor : (await sb.from("vendors").select("id,user_id,business_name,logo_url,cover_url").eq("id", targetId).maybeSingle()).data;
    if (!v) return showToast("This shop could not be found.", "error");
    name = v.business_name || "My shop"; link = isMap ? `${location.origin}/?mapv=${encodeURIComponent(String(v.id))}` : storefrontPublicUrl(v.id); cover = v.cover_url || null;
    pic = lvVendorPic(v) || (typeof vendor !== "undefined" && vendor && String(vendor.id) === String(targetId) ? profile?.avatar_url : null);
    if (!pic && v.user_id) { try { const [v2] = await lvAttachOwnerAvatars([v]); pic = lvVendorPic(v2); } catch (_) {} }
    if (!isMap) try { const { data } = await sb.from("products").select("photos").eq("vendor_id", v.id).eq("status", "active").order("created_at", { ascending: false }).limit(9); products = (data || []).map((p) => (Array.isArray(p.photos) ? p.photos[0] : null)).filter(Boolean); products = products.sort(() => Math.random() - 0.5).slice(0, 3); } catch (_) {}   // three of the shop's products
  } else {
    name = profile?.name || "Levromart"; link = location.origin + "/"; pic = profile?.avatar_url || null;
  }
  pic = lvSharpPic(pic);
  const initials = String(isProduct ? byName : name).trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "L";
  const storeKey = "lv-qr-gradient:" + (isProduct ? "p:" + targetId : isMap ? "m:" + targetId : isShop ? targetId : "me");
  let gi = null;
  try { const saved = localStorage.getItem(storeKey); if (saved !== null && LV_GRADIENTS[+saved]) gi = +saved; } catch (_) {}
  const m = document.createElement("div");
  m.id = "lvqrSheet"; m.className = "lvqr-wrap";
  const hint = isProduct ? "Scan to see this product on Levromart" : isMap ? "Scan to find this shop on the map on Levromart" : isShop ? "Scan to visit my shop on Levromart" : "Scan to join me on Levromart";
  m.innerHTML = `<div class="lvqr-sheet" role="dialog" aria-modal="true" aria-label="Share ${esc(name)}">
    <button type="button" class="lvqr-close" aria-label="Close" onclick="document.getElementById('lvqrSheet')?.remove()"><i class="fa-solid fa-xmark"></i></button>
    <div class="lvqr-card${isProduct ? " is-product" : ""}${isMap ? " is-map" : ""}">
      <div class="lvqr-cover"${cover && !isMap ? ` style="background-image:url('${esc(cover)}')"` : ""}>${isMap ? LV_MAPQR_BANNER : ""}</div>
      <div class="lvqr-body">
        ${isMap ? '<span class="lvqr-mapbadge"><i class="fa-solid fa-location-dot"></i> Find me on the map</span>' : ""}<h3>${esc(name)}</h3>
        ${isProduct ? `${priceText ? `<p class="lvqr-price">${esc(priceText)}</p>` : ""}<p class="lvqr-by">${pic ? `<img src="${esc(pic)}" alt="" onerror="this.remove()">` : ""}<span>Sold by <b>${esc(byName)}</b></span></p>` : `<p class="lvqr-link">${esc(link.replace(/^https?:\/\//, ""))}</p>`}
        <div class="lvqr-code"><canvas width="640" height="640" aria-label="QR code for ${esc(name)}"></canvas>${pic ? `<img class="lvqr-pic" src="${esc(pic)}" alt="">` : ""}</div>
        ${products.length ? `<div class="lvqr-products">${products.map((src) => `<img src="${esc(typeof lvThumb === "function" ? lvThumb(src, 160) : src)}" alt="" loading="lazy">`).join("")}</div>` : ""}
        <p class="lvqr-hint">${hint}</p>
        <div class="lvqr-brand"><img src="/icon-192.png" alt="" width="22" height="22"> Levromart</div>
      </div>
    </div>
    <div class="lvqr-swatches" role="radiogroup" aria-label="QR colours">${LV_GRADIENTS.slice(0, 9).map((g, i) => `<button type="button" role="radio" class="lvqr-sw" data-i="${i}" aria-label="Colour ${i + 1}" style="${lvGradientVars(g)}"></button>`).join("")}</div>
    <div class="lvqr-actions">
      <button type="button" class="lvqr-act" data-act="share"><i class="fa-solid fa-arrow-up-from-bracket"></i><span>Share</span></button>
      <button type="button" class="lvqr-act" data-act="copy"><i class="fa-regular fa-copy"></i><span>Copy link</span></button>
      <button type="button" class="lvqr-act" data-act="save"><i class="fa-solid fa-download"></i><span>Save QR</span></button>
    </div>
  </div>`;
  m.addEventListener("click", (e) => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
  const canvas = m.querySelector("canvas"), card = m.querySelector(".lvqr-card");
  let picEl = m.querySelector(".lvqr-code .lvqr-pic");
  let colours = LV_GRADIENTS[0].c;
  // a picture that cannot be shown leaves no hole: the initials are drawn in its place
  if (picEl) picEl.addEventListener("error", () => { picEl.remove(); picEl = null; pic = null; if (gi !== null) paint(gi); });
  const paint = (i) => {
    gi = i; colours = LV_GRADIENTS[i].c;
    card.setAttribute("style", lvGradientVars(LV_GRADIENTS[i]));
    m.querySelectorAll(".lvqr-sw").forEach((b) => b.setAttribute("aria-checked", String(+b.dataset.i === i)));
    try { const r = lvDrawQr(canvas, link, colours, pic ? "" : initials, null); if (picEl) { const pct = (r * 200).toFixed(2) + "%"; picEl.style.width = picEl.style.height = pct; } } catch (_) {}
  };
  try {
    await lvLoadQrLib();
    if (gi === null) {
      // the same gradient as this shop's banner on its storefront (matched to its picture when it can be read)
      const img = cover && isShop ? null : await lvLoadReadableImage(pic);
      const hue = img ? lvImageHue(img) : null;
      gi = LV_GRADIENTS.indexOf(lvGradientFor(isProduct ? shopId : isShop ? targetId : (profile?.name || profile?.email), hue));
    }
    paint(gi);
  } catch (err) { m.querySelector(".lvqr-code").innerHTML = `<p class="muted">${esc(err.message || "QR code unavailable")}</p>`; }
  m.querySelector(".lvqr-swatches").addEventListener("click", (e) => {
    const b = e.target.closest(".lvqr-sw"); if (!b) return;
    paint(+b.dataset.i);
    try { localStorage.setItem(storeKey, String(gi)); } catch (_) {}
  });
  const text = isProduct ? `${name} on Levromart` : isMap ? `Find ${name} on the Levromart map` : isShop ? `Shop ${name} on Levromart` : "Join me on Levromart";
  const rrect = (x, X, Y, W, H, R) => { x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R); x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath(); };
  const cover2 = (x, img, X, Y, W, H, R) => { x.save(); rrect(x, X, Y, W, H, R); x.clip(); const sc = Math.max(W / img.width, H / img.height); const w = img.width * sc, h = img.height * sc; x.drawImage(img, X + (W - w) / 2, Y + (H - h) / 2, w, h); x.restore(); };
  // The card as one picture: gradient, the shop's three products (or the product, its price and its seller), the code and the logo.
  const buildCard = async (withPic) => {
    const qrC = document.createElement("canvas"); qrC.width = qrC.height = 640;
    const img = withPic && pic ? await lvLoadReadableImage(pic) : null;
    lvDrawQr(qrC, link, colours, img ? "" : initials, img);
    const prodImgs = isProduct ? [] : (await Promise.all(products.map((u) => lvLoadReadableImage(typeof lvThumb === "function" ? lvThumb(u, 300) : u)))).filter(Boolean);
    const heroImg = isProduct && cover ? await lvLoadReadableImage(typeof lvThumb === "function" ? lvThumb(cover, 900) : cover) : null;
    const out = document.createElement("canvas"); out.width = 1080; out.height = isProduct ? 1520 : isMap ? 1580 : prodImgs.length ? 1500 : 1360;
    const x = out.getContext("2d");
    const bg = x.createLinearGradient(0, 0, 1080, out.height); bg.addColorStop(0, colours[0]); bg.addColorStop(0.55, colours[1]); bg.addColorStop(1, colours[2]);
    x.fillStyle = bg; x.fillRect(0, 0, 1080, out.height);
    const mt = isProduct ? 60 : 130;
    x.fillStyle = "#fff"; rrect(x, 90, mt, 900, out.height - 2 * mt, 56); x.fill();
    x.textAlign = "center";
    let y = 130;
    if (isProduct) {
      if (heroImg) {
        // the whole product is shown (not cropped): the photo, blurred and faded, fills the box and the sharp photo sits inside it
        cover2(x, heroImg, 120, 90, 840, 520, 40);
        x.save(); rrect(x, 120, 90, 840, 520, 40); x.clip(); x.fillStyle = "rgba(255,255,255,0.62)"; x.fillRect(120, 90, 840, 520);
        const sc = Math.min(820 / heroImg.width, 500 / heroImg.height), hw = heroImg.width * sc, hh = heroImg.height * sc;
        x.drawImage(heroImg, 120 + (840 - hw) / 2, 90 + (520 - hh) / 2, hw, hh); x.restore();
      }
      y = 90 + 520;
      x.fillStyle = "#14201a"; x.font = "800 56px system-ui,sans-serif"; x.fillText(String(name).slice(0, 30), 540, y + 80);
      if (priceText) { x.fillStyle = colours[1]; x.font = "800 64px system-ui,sans-serif"; x.fillText(priceText, 540, y + 152); }
      x.fillStyle = "#5b6b63"; x.font = "600 34px system-ui,sans-serif";
      const sold = "Sold by " + String(byName).slice(0, 26);
      const tw = x.measureText(sold).width, avatarImg = img;
      if (avatarImg) { const cx = 540 - (tw + 72) / 2 + 28; x.save(); x.beginPath(); x.arc(cx, y + 205, 28, 0, Math.PI * 2); x.clip(); const sq = Math.min(avatarImg.width, avatarImg.height); x.drawImage(avatarImg, (avatarImg.width - sq) / 2, (avatarImg.height - sq) / 2, sq, sq, cx - 28, y + 177, 56, 56); x.restore(); x.textAlign = "left"; x.fillText(sold, cx + 44, y + 217); x.textAlign = "center"; } else x.fillText(sold, 540, y + 217);
      x.drawImage(qrC, 330, y + 245, 420, 420); y = y + 245 + 420;
    } else {
      const mo = isMap ? 230 : 0;
      if (isMap) {
        // a little map with a pin on top, so this card is clearly the "find it on the map" one
        x.save(); rrect(x, 120, 160, 840, 200, 40); x.clip();
        x.fillStyle = "#e7f1ec"; x.fillRect(120, 160, 840, 200);
        x.fillStyle = "#cfe7f5"; x.beginPath(); x.ellipse(820, 330, 190, 70, -0.2, 0, Math.PI * 2); x.fill();
        x.strokeStyle = "#ffffff"; x.lineCap = "round";
        [[0, 250, 840, 200, 26], [300, 160, 360, 360, 22], [560, 160, 500, 360, 18], [120, 190, 600, 330, 14]].forEach(([x1, y1, x2, y2, w]) => { x.lineWidth = w; x.beginPath(); x.moveTo(x1 + (x1 < 120 ? 120 : 0), y1); x.lineTo(x2 + (x2 < 120 ? 120 : 0), y2); x.stroke(); });
        x.restore();
        x.fillStyle = colours[1]; x.beginPath(); x.arc(540, 232, 52, Math.PI * 0.85, Math.PI * 2.15); x.lineTo(540, 330); x.closePath(); x.fill();
        x.fillStyle = "#fff"; x.beginPath(); x.arc(540, 232, 20, 0, Math.PI * 2); x.fill();
      }
      x.fillStyle = "#14201a"; x.font = "800 58px system-ui,sans-serif"; x.fillText(String(name).slice(0, 28), 540, 240 + mo);
      x.fillStyle = "#5b6b63"; x.font = "500 32px system-ui,sans-serif"; x.fillText(isMap ? "Find me on the map" : link.replace(/^https?:\/\//, "").slice(0, 44), 540, 295 + mo);
      x.drawImage(qrC, 240, 340 + mo, 600, 600); y = 940 + mo;
      if (prodImgs.length) {
        const sz = 150, gap = 26, total = prodImgs.length * sz + (prodImgs.length - 1) * gap; let px = 540 - total / 2;
        prodImgs.forEach((im) => { cover2(x, im, px, y + 30, sz, sz, 28); px += sz + gap; }); y += 30 + sz;
      }
    }
    x.fillStyle = "#5b6b63"; x.font = "600 34px system-ui,sans-serif"; x.fillText(hint.replace("Scan to ", "Scan to ").replace(" on Levromart", ""), 540, y + 70);
    const logo = await lvLoadImage("/icon-192.png"); if (logo) x.drawImage(logo, 395, y + 105, 56, 56);
    x.fillStyle = "#0f9d6b"; x.font = "800 40px system-ui,sans-serif"; x.textAlign = "left"; x.fillText("Levromart", 465, y + 147);
    return new Promise((r, j) => { try { out.toBlob((bl) => (bl ? r(bl) : j(new Error("empty"))), "image/png"); } catch (err) { j(err); } });
  };
  m.querySelector(".lvqr-actions").addEventListener("click", async (e) => {
    const b = e.target.closest(".lvqr-act"); if (!b) return;
    const act = b.dataset.act;
    if (act === "share") {
      if (navigator.share) {
        // the QR card picture and the link go out together (WhatsApp, Telegram...); just the link where pictures cannot be shared
        let files = null;
        try { const blob = await buildCard(true).catch(() => buildCard(false)); const f = new File([blob], "levromart-qr.png", { type: "image/png" }); if (navigator.canShare && navigator.canShare({ files: [f] })) files = [f]; } catch (_) {}
        try { await navigator.share(files ? { files, title: name, text: `${text}: ${link}` } : { title: name, text, url: link }); } catch (_) {}
        return;
      }
    }
    if (act === "copy" || (act === "share" && !navigator.share)) { try { await navigator.clipboard.writeText(link); showToast("Link copied.", "success"); } catch (_) { showToast(link, "info"); } return; }
    if (act === "save") {
      try {
        let blob; try { blob = await buildCard(true); } catch (_) { blob = await buildCard(false); }   // a picture the browser may not copy: initials instead
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${String(name).replace(/[^\w-]+/g, "-").toLowerCase()}-levromart-qr.png`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        showToast("QR saved.", "success");
      } catch (_) { showToast("Could not save the picture. Take a screenshot instead.", "info"); }
    }
  });
}
