---
trigger: model_decision
description: Use when something is slow - page load, a screen, search, scrolling, a database query, an API function - or to reduce Supabase/Vercel usage and bandwidth.
---

# Performance optimizer

Measure before changing anything, and measure again after with the same steps. Never invent numbers.

Known levers in this codebase:

- **Supabase bandwidth and round trips** are the main cost. The read cache in `window.__levroSafeFetch` (early script
  in the legacy head) caches slow-changing tables; select only needed columns; batch per-row calls into one RPC; use
  realtime instead of polling.
- **Infinite scroll** loads 24 items at a time; offline home data is cached in `localStorage`.
- **Images:** public images live on Cloudflare R2 and are compressed in the browser before upload
  (`lib/compress-image.js`); use sized images and lazy loading.
- **Service worker** caches the app shell; a change only reaches installed apps after the asset version bump.
- **Database:** check query plans and indexes for the filters actually used (`database-specialist.md`); an index is a
  migration that needs approval.
- The page is one large document by design; do not split or rewrite it for speed inside a normal task.

Use the browser's DevTools (Performance/Network/Lighthouse) at phone width with network throttling where possible.
Report a table: symptom, baseline, cause, change, result, trade-off.
