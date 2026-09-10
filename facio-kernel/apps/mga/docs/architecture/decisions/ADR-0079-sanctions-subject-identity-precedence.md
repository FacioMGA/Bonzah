---
title: ADR-0079 Sanctions subject identity precedence
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-19
binding: true
---

# ADR-0079: Sanctions subject identity precedence

## Status

Accepted. Refines the subject resolver in ADR-0043 without changing the
provider, gate placement, datasets, match threshold, or fail-closed posture.

## Context

Some migrated quotes retain obsolete top-level `firstName`, `lastName`, and
`dateOfBirth` values alongside the canonical `quoteData.proposer.*` identity.
Reading the flat values first caused screening to run for a stale draft person
while BO displayed the current policyholder (ABY-403).

## Decision

Screening name precedence is:

1. canonical `quoteData.proposer.{firstName,lastName}`;
2. saved `policyHolderName` at the bind/payment/issue boundary;
3. obsolete flat quote identity, only for legacy rows lacking both above.

System placeholder candidates are discarded before applying this precedence,
so a placeholder cannot shadow a lower-priority real identity.

DOB must follow the selected identity source. Canonical proposer screening may
use `proposer.dateOfBirth` or Travel's `travellers.leadTravellerDOB`; stale flat
DOB must not override either. Legacy flat DOB remains a last-resort companion
only for a legacy flat name. Placeholder rejection and every ADR-0043/0067/0070
gate and reuse rule remain unchanged.

## Consequences

- BO policyholder identity and the Creditsafe search subject cannot diverge
  because an obsolete flat field wins precedence.
- Legacy flat-only policies remain screenable.
- Existing audit rows are immutable; a later gate re-screens under the stable
  key rules when the resolved subject changes.

## Forbidden

- Reading flat quote identity before canonical proposer or saved policyholder.
- Combining a canonical name with an unrelated legacy flat DOB.
- Repairing historical screening evidence in place.

## Links

- [ADR-0043](./ADR-0043-sanctions-screening-canonical-spine.md)
- [ADR-0067](./ADR-0067-screening-on-bind-not-quote.md)
- [ADR-0070](./ADR-0070-sanctions-screening-idempotency-and-reuse.md)
