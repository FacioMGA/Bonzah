---
title: ADR-0093 Home apartment land-area requiredness
audience: architect
status: living
owner: product-platform
reviewed: 2026-08-31
binding: true
---

# ADR-0093: Home apartment land-area requiredness

## Context

The Home issuance profile required `property.landAreaSqm` for every property,
which blocked apartment customers at payment despite apartments having no
separately-insured land.

## Decision

`property.landAreaSqm` is optional when `property.propertyType` is `Apartment`.
It remains required for Villa, Townhouse and Static Caravan at wizard, bind and
issuance validation. If supplied, it must remain a non-negative amount.

## Consequences

The shared Home profile is the sole requiredness owner; readiness and payment
consume its result. The UI only reflects that canonical verdict.

## Links

- `packages/products/src/home/profile.ts`
- `packages/products/src/home/manifest.ts`
