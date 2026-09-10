---
title: ADR-0029 typed BullMQ job handlers
audience: architect
status: draft
owner: platform-eng
reviewed: 2026-05-20
binding: false
---

# ADR-0029: Typed BullMQ job handlers and producer/consumer schema spine

## Status

Proposed. Companion to ADR-0028 (typed HTTP handler wrapper).

## Context

The same TypeScript-compiler walk that produced ADR-0028's evidence (`artifacts/quality/any-resolved-offenders.json`) found **30 declaration sites in `backend/workers/handlers/` whose resolved type contains `any`**. Every one of them is a handler signature `(job: Job)` accepting BullMQ's any-defaulted generic:

```ts
class Job<DataType = any, ReturnType = any, NameType extends string = string>
```

The canonical owner is at `backend/workers/index.ts`:

```ts
export type JobHandler = (job: Job) => Promise<unknown>;
```

— and is itself any-defaulted. This is **not "the wrong canonical owner is missing"**; the spine *is* the source of the laundering. Per AGENTS.md "Stop and ask … to change a contract shape", that change requires this ADR.

A pre-ADR audit of the 27 handler files (`backend/workers/handlers/`) at 1,414 LOC catalogued **68 laundering shapes** in handler bodies driven by `job.data` being `any`:

| Shape | Count | Why it exists |
|---|---:|---|
| `job.data?.X` optional-chain reads | 43 | `job.data` is `any`, every read must be defended |
| `String(job.data?.X \|\| '…')` defensive coercions | 21 | Same — coerce-or-default chain |
| Multi-fallback chains `(a \|\| b \|\| c)` on a single field | 13 | Producer/consumer schema drift, papered over |
| `(job.data as Record<string, unknown>)` polite-any casts | 4 | Same, with a type-assertion flavour |
| `typeof job.data === 'object'` runtime guards | 4 | Defensive against `null` / scalar payloads |

These shapes were the symptom of a deeper hole: **producer-side enqueue paths were also untyped**. The relay's signature is `addJobAndWait<T = unknown>(eventType: string, payload: unknown, …)`. There is no schema registry tying an `eventType` string to a payload shape. The contract between an HTTP route writing to the outbox and a worker reading from Redis was a duck-typed string. Six concrete latent bugs were identified during the audit (cancellation acknowledgment routed to ops, BDX validation silently disabled by whitespace, doc-pack mis-classification on missing `targetType`, etc.) — all manifestations of the same root cause.

### What Phase 1 already did (without an ADR, under the no-defensive-fallbacks rule)

Per AGENTS.md "Make the smallest change that preserves the contract" and the binding `no-defensive-fallbacks` skill, all 27 handlers were rewritten to:

1. Declare an inline Zod schema for the expected `job.data` shape.
2. Replace soft-skip / silent-fallback paths with `Schema.parse(job.data)` — failures surface as BullMQ retries → `*.exhausted` events instead of dropped customer emails or mis-classified documents.
3. Drop `String(job.data?.X || '…')` armor in favour of the typed `data.field` returned by the parse.
4. Drop `(job.data as Record<string, unknown>)` polite-any casts.
5. Tighten enums where the downstream API used a literal union (`MotorDocPack`, `'CUSTOMER' | 'BO' | 'SYSTEM'`) — this surfaced two real type-errors that the `any` regime had hidden.

**Phase 1 outcome:**

- All 6 confirmed latent bugs converted from silent failures into loud failures (parse errors).
- 68 laundering shapes inside handler bodies → ~5 (only the env-knob fallbacks for tunable batch sizes remain — those are operational levers, not silent fallbacks for required data).
- ~150 LOC of laundering removed.
- Backend resolved-any baseline: 308 → 307. **The drop is intentionally small.** The handler bodies are clean, but every signature is still `(job: Job)`. The remaining 30 sites are a single contract-shape away from going to zero.

### What Phase 1 deliberately did NOT do

- Did not change the canonical `JobHandler` type — that's a contract-shape change scoped to this ADR.
- Did not add a producer-side schema registry — adding shared infrastructure is a new abstraction scoped to this ADR.
- Did not deduplicate the `envInt(name)` helper that now appears in 8 projection handlers — extracting it before the contract decision is settled would lock us into a particular shape.
- Did not fix `RENEWAL.EMAIL_SCAN`'s `asRecord(policy.quoteData)` (Prisma `Json` column laundering) — that's a different problem (Prisma JSON typing), tracked as a follow-up.

## Decision

Promote the inline Phase 1 schemas into a single canonical registry, parametrize the canonical `JobHandler` type by data shape, and add a producer-side typed enqueue helper that consults the same registry. Wire it via:

