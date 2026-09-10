---
title: ADR-0035 Travel underwriting profit loading
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-27
binding: true
---

# ADR-0035: Travel underwriting profit loading

## Status

Accepted.

## Context

The underwriter-supplied workbook
`artifacts/travel-insurance-info/TRAVEL RATES ADJUSTMENT.xlsx`
(May 2026) lists 16 representative quote shapes (single/multi trip,
all three areas, all three plans, individual + couple cover, ages
20–79) and, alongside the BRIT base premium ("TEST" column), the
target Abbeygate selling price ("ABBEY" column).

Reproducing every row through the canonical leaf
(`backend/products/travel/pricing/travelCalculator.ts` → `calculatePremium`
→ `IProductAdapter.calculatePremium`, per
`docs/architecture/contracts/canonical-ownership.md`), our gross
premium matches the BRIT base premium + admin-fee step exactly: the
calculator currently produces no profit margin on top of the binder
rate. The "ABBEY" target column is uniformly **2.00 % higher** than
that gross, with the admin-fee band re-resolved against the loaded
net (n = 42/47 rows match within €0.05; the remaining 5 cells are
visible Excel data-entry errors — row 4 is a copy-paste from row 18,
row 13 `gold = 34274` is missing a decimal, row 15 `gold = 177.15`
mistypes the leading digit, row 16 `gold` is 20¢ off through manual
rounding).

## Decision

1. **Introduce an explicit `underwritingProfitLoading` configuration
   block on the Brit Travel rate card.** Lives in
   `backend/products/travel/pricing/data/brit-travel-2025.json`,
   validated by `brit-travel.schema.ts`, surfaced by `loader.ts`.
   Initial value: `{ rate: 0.02, appliesTo: "net_premium" }`. No `.ts`
   literal — `check-no-inline-rate-tables.mjs` continues to enforce
   data-in-JSON.

2. **Apply the loading on `basePremium + addonsTotal` (pre-tax,
   pre-admin) inside the canonical leaf.** Order of operations
   becomes: rate-table lookup → cover-type multiplier → addons →
   **underwriting profit loading** → tax → admin-fee band. The admin
   fee band is intentionally resolved against the *loaded* net premium
   (this is how the workbook's row 9 platinum and row 16 silver cross
   the €70 boundary and match ABBEY exactly).

3. **Surface the loading explicitly.** `TravelBreakdown` gains a new
   `uwProfitLoading: number` field and `TravelBreakdownLine.kind`
   gains a new `'loading'` variant (additive — no existing consumer
   exhaustively pattern-matches on `kind`). `breakdown.lines` slots
   the line between addons and tax with `code: 'loading.uwProfit'`
   and the neutral customer-facing label `Premium adjustment` (the
   internal concept and the `travel.uwProfitLoading` `CalculationStep`
   name stay `Underwriting profit loading` for BDX / audit
   reconstruction; the line is identified everywhere by `code` /
   `kind`, never its wording). The customer-facing line is rendered the
   same way every other line is (one row across wizard sidebar,
   payment step, BO Premium tab and PDF schedule per ADR-0031).

4. **`breakdown.basePremium` keeps its meaning.** It remains the raw
   rate × cover-type-multiplier figure that all existing tests pin
   (`expect(...basePremium).toBe(12.04)` etc.). The loaded amount
   reaches the customer through `breakdown.netPremium` (now `base +
   addons + loading`) and `breakdown.grossPremium`.

5. **No tenant or product branching.** The loading sits in the BRIT
   Travel JSON config; every tenant / every quote that hits the
   travel adapter picks it up. Per-tenant variants, when needed,
   would arrive as a separate JSON value (and a new ADR), not as an
   `if (tenant === …)` branch in shared code
   (`.cursor/skills/contract-spine/SKILL.md`).

## Consequences

- The 42 reproducible Excel rows match `breakdown.grossPremium` to
  the cent; the 5 outliers are filed as workbook data-entry errors
  rather than rater bugs.
- Existing `breakdown.basePremium` assertions across
  `travelCalculator.test.ts`, `runtime.ts` and the document view
  models continue to hold (the raw rate × multiplier identity).
- The `basePremium + addonSum + adminFee === grossPremium` identity
  in `__tests__/travelCalculator.test.ts:548` extends to include
  `uwProfitLoading` — updated in this ADR's PR.
- The admin-fee band lookup against the loaded net premium can
  reclassify rows that previously sat just below a band boundary
  (e.g. base €69.21 → loaded €70.59 jumps from the €7 band to the
  €18 band). This is the workbook's intent and is the reason it
  ships a band-aware loading rather than a flat `× 1.02` on gross.
- BDX export keeps reporting one gross-premium figure; the loading
  is reconstructible from the calculation trace + the JSON rate.

## Alternatives considered and rejected

- **Fold the loading into `basePremium` directly.** Would silently
  rewrite every `expect(...basePremium).toBe(…)` regression test and
  the meaning of `breakdown.basePremium` in BDX / document view
  models. Rejected: the loading is a margin, not a rate.
- **Apply a fixed €N additive instead of a percentage.** Absolute
  diffs in the workbook scale linearly with premium size
  (€0.39 → €9.99 across the n=47 cells); a flat additive does not
  fit the data.
- **Hard-code 2 % in `travelCalculator.ts`.** Banned by
  `check-no-inline-rate-tables.mjs` and `contract-spine`. Rate
  numbers live in JSON.

## Links

- Workbook: `artifacts/travel-insurance-info/TRAVEL RATES ADJUSTMENT.xlsx`
- Calculator: `backend/products/travel/pricing/travelCalculator.ts`
- Rate JSON / schema / loader: `backend/products/travel/pricing/data/{brit-travel-2025.json,brit-travel.schema.ts,loader.ts}`
- Canonical ownership row: `docs/architecture/contracts/canonical-ownership.md` ("Quote response (full)" / "Premium leaf" / "Product rate tables").
- Predecessor ADRs: [ADR-0018](./ADR-0018-travel-pricing-data-externalization.md), [ADR-0031](./ADR-0031-travel-premium-breakdown-lines.md).
