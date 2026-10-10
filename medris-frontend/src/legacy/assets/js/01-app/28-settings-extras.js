// ---------- SETTINGS EXTRAS ----------
function toggleSettingsMoreMenu(evt) {
  evt?.stopPropagation();
  const menu = byId("settingsMoreMenu");
  if (!menu) return;
  menu.classList.toggle("hidden");
}
function toggleSettingsMoreSection() {
  const content = byId("settingsMoreContent");
  const row = document.querySelector(".settings-more-row");
  if (!content) return;
  const open = content.classList.toggle("hidden") === false;
  row?.classList.toggle("open", open);
  row?.querySelector(".settings-more-chevron")?.classList.toggle("open", open);
}
async function resetLevromartPreferences() {
  const confirmed = await showConfirmDialog(
    "Reset Levromart preferences? Your appearance, Levi size, visibility, voice and interface preferences on this device will return to their defaults.",
    { title: "Reset preferences", okLabel: "Reset", danger: true }
  );
  if (!confirmed) return;
  ["medris-theme", "medris-accent", "medris-install-dismissed", "medris-notif-dismissed", "medris-ai-chat-expanded", "medris-levi-fab-size", "medris-levi-visible", "medris-ai-voice", "levromart-font-scale", "levromart-horizontal-browse", "levromart-interface-defaults-v2", "levromart_ai_fab_pos", "levromart_cart_fab_pos", "levromart_ai_panel_pos"].forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
  currentAccentIndex = DEFAULT_ACCENT_INDEX;
  leviVisible = true;
  setTheme("light");
  setAccent(DEFAULT_ACCENT_INDEX);
  applyLeviFabSize();
  applyLevromartFontScale();
  applyLeviVisibility();
  const panel = byId("settingsMoreMenu");
  panel?.classList.add("hidden");
  hydrateSettingsPage();
  showToast("Preferences restored to default.", "success");
}
function showLevromartAbout() {
  const modal = byId("aboutLevromartModal");
  if (!modal) return;
  const year = byId("aboutYear");
  if (year) year.textContent = new Date().getFullYear();
  byId("settingsMoreMenu")?.classList.add("hidden");
  modal.classList.remove("hidden");
}
function closeLevromartAbout() { byId("aboutLevromartModal")?.classList.add("hidden"); }
document.addEventListener("click", (e) => {
  const menu = byId("settingsMoreMenu");
  if (menu && !menu.classList.contains("hidden") && !e.target.closest("#settingsMoreMenu, #settingsMoreBtn")) menu.classList.add("hidden");
});

