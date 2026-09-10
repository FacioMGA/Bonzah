---
title: Performance budgets contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Performance budgets — binding contract

## Governs
The hard upper bounds on bundle size, page-level timings, backend latency, and database query cost.

## Bundles
Enforced by `tools/quality/perf/check-budgets.mjs` (totals only): total JS ≤ 2.4 MB · largest JS chunk ≤ 520 KB · total CSS ≤ 180 KB. Vite `chunkSizeWarningLimit = 700 KB`.

Advisory per-chunk targets (chunks in `frontend/vite.config.ts`; not individually enforced — tightening them into the guard requires an ADR):
| Chunk | Target | Purpose |
|---|---|---|
| `shared-ui` | 150 KB | Shared UI primitives |
| `record-list-core` | 50 KB | Generic list engine |
| `react-vendor` | 200 KB | React + DOM + Router |
| `ui-vendor` | 250 KB | Framer Motion, Lucide, TanStack Query |
| `utils-vendor` | 100 KB | Zod, Zustand, clsx, tailwind-merge |

## Page-level (Lighthouse, `lighthouserc.cjs`)
Category minimums, asserted as warnings: Performance ≥ 0.85 · Accessibility ≥ 0.9 · Best Practices ≥ 0.9 · SEO ≥ 0.85. No per-metric (FCP/LCP/TBT/CLS) assertions are configured; adding hard metric assertions requires an ADR.

## Backend (per request, p50 / p95 / p99)
- Read (list/detail): 100 / 300 / 500 ms
- Write (create/update): 200 / 500 / 1000 ms
- Background jobs: 5 / 15 / 30 s

## Forbidden
- Exceeding any enforced limit above.
- Returning > 100 records in a single page (enforced in `listPoliciesUseCase.ts` etc.).
- Disabling `Server-Timing` headers (`perfTimingMiddleware`) on any HTTP route.
- Slow query threshold raise without ADR (default `PRISMA_SLOW_QUERY_MS = 200`).

## Escalation
- **Write an ADR** to: raise any budget, add a new top-level performance signal class, change the slow-query threshold.

## Links
- Enforcement scope ratified by [ADR-0058](../decisions/ADR-0058-freshness-review-contract-amendments.md)
- Related: [surfaces.md](./surfaces.md) · [database-indexes.md](./database-indexes.md)
- Operate: [monitoring.md](../../operate/monitoring.md)
