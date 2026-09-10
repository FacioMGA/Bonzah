---
title: ADR-0097 Motor base excess schedule
audience: architect
status: living
owner: platform-eng
reviewed: 2026-09-05
binding: true
amends:
  - ADR-0016
---

# ADR-0097: Motor base excess schedule

## Status

Accepted. Applies Peter Sheppard's 4 September 2026 Santam instruction to every
territory using the Abbeygate Motor rater.

## Decision

1. Private petrol, diesel and hybrid cars use `basePolicyExcessByEngineBand` in
   `backend/products/motor/pricing/data/abbeygate-auto-cyprus-2022.json`: 0–2200cc
   €250; 2201–3500cc €350; 3501–3999cc €400; 4000cc and over €750.
2. Electric private cars use a €1,000 base excess. This replaces ADR-0016's
   kWh-aware excess decision; ADR-0102's `electricPowerKw` is the canonical
   vehicle field for validation and enrichment, not for this excess.
3. The base-excess schedule is a separate loaded, schema-validated axis in the
   rate dataset, consumed by the Motor calculator and policy-excess projection.
   It must not alter the separately authorised premium-matrix bands; no surface
   or territory may copy either rule.
4. No automatic increased-excess discount exists. An authorised underwriter may
   apply the existing reasoned `uwAdjustments` discount, capped at 20%.

## Consequences

- Quotes, schedules and BO projections display the same calculated base excess
  in every territory.
- 4000cc and higher capacities use the €750 base-excess band.
- A future automatic discount needs a new approved threshold/percentage table.

## Links

- Canonical ownership: [canonical-ownership.md](../contracts/canonical-ownership.md)
- Superseded excess decision: [ADR-0016](./ADR-0016-ev-batterykwh-canonical-field.md)
