---
title: AI agent entrypoint
audience: agent
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# AI agent entrypoint

Human-readable companion to [`AGENTS.md`](../../AGENTS.md). `AGENTS.md` is the strict, machine-readable contract; this file explains *why* and how to navigate.

## Operative rule
> **If code and docs disagree, docs win. Code must change or CI fails.**

This inverts the default. Binding contracts under `docs/architecture/contracts/` are the source of truth; CI guards under `tools/quality/` enforce code conforms. ADR-0010 codifies this; do not ship a change that violates it.

## Navigation rules
1. **Start at the binding source of truth.** Do not infer architecture from code — the repo contains legacy, archived, and transitional patterns.
2. **Filter by frontmatter.** Every doc carries `audience` and `status`. Treat `status: archived` as historical evidence, not instructions.
3. **`docs/reference/` is ground truth.** Regenerated from code on every CI run. Hand-edits fail `guard:docs-code-consistency`.
4. **Two entrypoints, no hops.** `AGENTS.md` and `docs/start-here/`. There are no section READMEs to wander through.

## Binding sources of truth
| Question | Source |
|---|---|
| Layers, modules, imports | [contracts/modules-and-layers.md](../architecture/contracts/modules-and-layers.md) |
| Multi-tenant rules | [contracts/tenancy.md](../architecture/contracts/tenancy.md) |
| Multi-product authority | [contracts/products.md](../architecture/contracts/products.md) · [contracts/product-engine-authority.md](../architecture/contracts/product-engine-authority.md) |
| Surface boundaries | [contracts/surfaces.md](../architecture/contracts/surfaces.md) |
| Events, projections, outbox | [contracts/events-and-projections.md](../architecture/contracts/events-and-projections.md) |
| Validation contract & runtime | [contracts/validation.md](../architecture/contracts/validation.md) · [contracts/validation-runtime.md](../architecture/contracts/validation-runtime.md) |
| Security posture | [contracts/security.md](../architecture/contracts/security.md) |
| Performance budgets | [contracts/performance-budgets.md](../architecture/contracts/performance-budgets.md) |
| DB indexes | [contracts/database-indexes.md](../architecture/contracts/database-indexes.md) |
| Jurisdiction config | [contracts/jurisdiction-product-config.md](../architecture/contracts/jurisdiction-product-config.md) |
| Decisions | [decisions/](../architecture/decisions/) (ADR-0001 … latest in folder) |

## Generated inventories (never hand-edit)
| Inventory | Generator |
|---|---|
| [reference/modules.md](../reference/modules.md) | `tools/docs/generate-modules.mjs` |
| [reference/workers.md](../reference/workers.md) | `tools/docs/generate-workers.mjs` |
| [reference/guards.md](../reference/guards.md) | `tools/docs/generate-guards.mjs` |
| [reference/contracts.md](../reference/contracts.md) | `tools/docs/generate-contracts.mjs` |
| [reference/runbooks-coverage.md](../reference/runbooks-coverage.md) | `tools/docs/generate-runbooks-coverage.mjs` |
| [reference/npm-scripts.md](../reference/npm-scripts.md) | `tools/docs/generate-npm-scripts.mjs` |

Update by changing code, then `npm run docs:generate`. CI: `npm run docs:generate:check` fails on drift.

## Pre-flight before writing code
1. Identify product · tenant · surface · module · contract.
2. Read the relevant binding contract end-to-end.
3. Check the generated inventory for prior art.
4. Locate the existing pattern in the same layer; mimic it.
5. Make the smallest change that preserves the contract.
6. Add / update tests in the right tier ([develop/test.md](../develop/test.md)).
7. Run the relevant guard locally before opening the PR.

## Stop and ask (no exceptions)
New cross-layer dependency · new shared abstraction · product-specific logic in shared · contract shape change · data migration / correction · bypassing a guard · editing a generated file.

## PR output (mandatory)
```text
- contract read:        - files changed:    - generated docs updated:
- guards run:           - tests run:        - risk:               - follow-up required:
```
The template at `.github/pull_request_template.md` enforces this.

## What "binding" means
`binding: true` in frontmatter = cannot change without an ADR. Changing prose in a binding doc is a contract change; treat it like changing a public API. Per-file size caps (`guard:docs-max-lines`): contracts ≤ 50 · operate ≤ 60 · develop ≤ 80 · start-here / product ≤ 100.
