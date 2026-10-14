import { useEffect, useState, type MouseEvent } from "react";
import { legacy, legacyState } from "@/views/legacy-globals";
import "@/views/legacy-navigate"; // declares window.navigate

/**
 * The marketplace product card, drawn by React.
 *
 * One-to-one copy of productCardHtml() (src/legacy/assets/js/01-app/43-browse-everything-data-light-index-24-at.js:280),
 * which is the only definition: same markup, same classes, same data-* attributes (data-product-id, data-vendor-id),
 * same rules for price, discount, delivery total, distance badge, service listings, own listing and quick add.
 * Rules and helpers are NOT copied: price text, thumbnails, distance maths and "is this my listing" call the same
 * legacy functions (see src/views/legacy-globals.ts). The buttons call the legacy handlers too (toggleFavorite,
 * handleProductImageTap, quickAddToCart), which receive the same event and element they used to.
 * Text from the database is rendered by React (escaped).
 *
 * Until the legacy builder is deleted (a later pull request) any change must be made in BOTH places; the parity test
 * of every screen that shows cards fails if they drift apart.
 */
export interface CardVendor {
  id?: string;
  business_name?: string | null;
  logo_url?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  delivery_fee?: number | string | null;
  delivery_fee_mode?: string | null;
  delivery_fee_per_km?: number | string | null;
}

export interface CardProduct {
  id: string;
  name: string;
  photos?: string[] | null;
  is_service?: boolean | null;
  billing_model?: string | null;
  listing_type?: string | null;
  sale_price?: number | null;
  discount_price?: number | null;
  rental_rate?: number | null;
  rental_rate_unit?: string | null;
  delivery_fee?: number | string | null;
  delivery_fee_mode?: string | null;
  delivery_fee_per_km?: number | string | null;
  vendor_id?: string | null;
  vendor?: CardVendor | null;
}

/** The coloured tile the legacy code swaps in for a missing or broken picture (lvInitialsTileHtml). */
function InitialsTile({ name }: { name: string }) {
  const n = String(name || "Levromart");
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
  return (
    <span className="img-initials" style={{ ["--ih" as string]: h }} aria-label={n}>
      {legacy("lvInitials")(n)}
    </span>
  );
}

