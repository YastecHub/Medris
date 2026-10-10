# Levromart (Medris)

Nigerian marketplace PWA: buy, sell, connect. The repository is a monorepo with two applications:

| App | What it is | Tech |
|---|---|---|
| [`medris-frontend/`](medris-frontend) | The web app people use (PWA, service worker, push) | React 19 + TypeScript entry, Vite 7, existing runtime in `src/legacy/` |
| [`medris-backend/`](medris-backend) | The API under `/api/*`, link previews, share cards | Node.js + TypeScript + Hono, deployed as Vercel functions |

Both use the existing Supabase project (Postgres, Auth, Realtime, Storage) and the existing integrations
(Paystack, Resend, Web Push, Gemini, Cloudflare R2, TURN providers). The database and its configuration are untouched.

**Read next:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (structure, how the pieces talk, editing legacy code,
migrating a screen to React), then the database docs in [`supabase/`](supabase) and the manuals in [`docs/`](docs).

## Quick start

Requires Node.js 20.12+ (22 recommended) and npm 10.

```bash
npm install                                          # installs both workspaces
cp medris-backend/.env.example medris-backend/.env   # fill in the server secrets
npm run dev:backend                                  # API on http://localhost:8787
npm run dev:frontend                                 # app on http://localhost:5173 (proxies /api to :8787)
```

`npm run dev` starts both. The frontend's public settings are in `medris-frontend/.env` (already filled with the
live, public values; override in `medris-frontend/.env.local`). Link previews and share cards read the built app, so
run `npm run build` once before testing them locally.

> Local development talks to the **live** Supabase project unless you point the env files at another one. Use a test
> account and be careful with anything that writes.

## Common commands

| Command | Does |
|---|---|
| `npm run build` | Builds the backend (`medris-backend/dist`) then the frontend (`medris-frontend/dist`) |
| `npm run typecheck` / `npm run lint` / `npm test` | TypeScript, ESLint, Vitest in both apps (`npm run check` runs all three) |
| `npm run bump-version -w medris-frontend -- <n>` | Sets the `?v=` cache-buster on `/assets` URLs and the service-worker cache name (replaces `tools/bump-version.sh`; run on every deploy that changes legacy files) |
| `npm run legacy:check -w medris-frontend` | `node --check` on every legacy script |
| `npm run legacy:rebaseline -w medris-frontend` | Records an intentional change to the legacy files for the regression test |

## Deploying

Vercel builds from the repository root (`vercel.json`): `npm ci`, `npm run build`, static output
`medris-frontend/dist`. The `api/*.js` files are the same 12 functions at the same URLs as before; each re-exports the
compiled Hono app. Rewrites, the daily cron and the link-preview routes are unchanged. Server environment variables
are listed in `medris-backend/.env.example`.
