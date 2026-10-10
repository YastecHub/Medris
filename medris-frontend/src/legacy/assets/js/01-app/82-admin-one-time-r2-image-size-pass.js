// ---------- ADMIN: one-time R2 image size pass ----------
// Walks the same four buckets (the Supabase Storage listing is still the
// source of truth for which keys exist -- migration only ever copied,
// never deleted). For each one already sitting in R2: resizes it down if
// it's larger than a normal product photo needs to be, re-compresses it,
// and stamps it with a long, cache-forever header either way. New uploads
// already get compressed on the way in and carry this header from day one
// (see uploadToR2/lib/compress-image.js) -- this is only for the backlog
// that landed in R2 before that existed, or was copied over as-is by the
// migration above.
async function optimizeOneR2File(bucket, key) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch("/api/vendor-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "r2-optimize-file", accessToken: session.access_token, bucket, key }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((res) => setTimeout(res, attempt * 600));
    }
  }
  throw lastErr;
}
const R2_OPTIMIZE_DONE_KEY = "levromart_r2_optimized_keys_v1";
function loadR2OptimizeDoneSet() {
  try { return new Set(JSON.parse(localStorage.getItem(R2_OPTIMIZE_DONE_KEY) || "[]")); }
  catch (e) { return new Set(); }
}
function saveR2OptimizeDoneSet(doneSet) {
  try { localStorage.setItem(R2_OPTIMIZE_DONE_KEY, JSON.stringify([...doneSet])); }
  catch (e) { /* not fatal -- resuming just re-checks from scratch */ }
}
async function runR2Optimize() {
  const btn = byId("r2OptimizeBtn");
  const log = byId("r2OptimizeLog");
  if (!log || !btn) return;
  btn.disabled = true;
  const buckets = ["product-photos", "homepage-carousel", "avatars", "vendor-logos"];
  const doneSet = loadR2OptimizeDoneSet();
  let totalShrunk = 0, totalUnchanged = 0, totalFailed = 0, consecutiveFailed = 0, lastError = "";
  let bytesBefore = 0, bytesAfter = 0, sinceSave = 0;
  const setStatus = (msg) => { log.textContent = msg; };
  const savedLabel = () => bytesBefore > bytesAfter ? `, saved ${((bytesBefore - bytesAfter) / 1048576).toFixed(1)} MB so far` : "";
  try {
    for (const bucket of buckets) {
      setStatus(`Listing files in ${bucket}…`);
      const files = await listAllStorageFiles(bucket);
      for (let i = 0; i < files.length; i++) {
        const doneKey = `${bucket}/${files[i]}`;
        if (doneSet.has(doneKey)) { totalUnchanged++; continue; }
        setStatus(`${bucket}: ${i + 1}/${files.length}, shrunk ${totalShrunk}, already small ${totalUnchanged}, failed ${totalFailed}${savedLabel()}${lastError ? `\nLast error: ${lastError}` : ""}`);
        try {
          const j = await optimizeOneR2File(bucket, files[i]);
          if (j.recompressed) { totalShrunk++; bytesBefore += Number(j.originalSize || 0); bytesAfter += Number(j.newSize || 0); }
          else totalUnchanged++;
          consecutiveFailed = 0;
          doneSet.add(doneKey);
          if (++sinceSave >= 20) { saveR2OptimizeDoneSet(doneSet); sinceSave = 0; }
        } catch (e) {
          totalFailed++;
          consecutiveFailed++;
          lastError = `${bucket}/${files[i]}: ${e.message}`;
          console.warn(`[R2 optimize] ${bucket}/${files[i]} failed after 3 attempts:`, e.message);
          if (consecutiveFailed >= 3) {
            saveR2OptimizeDoneSet(doneSet);
            setStatus(`Stopped after ${consecutiveFailed} failures in a row so this is easy to read:\n${lastError}`);
            showToast("Image size pass stopped, several files in a row failed the same way. Screenshot the log and send it over.", "error");
            return;
          }
        }
      }
      saveR2OptimizeDoneSet(doneSet);
    }
    setStatus(`Done. Shrunk ${totalShrunk}, already small ${totalUnchanged}, failed ${totalFailed}${savedLabel()}.${lastError ? `\nLast error: ${lastError}` : ""}`);
    showToast("R2 image size pass finished, see the log on this page for the count.", totalFailed ? "warning" : "success");
  } catch (e) {
    setStatus(`Stopped early: ${e.message}`);
    showToast(`Image size pass stopped early: ${e.message}`, "error");
  } finally {
    saveR2OptimizeDoneSet(doneSet);
    btn.disabled = false;
  }
}
window.runR2Optimize = runR2Optimize;
function renderAdminR2Optimize() {
  if (!session || !isSuperAdmin()) return '<div class="empty-state">Access denied.</div>';
  let html = `<h2><i class="fa-solid fa-compress"></i> R2 image size</h2>`;
  html += adminNavHtml("adminR2Optimize");
  html += `<div class="card" style="max-width:560px;">
    <p class="muted">Shrinks every image already in R2 that's larger than it needs to be for the app (resized and re-compressed), and makes sure every file -- images or not -- is set to cache indefinitely in the browser and at Cloudflare's edge, so repeat views never have to be re-served from storage. New uploads already get this automatically; this is a one-time pass for what's already there. Safe to run more than once.</p>
    <button class="btn" id="r2OptimizeBtn" onclick="runR2Optimize()"><i class="fa-solid fa-play"></i> Start image size pass</button>
    <p id="r2OptimizeLog" class="muted" style="margin-top:.8rem;white-space:pre-wrap;font-size:.85rem;"></p>
  </div>`;
  return html;
}

