import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

/** Local development server: `npm run dev -w medris-backend`. Reads medris-backend/.env when present. */
try {
  process.loadEnvFile(".env");
} catch {
  /* no .env file: rely on the shell environment */
}

const port = Number(process.env.PORT || 8787);

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`medris-backend listening on http://localhost:${info.port}`);
});
