import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Tests never reach the live Supabase project, Paystack or Gemini: every
    // outbound request is answered by a stub (see tests/helpers.ts), and the
    // database is a disposable in-process PostgreSQL (tests/support/test-db.ts).
    unstubGlobals: true,
    env: { LOG_LEVEL: "error" },
    // PGlite boots a PostgreSQL instance per test file; give it room on slow machines.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
