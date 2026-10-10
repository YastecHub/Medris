// ---------- FOLLOWER NETWORK (vendors only) ----------
// Tapping "N followers" opens the vendors that follow this shop (customers are never listed). Each row says how
// the viewer is connected: Following (you follow them), Mutual (a vendor you follow follows them) or
// Wider network (reached through two steps), so people can grow their circle by following vendors they may know.
function openFollowerNetwork(vendorId) {
  const id = vendorId || currentViewParams?.vendorId;
  if (id) navigate("vendorFollowerNetwork", { vendorId: id });
}
function followerNetworkTagHtml(r) {
  if (r.is_me) return `<span class="fn-tag fn-me">You</span>`;
  if (r.link_level === 1) return `<span class="fn-tag fn-following"><i class="fa-solid fa-check"></i> Following</span>`;
  if (r.link_level === 2) return `<span class="fn-tag fn-mutual"><i class="fa-solid fa-link"></i> Mutual${r.via_name ? ` · via ${esc(r.via_name)}` : ""}</span>`;
  if (r.link_level === 3) return `<span class="fn-tag fn-wide"><i class="fa-solid fa-diagram-project"></i> Wider network${r.via_name ? ` · via ${esc(r.via_name)}` : ""}</span>`;
  return "";
}
async function renderVendorFollowerNetwork(vendorId) {
  if (!vendorId) return '<div class="empty-state">Vendor not found.</div>';
  const [{ data: v }, netRes] = await Promise.all([
    sb.from("vendors").select("id,business_name").eq("id", vendorId).maybeSingle(),
    sb.rpc("get_vendor_follower_network", { p_vendor_id: vendorId }),
  ]);
  const rows = netRes?.data || [];
  const head = `<div class="fn-head"><button type="button" class="icon-btn" onclick="history.length>1?history.back():navigate('vendors')" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button><div><h2>Followers</h2><p class="muted">Vendors following ${esc(v?.business_name || "this shop")}</p></div></div>`;
  if (netRes?.error) return `<div class="fn-page">${head}<div class="empty-state">Could not load followers. <button type="button" class="btn btn-outline" onclick="navigate('vendorFollowerNetwork',{vendorId:'${esc(vendorId)}'},false)">Try again</button></div></div>`;
  if (!rows.length) return `<div class="fn-page">${head}<div class="empty-state"><i class="fa-solid fa-user-group" style="font-size:1.7rem;display:block;margin-bottom:.6rem;"></i><strong>No vendor followers yet.</strong><p class="muted">Only vendors who follow this shop are shown here.</p></div></div>`;
  const recent = window.__vendorCardFollowRecent;
  const list = rows.map((r) => {
    const id = String(r.vendor_id);
    const rc = recent?.get(id);
    const following = rc && Date.now() - rc.at < 15000 ? !!rc.following : (r.is_following || !!(session && window.followedVendorSet?.().has(id)));
    const logo = r.logo_url ? `<img src="${esc(r.logo_url)}" alt="" class="fn-avatar" loading="lazy" decoding="async">` : avatarFallbackHtml(r.business_name || "Vendor", "3.2rem", "fn-avatar", r.business_name || "Vendor");
    return `<div class="fn-row" onclick="navigate('storefront',{vendorId:'${esc(id)}'})" role="link" tabindex="0">
      ${logo}
      <div class="fn-copy"><strong>${esc(r.business_name || "Vendor")}</strong><span class="muted">${esc([r.sector_name, r.city].filter(Boolean).join(" · ") || "Vendor")}</span>${followerNetworkTagHtml(r)}</div>
      ${r.is_me ? "" : `<button type="button" class="vendor-card-follow-btn fn-follow${following ? " following" : ""}" data-vendor-id="${esc(id)}" onclick="event.stopPropagation();toggleVendorCardFollow('${esc(id)}',event)">${following ? "Following" : "Follow"}</button>`}
    </div>`;
  }).join("");
  return `<div class="fn-page">${head}<div class="fn-list">${list}</div></div>`;
}

