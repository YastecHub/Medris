import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadStorefront, recordProfileView, type StorefrontExtras, type StorefrontProduct, type StorefrontVendor } from "@/services/storefront";
import { legacy, legacyState, storefrontState } from "@/views/legacy-globals";
import { inlineClick } from "@/views/inline-onclick";
import type { ViewProps } from "@/views";
import "@/views/legacy-navigate"; // declares window.navigate

/**
 * A vendor's public storefront, drawn by React: the page frame and the vendor's header.
 *
 * Converted from renderStorefrontInner() as it is after the legacy wrapper that blanks the empty cover text
 * (…/js/01-app/59-storefront-public-vendor-page.js:332, …/js/03-levromart-2026-09-09-vendor-logic-fixes.js:296): same markup,
 * classes and ids, same states (loading shell, "Storefront not found.", paused shop, "Couldn't load this storefront" with
 * Try again), same requests (see src/services/storefront.ts), same handlers (each calls the global the old inline attribute
 * called). All vendor/product text is rendered by React, so it is escaped.
 *
 * What stays with the existing code, because it finds its elements by id and changes them in place and its state lives in
 * legacy variables: the product/service grid, search box results and category chips (filterStorefrontProducts), the catalogue
 * tab switch, the follow button and its notification menu, the stats line, the packages panel and the reviews panel (all filled
 * by hydrateStorefrontExtras), the share modal, the profile-picture lightbox, the follower network. React draws the frame ONCE
 * when the data arrives and never re-renders it (no state after that), then asks the old code to do what renderStorefront()'s
 * caller (navigate) always did: fill the grid and hydrate the extras. Same approach as the Notifications and Vendors screens
 * ("React draws, the existing code acts").
 *
 * Until the legacy screen is deleted (a later pull request) any change must be made in BOTH places; the parity test
 * (tests/e2e/pilot-storefront.spec.ts) fails if they drift apart.
 */
type Fn = (...args: unknown[]) => unknown;
const L = () => window as unknown as Record<string, unknown>;
const call = (name: string, ...args: unknown[]) => {
  const fn = L()[name];
  if (typeof fn === "function") return (fn as Fn)(...args);
};

const FORMERLY_GRACE_DAYS = 14;
const CARD_HYDRATORS = ["hydrateProductCommentCountsInView", "hydrateProductVariantIndicatorsInView", "hydrateProductLikeCountsInView", "hydratePackageCommentCountsInView", "hydrateProductRatingsInView"];

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "not-found" }
  | { kind: "paused" }
  | { kind: "ready"; vendor: StorefrontVendor; products: StorefrontProduct[]; extras: () => Promise<StorefrontExtras> };

