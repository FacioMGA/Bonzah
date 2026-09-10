---
title: Multi-product authority contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Multi-product authority — binding contract

## Governs
Product registration boundaries; what a product profile owns vs. what it MUST inherit from canonical field contracts.

## Allowed
- Add a product line:
  1. `packages/products/<name>/profile.ts` (registered in `packages/products/index.ts`)
  2. `frontend/src/products/<name>/index.ts`
  3. `backend/products/<name>/` for product-specific calculations / authority readers
- A product profile may declare: per-stage required fields, product UW authority (`Tenant.authority.<product>`), product templates, **subsets** of canonical allowed values, `mergeUwConfig(authorityOverride?)` extensions.
- A product manifest owns product-specific rating option values shown in wizards and consumed by rating engines (for example, territory bands).
- Product-specific cover eligibility MUST be enforced in the manifest/UI and again at the product-owned pricing projection; hidden fields alone are not an authority boundary. Home holiday risks exclude accidental-damage and all-risks/high-risk-item selections.
- Product endorsement templates may declare data-driven `option_defaults.selectedWhen` rules that map contract answers to MBE option selection.

## Forbidden
- `if (product === 'motor')` in `packages/validation`, `frontend/src/shared/`, or `backend/platform/`. Move the logic into the product folder.
- Product profile allowed values that **extend** (not subset) the canonical field contract.
- Product profile default value not in its own allowed values. *(This is the Nationality-class drift ADR-0010 makes structurally impossible.)*
- Wizard UI option `value` shape differing from the canonical contract atom shape for the same field.
- Payload mapper writing to a path the field contract does not declare.
- Hand-rolled fallback list for a field that already has a canonical contract.
- Zod schemas in product wizard schemas beyond presentation adapters. Step schemas MUST NOT contradict the questionnaire contract.

## Escalation
- **Write an ADR** to: add a product line outside the existing profile shape, extend canonical allowed values, introduce a new shared abstraction across products, change a canonical field contract.
- **Stop and ask** to: add product-specific authority for a today-global field, bypass the issuance gate, add a product-specific fallback list.

## Single canonical issuance gate
All issuance paths (wizard payment, BO bind-coverage, BO issue-policy, API v1) MUST call `evaluateIssueReadiness` in `backend/modules/policy/domain/issueReadiness.ts`. Frontend gating is UX, never a security boundary. Enforced by `tools/quality/check-product-engine-contract.mjs` (issuance-funnel pattern); routes that survive must be single-statement delegations to the gate. `customerOutcome` is `'issued' | 'pending' | 'failed'` (ADR-0017); `'failed'` is terminal and forbids silent retry loops.

## Links
- Generated contract inventory (owner / source / products using / last changed): [reference/contracts.md](../../reference/contracts.md)
- Related: [tenancy.md](./tenancy.md) · [jurisdiction-product-config.md](./jurisdiction-product-config.md) · [product-engine-authority.md](./product-engine-authority.md) · [validation.md](./validation.md) · [underwriting-analysis.md](./underwriting-analysis.md)
- ADRs: [ADR-0010](../decisions/ADR-0010-documentation-is-enforced.md) · [ADR-0017](../decisions/ADR-0017-issue-readiness-failed-terminal-outcome.md) · [ADR-0076](../decisions/ADR-0076-product-cover-eligibility-defense-in-depth.md)
