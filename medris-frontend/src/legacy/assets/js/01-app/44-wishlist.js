// ---------- WISHLIST ----------
async function renderWishlist() {
  if (!session) return '<div class="empty-state">Log in to save items to your wishlist.</div>';
  const [{ data: favs }, { data: packageFavs }] = await Promise.all([
    sb.from("favorites").select("product:products(id, name, listing_type, sale_price, rental_rate, rental_rate_unit, photos, quantity_available, condition, is_service, service_price_unit, status, vendor:vendors(id, business_name, verification_status, is_active, logo_url))").eq("buyer_id", session.user.id).order("created_at", { ascending: false }),
    sb.from("package_favorites").select("package:vendor_packages(id, vendor_id, name, description, price, photos, created_at, status, vendor:vendors!inner(id,business_name,logo_url,delivery_fee,verification_status,is_active), items:package_items(quantity, product:products(id,name,photos))").eq("buyer_id", session.user.id).order("created_at", { ascending: false })
  ]);
  const products = (favs || []).map((f) => f.product).filter((p) => p && p.status === "active" && p.vendor?.verification_status === "verified" && p.vendor?.is_active);
  const packages = (packageFavs || []).map((f) => f.package).filter((p) => p && p.status === "active" && p.vendor?.verification_status === "verified" && p.vendor?.is_active);
  let html = `<h2><i class='fa-solid fa-heart'></i> Your Wishlist</h2>`;
  if (products.length) html += `<h3 class="section-title"><i class="fa-solid fa-box"></i> Products</h3><div class="grid">${products.map((p) => productCardHtml({ ...p, _cardContext: "wishlist" })).join("")}</div>`;
  if (packages.length) html += `<h3 class="section-title"><i class="fa-solid fa-boxes-stacked"></i> Packages</h3><div class="grid">${packages.map((p) => packageCardHtml(p, p.vendor?.delivery_fee)).join("")}</div>`;
  if (!products.length && !packages.length) html += `<div class="empty-state">Nothing saved yet. Tap the <i class='fa-regular fa-heart'></i> on a product or package to save it here.</div>`;
  return html;
}

async function renderCustomerFollowing(){
  if(!session?.user?.id || profile?.role==='admin') return '<div class="empty-state">This page is available for customer accounts.</div>';
  try{
    const {data,error}=await sb.from('vendor_follows').select('vendor:vendors!inner(id,business_name,logo_url,cover_image_url,bio,city,avg_rating,review_count,verification_status,is_active,sector_id)').eq('follower_id',session.user.id).order('created_at',{ascending:false});
    if(error) throw error;
    const rows=(data||[]).map(r=>r.vendor).filter(v=>v && v.verification_status==='verified' && v.is_active);
    let html=`<div class="customer-following-page"><div class="customer-following-head"><button type="button" class="icon-btn" onclick="lvGoBack('home')" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button><div><h2 style="margin:0;"><i class="fa-solid fa-user-group"></i> Vendors you follow</h2><p class="muted" style="margin:.25rem 0 0;">Your followed vendors and their storefronts.</p></div></div>`;
    if(!rows.length) html+=`<div class="empty-state"><i class="fa-solid fa-user-group" style="font-size:1.7rem;display:block;margin-bottom:.6rem;"></i><strong>You aren't following any vendors yet.</strong><p class="muted">Follow a vendor from their storefront and they will appear here.</p><button type="button" class="btn" onclick="navigate('vendors')">Explore vendors</button></div>`;
    else html+=`<label class="lm-fol-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" placeholder="Search vendors you follow…" oninput="lmFilterFollowing(this.value)" autocomplete="off"></label><div class="customer-following-grid">${rows.map(v=>`<button type="button" class="customer-following-card" onclick="navigate('storefront',{vendorId:'${esc(v.id)}'})"><div class="customer-following-avatar">${v.logo_url?`<img src="${esc(v.logo_url)}" alt="${esc(v.business_name||'Vendor')}" loading="lazy">`:`<span>${esc(String(v.business_name||'V').trim().charAt(0).toUpperCase())}</span>`}</div><div class="customer-following-copy"><strong>${esc(v.business_name||'Vendor')}</strong><span>${esc(v.city||'Online')}</span><span>★ ${Number(v.avg_rating||0).toFixed(1)} · ${Number(v.review_count||0)} reviews</span></div><i class="fa-solid fa-chevron-right"></i></button>`).join('')}</div>`;
    html+='</div>'; return html;
  }catch(e){console.error('[Levromart] Customer following load failed:',e);return `<div class="empty-state">Could not load the vendors you follow. <button type="button" class="btn btn-outline" onclick="navigate('customerFollowing',{},false)">Try again</button></div>`;}
}

