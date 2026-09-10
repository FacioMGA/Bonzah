---
name: git-origin-sync
description: Checks the local branch against its remote (git fetch + ahead/behind) before committing, pushing, rebasing, or starting git work on Abbeygate, and warns that pushing to main auto-deploys to production. Use at the start of any session that will touch git, and before every commit/push/rebase, or whenever the user says commit, push, pull, rebase, "sync", "behind", "up to date", or asks to ship/deploy.
---

# Git origin sync (Abbeygate)

Abbeygate's `main` auto-deploys to production: a push to `main` triggers
`Azure Images` -> `AKS Deploy` with **no gate/tests** (see
`.github/workflows/aks-deploy.yml`). Local `main` also drifts behind `origin/main`
between sessions. Never reason about branch state from memory — check the remote.

## Always do this first (before commit/push/rebase, and at git-session start)

```bash
git fetch origin
git status -sb        # shows "ahead N, behind M" vs the upstream
git rev-parse --abbrev-ref HEAD
```

Interpret the result:

- **behind > 0**: integrate before pushing. `git pull --rebase origin <branch>`
  (or rebase onto `origin/main`). A plain push will be rejected as non-fast-forward.
- **ahead > 0 on an unexpected branch/commit**: run `git log origin/<branch>..HEAD --oneline`
  and confirm every local commit is intended before pushing — do not push unknown commits.
- **on `main`**: pushing deploys to prod. Confirm with the user, and confirm any
  DNS/TLS/secret prerequisites are met, before pushing. Prefer a feature branch + PR
  unless the user explicitly wants an immediate prod deploy.

## Rebase conflict shortcut for generated files

`docs/reference/*.md` (and other generated inventories) conflict on both-sides
regeneration. Do not hand-merge: after resolving other conflicts, run
`npm run docs:generate`, then `git add docs/reference/` and `git rebase --continue`.

## Do not

- Do not `git push --force` to `main`.
- Do not assume "up to date" — the fetch is cheap; run it.