export function ProductCard({ product: p, context }: { product: CardProduct; context?: "wishlist" }) {
  const L = {
    naira: legacy("naira"),
    lvThumb: legacy("lvThumb"),
    isOwnVendorId: legacy("isOwnVendorId"),
    haversineKm: legacy("haversineKm"),
    distanceDeliveryFee: legacy("distanceDeliveryFee"),
    lvDistTier: legacy("lvDistTier"),
    lvDistTitle: legacy("lvDistTitle"),
  };
  const img = p.photos?.[0];

  // Legacy remembers every card's photos for the product page's instant preview.
  useEffect(() => {
    try {
      (window.__productPhotoCache ||= {})[p.id] = Array.isArray(p.photos) ? p.photos : [];
    } catch {
      /* ignore */
    }
  }, [p.id, p.photos]);

  const commissionService = !!p.is_service && p.billing_model !== "monthly";
  const isFav = legacyState.isFavorite(p.id);
  const ownListing = L.isOwnVendorId(p.vendor?.id);
  const canQuickAdd = !ownListing && !p.is_service && (p.listing_type === "sale" || p.listing_type === "both") && legacyState.role() !== "admin";

  const hasDiscount = p.discount_price != null && Number(p.discount_price) > 0 && Number(p.discount_price) < Number(p.sale_price ?? Infinity);
  const hasVariety = Array.isArray(p.photos) && p.photos.length > 1;

  const cardItemPrice = hasDiscount ? Number(p.discount_price) : Number(p.sale_price);
  const deliveryMode = String(p.delivery_fee_mode ?? p.vendor?.delivery_fee_mode ?? "free").toLowerCase();
  const deliveryFlatFee = Number(p.delivery_fee ?? p.vendor?.delivery_fee ?? 0) || 0;
  const cardPerKm = Number(p.delivery_fee_per_km ?? p.vendor?.delivery_fee_per_km ?? 0) || 0;
  const loc = legacyState.buyerLocation();
  const hasVendorPoint = p.vendor?.lat != null && p.vendor?.lng != null;
  // null = distance-priced and the buyer's location is not known yet (same rule as the legacy card).
  const cardDeliveryFee: number | null =
    deliveryMode === "free"
      ? 0
      : deliveryMode === "distance"
        ? cardPerKm <= 0
          ? 0
          : !hasVendorPoint
            ? deliveryFlatFee
            : loc
              ? L.distanceDeliveryFee(cardPerKm, L.haversineKm(loc.lat, loc.lng, Number(p.vendor!.lat), Number(p.vendor!.lng)))
              : null
        : deliveryFlatFee;

  let distance: { tier: number; title: string; label: string } | null = null;
  try {
    if (loc && hasVendorPoint) {
      const km = L.haversineKm(loc.lat, loc.lng, Number(p.vendor!.lat), Number(p.vendor!.lng));
      if (Number.isFinite(km)) {
        distance = { tier: L.lvDistTier(km), title: L.lvDistTitle(km), label: km < 1 ? Math.max(50, Math.round(km * 10) * 100) + " m" : km.toFixed(1) + " km" };
      }
    }
  } catch {
    /* no distance badge */
  }

  // The wishlist page keeps the explicit heart button; every other card uses double-tap on the photo.
  const showFavBtn = context === "wishlist";
  const vendorName = p.vendor?.business_name || "";

  const actionNode = p.is_service ? (
    <span className="card-service-btn" title="Service listing" aria-label="Service listing">
      <i className="fa-solid fa-hand-holding-heart"></i>
    </span>
  ) : canQuickAdd ? (
    <button
      type="button"
      className="card-cart-btn"
      onClick={(event: MouseEvent<HTMLButtonElement>) => legacy("quickAddToCart")(event, p.id, event.currentTarget, p.vendor?.id || "")}
      title="Add to cart"
      aria-label={`Add ${p.name} to cart`}
    >
      <i className="fa-solid fa-cart-plus"></i>
    </button>
  ) : ownListing ? (
    <span className="badge own-listing-badge" title="You can't buy your own listing">
      <i className="fa-solid fa-store"></i> Your listing
    </span>
  ) : null;

  let price: React.ReactNode = "";
  if (!commissionService) {
    if (p.sale_price != null) {
      price = hasDiscount ? (
        <>
          <span className="product-old-price">{L.naira(p.sale_price)}</span> <span className="product-current-price">{L.naira(p.discount_price)}</span>
        </>
      ) : (
        L.naira(p.sale_price)
      );
    } else if (p.rental_rate != null) {
      price = `${L.naira(p.rental_rate)}/${p.rental_rate_unit}`;
    }
  }
  const hasPrice = !commissionService && (p.sale_price != null || p.rental_rate != null);

  let total: React.ReactNode;
  if (!commissionService && !p.is_service && p.sale_price != null) {
    total =
      cardDeliveryFee == null ? (
        <div className="product-card-total-line" title="Delivery fee">
          <i className="fa-solid fa-truck" aria-hidden="true"></i>
          <span className="product-card-total-label">Delivery</span>
          <strong>{L.naira(cardPerKm)}/km</strong>
        </div>
      ) : (
        <div className="product-card-total-line" title="Total with delivery">
          <i className="fa-solid fa-truck" aria-hidden="true"></i>
          <span className="product-card-total-label">Total</span>
          <strong>{L.naira(cardItemPrice + cardDeliveryFee)}</strong>
        </div>
      );
  } else if (p.is_service) {
    total = (
      <div className="product-card-total-line card-svc-cta">
        <i className="fa-solid fa-comments-dollar" aria-hidden="true"></i>
        <span className="product-card-total-label">Name your price</span>
        <i className="fa-solid fa-chevron-right" aria-hidden="true"></i>
      </div>
    );
  } else {
    total = (
      <div className="product-card-total-line" style={{ visibility: "hidden" }}>
        &nbsp;
      </div>
    );
  }

  return (
    <div className="product-card-wrap product-card-compact" data-product-id={p.id} data-vendor-id={p.vendor?.id || p.vendor_id || ""}>
      {showFavBtn ? (
        <button
          className={`fav-btn ${isFav ? "active" : ""}`}
          onClick={(event: MouseEvent<HTMLButtonElement>) => legacy("toggleFavorite")(event, p.id)}
          title="Save to wishlist"
        >
          {isFav ? <i className="fa-solid fa-heart"></i> : <i className="fa-regular fa-heart"></i>}
        </button>
      ) : null}
      <div
        className="card"
        style={{ cursor: "pointer" }}
        onClick={showFavBtn ? () => window.navigate?.("productDetail", { productId: p.id }) : (event) => legacy("handleProductImageTap")(event, p.id)}
      >
        <div className="product-img">
          {img ? (
            <img src={L.lvThumb(img, 280)} alt={p.name} loading="lazy" decoding="async" draggable={false} />
          ) : p.vendor?.logo_url ? (
            <VendorLogoFill src={p.vendor.logo_url} alt={p.vendor.business_name || "Vendor"} />
          ) : (
            <InitialsTile name={p.vendor?.business_name || p.name} />
          )}
          {showFavBtn ? null : (
            <span className="product-wish-bounce">
              <i className="fa-solid fa-heart"></i>
            </span>
          )}
        </div>
        <h4>
          <span className="pc-title-row">
            <span className="pc-vlogo-wrap">
              {p.vendor?.logo_url ? (
                <img className="pc-vlogo" src={p.vendor.logo_url} alt="" loading="lazy" decoding="async" draggable={false} />
              ) : (
                <span className="pc-vlogo pc-vlogo-txt">{String(vendorName || "?").trim().charAt(0).toUpperCase()}</span>
              )}
            </span>
            <span className="pc-name">{p.name}</span>
          </span>
        </h4>
        <div className="product-card-compact-footer">
          {hasPrice ? (
            <span className="product-card-compact-price">
              {price}
              {hasVariety ? <i className="fa-solid fa-layer-group product-variety-indicator" title="Multiple varieties available" aria-label="Multiple varieties available"></i> : null}
            </span>
          ) : (
            <span></span>
          )}
        </div>
        <div className="product-card-meta">
          {commissionService ? (
            <span className="card-svc-tag">
              <i className="fa-solid fa-handshake"></i> Negotiable
            </span>
          ) : distance ? (
            <div className={`product-card-dist dt${distance.tier}`} title={distance.title}>
              <i className="fa-solid fa-location-dot" aria-hidden="true"></i>
              {distance.label}
            </div>
          ) : (
            <span></span>
          )}
          {actionNode}
        </div>
        {total}
      </div>
    </div>
  );
}

/**
 * The vendor's logo filling the picture slot of a product without a photo. Like the legacy markup (which has an
 * inline onerror), a broken logo becomes the initials tile; a broken PRODUCT photo has no handler of its own and is
 * handled by the app's global broken-image fallback, exactly as before.
 */
function VendorLogoFill({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <InitialsTile name={alt} />;
  return <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
}
