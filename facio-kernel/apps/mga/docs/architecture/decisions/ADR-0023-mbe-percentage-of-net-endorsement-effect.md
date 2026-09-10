---
title: ADR-0023 MBE percentage-of-net endorsement effect
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-14
binding: true
---

# ADR-0023: MBE percentage-of-net endorsement effect

## Status

Accepted. Required by Abbeygate motor scheme rating-sheet alignment (signed off by Peter Sheppard, 2026-05-15). Adds one new effect type to the MBE endorsement contract; does not deprecate any existing effect.

## Context

The Abbeygate motor scheme charges **Protected NCD** as `+10% of net premium`, applied **after NCD discount but before MIF**, with a prerequisite that the customer carries **≥ 4 years NCD**. This is the underwriter-defined behaviour for CV 172 in the motor scheme (`Rating Factor for the Abbeygate Motor Scheme` document, 2026-05-15).

Today CV 172 is implemented in `backend/modules/mbe/domain/endorsementTemplates.ts` as a flat fee:

```jsonc
"computed_params": [
  { "type": "PRO_RATE_BY_POLICY_TERM_MONTHS", "param": "premium_eur", "defaultValue": 45, "precision": 2 }
],
"rules": {
  "effects": [
    { "type": "ADD_PREMIUM_ROW", "params_map": { "amount": "premium_eur", "item_name": "NCB Protection", "basis": "Optional", "value": "Yes" } }
  ]
}
```

This contract shape:
- carries the price as a literal `premium_eur` value (€45);
- runs the ADD_PREMIUM_ROW after MIF/stamp/policy-fee (the existing `processEndorsementEffects` step is applied to `totalPremium`, not `subtotalNetPremium`);
- has no way to gate on NCD years.

Three things need to change for CV 172 to match the scheme:
1. The price has to be a **percentage of the net premium** (not a literal amount).
2. The fee has to be added **before MIF**, not after taxes — i.e. it has to participate in the tax base (Cyprus motor MIF is a flat €9 so the order does not affect the tax amount today, but the contract should still be expressed in the correct order).
3. A **prerequisite** must block CV 172 when NCD < 4 years.

The MBE endorsement registry is the canonical owner of "what does an endorsement cost and what does it do" (per `docs/architecture/contracts/canonical-ownership.md`, *MBE endorsement templates*). The motor calculator must not embed CV-172-specific magic; the rule belongs on the template, not in the engine.

Three options were considered:

- **A.** Keep CV 172 as `ADD_PREMIUM_ROW` and resolve the percentage at coverage-resolution time via a new `computed_params` type that takes the net premium as input.
- **B.** Add a new effect type `ADD_PREMIUM_PCT_OF_NET` that the calculator applies after net premium is known and before taxes.
- **C.** Hard-code CV 172 in the motor calculator (special-case branch).

Option C breaks canonical ownership (rule duplicated in engine + registry). Option A requires the rules engine to know about the calculator's intermediate net premium, which violates the separation between coverage resolution (no money in/out yet) and pricing.

Option B is chosen: the effect declares "percentage × net premium, applied before tax". The motor calculator is the only consumer that needs to wire it into its premium-payable ladder; other products that adopt MBE in future can reuse the same effect type.

## Decision

1. **Add one effect type** to `backend/modules/mbe/domain/types.ts`:

   ```ts
   export interface AddPremiumPctOfNetEffect extends BaseEffect {
     type: 'ADD_PREMIUM_PCT_OF_NET';
     /** Decimal fraction. 0.10 = 10%. */
     percentage: number;
     /** Display name for the schedule / breakdown line. */
     item_name: string;
     /** Optional minimum NCD-discount percentage required. 0.60 = 4 years. */
     min_ncd_pct?: number;
   }
   ```

   It joins the existing `EndorsementEffect` union additively. No existing template is impacted.

2. **`processEndorsementEffects` returns a new bucket** alongside the existing two:

   ```ts
   return {
     mbeAdditionalExcess,        // ADD_EXCESS effects — unchanged
     mbeEndorsementPremium,      // ADD_PREMIUM_ROW flat fees — unchanged, applied after tax
     mbeNetLoadingPremium,       // ADD_PREMIUM_PCT_OF_NET — applied BEFORE tax (NEW)
     steps,
   };
   ```

   Net-loading effects emit a `kind: 'fee'` step with `id: endorsement.netLoading.<code>` so the trace is auditable.