export default function StorefrontPage({ params }: ViewProps) {
  const vendorId = String(params.vendorId ?? "");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadStorefront(vendorId).then(
      (result) => !cancelled && setState(result),
      (error) => {
        console.warn("[Levromart] Storefront failed to load:", error);
        if (!cancelled) setState({ kind: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [vendorId]);

  if (state.kind === "loading") return <div dangerouslySetInnerHTML={{ __html: String(call("navigationShellHtml", "storefront") ?? "") }} style={{ display: "contents" }} />;
  if (state.kind === "not-found") return <div className="empty-state">Storefront not found.</div>;
  if (state.kind === "paused") {
    return (
      <div className="empty-state">
        <i className="fa-solid fa-store-slash" style={{ fontSize: "1.6rem", display: "block", marginBottom: "0.6rem" }}></i>This shop is currently paused. Check back later.
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="card" style={{ maxWidth: "480px", margin: "2rem auto", textAlign: "center" }}>
        <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: "2rem", color: "var(--primary)", marginBottom: ".65rem" }}></i>
        <h2 style={{ margin: ".1rem 0 .45rem" }}>Couldn't load this storefront</h2>
        <p className="muted" style={{ margin: "0 auto 1rem" }}>
          Check your connection and try again.
        </p>
        <div className="flex" style={{ justifyContent: "center", gap: ".5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => window.navigate?.("storefront", { vendorId }, false)}>
            <i className="fa-solid fa-rotate-right"></i> Try again
          </button>
          <button type="button" className="btn btn-outline" onClick={() => window.navigate?.("home")}>
            Go to marketplace
          </button>
        </div>
      </div>
    );
  }
  return <Storefront vendor={state.vendor} products={state.products} extras={state.extras} />;
}

function nameWithFormerly(v: StorefrontVendor) {
  const name = v.business_name ?? "";
  if (!v.previous_business_name || !v.name_changed_at) return <>{name}</>;
  const daysSince = (Date.now() - new Date(v.name_changed_at).getTime()) / 86400000;
  if (daysSince > FORMERLY_GRACE_DAYS) return <>{name}</>;
  return (
    <>
      {name}{" "}
      <span className="muted" style={{ fontWeight: 400, fontSize: "0.8em" }}>
        (formerly {v.previous_business_name})
      </span>
    </>
  );
}

function Distance({ v }: { v: StorefrontVendor }) {
  const km = (call("vendorDistanceKm", v) as number | null | undefined) ?? null;
  if (km == null) return null;
  const label = km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(1) + " km";
  const tier = legacy("lvDistTier")(km);
  return (
    <button
      type="button"
      className={`storefront-distance-link dt${tier}`}
      onClick={(e) => {
        e.stopPropagation();
        call("openVendorDistanceMap", v.id);
      }}
      title="View route to this vendor on the map"
      aria-label={`${label} away. View route on map`}
    >
      <i className="fa-solid fa-route"></i> {label} away
    </button>
  );
}

function Avatar({ v }: { v: StorefrontVendor }) {
  const name = v.business_name || "Vendor";
  const open = (url: string) => (e: React.MouseEvent) => call("openProfileImageLightbox", url, name, e.nativeEvent);
  if (v.logo_url) {
    return (
      <button type="button" className="storefront-avatar storefront-avatar-button" aria-label={`View ${name} profile picture`} onClick={open(v.logo_url)}>
        <img src={v.logo_url} alt="" data-lvimg="" onLoad={(e) => e.currentTarget.classList.add("lv-ld")} loading="eager" draggable={false} />
      </button>
    );
  }
  const hue = legacy("stableAvatarHue")(v.id);
  return (
    <button type="button" className="storefront-avatar storefront-avatar-button storefront-avatar-fallback-button" aria-label={`View ${name} profile picture`} onClick={open("")}>
      <span className="avatar-circle avatar-fallback" title={name} aria-label={name} style={{ width: "100%", height: "100%", ["--av-h" as string]: hue }}>
        <span aria-hidden="true">{legacy("initials")(name)}</span>
      </span>
    </button>
  );
}

function priceText(p: StorefrontProduct): string {
  const naira = legacy("naira");
  if (p.is_service) return `${naira(p.sale_price)}${call("servicePriceSuffix", p) ?? ""}`;
  if (p.sale_price != null) return naira(p.sale_price);
  if (p.rental_rate != null) return `${naira(p.rental_rate)}/${p.rental_rate_unit}`;
  return "View details";
}

function Storefront({ vendor: v, products, extras }: { vendor: StorefrontVendor; products: StorefrontProduct[]; extras: () => Promise<StorefrontExtras> }) {
  const started = useRef(false);
  const userId = legacyState.userId();
  const isOwn = !!userId && String(userId) === String(v.user_id);
  const isAdmin = legacyState.role() === "admin";

  // Runs once, right after the frame is in the page. The old router did the same two things after it put the
  // legacy HTML in the page: fill the grid, and hydrate stats / reviews / packages / follow state.
  useLayoutEffect(() => {
    if (started.current) return;
    started.current = true;
    (window as unknown as { __storefrontProducts: StorefrontProduct[] }).__storefrontProducts = products;
    (window as unknown as { __storefrontExpanded: boolean }).__storefrontExpanded = false;
    storefrontState.reset();
    call("updateStorefrontSocialMeta", v);
    if (!isOwn) recordProfileView(v.id);
    if (products.length) setTimeout(() => call("filterStorefrontProducts"), 0);
    // The old router also fills in live details on the product and package cards (comment/like counters, ratings)
    // right after the screen is in the page; here the cards exist once the grid is filled and the panels are hydrated.
    const hydrateCards = () =>
      setTimeout(() => {
        for (const name of CARD_HYDRATORS) {
          try {
            void Promise.resolve(call(name)).catch(() => undefined);
          } catch {
            /* one failing hydrator must not stop the others */
          }
        }
      }, 0);
    extras().then(
      ({ stats, reviews, packages, followState }) => {
        call("hydrateStorefrontExtras", v, products.length, stats, reviews, packages, followState, isOwn);
        hydrateCards();
      },
      (e) => {
        console.warn("[Levromart] Storefront extras hydration failed:", e);
        hydrateCards();
      },
    );
  }, [v, products, extras, isOwn]);

  const location = [v.address, v.city].filter(Boolean).join(", ") || "Online business";
  const years = call("yearsSince", v.created_at) as string | null;
  const hasCover = !!v.cover_url;
  const sectorIcon = v.sector?.icon || "fa-shapes";

  // The items of the "Store options" sheet (the old code built them once as menu items and renamed the class for the sheet).
  const sheetItems = [
    v.sector?.name ? (
      <div key="sector" className="levro-storefront-sheet-item">
        <i className={`fa-solid ${sectorIcon}`}></i> {v.sector.name}
      </div>
    ) : null,
    v.cac_number ? (
      <div key="cac" className="levro-storefront-sheet-item">
        <i className="fa-solid fa-building-columns"></i> CAC verified
      </div>
    ) : null,
    years ? (
      <div key="years" className="levro-storefront-sheet-item">
        <i className="fa-solid fa-calendar-check"></i> {years}
      </div>
    ) : null,
    v.opening_hours ? (
      <div key="hours" className="levro-storefront-sheet-item">
        <i className="fa-solid fa-clock"></i> {v.opening_hours}
      </div>
    ) : null,
    !isAdmin ? (
      <button key="suggest" type="button" className="levro-storefront-sheet-item" onClick={() => call("showSuggestionModal", "vendor", v.id)}>
        <i className="fa-solid fa-comment-medical"></i> Suggest something
      </button>
    ) : null,
    <button key="share" type="button" className="levro-storefront-sheet-item" ref={inlineClick(`openStorefrontShare('${v.id}');closeStorefrontMoreSheet()`)}>
      <i className="fa-solid fa-share-nodes"></i> Share storefront
    </button>,
  ];

  const productCount = products.filter((p) => !p.is_service).length;
  const serviceCount = products.filter((p) => !!p.is_service).length;
  const go = (view: string, params?: Record<string, unknown>) => window.navigate?.(view, params);

  return (
    <>
      <section className="storefront-profile" data-own-storefront={isOwn ? "1" : "0"}>
        <div className={`storefront-cover ${hasCover ? "has-custom-cover" : ""}`} style={hasCover ? { backgroundImage: `url('${v.cover_url}')` } : undefined}>
          {hasCover ? <div className="storefront-cover-overlay"></div> : <div className="storefront-cover-empty" aria-hidden="true"></div>}
          {isOwn ? (
            <label className="storefront-cover-edit" title="Edit storefront header" aria-label="Edit storefront header">
              <i className="fa-solid fa-pen"></i>
              <input type="file" accept="image/*" onChange={(e) => call("uploadVendorCover", e.nativeEvent)} />
            </label>
          ) : null}
          <button className="storefront-banner-more" type="button" aria-label="More vendor details" title="More vendor details" onClick={(e) => call("openStorefrontMoreSheet", e.nativeEvent)}>
            <i className="fa-solid fa-ellipsis"></i>
          </button>
        </div>
        <div className="storefront-profile-body">
          <div className="storefront-avatar-row">
            <Avatar v={v} />
          </div>
          <div className="storefront-profile-actions storefront-public-actions">
            {isOwn && !isAdmin ? (
              <button className="btn btn-sm btn-outline storefront-more-icon storefront-own-message-icon" type="button" aria-label="Messages" title="Messages" onClick={() => go("messages")}>
                <i className="fa-solid fa-comment-dots"></i>
              </button>
            ) : null}
            {!isOwn ? (
              <div className="storefront-follow-wrap" id="storefrontFollowWrap" data-follow-vendor-id={v.id}>
                <div className="storefront-follow-controls">
                  <button type="button" className="btn btn-sm btn-outline follow-btn follow-btn-icon" disabled aria-label="Loading follow status">
                    <i className="fa-solid fa-spinner fa-spin"></i>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="storefront-name-row">
            <h1 className="storefront-profile-name">
              {nameWithFormerly(v)} <i data-vt={v.id} className="fa-solid fa-circle-check vendor-inline-verified" aria-label="Verified vendor" title="Verified vendor"></i>
            </h1>
          </div>
          {v.bio ? (
            <section className="storefront-about" aria-label="Vendor description">
              <div className="storefront-bio-wrap" id="storefrontBioWrap">
                <p className="storefront-bio">{v.bio}</p>
                {v.bio.length > 160 ? (
                  <button type="button" className="storefront-bio-toggle" onClick={(e) => call("toggleStorefrontBio", e.currentTarget)}>
                    Read more
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
          <div className="storefront-meta">
            <span className="sf-loc">
              <i className="fa-solid fa-location-dot"></i> {location}
            </span>
            <Distance v={v} />
            {v.sector?.name ? (
              <span>
                <i className={`fa-solid ${sectorIcon}`}></i> {v.sector.name}
              </span>
            ) : null}
          </div>
          <div className="storefront-stats" id="storefrontStatsLine">
            <span>
              <strong>{products.length}</strong> listing{products.length === 1 ? "" : "s"}
            </span>
            <span className="storefront-stat-link" style={{ opacity: 0.55 }}>
              <strong>…</strong> reviews
            </span>
            <span className="storefront-stat-link" style={{ opacity: 0.55 }}>
              <strong>★ …</strong> rating
            </span>
            <span data-follow-count="" style={{ opacity: 0.55 }}>
              <strong>…</strong> followers
            </span>
          </div>
        </div>
      </section>
      <div className="levro-storefront-sheet-root" id="storefrontMoreSheetRoot">
        <div className="levro-storefront-sheet-backdrop" id="storefrontMoreSheetBackdrop" aria-hidden="true" onClick={() => call("closeStorefrontMoreSheet")}></div>
        <section className="levro-storefront-sheet" id="storefrontMoreSheet" role="dialog" aria-modal="true" aria-labelledby="storefrontMoreSheetTitle" aria-hidden="true">
          <div className="levro-sheet-handle" aria-hidden="true"></div>
          <div className="levro-sheet-head">
            <div>
              <h2 id="storefrontMoreSheetTitle">Store options</h2>
              <p>More information and actions for this storefront.</p>
            </div>
            <button type="button" className="levro-sheet-close" aria-label="Close" onClick={() => call("closeStorefrontMoreSheet")}>
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div className="levro-storefront-sheet-list">{sheetItems}</div>
        </section>
      </div>
      {products.length ? (
        <section className="storefront-featured">
          <div className="storefront-section-head">
            <h3>Latest from {v.business_name || "this shop"}</h3>
          </div>
          <div className="storefront-product-strip">
            {products.slice(0, 6).map((p) => {
              const img = p.photos?.[0];
              return (
                <div key={p.id} className="storefront-product-mini" onClick={() => go("productDetail", { productId: p.id })}>
                  {img ? (
                    <img src={legacy("lvThumb")(img, 240)} alt={p.name} loading="lazy" />
                  ) : (
                    <div className="mini-placeholder">
                      <i className="fa-solid fa-box"></i>
                    </div>
                  )}
                  <strong>{p.name}</strong>
                  <span>{priceText(p)}</span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      <div className="storefront-catalog-tabs" role="tablist" aria-label="Storefront catalogue">
        <button type="button" className="storefront-catalog-tab active" id="storefrontProductsTab" role="tab" aria-selected="true" onClick={() => call("switchStorefrontCatalogTab", "products")}>
          <i className="fa-solid fa-box"></i> Products{" "}
          <span className="tab-count" id="storefrontProductsCount">
            ({productCount})
          </span>
        </button>
        <button type="button" className="storefront-catalog-tab" id="storefrontServicesTab" role="tab" aria-selected="false" onClick={() => call("switchStorefrontCatalogTab", "services")}>
          <i className="fa-solid fa-hand-holding-heart"></i> Services{" "}
          <span className="tab-count" id="storefrontServicesCount">
            ({serviceCount})
          </span>
        </button>
        <button type="button" className="storefront-catalog-tab" id="storefrontPackagesTab" role="tab" aria-selected="false" onClick={() => call("switchStorefrontCatalogTab", "packages")}>
          <i className="fa-solid fa-box-open"></i> Packages{" "}
          <span className="tab-count" id="storefrontPackagesCount">
            (…)
          </span>
        </button>
      </div>
      <section className="storefront-packages storefront-tab-panel-hidden" id="storefrontPackagesSection">
        <div className="storefront-section-head">
          <h3>Special packages</h3>
        </div>
        <p className="muted">Loading…</p>
      </section>
      <section className="storefront-products-shell" id="storefrontProductsShell">
        <div className="storefront-section-head">
          <h3>Products & services</h3>
        </div>
        {products.length ? (
          <>
            <div className="storefront-products-toolbar">
              <div className="storefront-search-wrap">
                <i className="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="storefrontSearch" placeholder="Search this shop" onInput={() => call("filterStorefrontProducts")} />
              </div>
            </div>
            <div className="storefront-category-chips" id="storefrontCategoryChips"></div>
          </>
        ) : null}
        <div id="storefrontGrid" className="grid">
          {products.length ? <p className="muted">Loading…</p> : <div className="empty-state">No products or services listed yet.</div>}
        </div>
        <div className="storefront-view-more" id="storefrontViewMoreWrap"></div>
      </section>
      <section className="storefront-reviews" id="vendorReviews">
        <h3 style={{ marginTop: 0 }}>Reviews</h3>
        <p className="muted">Loading reviews…</p>
      </section>
    </>
  );
}
