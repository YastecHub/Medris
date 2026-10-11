import { sql, type SQL } from "drizzle-orm";
import type { Executor } from "./client.js";
import { rowsOf } from "./client.js";

/**
 * Runs a SELECT and returns its rows serialised by PostgreSQL (to_json), so
 * timestamps, numerics and nested json_build_object() values come out exactly
 * as Supabase's REST API returned them.
 */
export async function jsonRows<T = Record<string, unknown>>(db: Executor, query: SQL): Promise<T[]> {
  const rows = rowsOf<{ rows: T[] }>(await db.execute(sql`select coalesce(json_agg(to_json(q)), '[]'::json) as rows from (${query}) q`));
  return rows[0]?.rows ?? [];
}

export async function jsonRow<T = Record<string, unknown>>(db: Executor, query: SQL): Promise<T | null> {
  const [row] = await jsonRows<T>(db, query);
  return row ?? null;
}
