---
title: ADR-0013 Canonical issuance spine — outbox-in-transaction for DOC.GENERATE_ISSUED_POLICY_PACK
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-07
binding: true
---

# ADR-0013: Canonical issuance spine — outbox-in-transaction for `DOC.GENERATE_ISSUED_POLICY_PACK`

## Status

Accepted

## Context

Every policy issuance path in the system must, after the inception risk
transaction is created, schedule generation of the issued-policy
document pack so the customer receives their certificate, schedule,
green card, and statement of fact. Eight distinct entry points
performed this step:

- Public CardCorp paid issuance (`runCardcorpPaidIssuance`)
- BO bind (`executeBindPolicy` — both the resume-issuing and fresh-bind branches)
- BO issue (`executeIssuePolicy`)
- Endorsement issuance (`executeIssueEndorsement`)
- Public quote-session "missing docs, please regenerate" path (`getOrQueuePublicIssuedPackLinks`)
- v1 API bind and bind-endorsement (`v1PoliciesRouter`)

All eight enqueued the doc-pack job by calling
`routeEventToQueue('DOC.GENERATE_ISSUED_POLICY_PACK', { policyId, … })`
**after** the surrounding Prisma transaction had committed. If Redis was
unreachable in that window — even briefly — the inception row was
durable in Postgres but the doc job never existed. The customer ended
up with a "half-issued" policy: certificate number, UMR, BOUND
risk-transaction, but no documents and no welcome email.

Worse, several entry points carried their *own* duplicate codepath
that bypassed the queue entirely under feature flags or env switches.
These created multiple sources of truth for "how a policy gets its
documents" and let the system drift between local-mode, async-mode,
and legacy-mode behaviour.

A previous attempt (PR-1A "repair") proposed a periodic sweep that
detected this state and re-enqueued the job. That approach was
rejected as a duplicate source of truth: it would coexist with the
original lossy enqueue, papering over the race rather than removing
it, and adding a second decision point about "this policy needs the
doc-pack job."

The CardCorp path additionally had:

- A `DOC_GENERATION_MODE` env switch that picked between an inline
  `DocumentService.generate` call (local mode) and a queue enqueue
  (queue mode). Two code paths, drift over time.
- A duplicate welcome-email helper (`maybeSendWelcomeEmail` in the
  HTTP router) parallel to the worker-side
  `maybeSendWelcomeEmailForIssuedPack`.
- A `setTimeout`-based `scheduleWelcomeEmailRetry` that fired retry
  attempts from the HTTP request handler — a fallback that vanished
  on every API restart.

The BO paths additionally had:

- An `ISSUANCE_DOCS_ASYNC` env switch on `executeIssuePolicy` and
  `executeIssueEndorsement` that picked between an inline
  `DocumentService.generate('ISSUED_POLICY_PACK', …)` call (sync mode)
  and a queue enqueue (async mode). Same dual-mode disease as
  `DOC_GENERATION_MODE` — different name, identical risk.
- An inline welcome-email block inside `executeIssuePolicy` that ran
  before the worker spine could fire, racing with the worker-side
  email helper.

`executeBindPolicy` additionally invoked
`DocumentGenerator.generateDocumentSet(policyId, riskTransactionId)`
— a parallel legacy generator (a separate class with its own
`DocumentSet` repository) that produced a second source of truth for
historical documents, ran every successful bind regardless of the
queue path, and overlapped semantically with the doc-pack the worker
spine produces.

## Decision

1. **One canonical helper.**
   `backend/modules/policy/app/commands/issuedPackEnqueue.ts` exports
   `enqueueIssuedPolicyPack(tx, args)` — and only this function may
   enqueue `DOC.GENERATE_ISSUED_POLICY_PACK`. Direct calls to
   `routeEventToQueue('DOC.GENERATE_ISSUED_POLICY_PACK', …)` are
   forbidden across the codebase.

