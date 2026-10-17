import type { PoolConfig } from "pg";
import type { AppConfig } from "./app-config.js";

/**
 * node-postgres pool settings derived from the validated configuration.
 *
 * Connection: DATABASE_URL is a standard PostgreSQL URL, so the provider can
 * change (Supabase, Neon, RDS, self-hosted) without code changes.
 *
 * On Vercel use Supabase's *transaction* pooler (port 6543) and a small pool
 * (DATABASE_POOL_MAX 1-3): every function instance keeps its own pool. Only
 * unnamed prepared statements are used, which the transaction pooler supports.
 *
 * TLS (DATABASE_SSL_MODE):
 *   require      encrypted, server certificate not verified (libpq "require")
 *   verify-full  encrypted and verified; set DATABASE_SSL_CA to the provider's
 *                CA certificate (Supabase: Project Settings -> Database -> SSL)
 *   disable      local development / tests only
 */
export function poolConfig(config: AppConfig): PoolConfig {
  const { database } = config;
  if (!database.url) throw new Error("DATABASE_URL is not configured on this deployment.");

  // sslmode in the URL would override the explicit `ssl` option below; the
  // DATABASE_SSL_MODE variable is the single source of truth.
  const url = new URL(database.url);
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(key);

  const ssl =
    database.sslMode === "disable"
      ? false
      : database.sslMode === "verify-full"
        ? { rejectUnauthorized: true, ...(database.sslCa ? { ca: database.sslCa } : {}) }
        : { rejectUnauthorized: false };

  return {
    connectionString: url.toString(),
    ssl,
    max: database.poolMax,
    idleTimeoutMillis: database.idleTimeoutMs,
    connectionTimeoutMillis: database.connectionTimeoutMs,
    statement_timeout: database.statementTimeoutMs,
    application_name: "medris-backend",
    // Let an idle serverless instance exit instead of holding the event loop open.
    allowExitOnIdle: true,
  };
}
