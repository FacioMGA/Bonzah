---
title: ADR-0033 Product onboarding canonical checklist (binding)
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-25
binding: true
---

# ADR-0033: Product onboarding canonical checklist

## Status

Accepted. Codifies the lessons of ADR-0032 (HEALTH introduction): a new product (PET, MARINE, …) MUST land in one PR with every spine slot filled, and CI MUST refuse to merge when slots are missing. Replaces the implicit "look at how Travel did it" heuristic that produced six in-prod fires for HEALTH within 24 hours of deploy.

## Context

HEALTH was the platform's fourth product. Onboarding the platform spine (manifest, profile, runtime, wizard) worked first try because every layer had a shared contract. But onboarding the **operational spine** — production data rows, image-bundled assets, worker tenant frame, jurisdiction config — worked only by accident, and only for HEALTH because Travel's implicit "checklist" was followed by hand. The misses surfaced as:

| Gap | Sentry / Linear |
|-----|-----------------|
| `BinderProductAuthority(productCode='HEALTH')` not in prod DB | ABY-280 / ABY-281 — 503 "No active binder linked for HEALTH" on every wizard load |
| Worker tenant ALS frame missing on projection handlers | ABY-281 / ABBEYGATE-E — `TenantContextError` exhausted every job |
| Producer/consumer envelope drift on relay-driven jobs | ABY-277 / ABY-276 / ABBEYGATE-B / ABBEYGATE-C — 192 events |
| Vite stale chunk recovery missing two error variants | ABBEYGATE-REACT-3 / ABBEYGATE-REACT-4 |
| Wizard chrome (mobile progress, footer padding) drift from Travel | ABY-283 / ABY-286 |
| Boolean defaults rendered "No" preselected | ABY-285 |
| Wizard data wiped on validation error / cover-type change | ABY-287 / ABY-288 |
| Field-level country whitelist bypassed server-side decline | ABY-284 |

Eight live customer-facing fires from one product launch. The next product (PET / MARINE) MUST onboard without repeating this.

## Decision

A new product is onboarded by populating exactly nine slots on the canonical product spine. The slots are **enumerated** in `tools/quality/check-product-onboarding-canonical.mjs`; the guard runs in CI and fails closed if any slot is missing for any product listed in `CANONICAL_PROGRAMS` (`backend/modules/policy/app/binders/canonicalProgramBinderSeed.ts`).

### The nine canonical slots

For every `productCode` ∈ `CANONICAL_PROGRAMS`:

| # | Slot | Owner | Checked by |
|---|------|-------|-----------|
| 1 | **ProductManifest** at `packages/products/src/<product>/manifest.ts`, exported via `packages/products/src/index.ts` | `@facio/products` | `check-product-onboarding-canonical.mjs` |
| 2 | **ValidationProfile** at `packages/products/src/<product>/profile.ts`, exported via `packages/products/src/index.ts` | `@facio/products` | `check-product-onboarding-canonical.mjs` |
| 3 | **Backend `ProductRuntimeDefinition`** at `backend/products/<product>/runtime.ts`, registered in `backend/products/registerProducts.ts` and the catalog | `backend/products/` | `check-product-onboarding-canonical.mjs` |
| 4 | **Doc-pack worker** at `backend/workers/handlers/DOC.GENERATE_<PRODUCT>_DOC_PACK.ts`, imported in `backend/workers/registerBuiltInHandlers.ts` | `backend/workers/` | `check-product-onboarding-canonical.mjs` |
| 5 | **Wizard route registration** — `frontend/src/products/<product>/register.ts` exists and is imported transitively by `frontend/src/products/index.ts` | `frontend/src/products/` | `check-product-onboarding-canonical.mjs` |
| 6 | **Pricing data + document templates + static PDFs** copied into BOTH `infrastructure/docker/Dockerfile.api` and `Dockerfile.worker` production stages with a `RUN test -f` build-time tripwire per file the runtime resolves at module-load time | `infrastructure/docker/` | `check-product-onboarding-canonical.mjs` |
| 7 | **`product_definitions` SQL migration** — at least one `prisma/migrations/*.sql` inserts the `product_definitions` row for the productCode (ON CONFLICT DO NOTHING is mandatory) | `prisma/migrations/` | `check-product-onboarding-canonical.mjs` |
| 8 | **Production binder/program data path** — either (a) the canonical binder seed (`backend/seed/binders.ts`) creates Program + ProgramBinderLink + BinderProductAuthority for the productCode AND a `prisma/migrations/*.sql` mirrors that seed for prod, OR (b) the productCode is explicitly listed in `tools/quality/onboarding-canonical-allowlist.json` with a follow-up ADR that explains the exemption | `prisma/migrations/` + `backend/seed/binders.ts` | `check-product-onboarding-canonical.mjs` |
| 9 | **Jurisdiction `CONFIGS` row** — `backend/modules/jurisdiction/domain/productConfiguration.ts` carries at least one `<countryCode>/<productCode>` entry (typically `CY/<PRODUCT>` for Phase 1 launches) | `backend/modules/jurisdiction/` | `check-product-onboarding-canonical.mjs` |

