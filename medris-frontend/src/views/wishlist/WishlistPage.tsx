import { useEffect, useState } from "react";
import { PackageCard } from "@/components/PackageCard";
import { ProductCard } from "@/components/ProductCard";
import { useCardHydration } from "@/hooks/useCardHydration";
import { useLegacySession } from "@/hooks/useLegacySession";
import { loadWishlist, type Wishlist } from "@/services/wishlist";

/**
 * "Your Wishlist", drawn by React.
 *
 * Converted one-to-one from renderWishlist() (…/js/01-app/44-wishlist.js:2): same markup and classes, same data
 * (see src/services/wishlist.ts), same messages (signed out: "Log in to save items to your wishlist."; nothing saved:
 * the empty-state text with the heart icon), cards from the shared ProductCard / PackageCard. The heart button on a
 * product card keeps calling the app's own toggleFavorite(). Text from the database is rendered by React (escaped).
 * Until the legacy screen is deleted (a later pull request) any change must be made in BOTH places; the parity test
 * (tests/e2e/pilot-wishlist.spec.ts) fails if they drift apart.
 */
export default function WishlistPage() {
  const { session } = useLegacySession();
  const userId = session?.user?.id ?? null;
  const [list, setList] = useState<Wishlist | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setList(null);
    loadWishlist(userId).then(
      (result) => !cancelled && setList(result),
      () => !cancelled && setList({ products: [], packages: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useCardHydration(list !== null && (list.products.length > 0 || list.packages.length > 0));

  if (!userId) return <div className="empty-state">Log in to save items to your wishlist.</div>;
  if (!list) return null;

  const { products, packages } = list;
  return (
    <>
      <h2>
        <i className="fa-solid fa-heart"></i> Your Wishlist
      </h2>
      {products.length > 0 ? (
        <>
          <h3 className="section-title">
            <i className="fa-solid fa-box"></i> Products
          </h3>
          <div className="grid">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} context="wishlist" />
            ))}
          </div>
        </>
      ) : null}
      {packages.length > 0 ? (
        <>
          <h3 className="section-title">
            <i className="fa-solid fa-boxes-stacked"></i> Packages
          </h3>
          <div className="grid">
            {packages.map((p) => (
              <PackageCard key={p.id} pkg={p} />
            ))}
          </div>
        </>
      ) : null}
      {products.length === 0 && packages.length === 0 ? (
        <div className="empty-state">
          Nothing saved yet. Tap the <i className="fa-regular fa-heart"></i> on a product or package to save it here.
        </div>
      ) : null}
    </>
  );
}