async function refreshLockedVendorCount(){
  if(!session||profile?.role!=='admin')return 0;
  try{
    const {data,error}=await sb.rpc('admin_list_locked_vendors');
    if(error)throw error;
    const n=(data||[]).length;
    window.__lockedVendorCount=n;
    document.querySelectorAll('.locked-vendors-admin-badge').forEach(el=>{el.textContent=n>9?'9+':String(n);el.classList.toggle('hidden',!n)});
    return n;
  }catch(err){console.warn('Locked vendor badge refresh failed',err);return Number(window.__lockedVendorCount||0);}
}
async function refreshMonthlyPendingCount(){
  if(!session||(!vendor&&profile?.role!=='admin'))return 0;
  try{let q=sb.from('monthly_listing_submissions').select('id,kind,listing_id,vendor_id').eq('status','pending');if(profile.role!=='admin')q=q.eq('vendor_id',vendor.id);
    const {data:subs,error}=await q;if(error)throw error;
    const alive=await Promise.all((subs||[]).map(async sub=>{const {data,error}=await sb.from(monthlySubmissionListingTable(sub.kind)).select('id,status').eq('id',sub.listing_id).eq('vendor_id',sub.vendor_id).maybeSingle();if(error)throw error;return data&&data.status!=='removed'}));
    const n=alive.filter(Boolean).length;window.__monthlyPendingCount=n;document.querySelectorAll('.monthly-listings-admin-badge,.monthly-profile-badge').forEach(el=>{el.textContent=n>9?'9+':String(n);el.classList.toggle('hidden',!n)});return n;
  }catch(err){console.warn('Monthly listing badge refresh failed',err);return Number(window.__monthlyPendingCount||0);}
}
function monthlySubmissionKindLabel(kind,listing){return kind==="product"?(listing?.is_service?"Service":"Product"):"Package"}
function monthlySubmissionListingTable(kind){return kind==="product"?"products":"vendor_packages"}
async function renderAdminMonthlyListings(){
  if(!session||!isSuperAdmin())return '<div class="empty-state">Access denied.</div>';
  const {data:subs,error}=await sb.from("monthly_listing_submissions").select("id,kind,listing_id,vendor_id,user_id,payer_name,receipt_path,status,submitted_at,reviewed_at,review_note").order("submitted_at",{ascending:false}).limit(100);
  let html=`<h2><i class="fa-solid fa-receipt"></i> Monthly listings</h2>${adminNavHtml("adminMonthlyListings")}`;
  if(error)return html+errorStateHtml(error);
  const grouped={products:[],services:[],packages:[]};
  const vendorIds=[...new Set((subs||[]).map(x=>x.vendor_id).filter(Boolean))], userIds=[...new Set((subs||[]).map(x=>x.user_id).filter(Boolean))];
  const [vr,ur]=await Promise.all([vendorIds.length?sb.from("vendors").select("id,business_name,phone,city,user_id").in("id",vendorIds):Promise.resolve({data:[]}),userIds.length?sb.from("users").select("id,name,email,phone").in("id",userIds):Promise.resolve({data:[]})]);
  const vendorsById=Object.fromEntries((vr.data||[]).map(v=>[v.id,v])),usersById=Object.fromEntries((ur.data||[]).map(u=>[u.id,u]));
  for(const sub of (subs||[])){let listing=null;try{const {data,error:listingError}=await sb.from(monthlySubmissionListingTable(sub.kind)).select("*").eq("id",sub.listing_id).eq("vendor_id",sub.vendor_id).maybeSingle();if(listingError)throw listingError;listing=data||null}catch(err){throw err}if(!listing||listing.status==="removed")continue;sub.__listing=listing;sub.__vendor=vendorsById[sub.vendor_id]||{};sub.__user=usersById[sub.user_id]||{};const key=sub.kind==='package'?'packages':listing?.is_service?'services':'products';grouped[key].push(sub)}
  const pending=Object.values(grouped).flat().filter(x=>x.status==='pending');window.__monthlyPendingCount=pending.length;
  html+=`<div class="monthly-listing-admin-intro"><div><strong>Manual ₦999 monthly activation</strong><p class="muted">Vendors transfer ₦999 to the Levromart account, upload their receipt and payer name, then wait here for approval. The one-month clock starts only when you approve.</p></div><span class="monthly-admin-total-badge">${pending.length} pending</span></div>`;
  const pendingCount=k=>grouped[k].filter(x=>x.status==='pending').length;
  html+=`<div class="tabs monthly-listing-kind-tabs"><button class="active" data-monthly-kind-tab="products" onclick="switchMonthlyAdminKind('products')"><i class="fa-solid fa-box"></i> Products <span class="monthly-kind-badge ${pendingCount('products')?'':'hidden'}">${pendingCount('products')}</span></button><button data-monthly-kind-tab="services" onclick="switchMonthlyAdminKind('services')"><i class="fa-solid fa-hand-holding-heart"></i> Services <span class="monthly-kind-badge ${pendingCount('services')?'':'hidden'}">${pendingCount('services')}</span></button><button data-monthly-kind-tab="packages" onclick="switchMonthlyAdminKind('packages')"><i class="fa-solid fa-box-open"></i> Packages <span class="monthly-kind-badge ${pendingCount('packages')?'':'hidden'}">${pendingCount('packages')}</span></button></div>`;
  const renderGroup=key=>{const rows=grouped[key];if(!rows.length)return `<div class="monthly-kind-panel ${key==='products'?'':'hidden'}" data-monthly-kind="${key}"><div class="empty-state">No ${key} monthly listing submissions yet.</div></div>`;return `<div class="monthly-kind-panel ${key==='products'?'':'hidden'}" data-monthly-kind="${key}">${rows.map(sub=>{const l=sub.__listing||{},v=sub.__vendor||{},u=sub.__user||{},img=Array.isArray(l.photos)?l.photos[0]:null,isPending=sub.status==='pending',isActive=l.status==='active'&&l.billing_status==='active';return `<details class="card monthly-submission-card ${isPending?'monthly-submission-pending':''}"><summary class="monthly-submission-head"><div><span class="badge ${isPending?'danger':sub.status==='approved'?'success':sub.status==='deactivated'?'danger':'warning'}">${esc(sub.status)}</span><h3 style="margin:.35rem 0 .1rem;">${esc(l.name||'Listing unavailable')}</h3><p class="muted" style="margin:0;">${esc(monthlySubmissionKindLabel(sub.kind,l))} · Submitted ${new Date(sub.submitted_at).toLocaleString('en-GB')}</p></div>${img?`<img class="monthly-submission-thumb" src="${esc(img)}" alt="" loading="lazy">`:''}</summary><div class="monthly-submission-grid"><div><span>Vendor</span><strong>${esc(v.business_name||'Vendor')}</strong><small>${esc(v.city||'')}${v.phone?' · '+esc(v.phone):''}</small></div><div><span>Applicant</span><strong>${esc(u.name||'User')}</strong><small>${esc(u.email||'')}${u.phone?' · '+esc(u.phone):''}</small></div><div><span>Payer account</span><strong>${esc(sub.payer_name)}</strong><small>₦999 manual transfer</small></div><div><span>Listing</span><strong>${esc(l.name||'Unavailable')}</strong><small>${l.description?esc(String(l.description).slice(0,130)):'No description'}</small></div></div><div class="monthly-submission-receipt"><div><strong>Payment receipt</strong><span class="muted">Uploaded by vendor · ${new Date(sub.submitted_at).toLocaleString('en-GB')}</span></div><button type="button" class="btn btn-sm btn-outline" onclick="viewMonthlyReceipt('${esc(sub.receipt_path)}')"><i class="fa-regular fa-image"></i> View receipt</button></div>${sub.review_note?`<p class="muted monthly-review-note"><strong>Admin note:</strong> ${esc(sub.review_note)}</p>`:''}<div class="monthly-submission-actions">${isPending?`<button type="button" class="btn" onclick="approveMonthlyListing('${sub.id}')"><i class="fa-solid fa-circle-check"></i> Activate</button><button type="button" class="btn btn-outline" onclick="rejectMonthlyListing('${sub.id}')"><i class="fa-solid fa-xmark"></i> Reject receipt</button><button type="button" class="btn btn-danger" onclick="deactivateMonthlyListing('${sub.id}')"><i class="fa-solid fa-ban"></i> Deactivate</button>`:''}${isActive?`<button type="button" class="btn btn-danger" onclick="deactivateMonthlyListing('${sub.id}')"><i class="fa-solid fa-ban"></i> Deactivate</button>`:''}</div></details>`}).join('')}</div>`};
  html+=renderGroup('products')+renderGroup('services')+renderGroup('packages');setTimeout(refreshMonthlyPendingCount,0);return html;
}
window.switchMonthlyAdminKind=function(kind){document.querySelectorAll('[data-monthly-kind-tab]').forEach(b=>b.classList.toggle('active',b.dataset.monthlyKindTab===kind));document.querySelectorAll('[data-monthly-kind]').forEach(p=>p.classList.toggle('hidden',p.dataset.monthlyKind!==kind))};
window.viewMonthlyReceipt=async function(path){try{const {data,error}=await sb.storage.from('listing-payment-receipts').createSignedUrl(path,3600);if(error||!data?.signedUrl)throw error||new Error('Receipt could not be opened.');const pdf=/\.pdf$/i.test(path),m=document.createElement('div');m.className='modal';m.id='monthlyReceiptViewer';m.innerHTML=`<div class="modal-content" style="max-width:760px;max-height:90vh;overflow:auto"><div class="flex" style="justify-content:space-between;align-items:center"><h3 style="margin:0">Payment receipt</h3><button class="icon-btn" onclick="document.getElementById('monthlyReceiptViewer')?.remove()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>${pdf?`<iframe src="${esc(data.signedUrl)}" title="Payment receipt" style="width:100%;height:70vh;border:0;border-radius:12px;margin-top:.7rem"></iframe>`:`<img src="${esc(data.signedUrl)}" alt="Payment receipt" style="display:block;max-width:100%;max-height:70vh;margin:.7rem auto 0;border-radius:12px;object-fit:contain">`}</div>`;document.body.appendChild(m)}catch(e){showToast(e.message||'Could not open receipt.','error')}};
window.approveMonthlyListing=async function(id){if(!(await showConfirmDialog('Activate this listing for one month? The one-month clock starts now.',{title:'Activate monthly listing',okLabel:'Activate'})))return;try{const {error}=await sb.rpc('admin_approve_monthly_listing',{p_submission_id:id});if(error)throw error;showToast('Monthly listing activated for one month.','success');await navigate('adminMonthlyListings',{},false)}catch(e){showToast(e.message||'Could not activate listing.','error')}};
window.rejectMonthlyListing=async function(id){const note=prompt('Optional reason for rejecting this receipt:','Receipt could not be verified.');if(note===null)return;try{const {error}=await sb.rpc('admin_reject_monthly_listing',{p_submission_id:id,p_note:note});if(error)throw error;showToast('Receipt rejected.','success');await navigate('adminMonthlyListings',{},false)}catch(e){showToast(e.message||'Could not reject receipt.','error')}};
window.deactivateMonthlyListing=async function(id){if(!(await showConfirmDialog('Deactivate this monthly listing? It will be paused immediately and its active period will be cancelled.',{title:'Deactivate listing',okLabel:'Deactivate',danger:true})))return;const note=prompt('Optional reason for deactivation:','Receipt/payment could not be verified.');if(note===null)return;try{const {error}=await sb.rpc('admin_deactivate_monthly_listing',{p_submission_id:id,p_note:note});if(error)throw error;showToast('Monthly listing deactivated.','success');await navigate('adminMonthlyListings',{},false)}catch(e){showToast(e.message||'Could not deactivate listing.','error')}};

