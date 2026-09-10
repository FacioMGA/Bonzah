---
title: ADR-0038 Superseded Config MCP metadata-overlay design
audience: architect
status: archived
owner: platform-eng
reviewed: 2026-08-27
binding: true
superseded-by: ADR-0101
---

# ADR-0038: Program.metadata extension slots for Config MCP V1

## Status

Superseded by ADR-0101. This is retained as historical design evidence only.
Config MCP's metadata-overlay publisher is removed; runtime authority is the
complete, versioned programme definition mapped to a binder-product authority.

## Context

Config MCP V1 (ADR-0036) publishes overlays by writing into existing canonical config slots rather than introducing new canonical sources (ADR-0037). For some tool families the target slot already exists and is exercised in production:

- `abbeygateMotorUwConfig` (a `Partial<MotorUwConfig>`) is read by [`backend/products/motor/underwriting/motorUwAutomation.ts`](../../../backend/products/motor/underwriting/motorUwAutomation.ts) via the merge in `MotorCompiledUwEngine.ts`. It is the established mechanism for per-program UW threshold overrides.
- `mbeProductConfig` is owned by [`backend/modules/mbe/domain/programProduct.ts`](../../../backend/modules/mbe/domain/programProduct.ts) (`ProgramMbeProductConfigV1`) and edited from the BO `ProgramCoverage.tsx`.

For three tool families V1 needs to write but no slot exists yet:

- **Questionnaire requiredness overlay** — `config.questions.setRequiredness` needs to tighten stage requiredness for a question that already exists in the product's `ValidationProfile`.
- **Approval workflow rules** — `config.workflows.addApprovalRule` needs to declare "if condition X is met during workflow Y, require role Z to approve."
- **Jurisdiction document overlay** — `config.documents.setRequiredDocument` needs to toggle `requiredAt` / `issuanceTrigger` on a document that already exists in the resolved `JurisdictionProductConfig.documentConfig`.

The cleanest fit for all three is `Program.metadata` — a free-form `Json?` column whose purpose, per [`product-engine-authority.md`](../contracts/product-engine-authority.md), is exactly this kind of program-level authority extension. The contract is explicit: "A product profile may declare … `mergeUwConfig(authorityOverride?)` extensions." This ADR extends that posture to three new keys, with strict typing in the application layer and explicit reader hooks at the consumption sites.

## Decision

1. **Three new `Program.metadata` keys are added to the program-metadata namespace and become part of the canonical shape Config MCP V1 publishes into.** No Prisma column changes; the column is already `Json? @db.JsonB`.

   ```ts
   // backend/modules/configuration/domain/programMetadataExtensions.ts
   export interface QuestionnaireOverrides {
     // Tightening-only overlay. Loosening (removing canonical requiredness)
     // is rejected by validateDraft as INVALID_OVERRIDE.
     requiredAt?: Record<string /* canonical question path */, Array<'quote' | 'bind' | 'endorsement' | 'claim_fnol'>>;
   }

   export interface ApprovalRuleEntry {
     workflow: 'quote_referral';   // V1: only one wired; others return REQUIRES_ENGINEERING
     ruleKey: string;
     name: string;
     condition: {
       field: string;
       operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'in';
       value: string | number | boolean | string[] | number[];
     };
     requiredRole: string;
   }

   export interface JurisdictionDocumentOverride {
     documentType: 'certificate' | 'schedule' | 'statement_of_fact'
       | 'green_card' | 'invoice' | 'receipt';
     requiredAt?: Array<'quote' | 'bind' | 'endorsement' | 'cancellation'>;
     issuanceTrigger?: 'manual' | 'on_bind' | 'on_payment_received' | 'on_request';
   }
   export interface JurisdictionOverrides {
     documentConfig?: JurisdictionDocumentOverride[];
   }

   export interface ProgramBillingTerms {
     paymentTerms?: 'pay_before_bind' | 'invoice_after_bind' | 'installments';
     cancellationRefundBasis?: 'pro_rata' | 'short_rate' | 'manual_review';
     nonRefundableFees?: string[];
   }
   ```

   These types are declared once, in the `configuration` module's domain layer, and re-exported from [`packages/products/src/shared/`](../../../packages/products/src/shared/) only if a runtime consumer outside `backend/modules/configuration/` needs them.

2. **Consumption sites and their overlay hooks are explicit.**
   - `QuestionnaireOverrides.requiredAt` is consumed by a new helper `applyQuestionnaireOverridesForProgram(programMetadata, stage, fields)` in [`packages/validation/src/`](../../../packages/validation/src/). The runner consults it after building the canonical fieldset; overrides may only **tighten** canonical requiredness. Loosening throws a contract violation at write time.
   - `ApprovalRuleEntry[]` is consumed by `motorUwAutomation.evaluateMotorUwAutomation()` when its `programMeta.approvalRules` is non-empty: each matching rule produces a `referral` outcome with `triggers[].ruleId === entry.ruleKey` so existing BO referral surfaces stay unchanged.
   - `JurisdictionOverrides.documentConfig` is consumed by [`resolveJurisdictionProductConfig`](../../../backend/modules/jurisdiction/domain/productConfiguration.ts) after the canonical `(country, product)` lookup. Overrides may only modify `requiredAt` / `issuanceTrigger` for documents already in the resolved `documentConfig.documents` list. Adding a new document → `REQUIRES_ENGINEERING`.
   - `ProgramBillingTerms` is consumed at the cancellation/billing service boundary; `BinderFinancials.commissionRate` and `Tenant.adminFee` continue to be the canonical numeric sources and are written directly (not via `Program.metadata`).

