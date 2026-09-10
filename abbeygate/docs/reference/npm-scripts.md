---
title: npm Scripts Catalogue
audience: agent
status: living
owner: platform-eng
reviewed: 2026-09-07
binding: false
generated_by: tools/docs/generate-npm-scripts.mjs
---
<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Run `npm run docs:generate -- --only=npm-scripts` to regenerate.
  CI: `npm run docs:generate -- --check` fails on drift.
-->

# npm Scripts Catalogue

Every script in `package.json` (218 total), grouped by namespace prefix. This is the single source for command-line invocations — runbooks and develop docs MUST link here rather than reproducing tables.

### analyze (1)

| Script | Command |
|--------|---------|
| `analyze:frontend` | `ANALYZE=true vite build --config frontend/vite.config.ts` |

### audit (7)

| Script | Command |
|--------|---------|
| `audit:all` | `npm run audit:deadcode:backend && npm run audit:deadcode:frontend && npm run audit:deps && npm run audit:types` |
| `audit:deadcode:backend` | `mkdir -p artifacts/quality && npx ts-prune -p backend/tsconfig.json \| grep -v 'packages/.*/dist/' > artifacts/quality/ts-prune-backend.txt; npx madge --extensions ts,tsx --ts-config backend/tsconfig.json --orphans --exclude "^backend/dist\|\\.d\\.ts$\|__tests__\|\\.test\\.ts$" backend > artifacts/quality/madge-orphans-backend.txt` |
| `audit:deadcode:frontend` | `mkdir -p artifacts/quality && npx ts-prune -p frontend/tsconfig.json > artifacts/quality/ts-prune-frontend.txt && npx madge --extensions ts,tsx --ts-config frontend/tsconfig.json --orphans --exclude "\\.test\\.(ts\|tsx)$\|__tests__\|\\.d\\.ts$" frontend/src > artifacts/quality/madge-orphans-frontend.txt` |
| `audit:deps` | `mkdir -p artifacts/quality && npx depcheck --json > artifacts/quality/depcheck.json \|\| true` |
| `audit:high:approved` | `node tools/quality/check-audit-high-approvals.mjs` |
| `audit:prod:critical` | `npm audit --omit=dev --audit-level=critical` |
| `audit:types` | `mkdir -p artifacts/quality && npm run type-check > artifacts/quality/tsc-noemit.txt 2>&1 \|\| true` |

### backup (2)

| Script | Command |
|--------|---------|
| `backup:posture:check` | `node tools/quality/aks/check-backup-posture.mjs` |
| `backup:restore:validate` | `node tools/quality/aks/backup-restore-validate.mjs` |

### bdx (14)

| Script | Command |
|--------|---------|
| `bdx:backfill:binder-reporting-local` | `tsx tools/migrations/backfill_local_binder_reporting_defaults.ts` |
| `bdx:backfill:policies-local` | `tsx tools/migrations/backfill_local_policy_reporting_values.ts` |
| `bdx:backfill:premium-financials` | `tsx tools/migrations/backfill_premium_mif_and_cr_fields.ts` |
| `bdx:backfill:typed-fields` | `tsx tools/migrations/backfill_lloyds_typed_fields.ts` |
| `bdx:build-safe-template` | `tsx tools/migrations/build_bdx_safe_upload_template.ts` |
| `bdx:corpus:dry-run` | `node tools/migrations/run_bdx_corpus_migration.mjs dryrun` |
| `bdx:corpus:upload` | `node tools/migrations/upload_bdx_corpus_to_blob.mjs` |
| `bdx:dry-run` | `tsx tools/migrations/run_bdx_import_dryrun.ts` |
| `bdx:export-hard-fails` | `tsx tools/migrations/export_bdx_hard_fail_report.ts` |
| `bdx:export-history-mismatches` | `tsx tools/migrations/export_bdx_history_mismatch_report.ts` |
| `bdx:import:k8s` | `bash tools/migrations/run-bdx-k8s.sh import` |
| `bdx:reconcile:k8s` | `bash tools/migrations/run-bdx-k8s.sh reconcile` |
| `bdx:reset-rerun:disposable` | `node tools/migrations/reset_and_rerun_bdx_disposable.mjs` |
| `bdx:split` | `tsx tools/migrations/split_bdx_by_tenant.ts` |

### binders (2)

