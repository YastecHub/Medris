# Levromart

Nigerian marketplace PWA – buy, sell, connect. Plain HTML/JS frontend (`index.html`), Vercel serverless API (`api/`),
Supabase database (`supabase/`).

* **Start here:** [`docs/BUILD_MANUAL.md`](docs/BUILD_MANUAL.md) – architecture, repo map, configuration, deploy, how to find things.
* **Database:** [`supabase/README.md`](supabase/README.md), [`supabase/01_tables.sql`](supabase/01_tables.sql), [`supabase/02_cron_jobs.sql`](supabase/02_cron_jobs.sql).
* **Frontend layout:** `index.html` is the HTML shell; styles are in `assets/css/`, scripts in `assets/js/` (numbered in load order). After editing any of them run `tools/bump-version.sh <n>` so phones fetch the new files.
* **In the code:** open `index.html` and read the CODE MAP comment at the top; every JavaScript section starts with `// ---------- NAME ----------`.
