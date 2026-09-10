---
name: contract-spine
description: Enforces Abbeygate's one-contract-spine rule for an insurance platform. Before fixing a bug or adding business logic, the agent must locate the canonical owner of the concept and either change the spine itself or add a thin wrapper/projection — never a competing implementation. Use whenever fixing a bug, adding/changing rules, pricing, validation, lifecycle, status transitions, projections, formatting, prefill, enrichment, eligibility, or anything that could plausibly already exist; whenever about to write a wrapper, façade, helper, fallback, default, or per-product branch in shared code; whenever the canonical owner of a concept is unclear; or whenever about to copy-paste logic across products, layers, or surfaces.
---

# Contract spine — one canonical owner per concept

Abbeygate is a multi-product insurance platform built on **one contract spine**. Every domain concept (payment status, issuance, issue-readiness, premium leaf, rate tables, claims prefill, binder authority, BDX, vehicle enrichment, recalculate, etc.) has **exactly one** canonical implementation. Everything else is a wrapper, projection, mirror, derived UI state, or consumer — never a second source.

The single most expensive failure mode for this agent is **sideways drift**: fixing a symptom by adding a parallel rule, a per-product branch, a "helper" near the caller, a silent default, or a frontend re-derivation, instead of changing the canonical owner itself. This skill prevents that.

## The one question

Before writing or editing any business logic, answer out loud:

> **"Is my change on the spine, or am I drifting sideways with a duplicate?"**

If you cannot name the canonical owner of the concept you are about to touch, **stop and find it**. If you can name it but your change lives somewhere else, you are drifting — re-route the change to the spine or to a sanctioned mirror.

## Preflight (do this every time)

Treat this as a hard checklist. Skip nothing.

1. **Name the concept in one phrase.** e.g. "payment status transition", "premium recalculation entrypoint", "vehicle fuel-type normalization", "issue-readiness derivation", "BDX column for motor", "claims prefill from policy".
2. **Find the canonical owner.** Read `docs/architecture/contracts/canonical-ownership.md` and locate the row for this concept. The row tells you:
   - the canonical owner (file + function),
   - allowed mirrors / projections,
   - allowed derived UI state,
   - **forbidden duplicate sources** (this is the drift list — your change must not land here).
3. **If the concept is not in the map**, check related binding contracts before assuming it is greenfield:
   - `modules-and-layers.md` — layer/import rules
   - `product-engine-authority.md` + `products.md` — product-specific code placement
   - `surfaces.md` — `bo` / `client` / `public` boundaries
   - `events-and-projections.md` — outbox/projection rules
   - `validation.md` + `validation-runtime.md` — validation belongs to one runtime
   - `tenancy.md`, `security.md`, `jurisdiction-product-config.md` — cross-cutting rules
4. **Trace the path end-to-end before fixing.** AGENTS.md non-negotiable: *"Do not fix a symptom before tracing the contract path end-to-end."* Read every hop: HTTP handler → use case → adapter (`IProductAdapter`) → engine → leaf → projection → UI. The bug is almost always at one specific hop; fixing it elsewhere is drift.
5. **Locate prior art in the same layer.** Grep for the canonical function name and follow its callers. If a similar fix already exists, mirror that pattern instead of inventing one.
6. **Decide where the change must land.** Choose exactly one of:
   - **On the spine** (change the canonical owner) — preferred for bugs and rule changes.
   - **On a sanctioned mirror or projection** — only when the row explicitly allows it.
   - **On a thin product adapter** that already routes through the spine.
   - **Stop and propose an ADR** — when the change requires a new canonical owner, a new cross-layer dependency, a contract-shape change, or a new shared abstraction.

Only after this checklist is complete may you write code.

## Drift detection — refuse these patterns

These are the recurring shapes of "sideways" fixes on this platform. If you find yourself reaching for one, stop.

