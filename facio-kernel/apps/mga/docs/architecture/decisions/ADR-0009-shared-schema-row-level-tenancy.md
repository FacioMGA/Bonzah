---
title: ADR-0009 Shared-schema row-level tenancy
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# ADR-0009: Shared-Schema Row-Level Tenancy

**Status:** Accepted  
**Date:** 2026-04-26  
**Authors:** Platform Team  
**Replaces:** n/a  
**Supersedes:** n/a

---

## Context

Abbeygate Insurance operates one Lloyd's coverholder scheme across four EU jurisdictions — Cyprus (CY), Portugal (PT), Spain (ES), and Greece (GR) — offering the same three products (Motor, Home, Travel) in each. Each jurisdiction has distinct:

- Insurance Premium Tax (IPT) rates and structures (CY: flat €2 fee; PT: 9% rate; GR: 15% rate; ES: 8.15% rate)
- Legal/compliance pack (document templates, T&C wording)
- Underwriting authority thresholds (vehicle value caps, age limits, allowed risk countries)
- Branding and coverholder email configuration

The existing codebase models "which jurisdiction is this deployment for" as a set of process-level environment variables (`DEFAULT_REGION_CODE`, `DEFAULT_COUNTRY`, `IPT_RATE`, etc.) consumed by a process-wide singleton `getTenantConfig()`. This makes it impossible to serve multiple jurisdictions from a single running process, and conflates MGA/jurisdiction identity with deployment configuration.

The business goal is: one application deployment, four active jurisdictions, correctness-guaranteed per-jurisdiction config on every request.

---

## Decision

**Shared schema, row-level tenancy, single deployment.**

We introduce `Tenant` as a first-class Prisma model. Each jurisdiction is one `Tenant` row. Per-request tenant resolution injects the correct `TenantConfig` into an `AsyncLocalStorage` context so every downstream caller — tax calculation, document template selection, UW authority evaluation — reads jurisdiction-correct values without signature changes.

Business data tables (starting with append-only operational tables, then core business tables) gain a `tenantId` foreign key referencing `Tenant`. Postgres Row-Level Security policies enforce isolation at the database level as a belt-and-braces measure.

---

## Rejected alternatives

**Silo per MGA (one database per jurisdiction):** Correct for data isolation, wrong for this stage. We have one client, four jurisdictions, and three products with ~0 per-jurisdiction schema variation. Four Postgres databases mean four migration runs, four connection pools, and no cross-jurisdiction reporting without a data lake. The operational overhead outweighs the isolation benefit when all four jurisdictions are owned by the same entity.

**Hybrid control-plane model (shared config plane, separate data planes):** The right architecture for a mature multi-MGA SaaS business with genuinely independent clients. Wrong for the next 6–12 months where all tenants are Abbeygate and all data is owned by one entity. We build the simpler model now and add the control-plane layer when a second MGA arrives.

---

## Consequences

### Positive

- One migration, one deployment, one monitoring stack serves all four jurisdictions.
- The `Tenant` model with `parentOrganizationId String?` (null today) is the exact same schema that handles multi-MGA in 18 months — no second migration when MGA-X arrives.
- Conformance suite can run `4 tenants × 3 products = 12` lifecycle assertions on every PR once the tenant axis is added in Sprint 3.
- Synthops gains a synthetic organization (`synthops-cy`, `synthops-pt`, `synthops-es`, `synthops-gr`) that exercises all four jurisdiction paths every 15 minutes.

### Negative / risks

- Every new DB query that touches business tables must include tenant scoping. Mitigation: Prisma client extension auto-injects `where: { tenantId }` (Sprint 2); Postgres RLS provides a second enforcement layer (Sprint 3).
- Backfill needed when adding `tenantId` to existing rows. Mitigation: all existing data is `abbeygate-cy`; single-value backfill is low-risk.

### Invariants enforced by this ADR (MUST NOT be violated in future PRs)

1. **Jurisdiction is a property of the tenant, never a business-row column.** `Tenant.countryCode` is the canonical jurisdiction. Adding `country` or `region` to `Policy`, `Account`, or `Claim` as a synonym for jurisdiction violates this ADR.
2. **No `process.env.DEFAULT_*` reads outside `tenantConfig.ts`.** All jurisdiction-scoped config flows through `getTenantConfig()` which reads from the per-request ALS context.
3. **`Tenant.parentOrganizationId` is null until a second MGA joins the platform.** Do not model organizational hierarchy prematurely.
4. **`SYNTHETIC` and `TEST` tenant kinds exist for synthops and CI fixtures.** They must be excluded from bordereaux reporting and regulatory submission pipelines.

---

## Four-sprint implementation plan

### Sprint 1 — Tenant entity, read-path only (this ADR's delivery)

- Add `model Tenant` to Prisma schema with all config fields (IPT, adminFee, legalPack, regionConfig replacements, `authority Json?` reserved for Sprint 4).
- Seed four rows: `abbeygate-cy`, `abbeygate-pt`, `abbeygate-es`, `abbeygate-gr`.
- `AsyncLocalStorage` for per-request tenant: `backend/platform/tenant/tenantAls.ts`.
- `resolveOperatingTenant` Express middleware: resolves slug from JWT claim → `X-Tenant-Slug` header → `TENANT_SLUG` env var; DB lookup with 60 s LRU cache; wraps `next()` in `runWithOperatingTenant(config, fn)`.
- `getTenantConfig()` reads from ALS first, falls back to process env for tests/CLI.
- Delete `backend/modules/policy/domain/regionConfig.ts`; redirect its three call sites.
- Redirect all `process.env.DEFAULT_*` reads in non-config files to `getTenantConfig()`.
- CI guard: forbid `process.env.DEFAULT_COUNTRY/REGION_CODE/CURRENCY` outside `tenantConfig.ts`.

