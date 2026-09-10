---
title: Product engine authority extraction contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Product engine authority extraction — binding contract

## Governs
Separation of three concerns: **Manifest** (what the product is) · **Authority** (what this program/binder permits) · **Engine** (how rating/UW/wording executes).

## Allowed
- Read authority from one source per rule: `Program.metadata` for program-level values, `BinderProductAuthority` for binder caps/scope.
- Product online-acceptance thresholds are program UW rules: exceeding one refers; binder caps remain separate hard limits at bind.
- Compiled engines consume normalised authority and emit decision/rating traces citing authority keys.
- Age minimum authority is inclusive; only explicitly under-age rules exclude the boundary birthday.
- Promote to a dedicated `ProgramAuthority` table only when authority needs versioned audit independent of `Program`, the metadata shape becomes too large to review safely, OR multiple programs need reusable templates.

## Forbidden
- Compiled engines owning authority values as literals.
- Compiled engines silently defaulting missing required authority. Missing authority MUST produce an explicit configuration failure.
- Mixing authority extraction with pricing-table extraction in the same change.
- Maintaining both metadata-backed AND table-backed versions of the same authority rule on the same branch.

## Escalation
- **Write an ADR** to: introduce `ProgramAuthority` as a separate table, add an authority dimension that is neither program nor binder, change the engine ↔ authority contract shape.

## Motor extraction order (status: in progress)
1. Territory scope (allowed registration / location / exclusion countries)
2. Driver authority (age, licence-years, additional-driver thresholds)
3. Vehicle authority (max value, motorcycle engine, classic, motorcaravan)
4. Referral / decline thresholds (claims, convictions, commercial use)

Each phase: existing fixtures remain equivalent · config change alters outcome without code edits · trace cites configured rule id · no thresholds literal in `motorUwAutomation.ts`.
Driver age thresholds are evaluated at the selected policy start / inception date, not at quote-entry time.

## Links
- Related: [products.md](./products.md) · [underwriting-analysis.md](./underwriting-analysis.md) · [jurisdiction-product-config.md](./jurisdiction-product-config.md)
- Enforcing guards: [reference/guards.md](../../reference/guards.md)
