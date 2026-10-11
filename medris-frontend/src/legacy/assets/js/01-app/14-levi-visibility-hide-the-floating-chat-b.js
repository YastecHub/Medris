// ---------- LEVI VISIBILITY (hide the floating chat button entirely) ----------
let leviVisible = true;
function toggleLeviVisible() {
  leviVisible = !leviVisible;
  localStorage.setItem("medris-levi-visible", leviVisible ? "1" : "0");
  if (!leviVisible) { byId("aiChatPanel")?.classList.add("hidden"); }
  applyLeviVisibility();
  renderLeviVisibleToggle();
  showToast(leviVisible ? "Levi is back." : "Levi hidden · triple-tap to bring him back", "success");
}
function applyLeviVisibility() { syncLeviFabVisibility(); }
function renderLeviVisibleToggle() {
  const el = byId("leviVisibleToggleOption");
  if (!el) return;
  el.innerHTML = `<i class='fa-solid ${leviVisible ? "fa-comment-dots" : "fa-comment-slash"}'></i> Levi assistant: ${leviVisible ? "Shown" : "Hidden"}`;
}
function initLeviVisible() {
  leviVisible = localStorage.getItem("medris-levi-visible") !== "0";
  renderLeviVisibleToggle();
  applyLeviVisibility();
  applyLeviFabSize();
}
document.addEventListener("click", (e) => {
  if (e.target.closest(".btn, .icon-btn, .cat-chip, .theme-option, .accent-swatch, .bottom-nav-item, .fav-btn")) playSound("click");
}, true);

