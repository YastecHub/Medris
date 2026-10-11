import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Versioned SQL migrations for the Levromart database.
 *
 * Every change to the database schema, functions, policies or grants is a
 * plain SQL file in `src/database/migrations/` named `NNNN_snake_case.sql`
 * (four-digit version, applied in order). `scripts/migrate.ts` applies the
 * files that a database has not seen yet and records each one in
 * `medris_migrations.applied` (version, name, checksum, who, when), so any
 * database can say exactly which changes it has.
 *
 * Rules the tooling enforces:
 *  - a file that has been applied must never change (its checksum is compared);
 *  - each file runs in its own transaction together with its tracking row, so a
 *    failure leaves nothing half-applied (opt out with `-- migrate:no-transaction`
 *    for statements PostgreSQL refuses inside a transaction, e.g. CREATE INDEX
 *    CONCURRENTLY);
 *  - files must not contain their own BEGIN/COMMIT;
 *  - only one runner works on a database at a time (advisory lock).
 *
 * This module has no CLI and no connection handling, so the tests can drive it
 * against PGlite or PostgreSQL. See docs/DATABASE.md section 3.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(here, "..");
export const MIGRATIONS_DIR = path.join(BACKEND_ROOT, "src", "database", "migrations");

export const TRACKING_SCHEMA = "medris_migrations";
export const TRACKING_TABLE = `${TRACKING_SCHEMA}.applied`;
/** Arbitrary constant for pg_advisory_lock: "medris migrations". */
const ADVISORY_LOCK_KEY = 4_284_202_610;

const FILE_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const NO_TRANSACTION = /^--\s*migrate:no-transaction\s*$/m;
/**
 * BEGIN / COMMIT / ROLLBACK as statements of their own, outside function bodies
 * (dollar-quoted bodies are removed first; PL/pgSQL `begin` has no semicolon).
 */
const OWN_TRANSACTION = /^\s*(begin|start\s+transaction|commit|rollback)\s*;/im;

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
  /** False when the file starts with `-- migrate:no-transaction`. */
  transactional: boolean;
}

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date | string;
  applied_by: string;
}

/** The two operations the runner needs; satisfied by node-postgres clients and PGlite. */
export interface SqlClient {
  /** One statement, optionally with $1.. parameters. */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** A script of one or more statements, no parameters. */
  exec(text: string): Promise<unknown>;
}

/** Line endings are normalised so a file checked out on Windows has the same checksum. */
export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

export interface ReadResult {
  files: MigrationFile[];
  /** Problems that make the folder unusable (bad names, duplicates, own transactions). */
  problems: string[];
}

/** Reads and validates every migration file in `dir`, ordered by version. */
export function readMigrations(dir: string = MIGRATIONS_DIR): ReadResult {
  const problems: string[] = [];
  const files: MigrationFile[] = [];
  const seen = new Map<string, string>();

  for (const filename of fs.readdirSync(dir).sort()) {
    if (filename.toLowerCase().endsWith(".md")) continue; // notes next to the migrations
    const match = FILE_PATTERN.exec(filename);
    if (!match) {
      problems.push(`${filename}: not a migration file name. Use NNNN_snake_case.sql (e.g. 0003_add_order_index.sql).`);
      continue;
    }
    const [, version = "", name = ""] = match;
    const previous = seen.get(version);
    if (previous) {
      problems.push(`${filename}: version ${version} is already used by ${previous}. Renumber the newer file.`);
      continue;
    }
    seen.set(version, filename);

    const sql = fs.readFileSync(path.join(dir, filename), "utf8");
    const transactional = !NO_TRANSACTION.test(sql);
    if (!sql.replace(/--[^\n]*/g, "").trim()) problems.push(`${filename}: the file has no SQL.`);
    if (transactional && OWN_TRANSACTION.test(stripComments(sql))) {
      problems.push(`${filename}: contains its own BEGIN/COMMIT. Remove them (the runner wraps each file in a transaction) or start the file with "-- migrate:no-transaction".`);
    }
    files.push({ version, name, filename, sql, checksum: checksumOf(sql), transactional });
  }
  return { files, problems };
}

