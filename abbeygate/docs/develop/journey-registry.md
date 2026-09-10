---
title: Journey registry
audience: developer
status: living
owner: platform-eng
reviewed: 2026-08-19
binding: true
---

# Journey registry — binding

Each `e2e/journeys/*.journey.test.ts` file pins a canonical owner for one
customer- or BO-facing journey. The journey file itself is a **shallow
contract test**: it imports the canonical owner and fails when the
owner is renamed or removed. Deeper proof lives at tiers 1-3 per
[test.md](./test.md).

## Index

| Journey | Canonical owner | Deeper proof |
|---|---|---|
| `quote-bind-issue` | `motorFlow` (`frontend/src/products/motor/wizard/flows/motor.flow.ts`) | `policy_lifecycle.test.ts`, `policies_bind.test.ts`, `binding_integrity.test.ts` |
| `bo-policy-detail` | `usePolicyDetailViewController` (`frontend/src/modules/policies/hooks/`) | `usePolicyDetailViewController.header.test.tsx` |
| `bo-cancellation-request` | `registerPolicyCancellationRoutes` (`backend/modules/policy/http/cancellationsRouter.ts`) | `cancellations.test.ts`, `endorsements.cancellation-gate.test.ts` |
| `bo-endorsement-draft-bind` | `registerPolicyEndorsementRoutes` (`backend/modules/policy/http/endorsementsRouter.ts`) | `endorsements.issue-doc-orchestration.test.ts`, `endorsement.document-rules.test.ts` |
| `bo-fnol-clarification-cycle` | `handleIntakeCommands` + `ClaimCommandType` (`backend/modules/claims/domain/commands/`) | `worksheetCommands.binderGovernance.test.ts`, `claimsWorksheetGovernance.test.ts` |
| `bo-generate-doc-packs` | `runIssuedPackJob`, `handleGenerateMotorDocPack`, `handleGenerateQuotePack` (`backend/workers/handlers/`) | `DOC.GENERATE_ISSUED_POLICY_PACK.test.ts`, `templates_render_smoke.test.ts` |
| `bo-referral-review-approval` | `handleIntakeCommands` + `ClaimCommandType` (`SET_REFERRAL` / `APPROVE_REFERRAL` / `DENY_CLAIM`) | `uw-edit-mode.test.ts`, claim worksheet command suites |
| `bo-underwriting-followups` | `registerUwFollowUpRoutes` (`backend/modules/policy/http/uwFollowUpRouter.ts`) | `uw-edit-mode.test.ts`, `next-best-action` tests |
| `claims-fnol-intake` | `buildFnolSubmitPayload`, `FALLBACK_INCIDENT_CARDS` (`frontend/src/modules/claims/intake/actions/clientFnol.submit.ts`) | `clientFnol.submit.test.ts`, intake controller tests |
| `public-login-dashboard` | `resolvePostPurchaseDashboardTarget` (`frontend/src/shared/lib/wizard/postPurchaseDashboardTarget.ts`) | `postPurchaseDashboardTarget.test.ts` |
| `public-payment-to-issuance` | `evaluateIssueReadiness` + `IssueReadinessResult.customerOutcome` | `issueReadiness.failedOutcome.test.ts`, `PaymentProcessingCard.test.tsx` |
| `public-payment-documents-failed` | `runIssuedPackJob` + `evaluateIssueReadiness` (`customerOutcome === 'failed'`) | `issueReadiness.failedOutcome.test.ts`, `PaymentProcessingCard.test.tsx`, `PaymentStep.initialMount.test.tsx`, `DOC.GENERATE_ISSUED_POLICY_PACK.test.ts`, `issuedDocPackGeneration.integration.test.ts` |
| `public-quote-questionnaire` | `motorFlow` + `homeFlow` step definitions | `motor.flow.contracts.test.ts`, `home.flow.contracts.test.ts` |

## ADR-0017 context (was inline in `public-payment-documents-failed`)

The customer-facing failure surface ABY-97/98 used to silently advance:
`PaymentStep` called `onSubmit({ status: 'paid', issued: false })` when
`waitForIssuanceReadiness` timed out, the controller treated that as
`variant: 'pending'`, and the customer was bounced back to the payment
step with no error. ADR-0017 forbids that. Either the wizard is
`issued`, or it stays on payment in `pending_issuance` (still working)
or `documents_failed` (terminal). The journey file pins the readiness
contract; deeper proofs cover the wizard, projection, and worker.

## Forbidden

- Tautological journey files (inline object literal asserted against
  its own keys). The journey guard rejects these.
- Adding a journey file without a canonical-owner import.
- Moving deeper-proof tests into the journey file. Tier 2/3 stays
  where it belongs per [test.md](./test.md).

## Escalation

- New journey -> add the file + register it in
  `tools/quality/check-e2e-journey-coverage.mjs` `REQUIRED` list + add
  a row to the index above.
- Canonical owner moves -> update both the import and the index row.
