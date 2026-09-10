---
title: ADR-0052 Home Greece country loading
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-17
binding: true
---

# ADR-0052: Home Greece country loading

## Status

Accepted for phase 1.

## Context

Abbeygate underwriting (Theo Dengestinos, 2026-07-17) confirmed that the Greek
HOME premium is a flat 20% loading on top of the Cyprus premium: *"At this time
the Greek premium is 20% loading on top of the Cyprus premium."*

Our rate cards carried the Greece (`GR`) base rate card byte-for-byte identical
to Cyprus (`CY`) with no uplift, so every Greece HOME quote was priced ~20%
below underwriting intent. The Greece island surcharge (+35% for Lefkada,
Zakynthos, Kefalonia, Santorini) and the Athens `10xxx`/`11xxx` decline already
existed; only the country-wide 20% was missing.

## Decision

1. **Canonical rate.** The per-country base loading lives in the home rates JSON
   at `backend/products/home/pricing/data/home-rates-2026.json`
   (`countryBaseLoading: { "GR": 0.2 }`), validated by
   `home-rates.schema.ts` and read through
   `lookupHomeCountryBaseLoading()` — no inline `.ts` rate literal (ADR-0014).
2. **Application (compound).** `calculateHomePremium` applies the country
   loading to the base premium FIRST to form the Greek premium
   (`countryLoadedBase = basePremium × 1.20`); every risk loading (island,
   wildfire, claims, combustible, static caravan) then compounds on top
   (`afterLoadings = countryLoadedBase × (1 + Σ risk loadings)`). Theo
   (2026-07-17) confirmed the island surcharge is *"added on top"* of the
   20%-loaded Greek premium, so for a clean Greek risk `GR = CY × 1.20` and an
   island risk `GR island = CY × 1.20 × 1.35`, not `CY × 1.55`.
3. **Absence means zero.** A country not present in `countryBaseLoading` carries
   no uplift (0), not a defaulted value (`no-defensive-fallbacks`).

## Consequences

- Greece HOME premiums now match underwriting intent (Cyprus base + 20%, with
  risk loadings compounding on top).
- A dedicated `home.loading.countryBase` calculation step surfaces the uplift in
  the audit/BO breakdown; `loadingBreakdown.countryBaseLoading` records the rate
  while `loadings` reports only the compounding risk loadings.
- Cyprus, Portugal and Spain are unaffected (no `countryBaseLoading` entry).

## Open items

- None. Island loading order confirmed compound by Theo (2026-07-17): the +35%
  island surcharge sits on top of the 20%-loaded Greek premium
  (`× 1.20 × 1.35`).

## Links

- Sister: [ADR-0050](./ADR-0050-locus-wildfire-geo-risk.md) (wildfire geo-risk)
- Source: Abbeygate underwriting email thread, Theo 2026-07-17