- **Second implementation of a documented owner.** Anything in the "Forbidden duplicate sources" column of `canonical-ownership.md` (e.g. a second `rateQuote` FE client, inline checkout creation, a route handler writing `Policy.quoteResponse` without going through `adapter.buildQuoteResponse`).
- **Per-product branch in shared code.** `if (productCode === 'MOTOR') …` inside `shared/`, `wizard/`, `policy/`, `claims/`, BO renderers, or HTTP routers. Always parameterise via `productCode` and dispatch through `IProductAdapter`.
- **Product-specific path hardcoded on the frontend.** e.g. `/api/public/motor/…` in shared wizard code. Must be parameterised by `productCode`.
- **Direct leaf import.** `import { calculateMotorPremium }` (or any `calculate*Premium` / `calculate*QuoteResponse`) **outside** the per-product engine module. The leaf is reached **only** through `IProductAdapter.calculatePremium` / `buildQuoteResponse`. Lock G enforces this.
- **Module-level pricing façade.** A `…Pricing.ts` helper that wraps `adapter.calculatePremium` for callers that already have the adapter — delete it, use the adapter directly.
- **Inline rate table.** A `.ts` literal of rates, factors, or matrices anywhere outside `backend/products/<product>/pricing/data/<dataset>.json` (+ schema + loader). Enforced by `check-no-inline-rate-tables.mjs`.
- **Direct `Policy.status` write.** Status flips to `ACTIVE`/`ISSUED`/`PAID` belong to the issuance / payment pipeline. Enforced by `check-no-direct-policy-status-writes.mjs`.
- **Frontend re-derivation of derived state.** Re-computing issue-readiness, payment lock, or eligibility on the frontend from raw fields. Consume the projection.
- **Shadow file across layers.** Same concept restated in another layer (e.g. a frontend copy of a backend type, a wizard copy of a BO renderer). Enforced by `check-no-cross-layer-shadow-files.mjs`.
- **Shared product façade.** A "convenience" module under `shared/` that imports product code. Enforced by `check-no-shared-product-facades.mjs`.
- **Silent fallback / default to mask bad data.** AGENTS.md non-negotiable: *"Do not add fallback datasets to silence validation errors."* In particular, no `setIfMissing` defaults inside BDX import mappers.
- **Helper added next to the caller.** Utility functions added to the file you happen to be editing, when the same concept already exists in its canonical module. Move/use the canonical one.
- **Validation re-stated.** Re-declaring a zod schema, normalizer, or enum that already exists in a canonical module (e.g. `VehicleEnrichmentFieldKey`, fuel-type / cabrio normalizers). Import the canonical export.

If a guard would fail your change, that is not a hurdle to route around — it is the system telling you that you are drifting. Read the row in `canonical-ownership.md` cited by the guard message and re-plan.

## Bug-fix triage (the most common entry point)

> **Before this section, run `evidence-first-debug` (`.cursor/skills/evidence-first-debug/SKILL.md`).** That skill is the investigation phase that names the hop and captures the signal; this section is the routing decision once you have both. Do not start choosing where the fix lands until you have a verified hypothesis from the evidence-first workflow.

When a bug is reported, work in this order:

1. **Reproduce the symptom and trace it back to the spine.** Which canonical owner is responsible for the wrong output? Which hop produced the wrong value?
2. **Decide the kind of fix:**
   - **Spine bug** — the canonical owner is wrong. Fix it there. Every consumer benefits. This is the default.
   - **Mirror/projection drift** — the spine is correct but a mirror got stale (e.g. `policyListIndex.complianceState`, `Policy.paymentStatus`). Fix the writer of the mirror, not the reader.
   - **UI-derived-state bug** — the spine is correct and so is the projection, but the derived UI state mis-renders. Fix the derived state at its single owner (e.g. `effectivePhase` in `PaymentStep`).
   - **Contract gap** — the spine doesn't model the case at all. Stop and propose an ADR before coding.
3. **Never patch downstream of the bug.** If `applyCardcorpVerifiedStatus` is wrong, do not paper over it in `PaymentStep`. If `evaluateIssueReadiness` is wrong, do not re-derive readiness in BO renderers.

## When to stop and open an ADR

Stop before writing code if your change requires any of:

- a new canonical owner (a concept not yet in `canonical-ownership.md`),
- moving the canonical owner of an existing concept,
- a new cross-layer dependency,
- a new shared abstraction,
- product-specific logic landing in shared code,
- a contract-shape change (validation, profile, event, authority, wire),
- bypassing a guard,
- editing a generated doc by hand.

In that case, draft an ADR under `docs/architecture/decisions/` (or amend the relevant contract) and propose the change first. AGENTS.md is explicit: *"Do not silently rewrite a binding contract to match what code already does."*

## Output discipline (PR + chat)

Before you finish a code change, state the spine path you used. In chat and in the PR description, include:

- **Concept:** one phrase.
- **Canonical owner:** file + function from `canonical-ownership.md` (or "not mapped — ADR proposed").
- **Where the fix landed:** on the spine / on a sanctioned mirror / on a thin adapter / on derived UI state.
- **Drift considered and rejected:** the one or two sideways shapes you almost reached for, and why you didn't.
- **Guards run:** the `check-*` scripts relevant to this concept.

