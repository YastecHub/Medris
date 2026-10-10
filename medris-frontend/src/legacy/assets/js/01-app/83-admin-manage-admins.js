// ---------- ADMIN: MANAGE ADMINS ----------
// A plain directory of every registered account - separate from "Admins"
// below, which is only for promoting/demoting admin access. This is just
// for seeing who's actually on the platform and how many of each kind.
async function renderAdminPeople() {
  if (!session || !isSuperAdmin()) return '<div class="empty-state">Access denied.</div>';
  const result = window.__adminPeopleLoadedData;
  if (result) return renderAdminPeopleFromData(result.people || [], result.appeals || []);

  // The route renderer is allowed to be synchronous, so render a loading shell
  // immediately and hydrate it once the two admin queries finish.
  setTimeout(async () => {
    try {
      const [{ data: people, error: peopleError }, { data: appeals, error: appealsError }] = await Promise.all([
        sb.from("users").select("id, name, email, phone, role, city, created_at, suspended_at, suspended_reason").order("created_at", { ascending: false }),
        sb.rpc("admin_get_pending_appeals"),
      ]);
      if (peopleError) throw peopleError;
      // Deleted/anonymized accounts are intentionally not part of the live People directory.
      const livePeople = (people || []).filter((p) => String(p.name || "").trim().toLowerCase() !== "deleted user" && !String(p.email || "").toLowerCase().startsWith("deleted-"));
      window.__adminPeopleLoadedData = { people: livePeople, appeals: appeals || [] };
      const app = byId("app");
      if (app && currentView === "adminPeople") app.innerHTML = renderAdminPeopleFromData(people || [], appeals || []);
    } catch (err) {
      const app = byId("app");
      if (app && currentView === "adminPeople") app.innerHTML = `<div class="empty-state">${errorStateHtml(err)}</div>`;
    }
  }, 0);
  return `<div class="admin-people-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading people…</div>`;
}

function renderAdminPeopleFromData(people, appeals) {
  // Keep anonymized/deleted accounts out of the live People directory even
  // when this renderer is called with cached data from an earlier navigation.
  people = (people || []).filter((p) => String(p.name || "").trim().toLowerCase() !== "deleted user" && !String(p.email || "").toLowerCase().startsWith("deleted-"));
  const counts = { buyer: 0, vendor: 0, admin: 0 };
  (people || []).forEach((p) => { if (counts[p.role] != null) counts[p.role]++; });
  const appealByUser = {};
  (appeals || []).forEach((a) => { appealByUser[a.user_id] = a; });
  window.__adminPeopleAll = people || [];
  window.__adminPeopleRole = ["buyer", "vendor"].includes(window.__adminPeopleRole) ? window.__adminPeopleRole : "buyer";
  window.__adminPeopleSort = ["newest","oldest","az","za"].includes(window.__adminPeopleSort) ? window.__adminPeopleSort : "newest";

  let html = `<h2><i class='fa-solid fa-users'></i> People on Levromart</h2>`;
  html += adminNavHtml("adminPeople");
  html += `<section class="admin-people-toolbar">
    <div class="admin-people-role-tabs" role="tablist" aria-label="People type">
      <button type="button" class="admin-people-role-tab ${window.__adminPeopleRole === "buyer" ? "active" : ""}" data-role="buyer" onclick="setAdminPeopleRole('buyer')"><i class="fa-solid fa-user"></i><span>Buyers</span><strong>${counts.buyer}</strong></button>
      <button type="button" class="admin-people-role-tab ${window.__adminPeopleRole === "vendor" ? "active" : ""}" data-role="vendor" onclick="setAdminPeopleRole('vendor')"><i class="fa-solid fa-store"></i><span>Vendors</span><strong>${counts.vendor}</strong></button>
    </div>
    <div class="admin-people-export-actions">
      <button type="button" class="btn btn-sm btn-outline" onclick="adminExportPeople(window.__adminPeopleRole,'csv')"><i class="fa-solid fa-file-csv"></i> CSV</button>
      <button type="button" class="btn btn-sm" onclick="adminExportPeople(window.__adminPeopleRole,'pdf')"><i class="fa-solid fa-file-pdf"></i> PDF</button>
    </div>
  </section>
  <div class="admin-people-controls">
    <div class="admin-people-search-wrap"><i class="fa-solid fa-magnifying-glass"></i><input type="search" id="adminPeopleSearch" placeholder="Search by name or email…" oninput="filterAdminPeople()" /></div>
    <label class="admin-people-sort"><span>Sort</span><select id="adminPeopleSort" onchange="setAdminPeopleSort(this.value)"><option value="newest" ${window.__adminPeopleSort === "newest" ? "selected" : ""}>Newest signups</option><option value="oldest" ${window.__adminPeopleSort === "oldest" ? "selected" : ""}>Oldest signups</option><option value="az" ${window.__adminPeopleSort === "az" ? "selected" : ""}>A–Z</option><option value="za" ${window.__adminPeopleSort === "za" ? "selected" : ""}>Z–A</option></select></label>
  </div>`;
  html += `<div class="accordion-section admin-people-summary" style="max-width:560px;margin:0 auto 1rem;">
    <button class="accordion-trigger" onclick="toggleAccordion(this)"><span><i class="fa-solid fa-chart-simple"></i> Summary</span><i class="fa-solid fa-chevron-down accordion-chevron"></i></button>
    <div class="accordion-body"><table class="order-stats-table"><tr><td>Total accounts</td><td>${people.length}</td></tr><tr><td>Buyers</td><td>${counts.buyer}</td></tr><tr><td>Vendors</td><td>${counts.vendor}</td></tr><tr><td>Admins</td><td>${counts.admin}</td></tr></table></div>
  </div>`;
  if (appeals?.length) {
    html += `<div class="accordion-section open" id="appealsAccordion" style="max-width:600px;margin:0 auto 1rem;border-color:var(--warning);"><button class="accordion-trigger" onclick="toggleAccordion(this)"><span><i class="fa-solid fa-flag"></i> Suspension appeals awaiting review (${appeals.length})</span><i class="fa-solid fa-chevron-down accordion-chevron"></i></button><div class="accordion-body">${appeals.map((a) => `<div style="border-top:1px solid var(--border);padding:.6rem 0;"><strong>${esc(a.user_name || a.user_email)}</strong><p class="muted" style="margin:.2rem 0;font-size:.82rem;">Suspended for: ${esc(a.suspension_reason || "")}</p><p style="margin:.3rem 0;">${esc(a.message)}</p><div class="flex" style="gap:.5rem;"><button class="btn btn-sm" onclick="approveAppeal('${a.user_id}')"><i class="fa-solid fa-check"></i> Approve &amp; unsuspend</button><button class="btn btn-sm btn-outline" onclick="denyAppealPrompt('${a.id}')"><i class="fa-solid fa-xmark"></i> Deny</button></div></div>`).join("")}</div></div>`;
  }
  html += `<div class="admin-people-table-xscroll"><table class="data-table admin-people-table" id="adminPeopleTable"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>City</th><th>Phone</th><th>Joined</th><th>Status</th><th>Action</th></tr></thead><tbody></tbody></table></div>`;
  html += `<p class="muted admin-people-hint"><i class="fa-solid fa-arrows-up-down-left-right"></i> Scroll the table vertically for more people and horizontally for wider columns.</p>`;
  setTimeout(() => renderAdminPeopleRows(), 0);
  return html;
}

