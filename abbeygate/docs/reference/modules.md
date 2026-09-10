---
title: Backend Modules Inventory
audience: agent
status: living
owner: platform-eng
reviewed: 2026-09-07
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
| Last changed | Most recent `git log` commit touching the module |

## Inventory (31 modules)

| Module | Layers | Public surface | Owner | Last changed |
|--------|--------|----------------|-------|--------------|
| `accessControl` | domain, app, http, infra | _no public exports_ | platform-eng | 2026-08-28 (+0000) |
| `accounts360` | domain, app, http, infra | _no public exports_ | platform-eng | 2026-08-29 (+0000) |
| `auth` | app, http | _no public exports_ | platform-eng | 2026-09-02 (+0000) |
| `behavior` | http | _no public exports_ | platform-eng | 2026-05-01 (+0000) |
| `bonzah` | domain, app, http | _no public exports_ | platform-eng | never |
| `claims` | domain, app, http, infra | _no public exports_ | platform-eng | 2026-08-18 (+0000) |
| `communications` | domain, app, http, infra | _no public exports_ | platform-eng | 2026-08-28 (+0000) |
| `compliance` | domain, app, infra | _no public exports_ | platform-eng | 2026-08-19 (+0000) |
| `configuration` | domain, app, infra | `CONFIG_MCP_DEMO_SANDBOX_SLUG`, `addApprovalRuleTool`, `addReferralRuleTool`, `cloneTemplateTool`, `getDraftSummaryTool`, `listReferralRulesTool`, `listTemplatesTool`, `publishToSandboxTool`, `runDemoScenarioPackTool`, `runQuoteScenarioTool`, `setBillingTermsTool`, `setCoverageSelectionTool`, `setRequiredDocumentTool`, `setRequirednessTool`, `validateDraftTool` | platform-eng | 2026-07-13 (+0000) |
| `documents` | domain, app, http, infra | _no public exports_ | platform-eng | 2026-08-19 (+0000) |
| `jurisdiction` | domain | _no public exports_ | platform-eng | 2026-08-09 (+0000) |
| `ledger` | domain, app | _no public exports_ | platform-eng | 2026-05-05 (+0000) |
| `mbe` | domain, app, http, infra | _no public exports_ | platform-eng | 2026-07-30 (+0000) |
| `mcp` | domain, app, http, infra | `McpToolError`, `default`, `oauthDiscoveryRouter`, `oauthFlowRouter`, `registerConfigTools`, `registerOperatorTools` | platform-eng | 2026-08-30 (+0000) |
| `motorMarketIntegrations` | domain, app, http, infra | _no public exports_ | platform-eng | 2026-08-05 (+0000) |
| `operator` | domain, app, infra | `getActionStatusTool` | platform-eng | 2026-08-30 (+0000) |
| `org2vec` | domain, app, infra | `answerWithCitations`, `buildEdgeMetadata`, `deriveConfidence`, `gatesToInsufficientEvidenceFlags`, `resolveBusinessObject`, `resolvePrecedence`, `runReflexGates`, `toCypherEdgeProps`, `type AskResult`, `type PrecedenceCandidate`, `type ResolvedScope` | platform-eng | 2026-06-12 (+0000) |
| `payments` | domain, app, http, infra | _no public exports_ | platform-eng | 2026-09-02 (+0000) |
| `people` | domain, app, http | _no public exports_ | platform-eng | 2026-08-19 (+0000) |
| `policy` | domain, app, http, infra | _no public exports_ | platform-eng | 2026-09-03 (+0000) |
| `pricing` | domain, app | _no public exports_ | platform-eng | 2026-06-17 (+0000) |
| `products` | http | _no public exports_ | platform-eng | 2026-05-05 (+0000) |
| `programs` | domain, app, http | _no public exports_ | platform-eng | 2026-08-27 (+0000) |
| `quotes` | app, http | _no public exports_ | platform-eng | 2026-09-03 (+0000) |
| `recommendations` | domain, app | _no public exports_ | platform-eng | 2026-05-05 (+0000) |
| `reporting` | domain, app, infra | _no public exports_ | platform-eng | 2026-08-30 (+0000) |
| `settings` | http | _no public exports_ | platform-eng | 2026-05-05 (+0000) |
| `tenant` | http | _no public exports_ | platform-eng | 2026-05-01 (+0000) |
| `underwriting` | domain, app | _no public exports_ | platform-eng | 2026-07-31 (+0000) |
| `users` | app, http | _no public exports_ | platform-eng | 2026-05-07 (+0000) |
| `vehicles` | app, http | _no public exports_ | platform-eng | 2026-05-09 (+0000) |
