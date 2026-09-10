---
title: ADR-0017 Terminal `failed` customer outcome for issue-readiness
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-09
binding: true
---

# ADR-0017: Terminal `failed` customer outcome for issue-readiness

## Status

Accepted

## Context

`evaluateIssueReadiness(policyId, 'customer')` returned a two-state
`customerOutcome: 'issued' | 'pending'`. The wizard polled the public
`/api/public/<product>/session/:token/issue-readiness` endpoint and
advanced when the outcome became `'issued'`; otherwise it kept polling.

When the post-payment `DOC.GENERATE_ISSUED_POLICY_PACK` worker
permanently failed — for example: a per-product template path bug,
a Puppeteer launch error, a storage upload failure, or a missing
required doc type after BullMQ exhausted retries — the live evaluator
had no signal to flip the outcome away from `'pending'`. The
`PaymentStep` component (`frontend/src/shared/lib/wizard/steps/PaymentStep.tsx`)
hit its 90 s polling timeout and entered the `pending_issuance` UI on
the gateway-return path; on any subsequent visit the initial-mount
path silently called `onSubmit({ issued: false })`, the wizard
controller's `handleTerminal` advanced with `variant: 'pending'` but
also set `paymentConfirmed: true`, and the user was deposited back at
the payment step with no error message. This produced the
"system completely broken / documents never generated" cluster
(ABY-29, ABY-33, ABY-34, ABY-41, ABY-54, ABY-59, ABY-66, ABY-70,
ABY-77, ABY-97, ABY-98).

The worker handler already recorded a structured paymentEvent
(`ISSUED_PACK_MISSING_DOC_TYPES`) for the missing-types case, but:

- Runtime errors thrown inside `adapter.generateDocPack(...)` (template
  load, PDF render, storage upload) never produced an audit row at all.
- Even the missing-types audit was not consumed by `evaluateIssueReadiness`
  — it existed only for BO operator visibility on the payment view.
- The lightweight `IssueReadinessProjection` in
  `backend/modules/policy/domain/issueReadinessUpdater.ts` already
  carried `customerOutcome: 'pending' | 'issued' | 'failed'` with a
  `failureCode` field, but no producer ever set `failureCode`, so the
  `'failed'` branch was unreachable.

## Decision

1. **Three-state customer outcome.** `IssueReadinessResult.customerOutcome`
   widens to `'issued' | 'pending' | 'failed'`. The zod schema in
   `backend/platform/types/contracts.ts` widens identically.

2. **Two failure event types.** The worker records distinct audit rows
   so BO and analytics can tell "we built the wrong pack" from
   "we never produced a pack at all":

   - `ISSUED_PACK_MISSING_DOC_TYPES` — adapter completed but did not
     return every required doc type.
   - `ISSUED_PACK_GENERATION_FAILED` — adapter call itself threw
     (template missing, PDF render error, storage upload failure,
     etc.). New in this ADR.

   Both are written by `recordIssuedPackFailurePaymentEvent` in
   `backend/platform/events/policyEmailOrchestration.ts`. The exported
   `IssuedPackFailureEventType` and `ISSUED_PACK_FAILURE_EVENT_TYPES`
   are the canonical surface; downstream readers must use these
   instead of duplicating the string literals.

3. **Worker handler audits every failure path.** `runIssuedPackJob`
   wraps the `adapter.generateDocPack` call in a try/catch that
   records `ISSUED_PACK_GENERATION_FAILED` and mirrors the failure
   into the readiness projection (`setIssueReadiness({ failureCode:
   'GENERATION_FAILED' })`) before re-throwing for BullMQ backoff.
   The missing-types branch additionally mirrors with
   `failureCode: 'MISSING_DOC_TYPES'`.

4. **Live evaluator surfaces `failed` from temporal comparison.**
   `evaluateIssueReadiness` queries the latest `ISSUED_PACK_*`
   payment event AND the latest GENERATED `ISSUED_POLICY_PACK`
   document timestamp. If the failure event is newer than any
   generated doc (or no doc exists at all), it emits a
   `DOCUMENTS_GENERATION_FAILED` blocker (severity `BLOCK`) with the
   audit reason and timestamp, and sets `customerOutcome: 'failed'`.

5. **Recovery is automatic.** When a later worker retry succeeds and
   produces all required doc types, the new `Document.generatedAt`
   becomes newer than the failure audit, the `failed` test fails,
   and the outcome flips to `'issued'`. No manual `failureCode`
   clearing is required because the projection's outcome resolution
   prefers `issued` (`hasBoundInceptionTransaction && hasIssuedPackDocuments`)
   over `failed`.

6. **Frontend stops polling on `failed`.** `PaymentStep.waitForIssuanceReadiness`
   returns immediately when the latest readiness reports
   `customerOutcome: 'failed'`, and renders an explicit
   operator-contact recovery surface. The previous silent
   "advance with `issued: false`" path on initial mount is removed
   — both the gateway-return AND initial-mount paths funnel through
   the same `pending_issuance` / `failed` UI states.

## Consequences

- **No more silent revert to payment step.** The wizard either
  advances to dashboard (`issued`), waits with a re-check button
  (`pending_issuance`), or shows a recovery surface (`failed`).
  There is no fourth state where the user is silently bounced back
  with no message.
- **One canonical failure surface.** Operators see `failed`-state
  policies on the payment view via the same audit table that already
  surfaced `WELCOME_EMAIL_FAILED` and `WELCOME_EMAIL_SENT`, plus the
  cheap `IssueReadinessProjection` row for at-a-glance dashboards.
- **Recovery semantics are unchanged.** BullMQ retries, the outbox
  relay, and the existing `attemptIssuanceHealForPolicy` self-heal
  all continue to work: a successful subsequent attempt produces
  newer Documents and the `failed` outcome auto-resolves.
- **Pre-payment errors stay invisible.** `findLatestIssuedPackFailureEvent`
  only fires when `hasPaymentConfirmed` is true. There is no
  customer-facing surface for failures that occur before payment
  capture (no UX expectation that the customer sees them; BO still
  sees them via the audit table).

## Links

- Live evaluator: `backend/modules/policy/domain/issueReadiness.ts`
- Audit writer: `backend/platform/events/policyEmailOrchestration.ts`
- Worker handler: `backend/workers/handlers/DOC.GENERATE_ISSUED_POLICY_PACK.ts`
- Repository (audit + doc timestamp queries):
  `backend/modules/policy/infra/read/issueReadinessRepository.ts`
- Projection writer: `backend/modules/policy/app/setIssueReadiness.ts`
- Wizard surface: `frontend/src/shared/lib/wizard/steps/PaymentStep.tsx`
- Schema: `backend/platform/types/contracts.ts`
- Linear cluster closed: ABY-97 (urgent), ABY-98, ABY-29, ABY-33,
  ABY-34, ABY-41, ABY-54, ABY-59, ABY-66, ABY-70, ABY-77.
- Builds on: [ADR-0013](./ADR-0013-canonical-issuance-spine-outbox.md),
  [ADR-0011](./ADR-0011-policy-state-and-compliance-canonical-placement.md).
