import { defineConfig } from "@playwright/test";

// End-to-end safety net for the React migration (docs/REACT_MIGRATION.md, section 6).
//
// The app under test is a production build made with FAKE public config, so even a bug in a
// test could not reach the live Supabase project. Every network request the page makes is
// answered by tests/e2e/support/network.ts; anything it does not recognise is blocked and
// reported, never passed through.
const PORT = 4180;
const FIXTURE_ENV = {
  VITE_SUPABASE_URL: "https://e2e-fixture.supabase.co",
  VITE_SUPABASE_ANON_KEY: "e2e-fixture-anon-key",
  VITE_VAPID_PUBLIC_KEY: "e2e-fixture-vapid-key",
  VITE_API_BASE_URL: "",
  VITE_BACKEND_FEATURES: "",
};

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",
  // Screenshots live next to the specs and are committed: they are the "before" picture.
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    serviceWorkers: "block",
    locale: "en-NG",
    timezoneId: "Africa/Lagos",
    reducedMotion: "reduce",
  },
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: FIXTURE_ENV,
  },
});
