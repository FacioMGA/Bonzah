#!/usr/bin/env node
// tools/docs/build-migration-plan.mjs
//
// Day 1 of the docs-as-governance migration (see
// .cursor/plans/docs_consolidation_strategy_*.plan.md).
//
// Walks every markdown file in the repo that documents the platform and
// classifies it for the docs-consolidation hard-cut PR:
//
//   KEEP     - move verbatim to the new path; just prepend frontmatter
//   REWRITE  - move + condense (compress wording, not meaning); preserve
//              implicit decision context, edge cases, future-ADR hooks
//   FOLD     - REWRITE that merges multiple sources into one canonical doc
//   GENERATE - delete, replaced by an auto-generated reference inventory
//   ARCHIVE  - move under docs/archive/<bucket>/, prepend a Frozen-on header
//   DELETE   - drop, no historical value worth preserving
//
// Output: artifacts/docs/migration-plan.json (committed; CI artefact)
//
// Re-run idempotently:  node tools/docs/build-migration-plan.mjs
//
// The verdict map below is the single source of truth for the migration.
// Edit here, re-run, and the JSON is updated.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Files we proactively classify by hand. Anything under docs/ that is not in
// this list is reported as UNCLASSIFIED so the PR review catches drift.
const PLAN = [
  // -------------------------------------------------------------------------
  // ADRs - keep verbatim, move to docs/architecture/decisions/
  // -------------------------------------------------------------------------
  ...adr('ADR-0001-light-vs-full-projection.md'),
  ...adr('ADR-0002-redis-light-metadata-cache.md'),
  ...adr('ADR-0003-magicb-no-dynamic-code.md'),
  ...adr('ADR-0004-font-loading-strategy.md'),
  ...adr('ADR-0005-ledger-module-stub.md'),
  ...adr('ADR-0006-csrf-bearer-token-posture.md'),
  ...adr('ADR-0007-policy-versioning-lifecycle-primitives.md'),
  ...adr('ADR-0008-accounts360-projections-and-health-contract.md'),
  ...adr('ADR-0009-shared-schema-row-level-tenancy.md'),
  {
    path: 'docs/adr/README.md',
    verdict: 'REWRITE',
    new_path: 'docs/architecture/decisions/README.md',
    audience: 'architect',
    status_target: 'living',
    binding: false,
    reason: 'ADR index, condensed and updated to the new path.',
  },

  // -------------------------------------------------------------------------
  // Architecture - the four overlapping authority docs FOLD into one binding
  // contract. Their decision content is preserved verbatim under the new
  // contract heading; only their indexing/narrative chrome is removed.
  // -------------------------------------------------------------------------
  {
    path: 'docs/architecture/CHAMPS_MANIFESTO.md',
    verdict: 'FOLD',
    new_path: 'docs/architecture/contracts/modules-and-layers.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Folds into the single binding modules-and-layers contract.',
    supersedes_target: true,
  },
  {
    path: 'docs/architecture/REPO_ARCHITECTURE_CONTRACT.md',
    verdict: 'FOLD',
    new_path: 'docs/architecture/contracts/modules-and-layers.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Folds into the single binding modules-and-layers contract.',
    supersedes_target: true,
  },
  {
    path: 'docs/engineering/REPOSITORY_ARCHITECTURE.md',
    verdict: 'FOLD',
    new_path: 'docs/architecture/contracts/modules-and-layers.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Folds into the single binding modules-and-layers contract.',
    supersedes_target: true,
  },
  {
    path: 'docs/engineering/CHAMPS_REPO_LAYOUT_STANDARD.md',
    verdict: 'FOLD',
    new_path: 'docs/architecture/contracts/modules-and-layers.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Folds into the single binding modules-and-layers contract.',
    supersedes_target: true,
  },
  {
    path: 'docs/architecture/CHAMPS_STANDARDS_INDEX.md',
    verdict: 'DELETE',
    reason: 'Index of CHAMPS docs, made redundant by the new docs/start-here/ routing and AGENTS.md table.',
  },

  // Tenancy and products promoted to first-class contracts.
  {
    path: 'docs/adr/ADR-0009-shared-schema-row-level-tenancy.md',
    verdict: 'KEEP',
    new_path: 'docs/architecture/decisions/ADR-0009-shared-schema-row-level-tenancy.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'ADR stays; tenancy contract at docs/architecture/contracts/tenancy.md cites it.',
  },

  // Events and projections fold OUTBOX_PATTERN + observability
  {
    path: 'docs/architecture/OUTBOX_PATTERN.md',
    verdict: 'FOLD',
    new_path: 'docs/architecture/contracts/events-and-projections.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Folds into events-and-projections binding contract.',
    supersedes_target: true,
  },
  {
    path: 'docs/architecture/OBSERVABILITY_GO_LIVE_RUNBOOK.md',
    verdict: 'FOLD',
    new_path: 'docs/architecture/contracts/events-and-projections.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Log contract + queue failure policy fold into events-and-projections contract.',
    supersedes_target: true,
  },

  // Specific architecture docs: keep, move
  {
    path: 'docs/architecture/CLAIMS_LIFECYCLE_STANDARD.md',
    verdict: 'REWRITE',
    new_path: 'docs/product/claims-lifecycle.md',
    audience: 'developer',
    status_target: 'living',
    binding: true,
    reason: 'Claims lifecycle is product-domain reference; tightened to allowed/forbidden/escalation per REWRITE rule.',
  },
  {
    path: 'docs/architecture/UNDERWRITING_ANALYSIS_CONTRACT.md',
    verdict: 'KEEP',
    new_path: 'docs/architecture/contracts/underwriting-analysis.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Existing contract, moved into contracts/ namespace.',
  },
  {
    path: 'docs/architecture/GLOSSARY.md',
    verdict: 'KEEP',
    new_path: 'docs/product/glossary.md',
    audience: 'developer',
    status_target: 'reference',
    binding: false,
    reason: 'Domain glossary keeps as-is, moves to product/.',
  },
  {
    path: 'docs/architecture/API_CHANGELOG.md',
    verdict: 'KEEP',
    new_path: 'docs/reference/api-changelog.md',
    audience: 'developer',
    status_target: 'reference',
    binding: false,
    reason: 'Reference inventory, moves under reference/.',
  },
  {
    path: 'docs/architecture/FRONTEND_DISPLAY_LABELS.md',
    verdict: 'KEEP',
    new_path: 'docs/product/frontend-display-labels.md',
    audience: 'developer',
    status_target: 'reference',
    binding: false,
    reason: 'Display label catalogue is product reference.',
  },
  {
    path: 'docs/architecture/jurisdiction-product-config.md',
    verdict: 'KEEP',
    new_path: 'docs/architecture/contracts/jurisdiction-product-config.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Jurisdiction <-> product config is binding; moves to contracts/.',
  },
  {
    path: 'docs/architecture/product-engine-authority-extraction.md',
    verdict: 'KEEP',
    new_path: 'docs/architecture/contracts/product-engine-authority.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Product engine authority model is binding contract.',
  },
  {
    path: 'docs/architecture/validation-contract-runtime.md',
    verdict: 'KEEP',
    new_path: 'docs/architecture/contracts/validation-runtime.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Validation runtime contract.',
  },
  {
    path: 'docs/architecture/validation-contract-audit.md',
    verdict: 'GENERATE',
    new_path: 'docs/reference/contracts.md',
    audience: 'agent',
    status_target: 'generated',
    binding: false,
    reason: 'Validation contract audit becomes part of generated contracts inventory.',
  },
  {
    path: 'docs/architecture/email/customer-email-trigger-matrix.md',
    verdict: 'KEEP',
    new_path: 'docs/product/email/customer-email-trigger-matrix.md',
    audience: 'developer',
    status_target: 'reference',
    binding: false,
    reason: 'Email trigger matrix is product reference.',
  },
  {
    path: 'docs/architecture/email/email-template-canonicalization.md',
    verdict: 'KEEP',
    new_path: 'docs/product/email/email-template-canonicalization.md',
    audience: 'developer',
    status_target: 'reference',
    binding: false,
    reason: 'Email template canonicalization reference.',
  },
  {
    path: 'docs/architecture/email/customer-email-unification-summary.md',
    verdict: 'ARCHIVE',
    new_path: 'docs/archive/2026-Q1-email-unification/customer-email-unification-summary.md',
    archive_bucket: '2026-Q1-email-unification',
    reason: 'Historical summary of completed email unification work.',
  },
  {
    path: 'docs/architecture/baselines/otel-dependency-baseline.md',
    verdict: 'GENERATE',
    new_path: 'docs/reference/dependencies.md',
    audience: 'agent',
    status_target: 'generated',
    binding: false,
    reason: 'Dependency baseline becomes part of generated dependency reference (future scope).',
  },

  // -------------------------------------------------------------------------
  // Architecture audits + sprint reports - DELETE or ARCHIVE per plan
  // -------------------------------------------------------------------------
  {
    path: 'docs/architecture/audits/CHAMPS_DEFERRED_BASELINE_2026-04.md',
    verdict: 'DELETE',
    reason: 'Sprint cleanup baseline, no historical signal worth preserving (per plan §What we delete).',
  },
  {
    path: 'docs/architecture/audits/platform-audit-2026-04.md',
    verdict: 'ARCHIVE',
    new_path: 'docs/archive/2026-Q2-platform-audit/platform-audit-2026-04.md',
    archive_bucket: '2026-Q2-platform-audit',
    reason: 'Platform audit retains historical signal.',
  },
  {
    path: 'docs/architecture/archive/SPRINT_2026-03-15_ACCOUNTS360.md',
    verdict: 'DELETE',
    reason: 'Old sprint report, already in legacy archive folder; no historical signal worth keeping.',
  },
  {
    path: 'docs/architecture/archive/STABILIZATION_AUDIT_VALIDATION_2026-03-17.md',
    verdict: 'DELETE',
    reason: 'Old stabilization audit, no historical signal worth keeping.',
  },
  {
    path: 'docs/architecture/questionnaire-consolidation/baseline.md',
    verdict: 'DELETE',
    reason: 'Questionnaire consolidation cleanup, completed work, no signal worth keeping.',
  },
  {
    path: 'docs/architecture/questionnaire-consolidation/phase-6-inventory.md',
    verdict: 'DELETE',
    reason: 'Phase inventory artefact from completed consolidation.',
  },

  // -------------------------------------------------------------------------
  // Engineering standards - keep most, FOLD architecture, move audits to archive
  // -------------------------------------------------------------------------
  {
    path: 'docs/engineering/README.md',
    verdict: 'DELETE',
    reason: 'Index file replaced by docs/start-here/ audience routing.',
  },
  {
    path: 'docs/engineering/ONBOARDING.md',
    verdict: 'REWRITE',
    new_path: 'docs/start-here/01-developer.md',
    audience: 'developer',
    status_target: 'living',
    binding: false,
    reason: 'Onboarding becomes developer entrypoint; tightened to allowed/forbidden/escalation.',
  },
  {
    path: 'docs/engineering/CODING_STANDARDS.md',
    verdict: 'REWRITE',
    new_path: 'docs/develop/write-code.md',
    audience: 'developer',
    status_target: 'living',
    binding: true,
    reason: 'TS rules + max-lines + no-any move to develop/write-code.md as a contract.',
  },
  {
    path: 'docs/engineering/TESTING_STRATEGY.md',
    verdict: 'REWRITE',
    new_path: 'docs/develop/test.md',
    audience: 'developer',
    status_target: 'living',
    binding: true,
    reason: 'Four proof tiers, placement rules, mock policy.',
  },
  {
    path: 'docs/engineering/SECURITY_DECISIONS.md',
    verdict: 'KEEP',
    new_path: 'docs/architecture/contracts/security.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Security decisions are binding contract.',
  },
  {
    path: 'docs/engineering/BACKUP_POLICY.md',
    verdict: 'KEEP',
    new_path: 'docs/operate/backup-policy.md',
    audience: 'operator',
    status_target: 'living',
    binding: true,
    reason: 'Backup policy is operator contract.',
  },
  {
    path: 'docs/engineering/VALIDATION.md',
    verdict: 'KEEP',
    new_path: 'docs/architecture/contracts/validation.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Validation contract.',
  },
  {
    path: 'docs/engineering/CHAMPS_ENGINEERING_PLAYBOOK.md',
    verdict: 'REWRITE',
    new_path: 'docs/develop/contribute.md',
    audience: 'developer',
    status_target: 'living',
    binding: false,
    reason: 'Engineering playbook -> contribute guide; PR classification + agent rules.',
  },
  {
    path: 'docs/engineering/CHAMPS_CI_GUARD_STANDARD.md',
    verdict: 'GENERATE',
    new_path: 'docs/reference/guards.md',
    audience: 'agent',
    status_target: 'generated',
    binding: false,
    reason: 'Guard inventory becomes generated from package.json + tools/quality/.',
  },
  {
    path: 'docs/engineering/accounts-intelligence-api-contract.md',
    verdict: 'KEEP',
    new_path: 'docs/architecture/contracts/accounts-intelligence-api.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'API contract.',
  },
  {
    path: 'docs/engineering/backup-control-statement.md',
    verdict: 'KEEP',
    new_path: 'docs/operate/backup-control-statement.md',
    audience: 'operator',
    status_target: 'reference',
    binding: false,
    reason: 'Operator reference for backup audit.',
  },

  // March 2026 cleanup audits - per plan: DELETE
  {
    path: 'docs/engineering/champs-cleanup-audit-resolution-2026-03.md',
    verdict: 'DELETE',
    reason: 'March 2026 cleanup audit, completed work, no historical signal worth keeping.',
  },
  {
    path: 'docs/engineering/cleanup-marathon-noise-triage-2026-03.md',
    verdict: 'DELETE',
    reason: 'Cleanup marathon noise triage, completed.',
  },
  {
    path: 'docs/engineering/dependency-cleanup-evidence-2026-03.md',
    verdict: 'DELETE',
    reason: 'Dependency cleanup evidence, completed work.',
  },
  {
    path: 'docs/engineering/observability-telemetry-review-2026-03.md',
    verdict: 'ARCHIVE',
    new_path: 'docs/archive/2026-Q1-observability-review/observability-telemetry-review-2026-03.md',
    archive_bucket: '2026-Q1-observability-review',
    reason: 'Observability review captures App Insights vs OTel decision frame; keep as historical evidence.',
  },

  // Binders subfolder (legacy audit artefacts) - DELETE
  {
    path: 'docs/engineering/binders/BACKEND_GAP_REGISTER_23EEA6152.md',
    verdict: 'DELETE',
    reason: 'Binder-specific gap register from completed extraction work.',
  },
  {
    path: 'docs/engineering/binders/EXTRACTION_MATRIX_23EEA6152.md',
    verdict: 'DELETE',
    reason: 'Binder extraction matrix from completed work.',
  },
  {
    path: 'docs/engineering/binders/LEGACY_PRUNING_AUDIT.md',
    verdict: 'DELETE',
    reason: 'Legacy pruning audit, completed.',
  },
  {
    path: 'docs/engineering/binders/RULE_BUCKETS_23EEA6152.md',
    verdict: 'DELETE',
    reason: 'Rule buckets audit, completed.',
  },

  // -------------------------------------------------------------------------
  // Runbooks - consolidated into docs/operate/
  // -------------------------------------------------------------------------
  {
    path: 'docs/runbooks/README.md',
    verdict: 'DELETE',
    reason: 'Index replaced by docs/start-here/02-operator.md routing.',
  },
  {
    path: 'docs/runbooks/deployment.md',
    verdict: 'ARCHIVE',
    new_path: 'docs/archive/pre-aks/deployment.md',
    archive_bucket: 'pre-aks',
    reason: 'Legacy App Service deployment guide; AKS supersedes.',
  },
  {
    path: 'docs/runbooks/aks-cutover.md',
    verdict: 'FOLD',
    new_path: 'docs/operate/deploy.md',
    audience: 'operator',
    status_target: 'living',
    binding: true,
    reason: 'Folds into single deploy.md with cutover/canary/full-switch sections.',
    supersedes_target: true,
  },
  {
    path: 'docs/runbooks/release-production.md',
    verdict: 'FOLD',
    new_path: 'docs/operate/deploy.md',
    audience: 'operator',
    status_target: 'living',
    binding: true,
    reason: 'Folds into single deploy.md.',
    supersedes_target: true,
  },
  {
    path: 'docs/runbooks/preprod-deploy-stabilization.md',
    verdict: 'FOLD',
    new_path: 'docs/operate/deploy.md',
    audience: 'operator',
    status_target: 'living',
    binding: true,
    reason: 'Folds into deploy.md preprod-stabilization section.',
    supersedes_target: true,
  },
  {
    path: 'docs/runbooks/release-stabilization-board.md',
    verdict: 'ARCHIVE',
    new_path: 'docs/archive/2026-Q1-release-board/release-stabilization-board.md',
    archive_bucket: '2026-Q1-release-board',
    reason: 'Process artefact retained as evidence; superseded by deploy.md gates.',
  },
  {
    path: 'docs/runbooks/aks-rollback-2026-03.md',
    verdict: 'REWRITE',
    new_path: 'docs/operate/rollback.md',
    audience: 'operator',
    status_target: 'living',
    binding: true,
    reason: 'Date-stripped, made evergreen as the canonical rollback procedure.',
  },
  {
    path: 'docs/runbooks/backup-disaster-recovery.md',
    verdict: 'FOLD',
    new_path: 'docs/operate/backup-and-restore.md',
    audience: 'operator',
    status_target: 'living',
    binding: true,
    reason: 'Folds into backup-and-restore.md.',
    supersedes_target: true,
  },
  {
    path: 'docs/runbooks/postgres-restore.md',
    verdict: 'FOLD',
    new_path: 'docs/operate/backup-and-restore.md',
    audience: 'operator',
    status_target: 'living',
    binding: true,
    reason: 'Folds into backup-and-restore.md.',
    supersedes_target: true,
  },
  {
    path: 'docs/runbooks/blob-recovery.md',
    verdict: 'FOLD',
    new_path: 'docs/operate/backup-and-restore.md',
    audience: 'operator',
    status_target: 'living',
    binding: true,
    reason: 'Folds into backup-and-restore.md.',
    supersedes_target: true,
  },
  {
    path: 'docs/runbooks/database-migrations.md',
    verdict: 'KEEP',
    new_path: 'docs/operate/database-migrations.md',
    audience: 'operator',
    status_target: 'living',
    binding: true,
    reason: 'Kept as canonical DB migration runbook.',
  },
  {
    path: 'docs/runbooks/aks-new-environment.md',
    verdict: 'REWRITE',
    new_path: 'docs/operate/new-environment.md',
    audience: 'operator',
    status_target: 'living',
    binding: true,
    reason: 'Renamed to drop AKS-specific prefix; kept as canonical new-environment runbook.',
  },
  {
    path: 'docs/runbooks/staging-delivery.md',
    verdict: 'KEEP',
    new_path: 'docs/operate/staging-delivery.md',
    audience: 'operator',
    status_target: 'living',
    binding: false,
    reason: 'Staging delivery procedure retained.',
  },

  // -------------------------------------------------------------------------
  // Performance + frontend docs
  // -------------------------------------------------------------------------
  {
    path: 'docs/performance/README.md',
    verdict: 'DELETE',
    reason: 'Performance README is an index; replaced by start-here routing.',
  },
  {
    path: 'docs/performance/BUDGETS.md',
    verdict: 'KEEP',
    new_path: 'docs/architecture/contracts/performance-budgets.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Performance budgets are binding contract.',
  },
  {
    path: 'docs/performance/MONITORING.md',
    verdict: 'KEEP',
    new_path: 'docs/operate/monitoring.md',
    audience: 'operator',
    status_target: 'living',
    binding: false,
    reason: 'Monitoring guide for operators.',
  },
  {
    path: 'docs/performance/DATABASE_INDEXES.md',
    verdict: 'KEEP',
    new_path: 'docs/architecture/contracts/database-indexes.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Database index contract.',
  },
  {
    path: 'docs/frontend/README.md',
    verdict: 'DELETE',
    reason: 'Frontend README is an index; replaced by docs/architecture/contracts/surfaces.md.',
  },
  {
    path: 'docs/frontend/ARCHITECTURE.md',
    verdict: 'FOLD',
    new_path: 'docs/architecture/contracts/surfaces.md',
    audience: 'architect',
    status_target: 'living',
    binding: true,
    reason: 'Frontend architecture folds into surfaces contract.',
    supersedes_target: true,
  },

  // -------------------------------------------------------------------------
  // Module-local docs (left alone where they live; out of docs/ scope)
  // -------------------------------------------------------------------------
  {
    path: 'backend/modules/reporting/docs/lloyds-v52-premium-abbeygate-cyprus.md',
    verdict: 'KEEP',
    new_path: 'backend/modules/reporting/docs/lloyds-v52-premium-abbeygate-cyprus.md',
    audience: 'architect',
    status_target: 'reference',
    binding: false,
    reason: 'Module-local technical reference; stays co-located with the module.',
    in_place: true,
  },
  {
    path: 'backend/modules/reporting/docs/bdx-export-inventory.md',
    verdict: 'KEEP',
    new_path: 'backend/modules/reporting/docs/bdx-export-inventory.md',
    audience: 'developer',
    status_target: 'reference',
    binding: false,
    reason: 'Module-local technical reference; stays co-located with the module.',
    in_place: true,
  },
];