This block belongs inside the standard AI agent PR output block required by AGENTS.md (`contract read`, `files changed`, `guards run`, …).

## Examples

### Example 1 — payment status looks wrong on the BO timeline

**Symptom:** A policy shows `PAID` on the wizard but `PENDING` in the BO list view.

**Spine path:** `canonical-ownership.md` row "Payment status" → owner is `Payment.status` written by `transitionPaymentStatus` in `policy/app/commands/riskPaymentDocCommands.ts`. Allowed mirror: `policyListIndex.complianceState` (projection).

**On-spine fix:** the writer of `policyListIndex.complianceState` is stale — fix the projection writer (or the event that triggers it). Do **not** re-read `Payment.status` from the BO list view.

**Drift rejected:** adding a "refresh paymentStatus" button to the BO list; caching payment status on the frontend; reading `Payment.status` directly inside a BO renderer.

### Example 2 — motor recalculate produces a different number than the public quote API

**Symptom:** Premium differs between BO "Recalculate" and the public `POST /rate` endpoint.

**Spine path:** `canonical-ownership.md` row "BO action: Premium → Recalculate" → both paths must dispatch through `ProductRegistry.getInstance().getAdapter('MOTOR').buildQuoteResponse(...)`. Lock G forbids direct leaf imports.

**On-spine fix:** find the path that is bypassing the adapter and re-route it through `IProductAdapter.buildQuoteResponse`. If `motor/quotes/service.ts` is adding motor-specific overlays, those overlays must wrap *the adapter call*, not call the leaf directly.

**Drift rejected:** a second `rateQuote` FE client method; importing `calculateMotorPremium` from a route handler; duplicating overlay logic in BO.

### Example 3 — travel rate table needs a 2026 update

**Spine path:** `canonical-ownership.md` row "Product rate tables (literal data)" → JSON at `backend/products/travel/pricing/data/brit-travel-2025.json` + sibling `.schema.ts` + `loader.ts`.

**On-spine fix:** add `brit-travel-2026.json` (plus schema bump and loader entry). Switch the consumer to the new dataset.

**Drift rejected:** adding a `.ts` literal of new rates inside the engine; conditionally branching on year inside the leaf calculator; "temporarily" inlining the new table in a service.

## Sources of truth (read before, not after)

- Binding map: `docs/architecture/contracts/canonical-ownership.md`
- Layer rules: `docs/architecture/contracts/modules-and-layers.md`
- Product placement: `docs/architecture/contracts/product-engine-authority.md`, `docs/architecture/contracts/products.md`
- Surfaces: `docs/architecture/contracts/surfaces.md`
- Events / projections / outbox: `docs/architecture/contracts/events-and-projections.md`
- Validation: `docs/architecture/contracts/validation.md`, `validation-runtime.md`
- ADRs: `docs/architecture/decisions/` (start with ADR-0011 for canonicality)
- Live inventories (generated — do not hand-edit): `docs/reference/*.md`

## Guards that catch sideways drift

These are the machine checks that exist precisely because this rule is hard. If you are unsure whether your change drifts, run the relevant ones locally before committing — and read their error messages as guidance, not obstacles.

- `tools/quality/check-architecture-locks.mjs` (Lock G — leaf-calculator isolation)
- `tools/quality/check-no-cross-layer-shadow-files.mjs`
- `tools/quality/check-no-shared-product-facades.mjs`
- `tools/quality/check-no-inline-rate-tables.mjs`
- `tools/quality/check-no-competing-domains.mjs`
- `tools/quality/check-one-source-truth.mjs`
- `tools/quality/check-products-single-source.mjs`
- `tools/quality/check-validation-single-source.mjs`
- `tools/quality/check-no-direct-policy-status-writes.mjs`
- `tools/quality/check-backend-module-delegation.mjs`
- `tools/quality/check-tools-duplicate-ownership.mjs`
- `tools/quality/check-no-product-literals-in-shared-bo.mjs`
- `tools/quality/check-no-product-literals-in-conformance.mjs`
- `tools/quality/check-dependency-duplication-drift.mjs`

The authoritative list of guards lives in `docs/reference/guards.md`.

## Anti-shortcut clause

Do not add the second source "for now" with a TODO to consolidate later. Every "temporary" duplicate on this platform has become permanent. If the spine cannot accept your change today, the answer is an ADR, not a parallel implementation.
