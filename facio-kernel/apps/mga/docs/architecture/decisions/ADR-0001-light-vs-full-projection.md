---
title: ADR-0001 LIGHT vs FULL projection
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

## ADR-0001: Split public session projection (LIGHT vs FULL)

### Status
Accepted

### Context
Public auto quote session resolution previously fetched heavy JSON fields (`quoteData`, `quoteResponse`, `vehicleInfo`, `driverInfo`) on every request, even for endpoints that only needed lock/payment/status metadata.

### Decision
Introduce two projections in `backend/modules/quotes/app/publicAutoQuote/publicSession.ts`:
- `POLICY_SELECT_LIGHT` + `resolvePublicAutoPolicyLight()` for hot-path reads
- `POLICY_SELECT_FULL` + `resolvePublicAutoPolicyFull()` for endpoints that must return the full session payload

### Consequences
- Significant reduction in DB load, network transfer, and JSON parsing/GC.
- Requires endpoint owners to choose the correct resolver.
