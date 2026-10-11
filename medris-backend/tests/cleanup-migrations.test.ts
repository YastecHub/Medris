import { describe, expect, it } from "vitest";
import { MigrationFailedError, applyMigrations, readApplied, readMigrations, type SqlClient } from "../scripts/migrations.js";
import { createTestDatabase } from "./support/test-db.js";

/**
 * The clean-up migrations from Backend Build Manual section 11 (0003-0006).
 * Production cannot be reached from tests, so each safety check is exercised
 * here: the migration must do its job when the database looks as the manual
 * describes, and stop without changing anything when it does not.
 */

const FOOD_DUPLICATE = "a5a6c2b2-2c52-4c4c-b386-bc64a8760a61";
const PHOTO_DUPLICATE = "d35d824f-4b7c-4890-9736-3d58c5cccd48";

/** The live-database shape the manual describes, on top of the test baseline. */
const LIVE_SHAPE = `
  create index vendor_packages_name_trgm_idx on public.vendor_packages (name);
  create index idx_vendor_packages_name_trgm on public.vendor_packages (name);
  create index vendor_packages_description_trgm_idx on public.vendor_packages (description);
  create index idx_vendor_packages_description_trgm on public.vendor_packages (description);

  insert into public.sectors (id, slug, name, icon, sort_order) values
    ('00000000-0000-4000-8000-0000000000f1', 'food', 'Food & Groceries', 'fa-basket-shopping', 3),
    ('${FOOD_DUPLICATE}', 'food-groceries', 'Food & Groceries', 'fa-shapes', 90),
    ('00000000-0000-4000-8000-0000000000f2', 'photo', 'Photography', 'fa-camera', 4),
    ('${PHOTO_DUPLICATE}', 'photography', 'Photography', 'fa-shapes', 91);

  insert into public.inventory (type, category, item_name, urgency, hospital_name, phone)
  values ('blood', 'blood', 'O+', 'high', 'General Hospital', '080');

  create function public.search_products_full(p_query text, p_limit int default 20) returns setof public.products
    language sql stable as $$ select * from public.products where name ilike '%' || p_query || '%' limit p_limit $$;
  create function public.search_products_full_v2(p_query text, p_limit int default 20) returns setof public.products
    language sql stable as $$ select * from public.products where name ilike '%' || p_query || '%' limit p_limit $$;
`;

async function withDatabase(setup: string, run: (client: SqlClient) => Promise<void>): Promise<void> {
  const database = await createTestDatabase({ migrations: false });
  const { client, release } = await database.sqlClient();
  try {
    await client.exec(setup);
    await run(client);
  } finally {
    release();
    await database.close();
  }
}

