#!/usr/bin/env node
/**
 * Deployment safety check, run by `npm run build` after the backend compiles.
 *
 * On a Vercel PRODUCTION build it fails the build (so the current deployment
 * stays live) when the backend's configuration is invalid or a variable it
 * now needs is missing - above all DATABASE_URL, without which every original
 * endpoint (payments, notifications, accounts) would fail at runtime.
 * Preview and local builds only print warnings.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { loadConfig, missingProductionEnv } = await import(pathToFileURL(path.join(root, "medris-backend/dist/config/app-config.js")).href);

const isProduction = process.env.VERCEL_ENV === "production";
const problems = [];

try {
  loadConfig(process.env);
} catch (err) {
  problems.push(err instanceof Error ? err.message : String(err));
}
const missing = missingProductionEnv(process.env);
if (missing.length) problems.push(`Missing environment variables: ${missing.join(", ")}`);

if (!problems.length) {
  console.log("[check-deploy-env] backend configuration OK");
} else if (isProduction) {
  console.error(`[check-deploy-env] Refusing to build a production deployment:\n${problems.map((p) => `  - ${p}`).join("\n")}\nSee docs/DEPLOYMENT.md.`);
  process.exit(1);
} else {
  console.warn(`[check-deploy-env] warning (not a production build, continuing):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
}
