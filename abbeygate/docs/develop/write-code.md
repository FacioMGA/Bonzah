---
title: Write code
audience: developer
status: living
owner: platform-eng
reviewed: 2026-08-14
binding: true
supersedes:
  - docs/engineering/CODING_STANDARDS.md
  - docs/develop/contribute.md
---

# Write code — binding

## Allowed
- TypeScript strict, FE + BE.
- `unknown` for untyped external data; narrow with Zod.
- Files up to 600 effective lines (`max-lines` warn — see [file-size.md](./file-size.md) and ADR-0020).
- Backend logger: Pino (`backend/platform/utils/logger.ts`). Frontend: `frontend/src/shared/lib/logger.ts`.
- Vitest for all tests; `vi.fn()` for mocks at module / network boundaries.

## Forbidden
- New `any` (`@typescript-eslint/no-explicit-any: error`; ratchet only goes down). Genuine exceptions register in `tools/quality/check-any-exceptions.mjs`.
- `console.*` in any source file.
- `innerHTML`. Use `textContent`, `replaceChildren()`, or React refs.
- Silent error swallowing. Backend: structured `{ code, message }`. Frontend: `SessionAwareErrorBoundary` + TanStack Query `onError`.
- Mocking the module under test. Mock at module boundaries.
- Layering violations (table below).
- Mixed-type PRs (substrate + behavioural in one PR — see refactor types).
- Disabling / weakening a CI guard to make CI green. Fix the code or update the guard explicitly.
- Hand-editing `docs/reference/` or `docs/archive/`.

## Backend layering
| Layer | May import | Must not import |
|---|---|---|
| `http/` | `app/` | `domain/` directly, other module internals |
| `app/` | `domain/`, `infra/` adapters, `platform/` | `http/` |
| `domain/` | Other domain files only | `infra/`, `http/`, `platform/` |
| `infra/` | `domain/` types, `platform/` | `http/`, `app/` |

## Frontend zones
| Zone | May import | Must not import |
|---|---|---|
| `surfaces/*` | Product `index.ts`, `shared/*` | Other surfaces, product internals |
| `products/*` | `shared/*`, own internals, other product `index.ts` | `surfaces/*`, other product internals |
| `shared/*` | `shared/*` only | `products/*`, `surfaces/*` |

## Domain purity
Domain code MUST NOT: import Express / Prisma / Redis / BullMQ · call `fetch` / `axios` · use `Date.now()` / `new Date()` without seeding · generate UUIDs at runtime without seeding · read `process.env` · call any logger. If it needs any of these, it belongs in `infra/`.

## Refactor types (mixing blocks merge)
- **A — Substrate**: tooling/imports/paths. Update test wiring; behaviour unchanged.
- **B — Contract drift**: architecture changed, behaviour unchanged. Update structure/tests; behaviour unchanged.
- **C — Behavioural regression**: functionality changed. Requires product signoff + Tier 3 / smoke proof. The golden-path smoke is a migration lock; if it fails after a Type A/B change, it's an unintentional Type C.

## Worker error handling
Throw on recoverable errors (BullMQ retries with exponential backoff). Log every retry with `job.attemptsMade`. On exhaustion: emit `*.exhausted` at `error` level. Do not silently swallow. Reference: `backend/workers/handlers/COMMUNICATION_OUTBOUND.ts`. Thresholds: [contracts/events-and-projections.md](../architecture/contracts/events-and-projections.md).

## Escalation
- **ADR** to: raise `max-lines`, weaken a layering rule, replace logger, change global error strategy.
- **Stop and ask** to: cross-zone import, new `any` exception (and why `unknown` doesn't fit), mock the module under test.

## Links
- Layout: [contracts/modules-and-layers.md](../architecture/contracts/modules-and-layers.md)
- Tests: [test.md](./test.md)
- Guard inventory: [reference/guards.md](../reference/guards.md)
- AI agent contract: [`AGENTS.md`](../../AGENTS.md)
