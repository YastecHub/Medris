#!/usr/bin/env node
/**
 * Supabase dependency audit.
 *
 * Scans the legacy frontend (medris-frontend/src/legacy), the React shell
 * (medris-frontend/src) and the backend (medris-backend/src) for every direct
 * use of Supabase: table queries (.from), RPC calls (.rpc), Storage buckets,
 * Realtime channels and Auth calls. Re-run it after migrating a feature to see
 * what is left:
 *
 *   node scripts/supabase-audit.mjs            # markdown summary
 *   node scripts/supabase-audit.mjs --json     # machine-readable, with file:line
 *
 * It is a static, regex-based scan: it reports call sites, not runtime paths.
 * Call sites already routed through the backend use window.levroData; their
 * old Supabase queries live on as the switchable fallback in
 * medris-frontend/src/bridge/data-gateway.ts and are reported separately
 * ("frontend-gateway-fallbacks") until they are deleted.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SOURCES = [
  { area: "frontend-legacy", dir: "medris-frontend/src/legacy", exts: [".js", ".html"], skip: ["/assets/inline/"] },
  { area: "frontend-react", dir: "medris-frontend/src", exts: [".ts", ".tsx"], skip: ["/legacy/", "/bridge/"] },
  // The data gateway's Supabase queries are the "feature off" path of call sites
  // already routed through the backend (VITE_BACKEND_FEATURES).
  { area: "frontend-gateway-fallbacks", dir: "medris-frontend/src/bridge", exts: [".ts"], skip: [] },
  { area: "backend", dir: "medris-backend/src", exts: [".ts"], skip: [] },
];

function walk(dir, exts, skip) {
  const out = [];
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (!exts.includes(path.extname(entry.name))) continue;
    if (skip.some((s) => `/${rel}`.includes(s))) continue;
    out.push(rel);
  }
  return out.sort();
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const STRING = String.raw`\s*['"\`]([A-Za-z0-9_-]+)['"\`]`;

const patterns = {
  table: new RegExp(String.raw`(?<!storage\s*)\.from\(${STRING}`, "g"),
  rpc: new RegExp(String.raw`\.rpc\(${STRING}`, "g"),
  storage: new RegExp(String.raw`storage\s*\.from\(${STRING}\s*\)\s*\.\s*([A-Za-z]+)`, "g"),
  channel: /\.channel\(\s*([^,)]{1,80})/g,
  realtimeTable: /postgres_changes['"]?\s*,\s*\{[^}]{0,200}?table\s*:\s*['"]([a-z_]+)['"]/g,
  auth: /\.auth\.(admin\.)?([A-Za-z]+)\(/g,
  // Backend PostgREST helper calls: db.first<T>(`orders?...`), db.patch(`users?...`), ...
  restHelper: /\b(?:db|admin|sb|supabase)\.(select|first|patch|insert|delete|rest)(?:<[^>]*>)?\(\s*[`'"]((?:rpc\/)?[a-z_]+)/g,
  httpApi: /\/(auth|storage|rest)\/v1\/([a-z_./-]*)/g,
};

const TABLE_OPS = ["select", "insert", "update", "upsert", "delete"];

function scan() {
  const result = { generatedAt: new Date().toISOString(), areas: {} };
  for (const source of SOURCES) {
    const area = { files: 0, tables: {}, rpcs: {}, storage: {}, channels: [], realtimeTables: {}, auth: {}, httpApis: {} };
    for (const rel of walk(source.dir, source.exts, source.skip)) {
      const text = fs.readFileSync(path.join(root, rel), "utf8");
      area.files++;
      const at = (m) => `${rel}:${lineOf(text, m.index)}`;

      for (const m of text.matchAll(patterns.table)) {
        if (/storage\s*$/.test(text.slice(Math.max(0, m.index - 20), m.index))) continue;
        const name = m[1];
        // Supabase table names are snake_case; skip Array.from("x") and similar.
        if (!/^[a-z][a-z0-9_]*$/.test(name)) continue;
        if (/Array\s*$|Buffer\s*$|Object\s*$/.test(text.slice(Math.max(0, m.index - 10), m.index))) continue;
        const ahead = text.slice(m.index, m.index + 400);
        const op = TABLE_OPS.find((o) => new RegExp(String.raw`^[^;]*?\.${o}\(`).test(ahead)) ?? "unknown";
        const t = (area.tables[name] ??= { count: 0, ops: {}, sites: [] });
        t.count++;
        t.ops[op] = (t.ops[op] ?? 0) + 1;
        t.sites.push(at(m));
      }
      for (const m of text.matchAll(patterns.rpc)) {
        const r = (area.rpcs[m[1]] ??= { count: 0, sites: [] });
        r.count++;
        r.sites.push(at(m));
      }
      for (const m of text.matchAll(patterns.storage)) {
        const b = (area.storage[m[1]] ??= { ops: {}, sites: [] });
        b.ops[m[2]] = (b.ops[m[2]] ?? 0) + 1;
        b.sites.push(at(m));
      }
      for (const m of text.matchAll(patterns.channel)) area.channels.push({ name: m[1].trim(), site: at(m) });
      for (const m of text.matchAll(patterns.realtimeTable)) {
        const r = (area.realtimeTables[m[1]] ??= { count: 0, sites: [] });
        r.count++;
        r.sites.push(at(m));
      }
      for (const m of text.matchAll(patterns.auth)) {
        const key = `${m[1] ?? ""}${m[2]}`;
        const a = (area.auth[key] ??= { count: 0, sites: [] });
        a.count++;
        a.sites.push(at(m));
      }
      if (source.area === "backend") {
        const helperOp = { select: "select", first: "select", patch: "update", insert: "insert", delete: "delete", rest: "unknown" };
        for (const m of text.matchAll(patterns.restHelper)) {
          if (m[2].startsWith("rpc")) continue;
          const t = (area.tables[m[2]] ??= { count: 0, ops: {}, sites: [] });
          t.count++;
          t.ops[helperOp[m[1]]] = (t.ops[helperOp[m[1]]] ?? 0) + 1;
          t.sites.push(at(m));
        }
        for (const m of text.matchAll(patterns.httpApi)) {
          const key = `${m[1]}/v1/${m[2]}`.replace(/\/$/, "");
          const h = (area.httpApis[key] ??= { count: 0, sites: [] });
          h.count++;
          h.sites.push(at(m));
        }
      }
    }
    result.areas[source.area] = area;
  }
  return result;
}

function sum(obj, key = "count") {
  return Object.values(obj).reduce((n, v) => n + (v[key] ?? 0), 0);
}

function markdown(result) {
  const lines = [`# Supabase usage (generated ${result.generatedAt})`, ""];
  for (const [name, a] of Object.entries(result.areas)) {
    lines.push(`## ${name} (${a.files} files)`, "");
    lines.push(
      `- table queries: ${sum(a.tables)} across ${Object.keys(a.tables).length} tables`,
      `- RPC calls: ${sum(a.rpcs)} across ${Object.keys(a.rpcs).length} functions`,
      `- Storage calls: ${Object.values(a.storage).reduce((n, b) => n + b.sites.length, 0)} across ${Object.keys(a.storage).length} buckets`,
      `- Realtime channels: ${a.channels.length} (tables: ${Object.keys(a.realtimeTables).sort().join(", ") || "none"})`,
      `- Auth calls: ${sum(a.auth)} (${Object.entries(a.auth).map(([k, v]) => `${k} x${v.count}`).join(", ") || "none"})`,
      "",
    );
    if (Object.keys(a.tables).length) {
      lines.push("| table | calls | operations |", "|---|---:|---|");
      for (const [t, v] of Object.entries(a.tables).sort((x, y) => y[1].count - x[1].count)) {
        lines.push(`| ${t} | ${v.count} | ${Object.entries(v.ops).map(([o, n]) => `${o} ${n}`).join(", ")} |`);
      }
      lines.push("");
    }
    if (Object.keys(a.rpcs).length) {
      lines.push(`RPCs: ${Object.entries(a.rpcs).sort((x, y) => y[1].count - x[1].count).map(([r, v]) => `\`${r}\`${v.count > 1 ? ` x${v.count}` : ""}`).join(", ")}`, "");
    }
    if (Object.keys(a.storage).length) {
      lines.push("| bucket | operations |", "|---|---|");
      for (const [b, v] of Object.entries(a.storage).sort()) lines.push(`| ${b} | ${Object.entries(v.ops).map(([o, n]) => `${o} ${n}`).join(", ")} |`);
      lines.push("");
    }
    if (Object.keys(a.httpApis).length) {
      lines.push("Direct Supabase HTTP APIs:", ...Object.entries(a.httpApis).map(([k, v]) => `- \`${k}\` x${v.count}`), "");
    }
  }
  return lines.join("\n");
}

const result = scan();
process.stdout.write(process.argv.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : `${markdown(result)}\n`);
