---
title: ADR-0059 Local-market nationality referral is a platform invariant
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# ADR-0059: Local-Market Nationality Referral Is a Platform Invariant

## Status

Accepted.

## Context

Abbeygate is an expat insurance broker. Same-market nationals (for example,
Cypriot nationals in Cyprus, Portuguese nationals in Portugal) are outside
online appetite. Cross-territory operating nationals are expats and may
proceed online: Peter confirmed (6 Aug 2026) that Portuguese nationals in
Cyprus and Cypriot nationals in Portugal are acceptable.

Two governance questions arose in review:

1. `product-engine-authority.md` requires engines to consume normalized
   Program/Binder authority rather than own appetite literals — should
   this rule be binder-configurable?
2. The `@facio/validation` nationality contract forbids runtime demonym /
   ISO normalization — may the matcher accept aliases like `Cypriot` / `CY`?

## Decision

1. **The rule is broker posture, not binder appetite.** Like sanctions
   screening, it applies across products and is NOT configurable per
   Program/Binder. The single canonical source is
   `matchLocalMarketNationalityReferral` in
   `packages/products/src/shared/operatingTerritoryNationality.ts`;
   product UW engines pass their risk/residence market and MUST NOT
   re-state alias lists or country pairs. Outcome is a referral (yellow
   lane), never a silent decline, so an underwriter can still write the
   risk deliberately.
2. **Alias-broad matching is deliberate defense-in-depth.** The validation
   contract governs acceptance and storage of nationality atoms (country
   names only); this matcher never accepts, normalizes, or stores a value
   — it only widens the referral lane for screening. A demonym or ISO code
   arriving from an import or legacy row still fails canonical validation
   at the boundary; failing to refer such a proposer would be the worse,
   regulatorily unacceptable outcome.

## Consequences

- Weakening, disabling, or making this rule configurable requires a new ADR.
- Adding an operating territory means one entry in the shared matcher; every
  product's same-market referral follows automatically.
- Travel/Health residence-based declines (ADR-0025) remain unchanged and
  complementary.
