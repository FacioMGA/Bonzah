---
title: Validation runtime contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Validation runtime — binding contract

## Governs
The runtime invariants that keep quote / issuance flows deterministic and traceable across surface, backend, and worker.

## Allowed
- Canonical contract derivatives drive backend step-scoped field filtering and requiredness sets.
- Issue readiness is product-agnostic; calls registered product adapter's `validateForIssuance(quoteData)`.
- Public wizard autosave sends explicit step context on field updates (not only on navigation).
- Step 3 (`driving-history`) persists draft state before rating.
- Validation modes: rating uses `mode: 'quote'`, issuance uses `mode: 'issuance'`.
- Errors carry structured diagnostics + correlation ids. Non-prod issue-readiness diagnostics name validator source and read path.
- Patch filter telemetry: `public_auto_quote.patch_fields_filtered` logs dropped keys per step.
- MagicB DB rules are advisory unless generated from canonical product validation or classified as non-field compliance.

## Forbidden
- Quote rating enforcing issuance-only fields (registration, VIN, etc.). Issuance enforces them.
- Persisting a field outside its owning step (except issue-details remediation scope).
- `additionalDrivers` blocking quote rating when `hasAdditionalDrivers` is false, or when `driverRestriction !== 'NAMED_DRIVERS'` (ADR-0026).
- Returning `INVALID_QUOTE_DATA` without traceable `error.details` (slugs / paths).
- Document mappers, BDX mappers, or MagicB slug lists introducing product requiredness authority. Product profiles and adapters own that exclusively.

## Escalation
- **Write an ADR** to: change a runtime invariant above, introduce a new persistence step or relax per-step boundary, add a new validation `mode` beyond `quote`/`issuance`, allow MagicB to author blocking customer requiredness.

## Debug flow
Correlation id → backend logs (`public_auto_quote.patch_fields_filtered`, `INVALID_QUOTE_DATA.{missingSlugs,blockingErrors}`) → confirm last PATCH step → confirm validation mode → inspect non-prod `data.diagnostics.validation[]`.

## Links
- Related: [validation.md](./validation.md) · [products.md](./products.md)
- Validate: `npm run guard:product-validation-authority` · `npm run contract:generate:check` · `npm run guard:validation-single-source` · `tools/quality/check-validation-purity.mjs` · `tools/quality/check-no-default-tenant-fallbacks.mjs` (no silent defaults in document mappers, BDX mappers, or claims prefill)
