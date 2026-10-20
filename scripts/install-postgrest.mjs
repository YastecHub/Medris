#!/usr/bin/env node
/**
 * Puts the PostgREST server (the data API, /rest/v1) in medris-backend/bin/postgrest. Run by Heroku's build
 * (`heroku-postbuild`). Pinned version, checked against its SHA-256 before use. Linux x86-64 only (Heroku); on other
 * machines it does nothing unless --force, and the backend then runs without the data API.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "v12.2.12";
const SHA256 = "5de4092f1719da3353c40bf96c8dec6913f2254a7cd0b61cc05f233153b557d5";
const URL_ = `https://github.com/PostgREST/postgrest/releases/download/${VERSION}/postgrest-${VERSION}-linux-static-x86-64.tar.xz`;

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "medris-backend", "bin");
const target = path.join(bin, "postgrest");
const stamp = path.join(bin, "postgrest.version");

if (!(process.platform === "linux" && process.arch === "x64") && !process.argv.includes("--force")) {
  console.log(`install-postgrest: skipped (${process.platform}/${process.arch}); the data API needs Linux x86-64.`);
  process.exit(0);
}
if (existsSync(target) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === VERSION) {
  console.log(`install-postgrest: ${VERSION} already present.`);
  process.exit(0);
}
const res = await fetch(URL_);
if (!res.ok) throw new Error(`install-postgrest: download failed (${res.status})`);
const archive = Buffer.from(await res.arrayBuffer());
const sum = createHash("sha256").update(archive).digest("hex");
if (sum !== SHA256) throw new Error(`install-postgrest: checksum mismatch (${sum})`);
mkdirSync(bin, { recursive: true });
const file = path.join(bin, "postgrest.tar.xz");
writeFileSync(file, archive);
execFileSync("tar", ["-xJf", file, "-C", bin]);
chmodSync(target, 0o755);
writeFileSync(stamp, VERSION + "\n");
unlinkSync(file);
console.log(`install-postgrest: ${VERSION} installed in ${bin}.`);
