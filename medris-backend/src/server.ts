import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config/app-config.js";
import { closeDatabase } from "./database/index.js";
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
try {
  process.loadEnvFile(".env");
} catch {
  /* no .env file: rely on the shell environment */
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
  if (config.env !== "production") printBanner(url);
});

/** A readable summary for the developer's terminal (the JSON log line above is for log collectors). */
function printBanner(url: string): void {
  const rows: [string, string][] = [
    ["Medris backend", `${url}   (NODE_ENV=${config.env})`],
    ["Swagger UI", config.docs.enabled ? `${url}${DOCS_PATH}` : "off (API_DOCS_ENABLED=false)"],
  ];
  if (config.docs.enabled) rows.push(["OpenAPI JSON", `${url}${OPENAPI_PATH}`]);
  rows.push(["Health", `${url}/api/v1/health/ready`]);
  if (!config.database.url) rows.push(["Database", "not configured - set DATABASE_URL in medris-backend/.env (see .env.example)"]);
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