async function fetchManualPasswordResetRequests() {
  const { data, error } = await sb.rpc("admin_get_manual_password_reset_requests");
  if (error) throw error;
  return data || [];
}

async function refreshManualPasswordResetBadge() {
  if (!session || !isSuperAdmin()) return 0;
  try {
    const rows = await fetchManualPasswordResetRequests();
    const pending = rows.filter(r => r.status === "pending").length;
    window.__passwordResetPendingCount = pending;
    document.querySelectorAll(".password-reset-admin-badge").forEach(el => {
      el.textContent = pending > 9 ? "9+" : String(pending);
    });
    document.querySelectorAll('.admin-dash-tabs [data-admin-view="adminPasswordResets"]').forEach(tab => {
      let badge = tab.querySelector(".password-reset-admin-badge");
      if (pending > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "dash-tab-dot password-reset-admin-badge";
          tab.appendChild(badge);
        }
        badge.textContent = pending > 9 ? "9+" : String(pending);
      } else {
        badge?.remove();
      }
    });
    return pending;
  } catch (e) {
    console.warn("Password reset badge refresh failed", e);
    return Number(window.__passwordResetPendingCount || 0);
  }
}

async function renderAdminPasswordResets() {
  if (!session || !isSuperAdmin()) return '<div class="empty-state">Access denied.</div>';
  let rows = [];
  try {
    rows = await fetchManualPasswordResetRequests();
  } catch (e) {
    return `<h2><i class="fa-solid fa-key"></i> Password resets</h2>${adminNavHtml("adminPasswordResets")}${errorStateHtml(e)}`;
  }

  const pending = rows.filter(r => r.status === "pending").length;
  window.__passwordResetPendingCount = pending;

  let html = `<h2><i class="fa-solid fa-key"></i> Password reset requests</h2>`;
  html += adminNavHtml("adminPasswordResets");
  html += `<div class="card" style="margin-bottom:1rem;">
    <strong>Manual password reset approval</strong>
    <p class="muted" style="margin:.35rem 0 0;font-size:.88rem;">Users who tap Forgot password submit a request here. Approve only when you have verified the person's identity. After approval, their screen automatically changes to Set a new password.</p>
  </div>`;

  if (!rows.length) {
    html += `<div class="empty-state">No password reset requests yet.</div>`;
  } else {
    html += `<div class="admin-password-reset-list">`;
    for (const r of rows) {
      const isPending = r.status === "pending";
      const accountFound = !!r.user_id;
      const statusClass = r.status === "approved" ? "success" : (r.status === "rejected" || r.status === "expired" ? "danger" : "warning");
      html += `<details class="card admin-password-reset-card ${isPending ? "admin-password-reset-pending" : ""}" ${isPending ? "open" : ""}>
        <summary class="flex" style="justify-content:space-between;gap:.8rem;">
          <div>
            <strong>${esc(r.email || "")}</strong>
            <div class="muted" style="font-size:.8rem;margin-top:.2rem;">${esc(r.user_name || (accountFound ? "Account found" : "No matching account"))} · ${new Date(r.created_at).toLocaleString("en-GB")}</div>
          </div>
          <span class="badge ${statusClass}">${esc(r.status)}</span>
        </summary>
        <div style="margin-top:.8rem;">
          <p class="muted" style="margin:.25rem 0;">${accountFound ? "A Levromart account matches this email." : "No Levromart account currently matches this email."}</p>
          ${isPending ? `<div class="flex" style="gap:.5rem;flex-wrap:wrap;">
            <button type="button" class="btn btn-sm ${accountFound ? "" : "btn-outline"}" ${accountFound ? "" : "disabled"} onclick="approveManualPasswordReset('${esc(r.id)}')"><i class="fa-solid fa-check"></i> Approve reset</button>
            <button type="button" class="btn btn-sm btn-danger" onclick="rejectManualPasswordReset('${esc(r.id)}')"><i class="fa-solid fa-xmark"></i> Reject</button>
          </div>` : ""}
          ${r.status === "approved" && r.approved_at ? `<p class="muted" style="margin:.6rem 0 0;">Approved ${new Date(r.approved_at).toLocaleString("en-GB")}.</p>` : ""}
          ${r.status === "rejected" && r.rejected_at ? `<p class="muted" style="margin:.6rem 0 0;">Rejected ${new Date(r.rejected_at).toLocaleString("en-GB")}.</p>` : ""}
          ${r.status === "completed" && r.completed_at ? `<p class="muted" style="margin:.6rem 0 0;">Password was set ${new Date(r.completed_at).toLocaleString("en-GB")}.</p>` : ""}
        </div>
      </details>`;
    }
    html += `</div>`;
  }


  clearInterval(window.__passwordResetAdminTimer);
  window.__passwordResetAdminTimer = setInterval(async () => {
    if (!isSuperAdmin() || !document.querySelector('.admin-dash-tabs [data-admin-view="adminPasswordResets"]')) {
      clearInterval(window.__passwordResetAdminTimer);
      return;
    }
    try {
      const latest = await fetchManualPasswordResetRequests();
      const latestPending = latest.filter(r => r.status === "pending").length;
      if (latestPending !== window.__passwordResetPendingCount) {
        await navigate("adminPasswordResets", {}, false);
      } else {
        window.__passwordResetPendingCount = latestPending;
        document.querySelectorAll(".password-reset-admin-badge").forEach(el => el.textContent = latestPending > 9 ? "9+" : String(latestPending));
      }
    } catch (_) {}
  }, 5000);

  return html;
}

window.approveManualPasswordReset = async function(id) {
  if (!(await showConfirmDialog("Approve this password reset request? Only approve after verifying the person's identity.", { title: "Approve password reset", okLabel: "Approve" }))) return;
  try {
    const { error } = await sb.rpc("admin_approve_manual_password_reset", { p_request_id: id });
    if (error) throw error;
    showToast("Password reset approved. The user's page will update automatically.", "success");
    await navigate("adminPasswordResets", {}, false);
  } catch (e) {
    showToast(e.message || "Could not approve password reset.", "error");
  }
};

window.rejectManualPasswordReset = async function(id) {
  if (!(await showConfirmDialog("Reject this password reset request?", { title: "Reject password reset", okLabel: "Reject", danger: true }))) return;
  try {
    const { error } = await sb.rpc("admin_reject_manual_password_reset", { p_request_id: id });
    if (error) throw error;
    showToast("Password reset request rejected.", "success");
    await navigate("adminPasswordResets", {}, false);
  } catch (e) {
    showToast(e.message || "Could not reject password reset.", "error");
  }
};

