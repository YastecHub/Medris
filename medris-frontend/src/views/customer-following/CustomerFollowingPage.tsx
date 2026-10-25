import { useEffect, useState } from "react";
import { loadFollowedVendors, type FollowedVendor } from "@/services/follows";
import { useLegacySession } from "@/hooks/useLegacySession";
import "@/views/legacy-navigate"; // declares window.navigate

/**
 * "Vendors you follow", drawn by React.
 *
 * Converted one-to-one from renderCustomerFollowing() (…/js/01-app/44-wishlist.js:17): same markup and classes,
 * same query (see src/services/follows.ts), same messages for guests/admins, an empty list and a failed load,
 * same navigation (Back → home, a vendor → its storefront, Explore vendors → vendors, Try again → this screen).
 * The search box keeps calling the app's own window.lmFilterFollowing(), which filters the cards on screen.
 * All text from the database is rendered through React (escaped); nothing is injected as HTML.
 * Until the legacy screen is deleted (a later pull request) any change must be made in BOTH places; the parity
 * test (tests/e2e/pilot-customer-following.spec.ts) fails if they drift apart.
 */
declare global {
  interface Window {
    lmFilterFollowing?: (query: string) => void;
  }
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; vendors: FollowedVendor[] };

const goTo = (view: string, params?: Record<string, unknown>, push?: boolean) => window.navigate?.(view, params, push);

function avatarHue(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export default function CustomerFollowingPage() {
  const { session, profile } = useLegacySession();
  const userId = session?.user?.id ?? null;
  const isAdmin = profile?.role === "admin";
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!userId || isAdmin) return;
    let cancelled = false;
    setState({ kind: "loading" });
    loadFollowedVendors(userId).then(
      (vendors) => !cancelled && setState({ kind: "ready", vendors }),
      (error) => {
        console.error("[Levromart] Customer following load failed:", error);
        if (!cancelled) setState({ kind: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId, isAdmin]);

  if (!userId || isAdmin) return <div className="empty-state">This page is available for customer accounts.</div>;
  if (state.kind === "loading") return null;
  if (state.kind === "error") {
    return (
      <div className="empty-state">
        Could not load the vendors you follow.{" "}
        <button type="button" className="btn btn-outline" onClick={() => goTo("customerFollowing", {}, false)}>
          Try again
        </button>
      </div>
    );
  }

  const { vendors } = state;
  return (
    <div className="customer-following-page">
      <div className="customer-following-head">
        <button type="button" className="icon-btn" onClick={() => goTo("home")} aria-label="Back">
          <i className="fa-solid fa-arrow-left"></i>
        </button>
        <div>
          <h2 style={{ margin: 0 }}>
            <i className="fa-solid fa-user-group"></i> Vendors you follow
          </h2>
          <p className="muted" style={{ margin: ".25rem 0 0" }}>
            Your followed vendors and their storefronts.
          </p>
        </div>
      </div>
      {vendors.length === 0 ? (
        <div className="empty-state">
          <i className="fa-solid fa-user-group" style={{ fontSize: "1.7rem", display: "block", marginBottom: ".6rem" }}></i>
          <strong>You aren't following any vendors yet.</strong>
          <p className="muted">Follow a vendor from their storefront and they will appear here.</p>
          <button type="button" className="btn" onClick={() => goTo("vendors")}>
            Explore vendors
          </button>
        </div>
      ) : (
        <>
          <label className="lm-fol-search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input
              type="search"
              placeholder="Search vendors you follow…"
              onInput={(event) => window.lmFilterFollowing?.(event.currentTarget.value)}
              autoComplete="off"
            />
          </label>
          <div className="customer-following-grid">
            {vendors.map((v) => (
              <button key={v.id} type="button" className="customer-following-card" onClick={() => goTo("storefront", { vendorId: v.id })}>
                <div className="customer-following-avatar" style={{ ["--av-h" as string]: avatarHue(v.business_name || v.id) }}>
                  {v.logo_url ? (
                    <img src={v.logo_url} alt={v.business_name || "Vendor"} loading="lazy" />
                  ) : (
                    <span>{String(v.business_name || "V").trim().charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="customer-following-copy">
                  <strong>{v.business_name || "Vendor"}</strong>
                  <span>{v.city || "Online"}</span>
                  <span>
                    ★ {Number(v.avg_rating || 0).toFixed(1)} · {Number(v.review_count || 0)} reviews
                  </span>
                </div>
                <i className="fa-solid fa-chevron-right"></i>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
