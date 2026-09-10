---
title: ADR-0034 Multi-tenant policy-number namespace + per-tenant binder mirroring
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-26
binding: true
---

# ADR-0034: Multi-tenant policy-number namespace + per-tenant binder mirroring

## Status

Accepted. Closes the operational gap that left abbeygate-pt / -gr / -es returning
503 "No active binder linked for {HOME,TRAVEL,HEALTH}" and Prisma unique-constraint
crashes on motor on every public quote start (ABY-294 / ABY-295 / ABY-296 / ABY-297).

## Context

ADR-0009 introduced **shared-schema row-level tenancy**: one platform, one
deployment, four operating tenants (CY, PT, GR, ES). ADR-0019 then made the
tenant boundary **fail closed**: every tenant-scoped Prisma write/read must
resolve a tenant via ALS or throw.

What was *not* covered by either ADR:

1. **Operational data for non-CY tenants.** `prisma/seed.ts` and
   `backend/seed/binders.ts` both pin `operatingTenantId: TENANT_IDS.CY` on
   every `Program`, `Binder`, `ProgramBinderLink`, and `BinderProductAuthority`
   row. PT / GR / ES `Tenant` rows are seeded (by `20260426100000_sprint2_operating_tenant_id`)
   but carry **zero operational rows**. ADR-0033 slot 8 codified the per-product
   onboarding checklist but did not codify a per-tenant onboarding checklist.

2. **Policy-number namespace.** `Policy.@@unique([policyNumber, renewalSequence])`
   is global. The reservation sequence in `backend/platform/utils/platformIds.ts`
   uses tenant-scoped keys (`PT:QUOTE:ABQ`, `CY:QUOTE:ABQ`), but both counters
   start at the same `START_SEQ = 1_000_001` floor, and the floor scan
   (`tx.policy.findFirst({where: {policyNumber: {startsWith: 'ABQ'}, ...}})`)
   is tenant-scoped via the extension — so a fresh tenant can never see CY's
   already-issued `ABQ1000001` and will collide with it on the first write.
   ADR-0019 already flagged this as a follow-up: *"single-tenant ID-prefix
   assumption tracked as a separate multi-tenant follow-up"*.

The two gaps together produced the live regression observed on `abbeygate-pt.facio.io/start/quote`:

| Product | Symptom | Root cause |
|---------|---------|-----------|
| MOTOR   | `Unique constraint failed on the fields: (policyNumber, renewalSequence)` | tenant counter floor = 1_000_001 → collides with CY's `ABQ1000001` |
| HOME    | `No active binder linked for HOME in this tenant` | no PT Program, no PT Binder, no PT ProgramBinderLink |
| TRAVEL  | `No active binder linked for TRAVEL in this tenant` | same |
| HEALTH  | `No active binder linked for HEALTH in this tenant` | same; also ADR-0032 Phase 1 limits HEALTH to CY |

## Decision

Two changes, encoded together because they share the multi-tenant axis:

### 1. Tenant-scoped policy-number format

Policy and quote numbers carry the operating tenant's country code in the
identifier itself. New canonical format:

```
<PREFIX>/<COUNTRY_CODE><7_DIGIT_SEQ>

Quote   (per tenant):   ABQ/CY1000001    ABQ/PT1000001    ABQ/GR1000001    ABQ/ES1000001
Policy  (per tenant):   ABOLV/CY1000001  ABOLV/PT1000001  ABOLV/GR1000001  ABOLV/ES1000001
```

- The `@@unique([policyNumber, renewalSequence])` constraint stays **global**.
  Tenant disambiguation is in the identifier itself, so a sequence collision
  across tenants is structurally impossible.
- Pre-ADR-0034 CY rows keep their original format (`ABQ1000001`). The
  reservation floor logic recognises BOTH formats so the CY sequence
  continues from where it left off without renaming historical rows.
- Customer-facing pages and BO surfaces render the full identifier verbatim.
  No tenant-by-tenant rendering logic.

The reservation pipeline (`reserveNextQuoteId` / `reserveNextPolicyId`) is
the single source of truth — it is the **only** call site that constructs a
policy/quote number. Direct string literals matching `^ABQ\d+$` or
`^ABOLV\d+$` outside the canonical formatter are now forbidden.

### 2. Per-tenant binder mirroring (Phase 1)

Each operating tenant carries its own row for every Lloyd's BAA that
authorises its country in the BAA's `territorialScope`. The rows are
**mirrors of the same underlying Lloyd's agreement**:

- Same `umr` (e.g. `B176023EEA6551`)
- Same `agreementNumber` (e.g. `23EEA6551`)
- Same `coverholderName` / `coverholderPin`
- Same `startDate` / `endDate`
- **Different** `id` (UUID per tenant; deterministic `<binderId>-<COUNTRY_CODE>` form)
- **Different** `operatingTenantId`

A single Lloyd's BAA with `territorialScope: ['CY','ES','PT','GR']` produces
four rows. Each row anchors one tenant's `Program` → `ProgramBinderLink` →
`BinderProductAuthority` chain. This:

- Preserves ADR-0019's per-tenant fail-closed boundary on `Binder`,
  `BinderProductAuthority`, `Program`, and `ProgramBinderLink` (all stay in
  `TENANT_SCOPED_MODELS`).
- Preserves per-tenant BDX submission — `XLSX.GENERATE_BORDEREAUX_V52` and
  `runWithBinderOperatingTenant` continue to operate on a single tenant's
  binder rows.
- Allows BO admin tools in each tenant to manage their own binder operationally
  without crossing into another tenant's row.
- Does **not** require schema changes to `Binder.operatingTenantId` or the
  `TENANT_SCOPED_MODELS` set in `backend/platform/db/tenantExtension.ts`.

