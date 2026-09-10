---
title: ADR-0092 Facio customer-reference sequence
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-31
binding: true
---

# ADR-0092: Facio customer-reference sequence

## Context

New Facio customer references must use the 5,000,000 range consistently in
Cyprus, Portugal and Greece. The platform previously applied that floor to
Portugal only, leaving CY/GR default and Motor quote references in the
1,000,000 range.

## Decision

1. New Facio quote and newly issued policy identifiers in CY, PT and GR start
   at `5000001` (or the product's existing higher 5,000,000-range start).
2. The default platform sequence and Motor's Facio quote sequence apply the
   floor. Existing customer references, imported rows and renewal-family
   references remain unchanged.
3. Renewal terms retain their existing policy reference and advance
   `renewalSequence`; this ADR does not introduce retroactive renumbering.

## Consequences

- `ABQ/CY1000833` remains a valid historical quote reference.
- Back-office policy search accepts the original quote reference after
  issuance and normalizes it to the canonical uppercase stored value.
- Future CY/PT/GR Facio quotes and online-issued policies use a 5-prefixed
  sequence without changing their documented formats.

## Links

- `backend/platform/utils/platformIds.ts`
- `backend/platform/utils/policyNumberScheme.ts`
- ADR-0034, ADR-0047 and ADR-0061
