import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit is used read-only here: `npm run db:introspect -w medris-backend`
 * writes a full, generated description of the live schema to
 * drizzle/introspected/ for reference (it never changes the database).
 *
 * Schema changes are NOT made with drizzle-kit push/migrate: they are reviewed
 * SQL files in src/database/migrations/, applied by hand after approval
 * (docs/DATABASE.md).
 */
export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle/introspected",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
