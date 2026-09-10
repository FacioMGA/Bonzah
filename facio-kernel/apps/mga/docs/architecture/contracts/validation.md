---
title: Validation contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Validation — binding contract

## Governs
How quote data is validated across customer wizard, BO Underwriting tab, backend draft, and backend issuance. Single source of truth: [`@facio/validation`](../../../packages/validation/) + per-product `ValidationProfile` in `packages/products/src/<code>/profile.ts`.

## Allowed
- Add a product: write `ProductManifest` + `ValidationProfile`, register in `ProductRegistry` and `ValidationRegistry` (FE) + `backend/products/registerProducts.ts` (BE).
- Call `validateForContext({ productCode, stage, actor, data, focusField? })` from any of: wizard `handleNext`, BO UW `validateFieldOnBlur` / save, backend `validateDraftQuote`, backend `validateForIssuance`.
- Use atomic rules from `packages/validation/src/rules-pure.ts` (`Name`, `Email`, `DOB`, `PostcodeForCountry`, `PositiveMoney`, `EnumOf`, `MustAccept`, `requiredIf`) plus `createPhoneE164` from `rules-phone.ts` (deliberately split as the one environment-specific rule).
- Public wizards must not render an issuance-only canonical field before quotation. They collect it in issuance details from the canonical `validateForContext({ stage: 'issuance' })` result; a field such as Motor `proposer.nif` therefore remains issuance-required without appearing in the pre-quote questionnaire.

## Forbidden
- `zod` imports in product wizard schemas. The grandfathered list is empty (closed Phase 8, 2026-04-28); step refinements that need cross-field guards live on `ValidationProfile.steps[*].refinements`.
- Imports from app modules into `packages/validation/src/`. Allowed: `zod`, `vitest`, `node:`, per-adapter phone validators.
- Resurrecting `frontend/src/shared/validation/` or `backend/shared/validation/` (deleted Phase 3h).
- Issuance bypass — every path must call `evaluateIssueReadiness` server-side. UI gating is UX, not security.
- MagicB rule independently owning customer required-field authority. A blocking MagicB rule is generated from the canonical profile or classified as non-field compliance.
- Manifest required field or MagicB seeded path that contradicts the canonical profile (`check-product-validation-authority.ts`).
- Reintroducing `profile.canonicalShape` (canonicalisation is write-time only).
- Silent default-true for required consent flags. Missing `privacyPolicyAccepted` / `infoTrueAndAccurate` / `fairProcessingAccepted` MUST surface as required-field errors regardless of actor; an underwriter "bypass" is an explicit, audited UW action — never a coercion at validate time.
- Silent fallbacks on required pricing inputs (`getAge`, `getExcess`, `buildingsSumInsured`, `contentsSumInsured`, etc.). Fail closed and document the validator that should have caught the gap.
- Silent default-PASS for BDX migration-compliance. The validator MUST emit an explicit verdict; absence is an evaluator bug.

## Escalation
- **Write an ADR** to: change `ValidationProfile` shape, change actor/stage semantics, add a new error contract guarantee, add a new entry point beyond `frontend`/`backend`, change required-field empty-normalisation.
- **Stop and ask** to: bypass a refinement for cross-field UW logic, add an anonymous multi-line predicate inside `refinements`.

## Links
- Runtime semantics: [validation-runtime.md](./validation-runtime.md)
- Multi-product authority: [products.md](./products.md) · [product-engine-authority.md](./product-engine-authority.md)
- Enforcing guards: [reference/guards.md](../../reference/guards.md)
- Contract inventory (Nationality-class drift): [reference/contracts.md](../../reference/contracts.md)
