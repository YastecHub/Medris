import { sql } from "drizzle-orm";
import type { CatalogueRow } from "../../contracts/v1.js";
import type { Executor } from "../client.js";
import { rowsOf } from "../client.js";

/**
 * Reference data for the catalogue. Rows are returned with every column, as
 * the app's `select("*")` did, and serialised by PostgreSQL itself (to_json),
 * so values look exactly as they did through Supabase's REST API.
 */
export class CatalogueRepository {
  constructor(private readonly db: Executor) {}

  async listSectors(order: "sort_order" | "name"): Promise<CatalogueRow[]> {
    const orderBy = order === "name" ? sql`s.name` : sql`s.sort_order`;
    const result = await this.db.execute(sql`
      select coalesce(json_agg(to_json(s) order by ${orderBy}), '[]'::json) as rows
      from public.sectors s`);
    return (rowsOf<{ rows: CatalogueRow[] }>(result)[0]?.rows ?? []);
  }

  async listCategories(options: { sectorId?: string }): Promise<CatalogueRow[]> {
    const where = options.sectorId ? sql`where c.sector_id = ${options.sectorId}` : sql``;
    const result = await this.db.execute(sql`
      select coalesce(json_agg(to_json(c) order by c.name), '[]'::json) as rows
      from public.categories c ${where}`);
    return (rowsOf<{ rows: CatalogueRow[] }>(result)[0]?.rows ?? []);
  }
}
