// ---------- HORIZONTAL BROWSE PREFERENCE ----------
const HORIZONTAL_BROWSE_KEY = "levromart-horizontal-browse";
let horizontalBrowseEnabled = false; // default: static, no automatic movement
function readHorizontalBrowsePreference(){
  try { return localStorage.getItem(HORIZONTAL_BROWSE_KEY) === "1"; } catch (_) { return false; }
}
function applyHorizontalBrowsePreference(){
  horizontalBrowseEnabled = readHorizontalBrowsePreference();
  document.body.classList.toggle("levro-static-rails", !horizontalBrowseEnabled);
  if (!horizontalBrowseEnabled) clearAutoScrollTimers();
}
function setHorizontalBrowseEnabled(enabled){
  horizontalBrowseEnabled = !!enabled;
  try { localStorage.setItem(HORIZONTAL_BROWSE_KEY, horizontalBrowseEnabled ? "1" : "0"); } catch (_) {}
  document.body.classList.toggle("levro-static-rails", !horizontalBrowseEnabled);
  clearAutoScrollTimers();
  if (horizontalBrowseEnabled) {
    document.querySelectorAll("#app .cat-row, #app .hscroll, #app .storefront-product-strip, #app .vendors-map-vendor-rail").forEach((el) => setupAutoScroll(el));
  }
  hydrateSettingsPage();
}

