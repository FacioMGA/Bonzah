# Abbeygate Platform

**Insurance operating system for MGAs, coverholders, and carriers.**

Facio Gen 2 runs the full insurance lifecycle — quote, underwriting, policy lifecycle, billing, claims, reporting — across multiple jurisdictions, products and surfaces from a single deployment.

> **Current scope:** Lloyd's coverholder scheme operating across Cyprus, Portugal, Spain and Greece. Three products (Motor, Home, Travel). Three frontend surfaces (back office, client portal, public quote).

---

## What it is, in one paragraph

A monorepo TypeScript platform: Node + Express backend in `backend/`, React + Vite frontend in `frontend/`, shared workspaces in `packages/`, BullMQ workers under `apps/worker`, Prisma + PostgreSQL data layer, Redis for cache and locks, Helm + AKS deployment under `infrastructure/`. Strict module/layer boundaries are mechanically enforced by 100+ CI guards. Multi-tenant on a shared schema with row-level scoping (ADR-0009) and per-request `AsyncLocalStorage` context. Multi-product through a declarative `IProductAdapter` contract. Multi-jurisdiction through `Tenant` rows that carry tax rates, document templates and underwriting authority.

---

## Start here (pick exactly one)

| Audience | Read |
|----------|------|
| Developer writing code | [`docs/start-here/01-developer.md`](./docs/start-here/01-developer.md) |
| Operator running production | [`docs/start-here/02-operator.md`](./docs/start-here/02-operator.md) |
| AI coding agent | [`AGENTS.md`](./AGENTS.md) (strict, 100-line contract) and [`docs/start-here/03-agent.md`](./docs/start-here/03-agent.md) |
| Architect amending the platform | [`docs/start-here/04-architect.md`](./docs/start-here/04-architect.md) |

---

## Principles

1. **Documentation is enforced (ADR-0010).** If code and docs disagree, docs win — code must change or CI fails.
2. **Binding contracts live in [`docs/architecture/contracts/`](./docs/architecture/contracts/).** Every contract states what is allowed, what is forbidden, and what triggers escalation.
3. **Generated inventories live in [`docs/reference/`](./docs/reference/).** Modules, workers, guards, contracts, and runbook coverage are produced by `npm run docs:generate` from the codebase. Hand-edits fail CI.
4. **Operational runbooks live in [`docs/operate/`](./docs/operate/).** One canonical procedure per operation; superseded predecessors are archived under `docs/archive/` (e.g. `docs/archive/pre-aks/`).
5. **Architecture is layered and machine-enforced.** Backend uses `http -> app -> domain -> infra`. Frontend uses `surfaces -> products -> shared`. CI guards reject violations.
6. **Multi-tenancy is shared-schema, row-level (ADR-0009).** `req.tenant` is the MGA jurisdiction; `req.tenantId` is the customer account. Both can be set on the same request and must never be conflated.
7. **Per-product authority lives in `packages/products/<product>/profile.ts`.** Shared code is product-agnostic; product-specific behaviour is dispatched through the manifest.

---

## Quick commands

```bash
npm install                       # install all workspaces
npm run db:push:dev && npm run db:seed
npm run dev                       # api + frontend in parallel
npm run dev:worker                # bullmq worker
npm run gate:agent                # full pre-push gate

npm run docs:generate             # rewrite generated inventories
npm run docs:generate:check       # CI: fail on drift
```

Operational commands (deploy, rollback, restore, incident response) live in [`docs/operate/`](./docs/operate/).

---

## Repository layout

```
apps/                    # Composition roots (api, worker, scripts)
backend/                 # Node + Express, Prisma, modules under backend/modules/
frontend/                # React + Vite, surfaces under frontend/src/surfaces/{bo,client,public}
packages/                # @facio/validation, @facio/products, etc.
prisma/                  # Schema + migrations
infrastructure/          # Helm chart for AKS, K8s manifests, Docker
tools/                   # quality/ (CI guards) + docs/ (doc generators)
docs/                    # Two entrypoints: AGENTS.md (machines), docs/start-here/ (humans)
```

Module / worker / guard / contract inventories are generated; see [`docs/reference/`](./docs/reference/).

---

## How decisions become enforceable

```
Plan  ──▶  ADR  ──▶  Contract  ──▶  Generated inventory  ──▶  CI guard
```

A plan motivates the change. An ADR records the decision. A binding contract under `docs/architecture/contracts/` describes the rule. A generated inventory under `docs/reference/` proves the rule covers all of code. A CI guard fails the PR when code disagrees with the contract.

---

## Status

| Area | State |
|------|-------|
| Production tenant | `abbeygate-cy` (Cyprus motor) |
| Built products | Motor (production), Home (built), Travel (built) |
| Active jurisdictions | CY, PT, ES, GR (rows in `Tenant`) |
| Surfaces | `bo`, `client`, `public` (CI-enforced bundle isolation) |
| Doc governance | Strict in CI — 6 docs guards (`docs-frontmatter`, `docs-single-source`, `docs-stale`, `docs-runbook-coverage`, `docs-code-consistency`, `docs-max-lines`) all error-by-default per ADR-0010 |

---

## Reference

- [`AGENTS.md`](./AGENTS.md) — strict AI agent contract (machines)
- [`docs/start-here/`](./docs/start-here/) — audience-routed entry (humans)
- [`docs/reference/`](./docs/reference/) — generated inventories (modules, workers, guards, contracts, runbooks, npm scripts)
- [`docs/architecture/contracts/`](./docs/architecture/contracts/) — binding contracts
