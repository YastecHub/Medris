import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { buildLegacy, type LegacyBuild } from "../build/legacy-document.ts";

export const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const baselineFile = path.join(frontendRoot, "tests", "legacy-baseline.json");

/** SHA-256 per emitted legacy file ("index.html" = the document before Vite's tags). */
export type LegacyBaseline = { description: string; files: Record<string, string> };

export function currentLegacyBuild(): LegacyBuild {
  return buildLegacy(frontendRoot, loadEnv("production", frontendRoot, "VITE_"));
}

const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

export function hashBuild(build: LegacyBuild): Record<string, string> {
  const files: Record<string, string> = { "index.html": sha(build.document) };
  for (const [name, content] of [...build.files].sort(([a], [b]) => a.localeCompare(b))) files[name] = sha(content);
  return files;
}

export function readBaseline(): LegacyBaseline {
  return JSON.parse(fs.readFileSync(baselineFile, "utf8")) as LegacyBaseline;
}

export function writeBaseline(files: Record<string, string>): void {
  const baseline: LegacyBaseline = {
    description:
      "SHA-256 of every legacy file the build emits (production .env). Recorded from the live files of commit 42c4105, so the refactor is byte-for-byte identical. Update only for an intentional legacy change: npm run legacy:rebaseline -w medris-frontend",
    files,
  };
  fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2) + "\n");
}
