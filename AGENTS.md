# Instructions for AI agents

Levromart (repo **Medris**): a Nigerian marketplace PWA. The founder who gives you tasks is not a developer - explain
in plain words, show results, and never leave them with a technical step to do by hand. An engineer reviews and merges
every change.

## Read before working

1. `.agent/rules/project-context.md` - what lives where, how the app talks to the database, the legacy-runtime rules,
   the commands to run, and the hard limits.
2. `.agent/rules/git-workflow.md` - every change goes branch -> commits -> pull request -> review. You never push to
   `main` and never merge.
3. The role(s) in `.agent/rules/` that match the task:

| Task | Read |
|---|---|
| Anything visible in the app (screens, text, styles, buttons, forms) | `frontend-specialist.md` |
| Live server functions (`api/*.js`) or the new backend (`medris-backend/`) | `engineer.md` |
| Database tables, functions/RPCs, policies, indexes, cron | `database-specialist.md` |
| Orders, payments, Paystack, commission, payouts, refunds | `payments-edge-cases.md` (+ `edge-case-concurrency-handler.md`) |
| A bug report or wrong behaviour | `bug-bounty-hunter.md` |
| Double taps, retries, two people acting at once | `edge-case-concurrency-handler.md` |
| Reviewing a pull request or diff | `code-reviewer.md` |
| Tests | `test-engineer.md` |
| Security, permissions, secrets | `red-team.md` |
| Slowness, Supabase usage, bundle size | `performance-optimizer.md` |
| Accessibility | `accessibility-reviewer.md` |
| Build, Vercel, CI, environment variables | `devops-engineer.md` |
| Where code should live, larger design | `architect.md` |
| Scheduled jobs, reminders, notifications pipeline | `background-job-specialist.md` |

Step-by-step procedures: `.agent/skills/start-task`, `finish-task`, `address-review`.

## Always

- Start from a fresh branch off the latest `main`; finish with a pull request that a non-technical person can check
  on the Vercel preview (steps + screenshots).
- Run the checks before saying something works, and report exactly what you ran and what you could not check.
- Whenever a change affects what the app does with people's data, money, accounts, messages or notifications (or any rule users must follow), check the legal pages (`85-legal-pages.js` and its React copies in `medris-frontend/src/views/{terms,privacy,refund-policy}`) and update the wording and the "Last updated" date in the same branch, in both places. Mention it in the pull request, and say that the text should be reviewed by a lawyer.
- Keep changes small and on-topic; mention unrelated problems you noticed instead of fixing them in the same branch.
- Never touch the live database, secrets, real payments or real users' data. Database changes are migration files.
