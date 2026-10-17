// ---------- SUSPENDED ACCOUNT SCREEN ----------
async function renderSuspendedScreen() {
  const { data: appeal } = await sb.rpc("get_my_account_appeal");
  const a = appeal && appeal[0];
  const hasPendingAppeal = a && a.status === "pending";

  let html = `<div class="card" style="max-width:480px;margin:2rem auto;">
    <h2 style="color:var(--danger);"><i class="fa-solid fa-ban"></i> Account suspended</h2>
    <p style="margin:0.6rem 0;">${esc(profile.suspended_reason || "Your account has been suspended.")}</p>`;

  if (a) {
    html += `<div class="banner ${a.status === "pending" ? "banner-warning" : a.status === "approved" ? "banner-success" : "banner-danger"}" style="margin-top:0.8rem;">
      <strong>Your appeal is ${a.status}.</strong>
      ${a.admin_response ? `<p class="muted" style="margin-top:0.3rem;">${esc(a.admin_response)}</p>` : ""}
    </div>`;
  }

  if (!hasPendingAppeal) {
    html += `<label style="margin-top:1rem;">${a ? "Submit a new appeal" : "Appeal this suspension"}</label>
      <textarea id="appealMessage" rows="4" placeholder="Explain why you think this suspension should be lifted…"></textarea>
      <div id="appealError" class="error-text hidden"></div>
      <button class="btn btn-sm" style="margin-top:0.4rem;" onclick="submitAppeal()"><i class="fa-solid fa-paper-plane"></i> Submit appeal</button>`;
  }

  html += `<button class="btn btn-sm btn-outline" style="margin-top:1rem;" onclick="logout()"><i class="fa-solid fa-arrow-right-from-bracket"></i> Log out</button>
  </div>`;
  return html;
}
async function submitAppeal() {
  const errorEl = byId("appealError");
  errorEl.classList.add("hidden");
  const message = byId("appealMessage").value.trim();
  if (!message) { errorEl.textContent = "Explain why you're appealing first."; errorEl.classList.remove("hidden"); return; }
  const { error } = await sb.rpc("submit_account_appeal", { p_message: message });
  if (error) { errorEl.textContent = error.message; errorEl.classList.remove("hidden"); return; }
  showToast("Appeal submitted. We'll review it and get back to you.", "success");
  navigate("suspended", {}, false);
}

async function cancelLoginOtp() {
  byId("otpModal").classList.add("hidden");
  pendingOtpAccessToken = null;
  manualLogout = true;
  await recordAuthActivity("logout");
  await sb.auth.signOut();
}

async function resendLoginOtp() {
  if (!pendingOtpAccessToken) return;
  await fetch("/api/auth-otp", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "send", accessToken: pendingOtpAccessToken }),
  });
  showToast("New code sent.", "success");
}

async function logout() {
  if (!(await showConfirmDialog("Log out of Levromart?", { title: "Log out", okLabel: "Log out", danger: true }))) return;
  manualLogout = true;
  try { localStorage.removeItem("levromart_levi_ask_last"); } catch (_) {}
  try { chatSnapClearAll(); } catch (_) {}
  try { window.__levromartClearPersistedRoute?.(); } catch (_) {}
  await recordAuthActivity("logout");
  await sb.auth.signOut();
  await refreshAuthStateOnce();
  navigate("home");
}

function startDeleteAccount() {
  closeAllPanels();
  byId("deleteAccountPassword").value = "";
  byId("deleteAccountPhrase").value = "";
  byId("deleteAccountError").classList.add("hidden");
  byId("deleteAccountModal").classList.remove("hidden");
}
async function confirmDeleteAccount() {
  const password = byId("deleteAccountPassword").value;
  const phrase = byId("deleteAccountPhrase").value.trim().toLowerCase();
  const errorEl = byId("deleteAccountError");
  errorEl.classList.add("hidden");
  if (!password) { errorEl.textContent = "Enter your password to confirm."; errorEl.classList.remove("hidden"); return; }
  if (phrase !== "delete my account") { errorEl.textContent = 'Type "delete my account" exactly to confirm.'; errorEl.classList.remove("hidden"); return; }
  const btn = byId("deleteAccountConfirmBtn");
  btn.disabled = true;
  try {
    // Re-authenticating here rotates the client's session -- read the
    // fresh access token straight off this response instead of the global
    // `session` variable, which only catches up once the auth-state-change
    // listener fires. Using the stale one was throwing a false "Invalid
    // session" from the API below even with the right password and phrase.
    const deleteLoginEmail = profile?.email || session?.user?.email;
    if (!deleteLoginEmail) throw new Error("This account has no email address. Please use the account password to continue.");
    const { data: authData, error: pwError } = await sb.auth.signInWithPassword({ email: deleteLoginEmail, password });
    if (pwError) throw new Error("Incorrect password.");
    const freshAccessToken = authData?.session?.access_token || session.access_token;

    const res = await fetch("/api/delete-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: freshAccessToken }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not delete account.");

    byId("deleteAccountModal").classList.add("hidden");
    await sb.auth.signOut();
    await refreshAuthStateOnce();
    navigate("home");
    showToast("Your account has been deleted.", "success");
  } catch (err) {
    const raw = String(err?.message || "");
    const technical = /foreign key|constraint|schema cache|postgres|postgrest|violates|relation .* does not exist|column .* does not exist/i.test(raw);
    errorEl.textContent = technical
      ? "We couldn't complete the account deletion. Please try again in a moment."
      : raw || "We couldn't complete the account deletion. Please try again.";
    errorEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
}

