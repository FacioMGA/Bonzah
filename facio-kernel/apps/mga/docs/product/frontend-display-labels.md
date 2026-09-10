---
title: Frontend display labels
audience: developer
status: reference
owner: platform-eng
reviewed: 2026-05-04
binding: false
supersedes:
  - docs/architecture/FRONTEND_DISPLAY_LABELS.md
---

# Frontend display labels

Use centralized label metadata or shared display helpers whenever
internal enums, slugs, or codes need to be shown in UI.

## Rules

- Questionnaire fields with fixed options belong in the questionnaire
  contract as `{ value, label }` entries.
- UI components should render contract labels, not hardcoded
  per-component maps.
- Non-questionnaire lifecycle / status codes belong in shared
  model-level helpers such as `policyDisplayLabels` and
  `claimDisplayLabels`.
- Filters, chips, tables, cards, and client / BO pages should all
  consume the same helper so raw values like `AWAITING_PAYMENT` or
  `minor_offence_10` never leak into the UI.

## Examples

- `convictionClass` and `majorConvictionWithinYears` are owned by the
  questionnaire contract metadata.
- Policy statuses are owned by
  `frontend/src/products/policies/model/policyDisplayLabels.ts`.
- Policy document, payment, provider, invoice, and reconciliation
  labels are also owned by `policyDisplayLabels.ts`.
- Claim statuses / codes are owned by
  `frontend/src/products/claims/model/claimDisplayLabels.ts`.
