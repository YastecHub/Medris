// ---------- ACCENT COLOR ----------
// A broad 35-color palette, grouped by hue so the picker stays easy to scan.
// The default is Levromart green; every other option is a clearly
// distinguishable shade rather than a near-duplicate.
const ACCENT_PALETTE = [
  { name: "Teal", group: "Greens", base: "#0f766e", light: "#0f766e" },
  { name: "Mint", group: "Greens", base: "#3fb97f", light: "#3fb97f" },
  { name: "Emerald", group: "Greens", base: "#047857", light: "#047857" },
  { name: "Forest", group: "Greens", base: "#166534", light: "#166534" },
  { name: "WhatsApp Green", group: "Greens", base: "#25D366", light: "#25D366" },
  { name: "Sky", group: "Blues", base: "#0284c7", light: "#0284c7" },
  { name: "Cyan", group: "Blues", base: "#0e7490", light: "#0e7490" },
  { name: "Ocean Blue", group: "Blues", base: "#2563eb", light: "#2563eb" },
  { name: "Royal Blue", group: "Blues", base: "#1d4ed8", light: "#1d4ed8" },
  { name: "Navy", group: "Blues", base: "#1e3a8a", light: "#1e3a8a" },
  { name: "Coral Red", group: "Reds", base: "#ef4444", light: "#ef4444" },
  { name: "Crimson", group: "Reds", base: "#dc2626", light: "#dc2626" },
  { name: "Ruby", group: "Reds", base: "#b91c1c", light: "#b91c1c" },
  { name: "Rose Red", group: "Reds", base: "#be123c", light: "#be123c" },
  { name: "Deep Red", group: "Reds", base: "#991b1b", light: "#991b1b" },
  { name: "Lemon", group: "Yellows", base: "#eab308", light: "#eab308" },
  { name: "Sunflower", group: "Yellows", base: "#facc15", light: "#facc15" },
  { name: "Golden", group: "Yellows", base: "#ca8a04", light: "#ca8a04" },
  { name: "Mustard", group: "Yellows", base: "#a16207", light: "#a16207" },
  { name: "Dark Gold", group: "Yellows", base: "#854d0e", light: "#854d0e" },
  { name: "Peach", group: "Oranges", base: "#f97316", light: "#f97316" },
  { name: "Tangerine", group: "Oranges", base: "#ea580c", light: "#ea580c" },
  { name: "Sunset Orange", group: "Oranges", base: "#c2410c", light: "#c2410c" },
  { name: "Burnt Orange", group: "Oranges", base: "#9a3412", light: "#9a3412" },
  { name: "Terracotta", group: "Oranges", base: "#7c2d12", light: "#7c2d12" },
  { name: "Light Pink", group: "Pinks", base: "#ec4899", light: "#ec4899" },
  { name: "Hot Pink", group: "Pinks", base: "#db2777", light: "#db2777" },
  { name: "Fuchsia", group: "Pinks", base: "#c026d3", light: "#c026d3" },
  { name: "Rose", group: "Pinks", base: "#9f1239", light: "#9f1239" },
  { name: "Berry", group: "Pinks", base: "#831843", light: "#831843" },
  { name: "Lavender", group: "Purples", base: "#a855f7", light: "#a855f7" },
  { name: "Violet", group: "Purples", base: "#7c3aed", light: "#7c3aed" },
  { name: "Royal Purple", group: "Purples", base: "#6d28d9", light: "#6d28d9" },
  { name: "Indigo", group: "Purples", base: "#4338ca", light: "#4338ca" },
  { name: "Deep Purple", group: "Purples", base: "#4c1d95", light: "#4c1d95" },
];
const DEFAULT_ACCENT_INDEX = 1;
let currentAccentIndex = DEFAULT_ACCENT_INDEX;
function hexHue(hex) {
  const n=parseInt(String(hex||"#3fb97f").replace("#",""),16);
  let r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  let h=0;if(d){if(max===r)h=((g-b)/d)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360;}return h;
}
function accentLogoFilter(hex){
  const target=hexHue(hex),base=hexHue("#3fb97f");
  let delta=target-base;if(delta>180)delta-=360;if(delta<-180)delta+=360;
  return `hue-rotate(${delta.toFixed(1)}deg) saturate(1.08)`;
}
function applyAccent(index) {
  /* Accent customization has been retired: Levromart uses one calm brand green everywhere. */
  const preset = { name: "Levromart Green", group: "Brand", base: "#3fb97f", light: "#3fb97f" };
  const theme = localStorage.getItem("medris-theme") || "black";
  const root = document.documentElement;
  // Chat bubbles always use the accent's darker "base" tone, regardless of
  // theme -- unlike --primary (which intentionally brightens in dark mode
  // for buttons/accents), a big bubble filled with that bright shade makes
  // the white text and read-receipt ticks on top of it hard to read.
  if (preset.name === "WhatsApp Green") {
    const mineBg = theme === "light" ? "#d9fdd3" : "#005c4b";
    const mineText = theme === "light" ? "#111b21" : "#ffffff";
    root.style.setProperty("--chat-mine-bg", mineBg);
    root.style.setProperty("--chat-mine-text", mineText);
  } else {
    root.style.setProperty("--chat-mine-bg", preset.base);
    root.style.setProperty("--chat-mine-text", "#ffffff");
  }
  // Accent colors are intentionally solid: no gradients or brightened end-stops.
  // Keeping every accent surface on the same single tone makes the UI feel
  // cleaner and more consistent, especially on dark/black themes.
  root.style.setProperty("--primary", preset.base);
  root.style.setProperty("--primary-light", preset.base);
  root.style.setProperty("--primary-grad", preset.base);
  // MEDRIS_LOGO is a static green/white raster asset. Hue-rotate only its
  // coloured artwork so the white centre remains white while the brand mark
  // follows the live accent selected by the user.
  root.style.setProperty("--levi-accent-filter", accentLogoFilter(preset.base));
}
function setAccent() {
  /* Backward-compatible no-op for older callers: never allow a custom accent. */
  currentAccentIndex = DEFAULT_ACCENT_INDEX;
  try { localStorage.removeItem("medris-accent"); } catch (e) {}
  applyAccent(DEFAULT_ACCENT_INDEX);
}
function initAccent() {
  /* One Levromart brand accent only; ignore and clear any legacy custom accent. */
  currentAccentIndex = DEFAULT_ACCENT_INDEX;
  try { localStorage.removeItem("medris-accent"); } catch (e) {}
  applyAccent(currentAccentIndex);
}
function toggleAccordion(trigger) {
  const section = trigger.closest(".accordion-section");
  const wasOpen = section.classList.contains("open");
  section.parentElement.querySelectorAll(".accordion-section.open").forEach((s) => s.classList.remove("open"));
  if (!wasOpen) section.classList.add("open");
}