1. A new generic `JobHandler<TData>` type in the existing canonical owner (`backend/workers/index.ts`).
2. A canonical schema registry keyed by job name (`JobSchemas`).
3. A typed enqueue helper `enqueueJob<JobName extends keyof JobSchemas>(name, data, opts?)` so producer call-sites are type-checked against the same schema the consumer parses with.
4. An amendment to `docs/architecture/contracts/events-and-projections.md` adding "every handler MUST register a Zod schema; every enqueue MUST go through `enqueueJob`" to the Allowed/Forbidden lists.
5. A guard `check-bullmq-handler-typing.mjs` that fails any `registerHandler('NAME', …)` call without a corresponding entry in `JobSchemas`, and any `queue.add` / `queues.*.add` call outside the typed `enqueueJob` helper (existing call-sites stay on a baseline; new code must use the helper).

### Wrapper shape (illustrative — final shape to be reviewed)

```ts
// backend/workers/index.ts (canonical owner, amended)
import type { Job } from 'bullmq';
import type { z, ZodType } from 'zod';

export type JobHandler<TData = unknown, TReturn = unknown> = (
  job: Job<TData>,
) => Promise<TReturn>;

// JobSchemas is the canonical registry — one entry per registerHandler() call.
// Adding a new handler without an entry fails check-bullmq-handler-typing.mjs.
export const JobSchemas = {
  'EMAIL.CANCELLATION_REQUESTED': EmailCancellationRequestedSchema,
  'EMAIL.CANCELLATION_CONFIRMED': EmailCancellationConfirmedSchema,
  // … one per handler …
} as const;

export type JobName = keyof typeof JobSchemas;
export type JobData<N extends JobName> = z.infer<(typeof JobSchemas)[N]>;

const handlers: { [N in JobName]?: JobHandler<JobData<N>> } = {};

export function registerHandler<N extends JobName>(
  name: N,
  handler: JobHandler<JobData<N>>,
): void {
  handlers[name] = handler;
}

// The dispatcher (queue.ts) calls this with `job.name` as N and runs the
// schema once at the boundary. Handlers are written against the typed
// `Job<JobData<N>>` and never touch raw `job.data`.
export async function dispatch(job: Job): Promise<unknown> {
  const name = job.name as JobName;
  const schema = JobSchemas[name];
  const handler = handlers[name];
  if (!handler) throw new Error(`No handler registered for ${name}`);
  const parsed = schema.parse(job.data);
  return (handler as JobHandler<unknown>)({ ...job, data: parsed } as Job<unknown>);
}
```

```ts
// backend/platform/events/typedEnqueue.ts (new, ~30 LOC)
export async function enqueueJob<N extends JobName>(
  name: N,
  data: JobData<N>,
  opts?: { queue?: 'notifications' | 'documents' | 'dataSync'; attempts?: number },
): Promise<void> {
  // Resolves the right queue (defaults via routeEventToQueue), validates
  // `data` once at the call site (catches drift in tests, not in
  // production), and forwards to BullMQ.
  const validated = JobSchemas[name].parse(data);
  await queues[opts?.queue ?? routeEventToQueue(name).queue].add(name, validated, opts);
}
```

- Producer call sites (`cancellationsRouter.ts`, `uwDecisionRouter.ts`, `motor/quotes/service.ts`, `DocxAdapter.ts`, …) move from `outbox.create({ data: { eventType, payload } })` and `queues.*.add(name, payload)` to `enqueueJob('EVENT.NAME', { … })`. The producer-consumer drift that produced Bug 1 (cancellation request without `to`) becomes a TypeScript compile-error.
- The single `JobSchemas` registry is the canonical owner of every job payload shape. New handler files import their schema from a co-located file (e.g. `EMAIL.CANCELLATION_REQUESTED.schema.ts`) and the registry imports them. This keeps file boundaries clean and lets the guard verify "one schema per registered handler."
- Existing `addJobAndWait<T>` stays, but its signature gets typed via the registry: `addJobAndWait<N extends JobName>(name, data: JobData<N>, …)`.

### Adoption plan

1. Land the canonical-owner change (`JobHandler<TData>`), the empty `JobSchemas` registry, the `enqueueJob` helper, the contract amendment, and the guard. Do **not** migrate individual handlers in the same PR.
2. Migrate handlers in waves, smallest first. Each wave:
   - Moves the inline Zod schema from the handler file into the registry.
   - Changes the handler signature from `(job: Job)` to `(job: Job<JobData<'NAME'>>)`.
   - Drops the `Schema.parse(job.data)` line — the dispatcher now does it once.
   - Lowers the resolved-any baseline by 1 (or by the count of signatures that moved).
3. Migrate the producer side in lock-step — every `queues.*.add(NAME, payload)` and `outbox.create({ eventType: NAME, payload })` becomes `enqueueJob('NAME', payload)`. The compiler enforces shape parity.
4. After all handlers have moved, flip the guard from "new handlers must register a schema" to "every handler must register a schema (no allowlist)."

### Estimated impact at completion

