---
title: ADR-0018 Travel pricing data externalization + fail-closed inputs
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-09
binding: true
---

# ADR-0018: Travel pricing data externalization + fail-closed inputs

## Status

Accepted. Implements PR 3 of the stale-code-removal program. Symmetric with [ADR-0014](./ADR-0014-home-pricing-data-externalization.md) (home rate-card externalization) — same JSON-+-schema-+-loader shape, applied to travel.

## Context

`docs/architecture/contracts/canonical-ownership.md` mandates that product rate tables live as JSON + zod schema + loader under `backend/products/<product>/pricing/data/`, not as inline TypeScript literals. Motor and home already comply (`abbeygate-auto-cyprus-2022.{json,schema.ts,loader.ts}` and `home-rates-2026.json` + `home-rates.schema.ts` + `loader.ts`). Travel was the holdout: rate cards lived as a sparse `RATES` literal in `backend/products/travel/pricing/travelRateTable.ts`, plus three silent defaults inside `travelCalculator.ts`:

- Invalid lead-traveller DOB → `30`.
- Invalid trip dates → `9` days.
- Multi-trip without `maxTripDays` → `17` days.

A `lookupTravelRateWithFallback` helper additionally walked outward from a missing matrix cell to the nearest neighbouring cell, silently substituting "the closest band" when no rate existed for the requested combination. The audit (2026-05-10) flagged this as HIGH because invalid inputs and matrix gaps both produced a quote rather than a validation error or REFER outcome.

## Decision

1. **Externalise the rate matrix.** Every `put(...)` call in the deleted `travelRateTable.ts` is serialised into `backend/products/travel/pricing/data/brit-travel-2025.json` (240 cells). The schema (`brit-travel.schema.ts`) validates the shape; the loader (`loader.ts`) reads, validates, deep-freezes, caches, and exports `lookupTravelRate(plan, tripType, area, coverType, days, age)`. Consumers MUST go through the loader; the legacy `travelRateTable.ts` filename is gone.
2. **Delete the neighbour-band fallback.** `lookupTravelRateWithFallback` is removed. Missing cells return `null` from the loader, and the calculator translates `null` into the existing `refer: true` REFER outcome (with `reason: 'No rate cell available for ...'`). No silent substitution.
3. **Fail closed on bad input.** `travelCalculator.ts` throws a new `TravelQuoteValidationError` with discrete codes when:
   - DOB doesn't parse → `INVALID_DOB`.
   - Trip dates don't parse → `INVALID_TRIP_DATES`.
   - Multi-trip policy lacks `maxTripDays` → `MISSING_MAX_TRIP_DAYS`.
   The previous silent defaults (`30`, `9`, `17`) are deleted. Upstream wizard / BDX validation should reject these inputs before reaching the calculator; the explicit error class makes the failure mode visible if they slip through.
4. **Guard regex extended.** `tools/quality/check-no-inline-rate-tables.mjs` now also forbids `*RateTable*.ts` and `*Rates.ts` filenames under `backend/products/<product>/pricing/`. The `inline-rate-tables-baseline.json` stays empty.
5. **Canonical-ownership row updated** to add travel alongside motor and home, dropping the prior "travel adopts when its rate tables grow" carve-out.

## Consequences

- **Behaviour:** rate computation for valid inputs is identical to PR-pre-3 — same numbers, same matrix lookup. Invalid inputs now produce a `TravelQuoteValidationError` instead of a silent (probably wrong) premium. Off-matrix combinations now produce REFER instead of "nearest neighbour" guess.
- **Operational:** rate rotations now happen in a JSON file diff and pass through the canonical schema before reaching the calculator. Reviews catch shape drift mechanically.
- **REFER volume:** previously-quotable edge cases (off-matrix combinations) now REFER. UW capacity briefed; product owner agrees that REFER beats wrong quote.
- **No code paths still wrap the loader with a fallback.** A repo-wide grep for `lookupTravelRate` returns only the loader and the calculator; the `_TableWithFallback` symbol and the inline `RATES` constant are deleted, and the new guard regex prevents either filename pattern from coming back.

## Migration plan (PR 3)

1. Generate `data/brit-travel-2025.json` from the existing `RATES` literal (one-shot migration script — every cell preserved verbatim).
2. Author `data/brit-travel.schema.ts` (zod) and `data/loader.ts` (validates, deep-freezes, caches, exports `lookupTravelRate` + band resolvers).
3. Refactor `travelCalculator.ts` to use the loader and throw `TravelQuoteValidationError` instead of silent defaults.
4. Delete `travelRateTable.ts`. Update `runtime.ts` `assetRefs` + `getRatingMatrixSnapshot` to point at the JSON.
5. Extend `check-no-inline-rate-tables.mjs` regex to cover `*RateTable*.ts` / `*Rates.ts`.
6. Update [canonical-ownership.md](../contracts/canonical-ownership.md) "Product rate tables" row to add travel.

## Alternatives considered

- **Keep `lookupTravelRateWithFallback` behind a flag.** Rejected — the operating rule for the stale-code-removal program is "delete escape hatches; encode the refusal in CI". A flag is just a deferred deletion.
- **Generate a denser matrix (interpolate cells once, ship the result).** Out of scope. Pricing decisions for unrated combinations belong to underwriting, not the calculator.

## Links

- Plan: `aggressive-stale-code-deletion` PR 3
- Sister ADR: [ADR-0014](./ADR-0014-home-pricing-data-externalization.md)
- Canonical-ownership contract: [canonical-ownership.md](../contracts/canonical-ownership.md)
- Inline rate-tables guard: `tools/quality/check-no-inline-rate-tables.mjs`
