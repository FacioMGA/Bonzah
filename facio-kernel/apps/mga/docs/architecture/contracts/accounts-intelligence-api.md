---
title: Accounts intelligence API contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Accounts intelligence API — binding contract

## Governs
Read-only projection-backed account intelligence:
- `GET /api/accounts/intelligence`
- `GET /api/accounts/:id/intelligence`

## Allowed
- Read the projection payload from the two endpoints above.
- Customer materialization writes MUST refresh account projections after commit so BO has read-after-write visibility.
- Client notes: `GET/POST /api/accounts360/:id/notes` (`accounts.notes.view` / `accounts.notes.create`) — staff-shared ACCOUNT-thread notes, not customer-visible.
- Filter / sort via `cursor`, `limit ≤ 100`, `search` (matches `accountName`, `secondaryIdentity`, `searchTerms` — phone, policy number, registration), `sortField` ∈ {`state`,`lastActivityAt`,`totalPremium`,`accountName`} (default `state`), `sortDir` (default `asc`).
- Cursor pagination using returned `nextCursor`. Cursor ordering MUST include `accountId` as tiebreaker.
- `state` priority order: 1 `PAYMENT_ISSUE` → 2 `CLAIM` → 3 `RENEWAL` → 4 `HEALTHY`.

## Forbidden
- Confusing `Account.id` (tenant account) with intelligence `accountId`. Here `accountId` = `PolicyHolder.id` always.
- Re-deriving `state` in frontend clients. Server is the single source.
- Writing through these endpoints, except the explicitly allowed staff client-notes command governed by ADR-0086. Intelligence projection updates remain worker-only.

## Escalation
- **Write an ADR** to: change the `state` enum or `statePriority` mapping, add a sortable field, change the cursor format, add write semantics.

## Links
- Decision: [ADR-0008](../decisions/ADR-0008-accounts360-projections-and-health-contract.md)
- Client notes write semantics: [ADR-0086](../decisions/ADR-0086-account-client-notes.md)
- Related: [events-and-projections.md](./events-and-projections.md)
- Worker recovery: [reference/runbooks-coverage.md](../../reference/runbooks-coverage.md)
