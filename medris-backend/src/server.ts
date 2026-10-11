import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config/app-config.js";
import { closeDatabase, getDataContext } from "./database/index.js";
import { createLogger } from "./lib/logger.js";
import { DOCS_PATH, OPENAPI_PATH } from "./routes/docs.js";

/**
 * Long-running server: local development (`npm run dev -w medris-backend`) or
 * any Node host (container, VM). Reads medris-backend/.env when present.
 *
 * Fails fast on invalid configuration, and shuts down gracefully on
 * SIGTERM/SIGINT: stops accepting connections, lets in-flight requests finish
 * (up to SHUTDOWN_GRACE_MS, default 10 s), then closes the database pool.
 */
/** What happened to medris-backend/.env (shown in the startup banner). */
let envFile = "loaded";
try {
  process.loadEnvFile(".env");
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  // No .env is fine (variables may come from the shell or the host); anything else is reported.
  envFile = code === "ENOENT" ? "not found - using the shell environment only" : `could not be read (${err instanceof Error ? err.message : String(err)})`;
}
// `npm run dev` passes --dev: without a .env (or NODE_ENV) the configuration
// would otherwise default to production, which hides the API docs.
if (process.argv.includes("--dev")) process.env.NODE_ENV ??= "development";

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, base: { service: "medris-backend" } });
const port = Number(process.env.PORT || 8787);
const graceMs = Number(process.env.SHUTDOWN_GRACE_MS || 10_000);

const server = createServer(createApp({ services: { config, logger } }));
server.listen(port, () => {
  const url = `http://localhost:${port}`;
  const docs = config.docs.enabled ? { docs: `${url}${DOCS_PATH}`, openapi: `${url}${OPENAPI_PATH}` } : { docs: "disabled (set API_DOCS_ENABLED=true)" };
  logger.info("medris-backend listening", { url, env: config.env, database: Boolean(config.database.url), ...docs });
  if (config.env !== "production") void printBanner(url);
});

/** Where DATABASE_URL points (host and port only - never the password). */
function databaseTarget(): string {
  try {
    const u = new URL(config.database.url ?? "");
    return `${u.hostname}:${u.port || "5432"}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

/** Startup connection check: one round trip, so a wrong password or host shows up immediately. */
async function databaseStatus(): Promise<string> {
  if (!config.database.url) return "not configured - set DATABASE_URL in medris-backend/.env (see .env.example)";
  try {
    const probe = await getDataContext(config).probe();
    const roles = probe.ok ? "API roles ok" : "missing API roles - see /api/v1/health/ready";
    return `connected to ${databaseTarget()} (${probe.latencyMs} ms, ${roles})`;
  } catch (err) {
    return `NOT reachable at ${databaseTarget()}: ${rootCause(err)}`;
  }
}

/** The underlying driver error (Drizzle wraps it in "Failed query: ..."). */
function rootCause(err: unknown): string {
  let current = err;
  while (current instanceof Error && current.cause) current = current.cause;
  const code = (current as { code?: string } | null)?.code;
  const message = current instanceof Error ? current.message : String(current);
  return code && !message.includes(code) ? `${message} (${code})` : message;
}

/** A readable summary for the developer's terminal (the JSON log line above is for log collectors). */
async function printBanner(url: string): Promise<void> {
  const rows: [string, string][] = [
    ["Medris backend", `${url}   (NODE_ENV=${config.env})`],
    ["Config file", `${process.cwd()}${process.platform === "win32" ? "\\" : "/"}.env ${envFile}`],
    ["Swagger UI", config.docs.enabled ? `${url}${DOCS_PATH}` : "off (API_DOCS_ENABLED=false)"],
  ];
  if (config.docs.enabled) rows.push(["OpenAPI JSON", `${url}${OPENAPI_PATH}`]);
  rows.push(["Health", `${url}/api/v1/health/ready`]);
  rows.push(["Database", await databaseStatus()]);
  process.stdout.write(`\n${rows.map(([k, v]) => `  ${k.padEnd(16)} ${v}`).join("\n")}\n\n`);
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });
  const force = setTimeout(() => {
    logger.warn("shutdown grace period elapsed; exiting");
    process.exit(1);
  }, graceMs);
  force.unref();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDatabase().catch((err: unknown) => logger.error("closing the database pool failed", { err }));
  logger.info("stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