function getAdminPeopleFilteredRows() {
  const role = window.__adminPeopleRole || "buyer";
  const q = (byId("adminPeopleSearch")?.value || "").trim().toLowerCase();
  const sort = window.__adminPeopleSort || "newest";
  let rows = (window.__adminPeopleAll || []).filter((p) => p.role === role);
  if (q) rows = rows.filter((p) => `${p.name || ""} ${p.email || ""} ${p.city || ""}`.toLowerCase().includes(q));
  rows.sort((a,b) => {
    if (sort === "newest" || sort === "oldest") {
      const at = new Date(a.created_at || 0).getTime(), bt = new Date(b.created_at || 0).getTime();
      return sort === "newest" ? bt - at : at - bt;
    }
    const aa = String(a.name || a.email || "").toLocaleLowerCase();
    const bb = String(b.name || b.email || "").toLocaleLowerCase();
    const cmp = aa.localeCompare(bb, undefined, { sensitivity: "base" });
    return sort === "za" ? -cmp : cmp;
  });
  return rows;
}

function renderAdminPeopleRows() {
  const tbody = byId("adminPeopleTable")?.querySelector("tbody");
  if (!tbody) return;
  const rows = getAdminPeopleFilteredRows();
  tbody.innerHTML = rows.map((p, idx) => `<tr>
    <td>${idx + 1}</td><td>${esc(p.name || "-")}</td><td>${esc(p.email || "-")}</td><td>${esc(p.city || "-")}</td><td>${p.phone ? `<button type="button" class="admin-phone-btn" onclick="openAdminPhoneActions(event,'${esc(p.phone)}','${esc(p.name || p.email || "User")}')"><i class="fa-solid fa-phone"></i> ${esc(p.phone)}</button>` : "-"}</td>
    <td>${p.created_at ? `<span class="admin-joined-cell">${new Date(p.created_at).toLocaleString("en-GB", {day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</span>${Date.now()-new Date(p.created_at).getTime() <= 48*60*60*1000 ? ` <span class="badge admin-new-tag">NEW</span>` : ""}` : "-"}</td>
    <td>${p.suspended_at ? `<span class="badge danger" title="${esc(p.suspended_reason || "")}">Suspended</span>` : `<span class="badge success">Active</span>`}</td>
    <td>${p.role === "admin" ? "" : p.suspended_at ? `<button class="btn btn-sm btn-outline" onclick="unsuspendUser('${p.id}','${esc(p.name || p.email)}')">Unsuspend</button>` : `<button class="btn btn-sm btn-danger" onclick="suspendUserPrompt('${p.id}','${esc(p.name || p.email)}')">Suspend</button>`}</td>
  </tr>`).join("") || `<tr><td colspan="8" class="muted" style="text-align:center;padding:1.2rem;">No ${window.__adminPeopleRole === "vendor" ? "vendors" : "buyers"} match your search.</td></tr>`;
}

function setAdminPeopleRole(role) {
  window.__adminPeopleRole = role === "vendor" ? "vendor" : "buyer";
  document.querySelectorAll(".admin-people-role-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.role === window.__adminPeopleRole));
  renderAdminPeopleRows();
}
function setAdminPeopleSort(sort) {
  window.__adminPeopleSort = ["newest","oldest","az","za"].includes(sort) ? sort : "newest";
  renderAdminPeopleRows();
}
function filterAdminPeople() { renderAdminPeopleRows(); }

function adminCsvEscape(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
function adminPeopleRowsForExport(role) {
  return (window.__adminPeopleAll || []).filter((p) => p.role === role).slice().sort((a,b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), undefined, {sensitivity:"base"}));
}
async function adminExportPeople(role, format) {
  const people = adminPeopleRowsForExport(role);
  const label = role === "vendor" ? "vendors" : "buyers";
  if (!people.length) { showToast(`No ${label} to export.`, "info"); return; }
  const joined = (p) => p.created_at ? new Date(p.created_at).toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "-";
  // Every column of the People table, phone numbers included.
  const head = ["#","Name","Email","Phone","City","Role","Joined","Status"];
  const rows = people.map((p,i) => [i+1,p.name||"-",p.email||"-",p.phone||"-",p.city||"-",p.role||"-",joined(p),p.suspended_at ? "Suspended" : "Active"]);
  if (format === "csv") {
    const csv = [head, ...rows].map(r => r.map(adminCsvEscape).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff",csv], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`levromart-${label}-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    showToast(`${label[0].toUpperCase()+label.slice(1)} CSV downloaded.`, "success"); return;
  }
  try {
    const jsPDF = await ensureAdminJsPdf();
    const doc = new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});
    // Real (selectable) PDF text, so names, emails and phone numbers can be copied.
    // Long values wrap instead of being cut off; the standard PDF font only covers
    // Latin characters, so anything outside that range is dropped from the PDF copy.
    const clean = (v) => String(v ?? "").replace(/[^\u0020-\u00FF]/g, "").trim() || "-";
    const margin = 10, pageH = 210, lineH = 4.2, cols = [9, 46, 66, 30, 30, 16, 36, 22];
    const title = label[0].toUpperCase() + label.slice(1);
    let y = 16;
    const drawHeader = () => {
      doc.setFont(undefined, "bold"); doc.setFontSize(14); doc.text(`Levromart - ${title} (${people.length})`, margin, y); y += 6;
      doc.setFont(undefined, "normal"); doc.setFontSize(8); doc.text(`Downloaded ${new Date().toLocaleString("en-GB")}`, margin, y); y += 7;
      doc.setFont(undefined, "bold"); doc.setFontSize(8);
      let x = margin; head.forEach((h, i) => { doc.text(h, x, y); x += cols[i]; });
      y += 2; doc.setDrawColor(150); doc.line(margin, y, margin + cols.reduce((a, c) => a + c, 0), y); y += 4.5;
      doc.setFont(undefined, "normal");
    };
    drawHeader();
    doc.setFontSize(8);
    rows.forEach((r) => {
      const cells = r.map((v, i) => doc.splitTextToSize(clean(v), cols[i] - 2));
      const h = Math.max(...cells.map((c) => c.length)) * lineH;
      if (y + h > pageH - 10) { doc.addPage(); y = 16; drawHeader(); doc.setFontSize(8); }
      let x = margin;
      cells.forEach((lines, i) => { doc.text(lines, x, y); x += cols[i]; });
      y += h + 1.6;
      doc.setDrawColor(225); doc.line(margin, y - 1.2, margin + cols.reduce((a, c) => a + c, 0), y - 1.2);
    });
    doc.save(`levromart-${label}-${new Date().toISOString().slice(0,10)}.pdf`); showToast(`${title} PDF downloaded.`, "success");
  } catch(err) { showToast(err?.message || "Could not create PDF.", "error"); }
}
async function ensureAdminJsPdf() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  await new Promise((resolve,reject)=>{ const script=document.createElement("script"); script.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"; script.onload=resolve; script.onerror=()=>reject(new Error("PDF library could not be loaded. Check your connection and try again.")); document.head.appendChild(script); });
  if (!window.jspdf?.jsPDF) throw new Error("PDF library unavailable.");
  return window.jspdf.jsPDF;
}

async function suspendUserPrompt(userId, name) {
  const reason = await showTextPromptDialog(`Suspend ${name}`, "This reason is sent to the user as their suspension notice, so make it clear.", { placeholder: "Reason for suspension…", okLabel: "Suspend", danger: true });
  if (reason === null) return;
  if (!reason.trim()) { showToast("A reason is required.", "error"); return; }
  const { error } = await sb.rpc("admin_suspend_user", { p_user_id: userId, p_reason: reason.trim() });
  if (error) { showToast(error.message, "error"); return; }
  showToast(`${name} suspended and notified.`, "success");
  navigate("adminPeople");
}
async function unsuspendUser(userId, name) {
  if (!(await showConfirmDialog(`Lift the suspension on ${name}?`, { title: "Unsuspend", okLabel: "Unsuspend" }))) return;
  const { error } = await sb.rpc("admin_unsuspend_user", { p_user_id: userId });
  if (error) { showToast(error.message, "error"); return; }
  showToast(`${name} unsuspended.`, "success");
  navigate("adminPeople");
}
async function approveAppeal(userId) {
  if (!(await showConfirmDialog("Approve this appeal and unsuspend the account?", { title: "Approve appeal", okLabel: "Approve" }))) return;
  const { error } = await sb.rpc("admin_unsuspend_user", { p_user_id: userId });
  if (error) { showToast(error.message, "error"); return; }
  showToast("Appeal approved, account unsuspended.", "success");
  navigate("adminPeople");
}
async function denyAppealPrompt(appealId) {
  const response = await showTextPromptDialog("Deny appeal", "This reason is sent to the user, so explain why.", { placeholder: "Reason for denying…", okLabel: "Deny appeal", danger: true });
  if (response === null) return;
  if (!response.trim()) { showToast("A reason is required.", "error"); return; }
  const { error } = await sb.rpc("admin_deny_appeal", { p_appeal_id: appealId, p_response: response.trim() });
  if (error) { showToast(error.message, "error"); return; }
  showToast("Appeal denied.", "success");
  navigate("adminPeople");
}
function suggestionRowHtml(s) {
  return `<div class="ad-row ad-static ${s.status === "new" ? "is-new" : ""}">
    <div class="flex" style="justify-content:space-between;align-items:flex-start;">
      <div>
        <strong>${s.is_anonymous ? "Anonymous" : esc(s.sender_name || "Someone")}</strong>
        <span class="muted" style="font-size:0.78rem;margin-left:0.4rem;">${new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
      </div>
      ${s.status === "new" ? `<button class="btn btn-sm btn-outline" onclick="markSuggestionRead('${s.id}', this)">Mark read</button>` : `<span class="badge">read</span>`}
    </div>
    <p style="margin:0.5rem 0 0;">${esc(s.message)}</p>
  </div>`;
}
async function markSuggestionRead(id, btn) {
  btn.disabled = true;
  const { error } = await sb.rpc("mark_suggestion_read", { p_suggestion_id: id });
  if (error) { showToast(error.message, "error"); btn.disabled = false; return; }
  btn.closest(".ad-row,.card")?.classList.remove("is-new");
  btn.outerHTML = `<span class="badge">read</span>`;
  unreadSuggestionCount = Math.max(0, Number(unreadSuggestionCount || 0) - 1);
  document.querySelectorAll('.admin-dash-tabs [data-admin-view="adminFeedback"]').forEach(tab => {
    const badge = tab.querySelector('.dash-tab-dot');
    if (unreadSuggestionCount > 0) {
      if (badge) badge.textContent = unreadSuggestionCount > 9 ? '9+' : String(unreadSuggestionCount);
      else { const b=document.createElement('span'); b.className='dash-tab-dot'; b.textContent=unreadSuggestionCount>9?'9+':String(unreadSuggestionCount); tab.appendChild(b); }
    } else badge?.remove();
  });
  if (typeof hydrateAdminAttention === 'function') hydrateAdminAttention();
}

async function renderAdminFeedback() {
  if (!session || profile?.role !== "admin") return '<div class="empty-state">Access denied.</div>';
  const { data: suggestions, error } = await sb.rpc("get_platform_suggestions");
  let html = `<h2><i class='fa-solid fa-comment-medical'></i> Feedback</h2>`;
  html += adminNavHtml("adminFeedback");
  if (error) { html += errorStateHtml(error); return html; }
  html += (suggestions && suggestions.length)
    ? suggestions.map(suggestionRowHtml).join("")
    : `<div class="empty-state">No feedback yet.</div>`;
  return html;
}

async function renderVendorSuggestionsInbox() {
  if (!session || !vendor) return '<div class="empty-state">Access denied.</div>';
  const { data: suggestions, error } = await sb.rpc("get_vendor_suggestions");
  let html = `<h2><i class='fa-solid fa-comment-medical'></i> Suggestions</h2>
  <p class="muted">Feedback buyers have sent about your shop. Some may be anonymous.</p>`;
  if (error) { html += errorStateHtml(error); return html; }
  html += (suggestions && suggestions.length)
    ? suggestions.map(suggestionRowHtml).join("")
    : `<div class="empty-state">Nothing yet.</div>`;
  return html;
}

async function renderAdminUsers() {
  if (!session || !isSuperAdmin()) return '<div class="empty-state">Access denied.</div>';
  const { data: admins } = await sb.from("users").select("id, name, email").eq("role", "admin").order("name");

  let html = `<h2><i class='fa-solid fa-user'></i> Manage admins</h2>`;
  html += adminNavHtml("adminUsers");
  html += `<div class="ad-panel" style="max-width:480px;">
      <label>Promote a user to admin (by email)</label>
      <div class="flex">
        <input id="promoteEmail" type="email" placeholder="user@example.com" style="flex:1;" />
        <button class="btn btn-sm" onclick="promoteUserToAdmin()">Make admin</button>
      </div>
      <p id="promoteMsg" class="muted" style="margin-top:0.5rem;"></p>
      <p class="muted" style="font-size:0.85rem;">The user must already have a Levromart account. Only promote people you trust. Admins can approve vendors, resolve disputes, and manage other admins.</p>
    </div>
    <h3 style="margin-top:1.2rem;">Current admins</h3>`;
  html += (admins || []).map((a) => `<div class="ad-row ad-static flex" style="justify-content:space-between;"><span>${esc(a.name || "")} · ${esc(a.email)}</span>${a.id !== session.user.id ? `<button class="btn btn-sm btn-outline" onclick="demoteAdmin('${esc(a.email)}')">Remove admin</button>` : `<span class="muted">(you)</span>`}</div>`).join("");
  return html;
}

async function promoteUserToAdmin() {
  const email = byId("promoteEmail").value.trim();
  const msgEl = byId("promoteMsg");
  if (!email) return;
  const { error } = await sb.rpc("admin_set_user_role", { target_email: email, new_role: "admin" });
  if (error) { msgEl.textContent = error.message; msgEl.style.color = "#dc2626"; return; }
  msgEl.style.color = "";
  msgEl.textContent = `${email} is now an admin.`;
  navigate("adminUsers");
}

async function demoteAdmin(email) {
  if (!(await showConfirmDialog(`Remove admin access from ${email}? They'll be set back to a regular buyer account.`, { title: "Remove admin", okLabel: "Remove", danger: true }))) return;
  // A protected admin's own account can only ever be demoted by that same
  // account (enforced server-side too) -- and even then, only after
  // re-entering the real account password, not just being an already-open
  // session. Guards against a hijacked session/token that doesn't actually
  // know the password.
  if (email === session.user.email) {
    const ok = await promptPasswordConfirm("remove your own admin access", async (pw) => {
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      return !error;
    });
    if (!ok) return;
  }
  const { error } = await sb.rpc("admin_set_user_role", { target_email: email, new_role: "buyer" });
  if (error) { showToast(error.message, "error"); return; }
  navigate("adminUsers");
}

let adminAuthLogRange = "all";
function adminAuthRangeStart(range) {
  const now = new Date();
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "week") { const d = new Date(now); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); d.setHours(0,0,0,0); return d; }
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}
// Admin: every customer<->vendor conversation, newest activity first. Opening
// one shows the read-only thread (admins are never a participant).
async function renderAdminConversations(q = "") {
  if (profile?.role !== "admin") return '<div class="empty-state">Admins only.</div>';
  const { data, error } = await sb.rpc("admin_list_conversations", { p_search: q || null, p_limit: 150 });
  let html = `<h2><i class="fa-solid fa-comments"></i> Conversations</h2>${adminNavHtml("adminConversations")}`;
  html += `<p class="muted" style="font-size:.85rem;margin:.2rem 0 .7rem;">Read-only view of customer and vendor chats, for disputes and safety. Chats are removed automatically 24 hours after an order completes (kept in a private archive for 30 days).</p>`;
  html += `<form onsubmit="event.preventDefault();navigate('adminConversations',{q:this.q.value.trim()})" style="margin:.4rem 0 .8rem;"><input name="q" type="search" value="${esc(q)}" placeholder="Search by customer or vendor name…" style="max-width:360px;" /></form>`;
  if (error) return html + errorStateHtml(error);
  const rows = data || [];
  if (!rows.length) return html + '<div class="empty-state">No conversations found.</div>';
  const recentMs = 48 * 3600 * 1000;
  const isActive = (c) => c.last_at && (Date.now() - new Date(c.last_at).getTime() < recentMs);
  const nActive = rows.filter(isActive).length;
  html += `<div class="msg-tabs lm-conv-tabs" role="tablist"><a class="active" data-conv-tab="active" onclick="lmConvTab('active')">Active <span class="conv-unread-badge msg-tab-badge">${nActive}</span></a><a data-conv-tab="closed" onclick="lmConvTab('closed')">Earlier <span class="conv-unread-badge msg-tab-badge" style="opacity:.7">${rows.length - nActive}</span></a></div>`;
  html += `<div class="admin-conv-list" data-tab="active">${rows.map((c) => {
    const when = c.last_at ? new Date(c.last_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return `<button type="button" class="ad-row ad-static admin-conv-row" data-act="${isActive(c) ? 1 : 0}" onclick="navigate('messages',{conversationId:'${esc(c.conversation_id)}'})"><div class="flex" style="justify-content:space-between;gap:.6rem;"><strong>${esc(c.buyer_name || "Customer")} ↔ ${esc(c.vendor_name || "Vendor")}</strong><span class="muted" style="font-size:.75rem;white-space:nowrap;">${esc(when)}</span></div><div class="muted admin-conv-last">${esc(maskSensitiveNumbers(c.last_body || "No messages yet"))}</div><span class="badge">${Number(c.message_count || 0)} message${Number(c.message_count) === 1 ? "" : "s"}</span></button>`;
  }).join("")}</div>`;
  return html;
}

async function renderAdminAuthLogs() {
  if (!session || profile?.role !== "admin") return '<div class="empty-state">Access denied.</div>';
  const start = adminAuthRangeStart(adminAuthLogRange);
  let q = sb.from("auth_activity_logs").select("id,user_id,event_type,occurred_at,user_agent,ip,source").order("occurred_at", { ascending:false }).limit(2000);
  if (start) q = q.gte("occurred_at", start.toISOString());
  const { data: rows, error } = await q;
  if (error) return `<div class="empty-state">Could not load login logs.</div>`;
  const userIds = [...new Set((rows||[]).map(r=>r.user_id).filter(Boolean))];
  let users = [];
  if (userIds.length) { const r = await sb.from("users").select("id,name,email,role").in("id",userIds); users = r.data || []; }
  const byUser = new Map(users.map(u=>[String(u.id),u]));
  const groups = new Map();
  (rows||[]).forEach(r=>{ const key=new Date(r.occurred_at).toLocaleDateString("en-NG",{weekday:"long",year:"numeric",month:"long",day:"numeric"}); if(!groups.has(key))groups.set(key,[]); groups.get(key).push(r); });
  let html = `<h2><i class="fa-solid fa-right-to-bracket"></i> Login & logout logs</h2>${adminNavHtml("adminAuthLogs")}
    <p class="muted" style="margin:.55rem 0 .75rem;">Every recorded sign-in/session start and voluntary logout. Historical session starts available in Supabase are included; browser closes and older events that were never recorded cannot be reconstructed.</p>
    <div class="admin-auth-log-filters">${[["today","Today"],["week","This week"],["month","This month"],["all","All time"]].map(([k,l])=>`<button class="range-tab ${adminAuthLogRange===k?'active':''}" onclick="adminAuthLogRange='${k}';navigate('adminAuthLogs',{},false)">${l}</button>`).join("")}</div>`;
  if (!rows?.length) return html + `<p class="muted">No login/logout activity recorded for this period.</p>`;
  groups.forEach((dayRows,day)=>{
    html += `<div class="category-group-header"><i class="fa-regular fa-calendar"></i>${esc(day)} <span class="muted" style="font-size:.78rem;font-weight:400;">${dayRows.length} event${dayRows.length===1?'':'s'}</span></div><div class="table-wrap admin-auth-log-table-wrap"><table class="data-table admin-auth-log-table"><thead><tr><th>Time</th><th>Person</th><th>Email</th><th>Role</th><th>Event</th><th>Device / browser</th><th>IP</th></tr></thead><tbody>`;
    dayRows.forEach(r=>{ const u=byUser.get(String(r.user_id))||{}; const event=r.event_type==='logout'?'Logged out':'Logged in'; const cls=r.event_type==='logout'?'danger':'success'; html += `<tr><td>${new Date(r.occurred_at).toLocaleTimeString("en-NG",{hour:"numeric",minute:"2-digit",second:"2-digit"})}</td><td>${esc(u.name||"Unknown user")}</td><td>${esc(u.email||"-")}</td><td>${esc(u.role||"-")}</td><td><span class="badge ${cls}">${event}</span></td><td title="${esc(r.user_agent||"")}">${esc(String(r.user_agent||"-").slice(0,70))}</td><td>${esc(r.ip||"-")}</td></tr>`; });
    html += `</tbody></table></div>`;
  });
  html += `<p class="muted admin-people-hint"><i class="fa-solid fa-arrows-up-down-left-right"></i> Scroll vertically through events and horizontally on smaller screens for wider columns.</p>`;
  return html;
}

async function renderAdminLog() {
  if (!session || !isSuperAdmin()) return '<div class="empty-state">Access denied.</div>';
  const { data: log } = await sb.from("admin_actions").select("*").order("created_at", { ascending: false }).limit(100);

  const ACTION_LABEL = {
    approve_vendor: { text: "approved vendor", icon: "fa-circle-check", cls: "success" },
    reject_vendor: { text: "rejected vendor", icon: "fa-circle-xmark", cls: "danger" },
    pause_storefront: { text: "paused storefront", icon: "fa-pause", cls: "warning" },
    reactivate_storefront: { text: "reactivated storefront", icon: "fa-play", cls: "success" },
    suspend_user: { text: "suspended account", icon: "fa-user-slash", cls: "danger" },
    unsuspend_user: { text: "reinstated account", icon: "fa-user-check", cls: "success" },
    promote_admin: { text: "promoted to admin", icon: "fa-user-shield", cls: "warning" },
    demote_admin: { text: "removed admin access", icon: "fa-user-minus", cls: "danger" },
  };

  let html = `<h2><i class="fa-solid fa-clock-rotate-left"></i> Admin activity log ${infoPopoverHtml("adminActivityInfo", "Every reject, approve, pause and reactivate: who did it, and when. This trail can't be edited or deleted, even by admins.")}</h2>`;
  html += adminNavHtml("adminLog");

  if (!log || log.length === 0) { html += `<p class="muted">No admin actions logged yet.</p>`; return html; }

  html += `<input type="text" placeholder="Search the log…" style="max-width:320px;margin:0.6rem 0;" oninput="filterTableRowsBySearch(this,'.adminLogTableWrap')" />`;

  const byDate = new Map();
  log.forEach((entry) => {
    const dateKey = new Date(entry.created_at).toLocaleDateString("en-NG", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(entry);
  });
  byDate.forEach((dayEntries, dateKey) => {
    html += `<div class="category-group-header">${esc(dateKey)}</div>
      <div class="table-wrap adminLogTableWrap"><table class="data-table"><thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th></tr></thead><tbody>`;
    dayEntries.forEach((entry) => {
      const meta = ACTION_LABEL[entry.action] || { text: entry.action, icon: "fa-circle-info", cls: "" };
      html += `<tr>
        <td>${new Date(entry.created_at).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}</td>
        <td>${esc(entry.admin_name || "-")}</td>
        <td><span class="badge ${meta.cls}"><i class="fa-solid ${meta.icon}"></i> ${esc(meta.text)}</span></td>
        <td>${esc(entry.target_label || entry.target_id || "-")}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  });
  return html;
}

let adminFinanceRange = "all";
let __adminFinanceData = { vendors: [], txns: [] };

function rangeStartDate(range) {
  const now = new Date();
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "week") { const d = new Date(now); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return d; }
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}
function filterTxnsByRange(txns, range) {
  const start = rangeStartDate(range);
  if (!start) return txns || [];
  return (txns || []).filter((t) => new Date(t.created_at) >= start);
}

async function renderAdminFinance() {
  if (!session || profile?.role !== "admin") return '<div class="empty-state">Access denied.</div>';
  const seesFinancials = isSuperAdmin();

  // Added/sub-admins can see the vendor list (verification + payout setup
  // status only) but never platform financials -- commission, collected
  // amounts, due dates, storefront pause controls or the revenue/export
  // tools -- so skip fetching transactions entirely for them.
  const [{ data: vendors }, { data: txns }] = await Promise.all([
    sb.rpc("admin_list_vendor_payouts"),
    seesFinancials ? sb.rpc("admin_list_transactions") : Promise.resolve({ data: [] }),
  ]);
  __adminFinanceData = { vendors: vendors || [], txns: txns || [] };

  let html = `<h2><i class="fa-solid fa-sack-dollar"></i> Vendors &amp; Transactions</h2><p class="muted">${seesFinancials ? "Monitor payouts and every payment moving through Levromart." : "Vendor verification and payout setup status."}</p>`;
  html += adminNavHtml("adminFinance");

  if (seesFinancials) {
    const commissionOwingCount = (vendors || []).filter(v => Number(v.commission_owed || 0) > 0).length;
    const commissionOverdueCount = (vendors || []).filter(v => v.commission_status === "overdue").length;
    const commissionDueSoonCount = (vendors || []).filter(v => v.commission_status === "due_soon").length;
    html += `<div class="fin-chips">
      <div class="fin-chip"><b>${commissionOwingCount}</b><span>Owing</span></div>
      <div class="fin-chip ${commissionOverdueCount ? "bad" : ""}"><b>${commissionOverdueCount}</b><span>Overdue</span></div>
      <div class="fin-chip ${commissionDueSoonCount ? "warn" : ""}"><b>${commissionDueSoonCount}</b><span>Due in 48h</span></div>
    </div>`;
  }
  html += `<h3 style="margin-top:1.2rem;">Vendors</h3>`;
  html += `<input type="text" placeholder="Search vendors…" style="max-width:320px;margin-bottom:0.6rem;" oninput="filterTableRowsBySearch(this,'.financeVendorsTableWrap')" />`;
  html += `<div class="fin-list financeVendorsTableWrap">`;
  finSortVendors(vendors).forEach((v) => { html += finVendorRowHtml(v, seesFinancials); });
  html += `</div>`;
  if (!vendors || vendors.length === 0) html += `<p class="muted">No vendors yet.</p>`;

  if (!seesFinancials) return html;

  const totalOwed = (vendors || []).reduce((s, v) => s + Number(v.commission_owed || 0), 0);

  html += `<h3 style="margin-top:1.6rem;">Revenue</h3>`;
  html += `<div class="range-tabs" id="financeRangeTabs">
    ${[["today", "Today"], ["week", "This week"], ["month", "This month"], ["all", "All time"]].map(([key, label]) =>
      `<button class="range-tab ${adminFinanceRange === key ? "active" : ""}" onclick="switchAdminFinanceRange('${key}', this)">${label}</button>`).join("")}
  </div>`;
  html += `<div id="financeStatsArea"></div>`;
  html += `<div class="flex" style="margin:0.8rem 0;">
    <button type="button" class="fin-icbtn" title="Download CSV" aria-label="Download CSV" onclick="exportFinanceCsv()"><i class="fa-solid fa-file-csv"></i></button>
    <button type="button" class="fin-icbtn" title="Download or print PDF" aria-label="Download or print PDF" onclick="exportFinancePdf()"><i class="fa-solid fa-file-pdf"></i></button>
  </div>`;
  html += `<input type="text" placeholder="Search transactions…" style="max-width:320px;margin-bottom:0.6rem;" oninput="filterTableRowsBySearch(this,'.financeTxnTableWrap')" />`;
  html += `<div id="financeTableArea"></div>`;
  html += `<p class="muted" style="margin-top:0.6rem;">Commission owed on offline (cash/transfer) sales, all vendors, all time: <strong>${naira(totalOwed)}</strong></p>`;

  setTimeout(() => renderAdminFinanceRange(), 0);
  return html;
}

function switchAdminFinanceRange(range, btn) {
  adminFinanceRange = range;
  document.querySelectorAll("#financeRangeTabs .range-tab").forEach((el) => el.classList.remove("active"));
  btn?.classList.add("active");
  renderAdminFinanceRange();
}

function renderAdminFinanceRange() {
  const { txns } = __adminFinanceData;
  const filtered = filterTxnsByRange(txns, adminFinanceRange);
  const paid = filtered.filter((t) => t.status === "paid");
  const commission = paid.reduce((s, t) => s + Number(t.platform_cut), 0);
  const volume = paid.reduce((s, t) => s + Number(t.amount), 0);

  const statsArea = byId("financeStatsArea");
  if (statsArea) {
    statsArea.innerHTML = `<div class="accordion-section" id="financeStatsAccordion" style="max-width:700px;">
      <button class="accordion-trigger" onclick="toggleAccordion(this)"><span><i class="fa-solid fa-chart-simple"></i> Summary</span><i class="fa-solid fa-chevron-down accordion-chevron"></i></button>
      <div class="accordion-body">
        <table class="order-stats-table">
          <tr><td>Paid transactions</td><td>${paid.length}</td></tr>
          <tr><td>Gross volume</td><td>${naira(volume)}</td></tr>
          <tr><td>Commission earned</td><td>${naira(commission)}</td></tr>
        </table>
      </div>
    </div>`;
    statsArea.appendChild(buildRevenueChart(paid, adminFinanceRange));
  }

  const tableArea = byId("financeTableArea");
  if (tableArea) {
    if (!filtered.length) {
      tableArea.innerHTML = '<p class="muted">No transactions in this range.</p>';
      return;
    }
    const byDate = new Map();
    filtered.forEach((t) => {
      const dateKey = new Date(t.created_at).toLocaleDateString("en-NG", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey).push(t);
    });
    let tableHtml = "";
    byDate.forEach((dayTxns, dateKey) => {
      tableHtml += `<div class="category-group-header">${esc(dateKey)}</div>
        <div class="fin-list financeTxnTableWrap">${dayTxns.map((t) => `<div class="fin-row">
          <div class="fin-row-top">
            <strong class="fin-name">${esc(t.buyer_name || "Customer")} <span class="fin-arrow">→</span> ${esc(t.vendor_name || "Vendor")}</strong>
            <span class="fin-amount">${naira(t.amount)}</span>
          </div>
          <div class="fin-meta">
            <span>${new Date(t.created_at).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}</span>
            <span style="text-transform:capitalize;">${esc((t.payment_type || "").replace("_", " "))}</span>
            <span style="text-transform:capitalize;">${esc(t.method)}</span>
            <span class="badge ${t.status === "paid" ? "success" : t.status === "refunded" ? "danger" : "warning"}">${esc(t.status)}</span>
            <span><em>Byla cut</em> ${naira(t.platform_cut)}</span>
          </div>
        </div>`).join("")}</div>`;
    });
    tableArea.innerHTML = tableHtml;
  }
}

// A smooth glowing line/area chart (SVG) instead of plain bars - dots on
// each point double as tap/hover targets showing that day's exact figure.
function buildRevenueChart(paidTxns, range, opts) {
  const field = opts?.field || "platform_cut";
  const label = opts?.label || "Commission earned per day";
  const wrap = document.createElement("div");
  wrap.className = "revenue-chart-wrap";
  const days = range === "today" ? 1 : range === "week" ? 7 : range === "month" ? 30 : 14;
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    buckets.push({ date: d, total: 0 });
  }
  paidTxns.forEach((t) => {
    const td = new Date(t.created_at); td.setHours(0, 0, 0, 0);
    const bucket = buckets.find((b) => b.date.getTime() === td.getTime());
    if (bucket) bucket.total += Number(t[field]);
  });

  const total = buckets.reduce((s, b) => s + b.total, 0);
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const mid = Math.ceil(buckets.length / 2);
  const firstHalf = buckets.slice(0, mid).reduce((s, b) => s + b.total, 0);
  const secondHalf = buckets.slice(mid).reduce((s, b) => s + b.total, 0);
  const trendUp = secondHalf >= firstHalf;

  const W = 100, H = 40, padY = 3;
  const n = buckets.length;
  const points = buckets.map((b, i) => ({
    x: n === 1 ? W / 2 : (i / (n - 1)) * W,
    y: H - padY - (b.total / max) * (H - padY * 2),
    b,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(2)},${H} L${points[0].x.toFixed(2)},${H} Z`;
  const gradId = `chartFill${Math.random().toString(36).slice(2, 8)}`;
  const dotsSvg = points.map((p, i) => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="0.6" class="chart-dot" data-i="${i}" style="transition-delay:${(0.5 + i * 0.04).toFixed(2)}s;"></circle>`).join("");

  wrap.innerHTML = `<div class="modern-chart-card">
    <div class="flex" style="justify-content:space-between;align-items:flex-start;">
      <p class="muted" style="margin:0;font-size:0.8rem;max-width:65%;"><i class="fa-solid fa-chart-line"></i> ${esc(label)}</p>
      <div style="text-align:right;flex-shrink:0;">
        <div class="modern-chart-total">${naira(total)}</div>
        <div class="muted" style="font-size:0.7rem;">${trendUp ? "trending up" : "trending down"} <i class="fa-solid fa-arrow-trend-${trendUp ? "up" : "down"}"></i></div>
      </div>
    </div>
    <svg viewBox="0 0 ${W} ${H}" class="modern-chart-svg" preserveAspectRatio="none">
      <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="var(--primary)" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${areaPath}" fill="url(#${gradId})" stroke="none" class="modern-chart-area"></path>
      <path d="${linePath}" fill="none" stroke="var(--primary)" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" class="modern-chart-line"></path>
      ${dotsSvg}
    </svg>
    <div class="modern-chart-tooltip" id="chartTooltip-${gradId}">Tap a point for that day's figure</div>
    ${days <= 14 ? `<div class="modern-chart-labels">${buckets.map((b) => `<span>${b.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>`).join("")}</div>` : `<div class="modern-chart-labels"><span>${buckets[0].date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span><span>${buckets[buckets.length - 1].date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></div>`}
  </div>`;

  const tooltip = wrap.querySelector(`#chartTooltip-${gradId}`);
  wrap.querySelectorAll(".chart-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      wrap.querySelectorAll(".chart-dot").forEach((d) => d.classList.remove("active"));
      dot.classList.add("active");
      const p = points[Number(dot.dataset.i)];
      tooltip.textContent = `${p.b.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: ${naira(p.b.total)}`;
    });
  });

  // Draw the line in from left to right, then fade in the area fill and
  // dots behind it, instead of everything just appearing at once.
  const lineEl = wrap.querySelector(".modern-chart-line");
  const drawIn = () => {
    if (!lineEl) return;
    const len = lineEl.getTotalLength();
    lineEl.style.transition = "none";
    lineEl.style.strokeDasharray = `${len}`;
    lineEl.style.strokeDashoffset = `${len}`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      lineEl.style.transition = "";
      lineEl.style.strokeDashoffset = "0";
    }));
  };
  drawIn();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    wrap.querySelector(".modern-chart-area")?.style.setProperty("opacity", "1");
    wrap.querySelectorAll(".chart-dot").forEach((d) => { d.style.opacity = "1"; });
  }));
  // A subtle "still alive" pulse -- periodically redraws the line rather
  // than leaving it static forever. Purely cosmetic, not a data refresh;
  // skipped entirely under reduced-motion.
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const loopId = setInterval(drawIn, 9000);
    // Charts get replaced wholesale on every range switch/re-render rather
    // than updated in place, so the old wrap element is simply discarded -
    // stop its interval once it's no longer in the document to avoid
    // leaking timers into elements nobody can see anymore.
    const stopIfDetached = setInterval(() => {
      if (!document.body.contains(wrap)) { clearInterval(loopId); clearInterval(stopIfDetached); }
    }, 4000);
  }
  return wrap;
}

