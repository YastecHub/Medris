# Working on Levromart with an AI agent

This folder teaches AI coding agents (Antigravity, Claude Code, Cursor and others) how this project works and how
changes must be made, so you can describe what you want in plain words and get a safe, reviewable change back.

You do not need to read the other files. This page is everything you need.

## How a change goes live

```
 You describe the task  ->  the agent makes a branch and the change  ->  it opens a pull request (PR)
        ->  automatic checks run + a preview link of the app is created  ->  the engineer reviews
        ->  the engineer merges  ->  the live app updates by itself
```

- A **branch** is a private copy of the app where the change is made. The live app is never touched directly.
- A **pull request** is the request "please add my change to the live app". It shows exactly what changed.
- The **preview link** (posted on the PR by Vercel) is a full working copy of the app with the change - open it on your
  phone and try it.
- **Checks** (shown on the PR) are automatic tests. Green = fine. Red = the agent must fix something before review.
- Only the engineer merges. The agent never puts anything live by itself.

## Giving the agent a task

In Antigravity, these commands do the bookkeeping for you:

| Type | When |
|---|---|
| `/start-task` + your description | Begin any new piece of work (it creates the branch) |
| `/finish-task` | The change is done: it runs the checks and opens the pull request |
| `/address-review` | The engineer left comments on the pull request |

Without those commands, start your message with: *"Follow AGENTS.md and the git workflow."*

### Copy-paste prompts

Replace the parts in [brackets].

**Fix something that looks wrong**
> /start-task On the [screen, e.g. cart page], [what is wrong, e.g. the checkout button is hidden behind the bottom
> menu] on my phone. It should [what you expect]. Here is a screenshot: [attach]. Fix it, check it on a phone-sized
> screen in light and dark mode, then open a pull request.

**Change wording**
> /start-task Change the text "[current text]" on the [screen] to "[new text]". Wording only - nothing else should
> change. Open a pull request with a before/after screenshot.

**Add a small feature**
> /start-task I want [who: buyers / vendors / admins] to be able to [what], because [why]. It should appear on
> [which screen]. Before writing code, explain your plan in simple words and list anything you need me to decide.

**Something is broken**
> /start-task When I [steps you took] as a [buyer / vendor / admin], [what happened] instead of [what you expected].
> It started [when]. Find the cause, explain it to me simply, fix it and open a pull request.

**Just a question (no changes)**
> Don't change any files. Explain how [feature, e.g. vendor commission] works today, in simple words.

**After the engineer comments on the pull request**
> /address-review Pull request [number or link].

### Tips that make the result better

- One task per request. "Fix the cart button" and "add a new filter" are two tasks.
- Say **who** (buyer, vendor, admin), **where** (which screen), and **what you expect**. Screenshots help a lot.
- Ask for the plan first on anything bigger than a small fix.
- When it is done, open the **preview link** on your phone and try it yourself before asking for review.

## What the agent will not do (and should not)

- Put changes live, merge pull requests, or touch the `main` branch.
- Change the live database directly. Database changes come as a file in the pull request that the engineer applies.
- Use real payments, message real customers, or delete real data.
- Put passwords or secret keys anywhere - the code is public.

If an agent offers to do any of these, say no and tell the engineer.

## When something goes wrong

| You see | Do |
|---|---|
| Red check on the pull request | Tell the agent: *"The checks failed on PR [number]. Fix them."* |
| The preview link does not show your change | Wait a few minutes and refresh; installed phone apps may need to be closed and reopened |
| The agent says it cannot push or open the PR | Ask it for the link to open the PR in the browser, or send the branch name to the engineer |
| The live app is broken after a merge | Tell the engineer right away - going back to the previous version takes one click |
| You are not sure what the agent did | *"Explain what you changed and why, in simple words, and give me the PR link."* |

## For agents

Start with `../AGENTS.md`. Always-on rules: `rules/project-context.md` and `rules/git-workflow.md`. The other files in
`rules/` are specialist roles (frontend, server functions, database, payments, security, tests, performance,
accessibility, deployment, architecture, background jobs, concurrency, bug hunting) - read the ones that match the
task. Skills for the commands above are in `skills/`.
