---
title: ADR-0010 Documentation is enforced
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# ADR-0010: Documentation is Enforced

## Status

Accepted

## Context

Documentation in most engineering organisations drifts because it is treated as a social artefact. Engineers who change behaviour are not blocked by a missing or stale doc; reviewers do not reject PRs that contradict an existing contract; CI does not check that the generated inventory of modules/workers/contracts still covers what the codebase exposes. The result is the asymmetry every senior engineer has lived through: code is the source of truth and docs are the apology.

This platform is multi-tenant, multi-product, multi-jurisdiction and increasingly operated by autonomous agents (Cursor, Claude, internal tools) acting on a partial view of the repo. When agents are reading legacy modules alongside live ones, "infer architecture from the code" is not just inefficient — it is unsafe. The repo contains:

- Legacy modules that exist for migration reasons
- Transitional patterns between two architectures
- Dead code paths that have not been removed yet
- Generated artefacts that look hand-written
- Hand-written artefacts that look generated

If documentation merely *describes* this terrain, agents and humans both pick up patterns that should not be repeated. The system needs documentation that *defines* what the platform is allowed to be, with CI as the enforcement layer.

## Decision

**If code and docs disagree, docs win. Code must change or CI fails.**

This rule is binding across the platform. It has the following operational consequences:

### 1. Binding contracts are the law, not guidance

Every binding contract in `docs/architecture/contracts/*.md` carries `binding: true` in its frontmatter. The text of those contracts is the source of truth for the rule it covers (modules and layers, tenancy, products, surfaces, events, security, validation, performance, indexes, etc.). When code disagrees with a binding contract, the failure mode is:

1. Open the PR that brings code back into compliance with the contract, **or**
2. Open an ADR that supersedes the contract and explicitly amends the rule, **or**
3. Open a Plan to revise the contract before any code change ships.

It is forbidden to "just fix the code" without one of those three actions. It is forbidden to silently rewrite the contract to match what the code already does.

### 2. Generated inventories cover the codebase exhaustively

Files under `docs/reference/*.md` are produced by generators in `tools/docs/`. They cover modules (`modules.md`), workers (`workers.md`), guards (`guards.md`), contracts (`contracts.md`), and runbook coverage (`runbooks-coverage.md`). A `guard:docs-code-consistency` check fails CI when:

- A module exists in `backend/modules/` but is missing from `modules.md`
- A worker handler exists but is missing from `workers.md`
- A guard script exists in `tools/quality/` but is missing from `guards.md`
- A binding contract exists in code (e.g. `packages/validation/src/*/contract.ts`) but is missing from `contracts.md`
- A runbook is referenced from operational alerts/playbooks but missing from `runbooks-coverage.md`

Hand-edits to generated files are rejected by `guard:docs-stale`.

### 3. Frontmatter is enforced

Every markdown file under `docs/` (except `docs/archive/`) must carry frontmatter declaring `audience`, `status`, `owner`, `reviewed`, and `binding`. `guard:docs-frontmatter` fails CI on missing or malformed frontmatter. `guard:docs-stale` fails CI when `reviewed` is older than 90 days for `binding: true` files, 180 days otherwise.

Per-file line caps (`guard:docs-max-lines`) keep each doc inside a reviewable budget so it stays decision-only rather than narrative:

| Bucket | Cap | Why |
|---|---:|---|
| `architecture/contracts/*` | 50 | Binding contracts must read in one screen — governs / allowed / forbidden / escalation / links. |
| `operate/*` (top level) | 60 | Executable runbooks for on-call. First lines are commands. |
| `operate/reference/*` | unlimited | Long-form ops reference complementing the runbooks (e.g. extended AKS env walkthrough). Not binding. |
| `develop/*` | 80 | Develop guides — short enough to stay current. |
| `start-here/*`, `product/*` | 100 | Audience entrypoints and product-unique reference. |
| `architecture/decisions/ADR-*`, `reference/*`, `archive/**` | unlimited | Decision context, generated inventories, and frozen evidence are uncapped on purpose. |

### 4. Single source of truth per topic