// The vendor side of the same relationship: who follows THIS shop, not
// which shops the current account follows.
async function renderVendorFollowers(){
  if(!session || profile?.role==='admin' || (profile?.role!=='vendor' && !vendor)) return '<div class="empty-state">Access denied.</div>';
  const { data: v } = await sb.from("vendors").select("id,business_name").eq("user_id", session.user.id).is("deleted_at", null).maybeSingle();
  if (!v) { navigate("vendorApply"); return '<p class="muted">Redirecting…</p>'; }
  let html=`<div class="customer-following-page"><div class="customer-following-head"><button type="button" class="icon-btn" onclick="navigate('vendorDashboard')" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button><div><h2 style="margin:0;"><i class="fa-solid fa-user-group"></i> Your followers</h2><p class="muted" style="margin:.25rem 0 0;">People following ${esc(v.business_name||"your shop")}.</p></div></div>`;
  try{
    const { data, error } = await sb.rpc("get_vendor_followers", { p_vendor_id: v.id });
    if (error) throw error;
    const rows = data||[];
    if(!rows.length){
      html+=`<div class="empty-state"><i class="fa-solid fa-user-group" style="font-size:1.7rem;display:block;margin-bottom:.6rem;"></i><strong>No followers yet.</strong><p class="muted">Customers who follow your shop will show up here.</p></div>`;
    } else {
      html+=`<div class="vendor-followers-list">${rows.map(r=>{
        const name=r.name||"Levromart user";
        const when=r.followed_at?new Date(r.followed_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):"";
        return `<div class="vendor-follower-row">${profileAvatarHtml(r.avatar_url,name,"2.6rem")}<div class="vendor-follower-copy"><strong>${esc(name)}</strong>${when?`<span class="muted">Following since ${esc(when)}</span>`:""}</div></div>`;
      }).join("")}</div>`;
    }
  }catch(e){
    console.error('[Levromart] Vendor followers load failed:',e);
    html+=`<div class="empty-state">Could not load your followers. <button type="button" class="btn btn-outline" onclick="navigate('vendorFollowers',{},false)">Try again</button></div>`;
  }
  html+='</div>'; return html;
}