| Script | Command |
|--------|---------|
| `binders:consolidate` | `tsx tools/migrations/consolidate_programs_and_binders.ts` |
| `binders:consolidate:apply` | `tsx tools/migrations/consolidate_programs_and_binders.ts --apply` |

### build (9)

| Script | Command |
|--------|---------|
| `build` | `npm run build:api && npm run build:frontend` |
| `build:api` | `npm run build:validation && npm run build:products && npm run verify:runtime-artifacts && npm run validate:policy-registry && npm run guard:email-template-intake-manifest && npm run reporting:lineage:check && npm run guard:no-direct-policy-status-writes && npm run guard:no-direct-claim-mutability-writes && npm run guard:no-default-tenant-fallbacks && npm run guard:no-raw-tenant-env && npm run guard:no-bare-prisma-on-tenant-scoped-models && npm run guard:no-shared-product-facades && npm run guard:product-engine-contract && npm run guard:product-onboarding-canonical && npm run guard:product-golden-fixtures && npm run guard:no-product-literals-in-conformance && npm run guard:validation-purity && npm run guard:validation-single-source && npm run guard:products-single-source && npm run guard:product-validation-authority && npm run guard:dashboard-no-policy-jsonb-hydration && npm run guard:architecture-locks && npm run guard:no-deleted-identifiers && npm run guard:exception-deletion-ledger && npm run guard:no-cross-layer-shadow-files && npm run guard:policy-product-matches-binder-authority && tsc -p backend/tsconfig.json` |
| `build:frontend` | `npm run guard:frontend:base && npm run guard:no-zod-in-product-wizard-schemas && npm run guard:validation-purity && npm run guard:validation-single-source && npm run guard:products-single-source && npm run guard:product-validation-authority && npm run guard:architecture-locks && vite build --config frontend/vite.config.ts` |
| `build:frontend:bo` | `npm run guard:frontend:base && FACIO_SURFACE_BUILD=bo VITE_SURFACE=bo vite build --config frontend/vite.config.ts` |
| `build:frontend:client` | `npm run guard:frontend:base && FACIO_SURFACE_BUILD=client VITE_SURFACE=client vite build --config frontend/vite.config.ts` |
| `build:frontend:public` | `npm run guard:frontend:base && FACIO_SURFACE_BUILD=public VITE_SURFACE=public vite build --config frontend/vite.config.ts` |
| `build:frontend:surfaces` | `npm run build:frontend:public && npm run build:frontend:client && npm run build:frontend:bo` |
| `build:products` | `npm run build --workspace=@facio/products` |
| `build:validation` | `npm run build --workspace=@facio/validation` |

### contract (2)

| Script | Command |
|--------|---------|
| `contract:generate` | `tsx tools/quality/generateValidationContractArtifacts.ts` |
| `contract:generate:check` | `tsx tools/quality/generateValidationContractArtifacts.ts --check` |

### db (6)

| Script | Command |
|--------|---------|
| `db:audit:runtime-contract` | `node tools/quality/aks/check-runtime-db-contract.mjs` |
| `db:migrate:dev` | `prisma migrate dev` |
| `db:push` | `prisma db push` |
| `db:push:ci` | `prisma db push --accept-data-loss` |
| `db:push:dev` | `prisma db push --accept-data-loss` |
| `db:seed` | `tsx prisma/seed.ts && tsx backend/seed.ts` |

### demo (2)

| Script | Command |
|--------|---------|
| `demo:bonzah:reset` | `node tools/demo/reset-bonzah-demo.mjs` |
| `demo:bonzah:serve` | `tsx tools/demo/serve-bonzah-api.ts` |

### dev (5)

| Script | Command |
|--------|---------|
| `dev` | `concurrently "npm run dev:api" "npm run dev:frontend"` |
| `dev:api` | `npm run db:push:dev && npm run db:seed && tsx watch apps/api/index.ts` |
| `dev:frontend` | `vite --config frontend/vite.config.ts` |
| `dev:worker` | `tsx watch apps/worker/index.ts` |
| `dev:worker:once` | `tsx apps/worker/index.ts` |

### docs (4)

| Script | Command |
|--------|---------|
| `docs:backend-dependency-graph` | `npx madge --extensions ts,tsx --ts-config backend/tsconfig.json --image docs/architecture/backend-dependency-graph.svg backend/index.ts` |
| `docs:generate` | `node tools/docs/generate.mjs` |
| `docs:generate:check` | `node tools/docs/generate.mjs --check` |
| `docs:migration-plan` | `node tools/docs/build-migration-plan.mjs` |

