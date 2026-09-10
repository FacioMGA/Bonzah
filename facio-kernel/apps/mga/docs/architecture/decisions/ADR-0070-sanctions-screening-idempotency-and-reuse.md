---
title: ADR-0070 Sanctions screening idempotency and paid-check reuse
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-12
binding: true
---

# ADR-0070: Sanctions screening idempotency and paid-check reuse

## Status

Accepted. Amends [ADR-0043](./ADR-0043-sanctions-screening-canonical-spine.md)
and [ADR-0067](./ADR-0067-screening-on-bind-not-quote.md). The gate placement
(checkout / bind / issue, fail-closed) and every other spine rule stay binding;
this ADR only changes how a paid Creditsafe result is deduplicated and reused.

## Context

ADR-0067 screens at `PAYMENT_CHECKOUT`, `POLICY_BIND`, `POLICY_ISSUE` and their
variants. Each gate called `SanctionsService.run` with `idempotencyKey` derived
from the per-request `correlationId`. That value changes on every Proceed click,
every issuance-heal retry and every gate, so the dedup lookup never matched:
each click/retry/gate paid Creditsafe for a fresh search. The business target
(Uriel P0, Aug 2026) is "approximately one paid sanctions check per purchasing
customer/policy", and repeated clicks must not create duplicate paid checks.

## Decision

1. **The service owns one stable, subject-scoped dedup key.**
   `deriveSanctionsSubjectKey({subjectName, dateOfBirth, at})`
   (`backend/modules/compliance/domain/sanctionsIdempotency.ts`) hashes the
   insured identity and is INDEPENDENT of action type and correlation id. Gates
   no longer pass an `idempotencyKey`; the service derives it. A different
   insured yields a different key and is screened afresh. The key also carries a
   coarse reuse-window BUCKET (`floor(now / window)`) so that once the window
   rolls over the key changes — a post-window re-screen writes a fresh row
   instead of colliding with the expired row on the unique constraint.

2. **Reuse a recent terminal result across gates and retries.**
   `SanctionScreeningRepository.findReusableScreening` returns the most recent
   run for the same policy + subject key whose outcome is terminal
   (`clear`, `non_blocking_hit`, `possible_match`, `match`) and newer than
   `SCREENING_REUSE_WINDOW_MS` (24h). A clear at checkout is reused at bind and
   issue; a match keeps the customer in referral — with no new paid check.

3. **Never cache a transient failure.** `provider_unavailable` / `error` runs
   are persisted for audit WITHOUT the stable key, so a retry after the provider
   recovers re-screens instead of being pinned to the outage. Fail-closed
   blocking at the gate is unchanged.

4. **Concurrency.** Concurrent screenings for the same policy + subject are
   collapsed onto ONE provider call in-process by a single-flight map, so a
   genuine double click (or a gate + heal firing together) pays once before the
   DB is even touched. The `@@unique([provider, policyId, actionType,
   idempotencyKey])` constraint is the cross-process backstop: a racing insert
   from another pod fails P2002 and the loser adopts the winning row. Residual:
   two pods screening the same subject in the same sub-second window can each pay
   once before either row lands — bounded and rare, consistent with the
   "approximately one" target; a cross-process reservation is deferred until
   provider-side idempotency is available.

## Consequences

- One purchasing customer/policy incurs ~one paid Creditsafe search per 24h,
  down from one-per-click-per-gate. Retries and heals are free.
- No schema change: reuse rides the existing `idempotencyKey` column/constraint.
- Reuse spans action types by design, so a gate may proceed on another gate's
  recent decision; the reused run id is logged (`sanctions.screening.reused`).

## Forbidden

- Re-deriving the dedup key from `correlationId` or any per-request value.
- Reusing or caching a `provider_unavailable` / `error` outcome.
- Widening the reuse window without re-checking CDD freshness expectations.

## Links

- Amends: [ADR-0043](./ADR-0043-sanctions-screening-canonical-spine.md),
  [ADR-0067](./ADR-0067-screening-on-bind-not-quote.md)
- Re-enablement runbook: `docs/operate/creditsafe-live-cutover.md`
- Skill: `.cursor/skills/lloyds-coverholder-compliance/SKILL.md`
