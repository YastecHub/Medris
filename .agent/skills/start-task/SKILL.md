---
name: start-task
description: Start a new piece of work on Levromart - understand the request, create a fresh branch from the latest main, then plan or implement. Use at the beginning of every task that will change files.
---

# Start a task

Follow `.agent/rules/project-context.md` and `.agent/rules/git-workflow.md` throughout.

1. **Restate the task** in one or two plain sentences: who it is for (buyer / vendor / admin), which screen or area,
   what should happen. If something that changes the result is unclear, ask the person now - in simple words, one
   message, all questions together. Do not ask about things you can find in the code.
2. **Check the starting point:** `git status` must be clean. If there are uncommitted changes, stop and ask what to do
   with them (never discard them).
3. **Branch from the latest main:**
   ```bash
   git switch main && git pull --ff-only origin main
   git switch -c <type>/<short-description>
   ```
   Pick the type from the table in `git-workflow.md` (`fix/`, `feat/`, `ui/`, `copy/`, ...). Tell the person the
   branch name.
4. **Read the matching role(s)** in `.agent/rules/` (e.g. `frontend-specialist.md` for anything on screen,
   `database-specialist.md` for database changes, `payments-edge-cases.md` when money is involved).
5. **Bigger than a small fix?** Explain the plan in plain words (what will change, what the person will see, any
   risk) and wait for a "go". For a small, clear fix, go ahead.
6. **Make the change** with small commits (`git-workflow.md`, section 2), then continue with `finish-task`.
