// ---------- DEDICATED SEARCH PAGE ----------
// Replaces the old hero-search dropdown, which quietly broke on every
// product result: its click handler called saveHistory(...) as a bare
// global, but saveHistory only ever existed inside an unrelated closure
// further down this file -- never on window. That threw a ReferenceError
// the instant a product result was tapped, which aborted the handler
// before the navigate(...) statement after it ever ran. Vendor/package
// results (which didn't call saveHistory) worked; product results silently
// did nothing. A full page sidesteps that whole class of bug: results are
// ordinary list items with a plain onclick, not a floating dropdown that
// has to survive an input's blur event.
const SEARCH_HISTORY_KEY = "levromart-search-history-v1";
const SEARCH_HISTORY_MAX = 7;
function readSearchHistory() {
  try { const list = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]"); return Array.isArray(list) ? list.slice(0, SEARCH_HISTORY_MAX) : []; } catch (_) { return []; }
}
function writeSearchHistory(term) {
  const q = String(term || "").trim();
  if (!q) return;
  try {
    const existing = readSearchHistory().filter((x) => x.toLowerCase() !== q.toLowerCase());
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify([q, ...existing].slice(0, SEARCH_HISTORY_MAX)));
  } catch (_) {}
}
document.addEventListener("click", (e) => {
  try {
    if (!e.target.closest || !e.target.closest("#searchPageResults .search-result-row, #searchPageResults .lv-svr-item")) return;
    const t = byId("searchPageInput")?.value.trim();
    if (t) writeSearchHistory(t);
  } catch (_) {}
}, true);
function clearSearchHistory() {
  try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch (_) {}
  const list = byId("searchPageHistory");
  if (list) list.innerHTML = "";
}
function renderSearchPage() {
  const history = readSearchHistory();
  searchPageFilter = "all";
  const filterIcons = { all: "", products: "fa-bag-shopping", vendors: "fa-store", services: "fa-user-gear", packages: "fa-box-open" };
  const filterBtn = (id, label) => `<button type="button" class="search-page-filter ${id === "all" ? "active" : ""}" data-filter="${id}" role="tab" onclick="setSearchPageFilter('${id}')">${filterIcons[id] ? `<i class="fa-solid ${filterIcons[id]}" aria-hidden="true"></i>` : ""}${label}</button>`;
  return `<div class="search-page">
    ${typeof lvPageHero === "function" ? lvPageHero("search") : ""}
    <div class="search-page-head">
    <div class="search-page-bar">
      <button type="button" class="search-page-back" onclick="lvGoBack('home')" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="search-page-input-wrap">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" inputmode="search" enterkeyhint="search" id="searchPageInput" placeholder="Search products, services, vendors…" autocomplete="off" oninput="scheduleSearchPageQuery()" onkeydown="if(event.key==='Enter'){event.preventDefault();runSearchPageQuery(this.value.trim(),true);}" />
        <button type="button" class="search-page-clear hidden" id="searchPageClearBtn" onclick="clearSearchPageInput()" aria-label="Clear search"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
    <div class="search-page-filters" role="tablist" aria-label="Search filters">${filterBtn("all", "All")}${filterBtn("products", "Products")}${filterBtn("vendors", "Vendors")}${filterBtn("services", "Services")}${filterBtn("packages", "Packages")}</div>
    </div>
    <div id="searchScopeNote" class="search-scope-note" hidden></div>
    <div id="searchPageResults" class="search-page-results">
      <div class="search-page-history-block" id="searchPageHistoryBlock" ${history.length ? "" : "hidden"}>
        <div class="search-page-history-head"><span>Recent searches</span><button type="button" onclick="clearSearchHistory()">Clear</button></div>
        <div class="search-page-history-chips" id="searchPageHistory">${history.map((q) => `<button type="button" class="search-page-chip" onclick="runSearchFromChip('${esc(q).replace(/'/g, "&#39;")}')">${esc(q)}</button>`).join("")}</div>
      </div>
    </div>
  </div>`;
}
function runSearchFromChip(term) {
  const input = byId("searchPageInput");
  if (input) input.value = term;
  runSearchPageQuery(term, true);
}
function clearSearchPageInput() {
  const input = byId("searchPageInput");
  if (input) { input.value = ""; input.focus(); }
  byId("searchPageClearBtn")?.classList.add("hidden");
  const historyBlock = byId("searchPageHistoryBlock");
  if (historyBlock) historyBlock.hidden = readSearchHistory().length === 0;
  document.querySelectorAll(".search-page-section, .search-page-empty").forEach((el) => el.remove());
  renderSearchPageSuggestions();
}
let searchPageTimer = null;
let searchPageSeq = 0;
let searchPageFilter = "all";
// Raw server results are kept for a minute per query+kind so flipping between
// tabs (or the location-ready re-run) never repeats a request that just ran.
const searchResultCache = new Map();
async function searchCached(key, run, signal, strict) {
  const hit = searchResultCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.value;
  const res = await run();
  if (res?.error) { if (signal?.aborted || strict) throw res.error; return []; } // errors are never cached
  const value = res?.data || [];
  if (searchResultCache.size > 40) searchResultCache.delete(searchResultCache.keys().next().value);
  searchResultCache.set(key, { at: Date.now(), value });
  return value;
}
function setSearchPageFilter(id) {
  searchPageFilter = id;
  document.querySelectorAll(".search-page-filter").forEach((b) => b.classList.toggle("active", b.dataset.filter === id));
  const term = byId("searchPageInput")?.value.trim() || "";
  if (term) runSearchPageQuery(term, false);
}

