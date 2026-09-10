---
title: ADR-0028 typed HTTP handler wrapper
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-25
binding: true
---

# ADR-0028: Typed HTTP handler wrapper for Express routes

## Status

Accepted. Phase 1 (wrapper + companion guards + canonical-ownership row) landed 2026-05-21. Migration of existing handlers is incremental — see "Adoption plan" below.

## Context

A walk of the backend program with the TypeScript compiler API counted **308 declaration sites whose resolved type contains `any`** (the artefact at `artifacts/quality/any-resolved-offenders.json`). Categorised by origin:

- **270 are Express handler parameters** (`req`/`res`/`next`/`RequestHandler`).
- **37 are BullMQ worker parameters** (`job: Job`).
- **1 is from TypeScript's own `lib.d.ts`** (`Iterable<T>` propagates through `Iterator<T, TReturn = any, TNext = any>`).

Zero of the 308 are user-authored `: any`. **Every backend any in this codebase comes from a community generic that defaults to `any`** and was never parametrized.

Before Phase 1 of the type-safety ratchet (`backend/platform/types/express.d.ts` consolidation, [PR ref], canonical-ownership row added), the same any-default was being papered over with **193 secondary casts** in handler bodies — `(req as Request & { user?: ... }).user`, `req.headers[X] as string`, `String(req.headers[…] || '')`, `req.body as Foo`, `(job.data as Type)`. Those casts existed only because `req.body`, `req.params`, `req.query`, `req.headers` were each `any` at the signature, so handlers had no choice but to launder values one access at a time.

`check-http-input-validation.mjs` already requires Zod parsing of `req.body` (or an allowlist entry). That guard is met today by inlining `Schema.parse(req.body)` inside each handler — which works, but does **not** narrow `req.body` itself, so the laundering pattern persists for `req.params`, `req.query`, and any subsequent reads of `req.body`.

The validation contract (`docs/architecture/contracts/validation.md`) is explicit that **product** validation flows through `validateForContext({ productCode, stage, actor, data })`. That is unchanged. This ADR is about HTTP-boundary input parsing for non-product handlers (auth, communications, payments routing, internal admin, BO actions, webhook envelopes) — the layer where Zod-at-the-boundary is already idiomatic.

## Decision

Add a single canonical, thin wrapper at `backend/platform/http/typedHandler.ts` that parametrizes Express's `Request` with caller-supplied Zod schemas, runs the parses on entry, returns a typed 400 on failure, and delegates to a strongly-typed inner handler. Wire it via:

1. The wrapper itself (`backend/platform/http/typedHandler.ts`, ≈ 110 LOC including JSDoc, no business logic).
2. A canonical-ownership row claiming "HTTP boundary input parsing wrapper" with the wrapper as the only allowed implementation.
3. A diff-only guard `check-http-handler-typing.mjs` that fails net-new handler signatures using bare `Request` / `Response` / `RequestHandler` without generics, unless wrapped through `typedHandler`. Existing handlers stay on a baseline (lower-only); new code must use the wrapper.
4. A repo-wide companion guard `check-typed-handler-schema-quality.mjs` that fences three failure modes that the diff guard alone cannot catch:
   - **Banned schema shapes inside `typedHandler(SCHEMAS, …)`:** `z.any()`, `z.unknown()`, `.passthrough()`, `.catchall(...)` — these all preserve unknown soup while satisfying the wrapper's signature ("compliant but fake" usage).
   - **Body-required-when-read:** `typedHandler({}, async (req) => req.body)` — declaring no `body:` schema yet reading `req.body` defaults the slot to the unsafe top type, defeating the wrapper's purpose.
   - **Blessed-cast lockdown:** `as TypedRequest<…>` is the wrapper's one acknowledged conditional-type-bridging cast (TypeScript can't resolve the inferred-from-schema type at the assignment site inside the wrapper). It is allowed **only** in `backend/platform/http/typedHandler.ts`. Reproducing it elsewhere re-introduces the laundering pattern the wrapper exists to prevent.

### Wrapper shape (final, as landed)

The implementation lives at `backend/platform/http/typedHandler.ts`. Key shape:

