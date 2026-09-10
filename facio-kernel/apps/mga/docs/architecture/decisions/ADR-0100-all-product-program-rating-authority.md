---
title: ADR-0100 All-product program rating authority
audience: architect
status: draft
owner: platform-eng
reviewed: 2026-09-05
binding: true
amends:
  - ADR-0018
  - ADR-0098
---

# ADR-0100: Published program models are the runtime rating authority

## Decision

1. Every runtime-rated product uses a versioned `ProgramRatingModel` mapped to
   the active `BinderProductAuthority`; `deployed_asset` is never a runtime
   source for a program quote.
2. Product JSON datasets remain validated seed fixtures and test evidence only.
   A one-time migration materialises the currently deployed dataset into each
   active program model before a product is switched to `program_model`.
3. Each product owns its model schema and its compiled engine validates it
   before calculating. Missing, invalid, unpublished, or unmapped models fail
   explicitly; no product falls back to a file, a tenant branch, or defaults.
4. The BO publishes one complete model and explicitly maps it to the selected
   active authorities. All public, BO and API rating paths receive that same
   model through `buildQuoteResponseForProduct`.

## Consequences

- Home, Health, Travel and Motor share the program-model spine but retain
  product-owned schemas and calculation logic.
- Rate changes are auditable by model version and authority mapping.
- Runtime code contains algorithms, never insurer-, country- or program-rate
  values. Jurisdiction tax/document configuration remains its own authority.

## Links

- [Product engine authority](../contracts/product-engine-authority.md)
- [Canonical ownership](../contracts/canonical-ownership.md)
- [Motor program rating authority](./ADR-0098-program-rating-model-runtime-authority.md)
