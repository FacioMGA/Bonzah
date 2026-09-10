---
title: ADR-0095 Motor identifier collection at acceptance
audience: architect
status: living
owner: product-platform
reviewed: 2026-09-04
binding: true
---

# ADR-0095: Motor identifier collection at acceptance

## Context

The Motor quote journey exposed NIF and vehicle registration before a
customer had obtained a quote. Neither value is a rating input. Portugal
requires a NIF before the policy is arranged, while every Motor market needs
either a registration number or VIN before issuance. A VIN remains an
optional pre-quote vehicle-lookup input; it is not a registration number.

## Decision

1. Motor collects neither NIF nor registration number in the public quote
   steps. Country of registration remains a quote-time rating input, and the
   existing optional VIN lookup remains available.
2. The existing post-quote `issue-details` stage is the sole customer path for
   NIF and registration collection. NIF is mandatory at issuance; one of a
   registration number or VIN is mandatory at issuance.
3. The Motor validation profile and issuance refinement remain the canonical
   owners. Public UI and BO projections consume that contract and do not add
   their own requiredness rules.
4. Motor draft PATCH uses ordinary nested merge semantics: an explicit leaf
   reset remains a reset. The sole exception is a known blank
   `proposer.dateOfBirth` autosave default from a non-`policy-holder` step;
   only that stale default preserves a previously entered date. The
   `policy-holder` step remains the explicit owner of changing or clearing it.

## Consequences

- Customers can receive a Motor quote without identifiers they may not yet
  know.
- A policy cannot progress to payment/issuance without NIF and one vehicle
  identifier.
- No product-agnostic router, duplicate form, or fallback identifier path is
  introduced.
- Vehicle-field resets and deliberate policy-holder DOB changes remain
  possible while later-step autosaves cannot erase the accepted DOB.

## Links

- `packages/products/src/motor/profile.ts`
- `packages/products/src/motor/schemas/index.ts`
- `frontend/src/products/motor/wizard/components/steps/Step5IssueDetails.tsx`