/* ---- Followers page: tabs (All / Vendors / Customers), search, connection tags ---- */
window.__fp = { rows: [], tab: "all", q: "" };
async function renderVendorFollowersPage() {
  if (!session || profile?.role === "admin") return '<div class="empty-state">Access denied.</div>';
  const { data: v } = await sb.from("vendors").select("id,business_name").eq("user_id", session.user.id).is("deleted_at", null).maybeSingle();
  if (!v) { navigate("vendorApply"); return '<p class="muted">Redirecting…</p>'; }
  window.__fp = { rows: [], tab: "all", q: "", vendorId: v.id };
  setTimeout(fpLoad, 0);
  return `<div class="fp-page">
    <div class="fp-head"><button type="button" class="icon-btn" onclick="navigate('vendorDashboard')" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button><h2>Followers</h2><span class="fp-count" id="fpCount"></span></div>
    <label class="fp-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input id="fpSearch" type="search" placeholder="Search followers…" autocomplete="off" oninput="fpSearch(this.value)"></label>
    <div class="fp-tabs" id="fpTabs" role="tablist"></div>
    <div id="fpList" class="fp-list">${'<div class="lb-skel"></div>'.repeat(4)}</div>
  </div>`;
}
async function fpLoad() {
  const box = byId("fpList"); if (!box) return;
  try {
    const { data, error } = await sb.rpc("get_vendor_followers_v2", { p_vendor_id: window.__fp.vendorId });
    if (error) throw error;
    window.__fp.rows = data || [];
    fpRender();
  } catch (e) {
    box.innerHTML = '<div class="empty-state">Could not load your followers. <button type="button" class="btn btn-outline" onclick="fpLoad()">Try again</button></div>';
  }
}
function fpSearch(q) { window.__fp.q = String(q || "").trim().toLowerCase(); fpRender(); }
function fpTab(t) { window.__fp.tab = t; fpRender(); }
function fpTag(r) {
  if (r.link_level === 1) return '<span class="fn-tag fn-following"><i class="fa-solid fa-check"></i> You follow them</span>';
  if (r.link_level === 2) return `<span class="fn-tag fn-mutual"><i class="fa-solid fa-link"></i> Mutual${r.via_name ? ` · via ${esc(r.via_name)}` : ""}</span>`;
  if (r.link_level === 3) return `<span class="fn-tag fn-wide"><i class="fa-solid fa-diagram-project"></i> 3rd connection${r.via_name ? ` · via ${esc(r.via_name)}` : ""}</span>`;
  return "";
}
function fpRender() {
  const { rows, tab, q } = window.__fp;
  const vend = rows.filter((r) => r.is_vendor), cust = rows.filter((r) => !r.is_vendor);
  const tabs = byId("fpTabs");
  if (tabs) tabs.innerHTML = [["all", "All", rows.length], ["vendors", "Vendors", vend.length], ["customers", "Customers", cust.length]].map(([k, l, n]) => `<button type="button" role="tab" class="fp-tab${tab === k ? " active" : ""}" onclick="fpTab('${k}')">${l} <b>${n}</b></button>`).join("");
  const c = byId("fpCount"); if (c) c.textContent = rows.length ? `${rows.length} total` : "";
  let list = tab === "vendors" ? vend : tab === "customers" ? cust : rows;
  if (q) list = list.filter((r) => `${r.name || ""} ${r.business_name || ""} ${r.city || ""} ${r.sector_name || ""}`.toLowerCase().includes(q));
  const box = byId("fpList"); if (!box) return;
  if (!list.length) { box.innerHTML = `<div class="empty-state"><i class="fa-solid fa-user-group" style="font-size:1.6rem;display:block;margin-bottom:.5rem"></i><strong>${q ? "No one matches your search" : tab === "vendors" ? "No vendor followers yet" : tab === "customers" ? "No customer followers yet" : "No followers yet"}</strong></div>`; return; }
  box.innerHTML = list.map((r) => {
    const name = r.name || "Levromart user";
    const when = r.followed_at ? new Date(r.followed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
    const av = profileAvatarHtml(r.avatar_url, name, "3rem");
    const open = r.is_vendor && r.vendor_id ? ` onclick="navigate('storefront',{vendorId:'${esc(r.vendor_id)}'})" role="link" tabindex="0"` : "";
    const sub = r.is_vendor ? [r.sector_name, r.city].filter(Boolean).join(" · ") : "Customer";
    return `<div class="fp-row${r.is_vendor ? " clickable" : ""}"${open}>${av}<div class="fp-copy"><strong>${r.is_vendor ? '<i class="fa-solid fa-store fn-vicon" aria-label="Vendor" title="Vendor"></i>' : ""}${esc(name)}</strong><span class="muted">${esc(sub)}${when ? ` · since ${esc(when)}` : ""}</span>${fpTag(r)}</div>${r.is_vendor ? '<i class="fa-solid fa-chevron-right fp-go"></i>' : ""}</div>`;
  }).join("");
}
