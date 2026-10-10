import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLegacy, injectApiBase, manifestFiles, mergeViteTags, readManifest } from "../build/legacy-document.ts";
import { currentLegacyBuild, frontendRoot, hashBuild, readBaseline } from "../scripts/legacy-baseline.ts";

describe("legacy build", () => {
  it("reproduces every recorded file byte-for-byte (the live app before the refactor)", () => {
    expect(hashBuild(currentLegacyBuild())).toEqual(readBaseline().files);
  });

  it("keeps quirks rendering mode: a stylesheet link precedes the doctype", () => {
    const { document } = currentLegacyBuild();
    expect(document.indexOf("<link")).toBeLessThan(document.indexOf("<!DOCTYPE html>"));
  });

  it("puts the same cache-busting version on every /assets URL and in the service worker", () => {
    const build = currentLegacyBuild();
    const { assetVersion } = readManifest(frontendRoot);
    const versions = new Set([...build.document.matchAll(/\/assets\/(?:css|js)\/[\w.-]+\?v=(\d+)/g)].map((m) => Number(m[1])));
    expect([...versions]).toEqual([assetVersion]);
    expect(build.files.get("sw.js")).toContain(`levromart-shell-v${assetVersion}'`);
  });

  it("emits every /assets file the document links to", () => {
    const build = currentLegacyBuild();
    const linked = [...build.document.matchAll(/"\/(assets\/(?:css|js)\/[\w.-]+)\?v=/g)].map((m) => m[1]);
    expect(linked.length).toBeGreaterThan(0);
    for (const file of linked) expect(build.files.has(file as string)).toBe(true);
  });

  it("references only source files that exist", () => {
    const missing = manifestFiles(readManifest(frontendRoot)).filter((f) => !fs.existsSync(path.join(frontendRoot, "src", "legacy", f)));
    expect(missing).toEqual([]);
  });

  it("resolves every placeholder", () => {
    const build = currentLegacyBuild();
    for (const text of [build.document, ...build.files.values()]) expect(text).not.toMatch(/\{\{(env|inline-asset):|\{\{asset-version\}\}/);
  });

  it("fails loudly when a required public variable is missing", () => {
    expect(() => buildLegacy(frontendRoot, {})).toThrow(/VITE_SUPABASE_URL is not set/);
  });
});

describe("merging Vite's tags", () => {
  const legacy = "<link rel=stylesheet href=/a.css><!DOCTYPE html><html><head><title>x</title></head><body><div id=app></div></body></html>\n";
  const vite = `<!doctype html><html><head><meta charset="UTF-8" /><script type="module" crossorigin src="/assets/index-abc.js"></script><link rel="modulepreload" href="/assets/react.js"></head><body></body></html>`;

  it("puts module tags before </head> and the React mount point at the end", () => {
    expect(mergeViteTags(vite, legacy)).toBe(
      `<link rel=stylesheet href=/a.css><!DOCTYPE html><html><head><title>x</title><script type="module" crossorigin src="/assets/index-abc.js"></script>\n<link rel="modulepreload" href="/assets/react.js">\n</head><body><div id=app></div></body></html>\n<div id="medris-root"></div>\n`,
    );
  });

  it("does not add the API base shim when the API is same-origin", () => {
    expect(injectApiBase(legacy, "")).toBe(legacy);
    expect(injectApiBase(legacy, undefined)).toBe(legacy);
  });

  it("adds the API base shim right after <head> when configured", () => {
    const out = injectApiBase(legacy, "https://api.example.com/");
    expect(out).toContain(`<head>\n<script id="medris-api-base">`);
    expect(out).toContain(`"https://api.example.com"`);
  });
});
