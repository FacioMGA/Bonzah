---
title: ADR-0011 Policy state and compliance canonical placement
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# ADR-0011: Policy state and compliance canonical placement

## Status

Accepted

## Context

Two safety-critical functions in `backend/modules/policy` had been duplicated as
shadow files across the `app/` and `domain/` layers:

- `policyStateService.ts` — derives `boStatus`, `acuteStatus`,
  `operationRunning`, `isBindable`, `isIssued`, sort rank, etc. from raw
  policy fields plus snapshot.
- `policyCompliance.ts` — runs the production-grade compliance checks
  (bound-baseline, premium presence, coverage docs, billing balance, BDX
  migration reasons, etc.) and returns a `PASS | WARN | FAIL` state.

The two pairs were ~95% identical. They had **silently drifted** in two places:

1. `hasBoundBaseline` — `app/` inlined the literal set
   `(t === 'INCEPTION' || t === 'ENDORSEMENT')`; `domain/` delegated to
   `isVersionHistoryTransactionType` from `domain/riskTransactionTypes.ts`.
   Equivalent today; future changes to the canonical set would have
   propagated to one path only.
2. `hasCoverageDoc` — `app/` required a `_PDF` suffix
   (`t.includes('SCHEDULE_PDF') || t.includes('CERTIFICATE_PDF')`); `domain/`
   matched any substring (`t.includes('SCHEDULE') || t.includes('CERTIFICATE')`).
   The broader match would silently accept unrelated document types such as
   `CERTIFICATE_OF_DAMAGE` and `SCHEDULE_OF_REPAIRS`, allowing
   non-compliant policies to PASS the check on one code path and FAIL on
   another.

The `domain/` copies used top-level `await import(...)` for both
`./policyStateService.js` (gratuitous — same directory, no layering issue) and
`../../quotes/app/validator.js` (a real layering violation: `domain/` must not
import outside `domain/` per `modules-and-layers.md`). The dynamic-import form
specifically dodged the static-import regex in
`tools/quality/check-backend-layer-imports.mjs`, hiding the violation from CI.

## Decision

1. **`derivePolicyState`, `boStatusSortRankFor`, and
   `isIssuedLifecycleByPolicyState` live in
   `backend/modules/policy/domain/policyStateService.ts`.** It is pure
   derivation over an input bag and depends only on `domain/status.ts`. The
   previous `app/policyStateService.ts` is reduced to a one-line
   `export * from '../domain/policyStateService.js'` so that `http/*` (which
   the layer contract forbids from importing `domain/*` directly) retains a
   stable app-layer entry point.

2. **`evaluatePolicyCompliance` lives in
   `backend/modules/policy/app/policyCompliance.ts`.** It depends on
   `validateDraftQuote` from `quotes/app/`, which categorically excludes it
   from `domain/`. The `domain/policyCompliance.ts` shadow file is removed;
   the test moves from `domain/__tests__/` to `app/__tests__/`.

3. **Reconciled rules:**
   - `hasBoundBaseline` delegates to `isVersionHistoryTransactionType`
     (single source of truth in `domain/riskTransactionTypes.ts`).
   - `hasCoverageDoc` requires the strict `_PDF` suffix. Generated coverage
     documents always have it (`MOTOR_SCHEDULE_PDF`,
     `MOTOR_CERTIFICATE_PDF`); a broader match is unsafe.

4. **Dynamic imports of these modules are removed.**
   `infra/projections/policyListIndex.ts` now uses static imports;
   `infra → domain` and `infra → app` are both permitted by the layer
   contract.

5. **A new guard `guard:no-cross-layer-shadow-files`
   (`tools/quality/check-no-cross-layer-shadow-files.mjs`)** prevents the
   pattern from recurring. It fails CI if any backend module has a non-barrel
   `.ts` file with substantive content (i.e. not a pure re-export shim) under
   the same basename in two of `{domain, app, infra, http}`. `index.ts` and
   `types.ts` are exempt; pure `export * from '...'` shims are auto-detected
   and allowed (this is the legitimate "app entrypoint for a domain
   primitive" pattern). New same-name pairs with substantive content require
   an ADR and an entry in `ALLOWED_PAIRS` in the guard.

## Companion collapses (same anti-pattern, same fix)

After the guard was introduced and its shim detector hardened to recognise
multi-line `export { ... } from '...'`, the same anti-pattern was found in
three more places. All collapsed under the same principle:

- **`pricing/quoteToken.ts`** — domain copy used `await import()` to reach
  `policy/domain/hashes`. Domain made canonical (static import); app reduced
  to a one-line shim.
- **`policy/issueReadiness.ts`** — app copy was a 30-line `await import()`
  facade wrapping the domain implementation. App reduced to a one-line shim.
  Note: the canonical `domain/issueReadiness.ts` itself imports from
  `app/read/issueReadinessRepository.ts` — a real `domain → app` violation
  that is broader than this ADR; tracked as a follow-up.
- **`policy/issueReadinessUpdater.ts`** — not a duplicate but a basename
  collision (domain owned the pure merge logic; app owned a Prisma-write
  wrapper that called it). Renamed the app file to `setIssueReadiness.ts` to
  match its function name and remove the collision. Pure layering, no logic
  change.
- **`recommendations/bandit.ts`** — domain file was a multi-line
  `export { … } from '../app/bandit.js'`, i.e. `domain → app`, the wrong
  direction. The substantive code uses Prisma directly so it cannot live in
  domain. The misleading domain shim deleted; two callers redirected to the
  canonical `app/bandit.ts`.

## Canonical-ownership principle (binding)

Every domain concept has **exactly one canonical implementation**. All other
usages must be re-export shims, wrappers, or consumers — not a second copy.
Concretely:

- A file's basename appears with substantive content in **at most one** of
  `{domain, app, infra, http}` per backend module.
- "App entrypoint for a domain primitive" is the legitimate use of a same-name
  file — but only as a one-line `export * from '../domain/X.js'` shim
  (auto-detected by the guard).
- A `domain → app` re-export shim is never legitimate — it's the wrong layer
  direction. Either the code belongs in domain (move it) or it doesn't (delete
  the shim, redirect callers).
- Exception requires an ADR + an entry in `ALLOWED_PAIRS` in the guard.

## Consequences

- One implementation per function; no possibility of silent drift between
  call paths.
- `domain/` regains its purity: no top-level `await import()`, no app-layer
  dependencies dressed as dynamic imports.
- The compliance behaviour change (strict `_PDF` matching) is explicit and
  test-covered. A regression test asserts that loose names like
  `CERTIFICATE_OF_DAMAGE` correctly fail the coverage check.
- HTTP routers and existing app callers do not change imports.
- Future safety-critical primitives that need an HTTP-reachable handle should
  re-export through `app/index.ts` rather than create a shadow file.
- Shadow-files baseline reaches `[]` after the companion collapses; any new
  same-name pair is a CI failure.

## Links

- Layering contract: [modules-and-layers.md](../contracts/modules-and-layers.md)
- Existing layer guard: `tools/quality/check-backend-layer-imports.mjs`
- New shadow-files guard: `tools/quality/check-no-cross-layer-shadow-files.mjs`
- Shadow-files baseline: `tools/quality/cross-layer-shadow-files-baseline.json`
- Lifecycle primitives: [ADR-0007](./ADR-0007-policy-versioning-lifecycle-primitives.md)
