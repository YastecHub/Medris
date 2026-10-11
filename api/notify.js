// Vercel function for /api/notify. Every API file re-exports the same Hono app
// (medris-backend, compiled to medris-backend/dist by `npm run build`), which
// routes by URL, so each original endpoint keeps its own function and URL.
export { default } from "../medris-backend/dist/vercel.js";
