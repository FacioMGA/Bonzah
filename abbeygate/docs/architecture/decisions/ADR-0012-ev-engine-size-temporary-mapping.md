---
title: ADR-0012 EV engine size canonical sentinel
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-09
binding: true
supersededBy: ADR-0016
---

# ADR-0012: EV engine size canonical sentinel (= 1)

## Status

Accepted (temporary; superseded once the canonical Battery kWh field is modelled)

## Context

The motor product treats `engineSize` (cubic centimetres of internal-combustion
engine displacement) as a required risk field with a valid range of 300–6000 cc.
It gates UW, comp-excess banding (`ccBandMinimumExcess`,
`computeDeclaredValueBasedExcess`), and motorcycle-specific rating
(`motorcycleCompExcessFromWorkbook`).

Battery-electric vehicles do not have a combustion-engine displacement.
Customers (most recently ABY-31, MG S6 EV Trophy Long Range) cannot complete a
quote without a value in that field. The product owner has accepted that we
will **not** introduce a canonical `batteryKWh` field in this iteration — it
requires a new pricing model and matrix that is still being designed.

The codebase already encodes a canonical EV sentinel server-side in
`backend/products/motor/quotes/quoteDataGuards.ts` `normalizeElectricVehicleCompatibility`:

```ts
if (isElectric && (!Number.isFinite(engineSize) || engineSize <= 0)) {
  normalized.engineSize = 1;
  normalized.__electricEngineSizeNormalized = true;
}
```

That convention had no equivalent on the wizard side, so the client-side Zod
schema rejected EVs before they ever reached the normalizer.

## Decision

The single canonical EV sentinel is `engineSize === 1`. It satisfies every
existing `engineSize > 0` guard naturally and lands in the smallest cc band on
every matrix lookup, which is the conservative rating bucket until the kWh
model lands.

1. **Trigger:** `fuelType === 'Electric'` (the literal canonical value from
   `packages/products/src/motor/vehicleEnrichment.ts` `FUEL_TYPE_OPTIONS`).
2. **Wizard schema** (`packages/products/src/motor/schemas/step3.ts`): when
   `fuelType === 'Electric'`, `engineSize` MUST equal `1`. Any other value
   (including 0 or a stale ICE cc carried over from a fuel-type switch) is
   rejected. Non-EVs still require 300–6000.
3. **Wizard UI**
   (`frontend/src/products/motor/wizard/components/steps/Step3VehicleCover.tsx`):
   when the user selects `Electric`, `engineSize` is coerced to `1` via
   `setValue` and the input is disabled with a sibling helper note pointing at
   this ADR. Switching away from `Electric` clears the sentinel so the next
   ICE value is captured fresh and never silently mis-rated as a 1cc engine.
4. **Server normalizer** (`normalizeElectricVehicleCompatibility`): unchanged.
   Continues to act as the canonical safety net for legacy data, BO-imported
   data, and BDX import paths that bypass the wizard.
5. **Pricing calculator** (`backend/products/motor/pricing/autoInsuranceCalculator.ts`):
   unchanged. `engineSize === 1` passes every `> 0` guard, `ccBandMinimumExcess(1)`
   returns 250 (smallest band), `parseEngineBand(1, …)` returns the smallest
   band index, and `motorcycleCompExcessFromWorkbook(1)` returns 150 (smallest
   motorbike excess).
6. **Profile / contract authority** (`packages/products/src/motor/profile.ts`):
   unchanged. `engineSize` stays `requiredAtStages: QUOTE_BIND_AND_ISSUANCE`;
   the canonical `isEmptyValue` check (`packages/validation/src/runner.ts`)
   treats `1` as present.

## Consequences

- **Risk:** EV pricing is currently a flat conservative band, not a kWh-aware
  rating. Underwriting takes precedence over rating accuracy for a small
  cohort.
- **Audit trail:** Every quote with `fuelType === 'Electric' && engineSize === 1`
  is implicitly stamped with this ADR. Server-imported rows additionally carry
  `__electricEngineSizeNormalized = true` from the existing normalizer.
- **Migration:** When the Battery kWh field lands, this ADR is superseded.
  Schema, UI, and the server normalizer revert to requiring a canonical EV
  capacity field; the EV-1 sentinel is removed. Stored quotes with
  `engineSize === 1 && fuelType === 'Electric'` (and/or
  `__electricEngineSizeNormalized`) will be migrated by the kWh-introduction
  ADR (TBD).

## Alternatives considered

- **`engineSize === 0`** — rejected: trips every `> 0` guard in
  `assertMotorPricingInputs`, `ccBandMinimumExcess`, `parseEngineBand`, and
  `motorcycleCompExcessFromWorkbook`, requiring parallel EV branches in each.
  The `1` sentinel works with the existing guards unchanged.
- **Hide engine-size for EVs entirely** — rejected: BO views and PDF templates
  read the field; a missing field would diverge the persisted shape from
  non-EV quotes and complicate the future kWh migration.
- **Make engine-size optional for everyone** — rejected: relaxes a working
  invariant for ICE vehicles to fix an EV-only edge case.
- **Build the Battery kWh model now** — out of scope this cycle (rating
  matrix, UW rules, document templates, BO surfaces all need updating).
