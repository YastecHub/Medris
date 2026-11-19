# Hosting (from 19 Nov 2026)

| Part | Where | Address |
|---|---|---|
| The web app (static files) | **Cloudflare Pages** | `https://levromart.com` |
| Share-link previews (`/s/`, `/p/`, `/k/`, `/l/`, `/?product=`) | Cloudflare Pages Functions (`functions/`) | same |
| The backend: `/api/*`, `/api/v1/*`, `/rest/v1` | **Heroku** | `https://api.levromart.com` |
| Database, sign-in, private files | Supabase (for now) | |
| Images (photos, avatars, logos, carousel, statuses) | **Cloudinary** | `res.cloudinary.com` |

Vercel is no longer used. The old functions in `api/` are not deployed anywhere; their behaviour lives in the backend
(`medris-backend`), except Levi, whose current brain the backend runs straight from `api/chat.js`
(`medris-backend/src/modules/levi/current-levi.ts`) - keep developing Levi in that file.

## Cloudflare Pages

*Workers & Pages → Create → Pages → Connect to Git →* the repository.

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Root directory | *(empty: the repository root, so `functions/` is found)* |
| Build command | `npm run build -w medris-frontend` |
| Build output directory | `medris-frontend/dist` |

Environment variables (Settings → Variables), for Production:

| Variable | Value | Used by |
|---|---|---|
| `NODE_VERSION` | `22` | the build |
| `VITE_API_BASE_URL` | `https://api.levromart.com` | the app: its `/api/...` calls (and the service worker's) go to Heroku |
| `VITE_BACKEND_URL` | `https://api.levromart.com` | the app: `/api/v1`, `/rest/v1`, live updates |
| `API_ORIGIN` | `https://api.levromart.com` | the share-link functions |

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_VAPID_PUBLIC_KEY` come from `medris-frontend/.env` as before.
Until `api.levromart.com` works, use the Heroku app's own address
(`https://levromart-5212f03a7e44.herokuapp.com`) in the three places.

Custom domains: *Pages project → Custom domains*: `levromart.com` and `www.levromart.com` (Cloudflare adds the DNS
records itself when the domain's DNS is on Cloudflare).

## Heroku

**Domain.** *Settings → Domains → Add domain* `api.levromart.com`. Heroku shows a DNS target
(`xxxx.herokudns.com`). In Cloudflare DNS add `CNAME api → <that target>` with the proxy **off** (grey cloud), so Heroku
can issue the certificate (*Settings → SSL Certificates → Automatic*).

**Config vars** (add or change):

| Variable | Value |
|---|---|
| `APP_ORIGIN` | `https://levromart.com` |
| `CORS_ALLOWED_ORIGINS` | `https://levromart.com,https://www.levromart.com,https://<project>.pages.dev` |
| `IMAGE_STORAGE` | `cloudinary` |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | from Cloudinary's dashboard |
| `GEMINI_API_KEY` | as on Vercel (Levi) |
| `RESEND_API_KEY`, `EMAIL_FROM`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`, `EMAIL_WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY` | as on Vercel, if not set yet |

**Database.** Apply migration `0074` (the database's notification calls - pushes and e-mails for every new
notification, a call's second ring, background reminders - go to Heroku instead of the suspended Vercel site), with
the usual Heroku console command (docs/DATABASE.md section 3).

Push-notification pictures (`/api/notif-icon`) and the backend's own calls to `/api/notify` use the Heroku app's address
by default (`ICON_ORIGIN`, `NOTIFY_WEBHOOK_URL` change them), since the site on Cloudflare has no `/api`.

**Scheduled work.** The daily job Vercel ran at 03:00 UTC (`/api/daily-cron`) now runs inside the backend at that time
(`DAILY_CRON_IN_SERVER=false` turns that off). The database's own jobs stay in Supabase (pg_cron).

## Elsewhere

- **Paystack** dashboard → Settings → API Keys & Webhooks: webhook URL `https://api.levromart.com/api/paystack-webhook`.
- **Google sign-in** is still Supabase's: in Supabase → Authentication → URL Configuration, the site URL and redirect
  URLs must include `https://levromart.com`.

## Check after switching

Sign in (password and Google), open a shop's share link `/s/<id>` and paste it into WhatsApp (preview), upload a
product photo (it should load from `res.cloudinary.com`), ask Levi something, place a test order, and look for a push
notification. Heroku's log shows `Levi: answering with api/chat.js` once Levi has been used.