A new product PR MUST land all nine slots in one diff. The guard runs as part of `npm run gate:agent` and the CI quality job (`tools/quality/ci/run-quality-gate.mjs`).

### Operational spine — the things this ADR explicitly does NOT relax

These are non-negotiable for every new product, enforced by **existing** contracts (cross-referenced for completeness):

- **Producer/consumer envelope**: every relay-driven worker reads `envelope.data.*`, never `job.data.*`. Pinned by ADR-0013 and the worker contract tests under `backend/workers/handlers/__tests__/`.
- **Worker tenant frame**: any handler that calls `tenantScopedPrisma.*` MUST be wrapped in `runWith{Policy,Account,Operating}Tenant`. Pinned by ADR-0019.
- **No fallback datasets** (`.cursor/skills/no-defensive-fallbacks/SKILL.md`).
- **Single canonical owner per concept** (`.cursor/skills/contract-spine/SKILL.md`).
- **Wizard chrome reuse**: every product's wizard root MUST compose `Header` + `QuoteWizardMobileProgress` (sibling, NOT inside a padded `<main>`) + `pb-32`-padded content + `QuoteWizardBottomNav` + `QuoteWizardResumeLink`. Drift from this layout was the root cause of ABY-283/286 on HEALTH; future drift is a `[needs-human-review]` PR.
- **Boolean defaults**: discretionary booleans on wizard steps default to `null` (radio unselected). `BooleanRadio` is the canonical primitive.
- **Session hydration guard**: never `form.reset(quoteData)` when `quoteData` is empty — it wipes in-flight customer typing.

## Consequences

- **Positive:** the next product (PET, MARINE) cannot deploy a 503 "No active binder" on day one — the guard fails the PR before merge. Same for missing worker handler, missing Dockerfile COPY, missing migration. The implicit "look at HEALTH/Travel" knowledge is now machine-checkable.
- **Negative:** the guard adds ~50 LOC of static analysis and a new allowlist file. Each new product pays a small documentation tax (writing the slot list in their introduction ADR).
- **Risk:** false positives (e.g. a product that legitimately rides another binder family). Allowlist + ADR-on-file pattern handles those.

## Forbidden (still)

- Adding a product PR that disables the onboarding guard.
- Merging a product introduction without an introduction ADR (ADR-0032 sets the precedent).
- Inline `if (productCode === 'X')` branching in shared layers (`shared/`, `frontend/src/products/catalog.ts` patterns are allowed; per-product branching in worker code is not).
- Dev-only seed for production binder data (the HEALTH gap that produced ABY-280).

## Links

- ADR-0019 — tenant fail-closed
- ADR-0013 — issuance spine outbox
- ADR-0029 — typed BullMQ job handlers
- ADR-0032 — HEALTH product introduction (precedent)
- `tools/quality/check-product-onboarding-canonical.mjs` — the guard
- `backend/products/__tests__/syntheticProductOnboarding.test.ts` — synthetic-product contract reference
