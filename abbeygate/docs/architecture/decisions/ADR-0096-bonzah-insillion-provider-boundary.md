---
title: ADR 0096 Bonzah Insillion provider boundary
audience: architect
status: living
owner: product-platform
reviewed: 2026-09-08
binding: true
---

# ADR-0096: Bonzah Insillion provider boundary

## Context

The Bonzah GitHub repository publishes a flat Insillion API contract that
differs from Facio's stable partner facade. Production-shaped staging needs
provider premiums, quote finalization, payment, policy reads and documents
without leaking the inconsistent provider schema into partner clients.

## Decision

Keep Facio routes and canonical rental types. A Bonzah-owned infrastructure
client authenticates to Insillion, caches short-lived tokens and master data,
and owns all provider wire mappings. Application orchestration selects explicit
`simulation` or `insillion` mode. Insillion premiums and identifiers are
authoritative only in Insillion mode; synthetic rating is never combined with
them.

Retry authentication and safe reads once after 401. Never blindly retry quote
finalization or payment. A timeout or transport loss after either mutation is
an ambiguous outcome requiring reconciliation. Documents are proxied through
the authenticated partner boundary; provider tokens are never returned.

## Consequences

Existing partner endpoints remain compatible and gain additive execution-mode,
provider-reference and document fields. The provisional provider spelling
`licence_no` is isolated in one mapper. Endorsements remain disabled pending
Bonzah confirmation. Insillion mode is staging-only until its operation state
and idempotency records use a durable tenant-scoped repository.
