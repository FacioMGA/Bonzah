---
title: ADR-0022 dead-code and depcheck baseline ratchets
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-14
binding: true
---

# ADR-0022: dead-code and depcheck baseline ratchets

## Status

Accepted

## Context

The `audit:deadcode:*` and `audit:deps` npm scripts produced
artifacts (`artifacts/quality/ts-prune-*.txt`,
`madge-orphans-*.txt`, `depcheck.json`) but no guard read them. As a
result the dead-code surface grew silently:

- Backend `ts-prune` reported 393 unused exports (after filtering the
  `packages/**/dist/**` emitted-artefacts noise).
- Frontend `ts-prune` reported 297 unused exports.
- `madge --orphans` flagged 39 backend + 17 frontend files imported by
  nobody (excluding entry points and tests).
- `depcheck` flagged 56 unused `dependencies` (~25 of which were real
  after the runtime-loaded false-positive filter).

The errors-and-warnings cleanup audit drained the most obvious
24 orphan files and 8 unused production deps in PRs 4.1-4.3. Without a
ratchet, the next addition would re-grow the count uncaught.

## Decision

Three signals get a baseline ratchet identical in shape to the
existing `check-any-baseline.mjs` (which has held the `any` count down
for two quarters):

| Guard | Source | Baseline file |
|---|---|---|
| `guard:dead-code-baseline` | `ts-prune` (filtered) + `madge --orphans` | `tools/quality/dead-code-baseline.json` |
| `guard:depcheck-baseline` | `depcheck --json` | `tools/quality/depcheck-baseline.json` |

Both guards are wired into `build:api` (the per-PR check) **and**
`tools/quality/agent-gate.sh FAST_COMMANDS` (the local pre-push
check). They run in O(seconds), not O(minutes).

### Curated false-positive set

`depcheck` has a high false-positive rate in this stack
(runtime-loaded packages, subpath imports, transitive types). The
repo-root `.depcheckrc.json` captures the curated `ignoreMatches`
list. New runtime-loaded additions must be added to that file in the
same PR that adds the dependency, with a comment explaining why
depcheck cannot trace it.

### Ratchet semantics

- **Lower-only.** Any PR that drops the count must also lower the
  ceiling in the corresponding baseline file in the same commit so
  the new floor is locked.
- **No mass-bump exceptions.** If a PR genuinely needs to raise the
  ceiling (e.g. a planned-but-unwired API surface), the baseline
  bump must be justified in the PR description with a follow-up
  reference (Linear ticket or future PR number).

## Consequences

- Genuinely-unused new files fail the gate at addition time.
- The four split-target files we built in PR 2.2-2.3 (where each
  module's barrel re-exports from per-section files) work fine with
  the ratchet — `ts-prune` flags barrel re-exports, but the count
  stays under the baseline as long as the barrel additions match the
  per-section additions.
- Long-tail drainage (e.g. the remaining 193 backend `ts-prune`
  signals, mostly barrel-related) becomes a continuous background
  workstream: every PR that touches a barrel file is encouraged to
  drain a few entries.

## Follow-ups

- A future PR should add a Husky `pre-commit` hook that runs
  `npm run docs:generate:check` when `tools/quality/**/*.mjs` is
  staged. This catches the kind of generated-doc drift that
  triggered the original audit (the `guards.md` mismatch caught at
  the start of this campaign). Husky is not yet installed in the
  repo, so this is deferred.
- Stage B for both ratchets is the same as ADR-0020's Stage B:
  promote from "warn-on-regression" to "error-on-regression" once
  the floor stabilises for one quarter. Both guards already exit
  non-zero on regression today; the "stage" is really about whether
  to also exit non-zero on the warning class within the same file
  (e.g. promoting `ts-prune` itself to a fail-on-any-unused mode).