function rangeLabel(range) {
  return { today: "today", week: "this-week", month: "this-month", all: "all-time" }[range] || range;
}

function exportFinanceCsv() {
  const filtered = filterTxnsByRange(__adminFinanceData.txns, adminFinanceRange);
  const header = ["Date", "Customer", "Vendor", "Type", "Amount", "Method", "Status", "Platform cut"];
  const rows = filtered.map((t) => [
    new Date(t.created_at).toLocaleString(), t.buyer_name || "", t.vendor_name || "",
    (t.payment_type || "").replace("_", " "), t.amount, t.method, t.status, t.platform_cut,
  ]);
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `medris-transactions-${rangeLabel(adminFinanceRange)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportFinancePdf() {
  const filtered = filterTxnsByRange(__adminFinanceData.txns, adminFinanceRange);
  const paid = filtered.filter((t) => t.status === "paid");
  const commission = paid.reduce((sum, t) => sum + Number(t.platform_cut || 0), 0);
  const volume = paid.reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const w = window.open("", "_blank");
  if (!w) {
    showToast("Please allow pop-ups to export the PDF.", "error");
    return;
  }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Levromart Transactions (${rangeLabel(adminFinanceRange)})</title>
    <style>
      body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0d201c;padding:2rem;}
      h1{color:#3fb97f;margin:0 0 .2rem;} .muted{color:#5c7269;margin-top:0;}
      table{width:100%;border-collapse:collapse;margin-top:1.2rem;font-size:.85rem;}
      th,td{padding:.5rem .6rem;text-align:left;border-bottom:1px solid #e2e8f0;}
      th{background:#f3f8f7;} .stats{display:flex;gap:1.5rem;margin:1.2rem 0;}
      .stat{border:1px solid #e2e8f0;border-radius:8px;padding:.8rem 1.2rem;}
      .stat b{display:block;font-size:1.3rem;color:#3fb97f;}
    </style>
</head><body>
    <h1>Levromart Transactions</h1>
    <p class="muted">Range: ${rangeLabel(adminFinanceRange)} · Generated ${new Date().toLocaleString()}</p>
    <div class="stats">
      <div class="stat"><b>${paid.length}</b>Paid transactions</div>
      <div class="stat"><b>${naira(volume)}</b>Gross volume</div>
      <div class="stat"><b>${naira(commission)}</b>Commission earned</div>
    </div>
    <table><thead><tr><th>Date</th><th>Customer</th><th>Vendor</th><th>Type</th><th>Amount</th><th>Method</th><th>Status</th><th>Platform cut</th></tr></thead>
    <tbody>${filtered.map((t) => `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${esc(t.buyer_name || "")}</td><td>${esc(t.vendor_name || "")}</td><td>${esc((t.payment_type || "").replace("_", " "))}</td><td>${naira(t.amount)}</td><td>${esc(t.method || "")}</td><td>${esc(t.status || "")}</td><td>${naira(t.platform_cut)}</td></tr>`).join("")}</tbody></table>
    ${"<scr"}ipt>window.onload = () => window.print();<\/script>
  



</body></html>`);
  w.document.close();
}

