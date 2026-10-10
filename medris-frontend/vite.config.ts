import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { legacyDocumentPlugin } from "./build/legacy-document";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), legacyDocumentPlugin()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        // Request/response types shared with the backend (type-only imports).
        "@medris/contracts": fileURLToPath(new URL("../medris-backend/src/contracts/api.ts", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      // Same-origin /api in development, like production on Vercel.
      proxy: { "/api": { target: env.VITE_DEV_API_PROXY || "http://localhost:8787", changeOrigin: false } },
    },
    preview: {
      port: 4173,
      proxy: { "/api": { target: env.VITE_DEV_API_PROXY || "http://localhost:8787", changeOrigin: false } },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // The legacy document is ~4.3 MB of inline HTML/CSS/JS by design (see build/legacy-document.ts).
      chunkSizeWarningLimit: 600,
    },
  };
});
