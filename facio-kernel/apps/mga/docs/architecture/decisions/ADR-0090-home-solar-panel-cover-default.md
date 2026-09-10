---
title: ADR-0090 Home solar-panel cover default
audience: architect
status: living
owner: product-platform
reviewed: 2026-08-30
binding: true
---

# ADR-0090: Home solar-panel cover default

## Context

Home solar-panel cover was optional and began at zero. This permitted a Home
quote and its schedule to omit solar cover when the customer had not manually
selected it.

## Decision

1. Cyprus and Greece Home quotes include solar-panel cover of EUR 2,000.
   The amount is a product minimum: a customer or operator may increase it,
   but cannot reduce or remove it.
2. The Home product rule is the sole authority. The public wizard normalizes
   it; Home rating and schedule projection resolve the same minimum from the
   operating tenant. Solar cover is a sum-insured, not an MBE toggle.
3. Portugal and Spain retain their current solar-cover behaviour. Existing
   issued policies retain their recorded terms; document projection applies the
   minimum only to quote responses rated by calculator version 1.4.0 or later.
   Quotes rated after rollout use the new CY/GR rule.
4. The calculator version advances because identical raw CY/GR quote data can
   now produce a different premium.

## Consequences

- A missing or lower CY/GR solar value cannot yield a €0 quote or a “Not
  Insured” schedule section.
- The generic public router, shared rating layer, and persisted issued-policy
  snapshots remain product-agnostic.

## Links

- `packages/products/src/home/solarPanelCover.ts`
- `backend/products/home/quoteDataAuthority.ts`
- `backend/products/home/documents/viewModel.ts`
