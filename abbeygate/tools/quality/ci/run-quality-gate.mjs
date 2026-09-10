#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

const timingsDir = process.env.CI_TIMINGS_DIR || '.metrics/ci-timings';
const timings = [];

function boolEnv(name) {
  return ['1', 'true', 'yes'].includes(String(process.env[name] || '').toLowerCase());
}

function shouldRunRemediationFreeze() {
  return (
    boolEnv('RELEASE_FREEZE_ACTIVE') &&
    process.env.GITHUB_EVENT_NAME === 'pull_request' &&
    process.env.GITHUB_BASE_REF === 'main' &&
    String(process.env.GITHUB_HEAD_REF || '').startsWith('release/')
  );
}

function waitForPort(host, port, timeoutMs = 90_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(1_000);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('timeout', () => {
        socket.destroy();
        retry();
      });
      socket.once('error', () => {
        socket.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`${host}:${port} did not become reachable in ${timeoutMs}ms`));
        return;
      }
      setTimeout(tryConnect, 1_000);
    };

    tryConnect();
  });
}

function run(name, command, options = {}) {
  if (options.when === false) {
    console.log(`\n[quality-gate] skip: ${name}`);
    timings.push({ stage: name, duration_seconds: 0, status: 'skipped' });
    return;
  }

  console.log(`\n[quality-gate] ${name}`);
  console.log(`[quality-gate] $ ${command}`);
  const started = Date.now();
  const result = spawnSync(command, {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env || {}) },
  });
  const duration = Math.round((Date.now() - started) / 1000);
  const status = result.status === 0 ? 'success' : 'failure';
  timings.push({ stage: name, duration_seconds: duration, status });
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error(`${name} failed with exit code ${result.status}`);
  }
}

function ensureEvidencePlaceholders() {
  const placeholders = [
    ['/tmp/quote-bind-issue-smoke.json', '{"status":"not-generated","reason":"smoke:quote-bind-issue did not produce artifact"}\n'],
    ['/tmp/release-blocking-smoke.json', '{"status":"not-generated","reason":"smoke:release was skipped/failed or did not emit artifact"}\n'],
    ['/tmp/backup-restore-validation.json', '{"status":"not-generated","reason":"backup restore validation was skipped/failed or did not emit artifact"}\n'],
    ['/tmp/prelaunch-backup.dump', 'not-generated\n'],
  ];
  for (const [file, content] of placeholders) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, content, 'utf8');
  }
}

function writeTimings() {
  fs.mkdirSync(timingsDir, { recursive: true });
  fs.writeFileSync(`${timingsDir}/quality-gate.json`, `${JSON.stringify(timings, null, 2)}\n`, 'utf8');
}

