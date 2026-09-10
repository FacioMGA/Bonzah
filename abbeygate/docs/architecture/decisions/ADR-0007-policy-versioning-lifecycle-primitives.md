---
title: ADR-0007 Policy versioning lifecycle primitives
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# ADR-0007: Policy Versioning — Lifecycle-Specific Primitives

## Status

Accepted

## Context

The platform manages policy data across a lifecycle that spans quoting, binding, issuance, and post-issuance changes (endorsements, cancellations). Each stage has different versioning requirements:

- **Pre-bind** (quote/draft): data is mutable, customers and underwriters iterate freely, versions are informational snapshots for comparison.
- **Post-bind** (issued policy): data is immutable once bound, changes are formal transactions with audit trails, premium movements, and compliance implications.

An investigation of the current codebase revealed three distinct mechanisms that manage "branching" or "versioning" of policy data. The question was whether these should be unified into a single system.

## Decision

The platform uses **three lifecycle-specific primitives** for policy data versioning. They must not be mixed across lifecycle boundaries.

### 1. Policy Clone (pre-bind session restart)

**Primitive:** New `Policy` row.

Used when a customer edits quote data after receiving a price and the data has materially changed. The system creates a fresh policy with a new `policyNumber` and `publicSessionToken`, cloning the current `quoteData` and resetting the quote response. The original policy is left as-is.

This is **not versioning**. It is session restart / quote restart. There is no parent-child link between the original and the clone.

**Owner:** `backend/modules/quotes/app/publicAutoQuote/quoteSessionOps.ts` (`forkPublicAutoPolicy`).

**When to use:** Only in the public wizard flow, only pre-bind, only when the customer's edits after quote require a fresh rating session.

### 2. PolicyQuoteHistory (pre-bind version snapshots)

**Primitive:** `PolicyQuoteHistory` row (`policyId` + `version` number).

Used to archive a point-in-time snapshot of `quoteData` and `quoteResponse` before the data is overwritten. This gives underwriters and the system a version history of how a quote evolved before binding.

Two operations produce these snapshots today:
- **Wizard unlock** (customer returns to edit a payment-locked quote): archives the current state before unlocking.
- **BO "save version"** (underwriter snapshots after recalculating): archives the current state as a named version.

**Owner:** Must be consolidated into a single service at `backend/modules/policy/app/history/` (see Consequences).

**When to use:** Only pre-bind. Never for issued policies. Never for endorsements.

### 3. RiskTransaction (post-bind change management)

**Primitive:** `RiskTransaction` row (`policyId` + `transactionNumber`).

The formal change-management primitive for issued policies. Every material change after bind is recorded as a `RiskTransaction` with:
- `transactionType`: `INCEPTION`, `ENDORSEMENT`, `CANCELLATION`, `REINSTATEMENT`
- `status`: `DRAFT`, `REFERRED`, `APPROVED`, `BOUND`, `PENDING_DOCS`
- `snapshotDraft`: mutable working state while in DRAFT
- `snapshotFinal` / `pricingFinal`: immutable record once BOUND

**Owner:** `backend/modules/policy/app/` (CreateEndorsementDraft, BindEndorsementDraft, RateEndorsementDraft).

**When to use:** Only post-bind. All changes to issued policies must go through a RiskTransaction. BO recalculation on issued policies creates an endorsement draft (RiskTransaction type ENDORSEMENT, status DRAFT) if one does not already exist.

### MBE (structured mutation generator)

MBE (`EndorsementInstance` / `EndorsementTemplate`) is **not a versioning primitive**. It is a structured mutation generator that produces change sets (add driver, change vehicle, adjust coverage). These change sets are applied through a `RiskTransaction`. The relationship is:

```
MBE (EndorsementInstance)
    produces change set
        │
        ▼
    RiskTransaction (records the change)
```

MBE should not be grouped with the fork/versioning mechanisms.

## The Lifecycle Boundary

```
QUOTE / DRAFT PHASE
│
│  Primitives:
│  - Policy clone (session restart)
│  - PolicyQuoteHistory (version snapshots)
│
│  Workspace: PolicyStateCurrent.snapshot
│
▼
BOUND POLICY
│
│  Primitive:
│  - RiskTransaction (formal change management)
│
│  Workspace: PolicyStateCurrent.snapshot
│             (synced with RiskTransaction.snapshotDraft)
│
▼
ENDORSEMENTS / CHANGES
    Created via: RiskTransaction (ENDORSEMENT, DRAFT)
    Structured via: MBE → RiskTransaction
```

