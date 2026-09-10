---
title: Events and projections contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Events and projections — binding contract

## Governs
Domain event emission, BullMQ workers, projection rebuilds, runtime log shape.

## Allowed
- Emit events from `backend/modules/*/app/` **after** the Prisma write succeeds, via `backend/platform/events/` relay (the only enqueue path).
- Persist the canonical `quoteData` and `quoteResponse` in the immutable bound-risk snapshot before emitting issuance work; binding fails closed when either is absent, and `DOC.GENERATE_ISSUED_POLICY_PACK` consumers use that evidence and fail closed if the invariant is breached.
- Background work in `backend/workers/handlers/<QUEUE.NAME>.ts`, registered in `registerBuiltInHandlers.ts`, declared in `QUEUE_NAMES` in `backend/platform/events/queue.ts`.
- Projection rebuilds via idempotent `*.RECONCILE` / `*.BACKFILL` handlers.
- System reconcile schedulers use deterministic `Outbox.eventId` values per tenant and schedule window; the unique event ID is the cross-replica dedupe boundary.
- Mark a handler-less outbox event **audit-only** by adding its type to `AUDIT_ONLY_EVENT_TYPES` in `backend/platform/events/queue.ts` (pure observability records with no consumer, e.g. `WEBHOOK.CARDCORP.*`). The relay records it processed instead of enqueuing a data-sync job.
- Pino log lines containing `event`, `env`, `service`, `cid`, `status` plus per-flow identifiers (comms: `messageId`, `provider`; bdx: `binderId`, `exportHash`; queue: `queue`, `jobId`, `attemptsMade`).

## Forbidden
- Enqueue-then-write. Write must succeed first.
- Direct `queue.add()` outside the relay.
- Synchronous slow side effects in HTTP handlers (Puppeteer, Twilio, SendGrid, LibreOffice). Enqueue them.
- Routing a handler-less outbox event through the default data-sync queue — it throws `Unsupported data-sync queue job` and accrues failed jobs. Add the type to `AUDIT_ONLY_EVENT_TYPES`.
- Silently swallowing exhausted jobs. Throw on recoverable errors; emit `*.exhausted` at `error` level.
- Automatic DLQ replay. Exhaustion requires ops intervention.
- `console.*` in workers.
- Worker handler missing from [reference/workers.md](../../reference/workers.md) — `guard:docs-code-consistency` fails.

## Escalation
- **Write an ADR** to: introduce a new queue, change retry/backoff classes, change transport (BullMQ → other), add a third worker process, introduce DLQ auto-replay.
- **Stop and ask** to: weaken idempotency on a reconcile/backfill handler, emit from outside the relay, bypass the log contract.

## Links
- Worker inventory + recovery: [reference/workers.md](../../reference/workers.md) · [reference/runbooks-coverage.md](../../reference/runbooks-coverage.md)
- Operate: [monitoring.md](../../operate/monitoring.md) · [incident-response.md](../../operate/incident-response.md) · [backup-and-restore.md](../../operate/backup-and-restore.md)
- Related: [modules-and-layers.md](./modules-and-layers.md) · [tenancy.md](./tenancy.md)
