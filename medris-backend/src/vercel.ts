import { handle } from "@hono/node-server/vercel";
import { createApp } from "./app.js";

/**
 * Vercel Node.js function handler. The repository's api/index.js re-exports
 * this, and vercel.json rewrites every /api/* request to that one function,
 * so the whole API counts as a single serverless function.
 */
export default handle(createApp());