The user-facing concept of *"PT and CY share the same Lloyd's BAA"* is
preserved at the **agreement** level (same UMR/agreement) — not at the
**row** level. The mirror rows are operationally distinct so that BDX,
authority checks, and ALS-fail-closed all continue to work without a
schema-level refactor.

### 3. Motor binder authority gate (consistency)

The motor session creator in `backend/products/motor/quotes/quoteSessionOps.ts`
must also call the canonical binder lookup. Today it creates a draft policy
with no binder check, then crashes if the policy-number collides. With this
ADR it routes through the same `findLatestActiveBinderLinkForProduct` as the
generic quote router and refuses with the same 503 "No active binder linked
for MOTOR in this tenant" when authority is missing — instead of a Prisma
500.

This closes a long-standing inconsistency between motor and the rest of the
products: every public quote session creator now enforces binder authority
*before* writing the policy row.

## Phase 2 follow-ups (deferred, not in this ADR's PR)

These are real follow-ups but explicitly out of scope to keep the production
fix narrow:

- **One row per Lloyd's BAA (true cross-tenant binder).** Collapse the four
  mirror rows into a single `Binder` row with `operatingTenantId` nullable
  ("lead coverholder"). Requires:
  - Removing `Binder` + `BinderProductAuthority` from `TENANT_SCOPED_MODELS`
  - Auditing every `tenantScopedPrisma.binder{,ProductAuthority}` call site
    (~20 call sites — BO admin routers, policy detail loader, BDX worker)
  - Designing BDX-per-territory aggregation (`XLSX.GENERATE_BORDEREAUX_V52`
    payload becomes `{binderId, operatingTenantId}` not just `{binderId}`)
  - Renaming `runWithBinderOperatingTenant` to `runWithBinderAndTenant` or
    deleting it in favour of explicit tenant injection at the worker entry
  - Tracked in a separate Linear epic; an ADR amendment will follow.

- **MOTOR jurisdiction expansion.** The `ABBEYGATE0125-*` motor binders
  carry `territorialScope: ['CY']` only. PT / GR / ES motor wizards will
  correctly 503 "No active binder linked for MOTOR" until Lloyd's authorises
  motor in those jurisdictions. That is a regulatory action, not a code
  change — when the BAA expands, the `territorialScope` field on the
  existing rows changes and PT/GR/ES motor mirrors get seeded.

- **HEALTH jurisdiction expansion.** Per ADR-0032 §6, HEALTH is CY-only for
  Phase 1. PT / GR / ES HEALTH wizards will 503 until the BAA expands and
  ADR-0032 §6's follow-ups land.

## Forbidden

- Manually constructing a policy/quote number string outside
  `formatQuoteId` / `formatPolicyId` / `reserveNextQuoteId` / `reserveNextPolicyId`.
- Adding a fallback that swallows the missing-binder 503 (e.g. *"fall back
  to any active binder if the territorial one is missing"*). Refused by the
  `no-defensive-fallbacks` skill.
- Per-tenant hard-coded branches inside the binder lookup (`if (tenant === 'pt')`).
- A second policy-number generator, even "for legacy back-compat" reads.

## Migration plan

1. **Schema:** no change to `prisma/schema.prisma`. The new identifier
   format fits within the existing `policyNumber String` column; the unique
   constraint stays global.

2. **Code (`backend/platform/utils/platformIds.ts`):**
   - `formatQuoteId(sequence)` → `${PREFIX}/${countryCode}${padded(sequence)}`.
   - `formatPolicyId(sequence)` → same shape.
   - `reserveNextPolicyNumber(tx, key, prefix, ...)` scans for the latest
     row matching either the tenant-coded format (`${prefix}/${cc}\d+`) or
     the unprefixed pre-ADR-0034 format (`${prefix}\d+`, no `/`). Floor =
     max of both seeds.

3. **Code (`backend/products/motor/quotes/quoteSessionOps.ts`):** route
   through `findLatestActiveBinderLinkForProduct` (or its app-layer
   equivalent) before reserving the policy number. 503 cleanly when missing.

4. **Production data:** new SQL migration
   `prisma/migrations/<ts>_seed_pt_gr_es_programs_and_binders/migration.sql`
   that inserts per-tenant `Program`, `Binder`, `ProgramBinderLink`,
   `BinderProductAuthority` rows for HOME and TRAVEL on every non-CY tenant
   whose country appears in the corresponding binder's `territorialScope`.
   Idempotent (`WHERE NOT EXISTS` / `ON CONFLICT DO NOTHING`).

5. **Dev seed (`backend/seed/binders.ts`):** loop over every production
   tenant, creating per-tenant `Program`s and mirrored `Binder` / `Link` /
   `Authority` rows for products the territorial scope authorises.

6. **Tests:** unit tests for the new identifier formatter; integration test
   that boots a PT request and exercises `findLatestActiveBinderLinkForProduct`
   end-to-end; vitest assertion that motor session creation 503s on a
   tenant with no MOTOR binder.

## Links

- ADR-0009 — shared-schema row-level tenancy
- ADR-0019 — tenancy + binder authority fail-closed
- ADR-0032 — HEALTH product introduction
- ADR-0033 — product onboarding canonical checklist
- `docs/architecture/contracts/canonical-ownership.md` — Binder/program authority row
- `backend/platform/utils/platformIds.ts` — single owner of policy/quote numbers
- `backend/modules/quotes/http/genericPublicQuoteRouter.ts:89-128` — canonical binder lookup
- Linear: ABY-294, ABY-295, ABY-296, ABY-297 (the four marker.io reports this ADR closes)
