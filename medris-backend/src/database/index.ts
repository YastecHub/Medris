import { loadConfig, type AppConfig } from "../config/app-config.js";
import { serviceUnavailable } from "../shared/errors/app-error.js";
import { createPostgresDatabase, type DatabaseHandle } from "./client.js";
import { DataContext } from "./context.js";

/**
 * Process-wide access to the database.
 *
 * The connection is created on first use, so endpoints that never touch the
 * database (link previews, TURN credentials) keep working on a deployment
 * that has no DATABASE_URL. Tests and createApp() can install their own
 * DataContext (for example one backed by PGlite) with `setDataContextProvider`.
 */

let installed: (() => DataContext) | null = null;
let handle: DatabaseHandle | null = null;
let fromEnv: DataContext | null = null;
let inInstalled = false;

/** Installs a provider used instead of DATABASE_URL (tests, createApp overrides). null restores the default. */
export function setDataContextProvider(provider: (() => DataContext) | null): void {
  installed = provider;
}

export function getDataContext(config?: AppConfig): DataContext {
  if (installed && !inInstalled) {
    inInstalled = true;
    try {
      return installed();
    } finally {
      inInstalled = false;
    }
  }
  if (fromEnv) return fromEnv;
  const cfg = config ?? loadConfig();
  if (!cfg.database.url) throw serviceUnavailable("DATABASE_URL is not configured on this deployment.");
  handle = createPostgresDatabase(cfg);
  fromEnv = new DataContext(handle.db, { statementTimeoutMs: cfg.database.statementTimeoutMs });
  return fromEnv;
}

/** Closes the pool (graceful shutdown). */
export async function closeDatabase(): Promise<void> {
  const current = handle;
  handle = null;
  fromEnv = null;
  if (current) await current.close();
}