async function renderAdminDisputes() {
  if (!session || profile?.role !== "admin") return '<div class="empty-state">Access denied.</div>';
  const [{data:disputes,error:disputeError},{data:unresolved,error:unresolvedError},{data:confirmedOverdue,error:confirmedError}] = await Promise.all([
    sb.from("disputes").select("*, order:orders(id, order_type, buyer_id, vendor_id, payout_status, status, payment_unresolved_at, payment_escalated_at, total_amount, status_changed_at, vendor:vendors(business_name), payments(id,payment_type,amount,status,provider_reference,created_at,paid_at))").eq("status", "open").order("created_at", { ascending: true }),
    sb.from("orders").select("id,order_type,buyer_id,vendor_id,status,payment_unresolved_at,payment_escalated_at,total_amount,status_changed_at,vendor:vendors(business_name),payments(id,payment_type,amount,status,provider_reference,created_at,paid_at)").eq("status","payment_unresolved").not("payment_escalated_at","is",null).order("payment_escalated_at",{ascending:true}),
    sb.from("orders").select("id,order_type,buyer_id,vendor_id,status,total_amount,status_changed_at,payment_escalated_at,vendor:vendors(business_name),payments(id,payment_type,amount,status,provider_reference,created_at,paid_at)").eq("status","confirmed").not("payment_escalated_at","is",null).order("payment_escalated_at",{ascending:true})
  ]);
  let html = `<h2><i class="fa-solid fa-scale-balanced"></i> Disputes &amp; payment issues</h2>${adminNavHtml("adminDisputes")}`;
  if (disputeError && unresolvedError && confirmedError) return html + errorStateHtml(disputeError);
  const openDisputes = disputes || [];
  const paymentUnresolved = (unresolved || []).filter(o => !(openDisputes || []).some(d => String(d.order?.id || d.order_id || "") === String(o.id)));
  const confirmed24h = confirmedOverdue || [];
  const issueCounts = { disputes: openDisputes.length, unresolved: paymentUnresolved.length, confirmed: confirmed24h.length };
  html += `<div class="admin-payment-issue-tabs" role="tablist" aria-label="Payment issues">
    <button type="button" class="admin-payment-issue-tab active" data-issue-tab="unresolved" onclick="switchAdminPaymentIssueTab('unresolved')"><i class="fa-solid fa-hourglass-half"></i> Payment unresolved <strong>${issueCounts.unresolved}</strong></button>
    <button type="button" class="admin-payment-issue-tab" data-issue-tab="confirmed" onclick="switchAdminPaymentIssueTab('confirmed')"><i class="fa-solid fa-clock"></i> Confirmed &gt;24h <strong>${issueCounts.confirmed}</strong></button>
    <button type="button" class="admin-payment-issue-tab" data-issue-tab="disputes" onclick="switchAdminPaymentIssueTab('disputes')"><i class="fa-solid fa-scale-balanced"></i> Other disputes <strong>${issueCounts.disputes}</strong></button>
  </div>`;

  html += `<section class="admin-payment-issue-panel" data-issue-panel="unresolved">`;
  if (!paymentUnresolved.length) html += `<div class="empty-state">No escalated payment-unresolved orders.</div>`;
  paymentUnresolved.forEach(o => {
    const claim=(o.payments||[]).find(p=>p.status==='pending'&&['buyer_report','service_offer_report'].includes(String(p.provider_reference||'').toLowerCase()));
    const age=o.payment_unresolved_at?Math.max(24,(Date.now()-new Date(o.payment_unresolved_at).getTime())/3600000):24;
    html += `<div class="card payment-escalation-admin-item"><div class="flex" style="justify-content:space-between;gap:.7rem;align-items:flex-start;flex-wrap:wrap;"><div><strong>${esc(o.vendor?.business_name||'Vendor')}</strong><div class="muted" style="font-size:.78rem;">Order ${esc(o.id)} · ${esc(o.order_type||'order')}</div></div><span class="badge danger">${Math.floor(age)}h overdue</span></div>${claim?`<p style="margin:.5rem 0 .2rem;"><strong>Reported payment:</strong> ${naira(claim.amount)}</p><p class="muted" style="margin:.1rem 0 .6rem;">Buyer reported a direct transfer; vendor has not resolved it.</p>`:`<p class="muted" style="margin:.5rem 0;">No pending payment claim record is currently visible.</p>`}<div class="flex" style="gap:.45rem;flex-wrap:wrap;"><button class="btn btn-sm" onclick="adminConfirmReportedPayment('${o.id}')" ${claim?'':'disabled'}><i class="fa-solid fa-check"></i> Verify payment</button><button class="btn btn-sm btn-danger" onclick="adminRejectReportedPayment('${o.id}')" ${claim?'':'disabled'}><i class="fa-solid fa-xmark"></i> Reject claim</button><button class="btn btn-sm btn-outline" onclick="navigate('orderDetail',{orderId:'${o.id}'})">Open order</button></div></div>`;
  });
  html += `</section>`;

  html += `<section class="admin-payment-issue-panel hidden" data-issue-panel="confirmed">`;
  if (!confirmed24h.length) html += `<div class="empty-state">No confirmed orders have reached the 24-hour payment follow-up stage.</div>`;
  confirmed24h.forEach(o => {
    const feeType=o.order_type==='rental'?'rental_fee':'sale_price';
    const paid=(o.payments||[]).some(p=>String(p.payment_type||'').toLowerCase()===feeType&&p.status==='paid');
    if(paid)return;
    const age=o.status_changed_at?Math.max(24,(Date.now()-new Date(o.status_changed_at).getTime())/3600000):24;
    html += `<div class="card payment-escalation-admin-item"><div class="flex" style="justify-content:space-between;gap:.7rem;align-items:flex-start;flex-wrap:wrap;"><div><strong>${esc(o.vendor?.business_name||'Vendor')}</strong><div class="muted" style="font-size:.78rem;">Order ${esc(o.id)} · ${esc(o.order_type||'order')} · Confirmed ${o.status_changed_at?esc(new Date(o.status_changed_at).toLocaleString('en-GB')):'over 24 hours ago'}</div></div><span class="badge warning">${Math.floor(age)}h waiting</span></div><p style="margin:.55rem 0 .2rem;"><strong>Payment status:</strong> Not verified</p><p class="muted" style="margin:.1rem 0 .6rem;">The customer has not reported payment and the vendor has not verified a direct payment.</p><div class="flex" style="gap:.45rem;flex-wrap:wrap;"><button class="btn btn-sm btn-outline" onclick="navigate('orderDetail',{orderId:'${o.id}'})">Open order</button><button class="btn btn-sm" onclick="adminCancelConfirmedOverdue('${o.id}')"><i class="fa-solid fa-xmark"></i> Cancel order</button></div></div>`;
  });
  html += `</section>`;

  html += `<section class="admin-payment-issue-panel hidden" data-issue-panel="disputes">`;
  if (!openDisputes.length) html += `<div class="empty-state">No open disputes.</div>`;
  openDisputes.forEach(d=>{
    const claim=(d.order?.payments||[]).find(p=>p.status==='pending'&&['buyer_report','service_offer_report'].includes(String(p.provider_reference||'').toLowerCase()));
    const paymentIssue=!!claim || d.order?.status==='payment_unresolved';
    html += `<div class="card"><div class="flex" style="justify-content:space-between;"><a href="#" onclick="navigate('orderDetail',{orderId:'${d.order?.id}'});return false;">${esc(d.order?.vendor?.business_name||"")} · ${esc(d.order?.order_type||"")} order</a><span class="muted" style="text-transform:capitalize;">${paymentIssue?'Payment unresolved · ':''}raised by ${esc(d.raised_by||'unknown')}</span></div><p style="margin:.5rem 0;"><strong>Reason:</strong> ${esc(d.reason||'')}</p>${disputeEvidenceHtml(d.attachments)}${d.vendor_response?`<p style="margin:.5rem 0;"><strong>Vendor says:</strong> ${esc(d.vendor_response)}</p>`:`<p class="muted" style="margin:.5rem 0;">Vendor hasn't responded yet.</p>`}${claim?`<div class="payment-resolution-admin-card"><strong><i class="fa-solid fa-building-columns"></i> Payment claim: ${naira(claim.amount)}</strong><p class="muted" style="margin:.25rem 0 .55rem;">The buyer reported a direct transfer. This claim has not been verified yet.</p><div class="flex" style="gap:.45rem;flex-wrap:wrap;"><button class="btn btn-sm" onclick="adminConfirmReportedPayment('${d.order.id}')"><i class="fa-solid fa-check"></i> Verify payment</button><button class="btn btn-sm btn-danger" onclick="adminRejectReportedPayment('${d.order.id}')"><i class="fa-solid fa-xmark"></i> Reject claim</button></div></div>`:''}${d.order?.buyer_id&&d.order?.vendor_id?`<button class="btn btn-sm btn-outline" onclick="openDisputeChat('${d.order.buyer_id}','${d.order.vendor_id}')"><i class="fa-solid fa-comment-dots"></i> View chat between buyer &amp; vendor</button>`:""}${d.order?.payout_status==='held'?`<p class="muted" style="font-size:.82rem;margin-top:.4rem;"><i class="fa-solid fa-shield-halved"></i> Payment on this order is still held by Levromart. The vendor hasn't been paid.</p><button class="btn btn-sm btn-danger" onclick="adminRefundOrder('${d.order.id}','held')"><i class="fa-solid fa-rotate-left"></i> Refund customer in full</button>`:""}${d.order?.payout_status==='released'?`<p class="muted" style="font-size:.82rem;margin-top:.4rem;"><i class="fa-solid fa-triangle-exclamation"></i> The vendor's share of this order has already been paid out.</p><button class="btn btn-sm btn-danger" onclick="adminRefundOrder('${d.order.id}','released')"><i class="fa-solid fa-rotate-left"></i> Refund customer in full</button>`:""}<div class="flex"><textarea id="notes-${d.id}" rows="2" placeholder="Resolution notes" style="flex:1;"></textarea><select id="newstatus-${d.id}"><option value="" disabled selected>Choose an outcome…</option><option value="completed">Complete (release to vendor)</option><option value="cancelled">Cancel (side with buyer)</option></select><button class="btn btn-sm" onclick="resolveDispute('${d.id}','${d.order?.id}','${d.order?.payout_status}')">Mark resolved</button></div></div>`;
  });
  html += `</section>`;
  return html;
}

