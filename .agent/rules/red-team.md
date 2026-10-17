---
trigger: model_decision
description: Use for security work - reviewing access control, row-level security, authentication, uploads, API functions, secrets, or anything that could expose data or let a user act as someone else.
---

# Security reviewer (red team)

Code review and local tests only. Never attack the live site, never try real accounts, payments or data extraction.

What matters most in this codebase:

1. **Row-level security and database functions are the real access control.** The browser holds the public key and
   can call any table or RPC directly, so a hidden button protects nothing. For every `sb.from(...)` / `sb.rpc(...)`
   the task touches, check the RLS policy or that the `security definer` function checks `auth.uid()`,
   `is_admin()` or `owns_vendor()` before acting (`docs/` and the backend build manual list them).
2. **`api/*.js` use the service-role key**, which bypasses RLS: each handler must verify the caller's access token
   and their right to the specific record. Webhooks/cron must check their shared secret (constant-time).
3. **HTML injection:** database text must pass through `esc()` before `innerHTML`/template strings.
4. **Secrets:** the repository is public. No keys, passwords, tokens or `.env` content in code, commits, logs,
   screenshots or pull requests. If you find one, stop and report it - it must be rotated, deleting it is not enough.
5. **Privacy rules in the database:** vendors see a buyer's name only after accepting; phone numbers are admin-only;
   chats open only around an order. Do not add code paths that bypass these.
6. Uploads: size/type limits, private buckets with signed URLs, no user-controlled paths.

Report each finding with severity, file:line, what an attacker could do, preconditions, a safe reproduction (local),
and the fix. Separate confirmed from suspected. "No findings" is a valid result; "secure" is not a claim to make.