`guard:docs-single-source` ensures that no two living documents claim authority over the same topic. When a topic moves homes (e.g. `engineering/SECURITY_DECISIONS.md` → `architecture/contracts/security.md`), the originating file goes to `docs/archive/` with a `Frozen-on:` header pointing to the new authority, or is deleted entirely. There is no second canonical copy.

### 5. AGENTS.md is the agent contract

`/AGENTS.md` at the repo root is the strict, machine-readable entrypoint every AI coding agent must read before modifying the repo. It is bounded at 100 lines and points agents to the binding contracts and generated inventories. It is kept short on purpose so agents always read it. The human-readable companion lives at `docs/start-here/03-agent.md`.

### 6. Specific class made impossible: Product field-contract drift

The first concrete proof that this system has power is `guard:contracts-product-consistency`. For every shared standard field (starting with `nationality`):

- One canonical field contract exists in `packages/validation/src/<field>/contract.ts`
- One generated entry exists in `docs/reference/contracts.md` (with owner, source file, products using it, last changed)
- Every product profile in `packages/products/*/profile.ts` that uses the field is checked against the canonical contract for: default value membership, allowed-value shape, atom strictness, payload path, and absence of product-local fallback lists
- Disagreement fails CI

This makes the Nationality-class production bug structurally impossible.

## Consequences

### Positive

- AI agents become dramatically more reliable because the binding sources of truth are short, strict and machine-readable.
- Architectural drift becomes visible the moment a PR is opened, not at the next refactor.
- Onboarding becomes routing instead of archaeology — `docs/start-here/` answers "where do I go" in four files.
- A specific class of production bugs (product field-contract drift) becomes impossible to ship.
- Reviewers gain a hard rule to point to: "this contradicts the contract; bring code back or amend the contract."

### Negative / trade-offs

- Engineers cannot fix a symptom without first reading the relevant contract. This costs minutes per change but saves days per regression.
- Adding a new shared field is heavier than today: one canonical contract, one generated inventory entry, one consistency guard. This cost is intentional.
- Contract amendments are a deliberate ceremony (Plan or ADR). Casual rewording of binding contracts is forbidden.

## Rules (binding)

1. **Docs win.** When code and a binding contract disagree, the code must change or the contract must be amended through a Plan/ADR. Silent rewrites of binding contracts are forbidden.
2. **No hand edits to generated docs.** Files declared `generated_by:` in frontmatter are produced by `npm run docs:generate`. Editing them by hand fails CI.
3. **No second canonical copy.** Each topic has exactly one living document. Old homes go to `docs/archive/` with a `Frozen-on:` header or are deleted.
4. **No archive as guidance.** `docs/archive/` is historical evidence. AI agents and humans must not treat archived docs as current rules.
5. **Frontmatter is mandatory.** Every living markdown file declares `audience`, `status`, `owner`, `reviewed`, `binding`.
6. **Stale binding contracts block release.** A `binding: true` file with `reviewed` older than 90 days fails CI.
7. **Coverage is mandatory.** Every module, worker, guard, contract, and operational runbook must appear in its generated inventory or the consistency guard fails.

## Implementation Status

| Consequence | Status | Notes |
|-------------|--------|-------|
| Binding-contract enforcement (`guard:docs-frontmatter`, `guard:docs-stale`, `guard:docs-single-source`) | ✅ ENFORCED | Strict in CI; opt-out only via `DOCS_GUARDS_STRICT=0` for local debugging. |
| Generated inventories (`modules`, `workers`, `guards`, `contracts`, `runbooks-coverage`) | ✅ ENFORCED | Generators run in CI via `docs:generate:check`; coverage enforced via `guard:docs-code-consistency` and `guard:docs-runbook-coverage`. |
| `guard:contracts-product-consistency` for Nationality-class | ✅ ENFORCED | Canonical `packages/validation/src/nationality/contract.ts`; guard `tools/quality/check-contracts-product-consistency.mjs` strict in CI; covers product profiles, manifests, region/jurisdiction defaults, prisma seed, fixtures, payload paths, and the shared `countries` mirror. Synthetic-drift assertions live next to the guard. |
| `AGENTS.md` at repo root | ✅ ENFORCED | Lives at repository root; bounded at 100 lines. |