```ts
import type { ParamsDictionary } from 'express-serve-static-core';
import type { ParsedQs } from 'qs';
import { ZodError, type ZodType, type z } from 'zod';

export interface HandlerSchemas {
  body?: ZodType<unknown>;
  params?: ZodType<ParamsDictionary>;
  query?: ZodType<ParsedQs>;
}

type InferOrDefault<S, D> = S extends ZodType ? z.infer<S> : D;

export type TypedRequest<S extends HandlerSchemas> = Request<
  InferOrDefault<S['params'], ParamsDictionary>,
  unknown,
  InferOrDefault<S['body'], unknown>,
  InferOrDefault<S['query'], ParsedQs>
>;

export function typedHandler<S extends HandlerSchemas>(schemas: S, handler: TypedHandlerFn<S>) {
  return async (req, res, next) => {
    const typedReq = req as TypedRequest<S>;          // blessed cast, locked to this file
    try {
      if (schemas.body)   typedReq.body   = schemas.body.parse(req.body)     as TypedRequest<S>['body'];
      if (schemas.params) typedReq.params = schemas.params.parse(req.params) as TypedRequest<S>['params'];
      if (schemas.query)  typedReq.query  = schemas.query.parse(req.query)   as TypedRequest<S>['query'];
      await handler(typedReq, res, next);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? 'Request validation failed', details: error.issues },
        });
        return;
      }
      next(error);
    }
  };
}
```

Notes on the final shape:

- `HandlerSchemas` is **parametrized** so the schemas cannot legally widen the slot they cover. `body` parses to `unknown` (narrowed at the call site); `params` and `query` parse to Express's runtime shapes (`ParamsDictionary`, `ParsedQs`), so a per-route schema must be structurally compatible with them — `z.object({ id: z.string() })` works, `z.object({ id: z.number() })` rightly does not (Express delivers params as strings; coerce inside the schema).
- `as TypedRequest<S>` exists because TypeScript cannot resolve the conditional `InferOrDefault<…>` assignment back through the indexed-access types at the assignment sites. It is the wrapper's **single, blessed cast**, acknowledged as a "controlled radioactive zone" and locked to this one file by `check-typed-handler-schema-quality.mjs`.
- The error envelope (`{ success: false, error: { code: 'VALIDATION_ERROR', message, details } }`) matches the existing convention used by `accessControlRouter` and other typed routers.
- `correlationId` and `auditContext` continue to be set by the existing middleware chain and read off `req` (typed by the canonical augmentation, ADR-0027 / Phase 1 of this work).
- Product validation continues to flow through `validateForContext`. `typedHandler` is HTTP-shape parsing only; it does not replace product/stage/actor reasoning.

### Schema-honesty rule (added 2026-05-21)

The wrapper is a perimeter fence; without a schema-quality rule, "comply with the wrapper, preserve unknown soup" becomes the new laundering ritual. Therefore:

- **Inside `typedHandler(SCHEMAS, …)` callsites, the following Zod shapes are forbidden:** `z.any()`, `z.unknown()` (in any form, including `z.record(z.unknown())` and `z.array(z.unknown())`), `.passthrough()`, `.catchall(...)`. If a field genuinely carries arbitrary JSON, narrow it once with a discriminated union; if there is no narrower contract today, attach a `TODO(FAC-####): owner=… expires=… deletionPR=… reason=…` exception with an expiry date — the guard recognises that tag and the exception ledger reaps it on expiry.
- **`typedHandler({}, async (req) => req.body)` is forbidden.** A schema object that omits `body:` declares "this route has no parseable body"; reading `req.body` after that defeats the wrapper's purpose because the slot defaults to the unsafe top type.
- **`as TypedRequest<…>` outside the wrapper file is forbidden.** Use `typedHandler(schemas, handler)` — the inner handler argument is already typed as `TypedRequest<typeof schemas>`; the cast is unnecessary at the call site.

These rules are enforced by `tools/quality/check-typed-handler-schema-quality.mjs` (repo-wide; runs in the CI quality gate stage `typed_handler_schema_quality`).

### Adoption plan

