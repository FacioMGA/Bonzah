---
title: ADR-0050 Locus wildfire geo-risk tier
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-13
binding: true
---

# ADR-0050: Locus wildfire geo-risk tier

## Status

Accepted for phase 1.

## Context

Peter directed HOME wildfire underwriting by Red / Amber / Yellow / Green tiers
for Portugal, Spain, Cyprus and Greece. Red must refer before quote; Amber loads
20 %; Yellow loads 10 %; Green stays standard unless ordinary HOME referral
rules fire. Uriel accepted this as Locus phase 1: start from Peter's territory
classification, then refine to precise property-location controls.

There is no existing `Locus`, geospatial, wildfire, vegetation or town-risk
module in the repo. Per `contract-spine`, this requires one canonical owner
before rating or UW code consumes it.

## Decision

1. **Canonical classifier.** `backend/products/home/underwriting/wildfireRisk.ts`
   owns `classifyWildfireRisk(input)`. It loads validated JSON reference data
   from `backend/products/home/pricing/data/wildfire-risk-tiers.json`.
2. **Phase-1 data shape.** The JSON stores country-scoped tier entries with
   normalized `names` and `keywords`. It is schema-validated by a sibling zod
   schema and loader, following the product rate-table contract.
3. **No silent Green fallback.** A property only returns `green` when it matches
   an explicit Green entry. A country with no match returns `unclassified`;
   that audit state does not, by itself, block an otherwise ordinary online
   quote in phase 1.
4. **Official source override.** For Portugal, an ICNF structural hazard value
   of `Alta` or `Muito Alta` is Red/referral regardless of broad territory match.
5. **Pricing owner remains HOME leaf.** `homeCalculator.ts` applies the matched
   loading as `home.wildfireLoading` before the existing UW profit loading:
   Amber = 0.20, Yellow = 0.10, Green = 0.00. Red and unclassified carry no
   loading; Red is referred, while unclassified remains quoteable unless another
   HOME referral rule fires.
6. **No database model yet.** Phase 1 is reference data only. A future precise
   geospatial service/table needs a follow-up ADR and migration.

## Consequences

- HOME quotes in Red wildfire territory go to referral.
- Unclassified wildfire territory remains visible in the audit breakdown but
  does not stop an otherwise ordinary quote.
- Amber and Yellow quotes show an explicit calculation step and audit trace.
- Green is only standard when the input matches Peter's Green framework.
- Address matching is intentionally conservative: exact normalized name first,
  then country-scoped keyword matches.

## Refused alternatives

- Treating any unmatched town as Green. This is a defensive fallback; unmatched
  locations must remain `unclassified` in the audit state even when quoteable.
- Hard-coding the territory list in TypeScript. Banned by the product rate-table
  contract and `check-no-inline-rate-tables.mjs`.
- Adding a Prisma town-risk model in phase 1. The email requirement can be met
  with validated product reference data; persistence belongs with the future
  precise Locus layer.
