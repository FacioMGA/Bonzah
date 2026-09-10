---
title: ADR-0080 Home standard-letter variants
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-27
binding: true
---

# ADR-0080: Home standard-letter variants

## Status

Accepted.

## Context

Beazley Home correspondence has policy-specific disclosure needs that do not
apply to Motor, Travel, or other products. Replacing the global customer
templates would therefore send incorrect product information to those customers.

## Decision

The Communications catalog remains the single canonical renderer. It selects a
Home variant for the existing quote, new-business, renewal-invite and
renewal-chaser triggers only when the dispatch identifies `HOME`; all other
products retain the generic template. A renewal-issued Home pack selects the
renewal-confirmation variant from its canonical risk-transaction type.
Those product-conditioned registry entries are also the sole preview, coverage
and synthetic test-send inventory, so governance tests the exact dispatch path.

When the canonical Home contents sum insured is €50,000 or more, the
issued-pack flow queues the separate advisory contents-limits notice only after
the new-business or renewal confirmation has been queued. This does not change
pricing, eligibility, underwriting or issuance.

Country address and contact details remain owned by the tenant branding profile;
no letter embeds office-specific contacts.

## Consequences

- Customer correspondence stays on the existing Communications/outbox spine.
- Home-specific wording cannot leak into another product's email.
- The contents notice is independently auditable and idempotent.
