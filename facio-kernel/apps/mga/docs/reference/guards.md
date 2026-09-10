---
title: CI Guards Inventory
audience: agent
status: living
owner: platform-eng
reviewed: 2026-09-09
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
| Content revision | Stable hash of the guard script content |

## Inventory (104 guards)

| Guard | Script | Severity | Enforces | Content revision |
|-------|--------|----------|----------|--------------|
| `guard:any-baseline` | `tools/quality/check-any-baseline.mjs` | `error` | Regex-scoped explicit-any ratchet (Layer 5). Counts every literal | content:a4176a3d1858 |
| `guard:any-resolved` | `tools/quality/check-any-resolved.mjs` | `error` | Resolved-any baseline ratchet (Layer 1). Walks the backend and frontend | content:6c2257ba7ba1 |
| `guard:any-resolved:report` | `tools/quality/check-any-resolved.mjs` | `error` | Resolved-any baseline ratchet (Layer 1). Walks the backend and frontend | content:6c2257ba7ba1 |
| `guard:any-resolved:write` | `tools/quality/check-any-resolved.mjs` | `error` | Resolved-any baseline ratchet (Layer 1). Walks the backend and frontend | content:6c2257ba7ba1 |
| `guard:architecture-locks` | `tools/quality/check-architecture-locks.mjs` | `error` | _no summary in script header_ | content:1288a4e98171 |
| `guard:backend-core-business-imports` | `tools/quality/check-backend-core-business-imports.mjs` | `error` | _no summary in script header_ | content:695afb264395 |
| `guard:backend-dependency-graph` | `tools/quality/check-backend-dependency-graph-artifact.mjs` | `error` | _no summary in script header_ | content:e5e20a707ac5 |
| `guard:backend-http-boundaries:strict` | `tools/quality/check-backend-http-boundaries.mjs` | `error` | _no summary in script header_ | content:059754d43699 |
| `guard:backend-layer-allowlists-empty` | `tools/quality/check-backend-layer-allowlists-empty.mjs` | `error` | _no summary in script header_ | content:111355f1681f |
| `guard:backend-module-delegation` | `tools/quality/check-backend-module-delegation.mjs` | `error` | _no summary in script header_ | content:cc9d7c315bdf |
| `guard:claim-workspace-no-direct-neo4j` | `tools/quality/check-claim-workspace-no-direct-neo4j.mjs` | `error` | _no summary in script header_ | content:4d1eeaa9da6e |
| `guard:contracts-product-consistency` | `tools/quality/check-contracts-product-consistency.mjs` | `error` | Guard: contracts:product-consistency  (ADR-0010 — "docs win" rule | content:94e6eca55091 |
| `guard:contracts-product-consistency:test` | `tools/quality/__tests__/check-contracts-product-consistency.test.mjs` | `error` | Synthetic-drift coverage for `guard:contracts-product-consistency`. | content:495f48b8ab7b |
| `guard:cypher-files-tenant-scoped` | `tools/quality/check-cypher-files-tenant-scoped.mjs` | `error` | _no summary in script header_ | content:89c93ab10dd6 |
| `guard:dashboard-no-policy-jsonb-hydration` | `tools/quality/check-dashboard-no-policy-jsonb-hydration.mjs` | `error` | eslint-disable-next-line no-console | content:34eeb55b6f59 |
| `guard:dead-code-baseline` | `tools/quality/check-dead-code-baseline.mjs` | `error` | Dead-code ratchet. Counts ts-prune real exports (excluding the | content:3be95f375545 |
| `guard:depcheck-baseline` | `tools/quality/check-depcheck-baseline.mjs` | `error` | depcheck ratchet. Counts unused/missing deps and fails when any | content:ecca585de0a6 |
| `guard:dependency-duplication-drift` | `tools/quality/check-dependency-duplication-drift.mjs` | `error` | Exclude optional dependencies to avoid platform-specific drift noise | content:77e981f6792e |
| `guard:dependency-missing` | `tools/quality/check-missing-direct-dependencies.mjs` | `error` | _no summary in script header_ | content:5ba06a90aed3 |
| `guard:dependency-outdated-policy` | `tools/quality/check-outdated-package-policy.mjs` | `error` | _no summary in script header_ | content:a062c3e9475a |
| `guard:docker-asset-parity` | `tools/quality/check-docker-asset-parity.mjs` | `error` | _no summary in script header_ | content:a38a013d8a58 |
| `guard:docs-code-consistency` | `tools/quality/check-docs-code-consistency.mjs` | `error` | Guard: every module / worker / guard / contract that exists in code | content:721d6cf46303 |
| `guard:docs-duplicate-filenames` | `tools/quality/check-docs-duplicate-filenames.mjs` | `error` | _no summary in script header_ | content:b78db9d88a45 |
| `guard:docs-frontmatter` | `tools/quality/check-docs-frontmatter.mjs` | `error` | Guard: every living markdown file under docs/ must declare YAML | content:7325552b1a90 |
| `guard:docs-max-lines` | `tools/quality/check-docs-max-lines.mjs` | `error` | Guard: documentation discipline — every doc fits in a reviewable | content:7b825700a27b |
| `guard:docs-runbook-coverage` | `tools/quality/check-docs-runbook-coverage.mjs` | `error` | Guard: every BullMQ worker handler under backend/workers/handlers/ MUST | content:d7547b1cbdd6 |
| `guard:docs-single-source` | `tools/quality/check-docs-single-source.mjs` | `error` | Guard: no two living docs claim authority over the same topic. | content:0e07386215f9 |
| `guard:docs-stale` | `tools/quality/check-docs-stale.mjs` | `error` | Guard: documentation freshness windows. | content:ed694da07c16 |
| `guard:domain-purity` | `tools/quality/check-domain-purity.mjs` | `error` | _no summary in script header_ | content:5577cc113965 |
| `guard:domains-transitional-zone` | `tools/quality/check-domains-transitional-zone.mjs` | `error` | _no summary in script header_ | content:5ef6b5244afb |
| `guard:e2e-journey-coverage` | `tools/quality/check-e2e-journey-coverage.mjs` | `error` | E2E journey coverage guard. | content:7b2986785232 |
| `guard:email-template-intake-manifest` | `tools/quality/check-email-template-intake-manifest.mjs` | `error` | _no summary in script header_ | content:7e998cdc5b54 |
| `guard:event-routing-parity` | `tools/quality/check-event-routing-parity.mjs` | `error` | _no summary in script header_ | content:0b2c62ee5d92 |
| `guard:exception-deletion-ledger` | `tools/quality/check-exception-deletion-ledger.mjs` | `error` | _no summary in script header_ | content:060e2c487171 |
| `guard:express-request-augmentation` | `tools/quality/check-express-request-augmentation-single-source.mjs` | `error` | Express Request augmentation single-source rule. | content:d06a4a5854ae |
| `guard:http-handler-typing` | `tools/quality/check-http-handler-typing.mjs` | `error` | Diff-only guard for ADR-0028 — typed HTTP handler wrapper. | content:53c43e730d06 |
| `guard:http-input-validation` | `tools/quality/check-http-input-validation.mjs` | `error` | _no summary in script header_ | content:a52fe614b477 |
| `guard:http-transport-burndown` | `tools/quality/check-http-transport-burndown.mjs` | `error` | _no summary in script header_ | content:bc2b07b2dc1f |
| `guard:legacy-api-imports` | `tools/quality/check-no-direct-lib-api-imports.mjs` | `error` | _no summary in script header_ | content:bbefc955339f |
| `guard:license-compliance` | `tools/quality/check-license-compliance.mjs` | `error` | _no summary in script header_ | content:68c782c5fcf5 |
| `guard:mcp-auth-single-funnel` | `tools/quality/check-mcp-auth-single-funnel.mjs` | `error` | _no summary in script header_ | content:af407fc11724 |
| `guard:neo4j-driver-only-in-platform-graph` | `tools/quality/check-neo4j-driver-only-in-platform-graph.mjs` | `error` | _no summary in script header_ | content:0c35fd29f058 |
| `guard:neo4j-no-app-pod-coupling` | `tools/quality/check-neo4j-no-app-pod-coupling.mjs` | `error` | _no summary in script header_ | content:ab8ea79262fc |
| `guard:neo4j-tenant-id-on-every-query` | `tools/quality/check-neo4j-tenant-id-on-every-query.mjs` | `error` | _no summary in script header_ | content:1d6d27185064 |
| `guard:no-bare-prisma-on-tenant-scoped-models` | `tools/quality/check-no-bare-prisma-on-tenant-scoped-models.mjs` | `error` | _no summary in script header_ | content:985656aaf03e |
| `guard:no-competing-domains` | `tools/quality/check-no-competing-domains.mjs` | `error` | _no summary in script header_ | content:d48811a8885e |
| `guard:no-cross-layer-shadow-files` | `tools/quality/check-no-cross-layer-shadow-files.mjs` | `error` | Guard: within a backend module, no source-file basename may exist with | content:68e9376ae004 |
| `guard:no-deep-product-imports` | `tools/quality/check-no-deep-product-imports.mjs` | `error` | _no summary in script header_ | content:9fceb802ae06 |
| `guard:no-deep-shared-ui-imports` | `tools/quality/check-no-deep-shared-ui-imports.mjs` | `error` | _no summary in script header_ | content:fb2ec76aae5b |
| `guard:no-default-tenant-fallbacks` | `tools/quality/check-no-default-tenant-fallbacks.mjs` | `error` | --------------------------------------------------------------------------- | content:aa1b2b2951b9 |
| `guard:no-deleted-identifiers` | `tools/quality/check-no-deleted-identifiers.mjs` | `error` | _no summary in script header_ | content:02ced6433b1d |
| `guard:no-direct-claim-mutability-writes` | `tools/quality/check-no-direct-claim-mutability-writes.mjs` | `error` | Allow the dedicated command boundary to perform legacy projection sync writes. | content:ea631d32ced3 |
| `guard:no-direct-policy-status-writes` | `tools/quality/check-no-direct-policy-status-writes.mjs` | `error` | Scan HTTP route layers that can mutate policies. Only `statusRouter.ts` | content:36178c821a04 |
| `guard:no-inline-rate-tables` | `tools/quality/check-no-inline-rate-tables.mjs` | `error` | _no summary in script header_ | content:6f0168325150 |
| `guard:no-new-retired-zones` | `tools/quality/check-no-new-retired-zones.mjs` | `error` | _no summary in script header_ | content:55122f595b4a |
| `guard:no-new-services` | `tools/quality/check-no-new-services.mjs` | `error` | _no summary in script header_ | content:8af1a7353c47 |
| `guard:no-product-literals-in-conformance` | `tools/quality/check-no-product-literals-in-conformance.mjs` | `error` | _no summary in script header_ | content:2716bdf497a0 |
| `guard:no-product-literals-in-shared-bo` | `tools/quality/check-no-product-literals-in-shared-bo.mjs` | `error` | Motor's config / legacy modules are motor implementation, not shared BO. | content:e3b225ec0189 |
| `guard:no-raw-cypher-mcp-tool` | `tools/quality/check-no-raw-cypher-mcp-tool.mjs` | `error` | session.run(<identifier-or-property-access-not-quoted-string>) - flag. | content:1c15b3e9c29f |
| `guard:no-raw-html-controls` | `tools/quality/check-no-raw-html-controls.mjs` | `error` | Intentional native control files: | content:dc5bd564d083 |
| `guard:no-raw-tenant-env` | `tools/quality/check-no-raw-tenant-env.mjs` | `error` | --------------------------------------------------------------------------- | content:ce036b10b55b |
| `guard:no-retired-pages-imports` | `tools/quality/check-no-retired-pages-imports.mjs` | `error` | _no summary in script header_ | content:719262fcf33a |
| `guard:no-retired-pages-imports:strict` | `tools/quality/check-no-retired-pages-imports.mjs` | `error` | _no summary in script header_ | content:719262fcf33a |
| `guard:no-shared-product-facades` | `tools/quality/check-no-shared-product-facades.mjs` | `error` | _no summary in script header_ | content:f3b4525f3fa5 |
| `guard:no-xlsx-runtime-imports` | `tools/quality/check-no-xlsx-runtime-imports.mjs` | `error` | _no summary in script header_ | content:975b46ca33c5 |
| `guard:no-zod-in-product-wizard-schemas` | `tools/quality/check-no-zod-in-product-wizard-schemas.mjs` | `error` | Products allowed to import `zod` directly during a migration window. The | content:1e11851511aa |
| `guard:oauth-consent-role-gate` | `tools/quality/check-oauth-consent-role-gate.mjs` | `error` | The consent decision handler must import and call assertCanGrantScopes. | content:b4a79350969f |
| `guard:oauth-pkce-required` | `tools/quality/check-oauth-pkce-required.mjs` | `error` | _no summary in script header_ | content:a22208b8085f |
| `guard:oauth-resource-bound` | `tools/quality/check-oauth-resource-bound.mjs` | `error` | _no summary in script header_ | content:fd91230c6cb6 |
| `guard:one-source-truth` | `tools/quality/check-one-source-truth.mjs` | `error` | `seed` houses the per-stage submodules of `backend/seed.ts` after the | content:45604c91f5ea |
| `guard:operator-mcp-no-direct-db-writes` | `tools/quality/check-operator-mcp-no-direct-db-writes.mjs` | `error` | _no summary in script header_ | content:e40aaddb389e |
| `guard:operator-mutation-preview-required` | `tools/quality/check-operator-mutation-preview-required.mjs` | `error` | _no summary in script header_ | content:f5dc520a1260 |
| `guard:operator-validate-on-patch` | `tools/quality/check-operator-validate-on-patch.mjs` | `error` | _no summary in script header_ | content:54874d92a79a |
| `guard:outbound-http-boundary` | `tools/quality/check-outbound-http-boundary.mjs` | `error` | _no summary in script header_ | content:3d64553cc22e |
| `guard:policy-product-matches-binder-authority` | `tools/quality/check-policy-product-matches-binder-authority.mjs` | `error` | Legitimate non-production callers that may bypass the guard. | content:3af205003cd6 |
| `guard:prisma-schema-change-requires-migration` | `tools/quality/check-prisma-schema-change-requires-migration.mjs` | `error` | _no summary in script header_ | content:79dee7681f8b |
| `guard:product-engine-contract` | `tools/quality/check-product-engine-contract.mjs` | `error` | _no summary in script header_ | content:15371a19f01b |
| `guard:product-golden-fixtures` | `tools/quality/check-product-golden-fixtures.mjs` | `error` | _no summary in script header_ | content:e3a943401a07 |
| `guard:product-launch-draft-isolation` | `tools/quality/check-product-launch-draft-isolation.mjs` | `error` | The Prisma extension file is allowed to enumerate the model name in | content:796aefffd422 |
| `guard:product-onboarding-canonical` | `tools/quality/check-product-onboarding-canonical.mjs` | `error` | ADR-0033 — Product onboarding canonical checklist. | content:8e3b851536cc |
| `guard:product-validation-authority` | `tools/quality/check-product-validation-authority.ts` | `error` | _no summary in script header_ | content:5749be0e3671 |
| `guard:products-single-source` | `tools/quality/check-products-single-source.mjs` | `error` | _no summary in script header_ | content:39aa60d9af73 |
| `guard:public-build-no-bo-symbols` | `tools/quality/check-public-build-no-bo-symbols.mjs` | `error` | _no summary in script header_ | content:0d73ca3ad6f0 |
| `guard:questionnaire-freeze` | `tools/quality/check-questionnaire-freeze.mjs` | `error` | _no summary in script header_ | content:5eaef42f67e5 |
| `guard:remediation-freeze` | `tools/quality/check-remediation-freeze.mjs` | `error` | _no summary in script header_ | content:a57f511fa7ed |
| `guard:retired-path-references` | `tools/quality/check-retired-path-references.mjs` | `error` | _no summary in script header_ | content:fcabc3919305 |
| `guard:root-hygiene` | `tools/quality/check-root-hygiene.mjs` | `error` | _no summary in script header_ | content:e9be97ac8574 |
| `guard:sentry-wiring` | `tools/quality/check-sentry-wiring.mjs` | `error` | _no summary in script header_ | content:723d3a3659a3 |
| `guard:shared-purity` | `tools/quality/check-shared-purity.mjs` | `error` | _no summary in script header_ | content:195aec696806 |
| `guard:test-import-zones` | `tools/quality/check-test-import-zones.mjs` | `error` | _no summary in script header_ | content:219438d8ef00 |
| `guard:tools-duplicate-ownership` | `tools/quality/check-tools-duplicate-ownership.mjs` | `error` | _no summary in script header_ | content:f4e667ecc661 |
| `guard:typed-handler-schema-quality` | `tools/quality/check-typed-handler-schema-quality.mjs` | `error` | Schema-honesty fence for ADR-0028's `typedHandler(schemas, handler)`. | content:4b90baedaf76 |
| `guard:validation-contract-parity` | `tools/quality/check-validation-contract-parity.mjs` | `error` | _no summary in script header_ | content:8a5715a20f17 |
| `guard:validation-contract-parity:strict` | `tools/quality/check-validation-contract-parity.mjs` | `error` | _no summary in script header_ | content:8a5715a20f17 |
| `guard:validation-purity` | `tools/quality/check-validation-purity.mjs` | `error` | _no summary in script header_ | content:2a8d2b36e583 |
| `guard:validation-single-source` | `tools/quality/check-validation-single-source.mjs` | `error` | _no summary in script header_ | content:f9fbdd356da2 |
| `guard:workflow-quality-parity` | `tools/quality/check-workflow-quality-parity.mjs` | `error` | _no summary in script header_ | content:7ad45a8b445a |
| `lint:core-guard` | `tools/quality/check-no-core-domain-leaks.mjs` | `error` | _no summary in script header_ | content:1589f2389c30 |
| `lint:frontend-zones` | `tools/quality/check-frontend-import-zones.mjs` | `warn` | _no summary in script header_ | content:ae60628f6b38 |
| `lint:frontend-zones:strict` | `tools/quality/check-frontend-import-zones.mjs` | `warn` | _no summary in script header_ | content:ae60628f6b38 |
| `lint:layers` | `tools/quality/check-layer-boundaries.mjs` | `warn` | _no summary in script header_ | content:749ef6648534 |
| `policy:any-exceptions` | `tools/quality/check-any-exceptions.mjs` | `warn` | Self-exclude the quality tooling's own tests: by construction, those files | content:1612f23acb54 |
| `proof:issuance-spine` | `tools/quality/ops/prove-issued-docs-and-email.ts` | `warn` | _no summary in script header_ | content:293b93ff0d1c |
| `verify:runtime-artifacts` | `tools/quality/verify-runtime-artifacts.mjs` | `warn` | Non-PDF runtime assets that must exist in source before the image is built. | content:ee924835c7e9 |