async function main() {
  const started = Date.now();
  try {
    console.log('[quality-gate] waiting for Postgres and Redis services...');
    await Promise.all([waitForPort('127.0.0.1', 5432), waitForPort('127.0.0.1', 6379)]);
    timings.push({ stage: 'wait_services', duration_seconds: Math.round((Date.now() - started) / 1000), status: 'success' });

    run('build_validation', 'npm run build:validation');
    run('build_products', 'npm run build:products');
    run('ci_database', 'npm run prisma:generate && npm run db:push:ci && npm run db:seed', { env: { LOG_LEVEL: 'error' } });
    run('remediation_freeze', 'npm run guard:remediation-freeze', { when: shouldRunRemediationFreeze() });
    run('audit_high_approved', 'npm run audit:high:approved');
    run('audit_prod_critical', 'npm run audit:prod:critical');
    run('dependency_missing', 'npm run guard:dependency-missing');
    run('prisma_schema_migration_guard', 'npm run guard:prisma-schema-change-requires-migration');
    run('dependency_duplication_drift', 'npm run guard:dependency-duplication-drift');
    run('dependency_outdated_policy', 'npm run guard:dependency-outdated-policy');
    run('license_compliance', 'npm run guard:license-compliance');
    run('secret_scan', 'npm run scan:secrets');
    run('runtime_artifacts', 'node tools/quality/verify-runtime-artifacts.mjs');
    run('docker_asset_parity', 'npm run guard:docker-asset-parity');
    run('sentry_wiring', 'npm run guard:sentry-wiring');
    run('event_routing_parity', 'npm run guard:event-routing-parity');
    run('deleted_identifier_ratchet', 'npm run guard:no-deleted-identifiers');
    run('exception_deletion_ledger', 'npm run guard:exception-deletion-ledger');
    run('xlsx_runtime_import_retirement', 'npm run guard:no-xlsx-runtime-imports');
    run('no_new_any', 'node tools/quality/check-no-new-any.mjs');
    run('any_exception_policy', 'node tools/quality/check-any-exceptions.mjs');
    run('any_baseline', 'npm run guard:any-baseline');
    run('any_resolved_baseline', 'npm run guard:any-resolved');
    run('express_request_augmentation', 'npm run guard:express-request-augmentation');
    run('http_handler_typing', 'npm run guard:http-handler-typing');
    run('typed_handler_schema_quality', 'npm run guard:typed-handler-schema-quality');
    run('dead_code_baseline', 'npm run guard:dead-code-baseline');
    run('depcheck_baseline', 'npm run guard:depcheck-baseline');
    run('backend_lint', `npm run lint -- --max-warnings=${process.env.ESLINT_BACKEND_WARNING_BUDGET || '0'}`);
    run('frontend_lint', `npm run lint:frontend -- --max-warnings=${process.env.ESLINT_FRONTEND_WARNING_BUDGET || '0'}`);
    run('backend_layers', 'npm run lint:layers');
    run('backend_layer_allowlists', 'npm run guard:backend-layer-allowlists-empty');
    run('frontend_zones', 'npm run lint:frontend-zones:strict');
    run('retired_pages', 'npm run guard:no-retired-pages-imports:strict');
    run('legacy_api_imports', 'npm run guard:legacy-api-imports');
    run('domains_transitional_zone', 'npm run guard:domains-transitional-zone');
    run('core_guard', 'npm run lint:core-guard');
    run('root_hygiene', 'npm run guard:root-hygiene');
    run('inline_rate_tables', 'npm run guard:no-inline-rate-tables');
    run('retired_path_references', 'npm run guard:retired-path-references');
    run('docs_duplicate_filenames', 'npm run guard:docs-duplicate-filenames');
    run('docs_generate_check', 'npm run docs:generate:check');
    run('docs_frontmatter', 'npm run guard:docs-frontmatter');
    run('docs_single_source', 'npm run guard:docs-single-source');
    run('docs_stale', 'npm run guard:docs-stale');
    run('docs_runbook_coverage', 'npm run guard:docs-runbook-coverage');
    run('docs_code_consistency', 'npm run guard:docs-code-consistency');
    run('docs_max_lines', 'npm run guard:docs-max-lines');
    run('contracts_product_consistency', 'npm run guard:contracts-product-consistency');
    run('tools_duplicate_ownership', 'npm run guard:tools-duplicate-ownership');
    run('no_new_retired_zones', 'npm run guard:no-new-retired-zones');
    run('no_new_services', 'npm run guard:no-new-services');
    run('workflow_quality_parity', 'npm run guard:workflow-quality-parity');
    run('test_import_zones', 'npm run guard:test-import-zones');
    run('http_input_validation', 'npm run guard:http-input-validation');
    run('domain_purity', 'npm run guard:domain-purity');
    run('shared_purity', 'npm run guard:shared-purity');
    run('outbound_http_boundary', 'npm run guard:outbound-http-boundary');
    run('e2e_journey_coverage', 'npm run guard:e2e-journey-coverage');
    run('backend_dependency_graph', 'npm run docs:backend-dependency-graph');
    run('backend_dependency_graph_guard', 'npm run guard:backend-dependency-graph');
    run('backend_module_delegation', 'npm run guard:backend-module-delegation');
    run('http_transport_burndown', 'npm run guard:http-transport-burndown');
    run('backend_http_boundaries', 'npm run guard:backend-http-boundaries:strict');
    run('backend_core_business_imports', 'npm run guard:backend-core-business-imports');
    run('one_source_truth', 'STRICT_ONE_SOURCE_TRUTH=1 npm run guard:one-source-truth');
    run('validation_contract_parity', 'npm run guard:validation-contract-parity:strict');
    run('questionnaire_freeze', 'npm run guard:questionnaire-freeze');
    // ADR-0041 — Claim Memory + Neo4j enrichment guards.
    run('neo4j_driver_only_in_platform_graph', 'npm run guard:neo4j-driver-only-in-platform-graph');
    run('claim_workspace_no_direct_neo4j', 'npm run guard:claim-workspace-no-direct-neo4j');
    run('no_raw_cypher_mcp_tool', 'npm run guard:no-raw-cypher-mcp-tool');
    run('cypher_files_tenant_scoped', 'npm run guard:cypher-files-tenant-scoped');
    run('neo4j_tenant_id_on_every_query', 'npm run guard:neo4j-tenant-id-on-every-query');
    run('neo4j_no_app_pod_coupling', 'npm run guard:neo4j-no-app-pod-coupling');
    run('backend_architecture_report', 'npm run report:backend-architecture-conformance');
    run('build_api', 'npm run build:api');
    run('type_check', 'npm run type-check');
    // Tier 5 browser E2E (ADR-0030) — opt-in until UAT closes. CI sets
    // RUN_BROWSER_E2E=1 once the post-UAT rollout window opens.
    run('browser_e2e', 'npm run test:browser:e2e', { when: boolEnv('RUN_BROWSER_E2E') });
    run('contracts_fast', 'npm run test:contracts-fast');
    run('webhook_inbound_auth', 'npm run test:webhook-inbound-auth', { env: { LOG_LEVEL: 'error' } });
    run('bdx_import_tests', 'npm run test:bdx-import');
    run('xlsx_migration_tests', 'npm run test:xlsx-migration');
    run('auth_transport_policy_tests', 'npm run test:auth-transport-policy', { env: { LOG_LEVEL: 'error' } });
    run('tenant_isolation_tests', 'npm run test:tenant-isolation');
    run('adapters_medium_tests', 'npm run test:adapters-medium');
    run('journeys_deep_tests', 'npm run test:journeys-deep');
    run('integration_extended', 'npm run test:integration:extended', { env: { LOG_LEVEL: 'error' } });
    run('e2e_journeys_tests', 'npm run test:e2e:journeys');
    run('public_bundle_isolation', 'npm run proof:public-bundle-isolation');
    run('quote_bind_issue_smoke', 'npm run smoke:quote-bind-issue');
    run('release_blocking_smoke', 'npm run smoke:release', { when: boolEnv('RUN_RELEASE_BLOCKING_SMOKE') });
    run('backup_restore_validate', 'BACKUP_VALIDATE_DRY_RUN=0 npm run backup:restore:validate', { when: boolEnv('RUN_BACKUP_RESTORE_VALIDATE') });
    ensureEvidencePlaceholders();
    run('release_go_no_go_packet', 'npm run release:go-no-go-packet');
  } finally {
    ensureEvidencePlaceholders();
    writeTimings();
  }
}

main().catch((error) => {
  console.error(`[quality-gate] ${error.message}`);
  process.exit(process.exitCode || 1);
});
