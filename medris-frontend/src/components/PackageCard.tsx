import { useRef, type KeyboardEvent, type MouseEvent } from "react";
import { legacy, legacyState } from "@/views/legacy-globals";
import type { CardVendor } from "@/components/ProductCard";
import "@/views/legacy-navigate"; // declares window.navigate

/**
 * The marketplace package card, drawn by React.
 *
 * One-to-one copy of packageCardHtml() (src/legacy/assets/js/01-app/61-request-equipment-buyers-post-needs-vend.js:464),
 * which is the only definition: same markup, classes and data-* attributes; same click and keyboard behaviour (the whole
 * card is a button that opens the package; the photo opens the lightbox; the comment button opens the comments); same
 * delivery wording. Price text and "is this my listing" call the same legacy functions. The like and comment counters
 * start at "0" and are filled in afterwards by the app's own hydratePackageCommentCountsInView(), which the screen calls
 * once the cards are on screen (see useCardHydration).
 * Text from the database is rendered by React (escaped).
 *
 * Until the legacy builder is deleted (a later pull request) any change must be made in BOTH places; the parity test
 * of every screen that shows cards fails if they drift apart.
 */
export interface CardPackage {
  id: string;
  name: string;
  description?: string | null;
  price?: number | null;
  photos?: string[] | null;
  vendor?: CardVendor | null;
  items?: Array<{ quantity: number; product?: { name?: string | null } | null }> | null;
}

export function PackageCard({ pkg }: { pkg: CardPackage }) {
  const naira = legacy("naira");
  // The legacy gallery id contains a random suffix; keep one per card, stable across re-renders.
  const suffix = useRef(Math.random().toString(36).slice(2, 7));
  const photos = Array.isArray(pkg.photos) ? pkg.photos.filter(Boolean) : [];
  const mainPhoto = photos[0] || "";
  const itemsText = (pkg.items || []).map((it) => `${it.quantity}× ${it.product?.name || ""}`).join(", ") || "No items listed";
  const vendorName = pkg.vendor?.business_name || "Vendor";
  const open = () => window.navigate?.("packageDetail", { packageId: pkg.id });
  const stop = (event: MouseEvent) => event.stopPropagation();

  const delivery =
    pkg.vendor?.delivery_fee_mode === "distance" ? (
      <div className="package-card-delivery muted">
        <i className="fa-solid fa-truck"></i> Distance delivery · {naira(pkg.vendor.delivery_fee_per_km || 0)}/km
      </div>
    ) : Number(pkg.vendor?.delivery_fee || 0) > 0 ? (
      <div className="package-card-delivery muted">
        <i className="fa-solid fa-truck"></i> Delivery · {naira(pkg.vendor!.delivery_fee)}
      </div>
    ) : (
      <div className="package-card-delivery muted">
        <i className="fa-solid fa-truck"></i> Free delivery
      </div>
    );

  return (
    <div
      className="card package-listing-card"
      data-package-id={pkg.id}
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      {mainPhoto ? (
        <div className="package-gallery" id={`pkgGallery-${pkg.id}-${suffix.current}`} onClick={stop}>
          <img
            className="package-photo-main"
            src={mainPhoto}
            alt={pkg.name}
            loading="lazy"
            decoding="async"
            onClick={(event) => legacy("openPackageImageLightbox")(mainPhoto, event)}
          />
        </div>
      ) : (
        <div className="package-gallery-placeholder" onClick={stop}>
          <i className="fa-solid fa-box-open"></i>&nbsp; No package photo
        </div>
      )}
      <div className="package-card-title-row">
        <strong>{pkg.name}</strong>
        <span className="badge">{naira(pkg.price)}</span>
      </div>
      {pkg.description ? <p className="package-card-description muted">{pkg.description}</p> : null}
      <p className="package-card-includes muted">
        <i className="fa-solid fa-box-open"></i> Includes: {itemsText}
      </p>
      <div className="package-card-vendor">
        <i className="fa-solid fa-store"></i> {vendorName}
      </div>
      {delivery}
      {legacyState.role() === "admin" ? (
        <span className="badge package-card-owner-badge">Admin</span>
      ) : legacy("isOwnVendorId")(pkg.vendor?.id) ? (
        <span className="badge own-listing-badge package-card-owner-badge">
          <i className="fa-solid fa-store"></i> Your package
        </span>
      ) : null}
      <div className="package-card-comment-row">
        <span className="package-card-engagement-count muted">
          <i className="fa-regular fa-heart"></i> <span className="package-like-count">0</span>
        </span>
        <button
          type="button"
          className="package-card-comment-btn"
          data-package-id={pkg.id}
          onClick={(event) => {
            event.stopPropagation();
            legacy("openPackageCommentsFromCard")(pkg.id);
          }}
          aria-label={`Comments on ${pkg.name}`}
        >
          <i className="fa-regular fa-comment"></i> <span className="package-comment-count">0</span>
        </button>
      </div>
    </div>
  );
}
