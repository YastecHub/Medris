import fs from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { loadEnv } from "vite";

/**
 * Builds the legacy Levromart app from the sources in src/legacy:
 *
 *  - the document (index.html): ordered pieces listed in
 *    src/legacy/document.json `pieces`, emitted inline in that order;
 *  - the legacy asset files served at /assets/css/* and /assets/js/*
 *    (`external` in the manifest; 01-app.js is concatenated from its section
 *    files in src/legacy/assets/js/01-app/);
 *  - the service worker (/sw.js) from src/service-worker/sw.js.
 *
 * Why assemble instead of bundling? The legacy runtime is classic scripts and
 * stylesheets that rely on parse order (scripts run while the page parses,
 * later CSS and later function definitions win, globals are shared between
 * scripts) and on quirks rendering mode (a stylesheet <link> precedes the
 * doctype). Re-emitting them unchanged, at the same URLs, reproduces the live
 * app exactly while the sources stay split into focused files.
 *
 * Placeholders resolved while assembling:
 *   {{env:VITE_NAME}}        public build-time config (.env / .env.example)
 *   {{inline-asset:file}}    a file from src/assets/inline, embedded as a data: URI
 *   {{asset-version}}        `assetVersion` from the manifest: the ?v= cache-buster on
 *                            /assets URLs and the service worker's shell cache name
 */

export type LegacyPiece =
  | { kind: "text"; value: string }
  | { kind: "markup"; file: string }
  | { kind: "style" | "script"; openTag: string; closeTag: string; file: string };

export interface LegacyExternalFile {
  /** Path the file is served at, relative to the site root (e.g. "assets/js/01-app.js"). */
  output: string;
  /** Source files under src/legacy, concatenated in order. */
  files: string[];
}

export interface LegacyManifest {
  assetVersion: number;
  pieces: LegacyPiece[];
  external: LegacyExternalFile[];
}

export const REQUIRED_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_VAPID_PUBLIC_KEY"] as const;
export const SERVICE_WORKER_OUTPUT = "sw.js";

const MIME_BY_EXT: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export function legacyPaths(root: string) {
  return {
    legacyDir: path.join(root, "src", "legacy"),
    inlineAssetsDir: path.join(root, "src", "assets", "inline"),
    serviceWorker: path.join(root, "src", "service-worker", "sw.js"),
    manifest: path.join(root, "src", "legacy", "document.json"),
  };
}

export function readManifest(root: string): LegacyManifest {
  return JSON.parse(fs.readFileSync(legacyPaths(root).manifest, "utf8")) as LegacyManifest;
}

/** Every source file referenced by the manifest, relative to src/legacy. */
export function manifestFiles(manifest: LegacyManifest): string[] {
  const fromPieces = manifest.pieces.flatMap((p) => (p.kind === "text" ? [] : [p.file]));
  return [...fromPieces, ...manifest.external.flatMap((e) => e.files)];
}

class Resolver {
  private readonly cache = new Map<string, string>();
  constructor(
    private readonly root: string,
    private readonly env: Record<string, string>,
    private readonly assetVersion: number,
  ) {}

  resolve(source: string): string {
    const { inlineAssetsDir } = legacyPaths(this.root);
    return source
      .replace(/\{\{env:([A-Z0-9_]+)\}\}/g, (_m, name: string) => {
        const value = this.env[name];
        if (!value) throw new Error(`[legacy-document] ${name} is not set. Add it to medris-frontend/.env (see .env.example).`);
        // Placeholders always sit inside a double-quoted JS string literal.
        return JSON.stringify(value).slice(1, -1);
      })
      .replace(/\{\{asset-version\}\}/g, () => String(this.assetVersion))
      .replace(/\{\{inline-asset:([A-Za-z0-9._-]+)\}\}/g, (_m, file: string) => {
        let uri = this.cache.get(file);
        if (!uri) {
          const mime = MIME_BY_EXT[file.split(".").pop()?.toLowerCase() ?? ""];
          if (!mime) throw new Error(`[legacy-document] unsupported inline asset type: ${file}`);
          uri = `data:${mime};base64,${fs.readFileSync(path.join(inlineAssetsDir, file)).toString("base64")}`;
          this.cache.set(file, uri);
        }
        return uri;
      });
  }

  read(rel: string): string {
    return this.resolve(fs.readFileSync(path.join(legacyPaths(this.root).legacyDir, rel), "utf8"));
  }
}

export interface LegacyBuild {
  /** The document (index.html) before Vite's tags are merged in. */
  document: string;
  /** Other emitted files: output path -> content. */
  files: Map<string, string>;
}