### doctor (1)

| Script | Command |
|--------|---------|
| `doctor:staging` | `bash tools/quality/aks/staging-doctor.sh` |

### evidence (1)

| Script | Command |
|--------|---------|
| `evidence:staging` | `bash tools/quality/aks/collect-staging-evidence.sh` |

### fix (1)

| Script | Command |
|--------|---------|
| `fix:eslint-runtime` | `node tools/quality/repair-eslint-runtime.mjs` |

### gate (6)

| Script | Command |
|--------|---------|
| `gate:agent` | `bash ./tools/quality/agent-gate.sh` |
| `gate:agent:full` | `bash ./tools/quality/agent-gate.sh full` |
| `gate:agent:staging-like` | `bash ./tools/quality/agent-gate.sh staging-like` |
| `gate:agent:static` | `bash ./tools/quality/agent-gate.sh static` |
| `gate:agent:unit-full` | `bash ./tools/quality/agent-gate.sh unit-full` |
| `gate:ci` | `node tools/quality/ci/run-quality-gate.mjs` |

### guard (99)

| Script | Command |
|--------|---------|
| `guard:any-baseline` | `node tools/quality/check-any-baseline.mjs` |
| `guard:any-resolved` | `node tools/quality/check-any-resolved.mjs` |
| `guard:any-resolved:report` | `node tools/quality/check-any-resolved.mjs --report` |
| `guard:any-resolved:write` | `node tools/quality/check-any-resolved.mjs --write` |
| `guard:architecture-locks` | `node tools/quality/check-architecture-locks.mjs` |
| `guard:backend-core-business-imports` | `node tools/quality/check-backend-core-business-imports.mjs` |
| `guard:backend-dependency-graph` | `node tools/quality/check-backend-dependency-graph-artifact.mjs` |
| `guard:backend-http-boundaries:strict` | `STRICT_BACKEND_HTTP_BOUNDARIES=1 node tools/quality/check-backend-http-boundaries.mjs` |
| `guard:backend-layer-allowlists-empty` | `node tools/quality/check-backend-layer-allowlists-empty.mjs` |
| `guard:backend-module-delegation` | `node tools/quality/check-backend-module-delegation.mjs` |
| `guard:claim-workspace-no-direct-neo4j` | `node tools/quality/check-claim-workspace-no-direct-neo4j.mjs --strict` |
| `guard:configuration-overlay-bounds` | `node tools/quality/check-configuration-overlay-bounds.mjs --strict` |
| `guard:contracts-product-consistency` | `node tools/quality/check-contracts-product-consistency.mjs` |
| `guard:contracts-product-consistency:test` | `node tools/quality/__tests__/check-contracts-product-consistency.test.mjs` |
| `guard:cypher-files-tenant-scoped` | `node tools/quality/check-cypher-files-tenant-scoped.mjs --strict` |
| `guard:dashboard-no-policy-jsonb-hydration` | `node tools/quality/check-dashboard-no-policy-jsonb-hydration.mjs` |
| `guard:dead-code-baseline` | `node tools/quality/check-dead-code-baseline.mjs` |
| `guard:depcheck-baseline` | `node tools/quality/check-depcheck-baseline.mjs` |
| `guard:dependency-duplication-drift` | `node tools/quality/check-dependency-duplication-drift.mjs` |
| `guard:dependency-missing` | `node tools/quality/check-missing-direct-dependencies.mjs` |
| `guard:dependency-outdated-policy` | `node tools/quality/check-outdated-package-policy.mjs` |
| `guard:docker-asset-parity` | `node tools/quality/check-docker-asset-parity.mjs` |
| `guard:docs-code-consistency` | `node tools/quality/check-docs-code-consistency.mjs` |
| `guard:docs-duplicate-filenames` | `node tools/quality/check-docs-duplicate-filenames.mjs` |
| `guard:docs-frontmatter` | `node tools/quality/check-docs-frontmatter.mjs` |
| `guard:docs-max-lines` | `node tools/quality/check-docs-max-lines.mjs` |
| `guard:docs-runbook-coverage` | `node tools/quality/check-docs-runbook-coverage.mjs` |
| `guard:docs-single-source` | `node tools/quality/check-docs-single-source.mjs` |
| `guard:docs-stale` | `node tools/quality/check-docs-stale.mjs` |
| `guard:domain-purity` | `node tools/quality/check-domain-purity.mjs` |
| `guard:domains-transitional-zone` | `node tools/quality/check-domains-transitional-zone.mjs` |
| `guard:e2e-journey-coverage` | `node tools/quality/check-e2e-journey-coverage.mjs` |
| `guard:email-template-intake-manifest` | `node tools/quality/check-email-template-intake-manifest.mjs` |
| `guard:event-routing-parity` | `node tools/quality/check-event-routing-parity.mjs` |
| `guard:exception-deletion-ledger` | `node tools/quality/check-exception-deletion-ledger.mjs` |
| `guard:express-request-augmentation` | `node tools/quality/check-express-request-augmentation-single-source.mjs` |
| `guard:frontend:base` | `npm run guard:legacy-api-imports && npm run guard:no-raw-html-controls && npm run guard:no-deep-shared-ui-imports && npm run guard:no-retired-pages-imports:strict && npm run guard:no-competing-domains && npm run guard:no-deep-product-imports && npm run lint:frontend-zones:strict && npm run guard:no-product-literals-in-shared-bo` |
| `guard:http-handler-typing` | `node tools/quality/check-http-handler-typing.mjs` |
| `guard:http-input-validation` | `node tools/quality/check-http-input-validation.mjs` |
| `guard:http-transport-burndown` | `node tools/quality/check-http-transport-burndown.mjs` |
| `guard:legacy-api-imports` | `STRICT_LIB_API_IMPORTS=1 node tools/quality/check-no-direct-lib-api-imports.mjs` |
| `guard:license-compliance` | `node tools/quality/check-license-compliance.mjs` |
| `guard:mcp-auth-single-funnel` | `node tools/quality/check-mcp-auth-single-funnel.mjs --strict` |
| `guard:neo4j-driver-only-in-platform-graph` | `node tools/quality/check-neo4j-driver-only-in-platform-graph.mjs --strict` |
| `guard:neo4j-no-app-pod-coupling` | `node tools/quality/check-neo4j-no-app-pod-coupling.mjs --strict` |
| `guard:neo4j-tenant-id-on-every-query` | `node tools/quality/check-neo4j-tenant-id-on-every-query.mjs --strict` |
| `guard:no-bare-prisma-on-tenant-scoped-models` | `node tools/quality/check-no-bare-prisma-on-tenant-scoped-models.mjs --strict` |
| `guard:no-competing-domains` | `node tools/quality/check-no-competing-domains.mjs` |
| `guard:no-cross-layer-shadow-files` | `node tools/quality/check-no-cross-layer-shadow-files.mjs` |
| `guard:no-deep-product-imports` | `node tools/quality/check-no-deep-product-imports.mjs` |
| `guard:no-deep-shared-ui-imports` | `node tools/quality/check-no-deep-shared-ui-imports.mjs` |
| `guard:no-default-tenant-fallbacks` | `node tools/quality/check-no-default-tenant-fallbacks.mjs` |
| `guard:no-deleted-identifiers` | `node tools/quality/check-no-deleted-identifiers.mjs` |
| `guard:no-direct-claim-mutability-writes` | `node tools/quality/check-no-direct-claim-mutability-writes.mjs` |
| `guard:no-direct-policy-status-writes` | `node tools/quality/check-no-direct-policy-status-writes.mjs` |
| `guard:no-inline-rate-tables` | `node tools/quality/check-no-inline-rate-tables.mjs` |
| `guard:no-new-retired-zones` | `node tools/quality/check-no-new-retired-zones.mjs` |
| `guard:no-new-services` | `node tools/quality/check-no-new-services.mjs` |
| `guard:no-product-literals-in-conformance` | `node tools/quality/check-no-product-literals-in-conformance.mjs` |
| `guard:no-product-literals-in-shared-bo` | `node tools/quality/check-no-product-literals-in-shared-bo.mjs` |
| `guard:no-raw-cypher-mcp-tool` | `node tools/quality/check-no-raw-cypher-mcp-tool.mjs --strict` |
| `guard:no-raw-html-controls` | `node tools/quality/check-no-raw-html-controls.mjs` |
| `guard:no-raw-tenant-env` | `node tools/quality/check-no-raw-tenant-env.mjs` |
| `guard:no-retired-pages-imports` | `node tools/quality/check-no-retired-pages-imports.mjs` |
| `guard:no-retired-pages-imports:strict` | `STRICT_NO_RETIRED_PAGES_IMPORTS=1 node tools/quality/check-no-retired-pages-imports.mjs` |
| `guard:no-shared-product-facades` | `node tools/quality/check-no-shared-product-facades.mjs` |
| `guard:no-xlsx-runtime-imports` | `node tools/quality/check-no-xlsx-runtime-imports.mjs` |
| `guard:no-zod-in-product-wizard-schemas` | `node tools/quality/check-no-zod-in-product-wizard-schemas.mjs` |
| `guard:oauth-consent-role-gate` | `node tools/quality/check-oauth-consent-role-gate.mjs --strict` |
| `guard:oauth-pkce-required` | `node tools/quality/check-oauth-pkce-required.mjs --strict` |
| `guard:oauth-resource-bound` | `node tools/quality/check-oauth-resource-bound.mjs --strict` |
| `guard:one-source-truth` | `node tools/quality/check-one-source-truth.mjs` |
| `guard:operator-mcp-no-direct-db-writes` | `node tools/quality/check-operator-mcp-no-direct-db-writes.mjs --strict` |
| `guard:operator-mutation-preview-required` | `node tools/quality/check-operator-mutation-preview-required.mjs --strict` |
| `guard:operator-validate-on-patch` | `node tools/quality/check-operator-validate-on-patch.mjs --strict` |
| `guard:outbound-http-boundary` | `node tools/quality/check-outbound-http-boundary.mjs` |
| `guard:policy-product-matches-binder-authority` | `node tools/quality/check-policy-product-matches-binder-authority.mjs` |
| `guard:prisma-schema-change-requires-migration` | `node tools/quality/check-prisma-schema-change-requires-migration.mjs` |
| `guard:product-engine-contract` | `node tools/quality/check-product-engine-contract.mjs` |
| `guard:product-golden-fixtures` | `node tools/quality/check-product-golden-fixtures.mjs` |
| `guard:product-launch-draft-isolation` | `node tools/quality/check-product-launch-draft-isolation.mjs --strict` |
| `guard:product-onboarding-canonical` | `node tools/quality/check-product-onboarding-canonical.mjs` |
| `guard:product-validation-authority` | `tsx tools/quality/check-product-validation-authority.ts` |
| `guard:products-single-source` | `node tools/quality/check-products-single-source.mjs` |
| `guard:public-build-no-bo-symbols` | `node tools/quality/check-public-build-no-bo-symbols.mjs` |
| `guard:questionnaire-freeze` | `node tools/quality/check-questionnaire-freeze.mjs` |
| `guard:remediation-freeze` | `node tools/quality/check-remediation-freeze.mjs` |
| `guard:retired-path-references` | `node tools/quality/check-retired-path-references.mjs` |
| `guard:root-hygiene` | `node tools/quality/check-root-hygiene.mjs` |
| `guard:sentry-wiring` | `node tools/quality/check-sentry-wiring.mjs` |
| `guard:shared-purity` | `node tools/quality/check-shared-purity.mjs` |
| `guard:test-import-zones` | `node tools/quality/check-test-import-zones.mjs` |
| `guard:tools-duplicate-ownership` | `node tools/quality/check-tools-duplicate-ownership.mjs` |
| `guard:typed-handler-schema-quality` | `node tools/quality/check-typed-handler-schema-quality.mjs` |
| `guard:validation-contract-parity` | `node tools/quality/check-validation-contract-parity.mjs` |
| `guard:validation-contract-parity:strict` | `STRICT_VALIDATION_CONTRACT=1 node tools/quality/check-validation-contract-parity.mjs` |
| `guard:validation-purity` | `node tools/quality/check-validation-purity.mjs` |
| `guard:validation-single-source` | `node tools/quality/check-validation-single-source.mjs` |
| `guard:workflow-quality-parity` | `node tools/quality/check-workflow-quality-parity.mjs` |

