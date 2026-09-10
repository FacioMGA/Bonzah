---
title: ADR-0042 Home emergency assistance is bundled by default in CY/GR
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-29
binding: true
---

# ADR-0042: Home Emergency Assistance is bundled by default in CY/GR

## Status

Accepted. Closes ABY-300 (peter@abbeygate.cy on /quote/.../home/your-quote:
"Does this price include the 12 euros for Home assistance policy I think
you need to add that on?").

## Context

Two parallel canonical owners disagreed on whether the €12 Home
Emergency Assistance fee is part of the standard HOME quote:

- **Endorsement template** (`backend/products/home/endorsementTemplates.ts`):
  `HOME-EUROP-ASSISTANCE` carries `option_defaults: { enabledByDefault:
  true }` and `jurisdiction: ['CY', 'GR']`. The MBE pipeline applies it
  by default for any HOME policy on those tenants. The BO Premium tab
  shows it; the schedule PDF renders it; the operator can detach it.
- **Public quote calculator** (`backend/products/home/pricing/homeCalculator.ts`):
  the rate engine consumed `input.europAssistance` directly as a
  boolean flag. The wizard never sets that flag (no UI surface), so
  `input.europAssistance` is always `undefined` on the public path,
  and the engine produced quotes WITHOUT the €12 line.

The result: BO-issued HOME policies included the €12; customer-facing
wizard quotes for the same risk did NOT — the same policy quoted two
different prices depending on which surface produced the quote. peter@
caught it on a CY HOME quote where the wizard premium was €12 short of
the BO-rated number.

## Decision

The customer-facing HOME quote calculator is brought into alignment
with the canonical endorsement template:

1. **Default `europAssistance = true` for HOME quotes on CY and GR**
   when the input does not specify the flag. Other jurisdictions
   (PT, ES) keep the default off, matching the endorsement
   template's `jurisdiction: ['CY', 'GR']` field — those binders
   do not authorise this assistance line.
2. **Explicit `europAssistance: false` on the input STILL applies**
   in CY/GR — operators can detach via the BO MBE flow without the
   calculator silently re-attaching it. (No defensive fallback over
   an explicit `false`.)
3. **Explicit `europAssistance: true` applies only in CY/GR.** PT and
   ES remain unavailable even when requested because their binders do
   not authorise the assistance line.
4. **The calculator's emitted step `home.europAssistance` is the
   single source for the quote-summary line and the PDF schedule
   line**; both surfaces already consume it. No FE wizard change
   is required.
5. **The €12 is a partner pass-through, not underwritten premium.** It
   is excluded from country/risk loadings, customer discounts,
   underwriting-profit loading, and the minimum-premium floor.
   Statutory tax still applies to the fee by jurisdiction: CY is 0 IPT;
   GR is 15% IPT. The calculator exposes it as
   `breakdown.europAssistanceFee`; `breakdown.netPremium` remains the
   loaded underwritten premium defined by ADR-0036.

## Consequences

- **Wizard customers in CY/GR** now see the €12 Europ Assistance
  Home Emergency Assistance line in the quote summary and on the
  schedule PDF, matching the BO-issued policy and the endorsement
  template.
- **Existing test fixtures** that quote HOME on CY without specifying
  `europAssistance` include the €12 as a separate fee step. The risk
  premium breakdown remains unchanged by that pass-through.
- **No data migration required.** This changes how new quotes
  rate; already-issued policies retain their snapshotted premium.
- **No commission contract change.** The existing Home tax calculation
  applies CY's 0 IPT or GR's 15% IPT to the separate fee without
  folding it into the underwritten amount.

## Refused alternatives

- **`?? true` defensive default in the calculator** without
  jurisdiction gating — would have charged ES/PT customers for an
  assistance line their binder doesn't authorise. Refused per
  `no-defensive-fallbacks`.
- **Per-tenant `if (countryCode === 'CY') …`** in shared rate
  code — exact pattern banned by `contract-spine`. Replaced by the
  jurisdiction list mirroring the endorsement template.
- **FE-only fix** (default the wizard form to send
  `europAssistance: true`) — leaves the engine's default ambiguous
  and re-introduces the same drift the moment the wizard's
  initial-state object is reset. The contract belongs in the
  calculator alongside the rate cards.
- **Move the €12 into the rate card** instead of a flat fee — would
  force country/risk loadings, customer discounts, and
  underwriting-profit loading over the assistance amount, which the
  Europ Assistance partner pass-through does not permit. The fee step
  (`kind: 'fee'`) remains separate; applicable statutory IPT still
  applies.

## Sources

- `backend/products/home/endorsementTemplates.ts` — `HOME-EUROP-ASSISTANCE`
  (canonical: enabledByDefault, jurisdiction).
- `backend/products/home/pricing/homeCalculator.ts:197-222` — rate-engine
  fee step (canonical: amount, label).
- `backend/products/home/runtime.ts:275` — MBE-derived flag.
- `backend/products/home/documents/templates/{schedule,statement-of-fact}.html`
  — schedule line.
- ADR-0019 — binder authority discipline (this fee is authorised
  per BAA jurisdiction list, not a tenant-specific override).
