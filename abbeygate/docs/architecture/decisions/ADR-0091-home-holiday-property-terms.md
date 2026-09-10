---
title: ADR-0091 Home holiday-property terms
audience: architect
status: living
owner: product-platform
reviewed: 2026-08-30
binding: true
---

# ADR-0091: Home holiday-property terms

## Context

The Home schedule projected the selected increased excess only for contents,
and omitted the AB105 unoccupied-property inspection condition for holiday
homes. Both terms are selected from the canonical Home risk classification.

## Decision

1. `risk.increasedExcess` is the one Home excess choice. Its selected amount
   prints for Buildings and Contents; rate discount semantics do not change.
2. A Home risk is a holiday home when `usage.permanentHome === false`. Every
   such schedule includes AB105, requiring a key holder inspection at least
   every 14 days and immediate disclosure of discovered loss or damage.
3. The document model is the policy-term projection owner. The public wizard
   and rating adapter retain their existing field ownership and lifecycle.

## Consequences

- No product-specific frontend gate or duplicate holiday classifier is added.
- AB105 is issued only where the stored policy risk is a holiday home.

## Links

- `backend/products/home/policyTerms.ts`
- `backend/products/home/documents/viewModel.ts`
