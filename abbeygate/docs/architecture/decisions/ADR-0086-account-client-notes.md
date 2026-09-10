---
title: ADR-0086 Account client notes
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
---

# ADR-0086: Account client notes

## Decision

Staff client notes use the existing Communications `ACCOUNT` thread and
`SendMessageCommand`; they do not introduce an account-notes store or delivery
channel. `GET/POST /api/accounts360/:id/notes` is the only sanctioned write
exception to the otherwise read-only Accounts360 API.

Before either operation, the service resolves `PolicyHolder.id` through
`tenantScopedPrisma`. It must reject a missing holder before touching a
communications thread, because that thread has no tenant key of its own.

## Consequences

The BO notes tab is a projection of the canonical message history. Notes remain
staff-only, permission-gated (`accounts.notes.view` / `accounts.notes.create`),
and cannot be read or appended across operating tenants.
