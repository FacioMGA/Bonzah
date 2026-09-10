---
title: ADR-0060 Motor market integrations are spec-first
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-04
binding: true
---

# ADR-0060 Motor market integrations are spec-first

## Context
Peter's BO transition baseline names two motor market integrations: Segurnet for Portugal motor and FIVA for Spain motor. Neither is implemented today, and adding live clients without confirmed credentials, payloads, consent, error semantics and operational ownership would create an unsafe external-system dependency.

## Decision
Segurnet and FIVA integration work starts with a data-requirements and API contract only. Runtime clients may be added only after the spec is confirmed by Abbeygate operations and the receiving system owner.

## Rules
- Integration clients live under the owning backend module and follow existing outbound-client patterns (`cardcorpGateway`, `creditsafeClient`, `vehicleEnrichmentService`).
- No public or BO route may call Segurnet/FIVA directly; route handlers call a module service.
- Secrets must use startup validation and never appear in tenant config, docs or fixtures.
- Every request/response must be audit logged with policy id, tenant, external reference and outcome.
- Failed submission is a recoverable operational state, not a silent skip.

## Consequences
The first deliverable is `motor-market-integrations.md`. Implementation waits for confirmed API docs, credentials, test endpoints, submission windows and production support contacts.