/** Builds the legacy document, asset files and service worker. */
export function buildLegacy(root: string, env: Record<string, string>): LegacyBuild {
  const manifest = readManifest(root);
  const r = new Resolver(root, env, manifest.assetVersion);

  let document = "";
  for (const piece of manifest.pieces) {
    if (piece.kind === "text") document += piece.value;
    else if (piece.kind === "markup") document += r.read(piece.file);
    else document += piece.openTag + r.read(piece.file) + piece.closeTag;
  }

  const files = new Map<string, string>();
  for (const ext of manifest.external) files.set(ext.output, ext.files.map((f) => r.read(f)).join(""));
  files.set(SERVICE_WORKER_OUTPUT, r.resolve(fs.readFileSync(legacyPaths(root).serviceWorker, "utf8")));
  return { document, files };
}

const MOUNT_POINT = `<div id="medris-root"></div>\n`;

/**
 * Places the tags Vite injected into the minimal index.html template (React
 * entry module, preloads and, in dev, the HMR client) into the legacy
 * document: module tags before the first </head>, the React mount point at
 * the very end (module scripts run after parsing, so it exists by then).
 */
export function mergeViteTags(viteHtml: string, legacyHtml: string): string {
  const tags = [
    ...viteHtml.matchAll(/<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>|<link\b[^>]*rel="(?:modulepreload|stylesheet)"[^>]*>/g),
  ].map((m) => m[0]);
  const headClose = legacyHtml.indexOf("</head>");
  if (headClose === -1) throw new Error("[legacy-document] the legacy document has no </head>");
  const injected = tags.length ? tags.join("\n") + "\n" : "";
  return legacyHtml.slice(0, headClose) + injected + legacyHtml.slice(headClose) + MOUNT_POINT;
}

/**
 * When the API lives on another origin (VITE_API_BASE_URL), the legacy code's
 * relative fetch("/api/...") calls are pointed there by a tiny classic script
 * that runs before any legacy script. With the default (same origin) nothing
 * is injected and the document is unchanged.
 */
export function injectApiBase(legacyHtml: string, apiBaseUrl: string | undefined): string {
  const base = String(apiBaseUrl || "").replace(/\/$/, "");
  if (!base) return legacyHtml;
  const shim =
    `<script id="medris-api-base">(function(){var b=${JSON.stringify(base)},f=window.fetch.bind(window);` +
    `window.fetch=function(i,o){if(typeof i==="string"&&i.indexOf("/api/")===0)i=b+i;return f(i,o);};})();</script>`;
  const headOpen = legacyHtml.indexOf("<head>");
  if (headOpen === -1) throw new Error("[legacy-document] the legacy document has no <head>");
  const at = headOpen + "<head>".length;
  return legacyHtml.slice(0, at) + "\n" + shim + legacyHtml.slice(at);
}

const CONTENT_TYPES: Record<string, string> = { ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

export function legacyDocumentPlugin(): Plugin {
  let root = process.cwd();
  let env: Record<string, string> = {};
  let devServer: ViteDevServer | null = null;

  return {
    name: "medris:legacy-document",
    configResolved(config) {
      root = config.root;
      env = loadEnv(config.mode, config.envDir || root, "VITE_");
      const missing = REQUIRED_ENV.filter((name) => !env[name]);
      if (missing.length) throw new Error(`[legacy-document] missing ${missing.join(", ")} (see medris-frontend/.env.example)`);
    },
    configureServer(server) {
      devServer = server;
      const { legacyDir, inlineAssetsDir, serviceWorker } = legacyPaths(root);
      server.watcher.add([legacyDir, inlineAssetsDir, serviceWorker]);
      server.watcher.on("change", (file) => {
        if ([legacyDir, inlineAssetsDir, serviceWorker].some((p) => file.startsWith(p))) server.ws.send({ type: "full-reload" });
      });
      // Serve the assembled legacy files at their production URLs.
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || "").split("?")[0]?.replace(/^\//, "") ?? "";
        if (!pathname.startsWith("assets/") && pathname !== SERVICE_WORKER_OUTPUT) return next();
        const content = buildLegacy(root, env).files.get(pathname);
        if (content === undefined) return next();
        res.setHeader("Content-Type", CONTENT_TYPES[path.extname(pathname)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        res.end(content);
      });
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return mergeViteTags(html, injectApiBase(buildLegacy(root, env).document, env.VITE_API_BASE_URL));
      },
    },
    generateBundle() {
      if (devServer) return;
      for (const [fileName, source] of buildLegacy(root, env).files) this.emitFile({ type: "asset", fileName, source });
    },
  };
}
