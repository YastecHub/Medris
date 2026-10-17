/**
 * Prepares a LOCAL PostgreSQL database for development:
 *
 *   npm run db:dev -w medris-backend                 # schema only
 *   npm run db:dev -w medris-backend -- --seed       # plus a few demo rows
 *
 * Uses DATABASE_URL from medris-backend/.env. Refuses to run unless the
 * database host is local (localhost, 127.0.0.1, ::1 or the docker-compose
 * service "db"), so it can never touch Supabase or any other remote database.
 *
 * The schema is the same approximation the tests use (supabase/01_tables.sql,
 * the later column additions, test policies and simplified stand-ins for the
 * database functions), followed by every migration through the migration
 * runner (recorded in medris_migrations.applied; `npm run db:status` shows
 * them). For a faithful copy of production, restore a schema-only dump instead
 * (docs/DATABASE.md, "A faithful local copy").
 */
import pg from "pg";
import { baselineSql } from "../tests/support/test-db.js";
import { applyMigrations, readMigrations } from "./migrations.js";

try {
  process.loadEnvFile(".env");
} catch {
  /* rely on the shell environment */
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (see medris-backend/.env.example and docker-compose.yml).");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]", "db"].includes(host)) {
  console.error(`Refusing to load the development schema into a non-local database (${host}).`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const existing = await client.query("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
if (existing.rows[0].n > 0) {
  console.error("This database already has tables in public; drop and re-create it first (docker compose down -v).");
  await client.end();
  process.exit(1);
}
for (const chunk of baselineSql()) {
  try {
    await client.query(chunk);
  } catch (err) {
    // Roles are server-wide and may already exist from another local database.
    if ((err as { code?: string }).code !== "42710" && (err as { code?: string }).code !== "23505") throw err;
  }
}
// Migrations go through the runner, so this database records them like production does.
const { applied } = await applyMigrations(
  { query: async (text, params) => ({ rows: (await client.query(text, params)).rows }), exec: (text) => client.query(text) },
  readMigrations().files,
);
console.log(`Applied ${applied.length} migrations.`);

if (process.argv.includes("--seed")) {
  const buyer = "00000000-0000-4000-8000-00000000b001";
  const owner = "00000000-0000-4000-8000-00000000a001";
  const sector = "00000000-0000-4000-8000-00000000e001";
  const vendor = "00000000-0000-4000-8000-00000000c001";
  const people: [string, string, string][] = [
    [buyer, "buyer@dev.local", "buyer"],
    [owner, "vendor@dev.local", "vendor"],
  ];
  for (const [id, email, role] of people) {
    await client.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, email]);
    await client.query("insert into public.users (id, name, email, role) values ($1, $2, $3, $4)", [id, email.split("@")[0], email, role]);
  }
  await client.query("insert into public.sectors (id, slug, name, sort_order) values ($1, 'electronics', 'Electronics', 1)", [sector]);
  await client.query(
    "insert into public.vendors (id, user_id, business_name, sector_id, verification_status, is_active) values ($1, $2, 'Dev Shop', $3, 'verified', true)",
    [vendor, owner, sector],
  );
  await client.query("insert into public.products (vendor_id, name, listing_type, sale_price, status) values ($1, 'Rechargeable lamp', 'sale', 8000, 'active')", [vendor]);
  console.log(`Seeded demo rows (buyer ${buyer}, vendor owner ${owner}).`);
}
await client.end();
console.log("Local development schema ready.");
