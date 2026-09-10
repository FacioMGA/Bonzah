---
title: ADR-0089 Home identifier collection at acceptance
audience: architect
status: living
owner: product-platform
reviewed: 2026-08-30
binding: true
---

# ADR-0089: Home identifier collection at acceptance

## Context

The Home public wizard asked for the optional passport or tax identifier
(`proposer.nif`) before a customer had seen their quote. That timing is not
required for rating, bind, or issuance, and makes the quote journey harder to
complete.

## Decision

1. The Home `ValidationProfile` and manifest are the single authority for the
   field's stage. `proposer.nif` is shown only on `acceptance`, after a quote
   is available, and remains optional.
2. Public-session autosave is draft persistence only. It must not infer that a
   customer completed a step or create an operational reminder from a displayed
   form.
3. The generic public quote router remains product-agnostic. Any future Home
   follow-up requires an explicit, product-owned submission flow and an
   independently reviewed idempotency design.

## Consequences

- Home customers can obtain and accept a quote without supplying an identifier.
- Operations collect an identifier through an explicit follow-up process, not
  from an inferred draft-state note.
- No second wizard schema, generic product branch, or silent identifier
  fallback is permitted.

## Links

- `packages/products/src/home/profile.ts`
- `packages/products/src/home/manifest.ts`
- `docs/architecture/contracts/validation.md`
