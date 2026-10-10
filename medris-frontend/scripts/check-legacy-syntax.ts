import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentLegacyBuild } from "./legacy-baseline.ts";

/**
 * The legacy code has no compiler, and one syntax error in any script breaks
 * the app. Runs `node --check` on every inline <script> of the document and on
 * every emitted .js file (including the service worker).
 */
const build = currentLegacyBuild();
const sources: [string, string][] = [];
let i = 0;
for (const m of build.document.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) sources.push([`index.html inline script ${i++}`, m[1] ?? ""]);
for (const [name, content] of build.files) if (name.endsWith(".js")) sources.push([name, content]);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "medris-legacy-"));
let failures = 0;
sources.forEach(([label, code], n) => {
  const file = path.join(dir, `${n}.js`);
  fs.writeFileSync(file, code);
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failures++;
    console.error(`${label}:\n${result.stderr.slice(0, 600)}`);
  }
});
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${sources.length} legacy scripts checked, ${failures} with syntax errors`);
process.exit(failures ? 1 : 0);
