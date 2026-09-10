# Wizard Validation Lifecycle

This document defines the validation source-of-truth contract for the public quote wizard.

## Goals

- Show errors on **Continue** and **blur**.
- After a field is already invalid, revalidate on **change** and clear immediately when valid.
- Keep inline field UI, invalid styling, and error summary synchronized.
- Avoid parallel mutable error state.

## Source of Truth

- The single source of truth for validation UI is `react-hook-form` `formState.errors`.
- `QuoteWizardErrorSummary` is derived from `formState.errors` via:
  - `collectErrorEntries()`
  - `dedupeErrorEntries()`
- No separate persistent banner error list should be maintained.

## Validation Engine Contract

- Step validation is centralized in `wizardStepValidation.ts`:
  - `validateWizardStep(step, data)`
  - `applyWizardStepErrors(form, stepErrors)`
  - `reconcileWizardStepErrors(...)`
  - `reconcileAdditionalDriverFieldError(...)`
- Continue and recovery paths must both use this contract.
- Step rules come from existing step schema adapters in `validation/wizardSchemaAdapter.ts`.

## Lifecycle

1. **Continue (`validateCurrentStep`)**
   - Run `validateWizardStep`.
   - Replace RHF errors via `applyWizardStepErrors`.
2. **Blur**
   - Run `reconcileWizardStepErrors(..., mode: 'blur')` for the focused field.
3. **Change**
   - If field/top-level has an active error, run `reconcileWizardStepErrors(..., mode: 'change')`.
   - For nested additional-driver fields, use `reconcileAdditionalDriverFieldError(...)`.

## Field Path Rules

- Use stable RHF field names end-to-end (`setError`, `clearErrors`, summary projection, scroll targeting).
- Nested paths (for example `additionalDrivers.0.firstName`) are first-class and must not be collapsed unless intentionally mapping to a top-level field.
- Conditional fields must clear when no longer applicable after reconciliation.

## Guardrails

- Do not call `clearErrors(field)` opportunistically in step UI handlers.
- Do not introduce a new banner error state store.
- Do not mix step schemas with unrelated validators in recovery flow without explicit adapter-level reasoning.

## Tests

- Lifecycle behavior is covered by:
  - `wizardStepValidationLifecycle.test.tsx`
  - `frontend/src/shared/lib/wizard/utils/errors.test.ts` (shared error-summary projection)
  - `schemas/wizardSteps.test.ts` (step-level wizard schemas, formerly `wizardSchemaAdapter.test.ts`)

## Cross-Layer Notes (Mar 2026)

- The wizard now persists draft changes with explicit step context on field updates:
  - `policy-holder`, `vehicle-cover`, `driving-history`, `issue-details`
  - This prevents driving-history fields from being silently filtered out by backend step guards.
- Step 3 (`driving-history`) now saves draft state before invoking rating.
- Rating validation uses quote-stage rules (`mode: 'quote'`) and no longer enforces issuance-only requirements.
- Issuance validation remains strict (`mode: 'issuance'`) and is enforced later in the flow.
- `additionalDrivers` requiredness is conditional:
  - required only when `hasAdditionalDrivers === true`
  - not required when customer selected `No`.
- Rate failures include structured diagnostics (`missingSlugs`, `blockingErrors`) and correlation IDs for traceability.

