import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import type { AppConfig } from "../config/app-config.js";
import { poolConfig } from "../config/database.js";
import * as schema from "./schema/index.js";

/**
 * Database connection: one node-postgres pool per process (per Vercel
 * function instance) wrapped by Drizzle.
 *
 * `Db` is the driver-independent Drizzle type, so the same repositories run on
 * node-postgres in production and on PGlite (in-process PostgreSQL) in tests.
 */
export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the database itself or an open transaction. */
export type Executor = Db | Tx;

export interface DatabaseHandle {
  db: Db;
  close(): Promise<void>;
}

export function createPostgresDatabase(config: AppConfig): DatabaseHandle {
  const pool = new pg.Pool(poolConfig(config));
  // An idle client losing its connection must not crash the process.
  pool.on("error", () => {});
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, close: () => pool.end() };
}

/** Rows from `db.execute(sql...)`, independent of the driver's result shape. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