- **30 BullMQ resolved-any handler-signature sites → 0** (signatures parametrized via the typed canonical owner).
- **Inline Zod schemas in 27 handler files → 1 canonical registry** (eliminates duplicated schema declarations between producer and consumer).
- **Producer-consumer drift becomes a compile-error**, not a runtime parse-error. Bug 1 (cancellation request enqueue without `to`) would fail `tsc` instead of failing in the worker after retries.
- **Zero net new LOC at the spine layer** — the registry is the same Zod that already lives in the 27 handler files; it moves rather than grows.

### Out of scope (separate ADRs / follow-ups)

- Replacing BullMQ with another queue (Cloud Tasks, Temporal). The `enqueueJob` helper is the only call-site any of them care about, so this ADR is forward-compatible with such a swap.
- Auto-DLQ replay. Already explicitly forbidden by `events-and-projections.md`; not changing.
- Strongly-typing Prisma `Json` columns (`Policy.quoteData`, etc.). That is a separate spine — see the `RENEWAL.EMAIL_SCAN.asRecord(policy.quoteData)` site.

## Alternatives considered

1. **Keep Phase 1's inline-schema-per-handler approach permanently.** Rejected — it leaves the canonical `JobHandler` any-defaulted (so `Job<DataType>` propagates `any` everywhere it's mentioned in the codebase, including the 30 resolved-any sites this ADR is trying to close), and it leaves the producer side unchecked. Producer-consumer drift is exactly Bug 1 — it has to be type-checked, not just runtime-parsed.
2. **One generic `Job<T>` per handler with no central registry.** Rejected — every producer would need to re-import the per-handler schema, which is fragile (rename a handler file → break every producer). The registry is what makes the spine machine-discoverable.
3. **Code-generate the registry from `registerHandler` calls (build step).** Rejected as Phase-2 scope creep. A handwritten registry is short (≈ 30 entries), survives `tsc` checking, and avoids a generator that itself has to be CI-verified.
4. **Adopt a community library (`bullmq-zod`, `bullmq-typed`).** None match the ergonomics we need (registry-driven, single-source-of-truth, integrates with our existing `routeEventToQueue` + outbox relay). The proposed wrapper is ≈ 60 LOC including the helper — smaller than any library wrapper layer.

## Consequences

- **Positive:** closes the largest remaining cluster of resolved-any after ADR-0028; eliminates producer-consumer drift as a class of bug; one machine-checkable place to look for "what shape does this job carry?"; reduces ops noise (parse failures → compile failures); preserves existing `routeEventToQueue` / outbox-relay spine.
- **Negative:** introduces one new abstraction (`JobSchemas`, `enqueueJob`); the canonical owner gains a generic parameter; one more guard in CI.
- **Risk:** if a producer accidentally bypasses `enqueueJob` (e.g. by calling `queue.add` directly), the consumer parse still catches it — but the compile-time check is gone. The guard `check-bullmq-handler-typing.mjs` is what makes that kind of bypass visible.

## Required follow-up before merge

- [ ] Approval from platform-eng owner.
- [ ] Decide registry location: `backend/workers/index.ts` (current canonical owner) vs new `backend/workers/registry.ts`.
- [ ] Decide how `outbox.create({ eventType, payload })` interacts with `enqueueJob` (the relay reads the outbox row and dispatches; the schema parse happens at dispatch time today). Options: (a) the outbox writer also goes through `enqueueJob`-style validation; (b) the relay does the parse; (c) both. Phase 1 effectively chose (b) for the consumer. Producer-side validation makes (a) attractive.
- [ ] Decide migration cadence (wave size, baseline-drop convention, deadline for full migration).
- [ ] Resolve the 6 latent producer bugs Phase 1 surfaced (most importantly: `EMAIL.CANCELLATION_REQUESTED` enqueued without `to` — does the customer get an acknowledgment, or does the underwriting team? product decision).
- [ ] Decide what to do about the existing `dispatch` flow (where is the registry lookup wired in — at queue construction time, in `getHandler()`, in a new dispatcher?).

## Links

- Companion ADR: `docs/architecture/decisions/ADR-0028-typed-http-handler-wrapper.md`
- Type-safety ratchet baseline: `tools/quality/any-resolved-baseline.json` (307 backend / 51 frontend after Phase 1).
- Offender artefact: `artifacts/quality/any-resolved-offenders.json` (per-site).
- Diff guard: `tools/quality/check-no-new-any.mjs` (DIFF_ANY_PATTERNS).
- Worker inventory: `docs/reference/workers.md`.
- Events-and-projections contract (to be amended): `docs/architecture/contracts/events-and-projections.md`.
- No-defensive-fallbacks skill (the rule Phase 1 enforced): `.cursor/skills/no-defensive-fallbacks/SKILL.md`.
- Existing canonical owner (the spine to be amended): `backend/workers/index.ts`.
