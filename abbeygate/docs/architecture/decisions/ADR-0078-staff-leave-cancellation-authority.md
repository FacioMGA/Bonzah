---
title: ADR-0078 Staff leave cancellation authority
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-19
binding: true
---

# ADR-0078: Staff leave cancellation authority

## Status

Accepted.

## Context

Recorded holiday or sick leave can change, but deleting a row would erase the
operational history. Leave input and leave cancellation are distinct powers:
Andy must be able to cancel leave without gaining permission to create it.

## Decision

1. `people.leave.cancel` is separate from `people.leave.edit`.
2. The named cancellation role is assigned to Danny, Peter, and the configured
   Cyprus and Portugal Andy accounts. Missing users are never invented.
3. Cancellation is tenant-scoped, confirmation-gated, and changes the existing
   row to `CANCELLED`; it never deletes the row.
4. Every successful cancellation writes `PEOPLE.LEAVE.CANCELLED` against the
   `STAFF_ABSENCE`, including actor id/name and the previous status and dates.
5. Production verification must use an explicitly approved test absence; a
   genuine absence must never be cancelled solely for testing.

## Consequences

- Cancelled leave disappears from active calendar views but remains traceable.
- Andy gains cancellation authority only; leave creation remains Danny/Peter.
- Operator identity is available from the canonical audit trail.
