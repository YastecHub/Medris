import fs from "node:fs";
import path from "node:path";
import { frontendRoot } from "./legacy-baseline.ts";

/**
 * Usage: npm run bump-version -w medris-frontend -- <number>
 * Sets the ?v= cache-buster on every /assets URL and the service worker's shell
 * cache name, so phones never mix a new index.html with old cached CSS/JS.
 * (Replaces tools/bump-version.sh.)
 */
const next = Number(process.argv[2]);
if (!Number.isInteger(next) || next < 1) {
  console.error("usage: npm run bump-version -w medris-frontend -- <number>");
  process.exit(1);
}
const file = path.join(frontendRoot, "src", "legacy", "document.json");
const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as { assetVersion: number };
const previous = manifest.assetVersion;
manifest.assetVersion = next;
fs.writeFileSync(file, JSON.stringify(manifest, null, 1));
console.log(`asset version ${previous} -> ${next} (run npm run legacy:rebaseline -w medris-frontend before committing)`);