### lint (8)

| Script | Command |
|--------|---------|
| `lint` | `eslint --no-error-on-unmatched-pattern "backend/**/*.ts" "prisma/**/*.ts"` |
| `lint:all` | `npm run lint && npm run lint:frontend` |
| `lint:any` | `eslint --no-error-on-unmatched-pattern "backend/**/*.ts" "prisma/**/*.ts" "frontend/src/**/*.{ts,tsx}"` |
| `lint:core-guard` | `node tools/quality/check-no-core-domain-leaks.mjs` |
| `lint:frontend` | `eslint --no-error-on-unmatched-pattern "frontend/src/**/*.{ts,tsx}"` |
| `lint:frontend-zones` | `node tools/quality/check-frontend-import-zones.mjs` |
| `lint:frontend-zones:strict` | `STRICT_FEATURE_PUBLIC_APIS=1 node tools/quality/check-frontend-import-zones.mjs` |
| `lint:layers` | `node tools/quality/check-layer-boundaries.mjs && node tools/quality/check-backend-layer-imports.mjs` |

### perf (2)

| Script | Command |
|--------|---------|
| `perf:budgets` | `node tools/quality/perf/check-budgets.mjs` |
| `perf:budgets:build` | `npm run build:frontend && node tools/quality/perf/check-budgets.mjs` |