2. **Outbox-in-transaction.**
   The helper writes a single `outbox` row using `appendDomainEvent`,
   so the row is committed atomically with the Prisma transaction
   that created the inception (or BOUND endorsement). The existing
   outbox relay (`backend/platform/events/relay.ts`) drains the row
   to `routeEventToQueue`, which dispatches it to `queues.documents`.
   The `DOC.GENERATE_ISSUED_POLICY_PACK` worker handler picks it up
   and runs the standard product-adapter doc-pack generation.

   - If the issuance transaction commits, the outbox row exists and
     the relay is guaranteed to eventually deliver the job.
   - If the issuance transaction rolls back, no outbox row exists.
   - Redis being unreachable at the moment of issuance is irrelevant —
     the relay polls and retries until Redis returns.

3. **Single envelope shape.**
   The outbox `payload` is always a `DomainEventEnvelope`. The handler
   reads strictly from `envelope.data.{policyId, riskTransactionId,
   source, generatedByUserId}`. There is **no** legacy flat-payload
   path; the handler throws a clear error if `envelope.data` is
   missing.

4. **Deterministic idempotency keys.**
   Every spine call passes `idempotencyKey = "issued-pack:${policyId}:${riskTransactionId}"`.
   The relay's `event_processing_log` dedupes redelivery; concurrent
   re-checks (e.g. customer hits `/status` twice, BO operator clicks
   "resume issuance") collapse to a single dispatch.

5. **Standalone variant for non-transactional callers.**
   `enqueueIssuedPolicyPackStandalone(args)` opens a short
   `tenantScopedPrisma.$transaction` and calls the same helper inside
   it. Used only by the public "I noticed missing docs, please
   regenerate" backfill path where there is no enclosing issuance
   transaction.

6. **Deletions (zero fallback, zero duplication, zero legacy).**
   The following code paths are removed entirely:
   - The `DOC_GENERATION_MODE` switch from `runCardcorpPaidIssuance`,
     including the inline `DocumentService.generate` call and its
     post-error re-enqueue. CardCorp issuance has one mode (outbox
     spine) for every environment.
   - The `ISSUANCE_DOCS_ASYNC` switch from `executeIssuePolicy` and
     `executeIssueEndorsement`, including all inline
     `DocumentService.generate('ISSUED_POLICY_PACK', …)` calls. BO
     issuance has one mode (outbox spine) for every environment.
   - The inline welcome-email block from `executeIssuePolicy`. The
     spine worker is the only place a welcome email is sent.
   - The legacy `DocumentGenerator` class
     (`backend/modules/documents/domain/generator.ts`), its app-layer
     shim (`backend/modules/documents/app/documentGenerator.ts`), and
     its supporting `documentSetRepository` files
     (`backend/modules/documents/{infra,app}/documentSetRepository.ts`).
     `executeBindPolicy` no longer fans out to a parallel doc-set
     generator — only the spine produces the issued doc pack.
   - `maybeSendWelcomeEmail` and `recordWelcomeEmailFailureEvent` from
     `cardcorpPublicRouter.ts`. The single canonical welcome-email
     orchestrator is `maybeSendWelcomeEmailForIssuedPack` (worker-side).
   - `scheduleWelcomeEmailRetry` and all `setTimeout`-based retry
     scaffolding.
   - The `policyIssuanceRepair.ts` repair sweep and its
     `POST_PAYMENT_REPAIR_ENABLED` feature flag.
   - The `ISSUED_PACK_QUEUE_ENQUEUE_FAILED` paymentEvent type (no
     such failure mode exists once enqueue is transactional).
   - `maybeSendWelcomeEmail` / `scheduleWelcomeEmailRetry` parameters
     from `applyCardcorpVerifiedStatus` and `verifyCardcorpPaymentStatus`.
   - `reqUrlContext` parameter from `IssuePolicyInput` and all its
     callers (`bindingRouter`, `bdxImportExecution`). Welcome-email URL
     context is rebuilt by the worker from tenant config.

7. **Worker-side observability remains.**
   `recordIssuedPackFailurePaymentEvent` is retained for the single
   remaining failure mode: the worker handler discovers required doc
   types are missing after a generation attempt. The handler records
   the failure as a structured paymentEvent (so operators see it on
   the payment view) and re-throws so BullMQ's exponential backoff
   retries the job.

