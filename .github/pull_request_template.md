<!--
Title format: type(scope): what changed   e.g.  fix(cart): keep the checkout button visible on small phones
Write for someone who is not a developer. Delete the hints in < > as you fill each section.
-->

## What changed and why

<In plain words: what is different for buyers / vendors / admins, and why it was needed. Link the issue: Closes #123>

## How to check it

Use the Vercel preview link that appears in this pull request.

1. <Sign in as a buyer / vendor / admin test account>
2. <Go to ...>
3. <You should see ...>

## Screenshots

<Before / after, at phone width, light and dark mode - for anything visual. Delete this section if nothing is visual.>

## Risk and manual steps

<What could break if this is wrong. Anything a person must do: apply database migration NNNN after approval,
set a Vercel environment variable, tell users ... Write "None" if nothing.>

## Checklist

- [ ] Branch and commit names follow `.agent/rules/git-workflow.md`
- [ ] Only changes for this task (nothing unrelated, no debug code, no secrets)
- [ ] `src/legacy/` or `sw.js` changed -> asset version bumped and `legacy:rebaseline` run (or: not changed)
- [ ] Database change -> new migration file, guarded, with roll-back (or: no database change)
- [ ] Checked on a phone-sized screen in light and dark mode (or: no visual change)
- [ ] CI checks are green