The workspace buffer (`PolicyStateCurrent.snapshot`) is shared across all lifecycle stages. Every surface (wizard, BO, endorsement UI) reads from and writes to this single working state. Versioning happens through the lifecycle-appropriate primitive when the workspace state needs to be archived or formalized.

## Rules

1. **Pre-bind versioning uses `PolicyQuoteHistory`.** Never use `RiskTransaction` for pre-bind quote iterations.
2. **Post-bind versioning uses `RiskTransaction`.** Never use `PolicyQuoteHistory` for changes to issued policies.
3. **Policy clone is session restart, not versioning.** It creates a new entity with no lineage link. Use only in the public wizard flow.
4. **All changes to issued policies go through `RiskTransaction`.** No direct mutation of issued policy data outside a transaction.
5. **`PolicyStateCurrent.snapshot` is the workspace, not the source of truth for issued policies.** For issued policies, the source of truth is the latest BOUND `RiskTransaction.snapshotFinal`.
6. **MBE produces change sets; `RiskTransaction` records them.** MBE is not a versioning primitive.

## Consequences

### Consolidate PolicyQuoteHistory writes

Two code paths currently produce `PolicyQuoteHistory` rows:
- `backend/modules/quotes/app/publicAutoQuote/quoteSessionOps.ts` (wizard unlock)
- `backend/modules/policy/http/quoteHistoryRouter.ts` (BO save version)

These must be consolidated into a canonical service under `backend/modules/policy/app/history/` with at minimum:
- `saveQuoteVersion.ts` — archives current workspace to PolicyQuoteHistory
- `listQuoteVersions.ts` — retrieves version history for a policy

Both the wizard unlock path and the BO save-version route should delegate to this service.

### Backend-orchestrate endorsement "save version"

The BO "save version" flow for issued policies is currently frontend-orchestrated: the UI calls create-draft, patch, and rate in sequence. This must be replaced with a single backend endpoint:

```
POST /api/policies/:id/endorsements/save-version
```

The backend performs create + patch + rate + persist in a single transaction, eliminating partial-state and race-condition risks.

### Rename misleading shared function

`rateQuote` (renamed from `rateQuoteWorkspace` in `spine/v2` Wave 4) is the canonical cross-surface rating entrypoint for both wizard and BO recalculation.

## Implementation Status

| Consequence | Status | Notes |
|-------------|--------|-------|
| Consolidate `PolicyQuoteHistory` writes into `backend/modules/policy/app/history/` | ✅ DONE (`spine/v2` Wave 4) | Sole `policyQuoteHistory.create` lives in `backend/modules/policy/app/history/saveQuoteVersion.ts`. Both write paths delegate: `backend/products/motor/quotes/quoteSessionOps.ts` (wizard unlock) and `backend/modules/policy/http/quoteHistoryRouter.ts` (BO save version + listing). |
| Backend-orchestrate `POST /api/policies/:id/endorsements/save-version` | ✅ DONE (`spine/v2` Wave 4) | `executeSaveEndorsementVersion` (`backend/modules/policy/app/SaveEndorsementVersion.ts`) chains create + patch + rate as a single backend call. Route `backend/modules/policy/http/endorsementsRouter.ts` POST `/:id/endorsements/save-version` delegates. FE clients (`endorsementsApiClient.saveEndorsementVersion`) call it as one operation. |
| Rename `rateQuoteWorkspace` to a clearer name | ✅ DONE (`spine/v2` Wave 4) | Renamed to `rateQuote` across BE (`backend/products/motor/quotes/service.ts` + re-export wrapper + controller + tests) and FE (`quoteWizard.api.ts`, `policyCrudApiClient.ts`, `useQuoteWizardController.ts`, `usePolicyLifecycleActions.ts/test.tsx`, `CoveragesAndOptions.tsx`, `UnderwritingTab.tsx`). Single canonical name; no aliases retained. |

> ADRs describe accepted decisions. Open consequences are tracked here until implemented, then updated to `✅ DONE` with the PR reference. The three rows above are the explicit workplan for `spine/v2` Wave 4; no new ADR is opened for the same subject.