async function renderAdminSupportRequests() {
  if (!session || profile?.role !== "admin") return '<div class="empty-state">Access denied.</div>';
  // Do not depend on a fragile nested users relationship here. A broken or
  // missing PostgREST relationship was making the whole Support tab fall
  // through to the generic error screen. Load requests first, then enrich
  // them with the matching users in a separate query.
  const { data: requests, error } = await withRouteTimeout(
    sb.from("support_requests")
      .select("id,user_id,subject,message,status,admin_reply,attachments,created_at,updated_at")
      .order("created_at", { ascending: false }),
    8000,
    { data: null, error: new Error("Support requests are taking too long to load.") }
  );
  let html = `<h2><i class="fa-solid fa-headset"></i> Support requests</h2>`;
  html += adminNavHtml("adminSupportRequests");
  if (error) return html + errorStateHtml(error);
  const userIds = [...new Set((requests || []).map(r => r.user_id).filter(Boolean))];
  let usersById = {};
  if (userIds.length) {
    try {
      const { data: users } = await withRouteTimeout(
        sb.from("users").select("id,name,email,phone").in("id", userIds),
        5000,
        { data: [], error: null }
      );
      (users || []).forEach(u => { usersById[u.id] = u; });
    } catch (_) {}
  }
  if (!requests?.length) return html + `<div class="empty-state">No support requests yet.</div>`;
  for (const r of requests) {
    const user = usersById[r.user_id] || {};
    let attachments = '';
    try { attachments = await getSupportAttachmentHtml(r.attachments); } catch (e) { console.warn('[Levromart] Support attachment rendering failed:', e); }
    html += `<details class="support-request-accordion">
      <summary>
        <span class="support-request-summary-main"><span class="support-request-summary-subject">${esc(r.subject)}</span><span class="support-request-summary-meta">${esc(user.name || 'User')} · ${esc(user.email || '')} · ${new Date(r.created_at).toLocaleString('en-GB')}</span></span>
        <span class="flex" style="align-items:center;gap:.45rem;flex:0 0 auto;"><span class="badge ${r.status === 'resolved' ? 'success' : r.status === 'closed' ? 'danger' : r.status === 'in_progress' ? 'warning' : ''}">${supportStatusLabel(r.status)}</span><i class="fa-solid fa-chevron-down support-request-chevron"></i></span>
      </summary>
      <div class="support-request-body">
        <div class="support-request-status-note">${supportStatusNote(r.status)}</div>
        <p style="white-space:pre-wrap;margin:.75rem 0;">${esc(r.message)}</p>
        ${attachments}
        <label>Admin reply</label>
        <textarea id="supportReply_${r.id}" rows="3" maxlength="4000" placeholder="Reply to the user…">${esc(r.admin_reply || '')}</textarea>
        <div class="flex" style="justify-content:flex-end;align-items:center;margin-top:.55rem;gap:.5rem;">
          <select id="supportStatus_${r.id}" style="max-width:180px;">
            ${['open','in_progress','resolved','closed'].map(st => `<option value="${st}" ${r.status === st ? 'selected' : ''}>${supportStatusLabel(st)}</option>`).join('')}
          </select>
          <button class="btn btn-sm" onclick="saveSupportRequest('${r.id}')"><i class="fa-solid fa-floppy-disk"></i> Save</button>
        </div>
      </div>
    </details>`;
  }
  return html;
}
async function saveSupportRequest(id) {
  if (!session || profile?.role !== 'admin') return;
  const status = byId(`supportStatus_${id}`)?.value;
  const admin_reply = String(byId(`supportReply_${id}`)?.value || '').trim() || null;
  const { error } = await sb.from('support_requests').update({ status, admin_reply }).eq('id', id);
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Support request updated.', 'success');
  navigate('adminSupportRequests', {}, { replace: true });
}

