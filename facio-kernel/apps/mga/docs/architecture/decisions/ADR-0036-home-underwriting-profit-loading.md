---
title: ADR-0036 Home underwriting profit loading
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
---

# ADR-0036: Home underwriting profit loading

## Status

Accepted.

## Context

Following ADR-0035 (Travel UW profit loading of 2 %), Peter (Abbeygate
underwriting, 2026-05-29) directed the same shape of margin to be
applied to the Home product across **every country** the binder
covers — Cyprus, Portugal, Greece, Spain and any future tenant — at
**3.4 %**. Home is priced by `calculateHomePremium`
(`backend/products/home/pricing/homeCalculator.ts`, the canonical
Premium-leaf owner per `docs/architecture/contracts/canonical-ownership.md`).

The Home calculator already carries a `loadings` aggregate — but
those are **risk loadings** applied to `basePremium` *before*
discounts (combustible construction, static caravan, previous claims,
Greek-postcode). The UW profit loading is a **margin** on the
underwritten net premium *after* loadings and discounts, before tax
and admin fee. The two concepts must stay separated so BDX, audit
and renewal analytics can read each line as the underwriter intends.

Per `contract-spine` / `no-defensive-fallbacks`, the percentage lives
in the same JSON that owns home rates (`home-rates-2026.json`), is
schema-validated, and is loaded via the same single-source loader.
No `.ts` literal, no per-tenant branch.

## Decision

1. **JSON config block.** Add `underwritingProfitLoading: { rate:
   0.034, appliesTo: "net_premium" }` to `home-rates-2026.json` —
   alongside `minPremium`, `workbook`, `rateCards`. Validated by a
   `UnderwritingProfitLoadingSchema` in `home-rates.schema.ts`
   (`rate` bounded `0–1` to fail loud if `3.4` slips in instead of
   `0.034`).

2. **Order of operations in the calculator.** The loading is
   applied **on `afterDiscounts`**, *before* the existing
   `applyHomeWorkbookTaxes` step. Sequence becomes:

   ```
   per-cover rates → basePremium
     → risk loadings (combustible, claims, postcode, caravan)
     → discounts (propertyAge, alarm, excess, over45, ncb, discretionary)
     → underwriting profit loading (3.4 %)
     → taxes (IPT / CCS / stamp duty per country) + admin fee + min-premium floor
     → grossPremium
   ```

   The taxes engine (`applyHomeWorkbookTaxes`) sees the loaded net
   and continues to apply per-country IPT and the €113 / €131 CY
   minimum-premium floor against that loaded amount. The floor still
   represents the binder's absolute minimum acceptable customer
   bill — applying the loading first cannot lift a quote below the
   floor, only above it.

3. **Surface the loading explicitly.** `HomeBreakdown` gains a
   `uwProfitLoading: number` field. The breakdown's existing
   `netPremium` continues to mean *what the tax engine saw* — i.e.
   the **loaded** net (= `afterDiscounts + uwProfitLoading`). A
   `home.uwProfitLoading` `CalculationStep` is emitted so the BO
   Premium tab, audit log and BDX reconciliation can reconstruct
   the loaded-vs-unloaded identity from the trace.

4. **No tenant branching.** Peter's directive is explicitly *all
   countries*. The loading lives at the BRIT-binder-product level
   (one JSON config), not at the tenant level. If a future
   jurisdiction needs a different rate, the answer is a new JSON
   value behind a new ADR, not an `if (tenant === …)` branch
   (`.cursor/skills/contract-spine/SKILL.md`).

5. **Existing identities preserved.** `breakdown.basePremium`,
   `loadings`, `loadingBreakdown`, `afterLoadings`, `discounts`,
   `discountBreakdown`, `afterDiscounts` keep their current meaning
   (raw rates × volumes × multiplicative discounts/loadings, no
   margin). Only `netPremium` / `grossPremium` reflect the loaded
   amount, because they are the values that flow downstream into
   BDX, the customer bill, the schedule PDF and the BO Premium tab.

## Consequences

- Customer-facing gross premium goes up by ≈3.4 % across every
  Home quote, with the per-country admin fee + IPT + €131 minimum
  floor preserved.
- Three existing CY assertions in
  `backend/products/home/pricing/__tests__/homeCalculator.test.ts`
  update to the loaded numbers (one-off, pinned in this ADR's PR).
  The qualitative tests (combustible loading still increases
  premium, Europ Assistance still > net, PT still has IPT > 0,
  CY minimum still ≥ €100) continue to hold because the loading is
  monotonic.
- BDX reporting remains a single gross-premium column; the loading
  is reconstructible from `calculationDetails.steps` + the JSON
  rate, in the same way ADR-0035 set up for Travel.
- The pattern is now consistent across products: ADR-0035 (Travel,
  2 %) and ADR-0036 (Home, 3.4 %). If/when Motor needs the same
  treatment, the canonical pattern is established.

## Alternatives considered and rejected

- **Apply the loading INSIDE the existing `loadings` aggregate.**
  Would conflate risk loadings (combustible / claims / postcode)
  with profit margin — they belong in different audit lines and
  different BDX columns.
- **Apply the loading on `basePremium` before discounts.** Would
  let the customer's NCB / property-age / alarm / excess discounts
  erode the underwriter's margin. Rejected: profit loading sits
  *outside* the customer-incentive layer, after all discounts.
- **Hard-code 3.4 % in `homeCalculator.ts`.** Banned by
  `check-no-inline-rate-tables.mjs` and `contract-spine`.
- **Per-tenant override JSON now.** Peter explicitly directed
  *all countries*. Adding the override surface today would be
  speculation per `no-defensive-fallbacks`.

## Links

- Authority: Peter (Abbeygate underwriting) 2026-05-29 — "On the
  home also all countries I noted small change I think 3.4% please."
- Calculator: `backend/products/home/pricing/homeCalculator.ts`.
- Rate JSON / schema / loader:
  `backend/products/home/pricing/data/{home-rates-2026.json,home-rates.schema.ts,loader.ts}`.
- Sibling decision (Travel, 2 %): [ADR-0035](./ADR-0035-travel-underwriting-profit-loading.md).
- Home pricing externalisation: [ADR-0014](./ADR-0014-home-pricing-data-externalization.md).
- Canonical ownership row: `docs/architecture/contracts/canonical-ownership.md`.
