---
title: ADR-0083 Guarded wizard URL mutation
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
---

# ADR-0083: Guarded wizard URL mutation

## Status

Accepted.

## Context

Public quote wizards, payment return handling and BO billing synchronise URL
state. Repeated React effects previously called `history.replaceState` even
when the URL was unchanged, which browsers eventually reject with a
`SecurityError` after excessive writes.

## Decision

`frontend/src/shared/lib/wizard/utils/replaceWizardUrl.ts` is the sole owner
of guarded wizard URL mutation. It compares the current and proposed
pathname/search/hash before calling `history.replaceState`, and exposes the
only approved helpers for step updates and payment-parameter removal.

Product wizards and BO billing remain consumers: they supply their step or
parameter intent but do not call `history.replaceState` directly.

## Consequences

- The same browser safety boundary applies to all existing quote products,
  shared payment handling and BO billing.
- Existing `history.state` is passed explicitly by callers that need it; the
  helper does not derive product or payment state.
- Regression tests pin both the no-op and changed-URL paths.

## Forbidden

- Direct `history.replaceState` calls in product wizards, payment UI or BO
  billing for wizard URL synchronisation.
- Product-specific copies of the no-op comparison.