1. Land the wrapper + canonical-ownership row + guard. Do **not** refactor existing handlers in the same PR.
2. Migrate handlers in waves, smallest first (auth router → communications router → policy/http/* → workers/handlers → product motor controller). Each wave drops the resolved-any baseline (`tools/quality/any-resolved-baseline.json`) by the count of handler signatures that switched.
3. After ~half the handlers have moved, flip the guard from "new handlers must use the wrapper" to "all handlers must use the wrapper or be on an explicit deprecation allowlist."

### Estimated impact at completion

From the artefact:

- **270 Express handler resolved-any declaration sites → 0** (signatures parametrized via wrapper).
- **193 secondary casts in handler bodies → 0** (no longer needed; `req.body`, `req.params`, `req.query` typed).
- **Net laundering removed: ≈ 460 LOC** in exchange for ≈ 60 LOC of wrapper.
- BullMQ `Job` (37 sites) is a parallel decision (separate ADR if pursued), out of scope here.

## Alternatives considered

1. **No wrapper; require `Request<P, ResB, ReqB, ReqQ>` parametrization at every handler signature.** Rejected — it pushes the same boilerplate to every site and gives no place to centralize the Zod parse. Failure mode: developers write `Request<unknown, unknown, BodySchema, unknown>` and still call `Schema.parse(req.body)` inline; the laundering pattern survives.
2. **Use an existing community wrapper (`zod-express-middleware`, `express-zod-api`).** Rejected for now — adds a runtime dependency for a 60-LOC concept and ties our error-envelope shape to the library's. Worth re-evaluating if the wrapper grows.
3. **Replace Express with Fastify (or hono).** Out of scope for this ADR; that's a much bigger migration with its own ADR. The wrapper approach is forward-compatible (the inner handler's typed signature is the same shape Fastify natively gives).
4. **Lean only on `check-http-input-validation.mjs` and stop there.** Rejected — that guard requires a Zod parse near `req.body` but does not narrow the type that flows through. The 193 secondary casts are evidence that "Zod parse, then ignore the result's type" is a real, ongoing failure mode.

## Consequences

- **Positive:** removes the largest single class of "any" in the codebase; eliminates 193 cast sites; gives Cursor / LLM contributors a single, obvious template; preserves the existing validation-contract spine; works incrementally.
- **Negative:** introduces one more thin abstraction; new handlers MUST use the wrapper, which is a small constraint (and exactly what the guard makes machine-checkable).
- **Risk:** if a handler uses a non-Zod validator (Joi, ajv, hand-rolled), the wrapper does not help. Today the repo standardises on Zod; if that ever changes, the wrapper signature changes with it, which is appropriate.

## Required follow-up before merge

- [x] Approval from platform-eng owner.
- [x] Decide error-envelope shape on Zod failure — `{ success: false, error: { code: 'VALIDATION_ERROR', message, details } }`.
- [x] Decide whether `params` / `query` must be parsed when not passed — defaults to Express's narrow runtime types (`ParamsDictionary`, `ParsedQs`); `body` defaults to `unknown` so handlers cannot accidentally read it without parsing.
- [ ] Decide migration cadence (wave size, baseline-drop convention) — owner: platform-eng; tracked in next quality-ratchet planning slot.
- [x] Companion ADR for BullMQ job typing — see ADR-0029.

## Links

- Wrapper implementation: `backend/platform/http/typedHandler.ts`.
- Wrapper tests: `backend/platform/http/__tests__/typedHandler.test.ts`.
- Diff guard (bare-signature ban): `tools/quality/check-http-handler-typing.mjs`.
- Schema-honesty + blessed-cast guard: `tools/quality/check-typed-handler-schema-quality.mjs`.
- Type-safety ratchet baseline: `tools/quality/any-resolved-baseline.json` (308 backend / 51 frontend).
- Offender artefact: `artifacts/quality/any-resolved-offenders.json` (per-site).
- Existing diff guard for `any`: `tools/quality/check-no-new-any.mjs` (DIFF_ANY_PATTERNS).
- Existing HTTP input validation guard: `tools/quality/check-http-input-validation.mjs`.
- Validation contract: `docs/architecture/contracts/validation.md`, `validation-runtime.md`.
- Canonical-ownership rows: "Express Request augmentation surface" (Phase 1) and "HTTP boundary input parsing wrapper" (this ADR).
- Phase 1 companion guard: `tools/quality/check-express-request-augmentation-single-source.mjs`.
- Sibling ADR for BullMQ: ADR-0029.
