---
title: ADR-0054 Travel prior-claims loading and referral
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-23
binding: true
---

# ADR-0054: Travel prior-claims loading and referral threshold

## Status

Accepted.

## Context

Abbeygate (client instruction, 2026-07-23) requires the Travel product to ask
whether the customer has previously claimed on a travel insurance policy, and to
rate on the answer:

> "we do not ask if they have claimed previously on a travel insurance coverage.
> If yes we ask up to 500 claimed / over 500 claimed. Up to 500 → 15% load; over
> 500 → goes to refer."

This is an underwriting-appetite rule within the coverholder's delegated
authority. Travel today has no prior-claims question, no answer-driven risk
loading (only the JSON add-on `loadPercent` and the ADR-0035 underwriting profit
loading), and its referral owner is `travelUwAutomation.ts` surfaced through
`buildTravelQuoteResponse`.

## Decision

1. **New question (single source).** Add `risk.hasPreviousTravelClaim` (boolean)
   and a conditional `risk.previousTravelClaimBand` (`up_to_500` | `over_500`) to
   `packages/products/src/travel/manifest.ts` and `travelValidationProfile`
   (`profile.ts`). The band is required-when-yes via a profile refinement
   (mirrors the existing `otherNationality` conditional). No silent default: a
   missing band when the boolean is true fails validation, per
   `no-defensive-fallbacks`.

2. **15% loading (JSON-driven, band `up_to_500`).** Add a `priorClaimLoading`
   block to `brit-travel-2025.json` (`{ upTo500Rate: 0.15, appliesTo: "base_premium" }`),
   validated by `brit-travel.schema.ts`, read via `lookupPriorClaimLoading()` in
   `loader.ts`. No `.ts` rate literal (`check-no-inline-rate-tables.mjs`,
   ADR-0018). Applied inside the canonical leaf `travelCalculator.ts` as
   `claimsLoading = basePremium × 0.15`.

3. **Order of operations (compound, mirrors ADR-0052 Home).** rate-table lookup →
   cover-type multiplier → add-ons → **prior-claim loading (on base)** →
   underwriting profit loading (ADR-0035, now on `base + addons + claimsLoading`)
   → tax → admin-fee band. `breakdown.basePremium` keeps its raw meaning; the
   loading reaches the customer through `netPremium`/`grossPremium` and a
   dedicated `breakdown.lines` entry `code: 'loading.claims'`, `kind: 'loading'`,
   label "Claims history adjustment".

4. **Over €500 → referral, no auto price.** `travelUwAutomation.evaluateTravelUw`
   emits referral reason `PRIOR_TRAVEL_CLAIM_OVER_THRESHOLD` (lane `referral`)
   when band = `over_500`, and `travelCalculator` early-returns `refer: true` for
   that band. `buildTravelQuoteResponse` therefore returns `status: 'REFERRAL'`
   with `primaryOption: null` — identical wiring to the age-band `REFER` path. The
   platform does not auto-offer a price it will not stand behind.

5. **No tenant/product branching.** The rule sits in the shared Travel product
   layer (JSON + calculator + UW automation); every tenant that hits the Travel
   adapter picks it up (`contract-spine`).

## Consequences

- `TravelBreakdown` gains a `claimsLoading: number` field; `breakdown.lines`
  slots the `loading.claims` line before `loading.uwProfit`. `kind: 'loading'`
  already exists (ADR-0035) — additive, no exhaustive consumer breaks.
- `TravelQuoteData` gains a `risk` block; `toTravelPricingQuoteData` and
  `mapTravelUwInput` project it. Golden fixtures without the field price exactly
  as before (no loading, no referral).
- Manifest ↔ profile ↔ wizard stay in lock-step; the generated Travel validation
  contract is regenerated and alignment/canonical tests updated.

## Alternatives considered and rejected

- **Inline 15% in `travelCalculator.ts`.** Banned by
  `check-no-inline-rate-tables.mjs` and `contract-spine`.
- **Model as a paid add-on `loadPercent`.** Rejected: a risk loading is not a
  customer-selected coverage; it must not appear as an optional extension.
- **Over-€500 as a UW referral that still shows a price.** Rejected: the client
  intent is a human decision, so no auto price is surfaced (calculator refers).
- **Single 3-value enum instead of boolean + band.** Rejected: the client
  described a yes/no gate then an amount; the two-field shape mirrors Motor/Home.

## Links

- Source: Abbeygate client instruction, 2026-07-23.
- Calculator / JSON / loader: `backend/products/travel/pricing/{travelCalculator.ts,data/brit-travel-2025.json,data/brit-travel.schema.ts,data/loader.ts}`.
- UW referral owner: `backend/products/travel/underwriting/travelUwAutomation.ts`; surfaced by `backend/products/travel/runtime.ts`.
- Question contract: `packages/products/src/travel/{manifest.ts,profile.ts}`.
- Predecessor ADRs: [ADR-0035](./ADR-0035-travel-underwriting-profit-loading.md), [ADR-0025](./ADR-0025-travel-objective-expat-eligibility.md), [ADR-0018](./ADR-0018-travel-pricing-data-externalization.md), [ADR-0052](./ADR-0052-home-greece-country-loading.md).