/** Removes comments and dollar-quoted bodies ($$...$$, $fn$...$fn$) so only top-level statements remain. */
function stripComments(sql: string): string {
  return sql
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "");
}

/** Applied rows, oldest first; empty when the tracking table does not exist yet. */
export async function readApplied(client: SqlClient): Promise<AppliedMigration[]> {
  const { rows } = await client.query<{ exists: boolean }>(`select to_regclass('${TRACKING_TABLE}') is not null as exists`);
  if (!rows[0]?.exists) return [];
  return (
    await client.query<AppliedMigration>(`select version, name, checksum, applied_at, applied_by from ${TRACKING_TABLE} order by version`)
  ).rows;
}

export type MigrationState = "applied" | "pending" | "changed" | "missing";

export interface StatusEntry {
  version: string;
  name: string;
  state: MigrationState;
  appliedAt?: Date | string;
  appliedBy?: string;
}

export interface MigrationPlan {
  entries: StatusEntry[];
  pending: MigrationFile[];
  /** Applied files that changed or disappeared; nothing may be applied until they are resolved. */
  problems: string[];
  /** Pending files numbered below an applied one (usually two branches merged in a different order). */
  warnings: string[];
}

export function planMigrations(files: MigrationFile[], applied: AppliedMigration[]): MigrationPlan {
  const appliedByVersion = new Map(applied.map((row) => [row.version, row]));
  const fileVersions = new Set(files.map((f) => f.version));
  const entries: StatusEntry[] = [];
  const pending: MigrationFile[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];
  const latestApplied = applied.reduce((max, row) => (row.version > max ? row.version : max), "");

  for (const file of files) {
    const row = appliedByVersion.get(file.version);
    if (!row) {
      entries.push({ version: file.version, name: file.name, state: "pending" });
      pending.push(file);
      if (latestApplied && file.version < latestApplied) {
        warnings.push(`${file.filename} is pending but ${latestApplied} is already applied; it will run after it.`);
      }
    } else if (row.checksum !== file.checksum) {
      entries.push({ version: file.version, name: file.name, state: "changed", appliedAt: row.applied_at, appliedBy: row.applied_by });
      problems.push(
        `${file.filename} was edited after it was applied (checksum differs). Restore the applied version and put the change in a new migration.`,
      );
    } else {
      entries.push({ version: file.version, name: file.name, state: "applied", appliedAt: row.applied_at, appliedBy: row.applied_by });
    }
  }
  for (const row of applied) {
    if (fileVersions.has(row.version)) continue;
    entries.push({ version: row.version, name: row.name, state: "missing", appliedAt: row.applied_at, appliedBy: row.applied_by });
    problems.push(`${row.version}_${row.name}.sql is recorded as applied but the file is not in the repository.`);
  }
  entries.sort((a, b) => a.version.localeCompare(b.version));
  return { entries, pending, problems, warnings };
}

export async function ensureTrackingTable(client: SqlClient): Promise<void> {
  await client.exec(`
    create schema if not exists ${TRACKING_SCHEMA};
    create table if not exists ${TRACKING_TABLE} (
      version      text primary key,
      name         text not null,
      checksum     text not null,
      applied_at   timestamptz not null default now(),
      applied_by   text not null default current_user,
      execution_ms integer not null
    );
    comment on table ${TRACKING_TABLE} is 'Database migrations applied by medris-backend/scripts/migrate.ts (see docs/DATABASE.md).';
    revoke all on schema ${TRACKING_SCHEMA} from public;
  `);
}

export class MigrationFailedError extends Error {
  constructor(
    readonly file: MigrationFile,
    cause: unknown,
    readonly partial: boolean,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      partial
        ? `${file.filename} failed part-way (it runs without a transaction): ${reason}. Check the database by hand before re-running.`
        : `${file.filename} failed and was rolled back: ${reason}`,
      { cause },
    );
    this.name = "MigrationFailedError";
  }
}