### Sprint 2 — Write path, low-risk tables

Add `tenantId String NOT NULL` (FK → `Tenant`) to: `SanctionScreeningRun`, `RecoEvent`, `RecoBanditArm`, `PolicySearchIndex`, `PolicyListIndex`, `AuditAction`, `Outbox`, `WebhookEndpoint`, `ApiKey`. Prisma client extension for auto-inject. Remove the three `@default("default")` columns. CI guard `guard:no-default-tenant-fallbacks`.

### Sprint 3 — Write path, core business tables

`Account`, `Policy`, `RiskTransaction`, `Endorsement`, `Document`, `DocumentSet`, `Invoice`, `Payment`, `Reconciliation`, `Claim`, `Binder`, `Program` and all projection models. Postgres RLS policies (`tenantId = current_setting('app.tenant_id')::uuid`). Conformance suite adds tenant axis: `it.each(tenants × adapters)` → 12 assertions per CI run. Backfill all existing rows to `abbeygate-cy`.

### Sprint 4 — Authority extraction and BO tenant switcher

`backend/products/motor/authority/readMotorAuthority.ts` reads `Tenant.authority.motor` → typed `MotorUwConfig`. Pass override to `evaluateMotorUwAutomation(data, authorityOverride)` (hook already present via `mergeUwConfig`). Fix the latent `allowedRiskCountries` gap for Greece at the engine layer. BO tenant switcher (header select → re-issues JWT with new `tenant_slug`). CI guard `guard:no-motor-uw-literals`.

---

## Two orthogonal isolation axes (naming contract)

```
req.tenantId   (Account.id)  ─── customer data isolation ─── setAccountScopeContext / GUC app.current_account_id
req.tenant     (Tenant row)  ─── MGA/jurisdiction config  ─── resolveOperatingTenant / ALS
```

These must never be conflated. `req.tenantId` is the customer account owning the policy. `req.tenant` is the MGA entity operating the platform for that jurisdiction. Both can be set simultaneously on the same request.

---

## Addendum — Naming clarity between the two isolation axes (added post-Sprint 1)

Two separate middleware functions run on every authenticated request and they must never be confused:

| Concept | Variable / Field | What it identifies | Set by | Used for |
|---------|------------------|--------------------|--------|----------|
| **Customer account scope** | `req.tenantId` / `Account.id` | The authenticated user's account that *owns* a policy | `setAccountScopeContext` (rls.ts) | PostgreSQL GUC `app.current_account_id`; all existing RLS policies |
| **MGA jurisdiction** | `getTenantConfig()` / future `Policy.tenantId` | The Lloyd's coverholder entity (CY, PT, GR, ES) that *issued* the policy | `resolveOperatingTenant` (resolveTenant.ts) | Tax calculation, document templates, UW authority, product pricing |

### Invariant: the FK column name on business tables

When Sprint 3 adds a jurisdiction FK to `Policy`, `Account`, `Claim`, etc., that column **must** be named `operatingTenantId` (not `tenantId`) to avoid silent confusion with the existing `req.tenantId` (account scope). Example:

```prisma
model Policy {
  // ...
  operatingTenantId  String   // FK → Tenant.id  (MGA jurisdiction)
  // req.tenantId (Account.id) is resolved separately via RLS, NOT stored here
}
```

### Planned rename in Sprint 3 (non-breaking, rename-only PR)

To remove the naming ambiguity at the code level before `operatingTenantId` columns land:

```
setTenantContext          → setAccountScopeContext        (rls.ts)  [COMPLETED — Sprint 3]
resolveTenantOrThrow      → resolveAccountScopeOrThrow   (tenantResolution.ts)
req.tenantId              → req.accountScopeId            (express.d.ts)
```

This rename is safe — it touches only the three files above and their import sites; the GUC name (`app.current_account_id`) and all RLS policies stay unchanged.

### `authority Json?` shape convention

The `Tenant.authority` column is a single JSON bag today. As products are added it will grow sub-objects per product line. The agreed convention once Sprint 4 is reached:

```typescript
// Tenant.authority (JSONB) — typed at the application layer, never in the DB
type TenantAuthority = {
  motor?: MotorUwConfig;
  home?:  HomeUwConfig;
  travel?: TravelUwConfig;
};
```

Each sub-object is validated with Zod at read time in the product-specific authority reader (`readMotorAuthority.ts`, etc.), not in the shared config layer. The JSON bag remains untyped in Prisma to keep the migration surface small.

---

## References

- `backend/platform/tenant/tenantConfig.ts` — existing process-wide singleton (migrated in Sprint 1)
- `backend/platform/tenant/tenantAls.ts` — new ALS module (Sprint 1)
- `backend/http/middleware/resolveTenant.ts` — new middleware (Sprint 1)
- `backend/products/motor/underwriting/motorUwAutomation.ts` — `mergeUwConfig(override?)` hook (Sprint 4)
- `backend/products/shared/tenantTaxes.ts` — `applyTenantTaxes(tenant, net)` already parameterized
- `backend/products/shared/templateResolver.ts` — country-specific template fallback already implemented
