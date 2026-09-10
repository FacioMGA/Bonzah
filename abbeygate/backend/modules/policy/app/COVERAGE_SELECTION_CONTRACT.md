# Coverage Selection Contract

## Purpose

`coverageSelection` is **not** the entire coverage truth.

It is only the persisted **saved intent** for optional/configurable cover
selection:

- which coverage codes a user/operator explicitly turned on/off
- the parameter bags attached to those coverage codes
- which program the selection belongs to

The full effective cover set is a second concept:

- `resolvedCoverageSet` = the single computed coverage engine output used
  by pricing, preview, and documents

The backend owns both contracts. Frontends must not recompute either.

## Canonical Shapes

### 1. Saved selection (authoritative as persisted intent)

```ts
type CoverageSelectionSnapshot = {
  schemaVersion: 1;
  programId: string | null;
  programCode: string | null;
  selected: Record<string, boolean>; // exact saved intent
  params: Record<string, Record<string, unknown>>; // exact saved params
  source?: string;
  updatedAt?: string;
  requiresProgram?: boolean;
  bo_initialized?: boolean;
};
```

### 2. Truthful API contract

```ts
type TruthfulCoverageContract = CoverageSelectionSnapshot & {
  defaults: {
    selected: Record<string, boolean>;
    params: Record<string, Record<string, unknown>>;
  };
  resolvedCoverageSet: {
    productType: string;
    programCode: string;
    selectedCodes: string[];
    items: Array<{
      code: string;
      title: string;
      summary?: string;
      type: string;
      scope: string;
      group?: string;
      enabled: boolean;
      selected: boolean;
      source: 'base' | 'option';
      params: Record<string, unknown>;
      targetId?: string;
    }>;
    applied: Array<{ code: string; params?: Record<string, unknown>; targetId?: string }>;
  };
};
```

## Single Sources Of Truth

### Saved intent

Use `CoverageSelectionSnapshot` in
`backend/modules/policy/app/coverageSelectionContract.ts`.

This is the only place that should:
- normalize legacy or partial selection payloads
- reject cross-program drift
- persist what the user/operator actually selected

### Effective coverage for pricing/docs

Use `resolveCoverageV1()` in
`backend/modules/mbe/domain/programProduct.ts`.

This is the only place that should:
- merge `quoteData`
- merge saved `coverageSelection`
- merge program config
- merge catalog defaults
- validate prerequisites
- produce the final `resolvedCoverageSet`

## Hard Rule

`GET /coverage-selection` must return the saved selection exactly as saved.

It must **not** rewrite `selected` from a resolved `applied` set.

If the engine disagrees with the saved selection, that disagreement must
be exposed under `resolvedCoverageSet`, not hidden by mutating the saved
contract in the API.

## Flow Usage

### BO Policy Flow
- `backend/modules/policy/http/coverageRouter.ts`
- `frontend/src/products/policies/mbe/views/CoveragesAndOptions.tsx`

BO reads:
- `selected` + `params` as the operator's saved intent
- `resolvedCoverageSet` as the current computed truth

BO writes only `selected` + `params` through `PUT /coverage-selection`.

### Client Quote Flow
- `backend/modules/quotes/app/publicAutoQuote/service.ts`
- `backend/modules/quotes/app/publicAutoQuote/controller.ts`
- `frontend/src/products/policies/wizard/components/steps/step4QuoteApi.ts`
- `backend/modules/quotes/http/v1QuotesRouter.ts` as a compatibility boundary

Client recommendation and bundle selection should send `coverageSelection`
at the API boundary. Legacy `selectedOptions` is compatibility-only and
should not be expanded into new code.

Rerating is not allowed to rebuild the workspace snapshot from quote/pricing data alone. Any write to `PolicyStateCurrent.snapshot` during rating must merge onto the existing workspace snapshot and preserve `coverageSelection` unless the request supplied a newer canonical `coverageSelection` payload.

### BO Endorsement Draft Flow
- `backend/modules/policy/app/RateEndorsementDraft.ts`
- `backend/modules/policy/http/coverageRouter.ts` with `riskTransactionId`

Draft rating and draft coverage changes must resolve through the same canonical contract, using the draft snapshot as the stored selection source.

### Preview, Apply, Documents, Details
- `backend/modules/mbe/domain/service.ts`
- `backend/modules/policy/http/detailsRouter.ts`
- `backend/modules/documents/infra/motorDocs/generateMotorDocPack.ts`

These flows consume `resolvedCoverageSet` so that preview, pricing, and
schedule rendering agree on what is effectively in force.

## Deprecated / Legacy Shapes

The following are legacy compatibility paths and should not be used as primary logic:
- `snapshot.selectedOptions`
- recomputing top-level `selected` from a resolved applied set
- ad hoc merges of raw `enabledByDefault` into UI-ready selections
- product-specific resolvers in generic flows
- re-deriving applied endorsements separately in each consumer

If compatibility is needed, map legacy inputs into `coverageSelection` once at the boundary, then use the canonical helper.

## Implementation Rule

When changing endorsement behavior:
1. update product config or catalog/template data
2. persist or read saved intent through `CoverageSelectionSnapshot`
3. resolve through `resolveCoverageV1()`
4. consume `resolvedCoverageSet`

Do not add a second defaulting or applicability path in frontend or backend consumers.
Do not overwrite `PolicyStateCurrent.snapshot` with quote/pricing-only objects after coverage has already been selected.
