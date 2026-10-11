# Levromart (Medris)

Nigerian marketplace PWA: buy, sell, connect. The repository is a monorepo with two applications:

| App | What it is | Tech |
|---|---|---|
| [`medris-frontend/`](medris-frontend) | The web app people use (PWA, service worker, push) | React 19 + TypeScript entry, Vite 7, existing runtime in `src/legacy/` |
| [`medris-backend/`](medris-backend) | The API (`/api/v1` and the original `/api/*`), link previews, share cards | Node.js + TypeScript + Express 5, Drizzle on PostgreSQL, Zod; deployed as Vercel functions |

The backend reads and writes PostgreSQL directly (`DATABASE_URL`) with the same row-level security as before, verifies
sessions itself and integrates Paystack, Resend, Web Push, Gemini, Cloudflare R2 and TURN providers. Supabase hosts
the database and still provides Auth (sign-in), Realtime and file Storage for now. The database schema and its
configuration are untouched.

**Read next:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (structure, how the pieces talk) ·
[`docs/BACKEND.md`](docs/BACKEND.md) · [`docs/DATABASE.md`](docs/DATABASE.md) · [`docs/AUTH.md`](docs/AUTH.md) ·
[`docs/STORAGE.md`](docs/STORAGE.md) · [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) ·
[`docs/SUPABASE_AUDIT.md`](docs/SUPABASE_AUDIT.md), then the database docs in [`supabase/`](supabase) and the manuals.

## Quick start

Requires Node.js 20.12+ (22 recommended) and npm 10.

```bash
npm install                                          # installs both workspaces
cp medris-backend/.env.example medris-backend/.env   # fill in DATABASE_URL and the server secrets
npm run dev:backend                                  # API on http://localhost:8787 (docs: /api/v1/docs)
npm run dev:frontend                                 # app on http://localhost:5173 (proxies /api to :8787)
```

A local database for development (never production):

```bash
docker compose up -d db                              # PostgreSQL 17: medris_dev + medris_test
# medris-backend/.env: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/medris_dev  DATABASE_SSL_MODE=disable
npm run db:dev -w medris-backend -- --seed           # development schema + demo rows (refuses remote hosts)
```

`npm run dev` starts both. The frontend's public settings are in `medris-frontend/.env` (already filled with the
live, public values; override in `medris-frontend/.env.local`). Link previews and share cards read the built app, so
run `npm run build` once before testing them locally.

> The frontend's sign-in and any screen not yet moved to `/api/v1` talk to the **live** Supabase project unless you
> point `medris-frontend/.env.local` at another one. Use a test account and be careful with anything that writes.
> To try the new backend path in the browser: `levroData.useBackend("all")` in the console (see DEPLOYMENT.md).

**API reference:** with the backend running, http://localhost:8787/api/v1/docs is Swagger UI for every endpoint
(the new `/api/v1` and the original `/api/*`), generated from the code; `/api/v1/openapi.json` is the OpenAPI 3.1
document. The backend is layered controller → service → repository ([docs/BACKEND.md](docs/BACKEND.md#3-layers-controller--service--repository)).

## Common commands

| Command | Does |
|---|---|
| `npm run build` | Builds the backend (`medris-backend/dist`) then the frontend (`medris-frontend/dist`) |
| `npm run typecheck` / `npm run lint` / `npm test` | TypeScript, ESLint, Vitest in both apps (`npm run check` runs all three); backend tests use an in-process PostgreSQL (PGlite) |
| `TEST_DATABASE_URL=… npm run test:postgres -w medris-backend` | the backend suite against a real PostgreSQL (database name must end in `_test`) |
| `npm run db:dev -w medris-backend` | load the development schema into a local database |
| `npm run db:introspect -w medris-backend` | read-only: generate Drizzle definitions of the live schema |
| `npm run audit:supabase` | where the code still depends on Supabase (`-- --json` for file:line) |
| `npm run bump-version -w medris-frontend -- <n>` | Sets the `?v=` cache-buster on `/assets` URLs and the service-worker cache name (replaces `tools/bump-version.sh`; run on every deploy that changes legacy files) |
| `npm run legacy:check -w medris-frontend` | `node --check` on every legacy script |
| `npm run legacy:rebaseline -w medris-frontend` | Records an intentional change to the legacy files for the regression test |

## Deploying

Vercel builds from the repository root (`vercel.json`): `npm ci`, `npm run build`, static output
`medris-frontend/dist`. The `api/*.js` files are the same 12 functions at the same URLs as before; each re-exports the
compiled Express app; `/api/v1/*` is rewritten to one of them. They have to stay in `api/` at the repository root,
because that is the only place Vercel deploys functions from; all the backend code itself is in `medris-backend/`.
Server environment variables are listed in `medris-backend/.env.example`. **`DATABASE_URL` must be set before deploying** - a production build without it fails
on purpose. Rollout, rollback and the steps that need approval: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
