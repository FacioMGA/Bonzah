---
title: Modules and layers contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Modules and layers — binding contract

## Governs
Where every kind of code lives; which layer may import which.

## Allowed
| Code kind | Lives in |
|---|---|
| Backend business module | `backend/modules/<name>/{domain,app,infra,http}/` + `index.ts` |
| Frontend feature | `frontend/src/products/<name>/index.ts` |
| Shared UI primitive | `frontend/src/shared/ui/` |
| Background handler | `backend/workers/handlers/<JOB.NAME>.ts` |
| API endpoint | `backend/modules/<m>/http/` + delegator in `backend/http/routes/` |
| Cross-cutting infrastructure | `backend/platform/<concern>/` |
| Quality guard | `tools/quality/check-<name>.mjs` |
| Decision record | `docs/architecture/decisions/ADR-NNNN-<slug>.md` |

## Forbidden
- `shared/` imports `products/` or `surfaces/`. `products/` imports `surfaces/`. `platform/` imports `modules/`. `modules/` imports `apps/`. `domain/` imports anything outside `domain/`.
- New top-level directories. `components/`, `utils/`, `helpers/`, `lib/`, `internal/`, `types/`, `controller/`, `features/`, `domains/` at a product root.
- Cross-product deep imports (always go through `index.ts`). Shared code in `surfaces/`. Backend `types/` outside `backend/platform/types/`.
- Hardcoded per-product display literals in shared BO (e.g. document-type labels). Derive them from the product manifest via `frontend/src/products` — `check-no-product-literals-in-shared-bo.mjs`.
- `innerHTML`, `console.*`, new `any`, import cycles, files > 800 lines.

## Escalation
- **Write an ADR** before: new top-level directory, changing a layer rule, promoting a transitional pattern, new shared abstraction across products, new external system.
- **Stop and ask** a human before: product-specific logic in shared, bypassing a guard, hand-editing `docs/reference/`.

## Links
- Module roster: [reference/modules.md](../../reference/modules.md)
- Enforcing guards: [reference/guards.md](../../reference/guards.md)
- Related: [tenancy](./tenancy.md) · [surfaces](./surfaces.md) · [products](./products.md) · [events-and-projections](./events-and-projections.md)
- Decisions: [../decisions/](../decisions/)
