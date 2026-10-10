// ---------- PROFILE SETUP (first screen after sign-up / first vendor login, WhatsApp style) ----------
function lvSetupKey() { return "lv-setup-done:" + (session?.user?.id || ""); }
function lvSetupSeen() { try { return localStorage.getItem(lvSetupKey()) === "1"; } catch (_) { return true; } }
function lvSetupMarkSeen() { try { localStorage.setItem(lvSetupKey(), "1"); } catch (_) {} }
function renderProfileSetup() {
  if (!session || !profile) return '<div class="empty-state">Please log in.</div>';
  const isV = !!vendor && profile.role !== "admin";
  return `<div class="ps-page lv-flat">
    <h2 class="ps-title">${isV ? "Set up your shop profile" : "Profile info"}</h2>
    <p class="ps-sub">${isV ? "Add your name, a profile picture and a banner for your storefront. You can change them any time." : "Please provide your name and an optional profile photo."}</p>
    ${isV ? epBannerBlockHtml() : ""}
    ${epPhotoBlockHtml(true)}
    <div id="psError" class="error-text hidden"></div>
    <input type="text" id="psName" class="ps-name" maxlength="60" placeholder="Your name" value="${esc(profile.name || "")}" />
    <button class="btn ps-next" id="psNextBtn" onclick="finishProfileSetup()">${isV ? "Done" : "Next"}</button>
    <button type="button" class="ps-skip" onclick="finishProfileSetup(true)">Skip for now</button>
  </div>`;
}
async function finishProfileSetup(skip) {
  const target = vendor && profile?.role !== "admin" ? "vendorDashboard" : "home";
  if (!skip) {
    const name = (byId("psName")?.value || "").trim();
    if (!name) { const e = byId("psError"); if (e) { e.textContent = "Please enter your name."; e.classList.remove("hidden"); } return; }
    if (name !== (profile.name || "")) {
      const btn = byId("psNextBtn"); if (btn) btn.disabled = true;
      const { error } = await sb.from("users").update({ name }).eq("id", session.user.id);
      if (btn) btn.disabled = false;
      if (error) { const e = byId("psError"); if (e) { e.textContent = error.message; e.classList.remove("hidden"); } return; }
      profile.name = name; try { updateAuthUI(); } catch (_) {}
    }
  }
  lvSetupMarkSeen();
  navigate(target);
}
async function submitEditProfile() {
  const errorEl = byId("editProfileError");
  errorEl.classList.add("hidden");
  const name = byId("epName").value.trim();
  const phone = byId("epPhone").value.trim();
  const normalizedPhone = phone.replace(/[\s().-]/g, "");
  if (!name) { errorEl.textContent = "Full name is required."; errorEl.classList.remove("hidden"); return; }
  if (!phone) { errorEl.textContent = "Phone number is required."; errorEl.classList.remove("hidden"); return; }
  if (!/^\+?[0-9]{7,15}$/.test(normalizedPhone)) { errorEl.textContent = "Enter a valid phone number (7–15 digits)."; errorEl.classList.remove("hidden"); return; }
  const btn = byId("epSaveBtn");
  btn.disabled = true;
  const { error } = await sb.from("users").update({
    name,
    phone,
    city: byId("epCity").value.trim() || null,
    address: byId("epAddress").value.trim() || null,
  }).eq("id", session.user.id);
  btn.disabled = false;
  if (error) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); return; }
  Object.assign(profile, { name, phone, city: byId("epCity").value.trim() || null, address: byId("epAddress").value.trim() || null });
  updateAuthUI();
  showToast("Details updated.", "success");
  navigate(vendor ? "vendorDashboard" : "home");
}

