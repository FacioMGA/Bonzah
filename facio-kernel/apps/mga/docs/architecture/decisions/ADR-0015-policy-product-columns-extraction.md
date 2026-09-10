---
title: ADR-0015 Per-product Policy data extraction
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-09
binding: true
---

# ADR-0015: Per-product `Policy` data extraction

## Status

Accepted (gates PR8 of the aggressive-stale-code-deletion plan).

## Context

`prisma/schema.prisma` `Policy` carries motor-shaped columns (`vehicleInfo`,
`driverInfo`, raw legacy `Json?` columns) inherited from the pre-multi-product
era. They force a `productType === 'MOTOR'` branch in
`backend/modules/policy/app/bdxImport/bdxImportExecution.ts` and leak motor
heritage into a model that needs to host home, travel, and future products.

The shape of the data is per-product, not per-tenant; storing it in shared
columns invites silent drift and prevents adding a new product without a Prisma
migration.

## Decision

1. Add a single `productData Json?` column to `Policy`. Per-product readers and
   writers go through `IProductAdapter` so the column itself is opaque to
   shared code.
2. New method on `backend/modules/policy/domain/productContracts.ts`:
   `persistProductFields(input): Promise<void>`. Each adapter (motor, home,
   travel) implements it with a strongly typed shape that is serialized into
   `productData`.
3. Update `backend/modules/policy/app/bdxImport/bdxImportExecution.ts` to
   delete the `motorProductFieldsOnly` branch and route every product through
   `adapter.persistProductFields(...)`.
4. Add a covering projection in
   `backend/modules/policy/infra/projections/policyListIndex.ts` for the
   subset of `productData` fields that BO list queries surface; queries on
   `Policy` use the projection, never `quoteData->>...` or `productData->>...`
   in SQL.
5. Author a Prisma migration that:
   a. Adds `productData Json?` (nullable, no default).
   b. Backfills motor rows by copying `vehicleInfo`, `driverInfo`, and the
      motor subset of `quoteData` into `productData` with a deterministic
      shape that matches `MotorProductAdapter.persistProductFields` output.
   c. (Follow-up migration) drops `vehicleInfo`, `driverInfo`, raw legacy
      `Json?` columns once consumers are migrated and the projection is fresh
      (planned for the release after PR8 lands; tracked separately).
6. Add a row to `docs/architecture/contracts/canonical-ownership.md`:
   "Per-product policy data — owner: `IProductAdapter.persistProductFields`;
   forbidden: writing to `Policy.productData` outside the adapter."

## Consequences

- **Behavior:** existing motor rows continue to read/write the same logical
  fields; the shape moves into a typed `productData` JSON object instead of
  flat columns. The adapter contract makes the typing explicit.
- **BDX import:** drops the product-string branch. New products plug in via
  the adapter alone.
- **Performance:** the projection covers BO list queries; ad-hoc queries on
  `productData->>...` are forbidden in shared code and called out by review.
  An entry in `docs/architecture/contracts/database-indexes.md` notes the new
  projection.
- **Migration:** non-destructive add of `productData` ships in PR8; the column
  drop is a follow-up release once the projection is verified clean against
  production traffic.
- **Risk:** largest schema change in the plan. Gated on staging clone test
  via `tools/migrations/reset_and_rerun_bdx_disposable.mjs` and a green cy4
  staging deploy before merge to main per the plan's PR8 override.

## Alternatives considered

- **`PolicyMotorDetails` table per product.** Rejected: requires a new table
  and join per product, multiplying schema surface. `productData JSON` keeps
  the Policy aggregate intact and pushes typing into the adapter.
- **Continue with motor columns + new product columns added per product.**
  Rejected: explicit canonical-ownership violation, doesn't scale.
- **Move motor data into a separate database.** Out of scope for this
  release; correctness and atomicity needed.

## Links

- Canonical-ownership: [canonical-ownership.md](../contracts/canonical-ownership.md)
- Database indexes contract: [database-indexes.md](../contracts/database-indexes.md)
- Plan: `aggressive-stale-code-deletion` PR8
