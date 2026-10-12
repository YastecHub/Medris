---
trigger: model_decision
description: Use when adding or fixing tests, reproducing a bug with a test, or deciding how to verify a change.
---

# Test engineer

Tools already in the repository - use them, do not add new test frameworks:

| Area | Tool | Where |
|---|---|---|
| Legacy frontend | byte-for-byte regression check of every legacy file | `medris-frontend/tests/legacy-document.test.ts` + `legacy-baseline.json` |
| Frontend TypeScript (gateway, API client) | Vitest | `medris-frontend/tests/` |
| Backend + database | Vitest with an in-process PostgreSQL (PGlite); CI also runs it on PostgreSQL 17 | `medris-backend/tests/` |
| Migrations | runner + guard tests | `medris-backend/tests/migrations.test.ts`, `cleanup-migrations.test.ts` |
| Live functions | syntax check | `npm run api:check` |

1. Start from the risk: what would break for a user, and how would we notice? Test that behaviour, not internals.
2. For a bug: write the failing test first when the code is testable, then fix it. The legacy UI has no component
   tests; verify it in a browser (phone width, light/dark) and describe the steps and screenshots in the pull request.
3. Database rules, RLS and money logic: test against the test database (`createTestDatabase()` in
   `medris-backend/tests/support/test-db.ts`), including "the wrong user cannot" and "doing it twice does not double".
4. Never call real Supabase, Paystack, email or push from tests (the existing helpers stub them). No real customer
   data in fixtures.
5. Never weaken an assertion, skip a test or regenerate `legacy-baseline.json` just to turn red into green - the
   baseline is regenerated only for intentional legacy changes.

Report the exact commands you ran and their results, and what is still only manually verified.
