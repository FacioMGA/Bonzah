---
title: Referral-only programs
audience: architect
status: living
owner: product-platform
reviewed: 2026-09-05
binding: true
amends:
  - ADR-0096
---

# ADR-0098: Referral-only programs

## Decision

1. A program whose metadata declares `referralOnly: true` may collect and
   retain a customer request and notify the operating jurisdiction's referral
   team. It does not represent delegated authority to bind or issue cover.
2. `evaluateIssueReadiness` is the canonical enforcement point: it emits a
   blocking `REFERRAL_ONLY_PROGRAM` result for every bind or issue surface.
   The external-issuance completion command repeats this check at its own
   boundary.
3. The public manual-referral submission may use the existing quote persistence
   spine to produce `REFERRAL`, but it presents no premium, payment or policy
   document. Payment remains disabled in product-channel configuration.

## Consequences

- Portugal Business, Marine and Immigration requests can be stored in Client
  Quotations and routed to the Portugal team while commercial authority is
  pending.
- An operator cannot turn a referral into a policy by attaching a proposal,
  payment or external document pack. A new approved program is required first.
