import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

/**
 * How callers prove who they are, as OpenAPI security schemes. Route
 * definitions refer to them by name: `security: [{ bearerAuth: [] }]`.
 */
export const SECURITY = {
  /** /api/v1: `Authorization: Bearer <Supabase access token>`. */
  bearerAuth: "bearerAuth",
  /** /api/v1: the backend session cookie (AUTH_BACKEND_SESSIONS=true only). */
  sessionCookie: "sessionCookie",
  /** Scheduled jobs: `Authorization: Bearer <CRON_SECRET>`. */
  cronSecret: "cronSecret",
  /** Database webhooks (pg_net): `x-webhook-secret: <EMAIL_WEBHOOK_SECRET>`. */
  webhookSecret: "webhookSecret",
  /** Paystack webhooks: `x-paystack-signature` (HMAC-SHA512 of the body). */
  paystackSignature: "paystackSignature",
} as const;

type SecurityRequirement = Record<string, string[]>;

/** Signed in through either mechanism. */
export const signedIn: SecurityRequirement[] = [{ [SECURITY.bearerAuth]: [] }, { [SECURITY.sessionCookie]: [] }];
/** Works signed in or signed out. */
export const optionalSignIn: SecurityRequirement[] = [...signedIn, {}];
/** A single scheme, e.g. `only("cronSecret")`. */
export const only = (scheme: keyof typeof SECURITY): SecurityRequirement[] => [{ [SECURITY[scheme]]: [] }];

export function registerSecuritySchemes(r: OpenAPIRegistry, sessionCookieName: string): void {
  r.registerComponent("securitySchemes", SECURITY.bearerAuth, {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "The Supabase access token the app already holds (supabase.auth.getSession()).",
  });
  r.registerComponent("securitySchemes", SECURITY.sessionCookie, {
    type: "apiKey",
    in: "cookie",
    name: sessionCookieName,
    description: "Backend session (only when AUTH_BACKEND_SESSIONS=true). Writes must come from the app's origin (CSRF check).",
  });
  r.registerComponent("securitySchemes", SECURITY.cronSecret, {
    type: "http",
    scheme: "bearer",
    description: "CRON_SECRET (Vercel Cron / GitHub Actions). /api/daily-cron also accepts it as `x-cron-secret`.",
  });
  r.registerComponent("securitySchemes", SECURITY.webhookSecret, {
    type: "apiKey",
    in: "header",
    name: "x-webhook-secret",
    description: "EMAIL_WEBHOOK_SECRET, sent by the database's notification webhooks.",
  });
  r.registerComponent("securitySchemes", SECURITY.paystackSignature, {
    type: "apiKey",
    in: "header",
    name: "x-paystack-signature",
    description: "HMAC-SHA512 of the raw body with PAYSTACK_SECRET_KEY, sent by Paystack.",
  });
}
