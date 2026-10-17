/**
 * Database migrations: `npm run db:<command> -w medris-backend`.
 *
 *   db:status                         which migrations this database has, and which are pending
 *   db:migrate                        DRY RUN: lists what would be applied, changes nothing
 *   db:migrate -- --apply             applies the pending migrations (local databases)
 *   db:migrate -- --apply --confirm <host>
 *                                     the same against a remote database: <host> must repeat the
 *                                     target's host name, so production is never changed by accident
 *   db:migrate -- --only 0003[,0005]  limit the dry run / apply to these pending versions (apply the
 *                                     files that are approved while others wait)
 *   db:migration:new -- <name>        creates the next numbered file from a template
 *   db:migrations:check [-- --base origin/main]
 *                                     validates the files without a database (CI); with --base,
 *                                     also fails when a migration that exists on that branch was
 *                                     edited, renamed or deleted
 *
 * Target: MIGRATE_DATABASE_URL, else DATABASE_URL (medris-backend/.env or the shell).
 * TLS follows DATABASE_SSL_MODE / DATABASE_SSL_CA, like the app.
 * Use a session-mode connection (Supabase session pooler or direct, port 5432):
 * the transaction pooler (port 6543) cannot hold the migration lock.
 *
 * Process and rules: docs/DATABASE.md, section 3.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadConfig } from "../src/config/app-config.js";
import { poolConfig } from "../src/config/database.js";
import {
  BACKEND_ROOT,
  MIGRATIONS_DIR,
  MigrationFailedError,
  applyMigrations,
  changedSince,
  migrationTemplate,
  nextVersion,
  planMigrations,
  readApplied,
  readMigrations,
  slugify,
  type SqlClient,
  type StatusEntry,
} from "./migrations.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "db"]);

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function option(args: string[], name: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function loadEnv(): void {
  try {
    process.loadEnvFile(path.join(BACKEND_ROOT, ".env"));
  } catch {
    /* rely on the shell environment */
  }
}

interface Target {
  url: URL;
  label: string;
  local: boolean;
}

function target(): Target {
  const raw = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) fail("Set MIGRATE_DATABASE_URL (or DATABASE_URL) to the database to migrate. See docs/DATABASE.md, section 3.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("MIGRATE_DATABASE_URL / DATABASE_URL is not a valid URL (URL-encode special characters in the password).");
  }
  const label = `${decodeURIComponent(url.username) || "?"}@${url.hostname}:${url.port || "5432"}${url.pathname}`;
  return { url, label, local: LOCAL_HOSTS.has(url.hostname) };
}

