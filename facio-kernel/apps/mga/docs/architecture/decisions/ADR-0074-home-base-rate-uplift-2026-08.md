---
title: ADR-0074 Home 2026-08 base-rate uplift
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-18
binding: true
---

# ADR-0074: Home 2026-08 base-rate uplift (+20%)

## Status

Accepted.

## Context

Peter Sheppard (Abbeygate underwriting, 2026-08-18): *"On the home rater can we please add 20% to the base rates before discounts — all territories. All calcs stay the same, terms same."*

Home rates already live in one JSON card (`home-rates-2026.json` + schema + loader) per ADR-0014 / canonical-ownership. Loadings, discounts, the 3.4% UW profit loading (ADR-0036), the €12 assistance fee (ADR-0042), Greece country +20% (ADR-0052), island +35%, wildfire, minimum premium, and taxes must keep their existing rates.

`CalculationTrace.calculatorVersion` is part of the price-audit hash. Identical inputs that produce a new premium must carry a new version.

## Decision

1. **Data only.** Multiply every base rate in `home-rates-2026.json` (`rateCards` + `workbook`: buildings, contents, jewellery, other all-risks, solar) by exactly 1.2 for CY / PT / GR / ES. Do not change calculator order of operations, loading rates, discount rates, fees, floors, or taxes.
2. **Version.** Bump `HOME_CALCULATOR_VERSION` to `home-xlsx-2022@1.2.0` so pre-uplift and post-uplift audits cannot share a hash.
3. **Provenance.** Record the instruction in the JSON `source` field.

## Consequences

- Customer Home quotes gross ~20% more before discounts; Greece country loading, island, wildfire, claims, discounts, UW profit, assistance, minimum, and tax apply on the uplifted base as before.
- Recalculate of a quote stored under `@1.1.0` yields a different premium and a new audit version.

## Alternatives considered

- A calculator-side `* 1.2` factor. Rejected: second rate source; ADR-0014 says the JSON card is the only literal.
- Leaving `@1.1.0`. Rejected: `priceAuditRecorder` would hash identical version+inputs to a different premium.