async function renderAdminPanel(status) {
  if (!session || !isSuperAdmin()) return '<div class="empty-state">Access denied.</div>';
  status = ["all", "pending", "verified", "rejected", "recycle", "locked"].includes(status) ? status : "pending";

  if (status === "locked") return renderAdminLockedVendors();

  let vendors = [];
  let vendorError = null;
  if (status === "recycle") {
    const { data, error } = await sb.from("vendors")
      .select("id,business_name,address,city,phone,whatsapp_number,cac_number,bio,verification_docs,verification_status,avg_rating,review_count,created_at,deleted_at,deleted_previous_verification_status,deleted_previous_is_active,applicant:users(name,email)")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    vendors = data || [];
    vendorError = error;
  } else {
    let q = sb.from("vendors")
      .select("id, business_name, address, city, phone, whatsapp_number, cac_number, bio, verification_docs, verification_status, avg_rating, review_count, created_at, applicant:users(name, email)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (status !== "all") q = q.eq("verification_status", status);
    const result = await q;
    vendors = result.data || [];
    vendorError = result.error;
  }

  let html = `<h2><i class='fa-solid fa-gear'></i> Admin: Vendors</h2>`;
  html += adminNavHtml("adminPanel");
  html += window.lvAdminVendorsTabs ? window.lvAdminVendorsTabs("applications") : "";
  html += `<div class="tabs">
      <a class="${status === "all" ? "active" : ""}" onclick="navigate('adminPanel',{status:'all'})">all</a>
      <a class="${status === "pending" ? "active" : ""}" onclick="navigate('adminPanel',{status:'pending'})">pending</a>
      <a class="${status === "verified" ? "active" : ""}" onclick="navigate('adminPanel',{status:'verified'})">verified</a>
      <a class="${status === "rejected" ? "active" : ""}" onclick="navigate('adminPanel',{status:'rejected'})">rejected</a>
      <a class="${status === "locked" ? "active" : ""}" onclick="navigate('adminPanel',{status:'locked'})"><i class="fa-solid fa-lock"></i> Locked${Number(window.__lockedVendorCount||0) ? ` <span class="badge danger" style="margin-left:.25rem;">${Number(window.__lockedVendorCount||0) > 9 ? "9+" : Number(window.__lockedVendorCount||0)}</span>` : ""}</a>
      <a class="${status === "recycle" ? "active" : ""}" onclick="navigate('adminPanel',{status:'recycle'})"><i class="fa-solid fa-trash-can"></i> Recycle Bin</a>
    </div>`;

  if(vendorError)return html+errorStateHtml(vendorError);
  const emptyLabel = status === "recycle" ? "recycle bin" : (status === "all" ? "vendors" : status + " vendors");
  html += `<div class="admin-vendor-filters"><input type="search" id="adminVendorSearch" placeholder="Search name, email or phone" oninput="filterAdminVendorCards()"><select id="adminVendorSort" onchange="filterAdminVendorCards()"><option value="latest">Last listed</option><option value="alpha">Alphabetical</option></select></div><div id="adminVendorCards">`;
  if (!vendors.length) html += `<div class="empty-state"><i class="fa-solid ${status === "recycle" ? "fa-trash-can" : "fa-store"}"></i><p>No ${emptyLabel}.</p></div>`;

  vendors.forEach((v) => {
    const doc = (v.verification_docs || [])[0];
    const deleted = status === "recycle";
    const applicantName = v.applicant?.name || "";
    const applicantEmail = v.applicant?.email || "";
    const searchable = [v.business_name, applicantName, applicantEmail, v.phone, v.id].filter(Boolean).join(' ').toLowerCase();
    html += `<details id="adminVendor-${esc(v.id)}" class="ad-row admin-vendor-card" data-name="${esc(v.business_name || "Deleted vendor")}" data-created="${esc(v.deleted_at || v.created_at)}" data-search="${esc(searchable)}">
      <summary class="flex" style="justify-content:space-between;">
        <span class="ad-sum-main"><span class="ad-ini">${esc(String(v.business_name || "V").trim().charAt(0).toUpperCase())}</span><span class="ad-sum-text"><strong>${esc(v.business_name || "Deleted vendor")}</strong><small>${esc(applicantName || applicantEmail || "")}</small></span></span>
        <span class="badge ${deleted ? "warning" : (v.verification_status === "verified" ? "success" : v.verification_status === "pending" ? "warning" : v.verification_status === "rejected" ? "danger" : "")}">${deleted ? "Deleted" : esc(v.verification_status)}</span>
      </summary>
      <p class="muted" style="margin:0.3rem 0;">Applicant: ${esc(applicantName)} ${applicantEmail ? `(${esc(applicantEmail)})` : ""}</p>
      <p class="muted" style="margin:0.3rem 0;">${[v.address, v.city].filter(Boolean).map(esc).join(", ") || "No address given (online-only)"}</p>
      ${v.phone ? `<p class="muted" style="margin:0.3rem 0;"><i class='fa-solid fa-phone'></i> ${esc(v.phone)}${v.whatsapp_number ? " · WhatsApp " + esc(v.whatsapp_number) : ""}${v.cac_number ? " · CAC " + esc(v.cac_number) : ""}</p>` : ""}
      ${v.bio ? `<p style="margin:0.3rem 0;">${esc(v.bio)}</p>` : ""}
      <p class="muted" style="margin:0.3rem 0;">${deleted ? `Deleted ${new Date(v.deleted_at).toLocaleDateString()}` : (doc ? `<a href="#" onclick="viewVendorDoc('${doc}');return false;"><i class='fa-solid fa-file-lines'></i> View submitted document</a>` : "No document uploaded") + ` · applied ${new Date(v.created_at).toLocaleDateString()}`}</p>
      <div class="flex" style="margin-top:0.5rem;gap:.5rem;flex-wrap:wrap;">
        ${deleted
          ? `<button type="button" class="btn btn-sm ad-btn ad-approve" onclick="restoreAdminVendor('${esc(v.id)}');return false;"><i class="fa-solid fa-rotate-left"></i> Restore</button>
             <button type="button" class="btn btn-sm ad-btn ad-delete" onclick="permanentlyDeleteAdminVendor('${esc(v.id)}');return false;"><i class="fa-solid fa-trash-can"></i> Delete permanently</button>`
          : `${v.verification_status !== "verified" ? `<button type="button" class="btn btn-sm ad-btn ad-approve vendor-admin-action" data-vendor-id="${esc(v.id)}" data-status="verified" data-filter-status="${esc(status)}"><i class="fa-solid fa-circle-check"></i> Approve</button>` : ""}
             ${v.verification_status !== "rejected" ? `<button type="button" class="btn btn-sm ad-btn ad-reject vendor-admin-action" data-vendor-id="${esc(v.id)}" data-status="rejected" data-filter-status="${esc(status)}"><i class="fa-solid fa-circle-xmark"></i> Reject</button>` : ""}
             ${profile?.email === SUPER_ADMIN_EMAIL ? `<button type="button" class="btn btn-sm ad-btn ad-delete vendor-admin-action" data-vendor-id="${esc(v.id)}" data-status="delete" data-filter-status="${esc(status)}"><i class="fa-solid fa-trash"></i> Delete vendor</button>` : ""}`}
      </div>
    </details>`;
  });
  return html+"</div>";
}

// Vendors whose storefront is currently paused -- either automatically
// over an overdue commission balance, or manually by an admin. Previously
// there was no way to see this list at all short of scrolling the full
// vendor list and checking each one individually.
async function renderAdminLockedVendors() {
  // Fetched before adminNavHtml()/the tab row are built below, so the
  // "Vendor" tab badge they bake into the returned HTML already reflects
  // the current count instead of whatever was set at the last page load.
  const { data: locked, error } = await sb.rpc("admin_list_locked_vendors");
  window.__lockedVendorCount = (locked || []).length;

  let html = `<h2><i class='fa-solid fa-gear'></i> Admin: Vendor applications</h2>`;
  html += adminNavHtml("adminPanel");
  html += `<div class="tabs">
      <a onclick="navigate('adminPanel',{status:'all'})">all</a>
      <a onclick="navigate('adminPanel',{status:'pending'})">pending</a>
      <a onclick="navigate('adminPanel',{status:'verified'})">verified</a>
      <a onclick="navigate('adminPanel',{status:'rejected'})">rejected</a>
      <a class="active" onclick="navigate('adminPanel',{status:'locked'})"><i class="fa-solid fa-lock"></i> Locked</a>
      <a onclick="navigate('adminPanel',{status:'recycle'})"><i class="fa-solid fa-trash-can"></i> Recycle Bin</a>
    </div>`;

  if (error) return html + errorStateHtml(error);
  if (!locked || !locked.length) {
    return html + `<div class="card empty-state"><i class="fa-solid fa-lock-open"></i><p>No vendors are currently locked.</p></div>`;
  }

  html += `<div id="adminLockedVendorCards">${locked.map((v) => {
    const reason = v.admin_paused ? "Manually paused by an admin" : v.commission_pause_reason === "commission_overdue" ? "Commission overdue" : "Paused";
    return `<div id="adminLockedVendor-${esc(v.vendor_id)}" class="ad-row ad-static admin-vendor-card">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:.5rem;">
        <strong>${esc(v.business_name || "Vendor")}</strong>
        <span class="badge danger">Locked</span>
      </div>
      <p class="muted" style="margin:0.3rem 0;">${esc(reason)}</p>
      <p class="muted" style="margin:0.3rem 0;">Applicant: ${esc(v.applicant_name || "")} ${v.applicant_email ? `(${esc(v.applicant_email)})` : ""}</p>
      ${v.city ? `<p class="muted" style="margin:0.3rem 0;">${esc(v.city)}</p>` : ""}
      <p style="margin:0.4rem 0;">Commission owed: <strong>${naira(Number(v.commission_owed || 0))}</strong></p>
      <div class="flex" style="margin-top:0.5rem;gap:.5rem;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm ad-btn ad-approve" onclick="adminUnlockVendor('${esc(v.vendor_id)}')"><i class="fa-solid fa-unlock"></i> Unlock</button>
      </div>
    </div>`;
  }).join("")}</div>`;
  return html;
}

async function adminUnlockVendor(vendorId) {
  if (!vendorId) return;
  const btn = document.querySelector(`#adminLockedVendor-${CSS.escape(vendorId)} button`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Unlocking…'; }
  try {
    const { data, error } = await sb.rpc("admin_force_unlock_vendor", { p_vendor_id: vendorId });
    if (error) throw error;
    const stillOwed = Number(data?.vendor?.commission_owed || 0);
    showToast(stillOwed > 0 ? `Storefront unlocked. ₦${stillOwed.toLocaleString()} commission remains owed.` : "Storefront unlocked.", "success");
    const card = byId(`adminLockedVendor-${vendorId}`);
    card?.remove();
    window.__lockedVendorCount = Math.max(0, Number(window.__lockedVendorCount || 0) - 1);
    document.querySelectorAll(".locked-vendors-admin-badge").forEach((el) => {
      el.textContent = window.__lockedVendorCount > 9 ? "9+" : String(window.__lockedVendorCount);
      el.classList.toggle("hidden", !window.__lockedVendorCount);
    });
    if (!document.querySelector("#adminLockedVendorCards .admin-vendor-card")) {
      const wrap = byId("adminLockedVendorCards");
      if (wrap) wrap.outerHTML = `<div class="card empty-state"><i class="fa-solid fa-lock-open"></i><p>No vendors are currently locked.</p></div>`;
    }
  } catch (err) {
    showToast(err.message || "Could not unlock this vendor.", "error");
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-unlock"></i> Unlock'; }
  }
}

function filterAdminVendorCards(){
  const host=byId('adminVendorCards');if(!host)return;
  const q=(byId('adminVendorSearch')?.value||'').toLowerCase(),alpha=byId('adminVendorSort')?.value==='alpha';
  [...host.querySelectorAll('.admin-vendor-card')].sort((a,b)=>alpha?a.dataset.name.localeCompare(b.dataset.name):Date.parse(b.dataset.created)-Date.parse(a.dataset.created)).forEach(card=>{card.classList.toggle('hidden',!card.dataset.search.includes(q));host.appendChild(card)});
}
async function viewVendorDoc(path) {
  const { data, error } = await sb.storage.from("vendor-docs").createSignedUrl(path, 300);
  if (error) { showToast(error.message, "error"); return; }
  window.open(data.signedUrl, "_blank");
}

// Deleting a vendor is restricted to this one super-admin account, even
// though other admins can be promoted later. The client-side check here is
// just so the button doesn't render for anyone else - the real enforcement
// is server-side, in admin_delete_vendor(), which checks the caller's email
// itself and can't be bypassed from the browser.
const SUPER_ADMIN_EMAIL = "kenniskalu18@gmail.com";

// Client-side password prompt for the two "hurts a vendor" admin actions
// (reject, pause). This is a fat-finger guard, not real security - anyone
// with admin access already passed real auth to get this far, and this
// password is visible to anyone who reads the page source.
/* Dangerous admin actions are verified against the currently signed-in admin password. */
// Shared password confirmation is retained only for other protected admin actions.
function promptPasswordConfirm(actionLabel, verify) {
  return new Promise((resolve) => {
    const modal = byId("adminPasswordModal");
    const input = byId("adminPasswordInput");
    const errorEl = byId("adminPasswordError");
    input.value = "";
    errorEl.classList.add("hidden");
    byId("adminPasswordModalMsg").textContent = `Confirm your password to ${actionLabel}.`;
    modal.classList.remove("hidden");
    setTimeout(() => input.focus(), 50);
    const okBtn = byId("adminPasswordOk");
    const cancelBtn = byId("adminPasswordCancel");
    const cleanup = (result) => {
      modal.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      input.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onOk = async () => {
      okBtn.disabled = true;
      const ok = await verify(input.value);
      okBtn.disabled = false;
      if (ok) cleanup(true);
      else { errorEl.classList.remove("hidden"); input.value = ""; input.focus(); }
    };
    const onCancel = () => cleanup(false);
    const onKey = (e) => {if(e.key==="Enter"){e.preventDefault();e.stopPropagation();if(!okBtn.disabled)onOk();}};
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    input.addEventListener("keydown", onKey);
  });
}
function promptAdminPassword(actionLabel) {
  return promptPasswordConfirm(actionLabel, async (v) => {
    const password = String(v || "");
    if (!session?.user?.id || !profile?.email || !password) return false;
    const { data, error } = await sb.auth.signInWithPassword({
      email: profile.email,
      password
    });
    return !error && !!data?.user && String(data.user.id) === String(session.user.id);
  });
}

// Immutable trail of the actions that actually affect a vendor's ability
// to trade - who did what, and when. Insert-only; nothing can edit or
// delete rows here (see the RLS policy), so it stays trustworthy.
async function logAdminAction(action, targetType, targetId, targetLabel) {
  await sb.from("admin_actions").insert({
    admin_id: session.user.id,
    admin_name: profile?.name || profile?.email || "Admin",
    action, target_type: targetType, target_id: targetId, target_label: targetLabel,
  });
}

// ---------------------------------------------------------------------
// CANONICAL vendor admin actions. This is the ONLY place these two
// functions are defined, do not add another window.setVendorStatus /
// window.adminDeleteVendor override anywhere else in this file. Both
// actions call the SECURITY DEFINER RPCs (admin_set_vendor_status /
// admin_delete_vendor) rather than writing to vendors/users directly,
// so they don't depend on the admin's session having raw table-write
// RLS access, only on being allowed to call the RPC, which is what
// public.is_admin() / the SUPER_ADMIN_EMAIL check already gate.
//
// Every action is split into two independent phases:
//   1) the database mutation (RPC call + response validation)
//   2) the UI refresh (toast + re-render/navigate)
// A failure in phase 2 is logged and surfaced as a "refresh" notice -
// it must never be reported to the admin as "approval failed" when the
// database mutation actually succeeded. See adminVendorActionBusy below
// for the per-vendor click guard.
// ---------------------------------------------------------------------

// Per-vendor-id busy set (not a single global flag): this blocks a
// double-click/double-tap on the SAME vendor row while its request is
// in flight, without blocking the admin from working on a different
// vendor at the same time, and without any risk of a stuck global lock.
const adminVendorActionBusy = new Set();

function vendorActionLog(action, vendorId, extra) {
  console.log("[ADMIN VENDOR ACTION]", { action, vendorId, ...extra });
}

async function setVendorStatus(id, status, filterStatus, businessName) {
  if (adminVendorActionBusy.has(id)) return;

  if (!session?.user?.id || profile?.role !== "admin") {
    showToast("Admin access is required.", "error");
    return;
  }

  // Always resolve the vendor first. This avoids fragile inline strings and
  // also gives the confirmation dialog the real business name.
  const { data: targetVendor, error: targetVendorError } = await sb
    .from("vendors")
    .select("id,user_id,business_name,verification_status,is_active,avg_rating,review_count")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (targetVendorError || !targetVendor) {
    showToast(targetVendorError?.message || "Vendor application not found.", "error");
    return;
  }

  businessName = targetVendor.business_name || businessName || "this vendor";

  if (status === "verified") {
    if (!(await showConfirmDialog(
      `Approve "${businessName}" as a vendor? Their storefront will become visible to customers immediately.`,
      { title: "Approve vendor", okLabel: "Approve" }
    ))) return;
  }

  if (status === "rejected") {
    const reason = window.promptVendorRejectionReason ? await window.promptVendorRejectionReason(businessName) : null;
    if (reason === null) return;
    window.__pendingVendorRejectionReason = reason;
  }

  adminVendorActionBusy.add(id);
  const actionWord = status === "verified" ? "approve" : status === "rejected" ? "reject" : "update";
  let mutationSucceeded = false;

  try {
    // Confirm the RPC will run as the admin we think is signed in, a
    // stale/expired client-side session object is a classic cause of
    // "this worked for the first couple of vendors, then stopped".
    const { data: { session: liveSession } = {} } = await sb.auth.getSession();
    if (!liveSession?.user?.id) {
      showToast("Your admin session has expired. Please sign in again and retry.", "error");
      vendorActionLog(actionWord, id, { stage: "auth", reason: "no live session" });
      return;
    }

    vendorActionLog(actionWord, id, { stage: "rpc:start", authUserId: liveSession.user.id });
    const { data, error } = await sb.rpc("admin_set_vendor_status", {
      p_vendor_id: id,
      p_status: status,
    });

    if (error) {
      // Actual database/RPC failure, this is a real "could not X" case.
      vendorActionLog(actionWord, id, {
        stage: "rpc:error",
        message: error.message, code: error.code, details: error.details, hint: error.hint,
      });
      showToast(`Could not ${actionWord} this vendor: ${error.message}`, "error");
      return;
    }

    // RPC returned without error, but don't assume that means the
    // expected mutation happened. Validate the response shape/content.
    const returnedVendor = data?.vendor ?? data;
    const returnedStatus = returnedVendor?.verification_status;
    const responseLooksValid = data && (data.success === true || data.success === undefined) &&
      (returnedStatus === undefined || String(returnedStatus) === String(status));

    if (!responseLooksValid) {
      vendorActionLog(actionWord, id, { stage: "rpc:unexpected-response", rpcData: data });
      showToast(
        `The ${actionWord} request completed but returned an unexpected result. Please check this vendor's status before retrying.`,
        "error"
      );
      return;
    }

    vendorActionLog(actionWord, id, { stage: "rpc:success", rpcData: data });
    mutationSucceeded = true;
    try { await logAdminAction(status === "verified" ? "approve_vendor" : "reject_vendor", "vendor", id, businessName); }
    catch (e) { console.warn("Admin action log failed:", e); }
  } finally {
    adminVendorActionBusy.delete(id);
  }

  if (!mutationSucceeded) return;

  // Phase 2: UI refresh. The database mutation above already succeeded,
  // so from here on we tell the admin it succeeded no matter what
  // happens to the re-render/navigation.
  showToast(
    status === "verified"
      ? `${businessName} approved successfully.`
      : status === "rejected"
        ? `${businessName} rejected.`
        : `${businessName} updated.`,
    "success"
  );

  try {
    vendorActionLog(actionWord, id, { stage: "ui-refresh:start" });
    await navigate("adminPanel", { status: filterStatus || "pending" }, { replace: true });
    vendorActionLog(actionWord, id, { stage: "ui-refresh:done" });
  } catch (uiError) {
    console.error("[Levromart] Vendor list refresh failed after a successful update:", uiError);
    showToast(`${businessName} was ${status === "rejected" ? "rejected" : "updated"}, but the list could not refresh automatically. Pull to refresh.`, "info");
  }
}

async function adminDeleteVendor(vendorId, filterStatus, businessName) {
  if (adminVendorActionBusy.has(vendorId)) return;
  if (profile?.email !== SUPER_ADMIN_EMAIL) return;
  adminVendorActionBusy.add(vendorId);
  try {

  if (!businessName) {
    const { data: target } = await sb.from("vendors").select("business_name").eq("id", vendorId).maybeSingle();
    businessName = target?.business_name || "this vendor";
  }
  if (!(await showConfirmDialog(
    `Permanently delete "${businessName}"? Their storefront and all listings are pulled immediately, they're demoted back to an ordinary buyer account, and this stops showing on your dashboard. Past orders and reviews stay on record for buyers.`,
    { title: "Delete vendor", okLabel: "Delete vendor", danger: true }
  ))) return;
  let mutationSucceeded = false;

  try {
    const { data: { session: liveSession } = {} } = await sb.auth.getSession();
    if (!liveSession?.user?.id) {
      showToast("Your admin session has expired. Please sign in again and retry.", "error");
      vendorActionLog("delete", vendorId, { stage: "auth", reason: "no live session" });
      return;
    }

    vendorActionLog("delete", vendorId, { stage: "rpc:start" });
    const { data, error } = await sb.rpc("admin_delete_vendor", { p_vendor_id: vendorId });

    if (error) {
      vendorActionLog("delete", vendorId, {
        stage: "rpc:error",
        message: error.message, code: error.code, details: error.details, hint: error.hint,
      });
      showToast(error.message || "Could not delete this vendor.", "error");
      return;
    }

    if (!data || data.deleted !== true) {
      vendorActionLog("delete", vendorId, { stage: "rpc:unexpected-response", rpcData: data });
      showToast("The delete request completed but returned an unexpected result. Please check this vendor before retrying.", "error");
      return;
    }

    vendorActionLog("delete", vendorId, { stage: "rpc:success", rpcData: data });
    mutationSucceeded = true;
    try { await logAdminAction("delete_vendor", "vendor", vendorId, businessName); }
    catch (e) { console.warn("Admin action log failed:", e); }
  } catch(err){showToast(err.message||"Could not delete this vendor.","error");}

  if (!mutationSucceeded) return;

  invalidateMarketplaceState();
  showToast("Vendor deleted and demoted to a customer.", "success");
  try {
    vendorActionLog("delete", vendorId, { stage: "ui-refresh:start" });
    await navigate("adminPanel", { status: filterStatus });
    vendorActionLog("delete", vendorId, { stage: "ui-refresh:done" });
  } catch (uiError) {
    console.error("[Levromart] Vendor list refresh failed after a successful delete:", uiError);
    showToast(`${businessName} was deleted, but the list could not refresh automatically. Pull to refresh.`, "info");
  }
  } finally {adminVendorActionBusy.delete(vendorId);}

}

async function adminToggleVendorActive(vendorId, currentlyActive, businessName) {
  // Pause / unpause at will: no password, no confirmation. The row updates in place.
  const action = currentlyActive ? "pause" : "unlock";
  const btn = document.querySelector(`.fin-row[data-vendor-id="${CSS.escape(String(vendorId))}"] .fin-icbtn`);
  if (btn) btn.disabled = true;
  try {
    const {data,error}=await sb.rpc("admin_set_vendor_storefront_active",{p_vendor_id:vendorId,p_active:!currentlyActive});
    if(error) throw error; if(!data?.success) throw new Error("The storefront status change did not complete.");
    showToast(currentlyActive?`${businessName||"Storefront"} paused.`:`${businessName||"Storefront"} is live again.`,"success");
    await refreshAdminFinanceVendors();
  } catch(err) { console.error("[Levromart] Admin storefront action failed:",err); showToast(err?.message||`Could not ${action} this vendor.`,"error"); if (btn) btn.disabled = false; }
}

// Paused stores first, then vendors who owe (soonest / most overdue due date first), then everyone else A-Z.
function finSortVendors(list) {
  const t = (v) => v.commission_due_at ? new Date(v.commission_due_at).getTime() : Infinity;
  const rank = (v) => !v.is_active ? 0 : Number(v.commission_owed || 0) > 0 ? 1 : 2;
  return (list || []).slice().sort((x, y) => rank(x) - rank(y) || (rank(x) < 2 ? (t(x) - t(y) || Number(y.commission_owed || 0) - Number(x.commission_owed || 0)) : 0) || String(x.business_name || "").localeCompare(String(y.business_name || ""), undefined, { sensitivity: "base" }));
}
window.__finOpen = window.__finOpen || new Set();
window.__finDetail = window.__finDetail || new Map();
function finWaLink(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "234" + d.slice(1);
  else if (d.length === 10) d = "234" + d;
  return "https://wa.me/" + d;
}
function finDetailHtml(vid) {
  const d = window.__finDetail.get(String(vid));
  if (!d) return `<div class="fin-detail-body muted"><i class="fa-solid fa-spinner fa-spin"></i> Loading details…</div>`;
  if (d.error) return `<div class="fin-detail-body muted">Couldn't load details.</div>`;
  const line = (icon, label, val) => val ? `<div class="fin-dl" title="${label}"><i class="fa-solid ${icon}"></i><span>${val}</span></div>` : "";
  const wa = (num) => { const l = finWaLink(num); return l ? `<a class="fin-wa" href="${l}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> ${esc(num)}</a>` : ""; };
  const phone = d.phone ? wa(d.phone) : "", wnum = d.whatsapp_number && String(d.whatsapp_number).replace(/\D/g, "") !== String(d.phone || "").replace(/\D/g, "") ? wa(d.whatsapp_number) : "";
  const ownerPhone = d.owner_phone && ![d.phone, d.whatsapp_number].some((x) => String(x || "").replace(/\D/g, "") === String(d.owner_phone).replace(/\D/g, "")) ? wa(d.owner_phone) : "";
  const bank = d.account_number ? `${esc(d.bank_name || "Bank")} · ${esc(d.account_number)}${d.account_name ? ` · ${esc(d.account_name)}` : ""}` : "";
  const joined = d.created_at ? new Date(d.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "";
  return `<div class="fin-detail-body">
    ${line("fa-user", "Owner", esc(d.owner_name || ""))}
    ${line("fa-phone", "Phone", phone)}
    ${line("fa-phone", "WhatsApp", wnum)}
    ${line("fa-mobile-screen", "Owner phone", ownerPhone)}
    ${line("fa-envelope", "Email", d.owner_email ? `<a href="mailto:${esc(d.owner_email)}">${esc(d.owner_email)}</a>` : "")}
    ${line("fa-location-dot", "Address", esc([d.address, d.city].filter(Boolean).join(", ")))}
    ${line("fa-building-columns", "Bank", bank)}
    ${line("fa-calendar", "Joined", esc(joined))}
    ${d.sv ? finSvHtml(vid, d.sv) : `<div class="fin-dl"><i class="fa-solid fa-user-graduate"></i><span class="muted">No student verification submitted</span></div>`}
  </div>`;
}
function finSvHtml(vid, sv) {
  const st = { pending: "Pending review", approved: "Approved", rejected: "Rejected" }[sv.status] || sv.status;
  const imgs = [sv.id_card_url, sv.biodata_url, sv.selfie_url].filter(Boolean);
  window.__reqPhotoSets = window.__reqPhotoSets || []; const k = window.__reqPhotoSets.push(imgs) - 1;
  return `<div class="fin-sv"><b><i class="fa-solid fa-user-graduate"></i> Student verification · ${esc(st)}</b>
    <div class="row"><b>Matric</b><span>${esc(sv.matric_number || "")}</span></div>
    <div class="row"><b>Faculty</b><span>${esc(sv.faculty || "")}</span></div>
    <div class="row"><b>Department</b><span>${esc(sv.department || "")}</span></div>
    <div class="row"><b>Level</b><span>${esc(sv.level || "")}</span></div>
    <div class="row"><b>Face check</b><span>${sv.selfie_url ? (typeof window.lvFaceStatusHtml === "function" ? window.lvFaceStatusHtml(sv) : "Selfie sent") + (sv.face_distance != null ? ` <small class="muted">(distance ${Number(sv.face_distance).toFixed(2)}${sv.face_liveness ? ", blink seen" : ", no blink"})</small>` : "") : '<span class="muted">Not done yet</span>'}</span></div>
    <div class="row"><b>ID text read</b><span>${sv.ocr_checked_at ? `Matric ${sv.ocr_matric_found === true ? "✓ found" : sv.ocr_matric_found === false ? "✗ not found" : "–"} · Name ${sv.ocr_name_found === true ? "✓ found" : sv.ocr_name_found === false ? "✗ not found" : "–"}` : '<span class="muted">Not read yet</span>'}</span></div>
    <div class="req-ph-row">${imgs.map((u, i) => `<button type="button" class="req-ph-thumb" onclick="event.stopPropagation();reqPhotoOpen(${k},${i})"><img src="${esc(u)}" alt="Document"></button>`).join("")}</div>
    ${sv.status === "approved" ? "" : `<textarea id="svNote-${esc(vid)}" placeholder="Note to the vendor (optional)"></textarea>`}
    <div class="acts">${sv.status !== "approved" ? `<button type="button" class="btn btn-sm" onclick="event.stopPropagation();finReviewSv('${esc(vid)}','approved')"><i class="fa-solid fa-check"></i> Approve</button>` : ""}${sv.status !== "rejected" ? `<button type="button" class="btn btn-sm btn-outline" onclick="event.stopPropagation();finReviewSv('${esc(vid)}','rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>` : ""}</div></div>`;
}
async function finReviewSv(vid, status) {
  const note = document.getElementById("svNote-" + vid)?.value?.trim() || null;
  const { error } = await sb.rpc("admin_review_student_verification", { p_vendor_id: vid, p_status: status, p_note: note });
  if (error) { showToast(error.message || "Couldn't save the review.", "error"); return; }
  showToast(status === "approved" ? "Student verified." : "Marked as rejected.", "success");
  window.__finDetail.delete(String(vid)); finLoadDetail(vid);
}
async function finLoadDetail(vid) {
  if (window.__finDetail.has(String(vid))) return;
  try {
    const { data: v, error } = await sb.from("vendors").select("user_id,phone,whatsapp_number,address,city,bank_name,account_number,account_name,created_at").eq("id", vid).maybeSingle();
    if (error || !v) throw error || new Error("none");
    let u = null;
    if (v.user_id) { const r = await sb.from("users").select("name,email,phone").eq("id", v.user_id).maybeSingle(); u = r.data; }
    let sv = null; try { const r2 = await sb.from("vendor_student_verification").select("*").eq("vendor_id", vid).maybeSingle(); sv = r2.data || null; } catch (_) {}
    window.__finDetail.set(String(vid), { ...v, sv, owner_name: u?.name || "", owner_email: u?.email || "", owner_phone: u?.phone || "" });
  } catch (_) { window.__finDetail.set(String(vid), { error: true }); setTimeout(() => window.__finDetail.delete(String(vid)), 4000); }
  const holder = document.querySelector(`.fin-row[data-vendor-id="${CSS.escape(String(vid))}"] .fin-detail`);
  if (holder) holder.innerHTML = finDetailHtml(vid);
}
function finToggleRow(row, ev) {
  if (ev && ev.target.closest("a,button")) return;
  const vid = row.dataset.vendorId, open = !row.classList.contains("open");
  row.classList.toggle("open", open);
  if (open) { window.__finOpen.add(vid); row.querySelector(".fin-detail").innerHTML = finDetailHtml(vid); finLoadDetail(vid); } else window.__finOpen.delete(vid);
}

// One vendor row of the finance page: icons instead of words, neutral colours, red/amber only for things that need attention.
function finVendorRowHtml(v, seesFinancials) {
  const owed = Number(v.commission_owed || 0);
  const live = !!v.is_active;
  const ver = v.verification_status === "verified" ? "" : v.verification_status === "rejected" ? `<i class="fa-solid fa-circle-xmark fin-ico bad" title="Rejected"></i>` : `<i class="fa-solid fa-clock fin-ico warn" title="Pending verification"></i>`;
  const bank = v.paystack_subaccount_code ? `<i class="fa-solid fa-building-columns fin-ico ok" title="Payouts set up"></i>` : `<i class="fa-solid fa-building-columns fin-ico warn" title="Payouts not set up"></i>`;
  const state = live ? "" : `<i class="fa-solid fa-circle-pause fin-ico bad" title="Paused"></i>`;
  const due = v.commission_due_at ? new Date(v.commission_due_at).toLocaleDateString("en-NG", {day:"numeric",month:"short",year:"numeric"}) : "";
  const dr = Number(v.commission_days_remaining);
  const dueTxt = owed > 0 && due ? (dr < 0 ? `<span class="fin-due bad"><i class="fa-regular fa-clock"></i> ${Math.abs(dr)}d overdue · due ${esc(due)}</span>` : `<span class="fin-due ${dr <= 2 ? "warn" : ""}"><i class="fa-regular fa-clock"></i> ${dr}d left · due ${esc(due)}</span>`) : "";
  const label = esc(v.business_name).replace(/'/g, "&#39;");
  const btn = !seesFinancials ? "" : live
    ? `<button type="button" class="fin-icbtn" title="Pause storefront" aria-label="Pause storefront" onclick="adminToggleVendorActive('${v.vendor_id}', true, '${label}')"><i class="fa-solid fa-pause"></i></button>`
    : `<button type="button" class="fin-icbtn go" title="${owed > 0 ? "Unlock storefront" : "Reactivate storefront"}" aria-label="Unlock storefront" onclick="adminToggleVendorActive('${v.vendor_id}', false, '${label}')"><i class="fa-solid fa-play"></i></button>`;
  const isOpen = window.__finOpen.has(String(v.vendor_id));
  return `<div class="fin-row ${isOpen ? "open" : ""}" data-vendor-id="${esc(v.vendor_id)}" onclick="finToggleRow(this,event)">
      <div class="fin-row-top">
        <span class="fin-nm"><strong class="fin-name">${esc(v.business_name)}</strong>${bank}${ver}${state}</span>
        <span class="fin-action">${btn}</span>
      </div>
      ${seesFinancials ? `<div class="fin-meta fin-grid">
        <span title="Commission rate"><i class="fa-solid fa-percent"></i>${Number(v.commission_pct)}</span>
        <span title="Completed orders"><i class="fa-solid fa-bag-shopping"></i>${v.completed_orders}</span>
        <span title="Collected"><i class="fa-solid fa-wallet"></i>${naira(v.total_paid_in)}</span>
        <span class="${owed > 0 ? "owed" : ""}" title="Commission owed"><i class="fa-solid fa-hourglass-half"></i>${naira(owed)}</span>
      </div>${dueTxt ? `<div class="fin-meta">${dueTxt}</div>` : ""}` : ""}
      ${seesFinancials ? `<div class="fin-detail">${isOpen ? finDetailHtml(v.vendor_id) : ""}</div>` : ""}
    </div>`;
}
async function refreshAdminFinanceVendors() {
  if (currentView !== "adminFinance" || !isSuperAdmin()) return;
  const wrap = document.querySelector(".fin-list.financeVendorsTableWrap");
  if (!wrap) return;
  const { data: vendors, error } = await sb.rpc("admin_list_vendor_payouts");
  if (error || !Array.isArray(vendors)) return;
  const sig = JSON.stringify(vendors.map((v) => [v.vendor_id, v.is_active, v.commission_owed, v.verification_status, !!v.paystack_subaccount_code]));
  if (wrap.dataset.sig === sig) return;
  wrap.dataset.sig = sig;
  if (__adminFinanceData) __adminFinanceData.vendors = vendors;
  wrap.innerHTML = finSortVendors(vendors).map((v) => finVendorRowHtml(v, true)).join("");
  window.__finOpen.forEach((id) => finLoadDetail(id));
  const q = wrap.parentElement?.querySelector('input[type="text"]')?.value;
  if (q) wrap.parentElement.querySelector('input[type="text"]').dispatchEvent(new Event("input"));
  const chips = document.querySelector(".fin-chips");
  if (chips) {
    const owing = vendors.filter((v) => Number(v.commission_owed || 0) > 0).length, over = vendors.filter((v) => v.commission_status === "overdue").length, soon = vendors.filter((v) => v.commission_status === "due_soon").length;
    chips.innerHTML = `<div class="fin-chip"><b>${owing}</b><span>Owing</span></div><div class="fin-chip ${over ? "bad" : ""}"><b>${over}</b><span>Overdue</span></div><div class="fin-chip ${soon ? "warn" : ""}"><b>${soon}</b><span>Due in 48h</span></div>`;
  }
}
// keeps the Live / Paused icons current while the admin has this page open (a vendor being paused shows up within seconds)
setInterval(() => { if (!document.hidden && currentView === "adminFinance") refreshAdminFinanceVendors().catch(() => {}); }, 8000);

