---
title: Backend Modules Inventory
audience: agent
status: living
owner: platform-eng
reviewed: 2026-09-09
binding: false
generated_by: tools/docs/generate-modules.mjs
---
<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Run `npm run docs:generate -- --only=modules` to regenerate.
  CI: `npm run docs:generate -- --check` fails on drift.
-->

# Backend Modules Inventory

This file is the canonical inventory of every domain module under `backend/modules/`. It is overwritten by the modules generator on every run.

## Schema

| Column | Source |
|--------|--------|
| Module | Directory name under `backend/modules/` |
| Layers present | Subset of `domain`, `app`, `http`, `infra` detected from subdirectories |
| Public surface | Symbols re-exported from `<module>/index.ts` |
| Owner | From module-level `OWNERS` file or fallback to `platform-eng` |
| Content revision | Stable hash of the module content tree |

## Inventory (34 modules)

| Module | Layers | Public surface | Owner | Content revision |
|--------|--------|----------------|-------|--------------|
| `accessControl` | domain, app, http, infra | _no public exports_ | platform-eng | content:c95252cf9676 |
| `accounts360` | domain, app, http, infra | _no public exports_ | platform-eng | content:09c0148ced8a |
| `auth` | app, http | _no public exports_ | platform-eng | content:b8b3260aa99c |
| `behavior` | http | _no public exports_ | platform-eng | content:8e26c3220f8e |
| `bonzah` | domain, app, http, infra | _no public exports_ | platform-eng | unknown |
| `claims` | domain, app, http, infra | _no public exports_ | platform-eng | content:03b959b68214 |
| `communications` | domain, app, http, infra | _no public exports_ | platform-eng | content:86469600dced |
| `compliance` | domain, app, infra | _no public exports_ | platform-eng | content:3bc55705a4b2 |
| `configuration` | domain, app, infra | `CONFIG_MCP_DEMO_SANDBOX_SLUG`, `addApprovalRuleTool`, `addReferralRuleTool`, `cloneTemplateTool`, `getDraftSummaryTool`, `listReferralRulesTool`, `listTemplatesTool`, `runDemoScenarioPackTool`, `runQuoteScenarioTool`, `setBillingTermsTool`, `setCoverageSelectionTool`, `setRequiredDocumentTool`, `setRequirednessTool`, `validateDraftTool` | platform-eng | content:4cd057345335 |
| `documents` | domain, app, http, infra | _no public exports_ | platform-eng | content:8aca40a25c4d |
| `insuranceConfiguration` | domain, app, http, infra | `assertConfiguredJourneyCapability`, `assertConfiguredQuestions`, `evaluateConfiguredQuestions`, `insuranceConfigurationEditorSchema`, `insuranceConfigurationRouter`, `insuranceConfigurationSchemaTool`, `publishInsuranceConfigurationTool`, `readInsuranceConfiguration`, `readInsuranceConfigurationTool`, `saveInsuranceConfiguration`, `saveInsuranceConfigurationTool`, `validateInsuranceConfigurationComponents` | platform-eng | content:191eb7fa5c3b |
| `jurisdiction` | domain, app | _no public exports_ | platform-eng | content:b877323488ac |
| `ledger` | domain, app | _no public exports_ | platform-eng | content:7e5eea558be2 |
| `mbe` | domain, app, http, infra | _no public exports_ | platform-eng | content:b622f636b1f4 |
| `mcp` | domain, app, http, infra | `McpToolError`, `default`, `oauthDiscoveryRouter`, `oauthFlowRouter`, `registerConfigTools`, `registerOperatorTools` | platform-eng | content:a99d05808592 |
| `motorMarketIntegrations` | domain, app, http, infra | _no public exports_ | platform-eng | content:28e6bd6e8006 |
| `operator` | domain, app, infra | `getActionStatusTool` | platform-eng | content:135b5371b086 |
| `org2vec` | domain, app, infra | `answerWithCitations`, `buildEdgeMetadata`, `deriveConfidence`, `gatesToInsufficientEvidenceFlags`, `resolveBusinessObject`, `resolvePrecedence`, `runReflexGates`, `toCypherEdgeProps`, `type AskResult`, `type PrecedenceCandidate`, `type ResolvedScope` | platform-eng | content:cc9bb87999f9 |
| `payments` | domain, app, http, infra | _no public exports_ | platform-eng | content:5cfc0e522fd5 |
| `people` | domain, app, http | _no public exports_ | platform-eng | content:da5c0c651fb3 |
| `platformIdentity` | domain, http | `createPlatformIdentityRouter` | platform-eng | content:544ff5300a5c |
| `platformTenants` | domain, app, infra | `* from './domain/contracts.js'`, `PlatformTenantService`, `createPlatformTenantService`, `createReusableCommercialTemplate`, `createReusableHomeTemplate`, `createReusableSourceTemplate`, `createReusableTemplateCatalog` | platform-eng | content:9d8eb0b12b9d |
| `policy` | domain, app, http, infra | _no public exports_ | platform-eng | content:76302067a405 |
| `pricing` | domain, app | _no public exports_ | platform-eng | content:262d76983731 |
| `products` | http | _no public exports_ | platform-eng | content:b71c17d17eb0 |
| `programs` | domain, app, http | _no public exports_ | platform-eng | content:061e7225e96c |
| `quotes` | app, http | _no public exports_ | platform-eng | content:e1e2887e3dfe |
| `recommendations` | domain, app | _no public exports_ | platform-eng | content:a51f4becb46d |
| `reporting` | domain, app, infra | _no public exports_ | platform-eng | content:31cf8ed9b98f |
| `settings` | http | _no public exports_ | platform-eng | content:98d81cdac4be |
| `tenant` | http | _no public exports_ | platform-eng | content:a3feff0636fd |
| `underwriting` | domain, app | _no public exports_ | platform-eng | content:89d88fcc9ebc |
| `users` | app, http | _no public exports_ | platform-eng | content:ccdcba63d8bc |
| `vehicles` | app, http | _no public exports_ | platform-eng | content:ed7657e58632 |