const one = async <T>(client: SqlClient, sql: string, params: unknown[] = []) => (await client.query<T>(sql, params)).rows[0] as T;
const exists = async (client: SqlClient, sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows.length > 0;
const indexExists = (client: SqlClient, name: string) => exists(client, "select 1 from pg_class where relkind = 'i' and relname = $1", [name]);
const sectorExists = (client: SqlClient, id: string) => exists(client, "select 1 from public.sectors where id = $1", [id]);
const functionSchema = async (client: SqlClient, name: string) =>
  (await one<{ nspname?: string }>(client, "select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = $1", [name]))?.nspname;

async function expectFailure(client: SqlClient, version: string, message: RegExp): Promise<void> {
  const error = await applyMigrations(client, readMigrations().files).catch((err: unknown) => err);
  expect(error).toBeInstanceOf(MigrationFailedError);
  expect((error as MigrationFailedError).file.version).toBe(version);
  expect((error as Error).message).toMatch(message);
  // Everything before the failing file is applied, the failing file is not.
  const applied = (await readApplied(client)).map((r) => r.version);
  expect(applied).not.toContain(version);
}

describe("clean-up migrations (manual section 11)", () => {
  it("do their job on a database shaped like production", async () => {
    await withDatabase(LIVE_SHAPE, async (client) => {
      await applyMigrations(client, readMigrations().files);

      // 0003: the copies are gone, the twins stay.
      expect(await indexExists(client, "idx_vendor_packages_name_trgm")).toBe(false);
      expect(await indexExists(client, "idx_vendor_packages_description_trgm")).toBe(false);
      expect(await indexExists(client, "vendor_packages_name_trgm_idx")).toBe(true);
      expect(await indexExists(client, "vendor_packages_description_trgm_idx")).toBe(true);

      // 0004: only the two duplicate rows are deleted.
      expect(await sectorExists(client, FOOD_DUPLICATE)).toBe(false);
      expect(await sectorExists(client, PHOTO_DUPLICATE)).toBe(false);
      expect(await sectorExists(client, "00000000-0000-4000-8000-0000000000f1")).toBe(true);
      expect(await sectorExists(client, "00000000-0000-4000-8000-0000000000f2")).toBe(true);

      // 0005: the table moved with its rows; nothing deleted.
      expect((await one<{ t: string | null }>(client, "select to_regclass('public.inventory')::text as t")).t).toBeNull();
      expect(Number((await one<{ n: number }>(client, "select count(*) as n from retired.inventory")).n)).toBe(1);

      // 0006: v1 moved, v2 untouched.
      expect(await functionSchema(client, "search_products_full")).toBe("retired");
      expect(await functionSchema(client, "search_products_full_v2")).toBe("public");

      // The API roles cannot reach the retired schema.
      const usage = await one<{ anon: boolean; auth: boolean }>(
        client,
        "select has_schema_privilege('anon', 'retired', 'usage') as anon, has_schema_privilege('authenticated', 'retired', 'usage') as auth",
      );
      expect(usage).toEqual({ anon: false, auth: false });
    });
  });

  it("0003 refuses to drop a copy whose twin is missing", async () => {
    await withDatabase(`${LIVE_SHAPE}\ndrop index public.vendor_packages_name_trgm_idx;`, async (client) => {
      await expectFailure(client, "0003", /idx_vendor_packages_name_trgm exists but its twin vendor_packages_name_trgm_idx does not/);
      expect(await indexExists(client, "idx_vendor_packages_name_trgm")).toBe(true);
      expect(await indexExists(client, "idx_vendor_packages_description_trgm")).toBe(true);
    });
  });

  it("0003 refuses to drop a copy that differs from its twin", async () => {
    const shape = `${LIVE_SHAPE}
      drop index public.vendor_packages_description_trgm_idx;
      create index vendor_packages_description_trgm_idx on public.vendor_packages (name);`;
    await withDatabase(shape, async (client) => {
      await expectFailure(client, "0003", /are not identical/);
      expect(await indexExists(client, "idx_vendor_packages_name_trgm")).toBe(true);
    });
  });

  it("0004 refuses to delete a sector that is in use", async () => {
    const shape = `${LIVE_SHAPE}
      insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000aa01', 'v@test.local');
      insert into public.users (id, name, email, role) values ('00000000-0000-4000-8000-00000000aa01', 'v', 'v@test.local', 'vendor');
      insert into public.vendors (user_id, business_name, sector_id) values ('00000000-0000-4000-8000-00000000aa01', 'Shop', '${PHOTO_DUPLICATE}');`;
    await withDatabase(shape, async (client) => {
      await expectFailure(client, "0004", /is used by vendors: not deleting/);
      expect(await sectorExists(client, FOOD_DUPLICATE)).toBe(true);
      expect(await sectorExists(client, PHOTO_DUPLICATE)).toBe(true);
    });
  });

  it("0004 refuses to delete a sector that has no twin", async () => {
    await withDatabase(`${LIVE_SHAPE}\ndelete from public.sectors where id = '00000000-0000-4000-8000-0000000000f2';`, async (client) => {
      await expectFailure(client, "0004", /is the only "Photography"/);
      expect(await sectorExists(client, FOOD_DUPLICATE)).toBe(true);
    });
  });

  it("0005 refuses to retire inventory while a function still uses it", async () => {
    const shape = `${LIVE_SHAPE}
      create function public.count_blood_stock() returns bigint language plpgsql as $$
      begin return (select count(*) from public.inventory); end $$;`;
    await withDatabase(shape, async (client) => {
      await expectFailure(client, "0005", /public\.inventory is still used by: count_blood_stock\(\)/);
      expect((await one<{ t: string | null }>(client, "select to_regclass('public.inventory')::text as t")).t).toBe("inventory");
    });
  });

  it("0006 refuses to retire search v1 while another function calls it", async () => {
    const shape = `${LIVE_SHAPE}
      create function public.search_wrapper(q text) returns setof public.products
        language sql stable as $$ select * from public.search_products_full(q, 10) $$;`;
    await withDatabase(shape, async (client) => {
      await expectFailure(client, "0006", /search_products_full is still called by: search_wrapper\(text\)/);
      expect(await functionSchema(client, "search_products_full")).toBe("public");
    });
  });
});