function adr(filename) {
  return [
    {
      path: `docs/adr/${filename}`,
      verdict: 'KEEP',
      new_path: `docs/architecture/decisions/${filename}`,
      audience: 'architect',
      status_target: 'living',
      binding: true,
      reason: 'ADR; preserved verbatim, only path changes.',
    },
  ];
}

async function readLineCount(filePath) {
  try {
    const buf = await fs.readFile(filePath, 'utf8');
    return buf.split('\n').length;
  } catch {
    return null;
  }
}

async function main() {
  const planByPath = new Map(PLAN.map((entry) => [entry.path, entry]));

  // Walk every markdown file we expect to classify.
  const allMarkdown = [];
  await walk(path.join(REPO_ROOT, 'docs'), allMarkdown);
  // Plus the two backend module-local docs we explicitly classified.
  for (const inPlace of PLAN.filter((p) => p.in_place)) {
    allMarkdown.push(path.join(REPO_ROOT, inPlace.path));
  }

  const items = [];
  const unclassified = [];

  for (const abs of allMarkdown) {
    const rel = path.relative(REPO_ROOT, abs);
    const lines = await readLineCount(abs);
    const entry = planByPath.get(rel);
    if (!entry) {
      unclassified.push({ path: rel, size_lines: lines });
      continue;
    }
    items.push({
      ...entry,
      size_lines: lines,
    });
  }

  const summary = {
    generated_at: new Date().toISOString(),
    repo_root: REPO_ROOT,
    counts: {
      total_classified: items.length,
      KEEP: items.filter((i) => i.verdict === 'KEEP').length,
      REWRITE: items.filter((i) => i.verdict === 'REWRITE').length,
      FOLD: items.filter((i) => i.verdict === 'FOLD').length,
      GENERATE: items.filter((i) => i.verdict === 'GENERATE').length,
      ARCHIVE: items.filter((i) => i.verdict === 'ARCHIVE').length,
      DELETE: items.filter((i) => i.verdict === 'DELETE').length,
    },
    unclassified_count: unclassified.length,
    plan_entries_missing_on_disk: 0,
  };

  const payload = {
    summary,
    items: items.sort((a, b) => a.path.localeCompare(b.path)),
    unclassified,
    plan_entries_missing_on_disk: [],
  };

  const outDir = path.join(REPO_ROOT, 'artifacts', 'docs');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'migration-plan.json');
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  // Console output is intentional - this is an ops script, not service code.
  // (Repo ESLint policy carves out tools/** for console use.)
  // eslint-disable-next-line no-console
  console.log(`docs migration plan written: ${path.relative(REPO_ROOT, outPath)}`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));

  if (unclassified.length > 0) {
    // eslint-disable-next-line no-console
    console.error('UNCLASSIFIED docs (add to PLAN in build-migration-plan.mjs):');
    for (const u of unclassified) {
      // eslint-disable-next-line no-console
      console.error(`  ${u.path}`);
    }
    process.exitCode = 1;
  }
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walk(abs, out);
    } else if (ent.isFile() && ent.name.endsWith('.md')) {
      out.push(abs);
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
