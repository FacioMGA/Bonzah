---
title: Developer entrypoint
audience: developer
status: living
owner: platform-eng
reviewed: 2026-05-04
binding: false
supersedes:
  - docs/engineering/ONBOARDING.md
  - docs/engineering/README.md
  - docs/develop/setup.md
  - docs/develop/daily-loop.md
  - docs/develop/contribute.md
---

# Developer entrypoint

Multi-tenant, multi-product insurance platform: one Lloyd's coverholder scheme · 4 EU jurisdictions · 3 products (Motor, Home, Travel) · one deployment, one Postgres, hexagonal modules. Domain primer: [product/overview.md](../product/overview.md).

## Day 0 — clone and run (≈ 5 min)
```bash
git clone <repo> && cd Abbeygate-platform
npm ci
docker compose -f infrastructure/docker/compose/docker-compose.yml up -d
cp .env.example .env
npm run db:push:dev && npm run db:seed
npm run dev:all                 # frontend + API + worker (one terminal)
```
Frontend `http://localhost:5173` · API `http://localhost:3000/health`. Two-terminal alternative: `npm run dev` + `npm run dev:worker`.

## Daily loop
```bash
npm run gate:agent              # full local quality gate (writes pass stamp; hook blocks `git push` if stale)
npm run gate:agent:static       # type/lint/guards only (faster)
npm run test:contracts-fast     # tier 1 (<10s)
npm run test:adapters-medium    # tier 2 (<60s, real DB)
npm run test:journeys-deep      # tier 3 (<120s, real DB)
npm run smoke:quote-bind-issue  # tier 4 — golden path; do not weaken
npm run docs:generate           # if you touched modules/workers/guards/contracts
```
Full command catalogue: [reference/npm-scripts.md](../reference/npm-scripts.md) (generated).

## Debug shortcuts
| Symptom | First check |
|---|---|
| 422 on quote PATCH | `public_auto_quote.patch_fields_filtered` log + response `x-correlation-id` |
| `INVALID_QUOTE_DATA` | `error.details.missingSlugs` + `blockingErrors` |
| Worker job retried then disappeared | search logs for `*.exhausted` event with queue name |
| `Tenant not resolved` 4xx | JWT `tenant_slug` → `X-Tenant-Slug` header → `TENANT_SLUG` env (in order) |
| Slow request | `Server-Timing` response header per-stage breakdown |

## First clean PR
**Forbidden** (any one fails CI): import surfaces→products/shared, products→shared, apps→backend/modules; `console.*`; new `any`; file ≥ 800 lines; `utils/`/`helpers/`/`lib/`/`controller/`/`types/` at a product root; silencing a guard with a fallback dataset.

**Allowed**: new `backend/modules/<name>/` with `{index.ts, domain, app, infra, http}`; new `frontend/src/products/<name>/index.ts`; new worker under `backend/workers/handlers/<JOB.NAME>.ts` registered in `registerBuiltInHandlers.ts`; new ADR under `docs/architecture/decisions/`.

**Stop and ask** (write an ADR): new top-level directory · new shared abstraction · product-specific logic in shared · contract change · bypassing a guard.

**AI agent output block** (mandatory if Cursor/Claude was used; PR template enforces):
```text
- contract read:    - files changed:   - generated docs updated:
- guards run:       - tests run:        - risk:                - follow-up required:
```

## Where to read next
| Goal | Read |
|---|---|
| What the system is | [product/overview.md](../product/overview.md) · [product/glossary.md](../product/glossary.md) |
| Code that passes CI (binding) | [develop/write-code.md](../develop/write-code.md) |
| Tests in the right tier (binding) | [develop/test.md](../develop/test.md) |
| Architecture rules (binding) | [architecture/contracts/](../architecture/contracts/) |
| Deploy / roll back | [02-operator.md](./02-operator.md) |
| Live module/worker/guard inventory | [reference/](../reference/) (generated) |
