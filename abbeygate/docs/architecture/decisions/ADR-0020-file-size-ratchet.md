---
title: ADR-0020 File-size ratchet for backend + frontend modules
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-14
binding: true
---

# ADR-0020: File-size ratchet for backend + frontend modules

## Status

Accepted

## Context

ESLint's `max-lines` rule was previously set to `warn` at **800 effective
lines** — a deliberately permissive threshold inherited from the
pre-spine codebase. In practice the rule fired on exactly one file
(`backend/modules/reporting/domain/bordereaux/lloydsV52.ts`) while ten
other production files quietly grew past the cap because the rule was
generously sized and several files carried inline `/* eslint-disable
max-lines */` directives. The errors-and-warnings cleanup audit found
five files over 800 effective lines and a long tail in the 600-800 band.

A 1000-line file is not an architectural choice. It is the absence of
an architectural choice. Splitting after the fact — under the dedupe /
canonical-ownership pressure described in
`docs/architecture/contracts/canonical-ownership.md` — is significantly
more expensive than refusing to merge the file in the first place.

PRs 2.2-2.3 of the cleanup split the five worst offenders
(`crsV52Motor.ts`, `lloydsV52.ts`, `seed.ts`, `reportsRouter.ts`,
`authRouter.ts`). The remaining long tail (~13 files between 600 and
800 effective lines) is acknowledged but not yet split.

## Decision

The `max-lines` ratchet runs in four documented stages, each
**lowered only when the new floor is already empty**:

| Stage | Cap (effective) | Severity | Status |
|---|---|---|---|
| **A** | **800** | `warn` | **Active** (PR 2.2 of the cleanup drained the one file over 800) |
| B | 700 | `warn` | Pending — opens once the eight files in the 700-800 band are split |
| C | 600 | `warn` | Pending — opens once the additional eleven files in the 600-700 band are split |
| D | 600 | `error` | Pending — promote when Stage C is empty for one quarter |
| E | 500 | `warn` then `error` | Pending — opens after Stage D holds for one quarter |

The cap is on **effective lines** (`skipBlankLines: true,
skipComments: true`), the same default used by the previous threshold
so existing per-file counts remain comparable.

### Why staged

CI enforces `--max-warnings=0` for both backend and frontend lint
(`.github/workflows/ci.yml` exports `ESLINT_BACKEND_WARNING_BUDGET=0`
/ `ESLINT_FRONTEND_WARNING_BUDGET=0` consumed by
`tools/quality/ci/run-quality-gate.mjs`). Lowering the cap to surface
warnings in dev would break CI. The ratchet therefore lowers the cap
**only** when the existing long-tail above the new cap has already
been drained — otherwise the eslint rule and the warning-budget
guardrail collide.

### Splitting rule

When a file approaches the cap, identify the **canonical concept** the
file owns. Split that concept into its natural seams (per-section
mappers, per-handler subrouters, per-stage pipelines, etc.). The
parent file becomes a thin composer that re-exports the public surface
so consumers do not change their imports. **Never** split a file
purely to satisfy the cap — every split must respect the
contract-spine rule (one canonical owner per concept).

### Inline disable directives

`/* eslint-disable max-lines */` is permitted **only** for canonical
data-spec tables that have no meaningful internal seam (the only
current example is the per-stream column tables under
`backend/modules/reporting/domain/crsV52Motor/`). Each disable must
carry a one-line justification comment. Disable directives in code
files (routers, services, handlers) are forbidden — split the file
instead.

## Consequences

- New files cannot land over 600 effective lines without producing a
  warning that PR reviewers must address.
- Contributors must consider canonical seams while writing, not after
  the file grows.
- Stage B (promotion to `error`) is gated on the existing long tail
  draining; it does not happen unilaterally.
- The lint config carries an inline comment pointing back to this ADR
  so the rationale travels with the rule.