3. **The motor calculator** wires the new bucket into its premium-payable ladder between `subtotalNetPremium` and the tax call:

   ```
   subtotalNetPremium
   + mbeNetLoadingPremium       (NEW step — kind 'fee')
   = subtotalNetPremiumWithLoadings
   + MIF + stamp + policyFee    (tax base = subtotalNetPremiumWithLoadings)
   = totalPremium
   + mbeEndorsementPremium      (flat fees: ULR €86 etc.)
   = grandTotalPremium
   ```

   Cyprus motor (`CY_MOTOR_ABBEYGATE_CURRENT`) uses a flat MIF (€9), so the tax amount is the same whether the loading is "inside" or "after" the tax base; the order is still expressed correctly so future percentage taxes (e.g. ES/GR IPT) compose properly.

4. **CV 172 template updated** to use the new effect:

   ```jsonc
   "rules": {
     "effects": [
       { "type": "ADD_COVER", "target": "NO_CLAIM_PROTECTION", "params_map": { "level": "protection_level" } },
       { "type": "ALTER_NCB_BEHAVIOUR", "description": "..." },
       { "type": "ADD_PREMIUM_PCT_OF_NET", "percentage": 0.10, "item_name": "NCB Protection", "min_ncd_pct": 0.60 }
     ]
   }
   ```

   The legacy `computed_params` block (`PRO_RATE_BY_POLICY_TERM_MONTHS` on `premium_eur`) and the `default_params.premium_eur: 45` are removed. Term pro-rating now operates on the *risk* premium (via the engine's `termFactor`), not on the CP fee; the fee follows the loaded risk premium automatically.

5. **Prerequisite enforcement.** The `min_ncd_pct: 0.60` is checked at effect-apply time inside `processEndorsementEffects` using `ncdDiscountPctFromScheme(quoteData.ncb)`. If the customer's NCD is below the threshold, the effect emits an explanatory step (`notes: 'requires NCD ≥ 4 years'`) with `amount: 0` and contributes nothing to `mbeNetLoadingPremium`. The endorsement remains "selected" but priced at €0 — this preserves the customer's stored selection without silently dropping it.

## Consequences

- **Backward compatibility.** Additive only — existing templates (`COV-ROADSIDE`, `CV 4`, `CV 5`, `CV 24`, …) continue to use `ADD_PREMIUM_ROW` / `ADD_EXCESS` unchanged. No data migration needed.
- **CV 172 pricing changes.** Old: flat €45. New: 10% × net premium when NCD ≥ 4 yrs. For the five canonical staging cases the CP fee moves to: BMW €27.17, Kia €35.91, SEAT €38.28 (2024 / €35.03 if re-rated as 2020), Beetle €25.74. Customers with NCD < 4 years no longer pay anything for CV 172 (also no longer receive the benefit — the cover is priced at 0 because the prerequisite isn't met).
- **Tax base shift.** For tax profiles that use a percentage IPT (`GR_MOTOR_TENANT_IPT_CURRENT` 15%, `ES_MOTOR_TENANT_IPT_CURRENT` 8.15%, `PT_MOTOR_VOLANTE_BDX_12_9_CONVERGENCE` 12.9%), CV 172 now sits *inside* the tax base; CP customers in those jurisdictions will see a small extra IPT line on the protection loading. This matches the Cyprus scheme's intent ("loading is before the MIF") and is consistent with how other percentage-of-net loadings should behave under IPT regimes.
- **Trace clarity.** A new step `endorsement.netLoading.CV 172` appears between `total.premiumPayable` and the existing `endorsement.premium.*` steps when CV 172 is active and the NCD prerequisite is met. BO and customer-facing breakdowns surface this as a separate "NCB Protection" line in the breakdown sidebar.
- **Tests.** `motor/pricing/__tests__` and `pricing/domain/__tests__` cases that snapshot the CV 172 amount as €45 are updated to the percentage shape. `viewModel.premiumTotals.test.ts` continues to pass its synthetic €45 fixture in (the view-model is downstream of pricing and doesn't compute the percentage itself).
- **Guards.** No change to `check-architecture-locks.mjs` (Lock G remains intact — the percentage is computed inside the leaf via the effect, not by a parallel call site). `check-no-inline-rate-tables.mjs` is unaffected (the 0.10 lives on the template, not in a rate file). `check-validation-single-source.mjs` unaffected.

## Links

- Canonical-ownership: [`docs/architecture/contracts/canonical-ownership.md`](../contracts/canonical-ownership.md) — *MBE endorsement templates* row.
- Source rating sheet: `Rating Factor for the Abbeygate Motor Scheme` (Peter Sheppard, 2026-05-15).
- Sibling effect types: `AddPremiumRowEffect`, `AddExcessEffect`, `ConditionalEffect` in `backend/modules/mbe/domain/types.ts`.
- Motor scheme walkthrough used to size the change: `artifacts/motor-insurance-info/rater-walkthrough-5-cases.md`.
