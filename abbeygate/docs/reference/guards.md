---
title: CI Guards Inventory
audience: agent
status: living
owner: platform-eng
reviewed: 2026-09-07
binding: false
generated_by: tools/docs/generate-guards.mjs
---
<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Run `npm run docs:generate -- --only=guards` to regenerate.
  CI: `npm run docs:generate -- --check` fails on drift.
-->

# CI Guards Inventory

Every guard / lint / policy / verify / proof script wired through `package.json`. Severity is read from script wiring (release-blocking and strict variants are `error`; the rest start at `warn` and graduate via the reusable quality-gate workflow).

## Schema

| Column | Source |
|--------|--------|
| Guard | npm script name |
| Script | Path under `tools/quality/` |
| Severity | `error` (blocks merge) or `warn` (logged, does not block) |
| Enforces | First comment block in the script |
| Last changed | Most recent `git log` commit touching the script |

## Inventory (105 guards)

| Guard | Script | Severity | Enforces | Last changed |
|-------|--------|----------|----------|--------------|
| `guard:any-baseline` | `tools/quality/check-any-baseline.mjs` | `error` | Regex-scoped explicit-any ratchet (Layer 5). Counts every literal | 2026-05-20 (+0000) |
| `guard:any-resolved` | `tools/quality/check-any-resolved.mjs` | `error` | Resolved-any baseline ratchet (Layer 1). Walks the backend and frontend | 2026-05-20 (+0000) |
| `guard:any-resolved:report` | `tools/quality/check-any-resolved.mjs` | `error` | Resolved-any baseline ratchet (Layer 1). Walks the backend and frontend | 2026-05-20 (+0000) |
| `guard:any-resolved:write` | `tools/quality/check-any-resolved.mjs` | `error` | Resolved-any baseline ratchet (Layer 1). Walks the backend and frontend | 2026-05-20 (+0000) |
| `guard:architecture-locks` | `tools/quality/check-architecture-locks.mjs` | `error` | _no summary in script header_ | 2026-05-24 (+0000) |
| `guard:backend-core-business-imports` | `tools/quality/check-backend-core-business-imports.mjs` | `error` | _no summary in script header_ | 2026-05-05 (+0000) |
| `guard:backend-dependency-graph` | `tools/quality/check-backend-dependency-graph-artifact.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:backend-http-boundaries:strict` | `tools/quality/check-backend-http-boundaries.mjs` | `error` | _no summary in script header_ | 2026-07-04 (+0000) |
| `guard:backend-layer-allowlists-empty` | `tools/quality/check-backend-layer-allowlists-empty.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:backend-module-delegation` | `tools/quality/check-backend-module-delegation.mjs` | `error` | _no summary in script header_ | 2026-07-04 (+0000) |
| `guard:claim-workspace-no-direct-neo4j` | `tools/quality/check-claim-workspace-no-direct-neo4j.mjs` | `error` | _no summary in script header_ | 2026-05-29 (+0000) |
| `guard:configuration-overlay-bounds` | `tools/quality/check-configuration-overlay-bounds.mjs` | `error` | _no summary in script header_ | 2026-05-28 (+0000) |
| `guard:contracts-product-consistency` | `tools/quality/check-contracts-product-consistency.mjs` | `error` | Guard: contracts:product-consistency  (ADR-0010 — "docs win" rule | 2026-05-05 (+0000) |
| `guard:contracts-product-consistency:test` | `tools/quality/__tests__/check-contracts-product-consistency.test.mjs` | `error` | Synthetic-drift coverage for `guard:contracts-product-consistency`. | 2026-05-03 (+0000) |
| `guard:cypher-files-tenant-scoped` | `tools/quality/check-cypher-files-tenant-scoped.mjs` | `error` | _no summary in script header_ | 2026-05-29 (+0000) |
| `guard:dashboard-no-policy-jsonb-hydration` | `tools/quality/check-dashboard-no-policy-jsonb-hydration.mjs` | `error` | eslint-disable-next-line no-console | 2026-05-03 (+0000) |
| `guard:dead-code-baseline` | `tools/quality/check-dead-code-baseline.mjs` | `error` | Dead-code ratchet. Counts ts-prune real exports (excluding the | 2026-05-14 (+0000) |
| `guard:depcheck-baseline` | `tools/quality/check-depcheck-baseline.mjs` | `error` | depcheck ratchet. Counts unused/missing deps and fails when any | 2026-05-14 (+0000) |
| `guard:dependency-duplication-drift` | `tools/quality/check-dependency-duplication-drift.mjs` | `error` | Exclude optional dependencies to avoid platform-specific drift noise | 2026-03-27 (+0000) |
| `guard:dependency-missing` | `tools/quality/check-missing-direct-dependencies.mjs` | `error` | _no summary in script header_ | 2026-03-27 (+0000) |
| `guard:dependency-outdated-policy` | `tools/quality/check-outdated-package-policy.mjs` | `error` | _no summary in script header_ | 2026-08-25 (+0000) |
| `guard:docker-asset-parity` | `tools/quality/check-docker-asset-parity.mjs` | `error` | _no summary in script header_ | 2026-05-10 (+0000) |
| `guard:docs-code-consistency` | `tools/quality/check-docs-code-consistency.mjs` | `error` | Guard: every module / worker / guard / contract that exists in code | 2026-05-03 (+0000) |
| `guard:docs-duplicate-filenames` | `tools/quality/check-docs-duplicate-filenames.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:docs-frontmatter` | `tools/quality/check-docs-frontmatter.mjs` | `error` | Guard: every living markdown file under docs/ must declare YAML | 2026-05-03 (+0000) |
| `guard:docs-max-lines` | `tools/quality/check-docs-max-lines.mjs` | `error` | Guard: documentation discipline — every doc fits in a reviewable | 2026-05-03 (+0000) |
| `guard:docs-runbook-coverage` | `tools/quality/check-docs-runbook-coverage.mjs` | `error` | Guard: every BullMQ worker handler under backend/workers/handlers/ MUST | 2026-05-03 (+0000) |
| `guard:docs-single-source` | `tools/quality/check-docs-single-source.mjs` | `error` | Guard: no two living docs claim authority over the same topic. | 2026-05-03 (+0000) |
| `guard:docs-stale` | `tools/quality/check-docs-stale.mjs` | `error` | Guard: documentation freshness windows. | 2026-05-03 (+0000) |
| `guard:domain-purity` | `tools/quality/check-domain-purity.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:domains-transitional-zone` | `tools/quality/check-domains-transitional-zone.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:e2e-journey-coverage` | `tools/quality/check-e2e-journey-coverage.mjs` | `error` | E2E journey coverage guard. | 2026-05-20 (+0000) |
| `guard:email-template-intake-manifest` | `tools/quality/check-email-template-intake-manifest.mjs` | `error` | _no summary in script header_ | 2026-03-19 (+0000) |
| `guard:event-routing-parity` | `tools/quality/check-event-routing-parity.mjs` | `error` | _no summary in script header_ | 2026-05-10 (+0000) |
| `guard:exception-deletion-ledger` | `tools/quality/check-exception-deletion-ledger.mjs` | `error` | _no summary in script header_ | 2026-05-10 (+0000) |
| `guard:express-request-augmentation` | `tools/quality/check-express-request-augmentation-single-source.mjs` | `error` | Express Request augmentation single-source rule. | 2026-05-20 (+0000) |
| `guard:http-handler-typing` | `tools/quality/check-http-handler-typing.mjs` | `error` | Diff-only guard for ADR-0028 — typed HTTP handler wrapper. | 2026-05-20 (+0000) |
| `guard:http-input-validation` | `tools/quality/check-http-input-validation.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:http-transport-burndown` | `tools/quality/check-http-transport-burndown.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:legacy-api-imports` | `tools/quality/check-no-direct-lib-api-imports.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:license-compliance` | `tools/quality/check-license-compliance.mjs` | `error` | _no summary in script header_ | 2026-03-27 (+0000) |
| `guard:mcp-auth-single-funnel` | `tools/quality/check-mcp-auth-single-funnel.mjs` | `error` | _no summary in script header_ | 2026-05-28 (+0000) |
| `guard:neo4j-driver-only-in-platform-graph` | `tools/quality/check-neo4j-driver-only-in-platform-graph.mjs` | `error` | _no summary in script header_ | 2026-05-29 (+0000) |
| `guard:neo4j-no-app-pod-coupling` | `tools/quality/check-neo4j-no-app-pod-coupling.mjs` | `error` | _no summary in script header_ | 2026-05-29 (+0000) |
| `guard:neo4j-tenant-id-on-every-query` | `tools/quality/check-neo4j-tenant-id-on-every-query.mjs` | `error` | _no summary in script header_ | 2026-05-29 (+0000) |
| `guard:no-bare-prisma-on-tenant-scoped-models` | `tools/quality/check-no-bare-prisma-on-tenant-scoped-models.mjs` | `error` | _no summary in script header_ | 2026-05-01 (+0000) |
| `guard:no-competing-domains` | `tools/quality/check-no-competing-domains.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:no-cross-layer-shadow-files` | `tools/quality/check-no-cross-layer-shadow-files.mjs` | `error` | Guard: within a backend module, no source-file basename may exist with | 2026-05-03 (+0000) |
| `guard:no-deep-product-imports` | `tools/quality/check-no-deep-product-imports.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:no-deep-shared-ui-imports` | `tools/quality/check-no-deep-shared-ui-imports.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:no-default-tenant-fallbacks` | `tools/quality/check-no-default-tenant-fallbacks.mjs` | `error` | --------------------------------------------------------------------------- | 2026-05-01 (+0000) |
| `guard:no-deleted-identifiers` | `tools/quality/check-no-deleted-identifiers.mjs` | `error` | _no summary in script header_ | 2026-05-10 (+0000) |
| `guard:no-direct-claim-mutability-writes` | `tools/quality/check-no-direct-claim-mutability-writes.mjs` | `error` | Allow the dedicated command boundary to perform legacy projection sync writes. | 2026-03-16 (+0000) |
| `guard:no-direct-policy-status-writes` | `tools/quality/check-no-direct-policy-status-writes.mjs` | `error` | Scan HTTP route layers that can mutate policies. Only `statusRouter.ts` | 2026-05-14 (+0000) |
| `guard:no-inline-rate-tables` | `tools/quality/check-no-inline-rate-tables.mjs` | `error` | _no summary in script header_ | 2026-05-10 (+0000) |
| `guard:no-new-retired-zones` | `tools/quality/check-no-new-retired-zones.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:no-new-services` | `tools/quality/check-no-new-services.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:no-product-literals-in-conformance` | `tools/quality/check-no-product-literals-in-conformance.mjs` | `error` | _no summary in script header_ | 2026-05-01 (+0000) |
| `guard:no-product-literals-in-shared-bo` | `tools/quality/check-no-product-literals-in-shared-bo.mjs` | `error` | Motor's config / legacy modules are motor implementation, not shared BO. | 2026-05-01 (+0000) |
| `guard:no-raw-cypher-mcp-tool` | `tools/quality/check-no-raw-cypher-mcp-tool.mjs` | `error` | session.run(<identifier-or-property-access-not-quoted-string>) - flag. | 2026-05-29 (+0000) |
| `guard:no-raw-html-controls` | `tools/quality/check-no-raw-html-controls.mjs` | `error` | Intentional native control files: | 2026-03-16 (+0000) |
| `guard:no-raw-tenant-env` | `tools/quality/check-no-raw-tenant-env.mjs` | `error` | --------------------------------------------------------------------------- | 2026-05-10 (+0000) |
| `guard:no-retired-pages-imports` | `tools/quality/check-no-retired-pages-imports.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:no-retired-pages-imports:strict` | `tools/quality/check-no-retired-pages-imports.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:no-shared-product-facades` | `tools/quality/check-no-shared-product-facades.mjs` | `error` | _no summary in script header_ | 2026-05-01 (+0000) |
| `guard:no-xlsx-runtime-imports` | `tools/quality/check-no-xlsx-runtime-imports.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:no-zod-in-product-wizard-schemas` | `tools/quality/check-no-zod-in-product-wizard-schemas.mjs` | `error` | Products allowed to import `zod` directly during a migration window. The | 2026-05-01 (+0000) |
| `guard:oauth-consent-role-gate` | `tools/quality/check-oauth-consent-role-gate.mjs` | `error` | The consent decision handler must import and call assertCanGrantScopes. | 2026-05-28 (+0000) |
| `guard:oauth-pkce-required` | `tools/quality/check-oauth-pkce-required.mjs` | `error` | _no summary in script header_ | 2026-05-28 (+0000) |
| `guard:oauth-resource-bound` | `tools/quality/check-oauth-resource-bound.mjs` | `error` | _no summary in script header_ | 2026-05-28 (+0000) |
| `guard:one-source-truth` | `tools/quality/check-one-source-truth.mjs` | `error` | `seed` houses the per-stage submodules of `backend/seed.ts` after the | 2026-05-14 (+0000) |
| `guard:operator-mcp-no-direct-db-writes` | `tools/quality/check-operator-mcp-no-direct-db-writes.mjs` | `error` | _no summary in script header_ | 2026-05-28 (+0000) |
| `guard:operator-mutation-preview-required` | `tools/quality/check-operator-mutation-preview-required.mjs` | `error` | _no summary in script header_ | 2026-05-28 (+0000) |
| `guard:operator-validate-on-patch` | `tools/quality/check-operator-validate-on-patch.mjs` | `error` | _no summary in script header_ | 2026-05-28 (+0000) |
| `guard:outbound-http-boundary` | `tools/quality/check-outbound-http-boundary.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:policy-product-matches-binder-authority` | `tools/quality/check-policy-product-matches-binder-authority.mjs` | `error` | Legitimate non-production callers that may bypass the guard. | 2026-05-01 (+0000) |
| `guard:prisma-schema-change-requires-migration` | `tools/quality/check-prisma-schema-change-requires-migration.mjs` | `error` | _no summary in script header_ | 2026-04-06 (+0000) |
| `guard:product-engine-contract` | `tools/quality/check-product-engine-contract.mjs` | `error` | _no summary in script header_ | 2026-05-14 (+0000) |
| `guard:product-golden-fixtures` | `tools/quality/check-product-golden-fixtures.mjs` | `error` | _no summary in script header_ | 2026-05-01 (+0000) |
| `guard:product-launch-draft-isolation` | `tools/quality/check-product-launch-draft-isolation.mjs` | `error` | The Prisma extension file is allowed to enumerate the model name in | 2026-05-28 (+0000) |
| `guard:product-onboarding-canonical` | `tools/quality/check-product-onboarding-canonical.mjs` | `error` | ADR-0033 — Product onboarding canonical checklist. | 2026-08-25 (+0000) |
| `guard:product-validation-authority` | `tools/quality/check-product-validation-authority.ts` | `error` | _no summary in script header_ | 2026-05-01 (+0000) |
| `guard:products-single-source` | `tools/quality/check-products-single-source.mjs` | `error` | _no summary in script header_ | 2026-05-01 (+0000) |
| `guard:public-build-no-bo-symbols` | `tools/quality/check-public-build-no-bo-symbols.mjs` | `error` | _no summary in script header_ | 2026-03-17 (+0000) |
| `guard:questionnaire-freeze` | `tools/quality/check-questionnaire-freeze.mjs` | `error` | _no summary in script header_ | 2026-05-01 (+0000) |
| `guard:remediation-freeze` | `tools/quality/check-remediation-freeze.mjs` | `error` | _no summary in script header_ | 2026-05-11 (+0000) |
| `guard:retired-path-references` | `tools/quality/check-retired-path-references.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:root-hygiene` | `tools/quality/check-root-hygiene.mjs` | `error` | _no summary in script header_ | 2026-05-03 (+0000) |
| `guard:sentry-wiring` | `tools/quality/check-sentry-wiring.mjs` | `error` | _no summary in script header_ | 2026-05-16 (+0000) |
| `guard:shared-purity` | `tools/quality/check-shared-purity.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:test-import-zones` | `tools/quality/check-test-import-zones.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:tools-duplicate-ownership` | `tools/quality/check-tools-duplicate-ownership.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:typed-handler-schema-quality` | `tools/quality/check-typed-handler-schema-quality.mjs` | `error` | Schema-honesty fence for ADR-0028's `typedHandler(schemas, handler)`. | 2026-05-20 (+0000) |
| `guard:validation-contract-parity` | `tools/quality/check-validation-contract-parity.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:validation-contract-parity:strict` | `tools/quality/check-validation-contract-parity.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `guard:validation-purity` | `tools/quality/check-validation-purity.mjs` | `error` | _no summary in script header_ | 2026-05-01 (+0000) |
| `guard:validation-single-source` | `tools/quality/check-validation-single-source.mjs` | `error` | _no summary in script header_ | 2026-05-01 (+0000) |
| `guard:workflow-quality-parity` | `tools/quality/check-workflow-quality-parity.mjs` | `error` | _no summary in script header_ | 2026-08-14 (+0000) |
| `lint:core-guard` | `tools/quality/check-no-core-domain-leaks.mjs` | `error` | _no summary in script header_ | 2026-03-16 (+0000) |
| `lint:frontend-zones` | `tools/quality/check-frontend-import-zones.mjs` | `warn` | _no summary in script header_ | 2026-03-16 (+0000) |
| `lint:frontend-zones:strict` | `tools/quality/check-frontend-import-zones.mjs` | `warn` | _no summary in script header_ | 2026-03-16 (+0000) |
| `lint:layers` | `tools/quality/check-layer-boundaries.mjs` | `warn` | _no summary in script header_ | 2026-03-16 (+0000) |
| `policy:any-exceptions` | `tools/quality/check-any-exceptions.mjs` | `warn` | Self-exclude the quality tooling's own tests: by construction, those files | 2026-05-20 (+0000) |
| `proof:issuance-spine` | `tools/quality/ops/prove-issued-docs-and-email.ts` | `warn` | _no summary in script header_ | 2026-08-28 (+0000) |
| `verify:runtime-artifacts` | `tools/quality/verify-runtime-artifacts.mjs` | `warn` | Non-PDF runtime assets that must exist in source before the image is built. | 2026-07-17 (+0000) |
