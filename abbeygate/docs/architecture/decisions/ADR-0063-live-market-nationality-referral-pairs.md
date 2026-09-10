---
title: ADR-0063 Live-market nationality referral pairs
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-07
binding: true
---

# ADR-0063: Live-Market Nationality Referral Pairs

## Status

Accepted. Amends ADR-0059.

## Context

ADR-0059 made same-market operating-territory nationals a referral because
Abbeygate is an expat broker. Peter clarified on 7 Aug 2026 that Greek
nationals living in Cyprus are good expats, and that the live referral pairs are
only Cypriot/Cyprus, Portuguese/Portugal, and Greek/Greece.

## Decision

`matchLocalMarketNationalityReferral` remains the canonical owner. It refers
only CY/CY, PT/PT, and GR/GR. Cross-market nationals, non-operating-market
residents, and Spanish/Italian same-market pairs are allowed by this rule unless
another product-specific gate catches them.

Product UW engines must keep passing their risk/residence market to the shared
matcher and must not restate country pairs locally.

## Consequences

- Greek nationals resident in Cyprus may proceed online.
- Spanish and Italian aliases may remain recognised operating-territory aliases,
  but do not create a local-market referral pair.
- Expanding or shrinking the referral-pair set requires another ADR amendment.
