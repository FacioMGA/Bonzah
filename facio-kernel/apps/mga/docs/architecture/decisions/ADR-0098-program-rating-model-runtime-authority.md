---
title: ADR-0098 Program rating model runtime authority
audience: architect
status: draft
owner: platform-eng
reviewed: 2026-09-05
binding: true
amends:
  - ADR-0018
---

# ADR-0098: Binder-mapped rating model runtime authority

## Status

Proposed. The BO can already version and publish `ProgramRatingModel` rows, but
Motor rating still reads a deployed JSON dataset. An audit against Symphony
also showed that programme-only selection is insufficient: pricing must be
mapped to the active binder authority that owns the quote.

## Decision

1. `ProgramRatingModel` is the versioned rate-data library. A dedicated mapping
   links one active `BinderProductAuthority` to one published model for its
   product. The mapping, not an inferred programme relationship, selects the
   model used for a quote.
2. The product rating engine owns validation of its model payload. Motor accepts
   only its complete, schema-validated matrix payload; a partial BO projection
   is not a rate model.
3. Program/application orchestration resolves binder authority first, then its
   mapped active model, and passes its immutable id, version and tables to the
   product engine. The engine records the binder-authority and model identities
   in the rating trace and persisted quote workspace.
4. A missing, ambiguous, inactive or invalid mapping/model is a named
   configuration error. The runtime must not read a filesystem matrix, infer a
   country, or fall back to a previous program/version.
5. The existing JSON rate file is imported once into a complete published
   model for each active Motor Program during cutover, then remains a
   migration/test fixture only. It is not production runtime authority after
   this decision is implemented.

## Consequences

- "Publish to Live" validates the model and changes only the selected binder
  mappings in one transaction; a new quote records the exact mapping/version.
- The BO editor must preserve and expose the complete product model, rather
  than treating a display subset as the rate source.
- Production cutover imports the current deployed Motor behaviour as explicit
  program data and maps it only to the program's active linked authorities.
  Later insurer or binder changes are validated, simulated and published in
  the BO; code deployment alone never selects a model.

## Links

- [Product engine authority](../contracts/product-engine-authority.md)
- [Canonical ownership](../contracts/canonical-ownership.md)
