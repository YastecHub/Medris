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
});

export type AppConfig = typeof appConfig;
