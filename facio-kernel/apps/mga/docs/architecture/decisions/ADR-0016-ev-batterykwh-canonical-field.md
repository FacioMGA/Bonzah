---
title: ADR-0016 EV batteryKWh canonical field
audience: architect
status: archived
owner: platform-eng
reviewed: 2026-09-06
binding: true
supersedes:
  - ADR-0012
superseded_by:
  - ADR-0102
---

# ADR-0016: EV `batteryKWh` canonical field

## Status

Superseded by ADR-0102. `batteryKWh` was not the approved Santam rating
attribute; retained text is historical decision evidence only.

## Context

ADR-0012 introduced the `engineSize === 1` sentinel + `__electricEngineSizeNormalized`
flag as a temporary mapping until a canonical battery-capacity field landed.
The sentinel papers over the fact that BEVs have no combustion-engine
displacement: the wizard schema, the pricing factors, the UW automation, and
the stored quote shape all pretend EVs are 1cc ICEs. The pricing matrix lands
EVs in the smallest cc band — a conservative bucket, not an accurate one.

Every read/write site that touches `engineSize` or `__electricEngineSizeNormalized`
is documented in ADR-0012's "Decision" section. This ADR closes that loop.

## Decision

1. **Canonical field.** Add `batteryKWh: number` to the motor profile
   (`packages/products/src/motor/profile.ts`) and the wizard step 3 schema
   (`packages/products/src/motor/schemas/step3.ts`).
   - `requiredAtStages: QUOTE_BIND_AND_ISSUANCE` when `fuelType === 'Electric'`.
   - Range: `5` ≤ `batteryKWh` ≤ `400`. Below 5 kWh is a hybrid/PHEV
     discrepancy; above 400 kWh is out-of-fleet at the current rating
     contract.
   - Required to be `null`/`undefined` for ICE rows (rejected by schema if
     present).
2. **Schema enforcement.** Step 3 schema rejects: `fuelType === 'Electric'`
   with missing/invalid `batteryKWh`; `fuelType !== 'Electric'` with any
   `batteryKWh` value present. ICE rows continue to require `300 ≤ engineSize ≤ 6000`.
3. **Wizard UI.** When the user selects `Electric`, the engine-size input is
   hidden and a `batteryKWh` numeric input takes its place. Switching away
   from Electric clears `batteryKWh` and re-shows engine-size cleanly.
4. **Server normalizer.** `backend/products/motor/quotes/quoteDataGuards.ts`
   `normalizeElectricVehicleCompatibility`:
   - Stops setting `engineSize = 1`.
   - Stops emitting `__electricEngineSizeNormalized`.
   - Validates `batteryKWh` is present for `fuelType === 'Electric'`; rejects
     otherwise (existing fail-closed pattern).
5. **Pricing.** `backend/products/motor/pricing/autoInsuranceCalculator.ts`
   adds a kWh-aware band lookup keyed off the new field for EVs. ICE rows
   continue through the existing engine-size band.
6. **UW.** `backend/products/motor/underwriting/motorUwAutomation.ts` reads
   `fuelType === 'Electric'` directly; the `__electricEngineSizeNormalized`
   marker is removed.
7. **Persistence + REFER on rerate (amended 2026-05-10 by PR 4 of the
   stale-code-removal program).** EV capacity lives on the existing
   `Policy.quoteData` JSONB column as the `batteryKWh` property; no
   Prisma column is introduced (the schema never had a top-level
   `Policy.batteryKWh` column, and inventing one as part of the deletion
   PR introduces unnecessary migration risk). Per the audit principle
   "no invented technical attributes become canonical truth", legacy
   stored EV rows (`fuelType === 'Electric' && engineSize === 1` and/or
   the deleted normalizer marker) are **not** backfilled with a guessed
   numeric default. Instead, on every rerate / renewal / issuance touch,
   `motorUwAutomation.ts` emits `YELLOW.EV_BATTERY_KWH_MISSING` whenever
   an EV record reaches it without a finite positive `batteryKWh`. UW
   sources the real capacity from the customer (or CarDog re-enrichment)
   before the record can advance. The transitional marker key is removed
   from `QuoteData` and from new writes; existing JSON blobs may still
   carry the orphan key but no consumer reads it. A future operate-only
   PR can sweep the marker out of stored JSON if the audit trail demands
   it; the absence of a numeric column means there is no schema-level
   debt to pay.
8. **Tests.** `backend/modules/policy/app/__tests__/quoteDataSchema.test.ts`
   replaces the sentinel assertions with kWh-shape assertions. `backend/products/motor/pricing/factors/abbeygateFactors.ts`
   line 282 (the `engineSize <= 100 → 150` overlap with the sentinel) is
   re-tested to confirm no EV path falls through it.

## Consequences

- **Pricing semantics change for EVs.** Historic EV quotes stored under the
  sentinel were rated in the smallest cc band. The kWh-aware matrix may move
  prices for new EV quotes. Coordinated with underwriting; the conservative
  initial bucket protects existing book risk.
- **Stored-quote backwards compatibility.** Per the amended step 7,
  legacy EV records carry NO invented default kWh. Rerate / renewal of
  such a record produces a `YELLOW.EV_BATTERY_KWH_MISSING` UW signal so
  the missing capacity is sourced explicitly before the record can
  advance. Customer-visible premium for active policies does not change
  unless an explicit re-rate trigger fires AND UW provides the kWh.
- **Schema hygiene.** `__electricEngineSizeNormalized` is purged from the
  type system, the quoteData shape, UW reads, and tests. ADR-0012's
  "Migration" section is satisfied.
- **Document templates.** PDF and BO surfaces that surface engine displacement
  switch to displaying battery capacity for EVs (handled in PR9).

## Migration plan (PR9)

1. Add ADR-0016, mark ADR-0012 `status: superseded` `supersededBy: ADR-0016`
   (already done in the PR2 doc-hygiene pass).
2. Schema + wizard UI changes.
3. Pricing matrix + UW + tests.
4. Prisma migration: add `batteryKWh`, backfill, drop
   `__electricEngineSizeNormalized`.
5. Deploy outside business hours; verify with `npm run smoke:quote-bind-issue`
   plus a manual EV quote against the cy4 endpoint.

## Alternatives considered

- **Keep `engineSize === 1` indefinitely.** Rejected by ADR-0012 itself; the
  sentinel was always temporary.
- **Combined `propulsionEnergy` field that holds either cc or kWh.** Rejected:
  loses type safety, complicates rating matrix lookups, and forces every
  consumer to inspect `fuelType` before using the value.
- **Defer to a future quarter.** Rejected: the sentinel cross-cuts schema,
  UI, server normalizer, UW, pricing, and tests; every code change in the
  motor surface drags the cleanup along. Closing the ADR is the cheaper path.

## Links

- Superseded: [ADR-0012](./ADR-0012-ev-engine-size-temporary-mapping.md)
- Canonical-ownership: [canonical-ownership.md](../contracts/canonical-ownership.md) ("Motor vehicle enrichment" row)
- Plan: `aggressive-stale-code-deletion` PR9
