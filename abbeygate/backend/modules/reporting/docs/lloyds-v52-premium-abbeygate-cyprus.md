# Lloyd's V5.2 Premium Bordereaux - Abbeygate Cyprus Motor

## 1. Purpose

This document defines the active premium export implementation for Abbeygate Cyprus Motor under Lloyd's CRS v5.2. It is the reference for engineering, operations, and audit reviews.

## 2. Scope

- Stream: premium only.
- Product context: Abbeygate Cyprus Motor.
- Market context: Lloyd's Brussels / LIC S.A.
- Reporting cadence: monthly.

## 3. Core accounting rules

- `CR0059` is the gross premium movement on the row.
- `CR0061` is commission percentage (binder-driven; current default 30).
- `CR0062 = round(CR0059 * CR0061 / 100, 2)`.
- `CR0925` is MIF surcharge fee.
- `CR0064` is stamp duty tax.
- `CR0065 = CR0059 - CR0062`.
- `CR0068 = CR0065 * CR0067`.
- Fees and taxes are sourced from billed transaction truth first; deterministic defaults apply only when explicit billed values are absent.

## 4. Transaction classification rules

- `CR0022` uses grouped Lloyd's labels:
  - New Business
  - Renewal
  - Adjustment
  - Cancellation
- `CR0056` is financial premium movement type (not workflow code):
  - Original Premium
  - Additional Premium
  - Return Premium

## 5. Key field decisions

- `CR0021`: whole-risk written premium snapshot after transaction, not row delta.
- `CR0029`: reuse policy certificate reference for premium movements unless a dedicated endorsement schedule reference is explicitly modeled.
- `CR1297`: binder-configured Lloyd's platform code (`LBS` for Abbeygate binder).
- `CR0081`: fixed-rate tax field for stamp duty.
- `CR0080`: intentionally blank for fixed-amount stamp duty (not percentage-based).
- `CR0064` and `CR0925` are separated and must never be mixed.

## 6. Validation and issue handling

- Row statuses: `valid`, `warning`, `error`.
- Preview always returns all rows with row-level issues and grouped summary.
- Final export blocks when unwaived errors exist.
- Warnings are exportable.
- `NB_EFFECTIVE_BEFORE_INCEPTION` is blocking for NB + Original Premium rows.
- `ZERO_FINANCIAL_ROW` warns when all premium monetary fields are zero on adjustment/cancellation rows.
- Zero-financial rows are visible in preview; final export default excludes them unless explicitly included via override.

## 7. Preview/export behavior

- Preview endpoint: `GET /api/bordereaux/v5.2/:stream/preview`.
- Export endpoint: `GET /api/bordereaux/v5.2/:stream`.
- Override controls (admin/system):
  - CR waivers require reason and explanation.
  - zero-row include override is audited.

## 8. Future changes to track

- Any stamp duty model change (fixed amount to percentage or rate change).
- Billing granularity upgrades for fee/tax reversals.
- Potential addition of broker/final-net accounting CR fields if business requirements expand.
