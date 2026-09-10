---
title: ADR-0062 Travel pre-quote contact gate
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-07
binding: true
---

# ADR-0062: Travel pre-quote contact gate

## Status

Accepted

## Context

Abbeygate needs to follow up Travel customers who receive a quote but abandon
before payment. Previously Travel collected proposer contact details only on the
post-plan "Your details" step, so an abandoned quoted session could have no
name, email, or phone.

## Decision

1. Travel quote rating requires `proposer.firstName`, `proposer.lastName`,
   `proposer.email`, and `proposer.phone`.
2. The canonical owner is `packages/products/src/travel/profile.ts`:
   `steps.trip.fields` gates the customer wizard before plans, and
   `stages.quote.fields` gates the backend rating endpoint.
3. The Travel wizard must render those contact fields before "See my plans" and
   materialize the customer contact when the draft is saved from that step.
4. Resumed or pre-existing sessions that hit quote-stage contact errors from a
   later step must route back to the trip/contact step where the fields are
   visible.

## Consequences

- Customers cannot see Travel plan prices until name, email, and phone are
  present.
- Address, declarations, additional traveller identity details, and payment
  remain later-stage requirements.
- The same profile-driven validation contract applies in the browser and at the
  public rate endpoint; no frontend-only gate or parallel backend rule is
  allowed.