async function connect(t: Target): Promise<{ client: SqlClient; close(): Promise<void> }> {
  let config;
  try {
    config = poolConfig(loadConfig({ ...process.env, DATABASE_URL: t.url.toString() }));
  } catch (err) {
    fail(`Invalid database settings: ${err instanceof Error ? err.message : String(err)}`);
  }
  const pgClient = new pg.Client({
    connectionString: config.connectionString,
    ssl: config.ssl,
    connectionTimeoutMillis: 15_000,
    application_name: "medris-migrate",
  });
  try {
    await pgClient.connect();
  } catch (err) {
    fail(`Could not connect to ${t.label}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const client: SqlClient = {
    query: async <T>(text: string, params?: unknown[]) => ({ rows: (await pgClient.query(text, params)).rows as T[] }),
    exec: (text: string) => pgClient.query(text),
  };
  return { client, close: () => pgClient.end() };
}

function printEntries(entries: StatusEntry[]): void {
  if (!entries.length) {
    console.log("  (no migrations)");
    return;
  }
  for (const e of entries) {
    const when = e.appliedAt ? `  ${new Date(e.appliedAt).toISOString().replace("T", " ").slice(0, 16)} UTC by ${e.appliedBy}` : "";
    console.log(`  ${e.state.padEnd(8)} ${e.version}_${e.name}${when}`);
  }
}

function readFilesOrFail() {
  const { files, problems } = readMigrations();
  if (problems.length) fail(`Migration files have problems:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  return files;
}

async function status(): Promise<void> {
  const files = readFilesOrFail();
  const t = target();
  const { client, close } = await connect(t);
  try {
    const plan = planMigrations(files, await readApplied(client));
    console.log(`\nMigrations on ${t.label}\n`);
    printEntries(plan.entries);
    console.log(`\n${plan.pending.length} pending.`);
    for (const w of plan.warnings) console.log(`warning: ${w}`);
    if (plan.problems.length) fail(`Problems:\n${plan.problems.map((p) => `  - ${p}`).join("\n")}`);
  } finally {
    await close();
  }
}

async function migrate(args: string[]): Promise<void> {
  const files = readFilesOrFail();
  const t = target();
  const apply = args.includes("--apply");
  const onlyArg = option(args, "--only");
  const only = onlyArg ? onlyArg.split(",").map((v) => v.trim().padStart(4, "0")) : undefined;
  if (only) {
    const unknown = only.filter((v) => !files.some((f) => f.version === v));
    if (unknown.length) fail(`--only: no migration file with version ${unknown.join(", ")}.`);
  }

  if (apply) {
    if (t.url.port === "6543") {
      fail(
        "Port 6543 is Supabase's transaction pooler, which cannot hold the migration lock.\n" +
          "Set MIGRATE_DATABASE_URL to the session pooler or direct connection (port 5432).",
      );
    }
    if (!t.local && option(args, "--confirm") !== t.url.hostname) {
      fail(
        `${t.label} is not a local database. To apply migrations to it, repeat its host name:\n` +
          `  npm run db:migrate -w medris-backend -- --apply --confirm ${t.url.hostname}\n` +
          "Production changes need approval first (docs/DATABASE.md, section 3).",
      );
    }
  }

  const { client, close } = await connect(t);
  try {
    const plan = planMigrations(files, await readApplied(client));
    if (plan.problems.length) fail(`Nothing was applied. Problems:\n${plan.problems.map((p) => `  - ${p}`).join("\n")}`);
    for (const w of plan.warnings) console.log(`warning: ${w}`);
    const selected = plan.pending.filter((f) => !only || only.includes(f.version));
    if (only) {
      const done = only.filter((v) => !selected.some((f) => f.version === v));
      for (const v of done) console.log(`${v} is already applied.`);
    }
    if (!selected.length) {
      console.log(`\n${t.label}: nothing to apply${only ? " for --only" : ""} (${files.length} migrations, ${plan.pending.length} pending).\n`);
      return;
    }
    if (!apply) {
      console.log(`\nDry run - would apply to ${t.label}:\n`);
      for (const f of selected) console.log(`  ${f.filename}${f.transactional ? "" : "  (no transaction)"}`);
      const flags = `--apply${only ? ` --only ${only.join(",")}` : ""}${t.local ? "" : ` --confirm ${t.url.hostname}`}`;
      console.log(`\nNothing was changed. Add ${flags} to apply.\n`);
      return;
    }
    console.log(`\nApplying to ${t.label}:\n`);
    const result = await applyMigrations(client, files, {
      only,
      onApplied: (file, ms) => console.log(`  applied  ${file.filename}  (${ms} ms)`),
    });
    if (result.plan.problems.length) fail(`Nothing was applied. Problems:\n${result.plan.problems.map((p) => `  - ${p}`).join("\n")}`);
    console.log(`\n${result.applied.length} applied.\n`);
  } catch (err) {
    if (err instanceof MigrationFailedError) fail(err.message);
    throw err;
  } finally {
    await close();
  }
}

function create(args: string[]): void {
  const name = slugify(args.filter((a) => !a.startsWith("--")).join(" "));
  if (!name) fail('Give the migration a name: npm run db:migration:new -w medris-backend -- "add order index"');
  const files = readFilesOrFail();
  const version = nextVersion(files);
  const filename = `${version}_${name}.sql`;
  fs.writeFileSync(path.join(MIGRATIONS_DIR, filename), migrationTemplate(version, name));
  console.log(`Created ${path.relative(process.cwd(), path.join(MIGRATIONS_DIR, filename))}`);
}

function check(args: string[]): void {
  const { files, problems } = readMigrations();
  const base = option(args, "--base");
  if (base) {
    let edited: string[] = [];
    try {
      edited = changedSince(base);
    } catch (err) {
      fail(`Could not compare with ${base}: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const file of edited) {
      problems.push(`${file} already exists on ${base} and was edited, renamed or deleted. Merged migrations are append-only: add a new migration instead.`);
    }
  }
  if (problems.length) fail(`Migration check failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  console.log(`Migration files OK (${files.length}${base ? `, none of those on ${base} changed` : ""}).`);
}

loadEnv();
const [command = "status", ...args] = process.argv.slice(2);
switch (command) {
  case "status":
    await status();
    break;
  case "up":
    await migrate(args);
    break;
  case "new":
    create(args);
    break;
  case "check":
    check(args);
    break;
  default:
    fail(`Unknown command "${command}". Use status, up, new or check.`);
}
