---
title: ADR-0055 CV1020 sanctions limitation clause on all schedules
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-30
binding: true
---

# ADR-0055: Canonical CV1020 sanctions clause on issued schedules

## Status

Accepted.

## Context

Abbeygate (client instruction, 2026-07-30) requires every issued policy schedule
to carry the standard Lloyd's/LMA "Sanctions Limitation Clause" endorsement,
coded **CV1020**, with a single agreed wording across all products:

> "No (re)insurer shall be deemed to provide cover and no (re)insurer shall be
> liable to pay any claim or provide any benefit hereunder to the extent that the
> provision of such cover, payment of such claim or provision of such benefit
> would expose that (re)insurer to any sanction, prohibition or restriction under
> United Nations resolutions or the trade or economic sanctions, laws or
> regulations of the European Union, United Kingdom or United States of America."

This supersedes the older motor-only exclusion **CV 1028** ("Economic and Trade
Sanctions Exclusion"), which the Motor MBE catalog (`endorsementTemplates.ts`)
carries as a `document_template: cv1028.html` endorsement in the core group, so
it currently prints on motor schedules. Home, Travel and Health had no
standalone sanctions endorsement on their schedules at all.

## Decision

1. **One canonical source.** `backend/products/shared/documents/sanctionsClause.ts`
   owns the CV1020 code, title and clause text (`CV1020_SANCTIONS_CLAUSE`,
   `CV1020_HEADING_LINE`). Motor, Home, Travel and Health schedule view-models
   import it; no product re-declares the wording (`contract-spine`). The four
   schedules therefore print byte-identical sanctions text.

2. **CV1020 supersedes CV1028 on schedules.** The same module exports
   `SUPERSEDED_SANCTIONS_CODES = ['CV1028']` and `isSupersededSanctionsCode()`.
   The Motor schedule view-model drops any applied superseded sanctions
   endorsement from the projection before inserting CV1020, so a motor schedule
   never prints two competing sanctions clauses.

3. **Catalog retention, not deletion.** The legacy `CV 1028` MBE template stays
   in `endorsementTemplates.ts` for historical/BDX and prior-policy lookups. Its
   removal from the applied core set and from coverage-selection contracts is a
   separate follow-up; this ADR governs the *schedule projection* only.

4. **Version bump for cache/audit.** The four schedule `assetVersion`s (and the
   motor endorsement-schedule) advance to `*:v3-cv1020-sanctions`
   (`motor-endorsement-schedule:v2-cv1020-sanctions`) so regenerated packs are
   distinguishable from prior issuances.

## Consequences

- Every newly issued schedule across all products shows CV1020 with the agreed
  wording; motor no longer shows CV 1028.
- Previously issued PDFs are unchanged (immutable); the version bump marks the
  new content for any regeneration or diffing.
- A shared cross-product document abstraction now exists under
  `backend/products/shared/documents/`; new products must reuse it rather than
  re-stating sanctions wording.

## Alternatives considered and rejected

- **Edit the CV 1028 MBE template code/text in place.** Rejected: `code` is
  referenced by historical BDX rows, binder-authority and coverage-selection
  contract tests; renaming it would break prior-policy lookups
  (`no-defensive-fallbacks` / auditability).
- **Per-product copies of the clause text.** Rejected: four drifting copies of a
  legally exact clause violates `contract-spine`.
- **Filter CV 1028 in each product view-model.** Unnecessary: only Motor sources
  it from the MBE catalog; the shared helper still centralises the code list.

## Links

- Canonical clause: `backend/products/shared/documents/sanctionsClause.ts`.
- Schedule view-models: `backend/products/{motor,home,travel,health}/documents/viewModel.ts`.
- Legacy template: `backend/modules/mbe/domain/endorsementTemplates.ts` (`tmpl-cv1028`).
- Source: Abbeygate client instruction, 2026-07-30.
