import { useLayoutEffect, useRef } from "react";

/**
 * The vendors directory, drawn by React: the page frame only.
 *
 * Converted from renderVendorsDirectory() as it is after every legacy script has wrapped it
 * (…/js/03-levromart-2026-09-09-vendor-logic-fixes.js:158, plus the map-rail wrapper in …/js/05-part.js:155).
 * Same markup, classes and ids, same handlers (each calls the very same global the old inline attribute called).
 *
 * What is deliberately NOT converted, and why: everything inside the frame is owned by the existing code, which
 * finds its elements by id and changes them in place — the vendor cards in #vendorsGrid, the Sector / City /
 * Category <select> options, the category chips, the horizontal rail and the Leaflet map, the active tab and view
 * buttons, the infinite scroll. Their state (view mode, sort, how many cards are shown, the 10-minute shuffle)
 * lives in closures of those scripts and is not reachable from here. So React draws the frame ONCE, never
 * re-renders it (no state, no props), and asks the old code to do what renderVendorsDirectory() always did besides
 * returning markup: reset its state and load the vendors. Reading it as "React draws, the existing code acts"
 * (same approach as the Notifications bridge): the data requests, filtering, sorting, map and navigation are
 * exactly the old ones.
 *
 * Until the legacy screen is deleted (a later pull request) any change to the frame must be made in BOTH places;
 * the parity test (tests/e2e/pilot-vendors.spec.ts) fails if they drift apart.
 */
type Legacy = Record<string, ((...args: unknown[]) => unknown) | string | undefined>;
const L = () => window as unknown as Legacy;
const call = (name: string, ...args: unknown[]) => {
  const fn = L()[name];
  if (typeof fn === "function") return fn(...args);
};

const ICON = { viewBox: "0 0 24 24", width: 22, height: 22, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const TABS = [
  ["all", "All vendors"],
  ["buy", "Buy"],
  ["rent", "Rent"],
  ["both", "Buy & Rent"],
] as const;

export default function VendorsPage() {
  const started = useRef(false);

  // Runs after React has put the frame in the page and before the browser's next timer, so the old loader
  // (which renderVendorsDirectory() schedules with setTimeout 0 and which looks elements up by id) finds it.
  // The markup string it returns is not used: the frame below is what is shown.
  useLayoutEffect(() => {
    if (started.current) return;
    started.current = true;
    call("renderVendorsDirectory");
  }, []);

  const skeleton = String(call("vendorDirectorySkeletonHtml") ?? "");
  const filterIcon = String(L().LV_FILTER_SVG ?? "");

  return (
    <div className="vd-page">
      <div className="vd-head">
        <div className="vd-title">
          <span className="vd-title-ico">
            <svg {...ICON} width={22} height={22}>
              <path d="M4 9.5 5.6 4.5h12.8L20 9.5" />
              <path d="M4 9.5a2.67 2.67 0 0 0 5.33 0 2.67 2.67 0 0 0 5.34 0 2.67 2.67 0 0 0 5.33 0" />
              <path d="M5.5 12.6V20h13v-7.4" />
              <path d="M10 20v-4.5h4V20" />
            </svg>
          </span>
          <h2>All vendors</h2>
        </div>
        <div className="vd-views" role="group" aria-label="View mode">
          <button type="button" className="vd-view" id="vendorsViewGridBtn" onClick={() => call("switchVendorsView", "grid")} title="Grid view" aria-label="Grid view">
            <svg className="vd-view-ico" {...ICON}>
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
              <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
            </svg>
          </button>
          <button type="button" className="vd-view" id="vendorsViewListBtn" onClick={() => call("switchVendorsView", "list")} title="List view" aria-label="List view">
            <svg className="vd-view-ico" {...ICON}>
              <path d="M9 6h11M9 12h11M9 18h11" />
              <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
            </svg>
          </button>
          <button type="button" className="vd-view" id="vendorsViewMapBtn" onClick={() => call("switchVendorsView", "map")} title="Map view" aria-label="Map view">
            <svg className="vd-view-ico" {...ICON}>
              <path d="M9 4 3.5 6.5v13L9 17l6 3 5.5-2.5v-13L15 7z" />
              <path d="M9 4v13M15 7v13" />
            </svg>
          </button>
        </div>
      </div>
      <div className="vd-seg" id="vendorsListingTabs" role="tablist" aria-label="Vendor type">
        {TABS.map(([filter, label]) => (
          <button key={filter} type="button" className={filter === "all" ? "vd-tab active" : "vd-tab"} role="tab" data-filter={filter} onClick={() => call("setVendorsListingFilter", filter)}>
            {label}
          </button>
        ))}
      </div>
      <div className="vd-tools">
        <label className="vd-search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input type="search" id="vendorSearchInput" placeholder="Search vendors…" onInput={() => call("filterVendorsDirectory")} autoComplete="off" enterKeyHint="search" aria-label="Search vendors or products" />
        </label>
        {/* LV_FILTER_SVG is the app's own constant SVG string (not data), as in the legacy template. */}
        <button type="button" className="vd-filter-btn" id="vendorsFiltersToggle" aria-label="Filter" title="Filter" aria-expanded="false" onClick={() => call("toggleVendorsFilters")} dangerouslySetInnerHTML={{ __html: filterIcon }} />
      </div>
      <div className="vendors-filters-panel vd-panel hidden" id="vendorsFiltersPanel">
        <div className="lm-sheet-head">
          <strong>Filter vendors</strong>
          <button type="button" className="lm-x" onClick={() => call("toggleVendorsFilters", false)} aria-label="Close">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div className="vendors-filter-grid">
          <label>
            Sector
            <select id="vendorSectorFilter" onChange={() => call("filterVendorsDirectory")}>
              <option value="">All sectors</option>
            </select>
          </label>
          <label>
            City
            <select id="vendorCityFilter" onChange={() => call("filterVendorsDirectory")}>
              <option value="">All cities</option>
            </select>
          </label>
          <label>
            Category
            <select id="vendorCategoryFilter" onChange={() => call("filterVendorsDirectory")}>
              <option value="">Known for: anything</option>
            </select>
          </label>
          <label>
            Arrange
            <select id="vendorSortFilter" onChange={(e) => call("setVendorDirectorySort", e.currentTarget.value)}>
              <option value="shuffled">Mixed (changes every few minutes)</option>
              <option value="alphabetical">A–Z</option>
              <option value="closest">Closest first</option>
            </select>
          </label>
        </div>
      </div>
      <div className="vd-chips" id="vendorCatChips" role="group" aria-label="Vendor categories"></div>
      {/* The skeleton is the legacy function's own static markup (no data). Never re-rendered: see the note above. */}
      <div className="vd-grid" id="vendorsGrid" dangerouslySetInnerHTML={{ __html: skeleton }} />
      <div id="vendorsMapWrap" className="hidden">
        <div id="vendorsMapVendorRail"></div>
        <p className="muted" id="vendorsMapStatus" style={{ fontSize: ".82rem", margin: "0 0 1rem", lineHeight: 1.45 }}></p>
        <div id="vendorsMap" style={{ height: "min(60vh,420px)", borderRadius: ".9rem", overflow: "hidden", background: "var(--border)", position: "relative", isolation: "isolate", zIndex: 0 }}></div>
      </div>
    </div>
  );
}