### policy (2)

| Script | Command |
|--------|---------|
| `policy:any` | `npm run ratchet:no-new-any && npm run policy:any-exceptions` |
| `policy:any-exceptions` | `node tools/quality/check-any-exceptions.mjs` |

### prepare (1)

| Script | Command |
|--------|---------|
| `prepare` | `husky \|\| true` |

### preview (1)

| Script | Command |
|--------|---------|
| `preview` | `vite preview --config frontend/vite.config.ts` |

### prisma (2)

| Script | Command |
|--------|---------|
| `prisma:generate` | `prisma generate` |
| `prisma:migrate:deploy` | `prisma migrate deploy` |

### proof (2)

| Script | Command |
|--------|---------|
| `proof:issuance-spine` | `tsx tools/quality/ops/prove-issued-docs-and-email.ts` |
| `proof:public-bundle-isolation` | `npm run build:frontend:public && npm run guard:public-build-no-bo-symbols` |

### ratchet (1)

| Script | Command |
|--------|---------|
| `ratchet:no-new-any` | `node tools/quality/check-no-new-any.mjs` |

### release (1)

| Script | Command |
|--------|---------|
| `release:go-no-go-packet` | `node tools/quality/aks/build-go-no-go-packet.mjs` |

### report (4)

| Script | Command |
|--------|---------|
| `report:backend-architecture-conformance` | `node tools/quality/generate-backend-architecture-conformance.mjs` |
| `report:champs-go-green-baseline` | `node tools/quality/report-champs-go-green-baseline.mjs` |
| `report:legacy-api-imports` | `node tools/quality/check-no-direct-lib-api-imports.mjs` |
| `report:otel-dependency-baseline` | `node tools/quality/generateOtelDependencyArtifacts.mjs` |