8. **Runtime guard — the spine is the only entry point.**
   `DocumentService.generate(req)` throws synchronously if
   `req.docPack === 'ISSUED_POLICY_PACK'`, with a message pointing the
   caller at `enqueueIssuedPolicyPack`. This makes accidental
   reintroduction of an inline issued-pack codepath fail loudly the
   first time the test suite or staging exercises it. `ENDORSEMENT_PACK`
   and all other doc packs continue to flow through `DocumentService`
   normally — only `ISSUED_POLICY_PACK` is locked to the spine.

9. **Endorsement email orchestration.**
   For delta-only endorsements (no evidence pack required) the
   endorsement email is sent inline, attaching only the freshly
   generated `ENDORSEMENT_PACK`. For material endorsements that
   require an evidence pack — i.e. a refreshed `ISSUED_POLICY_PACK` —
   the inline send is intentionally deferred: it returns
   `{ sent: false, missingTypes: ['ASYNC_DOCS_PENDING'] }` and the
   spine worker dispatches the endorsement email after the doc-pack
   generation completes. There is no inline fallback that races the
   worker.

## Consequences

- **The half-issued policy state cannot occur.** Inception and
  doc-pack-event are atomic. The only way docs are missing post-bind
  is a worker-side generation failure, which is observable and
  retried by BullMQ.
- **One spine for every product.** Motor, home, travel, and any
  future product all use the same `enqueueIssuedPolicyPack` call. No
  per-product divergence in how the doc-pack is scheduled.
- **One spine for every channel.** Public (CardCorp), BO bind, BO
  issue, endorsement issuance, v1 API bind, and the public missing-docs
  backfill all converge on the same helper.
- **One spine for every environment.** Local, staging, and production
  all run the outbox path. There is no `DOC_GENERATION_MODE` and no
  `ISSUANCE_DOCS_ASYNC` — those env switches are gone.
- **One generator.** `DocumentGenerator.generateDocumentSet` and the
  `DocumentSet` repository helpers are deleted. The only producer of
  the issued doc pack is the worker handler driven by the spine.
- **The welcome email path is unified.** Only the worker handler
  sends the welcome email, and only after the doc-pack is generated.
  The `/status` endpoint no longer attempts inline / scheduled email
  delivery on re-hit; it returns the current state and lets the
  worker spine do its work.
- **The endorsement email path is unified.** Delta-only endorsements
  send their email inline (no spine work needed). Material
  endorsements defer the email to the spine worker — no inline send
  races the async doc-pack regeneration.
- **No `setTimeout`-based fallbacks anywhere in the issuance
  pipeline.** All retry semantics live where they belong: BullMQ
  exponential backoff for transient generation failures, the relay
  poll loop for Redis unavailability.
- **Reintroducing an inline issued-pack codepath fails loudly.**
  The runtime guard in `DocumentService.generate` throws on
  `docPack === 'ISSUED_POLICY_PACK'`, so any accidental drift surfaces
  the first time tests or staging exercises it.
- **Deploy considerations.** Any in-flight `DOC.GENERATE_ISSUED_POLICY_PACK`
  jobs from before the deploy used the flat-payload shape and will
  fail with a clear `"payload is not a canonical DomainEventEnvelope"`
  error. The originating outbox row (if any) does not exist for
  these — they were direct enqueues — so there is no automatic
  redelivery. Pre-deploy: drain the documents queue (or accept that a
  small number of in-flight jobs will fail and need manual
  re-enqueue via `enqueueIssuedPolicyPackStandalone`).

## Links

- Helper: `backend/modules/policy/app/commands/issuedPackEnqueue.ts`
- Worker handler: `backend/workers/handlers/DOC.GENERATE_ISSUED_POLICY_PACK.ts`
- Runtime guard: `backend/modules/documents/app/documentService.ts`
- BO issuance use case: `backend/modules/policy/app/IssuePolicy.ts`
- BO endorsement use case: `backend/modules/policy/app/IssueEndorsement.ts`
- Public CardCorp issuance: `backend/modules/payments/app/cardcorpPolicyIssuanceService.ts`
- BO bind use case: `backend/modules/policy/app/BindPolicy.ts`
- Outbox relay: `backend/platform/events/relay.ts`
- Domain event envelope: `backend/platform/events/domainEvents.ts`
- Events & projections contract: [events-and-projections.md](../contracts/events-and-projections.md)
- Canonical ownership principle: [ADR-0011](./ADR-0011-policy-state-and-compliance-canonical-placement.md)
