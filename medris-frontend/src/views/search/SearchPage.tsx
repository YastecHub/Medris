import { useLayoutEffect, useRef } from "react";
import { legacy, searchState } from "@/views/legacy-globals";
import "@/views/legacy-navigate"; // declares window.navigate

/**
 * The search page, drawn by React: the page frame (back button, search box, the five filter tabs, the scope note, the results area with
 * the "Recent searches" chips).
 *
 * Converted from renderSearchPage() (…/js/01-app/40-dedicated-search-page.js:37, its only definition): same markup, classes and ids, same
 * handlers (each calls the very same global the old inline attribute called). The recent searches come from the same saved list
 * (readSearchHistory); their text is rendered by React, so it is escaped.
 *
 * Everything that happens in the page stays with the existing code, which finds its elements by id and changes them in place: typing
 * and the delayed query, Enter, the filter tabs, the clear button, the suggestions and results (products, vendors, services, packages),
 * the "see more" scrolling, the scope note, the recent-searches buttons and the long-press on a result. React draws the frame ONCE and never
 * re-renders it (no state, no props), then does what the old router did after the old HTML landed: reset the filter to "All", focus the
 * box (again after 60 ms), draw the suggestions and bind the long-press on results.
 *
 * Until the legacy screen is deleted (a later pull request) any change must be made in BOTH places; the parity test
 * (tests/e2e/pilot-search.spec.ts) fails if they drift apart.
 */
type Fn = (...args: unknown[]) => unknown;
const call = (name: string, ...args: unknown[]) => {
  const fn = (window as unknown as Record<string, unknown>)[name];
  if (typeof fn === "function") return (fn as Fn)(...args);
};

const FILTERS = [
  ["all", "All", ""],
  ["products", "Products", "fa-bag-shopping"],
  ["vendors", "Vendors", "fa-store"],
  ["services", "Services", "fa-user-gear"],
  ["packages", "Packages", "fa-box-open"],
] as const;

export default function SearchPage() {
  const started = useRef(false);
  const history = (legacy("readSearchHistory")() as string[]) ?? [];

  useLayoutEffect(() => {
    if (started.current) return;
    started.current = true;
    searchState.reset();
    const input = () => document.getElementById("searchPageInput");
    input()?.focus();
    window.setTimeout(() => input()?.focus(), 60);
    void Promise.resolve(call("renderSearchPageSuggestions")).catch(() => undefined);
    call("bindSearchResultLongPress", document.getElementById("searchPageResults"));
  }, []);

  return (
    <div className="search-page">
      <div className="search-page-head">
        <div className="search-page-bar">
          <button type="button" className="search-page-back" onClick={() => window.navigate?.("home")} aria-label="Back">
            <i className="fa-solid fa-arrow-left"></i>
          </button>
          <div className="search-page-input-wrap">
            <i className="fa-solid fa-magnifying-glass"></i>
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              id="searchPageInput"
              placeholder="Search products, services, vendors…"
              autoComplete="off"
              onInput={() => call("scheduleSearchPageQuery")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  call("runSearchPageQuery", e.currentTarget.value.trim(), true);
                }
              }}
            />
            <button type="button" className="search-page-clear hidden" id="searchPageClearBtn" onClick={() => call("clearSearchPageInput")} aria-label="Clear search">
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>
        <div className="search-page-filters" role="tablist" aria-label="Search filters">
          {FILTERS.map(([id, label, icon]) => (
            <button key={id} type="button" className={`search-page-filter ${id === "all" ? "active" : ""}`} data-filter={id} role="tab" onClick={() => call("setSearchPageFilter", id)}>
              {icon ? <i className={`fa-solid ${icon}`} aria-hidden="true"></i> : null}
              {label}
            </button>
          ))}
        </div>
      </div>
      <div id="searchScopeNote" className="search-scope-note" hidden></div>
      <div id="searchPageResults" className="search-page-results">
        <div className="search-page-history-block" id="searchPageHistoryBlock" hidden={history.length === 0}>
          <div className="search-page-history-head">
            <span>Recent searches</span>
            <button type="button" onClick={() => call("clearSearchHistory")}>
              Clear
            </button>
          </div>
          <div className="search-page-history-chips" id="searchPageHistory">
            {history.map((q) => (
              <button key={q} type="button" className="search-page-chip" onClick={() => call("runSearchFromChip", q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
