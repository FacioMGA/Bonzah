# AGENTS.md — Abbeygate AI Agent Contract


The first document every AI coding agent must read before modifying this repo. There are exactly two entrypoints: this file (machines) and `docs/start-here/` (humans, by audience). Deeper agent guidance: `docs/start-here/03-agent.md`. Everything else is binding contract or generated.

## Prime directive
A compile pass is not success. Success means the edited code makes the business object more explicit than before.
Do not infer architecture from code. The repo contains legacy, archived, and transitional patterns. Binding contracts are listed below and they win. **If code and docs disagree, docs win — code must change or CI fails (ADR-0010).**

## Binding sources of truth
| Question | Source |
|----------|--------|
| Layers, modules, imports | `docs/architecture/contracts/modules-and-layers.md` |
| Multi-tenant rules | `docs/architecture/contracts/tenancy.md` |
| Multi-product rules | `docs/architecture/contracts/products.md` · `product-engine-authority.md` |
| Surface boundaries (`bo`, `client`, `public`) | `docs/architecture/contracts/surfaces.md` |
| Events / projections / outbox | `docs/architecture/contracts/events-and-projections.md` |
| Security posture | `docs/architecture/contracts/security.md` |
| Validation architecture | `docs/architecture/contracts/validation.md` · `validation-runtime.md` |
| Performance budgets | `docs/architecture/contracts/performance-budgets.md` |
| Database indexes | `docs/architecture/contracts/database-indexes.md` |
| Jurisdiction-aware product config | `docs/architecture/contracts/jurisdiction-product-config.md` |
| Underwriting analysis payload | `docs/architecture/contracts/underwriting-analysis.md` |
| Accounts intelligence API | `docs/architecture/contracts/accounts-intelligence-api.md` |
| Canonical ownership (one impl per concept; mirrors / projections / derived UI) | `docs/architecture/contracts/canonical-ownership.md` |
| Claims lifecycle | `docs/product/claims-lifecycle.md` |
| Decision history | `docs/architecture/decisions/` (ADR-0001 … latest in folder) |
| Live inventories (modules, workers, guards, contracts, runbooks, npm scripts) | `docs/reference/*.md` (generated) |
| Operational commands & runbooks | `docs/operate/*.md` |

## Non-negotiables
- Do not import product code into shared code.
- Do not bypass CHAMPS guards or the documentation guards.
- Do not add fallback datasets to silence validation errors.
- Do not duplicate canonical reference data.
- Do not hand-edit generated docs under `docs/reference/`.
- Do not treat archive docs (`docs/archive/`) as current guidance.
- Do not fix a symptom before tracing the contract path end-to-end.
- Do not silently rewrite a binding contract to match what code already does. Open an ADR.

## Before changing code
1. Identify the product, tenant, surface, module, and contract affected.
2. Read the relevant binding contract above.
3. Check the generated inventories under `docs/reference/`.
4. Locate the existing pattern in the same layer.
5. Make the smallest change that preserves the contract.
6. Add or update tests.
7. Run the relevant guard(s) named in `docs/reference/guards.md`.

## When to stop and ask
Stop if the change requires: a new cross-layer dependency · a new shared abstraction · product-specific logic in shared code · a contract shape change (validation, profile, event, authority, wire) · a migration or data correction · bypassing a guard · changing generated files by hand. When stopping, propose either an ADR amendment OR a Plan that updates the contract before the code.

## Documentation rule
If behaviour changes, update exactly one of: a binding contract (`docs/architecture/contracts/`) · an ADR (`docs/architecture/decisions/`) · a runbook (`docs/operate/`) · the generator source for an inventory (`docs/reference/`). Never add historical narrative to living docs. Caps: contracts ≤ 50 lines · operate ≤ 60 · develop ≤ 80 · start-here / product ≤ 100 (`guard:docs-max-lines`).

## Generated docs
Files under `docs/reference/` are generated. To update them, change code or the generator source, then run `npm run docs:generate`. CI runs `npm run docs:generate:check` and fails on drift.

## Archive rule
Docs under `docs/archive/` are frozen. They are historical evidence, not instructions.

## AI agent PR output standard
Every PR opened by an AI agent MUST include this block in the description:

- contract read:
- files changed:
- generated docs updated:
- guards run:
- tests run:
- risk:
- follow-up required:

Omissions are a defect — request the missing fields before merging.
