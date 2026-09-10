---
title: ADR-0037 Product launch drafts as workflow objects
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-27
binding: true
---

# ADR-0037: Product launch drafts as workflow objects, not canonical config

## Status

Accepted.

## Context

Config MCP V1 (ADR-0036) needs to stage a series of natural-language-driven configuration changes — clone a template, add a referral rule, set required documents, set commercial terms, validate, simulate, then publish — and only at the publish step actually mutate canonical configuration rows.

The risk is creating a parallel canonical source. The spec's draft of the feature proposes `ProductConfigDraft` + `QuestionnaireField` + `ReferralRule` + `DocumentRule` + `BillingRule` tables. Read literally, that produces five new tables that would each shadow an existing canonical owner enumerated in [`canonical-ownership.md`](../contracts/canonical-ownership.md):

| Spec concept | Canonical owner today |
|---|---|
| `QuestionnaireField` | [`packages/products/src/<product>/manifest.ts`](../../../packages/products/src/motor/manifest.ts) + [`packages/products/src/<product>/profile.ts`](../../../packages/products/src/motor/profile.ts) (per the multi-product authority contract) |
| `ReferralRule` | [`backend/products/<product>/underwriting/*UwAutomation.ts`](../../../backend/products/motor/underwriting/motorUwAutomation.ts) thresholds (defaults) merged with `Program.metadata.abbeygateMotorUwConfig` (per-program override) |
| `DocumentRule` | [`backend/modules/jurisdiction/domain/productConfiguration.ts`](../../../backend/modules/jurisdiction/domain/productConfiguration.ts) `documentConfig` keyed by `(country, product)` |
| `BillingRule` | `Tenant.adminFee` + `BinderFinancials.commissionRate` + [`backend/modules/policy/http/cancellationsRouter.ts`](../../../backend/modules/policy/http/cancellationsRouter.ts) cancellation logic |
| `ProductConfigDraft.status` | `RiskTransaction.status` for post-bind changes ([ADR-0007](./ADR-0007-policy-versioning-lifecycle-primitives.md)) is the closest existing draft/published pattern |

Two of the binding guards (`guard:products-single-source`, `guard:product-validation-authority`) would fail any read of these new tables outside the launch-staging path, because either the new row or the existing canonical owner would have to be reclassified as a mirror.

The contract-spine skill is explicit: "every 'temporary' duplicate on this platform has become permanent. If the spine cannot accept your change today, the answer is an ADR, not a parallel implementation." This ADR is that answer.

## Decision

1. **Introduce `ProductLaunchDraft` as a workflow object, never a canonical configuration source.** Same posture as [`RiskTransaction.snapshotDraft`](../../../prisma/schema.prisma) (ADR-0007) for post-bind policy changes — staging surface that produces a transactional write to canonical rows when it publishes, then itself becomes evidence-only.

   Single new Prisma model (in [`prisma/schema.prisma`](../../../prisma/schema.prisma)):

   ```prisma
   model ProductLaunchDraft {
     id                 String   @id @default(uuid())
     operatingTenantId  String
     operatingTenant    Tenant   @relation(fields: [operatingTenantId], references: [id])
     name               String
     baseTemplateId     String
     productCode        String   // 'MOTOR' for V1
     status             String   @default("draft")
       // draft | validation_failed | validated | simulated | sandbox_published | archived
     delta              Json     @db.JsonB   // typed DraftDelta (see §2)
     publishedProgramId String?
     publishedBinderId  String?
     createdByUserId    String
     createdAt          DateTime @default(now())
     updatedAt          DateTime @updatedAt
     @@map("product_launch_drafts")
   }
   ```

2. **The `delta` column is the only place a launch draft accumulates changes.** Its shape is declared in `backend/modules/configuration/domain/draftDelta.ts` and is **strictly typed** — Zod-validated on every write tool call. The shape mirrors the V1 tool catalog one-to-one:

   ```ts
   export interface DraftDelta {
     uwOverrides?: Partial<MotorUwConfig>;                    // → Program.metadata.abbeygateMotorUwConfig
     mbeOverrides?: ProgramMbeProductConfigDelta;             // → Program.metadata.mbeProductConfig
     questionnaireOverrides?: QuestionnaireOverrideMap;       // → Program.metadata.questionnaireOverrides (ADR-0038)
     approvalRules?: ApprovalRuleEntry[];                     // → Program.metadata.approvalRules     (ADR-0038)
     jurisdictionOverrides?: JurisdictionOverrideMap;         // → Program.metadata.jurisdictionOverrides (ADR-0038)
     billing?: BillingTermsDelta;                             // → split across BinderFinancials + Tenant.adminFee + Program.metadata.billing
     binderAuthorityOverrides?: BinderAuthorityOverrideDelta; // → BinderProductAuthority on publish
   }
   ```

   Under ADR-0101 this draft shape is staging evidence only; it is not a
   runtime configuration or publication path. There is no untyped JSON patch.