3. **Overlay bounds are machine-checked.** A new guard `tools/quality/check-configuration-overlay-bounds.mjs` enforces:
   - The set of `Program.metadata` top-level keys writable by Config MCP is exactly: `abbeygateMotorUwConfig`, `mbeProductConfig`, `questionnaireOverrides`, `approvalRules`, `jurisdictionOverrides`, `billing`. Any write outside this allowlist fails.
   - No overlay loosens canonical requiredness (questionnaire), references a non-existent field (UW), or names a document not in the resolved jurisdiction config.

4. **`Program.metadata` shape stays free-form at the schema level.** No Prisma typing or column split — the extension lives in the application's TypeScript types, validated on write by the configuration module's Zod schemas and on read by the consumer-side overlay helpers. This matches how `abbeygateMotorUwConfig` and `mbeProductConfig` already work today.

## Forbidden

- Adding a fourth, fifth, … N-th `Program.metadata` key for Config MCP V1 without amending this ADR or opening a successor.
- Writing into `Program.metadata` with shapes that the configuration module's Zod schemas reject (no untyped JSON patches; no `.passthrough()`).
- Reading any of the four new keys from outside their declared consumption sites (validation runner / motor UW automation / jurisdiction resolver / billing service boundary). Cross-module reads are drift — open a follow-up ADR if a new consumer genuinely needs the key.
- Using the `questionnaireOverrides` key to loosen canonical requiredness (`required → optional`). That requires a manifest change and an ADR amendment.
- Using `jurisdictionOverrides.documentConfig` to introduce a new document type. New templates require a Handlebars template file + a jurisdiction config update and remain `REQUIRES_ENGINEERING` in V1.

## Consequences

- Three new `Program.metadata` keys are added with declared shapes and declared readers. Nothing else in the schema changes.
- The existing `abbeygateMotorUwConfig` and `mbeProductConfig` extension pattern is normalised — V1 publishes into all six keys through one transactional `publishToSandbox` writer.
- The overlay-bounds guard catches drift before it becomes a parallel canonical source.
- Loosening (questionnaire) and additions (new documents) explicitly surface as `REQUIRES_ENGINEERING` ticket payloads — the agent cannot quietly bypass the spine.

## Alternatives considered and rejected

- **Add four new Prisma columns to `Program` (one per extension key).** Rejected: identical shape coverage to `Program.metadata` extension, but requires four migrations now and creates an asymmetry with `abbeygateMotorUwConfig` / `mbeProductConfig`. `Program.metadata` is the right column for program-level extension authority per [`product-engine-authority.md`](../contracts/product-engine-authority.md).
- **Store the overlays on `ProductLaunchDraft.delta` only and never publish to canonical rows.** Rejected: drafts are workflow objects (ADR-0037) and no runtime consumer reads them. Without publishing to canonical rows the configuration never takes effect.
- **Introduce a new canonical `JurisdictionOverride` table per program.** Rejected: would require a new canonical-ownership row, a new resolver hop, and tests across the whole jurisdiction-config layer. `Program.metadata.jurisdictionOverrides` reuses the resolver's existing `program` argument with zero schema churn.

## Required follow-up before merge

- [ ] Application-layer types declared in `backend/modules/configuration/domain/programMetadataExtensions.ts` and consumer-side overlay helpers landed at each consumption site.
- [ ] Guard `tools/quality/check-configuration-overlay-bounds.mjs` registered in `package.json` (`guard:configuration-overlay-bounds`) and added to the relevant CI stages.
- [ ] Canonical-ownership row added: "Program metadata extension keys (Config MCP V1)" → owner `backend/modules/configuration/domain/programMetadataExtensions.ts`, with the four new keys enumerated and the closed allowlist named.

## Links

- Sibling ADRs: [ADR-0036](./ADR-0036-config-mcp-module-and-tool-surface.md) · [ADR-0037](./ADR-0037-product-launch-drafts-as-workflow-objects.md).
- Authority extraction contract: [`docs/architecture/contracts/product-engine-authority.md`](../contracts/product-engine-authority.md).
- Jurisdiction resolver: [`backend/modules/jurisdiction/domain/productConfiguration.ts`](../../../backend/modules/jurisdiction/domain/productConfiguration.ts).
- Existing program-metadata consumer (UW): [`backend/products/motor/underwriting/motorUwAutomation.ts`](../../../backend/products/motor/underwriting/motorUwAutomation.ts).
- Existing program-metadata consumer (MBE): [`backend/modules/mbe/domain/programProduct.ts`](../../../backend/modules/mbe/domain/programProduct.ts).
- Canonical-ownership map: [`docs/architecture/contracts/canonical-ownership.md`](../contracts/canonical-ownership.md).
