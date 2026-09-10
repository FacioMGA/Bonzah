---
title: Tenancy contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-09
binding: true
---

# Tenancy — binding contract

## Governs
Two orthogonal isolation axes — **customer account scope** and **MGA jurisdiction** — and the rules for resolving and using each.

## Two axes (never confuse them)
| Axis | Field | Identifies | Set by |
|---|---|---|---|
| Account scope | `req.tenantId` (= `Account.id`) | The user's account that *owns* a row | `setAccountScopeContext` (`backend/platform/tenant/rls.ts`) → Postgres GUC `app.current_account_id` |
| MGA jurisdiction | `getTenantConfig()` / `Policy.operatingTenantId` | The Lloyd's coverholder that *issued* a row (CY/PT/ES/GR) | `resolveOperatingTenant` (HTTP) / `runWith*OperatingTenant` (workers, jobs) → ALS |

Resolution chain (HTTP): JWT `tenant_slug` → `X-Tenant-Slug` header → tenant-aware host → `TENANT_SLUG` env (single-tenant deploy convenience). Only `resolveTenant.ts` may run this. Resolution failure is fail-closed (`403 TENANT_UNRESOLVED` / `404 TENANT_UNKNOWN`); per ADR-0019 there is **no env-singleton fallback inside `getTenantConfig()`**.

CLI / worker / system-outbox entrypoints build an explicit `TenantConfig` via `buildTenantConfigFromEnv()` (`backend/platform/tenant/tenantConfigForCli.ts`) and wrap with `runWithOperatingTenant(...)`.

## Allowed
- Read jurisdiction config via `getTenantConfig()` from any module **inside an ALS context**.
- Add `operatingTenantId` (FK → `Tenant.id`) to new business tables.
- Create a new tenant by adding a `Tenant` row + seeding `authority` JSON per product.
- Run tenant-scoped interactive work through `runTenantScopedTransaction`; it sets the transaction-local operating-tenant GUC once on the outer connection and suppresses per-query GUC transactions only inside that marked scope.
- A CUSTOMER may own one account per operating tenant. Customer login, policy linking, and client RLS resolve that tenant-local `AccountUser` membership; concurrent account provisioning must serialize the `(userId, operatingTenantId)` pair and fail closed if duplicate memberships already exist.

## Forbidden
- Adding `country` / `region` to `Policy`, `Account`, or `Claim` as a jurisdiction synonym. Canonical jurisdiction is `Tenant.countryCode`.
- `process.env.DEFAULT_*` and `process.env.TENANT_SLUG` reads outside `tenantConfigForCli.ts`, the slug-resolution step in `resolveTenant.ts`, and explicit CLI / test allowlist paths in `tools/quality/deleted-identifiers.json`.
- Calling `getTenantConfig()` outside an ALS context. The function throws `TenantNotResolvedError` instead of returning a deployment-default singleton.
- `runWithOperatingTenant(getTenantConfig(), ...)` — the legacy "wrap startup with the env-singleton" pattern is gone; use `buildTenantConfigFromEnv()` instead.
- Setting `Tenant.parentOrganizationId` until a second MGA joins.
- Naming a jurisdiction FK `tenantId` instead of `operatingTenantId`.
- Including `SYNTHETIC` / `TEST` tenants in bordereaux or regulatory submissions.

## Escalation
- **Write an ADR** to: change the resolution chain, add a tenant kind beyond `LIVE | SYNTHETIC | TEST`, introduce a control-plane / data-plane split, add a third isolation axis, bypass `runWithOperatingTenant`.

## Links
- Decision history: [ADR-0009](../decisions/ADR-0009-shared-schema-row-level-tenancy.md) · [ADR-0019](../decisions/ADR-0019-tenancy-and-authority-fail-closed.md)
- Guards: `tools/quality/check-no-default-tenant-fallbacks.mjs` · `tools/quality/check-no-deleted-identifiers.mjs`
- Conformance: `npm run test:tenant-isolation` (4 tenants × 3 products = 12 lifecycles per PR)
- Related: [products.md](./products.md) · [jurisdiction-product-config.md](./jurisdiction-product-config.md)
