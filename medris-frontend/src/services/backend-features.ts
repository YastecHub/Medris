/**
 * Which parts of the app read and write through medris-backend (/api/v1)
 * instead of calling Supabase directly from the browser.
 *
 * Build-time default: VITE_BACKEND_FEATURES, a comma-separated list
 * ("cart,notifications"), "all" or empty (= none, today's behaviour).
 *
 * Per-browser override, for trying a feature on a preview or production build
 * without redeploying (affects only that browser):
 *   localStorage.setItem("medris:backend-features", "all")   // then reload
 *   localStorage.removeItem("medris:backend-features")       // back to the build default
 * or, from the console: levroData.useBackend("cart,notifications").
 */
export const BACKEND_FEATURES = ["catalogue", "cart", "favorites", "follows", "notifications"] as const;
export type BackendFeature = (typeof BACKEND_FEATURES)[number];

export const FEATURE_OVERRIDE_KEY = "medris:backend-features";

export function parseFeatureList(value: string | null | undefined): Set<BackendFeature> {
  const items = String(value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (items.includes("all")) return new Set(BACKEND_FEATURES);
  return new Set(items.filter((s): s is BackendFeature => (BACKEND_FEATURES as readonly string[]).includes(s)));
}

/** Reads the per-browser override; storage can be unavailable (private mode, blocked site data). */
export function readFeatureOverride(): string | null {
  try {
    return window.localStorage.getItem(FEATURE_OVERRIDE_KEY);
  } catch {
    return null;
  }
}

export function writeFeatureOverride(value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(FEATURE_OVERRIDE_KEY);
    else window.localStorage.setItem(FEATURE_OVERRIDE_KEY, value);
  } catch {
    /* storage unavailable: the build default stays in force */
  }
}

export function enabledFeatures(buildDefault: string | undefined): Set<BackendFeature> {
  const override = readFeatureOverride();
  return parseFeatureList(override !== null ? override : buildDefault);
}
