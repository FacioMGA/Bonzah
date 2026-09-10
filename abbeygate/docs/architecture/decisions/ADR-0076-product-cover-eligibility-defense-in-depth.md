---
title: ADR-0076 Product cover eligibility defense in depth
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-19
binding: true
---

# ADR-0076: Product cover eligibility defense in depth

## Status

Accepted.

## Context

Product manifests can hide an ineligible cover, but stale quote data, direct
API payloads, or resolved BO endorsements can still reintroduce it before
rating. For Home holiday risks, accidental-damage rates are unavailable and
rating such a selection can replace the base premium with zero. Silently
discarding the request would also erase underwriting evidence.

## Decision

1. Product-specific cover eligibility is declared in the product manifest and
   mirrored by the product UI.
2. The product-owned pricing projection re-enforces eligibility after all raw
   selections and resolved endorsements have been applied.
3. The underwriting projection retains the attempted raw or resolved selection
   so forbidden cover produces an explicit product-owned referral.
4. Home holiday risks exclude accidental damage and all-risks/high-risk-item
   cover from rating while retaining attempted selections for underwriting.

## Consequences

- Hidden UI state is not an authority boundary.
- BO, API, stale-client, and endorsement paths cannot bypass pricing eligibility.
- Ineligible requested cover is visible to operators instead of being silently
  priced or discarded.
