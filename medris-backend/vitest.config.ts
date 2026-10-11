import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Tests never reach the live Supabase project, Paystack or Gemini: every
    // outbound request is answered by a stub (see tests/helpers.ts).
    unstubGlobals: true,
  },
});
