#!/usr/bin/env node
/**
 * `node --check` on every Vercel function in api/ (npm run api:check).
 * These are the original CommonJS functions, deployed as they were before the
 * frontend/backend split; a syntax error in one would only show up as a failed
 * request in production, so CI checks them.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "api");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(dir, file)], { encoding: "utf8" });
  if (result.status !== 0) {
    failed++;
    console.error(`api/${file}:\n${result.stderr}`);
  }
}
console.log(`${files.length} API functions checked, ${failed} with syntax errors`);
process.exit(failed ? 1 : 0);
