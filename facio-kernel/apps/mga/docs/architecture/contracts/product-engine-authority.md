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
Separation of three concerns: **Manifest** (what the product is) · **Programme definition** (what an approved programme permits) · **Engine** (how rating/UW/wording executes).

## Allowed
- Resolve one typed, published `ProgrammeDefinition` mapped to `BinderProductAuthority` before execution (ADR-0101).
- Product online-acceptance thresholds are program UW rules: exceeding one refers; binder caps remain separate hard limits at bind.
- Compiled engines consume resolved components and emit decision/rating traces citing definition and authority keys.
- Keep tax, statutory regulation and locale/document legal requirements in resolved `JurisdictionProductConfig`, never copied into a programme component.
- Age minimum authority is inclusive; only explicitly under-age rules exclude the boundary birthday.
- Promote to a dedicated `ProgramAuthority` table only when authority needs versioned audit independent of `Program`, the metadata shape becomes too large to review safely, OR multiple programs need reusable templates.

## Forbidden
- Compiled engines owning insurer, programme, territory, monetary, threshold, question, wording or workflow values as literals.
- Compiled engines silently defaulting missing required authority. Missing authority MUST produce an explicit configuration failure.
- Reading `Program.metadata`, a filesystem data set or a prior definition as a runtime fallback after a component has migrated.

## Escalation
- **Write an ADR** to: add a definition component, add an authority dimension that is neither programme nor binder, change the engine ↔ definition contract shape.

## Migration order (status: in progress)
1. Pricing (ADR-0100), then underwriting (territory, driver, vehicle, referral / decline).
2. Cover/options, questionnaire and workflow/channel behaviour.
3. Programme document selection, with legal/regulatory values resolved from jurisdiction config.

Each phase: existing fixtures remain equivalent · a published configuration change alters outcome without code edits · trace cites configured component/version · no programme threshold literal remains in an engine. Driver age thresholds are evaluated at the selected policy start / inception date.

## Links
- Related: [products.md](./products.md) · [underwriting-analysis.md](./underwriting-analysis.md) · [jurisdiction-product-config.md](./jurisdiction-product-config.md)
- Enforcing guards: [reference/guards.md](../../reference/guards.md)
