---
title: ADR-0031 Travel premium breakdown lines — one canonical breakdown for every surface
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-25
binding: true
---

# ADR-0031: Travel premium breakdown lines — one canonical breakdown for every surface

## Status

Accepted.

## Context

The customer-reported defect [ABY-264](https://linear.app/faciomga/issue/ABY-264)
exposed a multi-surface drift in how the Travel premium breakdown was
displayed:

- **Wizard sidebar (Steps 4 / 5 / 6).** Showed only `planPrice` (the
  no-addon gross — which already had admin fee baked into it per the
  earlier ABY-246 decision) plus per-addon rows. Admin fee was
  intentionally invisible, hidden inside `planPrice`. Customers
  reconciling the numbers in their head added the admin fee on top
  and concluded the total looked "wrong" — even though the math was
  internally consistent.
- **Payment step order summary.** Decomposed the same total into
  `Base premium / addon lines / IPT / Admin fee`, picking the labels
  from `frontend/src/products/travel/wizard/travelAddons.ts` and
  munging them through `formatTravelAddonCoverLabel` ("Business Cover"
  vs "Wedding cover"). Used `breakdown.basePremium`, `iptAmount`,
  `adminFee` directly.
- **BO Premium tab.** Used `usePremiumController`'s `feeSteps`
  (`endorsement.premium.*` step IDs only). Travel's calculator emits
  `travel.addon.<flag>` steps with the engineer-y name
  `"Add-on: businessCover"`, so the BO Premium tab silently dropped
  every Travel addon line and rendered only an "Addons total" row.
  The customer Effie reported this as *"the BO's lack of breakdown of
  the extras (do not exists)"* on ABY-264.
- **PDF schedule.** Read a local `ADDON_LABELS` map in
  `backend/products/travel/documents/viewModel.ts` (a third copy of
  the label table; the wizard had its own, the endorsement templates
  had a fourth). Showed `Net premium / IPT / Admin fee / Total` with
  no per-addon detail.

Four surfaces, four label sources, two different breakdown shapes,
one admin-fee row only visible on one of them. Per the canonical
ownership principle (ADR-0011), the system already accepted that one
concept has one owner — but the *display* of a premium breakdown had
silently grown four shadows.

The client (Peter / Effie) confirmed that surfacing admin fee only on
the payment step was the root cause of the customer-facing
confusion: customers wanted to see the same `base → addons →
admin fee → total` decomposition on every step (including the
sidebar), and on the BO operator's screen, and on the PDF schedule.
Showing the admin fee on only one surface and hiding it inside an
opaque "Plan price" elsewhere is a UX failure the previous ABY-246
decision underestimated.

## Decision

1. **Canonical addon catalogue lives in `packages/products`.** A new
   module `packages/products/src/travel/addons.ts` exports
   `TRAVEL_ADDON_CATALOG` (the ordered `{ key, label, endorsementCode }`
   entries) plus `getTravelAddonLabel(key)` and
   `travelAddonKeyFromEndorsementCode(code)`. This is the single
   source of truth for every surface that names a Travel add-on.
   Per-surface label maps in `documents/viewModel.ts`, in
   `frontend/.../travelAddons.ts`, in the endorsement template
   titles, and inside the calculator's step names are deleted or
   rewritten to consume this catalogue.

2. **Canonical breakdown lines live on the calculator output.** The
   Travel rate engine (`backend/products/travel/pricing/travelCalculator.ts`)
   gains a `lines: TravelBreakdownLine[]` field on `TravelBreakdown`.
   The lines are pre-ordered:

   ```
   base → addon (catalogue order) → tax → fee → total
   ```

   Zero-amount lines are omitted. Each line carries `code` (stable
   machine identifier), `label` (customer-facing string from the
   canonical addon catalogue), `amount` and `kind`. Calculator
   `calculationTrace.steps[].name` adopts the same canonical
   labels — *"Add-on: businessCover"* is gone.

3. **Every display surface reads `breakdown.lines`, period.** No
   re-derivation, no per-surface filtering by ID prefix, no
   reconstruction from `basePremium + addonBreakdown + adminFee`.
   The consumers updated under this ADR are:
   - `frontend/src/products/travel/wizard/components/TravelQuoteSidebar.tsx`
     (Steps 4 / 5 / 6).
   - `frontend/src/products/travel/wizard/TravelQuoteWizard.tsx`
     (`paymentSummary` for the wizard PaymentStep).
   - `frontend/src/modules/policies/premium/views/PremiumTab.tsx`
     (`IssuedPremiumSummary`) and
     `frontend/src/modules/policies/premium/renderers/PremiumPricingBreakdown.tsx`
     (active / draft policy BO Premium tab) — both prefer
     `breakdown.lines` and fall back to the legacy flat shape only
     for products that don't emit `lines` yet (motor, home).
   - `backend/products/travel/documents/viewModel.ts` exposes
     `premiumSummary.lines` so the schedule template can render the
     same breakdown.

4. **Admin fee is shown explicitly on every surface.** This intentionally
   reverses the narrower ABY-246 decision that pinned admin fee
   inside the wizard's "Plan price" line. The wizard sidebar across
   all steps, the payment step, the BO Premium tab and the PDF
   schedule now all render the dedicated `fee.admin` line.

5. **Motor and Home are not migrated in this ADR.** Their
   calculators still emit `endorsement.premium.*` steps; the BO
   Premium tab falls back to the legacy flat projection for them.
   When their calculators adopt `breakdown.lines`, this ADR's
   per-surface consumers light up for them automatically with no
   further changes.

## Consequences

- Customers and operators see one consistent breakdown on every
  Travel surface — addressing the ABY-264 root cause.
- The four duplicate addon-label tables collapse to one shared
  module. Adding a Travel addon becomes a single edit instead of
  four edits across three packages.
- The wizard payment summary no longer needs `formatTravelAddonCoverLabel`
  (kept for back-compat tests only).
- A regression test in `backend/products/travel/pricing/__tests__/travelCalculator.test.ts`
  pins both the ordering of `breakdown.lines` and the absence of the
  old `"Add-on: …"` names.
- An entry in `productionContract.test.ts` already enforces the
  ABY-263 failure-zone rules; a sibling entry can be added if a
  later ADR mandates equivalent enforcement here.

## Links

- ABY-264 (Linear), ABY-246 (predecessor decision now superseded for
  this surface).
- [docs/architecture/contracts/canonical-ownership.md](../contracts/canonical-ownership.md)
  — "Quote response (full)" row updated to reference this ADR.
- [ADR-0011](./ADR-0011-policy-state-and-compliance-canonical-placement.md)
  — canonical-ownership principle.
- [ADR-0018](./ADR-0018-travel-rate-tables-and-no-neighbour-band-fallback.md)
  — Travel rate-table contract.
