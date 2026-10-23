/**
 * Server configuration. Every secret comes from the environment (Vercel
 * project settings in production, `medris-backend/.env` locally); nothing
 * secret is ever hard-coded or sent to the browser.
 *
 * Two layers live here:
 *  - `requireEnv` / `optionalEnv`: per-request lookups used by the original
 *    endpoint modules (unchanged behaviour);
 *  - `loadConfig()` (config/app-config.ts): the validated, typed platform
 *    configuration used by the database, auth, logging and /api/v1 layers.
 *
 * `requireEnv` keeps the exact failure message the original API used, so a
 * missing variable still surfaces as "<NAME> is not configured on this
 * deployment." in the JSON error body.
 */

export type EnvName =
  | "SUPABASE_URL"
  | "SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "PAYSTACK_SECRET_KEY"
  | "PAYSTACK_BASE_URL"
  | "PAYSTACK_TIMEOUT_MS"
  | "RESEND_API_KEY"
  | "EMAIL_FROM"
  | "EMAIL_WEBHOOK_SECRET"
  | "VAPID_PUBLIC_KEY"
  | "VAPID_PRIVATE_KEY"
  | "GEMINI_API_KEY"
  | "CRON_SECRET"
  | "R2_ACCOUNT_ID"
  | "R2_ACCESS_KEY_ID"
  | "R2_SECRET_ACCESS_KEY"
  | "R2_BUCKET_NAME"
  | "R2_PUBLIC_URL"
  | "METERED_API_KEY"
  | "METERED_DOMAIN"
  | "APP_ORIGIN"
  | "CORS_ALLOWED_ORIGINS"
  | "STATIC_ASSETS_DIR"
  | "ICON_ORIGIN"
  | "CF_TURN_KEY_ID"
  | "CF_TURN_API_TOKEN"
  | "DATABASE_URL"
  | "CLOUDINARY_CLOUD_NAME"
  | "CLOUDINARY_API_KEY"
  | "CLOUDINARY_API_SECRET";

export function requireEnv(name: EnvName): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured on this deployment.`);
  return value;
}

export function optionalEnv(name: EnvName): string {
  return process.env[name] || "";
}

/**
 * Public, non-secret values that were previously literals in the API code.
 * They can be overridden per environment; the defaults are the live values.
 */
export const DEFAULT_APP_ORIGIN = "https://levromart.vercel.app";
/** Where the app itself is served; allowed to call the backend from the browser in production. */
export const PRODUCTION_APP_ORIGINS = ["https://levromart.vercel.app", "https://levromart.com", "https://www.levromart.com"];
export const DEFAULT_VAPID_PUBLIC_KEY =
  "BJ7h-JVsXaOpYXY5st5L7esSDOPjhRROincFPTT013a1ZY3U62WIKPAoFEDzBgFB8g3H2DBNX1iRw8GzdPWR88k";

/** Origin used in links inside emails and push notifications. */
export function appOrigin(): string {
  return (optionalEnv("APP_ORIGIN") || DEFAULT_APP_ORIGIN).replace(/\/$/, "");
}

/** Origin that serves /api/notif-icon, used in push-notification picture URLs. */
export const DEFAULT_ICON_ORIGIN = "https://levromart.com";
export function iconOrigin(): string {
  return (optionalEnv("ICON_ORIGIN") || DEFAULT_ICON_ORIGIN).replace(/\/$/, "");
}

export function vapidPublicKey(): string {
  return optionalEnv("VAPID_PUBLIC_KEY") || DEFAULT_VAPID_PUBLIC_KEY;
}