export interface ApplyResult {
  applied: { file: MigrationFile; ms: number }[];
  plan: MigrationPlan;
}

/**
 * Applies every pending migration in order, each in its own transaction with
 * its tracking row. Refuses to start while the plan has problems. Stops at the
 * first failure (earlier files stay applied, the failing one is rolled back).
 */
export async function applyMigrations(
  client: SqlClient,
  files: MigrationFile[],
  options: {
    lockTimeout?: string;
    /** Apply only these pending versions (others stay pending), e.g. one approved file. */
    only?: readonly string[];
    onApplied?: (file: MigrationFile, ms: number) => void;
  } = {},
): Promise<ApplyResult> {
  const lockTimeout = options.lockTimeout ?? "10s";
  await ensureTrackingTable(client);
  await client.query("select pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
  try {
    // Read again under the lock: another runner may have applied something meanwhile.
    const plan = planMigrations(files, await readApplied(client));
    if (plan.problems.length) return { applied: [], plan };
    const only = options.only ? new Set(options.only) : undefined;

    const applied: ApplyResult["applied"] = [];
    for (const file of plan.pending.filter((f) => !only || only.has(f.version))) {
      const started = performance.now();
      if (file.transactional) {
        await client.exec("begin");
        try {
          // Fail fast instead of queueing behind a long-running query on a busy table.
          await client.exec(`set local lock_timeout = '${lockTimeout}'`);
          await client.exec(file.sql);
          await record(client, file, Math.round(performance.now() - started));
          await client.exec("commit");
        } catch (err) {
          await client.exec("rollback").catch(() => {});
          throw new MigrationFailedError(file, err, false);
        }
      } else {
        try {
          await client.exec(file.sql);
        } catch (err) {
          throw new MigrationFailedError(file, err, true);
        }
        await record(client, file, Math.round(performance.now() - started));
      }
      const ms = Math.round(performance.now() - started);
      applied.push({ file, ms });
      options.onApplied?.(file, ms);
    }
    return { applied, plan };
  } finally {
    await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
  }
}

async function record(client: SqlClient, file: MigrationFile, ms: number): Promise<void> {
  await client.query(`insert into ${TRACKING_TABLE} (version, name, checksum, execution_ms) values ($1, $2, $3, $4)`, [
    file.version,
    file.name,
    file.checksum,
    ms,
  ]);
}

/**
 * Migration files that existed at `baseRef` (e.g. origin/main) and were since
 * modified, renamed or deleted - in commits or in the working tree. Merged
 * migrations may already be applied somewhere, so they are append-only.
 */
export function changedSince(baseRef: string, dir: string = MIGRATIONS_DIR): string[] {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const repoRoot = git("rev-parse", "--show-toplevel");
  const base = git("merge-base", baseRef, "HEAD");
  const relative = path.relative(repoRoot, dir).split(path.sep).join("/");
  const out = execFileSync("git", ["diff", "--name-status", "--no-renames", base, "--", relative], { cwd: repoRoot, encoding: "utf8" });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[MDT]\s/.test(line))
    .map((line) => line.replace(/^[MDT]\s+/, ""));
}

/** `add order index` -> `add_order_index`. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function nextVersion(files: MigrationFile[]): string {
  const latest = files.reduce((max, f) => Math.max(max, Number(f.version)), 0);
  return String(latest + 1).padStart(4, "0");
}

export function migrationTemplate(version: string, name: string): string {
  const title = name.replace(/_/g, " ");
  return `-- =============================================================================
-- ${version}  ${title}
-- =============================================================================
-- Why:        <the problem this solves>
-- Effect:     <tables / columns / functions / policies / grants it adds or changes>
-- Roll back:  <the SQL that undoes it, or why it cannot be undone>
-- Approved:   <who approved applying it to production, and when>
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

`;
}
