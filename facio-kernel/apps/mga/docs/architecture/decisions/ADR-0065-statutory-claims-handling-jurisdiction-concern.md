---
title: ADR-0065 Statutory claims-handling deadlines are a jurisdiction config concern
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-09
binding: true
---

# ADR-0065 Statutory claims-handling deadlines are a jurisdiction config concern

## Context
Peter Sheppard supplied Portugal's non-fault motor claims-handling timetable (DL 291/2007, claim ABB/VL/00118): working-day deadlines for first contact, inspection, inspection report, liability decision, payment and formal-complaint response, with jointly-signed-DAAA and dismantling variants. These are statutory, jurisdiction-specific, and legally interpretive, so they must be configurable and version-controlled, not scattered as `+ 2` / `+ 8` literals.

Binders already carry claims *authority* (`operations.claims.*` → referral / large-loss in `backend/modules/claims/domain/commands/shared.ts`), but PT motor rides a **mirrored CY binder** whose config is copied verbatim, including `workingDaysJurisdiction: 'CY'`. Keying statutory deadlines off the binder would silently apply the wrong (CY) jurisdiction to PT claims.

## Decision
Statutory claims-handling deadlines are a new optional concern on `JurisdictionProductConfig` (`claimsHandling`), resolved via `resolveJurisdictionProductConfig(...)` like every other jurisdiction dimension. They key off the resolved `(country, product)` config — never the binder's `workingDaysJurisdiction`. Today only `PT/MOTOR` is populated (`nonFaultMotor`); all other rows leave `claimsHandling` undefined, meaning "no encoded statutory timetable" (the Claims Desk shows no tracker).

## Rules
- `claimsHandling` is optional and additive; absence is a valid, explicit state (no fallback timetable is invented).
- All counts are WORKING days, computed by the shared engine in `backend/modules/claims/domain/statutoryTimetable.ts` using a jurisdiction-aware calendar (`businessDays.ts`).
- The public-holiday calendar is supplied data, not hard-coded. The official Portugal calendar is an OPEN input; until confirmed the calendar is weekends-only (a documented interim).
- Values are LEGAL-VERIFY: they may be displayed and diarised, but interest/penalty consequences must not be auto-asserted to third parties before legal/compliance sign-off.
- Adding a further jurisdiction/product timetable = add a `claimsHandling` block to that CONFIGS row plus golden-date tests. No core code change.
- The timetable is a **derived read-model**: recomputed on every read from the claim worksheet projection (statutory anchor = `firstNotifiedAt`; complaint clock from the `COMPLAINT_RECEIVED` event) plus the resolved config. It is never stored, so a deadline-value change needs no migration. Query: `getClaimStatutoryTimetable`; surface: `GET /api/claims/:id/statutory-timetable`; UI: Claims Desk "Deadlines" tab.

## Consequences
The claims deadline engine has one canonical source, jurisdiction-correct for mirrored binders. Extending to CY/GR/ES motor (or another regulated timetable) is a data addition. Changing the shape of `claimsHandling` or introducing a parallel deadline source requires a successor ADR. Clocks that depend on an actual event — inspection-report (actual inspection completion), payment (accepted liability + documents) and complaint-response — stay "not started" until that event is captured; they are never projected off a projected deadline. Liability/DAAA/dismantling signals are likewise surfaced as "not started" until their canonical worksheet capture points exist (follow-up phase). Deadlines are day-granular: an item is OVERDUE only once the whole due day has passed.

## Links
- Contract: [jurisdiction-product-config.md](../contracts/jurisdiction-product-config.md)
- Resolver: [`backend/modules/jurisdiction/domain/productConfiguration.ts`](../../../backend/modules/jurisdiction/domain/productConfiguration.ts)
- Engine: [`backend/modules/claims/domain/statutoryTimetable.ts`](../../../backend/modules/claims/domain/statutoryTimetable.ts)
- Read model: [`backend/modules/claims/app/queries/getClaimStatutoryTimetable.ts`](../../../backend/modules/claims/app/queries/getClaimStatutoryTimetable.ts)
- Related: [ADR-0060](./ADR-0060-motor-market-integrations-spec-first.md) · [claims-lifecycle.md](../../product/claims-lifecycle.md)
