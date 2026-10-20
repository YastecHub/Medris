/**
 * Public, build-time configuration (VITE_* variables; see .env.example).
 * Everything here ships to the browser - no secrets.
 */
function required(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY" | "VITE_VAPID_PUBLIC_KEY"): string {
  const value = import.meta.env[name];
  if (!value) throw new Error(`${name} is not set (see medris-frontend/.env.example).`);
  return value;
}

export const appConfig = Object.freeze({
  supabaseUrl: required("VITE_SUPABASE_URL"),
  supabaseAnonKey: required("VITE_SUPABASE_ANON_KEY"),
  vapidPublicKey: required("VITE_VAPID_PUBLIC_KEY"),
  /** Empty means same origin: requests go to /api/... */
  apiBaseUrl: String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, ""),
  /**
   * Where the new backend's own API (/api/v1) lives, e.g. https://levromart-api.herokuapp.com. Only /api/v1 calls go
   * there; the app's original /api/* functions stay where VITE_API_BASE_URL says (same origin by default). Empty: the
   * same place as /api.
   */
  backendUrl: String(import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, ""),
});

export type AppConfig = typeof appConfig;
