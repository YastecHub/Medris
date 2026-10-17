// ---------- THEME ----------
function syncSystemBarColorForTheme(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  const apple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  const rootStyles = getComputedStyle(document.documentElement);
  const liveBg = (rootStyles.getPropertyValue("--bg") || "").trim();
  const fallback = { light: "#f5f7fa", dark: "#1b1f23", black: "#000000" };
  if (meta) meta.setAttribute("content", liveBg || fallback[theme] || fallback.light);
  if (apple) apple.setAttribute("content", theme === "light" ? "default" : "black-translucent");
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme === "light" ? "" : theme);
  try { document.documentElement.setAttribute("data-splash", (theme === "dark" || theme === "black") ? "dark" : ((theme === "light" && localStorage.getItem("medris-theme")) ? "light" : "auto")); } catch (_) {}
  localStorage.setItem("medris-theme", theme);
  syncSystemBarColorForTheme(theme);
  document.querySelectorAll("#settingsPanel .theme-option").forEach((el) => {
    el.classList.toggle("active", el.dataset.themeChoice === theme);
  });
  // The real, currently-rendered settings page uses .settings-choice, not
  // .theme-option (that selector above matches an older/unused panel) -
  // without this, the checkmark only caught up the next time the settings
  // page happened to re-render, not immediately when tapped.
  document.querySelectorAll("#settings-page .settings-choice").forEach((el) => {
    const on = el.dataset.themeChoice === theme;
    el.classList.toggle("active", on);
    el.dataset.active = String(on);
  });
  applyAccent(currentAccentIndex);
}
function initTheme() {
  // Deep black is the default for everyone. People on any older choice are moved to it once
  // (flag below); after that, whatever they pick in Settings is kept.
  let saved = "black";
  try {
    if (localStorage.getItem("medris-theme-v2")) saved = localStorage.getItem("medris-theme") || "black";
    else localStorage.setItem("medris-theme-v2", "1");
  } catch (_) {}
  setTheme(saved);
}

