---
title: Architect entrypoint
audience: architect
status: living
owner: platform-eng
reviewed: 2026-05-04
binding: false
---

# Architect entrypoint

## Decision hierarchy
```text
ADR  →  binding contract  →  generated inventory  →  CI guard
```
Every architectural change moves through these four levels. Skipping any is how docs rot and how production bugs are shipped.

## Binding contracts (cannot change without an ADR)
```text
docs/architecture/contracts/
  modules-and-layers.md          ← layer rules, naming, placement
  tenancy.md                     ← jurisdiction tenant + customer account scope
  products.md                    ← product registry, profiles, validation flow
  surfaces.md                    ← bo / client / public boundaries
  events-and-projections.md      ← outbox + worker registry + log contract
  validation.md                  ← validation contract authority
  validation-runtime.md          ← runtime evaluation rules
  security.md                    ← security posture (SD-001 … SD-005)
  performance-budgets.md         ← bundle / latency budgets
  database-indexes.md            ← index strategy
  jurisdiction-product-config.md ← per-jurisdiction product config
  product-engine-authority.md    ← product engine authority extraction
  underwriting-analysis.md       ← UW analysis payload
  accounts-intelligence-api.md   ← accounts intelligence API
```
Each contract states: governs / allowed / forbidden / escalation / links. If a contract has no enforcing guard, that's a missing piece — open an ADR and add the guard.

## How to add an ADR
1. Pick the next number from `docs/architecture/decisions/`.
2. File: `ADR-NNNN-<short-slug>.md`. Shape: Status / Context / Decision / Rejected alternatives / Consequences / Invariants. See [ADR-0009](../architecture/decisions/ADR-0009-shared-schema-row-level-tenancy.md).
3. List the **invariants**. They become the contract the system enforces.
4. If an invariant is CI-checkable, the same PR adds the guard under `tools/quality/check-<name>.mjs` and wires it into `npm run gate:ci`.
5. Update the binding contract (or create a new one) so the invariant is discoverable from the contract, not just the ADR.

## When to write an ADR
New / removed top-level directory · changed layer or import boundary · persistence model change (new top-level Prisma model owning business state OR tenancy-axis change) · new external system (queue, blob store, billing) · changed public contract (HTTP API, event shape, validation contract, generated bordereau) · promoting a transitional pattern to canonical or deprecating one.

## When NOT to write an ADR
New module / product / handler that follows existing patterns · changing a runbook procedure (update the runbook) · changing a generated reference file (change the generator source — never hand-edit `docs/reference/*`).

## How decisions become enforceable
| Artifact | Lives in | Enforced by |
|---|---|---|
| The decision | `docs/architecture/decisions/ADR-NNNN-*.md` | Code review |
| The invariants | ADR + the binding contract | CI guards under `tools/quality/` |
| Inventories prove coverage | `docs/reference/*.md` (generated) | `guard:docs-code-consistency` |
| Single source per procedure / contract | `docs/operate/`, `docs/architecture/contracts/` | `guard:docs-single-source` |
| Living docs cannot rot | All `status: living` docs | `guard:docs-stale` (180-day window) |
| Doc size discipline | All living docs | `guard:docs-max-lines` |

## Where to start reading if you're new
1. [product/overview.md](../product/overview.md) — multi-tenant + multi-product mental model
2. [contracts/modules-and-layers.md](../architecture/contracts/modules-and-layers.md) — the binding shape of the codebase
3. [contracts/tenancy.md](../architecture/contracts/tenancy.md) — the two orthogonal isolation axes (most subtle thing in the system)
4. [decisions/](../architecture/decisions/) — every previous decision and why
5. [reference/contracts.md](../reference/contracts.md) — every contract currently exported, with owner / source / products using / last changed
