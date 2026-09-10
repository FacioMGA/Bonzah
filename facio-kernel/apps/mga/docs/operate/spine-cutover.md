---
title: spine/v2 cutover protocol
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-04
binding: true
---

# spine/v2 cutover protocol

Hard-switch from main → `spine/v2` once the convergence gate is green. This is the Wave 5 runbook for the product-data-drift remediation plan.

> **Status at 2026-08-04 review:** the branch hard-switch described below never happened and is no longer applicable — the wave 4/5 work landed directly on `main` (commits `f25b894f`, `de0ed2c3` are on main history) and the `spine/v2` branch has been deleted from the remote. The [Forbidden](#forbidden) section remains binding: the retired shims are still guard-enforced (`check-products-single-source.mjs`, `check-architecture-locks.mjs`). The two operational convergence items below (staging-replay parity diff, BDX golden coverage) remain outstanding as ordinary backlog, no longer as cutover preconditions.

## Convergence gate (all must be green before switch)
1. `npm run gate:agent` clean on `spine/v2` HEAD. **[code · GREEN]**
2. `npm run guard:product-engine-contract` · `guard:architecture-locks` · `guard:no-default-tenant-fallbacks` · `guard:products-single-source` · `guard:docs-max-lines` clean. **[code · GREEN]**
3. Golden parity diff: replay last 30 days of staging quote/bind/issue traffic against `spine/v2`; zero `PRICING_DRIFT`, zero issuance bypass, zero side-door route hits. **[operational · BLOCKED on staging-replay harness execution]**
4. BDX golden coverage suite green for every active (product, jurisdiction) pair. **[operational · BLOCKED on golden-fixtures PR (Wave 3B deferral)]**
5. ADR-0007 PENDING items closed (PolicyQuoteHistory writes consolidated, save-version backend-orchestrated, `rateQuoteWorkspace` renamed → `rateQuote`). **[code · GREEN, Wave 4 commit `f25b894f`]**
6. `evaluateIssueReadiness` is the only issuance gate (no caller bypasses it — verified by `check-architecture-locks.mjs` Lock F deny-list; 5 documented carve-outs). **[code · GREEN, Wave 5 commit `de0ed2c3`]**

## Cutover order (no-downtime)
1. **Freeze non-critical writes** on main; flag `WAVE5_CUTOVER_IN_PROGRESS=true`.
2. **Worker first**: deploy `spine/v2` workers with `QUEUE_WORKERS_ENABLED=true`; confirm queue depth flat for 15 min.
3. **API shadow**: deploy `spine/v2` API with internal ingress; run `/health`, tenant-isolated quote read, document enqueue+complete.
4. **Canary**: 5% → observe ≥ 60 min (5xx, p95, `PRICING_DRIFT` count, issuance gate hits) → 25% → 50%.
5. **Full switch**: 100% traffic to `spine/v2`; keep main endpoint hot for 72 h.
6. **Tag**: cut `legacy/main-archive-YYYYMMDD` from old main HEAD; freeze that branch.
7. **Smoke**: `npm run smoke:quote-bind-issue` per product per jurisdiction.

## Rollback (within 72 h)
- Revert ingress to main, set `WAVE5_CUTOVER_IN_PROGRESS=false`.
- File incident under [incident-response.md](./incident-response.md); diff every BDX export written under `spine/v2` against the staging-replay golden.
- Do not roll back schema if any new migration ran — switch to [backup-and-restore.md](./backup-and-restore.md).

## Forbidden
- Cutover with any wave 0–4 task still `IN_PROGRESS` in the plan.
- Cutover without 30-day staging replay diff attached to the cutover PR.
- Re-introducing `policyHoldersFromQuoteData`, `validateUnifiedQuoteData`, `motorQuoteDataSchema`, or any other shim retired in waves 1–3 — guarded by `check-products-single-source.mjs` and `check-architecture-locks.mjs`.
- Hand-editing generated artifacts under `packages/products/src/motor/generated/`.

## Post-switch (T + 7 days)
- Delete `legacy/main-archive-YYYYMMDD` only after one full BDX cycle, one full claims cycle, and one full endorsement cycle have run successfully on `spine/v2`.
- Update [deploy.md](./deploy.md) to remove the spine/v2 reference; the protocol becomes plain `deploy.md` again.

## Links
Adjacent: [deploy.md](./deploy.md) · [rollback.md](./rollback.md) · [staging-delivery.md](./staging-delivery.md) · [database-migrations.md](./database-migrations.md) · [incident-response.md](./incident-response.md).