3. **Definition publication is the only canonical write.** A complete
   `ProgramDefinitionVersion`, its validated rate model where automated, and
   its explicit `BinderProductAuthority` mapping are saved and published from
   BO Runtime Settings. The former Config MCP metadata-overlay publisher is
   retired; it cannot create a programme or binder row.

4. **Reads from anywhere outside the `configuration` module are forbidden.** The new canonical-ownership row (§Links) names `backend/modules/configuration/` as the sole reader and writer of `ProductLaunchDraft`. A new repo-wide guard `tools/quality/check-product-launch-draft-isolation.mjs` enforces this by failing any import path of the model outside that module — same shape as the existing `check-no-cross-layer-shadow-files.mjs`.

5. **No draft may drive runtime behaviour.** Publishing requires an explicit
   reviewed definition and authority mapping; drafts remain evidence-only.

## Forbidden

- Any read of `ProductLaunchDraft` outside `backend/modules/configuration/`.
- Any second draft/staging table for configuration changes — endorsement drafts, program rating-model drafts, and binder uploads already have their own staging surfaces and remain unchanged.
- Reading from `ProductLaunchDraft.delta` to make a runtime configuration decision (pricing, UW, document resolution, billing). Runtime reads flow from canonical rows, never from the draft.
- Any Config MCP publisher that writes programme runtime settings without the
  complete definition and explicit binder-authority mapping.

## Consequences

- One new Prisma model, one new module-scope column shape, zero new canonical owners — the contract spine is preserved.
- Existing canonical owners (manifest, validation profile, programme definition,
  binder authority, jurisdiction config) remain unchanged; their guards keep
  working untouched.
- `RiskTransaction.snapshotDraft` (ADR-0007) gets a sibling pattern at the configuration tier — the same "draft → publish → evidence" lifecycle.
- The MCP tool surface (ADR-0036) can stage arbitrary natural-language-driven changes without committing the platform to a new schema for every concept the agent might touch later. New delta shapes are JSON additions; new canonical rows still need their own ADRs.

## Alternatives considered and rejected

- **Build the spec literally — five new tables, each shadowing a canonical owner.** Rejected: violates the contract-spine skill, would require a new "mirror" row for every shadowed concept in `canonical-ownership.md`, and would break the existing guards.
- **Skip the draft, write deltas directly to `Program.metadata` on every tool call.** Rejected: loses the lifecycle (draft → validated → simulated → published) the spec requires; loses the ability to validate the whole delta together and to refuse partial publishes; loses the audit summary at publish time.
- **Store the draft in Redis / a file / a worker queue.** Rejected: drafts need tenant-scoped persistence with the same RLS posture as the rest of the platform (ADR-0009), and need to survive process restarts.
- **Reuse `RiskTransaction.snapshotDraft` for this purpose.** Rejected: `RiskTransaction` is keyed to a policy. Launch drafts are pre-product; there is no policy and no risk.

## Required follow-up before merge

- [ ] Prisma migration adding `product_launch_drafts` table.
- [ ] Canonical-ownership row added: "Product launch staging" → owner `backend/modules/configuration/`, forbidden duplicate sources = "any second draft table for product/program configuration."
- [ ] Guard `check-product-launch-draft-isolation.mjs` landed alongside the model.
- [ ] AuditAction `entityType` enum extended with `CONFIG_DRAFT` (and the matching `CONFIG.*` action vocabulary added to `AuditEventType`).

## Links

- Sibling ADRs: [ADR-0036](./ADR-0036-config-mcp-module-and-tool-surface.md) · [ADR-0038](./ADR-0038-program-metadata-extension-slots.md).
- Workflow-object precedent: [ADR-0007](./ADR-0007-policy-versioning-lifecycle-primitives.md) (`RiskTransaction.snapshotDraft`).
- Canonical-ownership rule: [ADR-0011](./ADR-0011-policy-state-and-compliance-canonical-placement.md).
- Tenancy: [ADR-0009](./ADR-0009-shared-schema-row-level-tenancy.md) · [ADR-0019](./ADR-0019-tenancy-and-authority-fail-closed.md).
- Canonical-ownership map: [`canonical-ownership.md`](../contracts/canonical-ownership.md).
- Contract-spine skill: [`.cursor/skills/contract-spine/SKILL.md`](../../../.cursor/skills/contract-spine/SKILL.md).
