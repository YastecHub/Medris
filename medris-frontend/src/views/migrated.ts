/**
 * Screens that have a React version (docs/REACT_MIGRATION.md, section 7 "Progress table").
 *
 * Plain strings on purpose: the view registry (src/bridge/view-registry.ts) is a classic
 * script that must not pull React in, and only needs the NAMES to know whether a screen
 * can be switched on. The components themselves are listed in src/views/index.ts.
 *
 * A name is added here, in the same pull request as its component, when a screen is
 * converted. Having a component does not turn it on: every screen is OFF until it is
 * listed in VITE_REACT_VIEWS or switched on per browser (see the registry).
 */
export const MIGRATED_VIEWS: readonly string[] = ["terms", "privacy", "refundPolicy", "contactUs", "customerFollowing", "wishlist", "notifications", "vendors", "storefront", "productDetail", "search"];
