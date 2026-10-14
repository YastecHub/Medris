import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { InitialsTile, ProductCard, type CardProduct } from "@/components/ProductCard";
import { loadProductDetail, loadVendorStatsRow, type PdProduct, type PdVariant, type ProductDetailResult } from "@/services/product-detail";
import { legacy, legacyState } from "@/views/legacy-globals";
import type { ViewProps } from "@/views";
import "@/views/legacy-navigate"; // declares window.navigate

/**
 * A product's page, drawn by React: the page frame (the product card, the buy / rent / admin / owner cards, the reviews and comments
 * containers, the "You may also need" shelf) and the states (loading shell, error, not found, not available).
 *
 * Converted from renderProductDetail() as it is after every legacy wrapper
 * (…/js/01-app/56-product-detail.js:99 and :110; the "You may also like" section appended by …/js/12-lv-onboarding-auth-js.js:243): same
 * markup, classes, ids and data attributes, same states, same requests (see src/services/product-detail.ts), and every control calls the
 * very same global the old inline attribute called (with the same event / element). All product, vendor and variety text is rendered by
 * React, so it is escaped. Prices, stock labels, delivery fees and distances come from the same legacy functions (see legacy-globals.ts).
 *
 * What stays with the existing code, because it finds its elements by id and changes them in place and keeps its state in legacy
 * variables: the photo gallery (swipe, thumbnails, variety following), choosing a variety, the quantity / rental total previews and the price
 * breakdown, the delivery method switch and the delivery-fee line, Place order / Add to cart / Reserve / Buy now, the owner's actions, the
 * reviews and comments panels, the share box, the "You may also like" shelf (appended by the old code to the page, as before), and
 * commission-service pages (the old code draws those: this page only asks it for its HTML and shows it). React draws the frame ONCE when the
 * data arrives and never re-renders it (no state after that), then does what the old router did after the old HTML landed.
 *
 * Until the legacy screen is deleted (a later pull request) any change must be made in BOTH places; the parity test
 * (tests/e2e/pilot-product-detail.spec.ts) fails if they drift apart.
 */
type Fn = (...args: unknown[]) => unknown;
const call = (name: string, ...args: unknown[]) => {
  const fn = (window as unknown as Record<string, unknown>)[name];
  if (typeof fn === "function") return (fn as Fn)(...args);
};
const go = (view: string, params?: Record<string, unknown>) => window.navigate?.(view, params);

const POST_RENDER_HYDRATORS = ["hydrateProductCommentCountsInView", "hydrateProductVariantIndicatorsInView", "hydrateProductLikeCountsInView", "hydratePackageCommentCountsInView", "hydrateProductRatingsInView"];