window.switchAdminPaymentIssueTab=function(tab){
  tab=['unresolved','confirmed','disputes'].includes(tab)?tab:'unresolved';
  document.querySelectorAll('.admin-payment-issue-tab').forEach(b=>b.classList.toggle('active',b.dataset.issueTab===tab));
  document.querySelectorAll('.admin-payment-issue-panel').forEach(p=>p.classList.toggle('hidden',p.dataset.issuePanel!==tab));
};
window.adminCancelConfirmedOverdue=async function(orderId){
  if(!(await showConfirmDialog('Cancel this confirmed order because payment has not been verified after the 24-hour follow-up period? The customer and vendor will be notified.',{title:'Cancel overdue order',okLabel:'Cancel order',danger:true})))return;
  const {error}=await sb.rpc('admin_cancel_confirmed_overdue_order',{p_order_id:orderId});
  if(error){showToast(error.message||'Could not cancel the order.','error');return;}
  showToast('Order cancelled.','success');
  await navigate('adminDisputes',{},false);
};

async function resolveDispute(id, orderId, payoutStatus) {
  const notes = byId(`notes-${id}`).value.trim() || "Resolved.";
  const newStatus = byId(`newstatus-${id}`).value || undefined;
  // Resolving a dispute has to always move the order out of "disputed" -
  // leaving it there was the whole bug: the dispute itself would show as
  // resolved, but the order stayed stuck showing "disputed" forever with
  // no way to close it out afterward.
  if (!newStatus) {
    showToast("Choose an outcome (complete or cancel) before resolving.", "error");
    return;
  }

  if (newStatus === "cancelled" && (payoutStatus === "held" || payoutStatus === "released")) {
    showToast('This order was paid online, use "Refund customer in full" above instead, so the customer actually gets their money back.', "error");
    return;
  }

  // A held payment can't just have its status flipped to "completed" -
  // that has to actually move the money too, so it goes through the same
  // release endpoint the customer's own "I've received this" button uses.
  if (newStatus === "completed" && payoutStatus === "held") {
    const res = await fetch("/api/order-payout-action", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", orderId, accessToken: session.access_token }),
    });
    const json = await res.json();
    if (!res.ok) { showToast(json.error || "Could not release payment.", "error"); return; }
    const { error } = await sb.rpc("resolve_dispute", { p_dispute_id: id, p_admin_notes: notes });
    if (error) { showToast(error.message, "error"); return; }
    navigate("adminDisputes");
    return;
  }

  const { error } = await sb.rpc("resolve_dispute", { p_dispute_id: id, p_admin_notes: notes, p_new_order_status: newStatus });
  if (error) { showToast(error.message, "error"); return; }
  navigate("adminDisputes");
}

async function adminRefundOrder(orderId, payoutStatus) {
  const msg = payoutStatus === "released"
    ? "Refund the customer in full? The vendor's share has already been paid out (split payment), so this comes out of Levromart's own balance. You'll need to recover the vendor's cut from them separately, outside Paystack. This still cancels the order."
    : "Refund the customer in full? This sends the held payment back to their card/account and cancels the order. The vendor was never paid, so there's nothing to claw back from them.";
  if (!(await showConfirmDialog(msg, { title: "Refund customer", okLabel: "Refund", danger: true }))) return;
  try {
    const res = await fetch("/api/order-payout-action", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refund", orderId, accessToken: session.access_token }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not refund this order.");
    showToast("Customer refunded.", "success");
    navigate("adminDisputes");
  } catch (err) {
    showToast(err.message, "error");
  }
}

