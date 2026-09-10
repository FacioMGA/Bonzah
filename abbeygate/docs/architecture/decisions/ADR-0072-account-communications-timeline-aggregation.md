---
title: ADR-0072 Account Communications timeline aggregates child threads
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-14
binding: true
---

# ADR-0072: Account Communications timeline aggregates child policy/claim threads

## Status

Accepted. Refines the communications timeline read (`getCommunicationTimeline`
in `backend/modules/communications/app/queries/timelineProjections.ts`) and the
`CommunicationTimelineItem` wire shape. Does not change any endpoint route.

## Context

Issued-policy confirmation emails (and most policy/claim communications) are
written to the `POLICY` / `CLAIM` thread. The BO account Communications tab read
only the `ACCOUNT` thread, so Danny's first issued policy showed an empty tab
even though the confirmation email had been sent (Danny / Peter, 2026-08-14).
Cross-context aggregation already existed for summaries
(`crossContextIntelligence.ts`) but the detailed timeline did not use it.

## Decision

### 1. Aggregate child threads for an ACCOUNT view

`resolveTimelineScope('ACCOUNT', id)` unions the account's own thread with the
threads of its child policies and their claims. Policy/claim lookups go through
`tenantScopedPrisma` (RLS, fail-closed) — never the bare client — so a foreign
`accountId` cannot pull another tenant's entities into the thread-less
`communicationThread` OR query. Every non-ACCOUNT entity reads only its own
thread, exactly as before.

### 2. Wire shape: `sourceLabel`

`CommunicationTimelineItem` gains an optional `sourceLabel` (e.g.
`Policy BZ/CY5000001`, `Claim CLM-...`). It is present only on aggregated views
and is rendered as a small badge in `TimelineEventCard`. Absent on single-entity
views. Additive and backwards-compatible.

### 3. Bounds

- DB fan-out is bounded: at most `ACCOUNT_TIMELINE_POLICY_CAP` (200) most-recent
  policies (`orderBy createdAt desc`) and `ACCOUNT_TIMELINE_CLAIM_CAP` (200)
  most-recent claims (`orderBy firstNotifiedAt desc` — Claim has no `createdAt`).
- Response is bounded: an aggregated view returns at most
  `ACCOUNT_TIMELINE_ITEM_CAP` (500) most-recent items.

## Forbidden

- Reading child policy/claim scope with the bare `prisma` client (bypasses RLS —
  `guard:no-bare-prisma-on-tenant-scoped-models`).
- Re-deriving `sourceLabel` client-side; the server is the source.
- Returning an unbounded aggregated page (keep the item cap).

## Follow-up

- Full server-side cursor pagination of the timeline (out of scope here; the caps
  above bound both fan-out and payload in the interim).

## Links

- ADR-0056 — BDX import identity (why a placeholder account can hold many policies)
- `backend/modules/communications/app/queries/timelineProjections.ts` — owner of the read
- `frontend/src/modules/communications/model/types.ts` — `CommunicationTimelineItem`