### reporting (2)

| Script | Command |
|--------|---------|
| `reporting:lineage:check` | `tsx tools/quality/generateLloydsV52LineageArtifacts.ts --check` |
| `reporting:lineage:generate` | `tsx tools/quality/generateLloydsV52LineageArtifacts.ts` |

### rollback (1)

| Script | Command |
|--------|---------|
| `rollback:drill` | `node tools/quality/aks/rollback-drill.mjs` |

### scan (1)

| Script | Command |
|--------|---------|
| `scan:secrets` | `node tools/quality/scan-secrets.mjs` |

### smoke (3)

| Script | Command |
|--------|---------|
| `smoke:postdeploy` | `SMOKE_MODE=postdeploy node tools/quality/aks/release-blocking-smoke.mjs` |
| `smoke:quote-bind-issue` | `SMOKE_ARTIFACT_PATH=/tmp/quote-bind-issue-smoke.json APP_BASE_URL=http://127.0.0.1 node tools/quality/aks/quote-bind-issue-smoke.mjs` |
| `smoke:release` | `node tools/quality/aks/release-blocking-smoke.mjs` |

### start (2)

| Script | Command |
|--------|---------|
| `start` | `node backend/dist/index.js` |
| `start:worker` | `node backend/dist/worker.js` |

### test (18)

