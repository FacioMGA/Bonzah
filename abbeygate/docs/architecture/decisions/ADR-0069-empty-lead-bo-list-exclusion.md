---
title: ADR-0069 Empty-lead exclusion from the BO Policies list
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-11
binding: true
---

# ADR-0069: Empty-lead exclusion from the BO Policies list

## Status

Accepted. Agreed with Theo (business) and Uriel (ops): keep capturing every
quote-journey event, but keep the back-office workspace tidy by hiding stale,
contactless quote-starts from the default Policies list.

## Context

When a visitor clicks "Get a Quote", the public session handler creates a real
record immediately — motor via `createPublicAutoSession`
(`backend/products/motor/quotes/quoteSessionOps.ts`, `status: DRAFT`), other
products via `genericPublicQuoteRouter.ts` (`status: INTAKE`) — with a
placeholder holder name and no `policyholderEmail`/`policyholderPhone`, and it
is projected straight into the BO list via `PolicyListIndex`.

That capture is deliberate (full funnel tracking) and must not stop. But rows
that never gained a contactable detail and then went quiet are pure noise in the
back office: nobody can act on them, and they crowd out real work.

## Decision

1. Introduce **one** canonical definition of an "empty lead" —
   `backend/modules/policy/app/read/emptyLeadListFilter.ts`. An empty lead is a
   `PolicyListIndex` row that is ALL of: `status ∈ {DRAFT, INTAKE}`, no email AND
   no phone (null or empty), and `lastActivityAt` older than
   `EMPTY_LEAD_STALE_DAYS` (14). The list reader and any future sweep/report must
   import this module, never restate the predicate.

2. The canonical BO list reader `listPoliciesUseCase`
   (`backend/modules/policy/app/read/listPoliciesUseCase.ts`) applies
   `buildEmptyLeadExclusionWhere()` by default. `includeEmptyLeads=true` opts the
   rows back in. This is the single query owner; the exclusion is not duplicated
   in adapters, the frontend, or the filter registry.

3. **No data is mutated or deleted.** Empty leads remain first-class rows in
   `Policy` / `PolicyListIndex`, so funnel tracking, search-by-id (with the
   opt-in), and reporting are fully preserved. This is a read-time filter, not an
   archive/soft-delete — chosen over a scheduled sweep to avoid a migration and
   stay fully reversible.

## Consequences

- The default BO Policies list shows only actionable records; abandoned,
  contactless quote-starts disappear after 14 quiet days without losing history.
- A real in-progress quote is never hidden: entering an email or phone, or any
  activity within 14 days, keeps the row visible.
- Retrieval path for ops/reporting is `GET /api/policies?includeEmptyLeads=true`.
- Wire: `GET /api/policies` gains one additive optional query param,
  `includeEmptyLeads` (default false). No schema/projection change.

## Not chosen (drift rejected)

- A per-surface filter in the frontend or a `bo`-only `if` branch — the exclusion
  belongs to the single list-query owner, not to a surface.
- A second "isEmptyLead" flag written onto the projection — the predicate is
  derivable from existing indexed columns (`status`, contact, `lastActivityAt`);
  a stored flag would be a second source to keep in sync.
- A scheduled archive sweep + `archivedAt` migration — heavier and mutating; can
  be added later as a superset if ops want a durable "archived on" stamp.
