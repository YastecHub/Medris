import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Db } from "../../src/database/client.js";
import { DataContext } from "../../src/database/context.js";
import * as schema from "../../src/database/schema/index.js";
import { readMigrations, type SqlClient } from "../../scripts/migrations.js";

/**
 * A disposable PostgreSQL database with the Levromart schema, for tests.
 *
 * Default: PGlite (PostgreSQL compiled to WebAssembly, in-process) - no
 * installation, works on Windows/macOS/Linux, nothing touches the network.
 *
 * Optional: set TEST_DATABASE_URL to a real, EMPTY PostgreSQL database whose
 * name ends in "_test" (e.g. postgres://postgres:postgres@localhost:5432/medris_test).
 * The schema is dropped and rebuilt on every run, so the name check refuses
 * anything that is not clearly a test database.
 *
 * Schema = Supabase shim (roles, auth.*) + supabase/01_tables.sql + the column
 * additions from the later supabase/*.sql files + test fixtures (missing
 * tables, RLS policies copied from the Backend Build Manual, simplified
 * stand-ins for the RPCs the backend calls) + the backend's own migrations.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const repoRoot = path.resolve(backendRoot, "..");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/** `alter table ... add column` statements from the incremental supabase/*.sql files. */
function columnAdditions(): string {
  const dir = path.join(repoRoot, "supabase");
  const statements: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => /^\d{2}_.*\.sql$/.test(f) && !f.startsWith("01_") && !f.startsWith("02_")).sort()) {
    const text = read(path.join(dir, file));
    for (const match of text.matchAll(/alter table[^;]*?add column[^;]*;/gis)) {
      // Some of these tables are newer than the 01_tables.sql snapshot; skip those quietly.
      const body = match[0].replace(/;$/, "").replace(/'/g, "''");
      statements.push(`do $$ begin execute '${body}'; exception when undefined_table then null; end $$;`);
    }
  }
  return statements.join("\n");
}

/** The schema as it was before the first migration: shim, snapshot, later columns and test fixtures. */
export function baselineSql(): string[] {
  const fixtures = path.join(backendRoot, "tests", "fixtures");
  return [
    read(path.join(fixtures, "00-supabase-shim.sql")),
    read(path.join(repoRoot, "supabase", "01_tables.sql")),
    columnAdditions(),
    ...fs
      .readdirSync(fixtures)
      .filter((f) => f.endsWith(".sql") && !f.startsWith("00-"))
      .sort()
      .map((f) => read(path.join(fixtures, f))),
  ];
}

/** Baseline plus every migration in src/database/migrations, in order. */
export function schemaSql(): string[] {
  return [...baselineSql(), ...readMigrations().files.map((f) => f.sql)];
}

export interface TestDatabase {
  db: Db;
  data: DataContext;
  /** Runs SQL as the connection owner (bypasses RLS) - for seeding and assertions. */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** One dedicated connection (transactions span calls), e.g. for the migration runner. */
  sqlClient(): Promise<{ client: SqlClient; release(): void }>;
  close(): Promise<void>;
  kind: "pglite" | "postgres";
}

export interface TestDatabaseOptions {
  /** false: stop at the baseline, leaving every migration pending (migration runner tests). */
  migrations?: boolean;
}

export async function createTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const chunks = options.migrations === false ? baselineSql() : schemaSql();
  const url = process.env.TEST_DATABASE_URL;
  if (url) return createPostgresTestDatabase(url, chunks);
  const client = new PGlite();
  for (const chunk of chunks) await client.exec(chunk);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return {
    db,
    data: new DataContext(db),
    kind: "pglite",
    query: async <T>(text: string, params: unknown[] = []) => (await client.query<T>(text, params)).rows,
    sqlClient: async () => ({
      client: {
        query: async <T>(text: string, params: unknown[] = []) => ({ rows: (await client.query<T>(text, params)).rows }),
        exec: (text: string) => client.exec(text),
      },
      release: () => {},
    }),
    close: () => client.close(),
  };
}

async function createPostgresTestDatabase(url: string, chunks: string[]): Promise<TestDatabase> {
  const base = new URL(url);
  const name = base.pathname.replace(/^\//, "");
  if (!/_test$/.test(name)) throw new Error(`TEST_DATABASE_URL must point at a database whose name ends in "_test" (got "${name}").`);

  // Each test file gets its own throwaway database next to the one named in
  // TEST_DATABASE_URL, created here and dropped again in close().
  const scratch = `${name}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create database "${scratch}"`);
  await admin.end();

  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${scratch}`;
  const pool = new pg.Pool({ connectionString: scratchUrl.toString(), max: 4 });
  // Idle clients are terminated when close() drops the scratch database; that is expected, not a test failure.
  pool.on("error", () => {});
  const setup = await pool.connect();
  try {
    // Roles are shared by the whole server; tolerate another file creating them at the same moment.
    for (const chunk of chunks) {
      try {
        await setup.query(chunk);
      } catch (err) {
        if ((err as { code?: string }).code !== "23505" && (err as { code?: string }).code !== "42710") throw err;
        await setup.query(chunk);
      }
    }
  } finally {
    setup.release();
  }
  const db = drizzlePg(pool, { schema }) as unknown as Db;
  return {
    db,
    data: new DataContext(db),
    kind: "postgres",
    query: async <T>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[],
    sqlClient: async () => {
      const connection = await pool.connect();
      return {
        client: {
          query: async <T>(text: string, params: unknown[] = []) => ({ rows: (await connection.query(text, params)).rows as T[] }),
          exec: (text: string) => connection.query(text),
        },
        release: () => connection.release(),
      };
    },
    close: async () => {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: url });
      await cleanup.connect();
      await cleanup.query(`drop database if exists "${scratch}" with (force)`);
      await cleanup.end();
    },
  };
}

/** Removes all rows from the given tables (between tests). */
export async function truncate(testDb: TestDatabase, tables: string[]): Promise<void> {
  if (!tables.length) return;
  await testDb.db.execute(sql.raw(`truncate ${tables.map((t) => (t.includes(".") ? t : `public.${t}`)).join(", ")} cascade`));
}