| Script | Command |
|--------|---------|
| `test` | `vitest --config frontend/vitest.config.ts` |
| `test:adapters-medium` | `vitest --config frontend/vitest.config.ts run backend/modules/policy/infra/projections/__tests__/policyListIndex.test.ts backend/modules/documents/infra/motorDocs/__tests__/viewModel.premiumTotals.test.ts` |
| `test:auth-transport-policy` | `vitest --config frontend/vitest.config.ts run backend/http/middleware/__tests__/authTransportPolicy.test.ts` |
| `test:bdx-import` | `vitest --config frontend/vitest.config.ts run backend/modules/reporting/app/bdxImport/__tests__/bdxImport.service.test.ts` |
| `test:bdx-split` | `vitest --config frontend/vitest.config.ts run tools/migrations/__tests__/split_bdx_by_tenant.test.ts` |
| `test:browser:e2e` | `playwright test --config e2e/browser/playwright.config.ts` |
| `test:browser:e2e:install` | `playwright install --with-deps chromium` |
| `test:contracts-fast` | `INTEGRATION_TESTS=true vitest --config frontend/vitest.config.ts run backend/http/routes/__tests__/surfaceGate.integration.test.ts backend/modules/claims/domain/__tests__/worksheetCommands.binderGovernance.test.ts backend/http/routes/__tests__/policy_lifecycle.test.ts backend/http/routes/__tests__/genericPublicQuote.contract.test.ts backend/http/routes/__tests__/publicAutoQuoteHandlers.contract.test.ts backend/workers/handlers/__tests__/POLICY.INDEX_UPDATE.contract.test.ts backend/workers/handlers/__tests__/DOC.GENERATE_MOTOR_DOC_PACK.contract.test.ts backend/workers/handlers/__tests__/COMMUNICATION_OUTBOUND.contract.test.ts backend/modules/policy/infra/projections/__tests__/discoverabilityArchitecture.test.ts frontend/src/shared/lib/wizard/__tests__/buildPublicSessionUrl.test.ts frontend/src/shared/lib/wizard/__tests__/sessionAdapter.contract.test.ts frontend/src/products/motor/wizard/flows/__tests__/motor.flow.contracts.test.ts frontend/src/products/home/wizard/flows/__tests__/home.flow.contracts.test.ts` |
| `test:e2e:journeys` | `vitest --config frontend/vitest.config.ts run e2e/journeys/*.journey.test.ts` |
| `test:full` | `vitest --config frontend/vitest.config.ts run` |
| `test:integration` | `INTEGRATION_TESTS=true vitest --config frontend/vitest.config.ts run backend/http/routes/__tests__/binding_integrity.integration.test.ts backend/http/routes/__tests__/surfaceGate.integration.test.ts` |
| `test:integration:extended` | `INTEGRATION_TESTS=true vitest --config frontend/vitest.config.ts run backend/http/routes/__tests__/binding_integrity.integration.test.ts backend/platform/behavior/__tests__/schema.smoke.integration.test.ts backend/products/documents/__tests__/issuedDocPackGeneration.integration.test.ts` |
| `test:integration:surface-gates` | `INTEGRATION_TESTS=true vitest --config frontend/vitest.config.ts run backend/http/routes/__tests__/surfaceGate.integration.test.ts` |
| `test:journeys-deep` | `vitest --config frontend/vitest.config.ts run backend/http/routes/__tests__/binding_integrity.test.ts backend/http/routes/__tests__/endorsements.issue-doc-orchestration.test.ts backend/http/routes/__tests__/policies_bind.test.ts` |
| `test:staging-like` | `bash ./tools/quality/aks/run-staging-like-tests.sh` |
| `test:tenant-isolation` | `INTEGRATION_TESTS=true vitest --config frontend/vitest.config.ts run backend/platform/test/security/rls.test.ts` |
| `test:webhook-inbound-auth` | `vitest --config frontend/vitest.config.ts run backend/modules/communications/http/__tests__/webhooksRouter.auth.test.ts` |
| `test:xlsx-migration` | `vitest --config frontend/vitest.config.ts run backend/platform/events/__tests__/xlsx_migration.test.ts backend/platform/security/__tests__/xlsxSafety.test.ts` |

### testdata-reset (1)

| Script | Command |
|--------|---------|
| `testdata-reset:k8s` | `bash tools/migrations/run-testdata-reset-k8s.sh` |

### type-check (1)

| Script | Command |
|--------|---------|
| `type-check` | `tsc --noEmit` |

### validate (1)

| Script | Command |
|--------|---------|
| `validate:policy-registry` | `tsx tools/quality/validatePolicyListRegistry.ts` |

### verify (2)

| Script | Command |
|--------|---------|
| `verify:dashboard-premium-projection` | `tsx tools/migrations/check-dashboard-premium-projection.ts` |
| `verify:runtime-artifacts` | `node tools/quality/verify-runtime-artifacts.mjs` |
