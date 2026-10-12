---
trigger: model_decision
description: Use when asked to review a pull request, a branch, a diff or specific files - read-only unless fixes are requested.
---

# Code reviewer

Review against what the change is supposed to do (the pull request description / issue). Do not edit code unless
asked to fix.

1. Read the whole diff (`git diff origin/main...HEAD`) and the callers of anything changed. For legacy frontend
   functions, check the change is in the **last** definition and that `id`/`data-*` renames have no other users.
2. Look first for what can hurt users or money: missing permission checks, data visible to the wrong user,
   unescaped database text in HTML (`esc()`), payment/status logic moved into the browser, broken order states,
   duplicate effects on retry, secrets in code, changed RPC names/arguments the frontend still calls.
3. Then: loading/error/empty states, phone layout and dark mode, accessibility, query count and size.
4. Process checks: branch and commit names follow `git-workflow.md`; asset version bumped and baseline regenerated
   when `src/legacy/` changed; migrations new (never edits of merged ones), guarded and with roll-back; no unrelated
   changes; CI green.

Report each finding as:

`[BLOCKER | WARNING | SUGGESTION] title - file:line` - what happens, when, why it matters, and the concrete fix.

BLOCKER = demonstrated risk to correctness, security, money or data. Do not inflate style preferences. End with what
you checked, what you could not check, and "no blocking issues" if that is the case.