export default function ProductDetailPage({ params }: ViewProps) {
  const productId = String(params.productId ?? "");
  const [state, setState] = useState<ProductDetailResult | { kind: "loading" }>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadProductDetail(productId).then(
      (result) => !cancelled && setState(result),
      (error) => {
        console.warn("[Levromart] Product page failed to load:", error);
        if (!cancelled) setState({ kind: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (state.kind === "loading") return <div dangerouslySetInnerHTML={{ __html: String(call("navigationShellHtml", "productDetail") ?? "") }} style={{ display: "contents" }} />;
  return <Loaded productId={productId} params={params} result={state} />;
}

function Loaded({ productId, params, result }: { productId: string; params: Record<string, unknown>; result: ProductDetailResult }) {
  const started = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Runs once, right after the frame is in the page: what the old code did around its HTML landing.
  useLayoutEffect(() => {
    if (started.current) return;
    started.current = true;
    const host = rootRef.current?.parentElement ?? document.getElementById("levro-react-root");
    // A commission service is drawn by the existing code: its HTML goes into the page as it is, outside React.
    if (result.kind === "commission") host?.insertAdjacentHTML("beforeend", result.html);
    if (result.kind === "ready") {
      const w = window as unknown as Record<string, unknown>;
      const { product } = result;
      w.__productGalleryPhotos = product.photos;
      w.__productGalleryMainIndex = 0;
      w.__productGalleryVarietyOverride = false;
      w.__productGalleryIndex = 0;
      w.__lastRenderedProductPreview = product;
      try {
        call("syncLevromartLinkPreviewMeta", "productDetail", { productId: product.id });
      } catch {
        /* the link preview is optional */
      }
      // The owner's numbers: the old page asks for them for everyone and looks for the owner's number slots INSIDE the product
      // card, but the owner card is the next card, not inside it, so the numbers have never appeared. Kept exactly (same request,
      // same lookup) so both versions behave the same; fixing it is a separate change to both.
      window.setTimeout(async () => {
        try {
          const row = await loadVendorStatsRow(product.vendor.id);
          const root = document.querySelector(`.product-detail-card[data-product-detail-id="${CSS.escape(String(productId))}"]`);
          if (!root) return;
          const naira = legacy("naira");
          root.querySelector("[data-owner-stat=saved]")?.replaceChildren(document.createTextNode(Number(row.favorites_count ?? 0).toLocaleString()));
          root.querySelector("[data-owner-stat=revenue]")?.replaceChildren(document.createTextNode(naira(Number(row.revenue ?? 0))));
          root.querySelector("[data-owner-stat=sales]")?.replaceChildren(document.createTextNode(Number(row.sales_count ?? 0).toLocaleString()));
        } catch {
          /* the numbers stay at zero */
        }
      }, 0);
      window.setTimeout(() => call("hydrateProductReviewSection", product.id), 0);
    }
    // The old code appends the "You may also like" section to every product page, whatever the page says (even "not found"), and
    // fills it by itself (a watcher in the old scripts); it may also remove it when there is nothing to show. It is added the same
    // way here, outside React, so that removing it never disturbs React.
    const safe = String(productId).replace(/[^\w-]/g, "");
    host?.insertAdjacentHTML("beforeend", `<section class="lm-related" data-pid="${safe}"><h3 class="lm-related-title">You may also like</h3><div class="grid lm-related-grid"></div></section>`);

    // What the router does after a screen is in the page.
    try {
      call("initGallerySwipeSurfaces");
      call("initDeliveryFieldsOnPage");
    } catch {
      /* the page still works without them */
    }
    window.setTimeout(() => {
      for (const name of POST_RENDER_HYDRATORS) {
        try {
          void Promise.resolve(call(name)).catch(() => undefined);
        } catch {
          /* one failing hydrator must not stop the others */
        }
      }
      const name = result.kind === "ready" ? result.product.name : "";
      if (params.openComments) {
        try {
          call("openSocialCommentSheet", "product", params.productId, name ? `${name} · Comments` : "Comments");
        } catch {
          /* optional */
        }
      }
      if (params.scrollToReviews) window.setTimeout(() => document.querySelector(".product-reviews-card")?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    }, 0);
  }, [result, productId, params]);

  switch (result.kind) {
    case "error":
      return (
        <div className="empty-state" ref={rootRef}>
          <strong>Couldn't load this product.</strong>
          <p className="muted" style={{ margin: ".35rem 0 0" }}>
            Please try again. If the problem continues, the listing may be unavailable right now.
          </p>
        </div>
      );
    case "not-found":
      return (
        <div className="empty-state" ref={rootRef}>
          Product not found.
        </div>
      );
    case "unavailable":
      return (
        <div className="empty-state" ref={rootRef}>
          This product is not currently available.
        </div>
      );
    case "service-unavailable":
      return (
        <div className="empty-state" ref={rootRef}>
          This service is not currently available.
        </div>
      );
    case "commission":
      return null; // (added to the page by the effect above)
    case "ready":
      return <Product product={result.product} allowComments={result.allowComments} related={result.related} anchorRef={rootRef} />;
  }
}

function NameWithFormerly({ v }: { v: PdProduct["vendor"] }) {
  const name = v.business_name ?? "";
  if (!v.previous_business_name || !v.name_changed_at) return <>{name}</>;
  const daysSince = (Date.now() - new Date(v.name_changed_at).getTime()) / 86400000;
  if (daysSince > 14) return <>{name}</>;
  return (
    <>
      {name}{" "}
      <span className="muted" style={{ fontWeight: 400, fontSize: "0.8em" }}>
        (formerly {v.previous_business_name})
      </span>
    </>
  );
}

function ReadMore({ id, text }: { id: string; text: string }) {
  if (String(text || "").length <= 160) return <span id={id}>{text}</span>;
  return (
    <span className="read-more-wrap" id={id}>
      <span className="read-more-text clamped">{text}</span>{" "}
      <button type="button" className="read-more-toggle" onClick={() => call("toggleReadMore", id)}>
        Read more
      </button>
    </span>
  );
}

/** The delivery / pickup choice and its fee line (deliveryFieldsHtml + deliveryInfoLineHtml); the old code updates the fee line and the breakdown by id. */
function DeliveryFields({ prefix, product, pickupLabel }: { prefix: "buy" | "rent"; product: PdProduct; pickupLabel?: string }) {
  const naira = legacy("naira");
  const fee = Number(product.delivery_fee) || 0;
  const perKm = product.delivery_fee_per_km;
  const lat = product.vendor.lat;
  const lng = product.vendor.lng;
  const isDistance = product.delivery_fee_mode === "distance" && Number(perKm) > 0 && lat != null && lng != null;
  const hasVendorLoc = lat != null && lng != null;
  const loc = legacyState.buyerLocation();
  const address = legacyState.address();

  let infoLine: ReactNode = null;
  if (isDistance || hasVendorLoc) {
    if (isDistance && !loc) {
      infoLine = (
        <>
          <i className="fa-solid fa-truck"></i> {naira(Number(perKm))}/km ·{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              call("requestDeliveryEta", prefix);
            }}
          >
            Share location
          </a>{" "}
          to see your total delivery cost.
        </>
      );
    } else if (!loc) {
      infoLine = (
        <>
          <i className="fa-solid fa-location-crosshairs"></i>{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              call("requestDeliveryEta", prefix);
            }}
          >
            Share location
          </a>{" "}
          for an ETA.
        </>
      );
    } else {
      const km = legacy("haversineKm")(loc.lat, loc.lng, Number(lat), Number(lng));
      const eta = legacy("estimateDeliveryRange")(km);
      infoLine = isDistance ? (
        <>
          <i className="fa-solid fa-truck"></i> {naira(Number(perKm))}/km × {legacy("formatDistanceKm")(Math.max(1, km))}
          {km < 1 ? " (1 km minimum)" : ""} = <strong>{naira(legacy("distanceDeliveryFee")(Number(perKm), km))}</strong> · ~{eta}
        </>
      ) : (
        <>
          <i className="fa-solid fa-clock"></i> ~{eta} estimated
        </>
      );
    }
  }

  const label = pickupLabel || "Pickup";
  return (
    <>
      <div className="flex delivery-method-row" style={{ margin: "0.6rem 0 0.9rem", flexDirection: "row" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", margin: 0, fontWeight: 400 }}>
          <input type="radio" name={`${prefix}DeliveryMethod`} value="delivery" defaultChecked onChange={() => call("toggleDeliveryFields", prefix)} style={{ width: "auto", margin: 0 }} /> Delivery
          {isDistance ? " (by distance)" : fee > 0 ? (
            <>
              {" "}
              <strong className="delivery-fee-inline">(+{naira(fee)})</strong>
            </>
          ) : (
            " (free)"
          )}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", margin: 0, fontWeight: 400 }}>
          <input type="radio" name={`${prefix}DeliveryMethod`} value="pickup" onChange={() => call("toggleDeliveryFields", prefix)} style={{ width: "auto", margin: 0 }} /> {label}
        </label>
      </div>
      <div
        id={`${prefix}DeliveryFields`}
        className="dyn-delivery-fields"
        style={{ marginBottom: "0.9rem" }}
        data-vendor-lat={lat ?? ""}
        data-vendor-lng={lng ?? ""}
        data-fee={fee}
        data-fee-mode={product.delivery_fee_mode || "flat"}
        data-per-km={Number(perKm) || 0}
        data-pickup-label={label}
        data-item-total=""
      >
        <label className="df-label" htmlFor={`${prefix}Address`}>
          <i className="fa-solid fa-location-dot"></i> Delivery address
        </label>
        <input type="text" id={`${prefix}Address`} placeholder="Delivery address" defaultValue={address} />
        {!isDistance && fee > 0 ? (
          <p className="delivery-fee-line" style={{ margin: "0.35rem 0 0" }}>
            <i className="fa-solid fa-truck"></i> <strong>{naira(fee)}</strong> delivery fee
          </p>
        ) : null}
        {isDistance || hasVendorLoc ? (
          <p className="delivery-fee-line" style={{ margin: "0.35rem 0 0" }} id={`${prefix}FeeLine`}>
            {infoLine}
          </p>
        ) : null}
        <div id={`${prefix}PriceBreakdown`} className="price-breakdown-table" aria-live="polite"></div>
        <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.25rem" }}>
          Wrong?{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              go("editProfile");
            }}
          >
            Fix in profile
          </a>
          .
        </p>
      </div>
    </>
  );
}

function PriceHero({ o }: { o: { sale_price?: number | null; discount_price?: number | null } }) {
  const naira = legacy("naira");
  const now = legacy("effectivePrice")(o);
  const was = Number(o.sale_price);
  const off = now != null && Number.isFinite(was) && now < was;
  return (
    <>
      <span className="pph-now">{naira(now)}</span>
      {off ? (
        <>
          <span className="pph-was">{naira(was)}</span>
          <span className="pph-save">
            Save {naira(was - (now as number))} · {Math.round((1 - (now as number) / was) * 100)}% off
          </span>
        </>
      ) : null}
    </>
  );
}

function Product({ product, allowComments, related, anchorRef }: { product: PdProduct; allowComments: boolean; related: CardProduct[]; anchorRef: React.RefObject<HTMLDivElement | null> }) {
  const naira = legacy("naira");
  const effectivePrice = legacy("effectivePrice");
  const role = legacyState.role();
  const isAdmin = role === "admin";
  const ownListing = legacy("isOwnVendorId")(product.vendor?.id);
  const canRent = !ownListing && (product.listing_type === "rent" || product.listing_type === "both");
  const canBuy = !ownListing && (product.listing_type === "sale" || product.listing_type === "both");
  const variants: PdVariant[] = product.variants.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const photos = product.photos;
  const depositPercent = Math.max(1, Math.min(99, Number(product.payment_deposit_percent ?? 20) || 20));
  const remainingPercent = 100 - depositPercent;
  const cleanDescription = legacy("stripProductVariantMeta")(product.description || "");
  const isFav = legacyState.isFavorite(product.id);
  const vendor = product.vendor;
  const st = { avg_rating: vendor?.avg_rating ?? 0, review_count: vendor?.review_count ?? 0 };
  const commentCount = (window as unknown as { __productCommentCounts?: Map<string, unknown> }).__productCommentCounts?.get?.(String(product.id)) ?? "";
  const unitPrice = (v: PdVariant) => Number(v.discount_price ?? v.sale_price ?? v.rental_rate ?? 0);


  const statItems = [
    !product.is_service && !variants.length && product.track_quantity !== false ? { label: "Available", value: `${product.quantity_available} / ${product.quantity_total}` } : null,
    product.sale_price != null && product.is_service ? { label: "Price", value: naira(effectivePrice(product)) + legacy("servicePriceSuffix")(product) } : null,
    product.rental_rate != null ? { label: "Rent", value: `${naira(product.rental_rate)} per ${product.rental_rate_unit}` } : null,
    product.deposit_amount ? { label: "Refundable deposit", value: naira(product.deposit_amount) } : null,
  ].filter((s): s is { label: string; value: string } => !!s);

  const toggleFav = (event: MouseEvent<HTMLButtonElement>) => legacy("toggleFavorite")(event, product.id);

  return (
    <>
      <div className="card product-detail-card" data-product-detail-id={product.id} style={{ position: "relative" }} ref={anchorRef}>
        <div className="product-detail-top-actions" aria-label="Product actions">
          <button className={`fav-btn ${isFav ? "active" : ""}`} onClick={toggleFav} title="Save to wishlist" aria-label="Save to wishlist">
            {isFav ? <i className="fa-solid fa-heart"></i> : <i className="fa-regular fa-heart"></i>}
          </button>
          <button type="button" className="product-storefront-share-btn lv-top-comment-btn" onClick={() => call("lvOpenProductComments", product.id)} title="Comments" aria-label="Open comments">
            <span className="lv-cbubble">
              <i className="fa-solid fa-comment-dots"></i>
              <b className="lv-ccount" data-product-id={product.id}>
                {String(commentCount)}
              </b>
            </span>
          </button>
          <button type="button" className="product-storefront-share-btn" onClick={() => call("openProductShare", product.id)} title="Share product" aria-label="Share product">
            <i className="fa-solid fa-share-nodes"></i>
          </button>
        </div>
        <h2 className="product-detail-title">
          {product.name}
          {product.is_service ? (
            <>
              {" "}
              <span className="badge">Service</span>
            </>
          ) : null}
        </h2>
        <div className="product-detail-media">
          {photos.length ? (
            <div className="product-gallery product-gallery-carousel">
              <div className="product-gallery-stage">
                <div className="product-gallery-main product-gallery-track" id="productGalleryTrack" aria-label="Product photos">
                  {photos.map((u, i) => (
                    <div key={i} className="product-gallery-slide" data-gallery-index={i} onClick={(e) => call("openProductGallerySlide", e, i)}>
                      <img src={u} alt={`${product.name} photo ${i + 1}`} loading={i === 0 ? "eager" : "lazy"} decoding="async" draggable={false} {...(i === 0 ? { fetchPriority: "high" as const } : {})} />
                    </div>
                  ))}
                </div>
                {photos.length > 1 ? (
                  <span className="product-gallery-count">
                    <i className="fa-solid fa-images"></i> <span id="productGalleryCount">1</span>/{photos.length}
                  </span>
                ) : null}
              </div>
              {photos.length > 1 ? (
                <div className="product-gallery-thumbs" aria-label="Product photo varieties">
                  {photos.map((u, i) => (
                    <button key={i} type="button" className={`product-gallery-thumb ${i === 0 ? "active" : ""}`} data-gallery-index={i} onClick={() => call("setProductGalleryPhoto", i)} aria-label={`View product photo ${i + 1}`}>
                      <img src={u} alt="" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              ) : null}
              <button type="button" id="productGalleryReturnMain" className="product-gallery-return-main hidden" onClick={() => call("restoreProductGalleryMainImage")} aria-label="Return to main product image">
                <i className="fa-solid fa-arrow-left"></i> Main image
              </button>
            </div>
          ) : (
            <div className="product-img" style={{ height: "220px" }}>
              {vendor?.logo_url ? (
                <img
                  src={vendor.logo_url}
                  alt={vendor.business_name || "Vendor"}
                  onError={(e) => {
                    const img = e.currentTarget;
                    img.outerHTML = String(call("lvInitialsTileHtml", img.alt));
                  }}
                />
              ) : (
                <InitialsTile name={vendor?.business_name || product.name} />
              )}
            </div>
          )}
        </div>
        {variants.length && variants.some((v) => !v.photo_url) ? (
          <div className="product-gallery-varieties" id="productGalleryVarieties">
            <div className="product-gallery-varieties-head">
              <strong>Varieties</strong>
              <span className="muted" style={{ fontSize: ".68rem" }}>
                {variants.length} option{variants.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="product-gallery-varieties-list">
              {variants.map((v, i) => {
                const unit = unitPrice(v);
                const photo = v.photo_url || "";
                return (
                  <button key={v.id} type="button" className={`product-gallery-variety ${i === 0 ? "active" : ""}`} data-gallery-variety-id={v.id} onClick={() => call("selectProductVariant", v.id, true, true)}>
                    {photo ? (
                      <img src={photo} alt={v.name || `Variety ${i + 1}`} loading="lazy" decoding="async" />
                    ) : (
                      <span className="product-gallery-variety-placeholder">
                        <i className="fa-solid fa-layer-group"></i>
                      </span>
                    )}
                    <strong>{v.name || `Variety ${i + 1}`}</strong>
                    <small>{unit > 0 ? naira(unit) : "Price on request"}</small>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {variants.length ? (
          <div className="product-gallery-variant-meta" id="productGalleryVariantMeta">
            <span className="product-gallery-variant-label">Selected variety:</span>
            <strong id="productGalleryVariantName">{variants[0]!.name || "Selected variety"}</strong>
            <strong id="productGalleryVariantPrice">Price: {naira(Number(effectivePrice(variants[0]) ?? variants[0]!.rental_rate ?? 0))}</strong>
          </div>
        ) : null}
        <div className="product-detail-actions">
          <span className={`badge ${legacy("ratingBadgeClass")(Number(st.avg_rating ?? 0))}`}>
            <i className="fa-solid fa-star"></i> {Number(st.avg_rating ?? 0).toFixed(1)} ({Number(st.review_count ?? 0)})
          </span>
        </div>
        <div className="product-detail-info">
          <p>
            <strong>Vendor:</strong>{" "}
            <a
              className="product-detail-vendor-link"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                go("storefront", { vendorId: vendor.id });
              }}
            >
              {vendor.logo_url ? (
                <img src={vendor.logo_url} alt="" className="product-detail-vendor-logo" loading="lazy" decoding="async" draggable={false} />
              ) : (
                <span
                  className="avatar-circle avatar-fallback product-detail-vendor-logo"
                  title={vendor.business_name || "Vendor"}
                  aria-label={vendor.business_name || "Vendor"}
                  style={{ width: "2.4rem", height: "2.4rem", ["--av-h" as string]: legacy("stableAvatarHue")(vendor.id) }}
                >
                  <span aria-hidden="true">{legacy("initials")(vendor.business_name || "Vendor")}</span>
                </span>
              )}
              <span>
                <NameWithFormerly v={vendor} />
              </span>
            </a>
          </p>
          {product.is_service || !product.condition ? null : (
            <p className="pd-condition">
              <strong>Condition:</strong> <span className="pd-chip">{(product.condition || "").replace("-", " ")}</span>
            </p>
          )}
          <details className="pd-about">
            <summary>
              <span>
                <i className="fa-solid fa-circle-info"></i> About this {product.is_service ? "service" : "product"}
              </span>
              <i className="fa-solid fa-chevron-down pd-about-chev"></i>
            </summary>
            <div className="pd-about-body">
              <ReadMore id={`productDescText-${product.id}`} text={cleanDescription || "No description provided."} />
            </div>
          </details>
        </div>
        {product.sale_price != null && !product.is_service ? (
          <div className="product-price-hero" id="productPriceHero">
            <div className="pph-label">{variants.length ? "Price · selected variety" : "Buy price"}</div>
            <div className="pph-row" id="productPriceHeroBody">
              <PriceHero o={variants.length ? variants[0]! : product} />
            </div>
          </div>
        ) : null}
        {statItems.length ? (
          <div className="product-detail-stats">
            {statItems.map((s) => (
              <div key={s.label}>
                <span className="muted">{s.label}</span>
                <strong>{s.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {isAdmin ? (
        <div className="card">
          <p className="muted">
            <i className="fa-solid fa-circle-info"></i> Admin accounts can't make purchases on Levromart.
          </p>
        </div>
      ) : canRent ? (
        <RentCard product={product} depositPercent={depositPercent} remainingPercent={remainingPercent} />
      ) : null}
      {!isAdmin && canBuy ? <BuyCard product={product} variants={variants} cleanDescription={cleanDescription} depositPercent={depositPercent} remainingPercent={remainingPercent} /> : null}
      {ownListing ? <OwnerCard product={product} /> : null}

      <div className="card product-reviews-card">
        <h3 style={{ marginTop: 0 }}>
          <i className="fa-solid fa-star"></i> Ratings &amp; reviews
        </h3>
        <div id={`productReviewsBody-${product.id}`} className="product-reviews-body">
          <p className="muted">Loading reviews…</p>
        </div>
      </div>
      <div className="card product-comments-card" data-product-comments-id={product.id}>
        <button
          type="button"
          className={`product-comments-toggle ${allowComments ? "" : "disabled"}`}
          onClick={allowComments ? () => call("toggleProductComments", product.id) : undefined}
          aria-expanded="false"
          aria-label={allowComments ? "Show product comments" : "Comments disabled"}
        >
          <span>
            <i className="fa-regular fa-comment"></i>
            <strong id="productCommentsCount" data-product-id={product.id}>
              0
            </strong>
          </span>
          <i className="fa-solid fa-chevron-down"></i>
        </button>
        <div id="productCommentsPanel" className="product-comments-panel hidden"></div>
      </div>
      {related.length ? (
        <>
          <h3 className="section-title">You may also need</h3>
          <div className="hscroll">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function PaymentNotice({ product, text }: { product: PdProduct; text: string }) {
  const after = product.payment_timing === "pay_after";
  return (
    <div className={`product-payment-plan-notice ${after ? "pay-after" : "pay-before"}`}>
      <strong>
        <i className="fa-solid fa-wallet"></i> {after ? "Pay after delivery" : "Pay before delivery"}
      </strong>
      <span>{text}</span>
    </div>
  );
}

function RentCard({ product, depositPercent, remainingPercent }: { product: PdProduct; depositPercent: number; remainingPercent: number }) {
  const today = new Date().toISOString().slice(0, 10);
  const preview = () => call("updateRentTotalPreview", product.rental_rate, product.rental_rate_unit);
  return (
    <div className="card">
      <h3>
        <i className="fa-solid fa-calendar-days"></i> Rent this item
      </h3>
      <div className="flex">
        <input type="date" id="rentStart" min={today} onInput={preview} />
        <input type="date" id="rentEnd" min={today} onInput={preview} />
        <input type="number" id="rentQty" defaultValue="1" min="1" max={product.quantity_total ?? undefined} placeholder="Qty" onInput={preview} style={{ width: "90px" }} />
      </div>
      <p className="muted" id="rentTotalPreview">
        Pick your dates to see the total.
      </p>
      {!product.is_service ? (
        <PaymentNotice
          product={product}
          text={product.payment_timing === "pay_after" ? `Pay ${depositPercent}% first; the remaining ${remainingPercent}% is due after delivery.` : "Full payment is required before delivery. If you need a different arrangement, please contact the vendor."}
        />
      ) : null}
      <DeliveryFields prefix="rent" product={product} />
      <button className="btn" onClick={() => call("confirmRental", product.vendor.id, product.id)}>
        Reserve
      </button>
      <p id="rentError" className="error-text hidden"></p>
    </div>
  );
}

function BuyCard({ product, variants, cleanDescription, depositPercent, remainingPercent }: { product: PdProduct; variants: PdVariant[]; cleanDescription: string; depositPercent: number; remainingPercent: number }) {
  const naira = legacy("naira");
  const effectivePrice = legacy("effectivePrice");
  const buyLabel = product.is_service ? "Book Now" : "Place order";
  const isTimedService = !!product.is_service && !!product.service_price_unit && product.service_price_unit !== "flat";
  // Items that are not counted in stock (made to order, etc.) show no stock number and no quantity box here.
  const hideQty = !product.is_service && product.track_quantity === false;
  const first = variants[0];
  const rawTotal = first ? Number(effectivePrice(first) ?? effectivePrice(product)) : effectivePrice(product);
  return (
    <div className="card">
      <h3>
        <i className={`fa-solid ${product.is_service ? "fa-calendar-check" : "fa-cart-shopping"}`}></i> {buyLabel}
      </h3>
      {first ? <input type="hidden" id="selectedProductVariantId" defaultValue={first.id} /> : null}
      {first ? (
        <div className="selected-variant-summary sv-card" id="selectedVariantSummary">
          <div className="sv-top">
            <div className="sv-name">
              <span className="sv-label">Selected variety</span>
              <strong id="selectedVariantName">{first.name}</strong>
            </div>
            <strong id="selectedVariantPrice" className="sv-price">
              {naira(Number(effectivePrice(first) ?? 0))}
            </strong>
          </div>
          {hideQty ? null : (
            <div className="sv-stock muted">
              Available: <span id="selectedVariantStock">{legacy("variantStockLabel")(first)}</span>
            </div>
          )}
          <details className="sv-details">
            <summary>
              About this variety <i className="fa-solid fa-chevron-down"></i>
            </summary>
            <p id="selectedVariantDescription" className="muted">
              {first.description || cleanDescription || "No variety-specific description is stored."}
            </p>
          </details>
        </div>
      ) : null}
      <div className={`pd-qty-row${hideQty ? " pd-no-qty" : ""}`}>
        {hideQty ? (
          <input type="hidden" id="buyQty" defaultValue="1" />
        ) : (
          <div className="pd-qty-box">
            <span className="df-label">Quantity</span>
            <div className="flex" style={{ margin: 0 }}>
              {isTimedService ? (
                <div>
                  <label style={{ margin: 0 }}>Number of {product.service_price_unit}s</label>
                  <input type="number" id="buyQty" defaultValue="1" min="1" onInput={() => call("updateServiceTotalPreview", product.sale_price, product.service_price_unit)} style={{ width: "140px" }} />
                </div>
              ) : (
                <input type="number" id="buyQty" defaultValue="1" min="1" placeholder="Qty" onInput={() => call("updateBuyTotalPreview", effectivePrice(product) ?? 0)} style={{ width: "90px" }} />
              )}
            </div>
          </div>
        )}
        <div className={`pd-total-box ${product.is_service ? "" : "pd-has-plan"}`}>
          {product.sale_price != null ? (
            <p className="muted" id="serviceTotalPreview" data-raw-total={String(rawTotal)}>
              Total: {naira(rawTotal)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="pd-step-title">
        <i className="fa-solid fa-truck-fast"></i> How do you want it?
      </div>
      <DeliveryFields prefix="buy" product={product} pickupLabel={product.is_service ? "In-person" : "Pickup"} />
      {!product.is_service ? (
        <div className="pd-pay-notice">
          <PaymentNotice product={product} text={product.payment_timing === "pay_after" ? `Pay ${depositPercent}% now, ${remainingPercent}% after delivery.` : "Full payment is needed before delivery."} />
        </div>
      ) : null}
      {!product.is_service ? (
        <div className="pd-note-box">
          <label className="df-label" htmlFor="buyNote">
            <svg className="lv-pen-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7.4 18.6l-4 1 1-4z" />
            </svg>{" "}
            Note for the vendor <span className="df-hint">(optional)</span>
          </label>
          <textarea id="buyNote" rows={2} placeholder="e.g. I'd like the blue one, or a size 42"></textarea>
        </div>
      ) : null}
      <div className="flex pd-buy-actions">
        {!product.is_service ? (
          <button
            id="productAddToCartBtn"
            className="btn btn-outline"
            onClick={() => call("addToCart", product.id, parseInt((document.getElementById("buyQty") as HTMLInputElement | null)?.value ?? "") || 1)}
          >
            <i className="fa-solid fa-cart-plus"></i> Add to cart
          </button>
        ) : null}
        <button className="btn" onClick={() => call("buyNow", product.vendor.id, product.id)}>
          {buyLabel}
        </button>
      </div>
      <p id="buyError" className="error-text hidden"></p>
    </div>
  );
}

function OwnerCard({ product }: { product: PdProduct }) {
  const naira = legacy("naira");
  const ownerPaid = product.billing_model !== "monthly" || legacy("listingActivationValid")(product);
  const status = product.status;
  return (
    <div className="card owner-listing-management">
      <div className="owner-listing-head">
        <div>
          <span className="muted">Your listing</span>
          <h3 style={{ margin: ".15rem 0 0" }}>Manage this listing</h3>
        </div>
        <span className={`badge ${status === "active" ? "success" : "warning"}`}>{status || "paused"}</span>
      </div>
      <div className="owner-listing-stats">
        <div>
          <span>Views</span>
          <strong>{Number(product.view_count || 0).toLocaleString()}</strong>
        </div>
        <div>
          <span>Saved</span>
          <strong data-owner-stat="saved">0</strong>
        </div>
        <div>
          <span>Revenue</span>
          <strong data-owner-stat="revenue">{naira(0)}</strong>
        </div>
        <div>
          <span>Sales</span>
          <strong data-owner-stat="sales">0</strong>
        </div>
      </div>
      <div className="owner-listing-actions">
        <button type="button" className="btn btn-sm" onClick={() => call("openEditProductModal", product.id)}>
          <i className="fa-solid fa-pen"></i> Edit
        </button>
        {status === "active" ? (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => call("setProductStatus", product.id, "paused")}>
            Pause
          </button>
        ) : ownerPaid ? (
          <button type="button" className="btn btn-sm" onClick={() => call("setProductStatus", product.id, "active")}>
            Activate
          </button>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => call("startListingMonthlyPayment", "product", product.id)}>
            <i className="fa-solid fa-credit-card"></i> Pay ₦999
          </button>
        )}
        <button type="button" className="btn btn-sm btn-danger" onClick={() => call("removeProduct", product.id)}>
          <i className="fa-solid fa-trash"></i> Remove
        </button>
      </div>
      {product.variants?.length ? (
        <p className="muted owner-listing-variant-note">
          <i className="fa-solid fa-layer-group"></i> {product.variants.length} variety{product.variants.length === 1 ? "" : "ies"} configured.
        </p>
      ) : null}
    </div>
  );
}
