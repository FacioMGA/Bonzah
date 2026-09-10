---
title: ADR-0058 2026-08-03 freshness review contract amendments
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# ADR-0058: 2026-08-03 Freshness-Review Contract Amendments

## Status

Accepted.

## Context

The 90-day docs freshness review (ADR-0010 regime) found binding contracts
whose text described enforcement machinery or states that differ from what
the codebase has ever implemented. Contracts are the source of truth, so
amending them to match code requires an explicit decision rather than a
silent re-stamp.

## Decision

The following contract amendments are ratified:

1. **performance-budgets.md** — The enforced bundle limits are the totals in
   `tools/quality/perf/check-budgets.mjs` (total JS 2.4 MB · largest chunk
   520 KB · total CSS 180 KB). The per-chunk table is advisory: per-chunk
   enforcement was never built, and the previous text misstated the guard.
   Lighthouse enforcement is the category minScore warnings actually
   configured in `lighthouserc.cjs`; the per-metric FCP/LCP/TBT/CLS
   thresholds were never configured. Promoting either to hard enforcement
   is a welcome follow-up and needs only a PR updating guard + contract
   together (no further ADR).
2. **database-indexes.md** — `PolicySearchIndex` coverage now reflects the
   model after its legacy non-motor fields (including `productType`) were
   removed; the missing `Claim.reportedDate` index is recorded as tracked
   contract debt rather than claimed as existing coverage.
3. **claims-lifecycle.md** — The `PENDING` operational UI state (intake not
   yet confirmed; note/evidence only) is ratified as part of the lifecycle
   contract. It shipped in `frontend/src/modules/claims/desk/model/selectors.ts`
   without the ADR the contract required; this ADR retroactively closes that
   gap rather than reverting a live, correct behavior.

## Consequences

- Re-stamped contracts describe reality; future drift is a defect again.
- The claims `PENDING` state and the totals-only bundle guard are the
  binding baseline going forward.
- Deferred work is tracked inside the contracts themselves (contract-debt
  sections), keeping ADR-0010's "docs are enforced" loop intact.
