---
title: Testing strategy
audience: developer
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
supersedes:
  - docs/engineering/TESTING_STRATEGY.md
---

# Testing strategy — binding

## Tiers
| # | Name | Time | Proves | Lives in | Command |
|---|---|---|---|---|---|
| 1 | `contracts-fast` | < 10 s | API shapes, status codes, error codes, required fields | `backend/http/routes/__tests__/` | `npm run test:contracts-fast` |
| 2 | `adapters-medium` | < 60 s | Prisma R/W, Redis ops, external API contracts | `backend/modules/*/infra/__tests__/` | `npm run test:adapters-medium` |
| 3 | `journeys-deep` | < 120 s | Multi-step workflows end-to-end with real domain + infra | `backend/modules/*/app/__tests__/` | `npm run test:journeys-deep` |
| 4 | `smoke` | < 30 s | Golden-path quote→bind→issue lifecycle + document pack | `e2e/` | `npm run smoke:quote-bind-issue` |
| 5 | `browser-e2e` | < 5 min | Customer wizard happy path + post-purchase redirect (ADR-0030) | `e2e/browser/` | `npm run test:browser:e2e` |

Tier 1 uses in-memory fakes (no DB). Tiers 2 + 3 use real Postgres (local Docker). Tier 4 is a **migration lock**: never weaken or delete it. Tier 5 lands post-UAT under ADR-0030 and **complements**, never replaces, tier 4.

## Specialised proofs
| Command | Proves |
|---|---|
| `npm run test:tenant-isolation` | PostgreSQL RLS isolation across tenants |
| `npm run test:webhook-inbound-auth` | Webhook auth (HMAC, signature) |
| `npm run test:auth-transport-policy` | JWT Bearer transport enforcement |
| `npm run test:bdx-import` | BDX import contract compliance |
| `npm run test:integration:extended` | Binding integrity + behaviour schema + issued doc-pack integration |
| `npm run proof:public-bundle-isolation` | Public bundle contains no BO symbols |

## Allowed
- Co-located: `__tests__/foo.test.ts` or `foo.test.ts` next to source.
- `/* @vitest-environment happy-dom */` for DOM tests.
- Real Postgres for tiers 2 + 3.

## Forbidden
- Top-level `tests/` directory.
- Domain tests importing Prisma / Express / Redis / BullMQ; calling `fetch` / `axios`; using `Date.now()` / `new Date()` without seeding; generating UUIDs without seeding.
- Mocking the module under test. Mock at module / network boundaries.
- Weakening or deleting the smoke test.
- Refactor changing status codes, response keys, error codes, or critical side effects.

## Mock policy
Mock at infra adapter boundary or platform utility boundary. Frontend: mock at network boundary (TanStack Query / fetch), not at component level. Domain logic must be testable through pure function calls with no mocking.

## Placement
| Test type | Lives in |
|---|---|
| Domain unit | `backend/modules/<name>/domain/__tests__/` |
| Application workflow | `backend/modules/<name>/app/__tests__/` |
| Route contract | `backend/http/routes/__tests__/` |
| Infra adapter | `backend/modules/<name>/infra/__tests__/` |
| Frontend product | `frontend/src/products/<name>/**/__tests__/` |
| Worker handler | `backend/workers/handlers/__tests__/` |
| E2E journey | `e2e/` |

## Escalation
- **ADR** to: add a new tier, relax a domain-purity constraint, replace Vitest.
- **Stop and ask** to: skip a journeys-deep test, weaken a contract test in response to a refactor.

## Links
- [write-code.md](./write-code.md) · [reference/guards.md](../reference/guards.md)
