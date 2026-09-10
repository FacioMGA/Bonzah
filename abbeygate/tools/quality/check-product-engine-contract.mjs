#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function assertIncludes(relPath, needle, message) {
  const text = read(relPath);
  if (!text.includes(needle)) failures.push(`${relPath}: ${message}`);
}

function assertNotIncludes(relPath, needles, message) {
  const text = read(relPath);
  for (const needle of needles) {
    if (text.includes(needle)) failures.push(`${relPath}: ${message} (${needle})`);
  }
}

assertIncludes(
  'backend/modules/policy/domain/productRuntimeDefinition.ts',
  'engines: ProductEngineProvider',
  'ProductRuntimeDefinition must expose ProductEngineProvider',
);

for (const relPath of [
  'backend/products/motor/runtime.ts',
  'backend/products/home/runtime.ts',
  'backend/products/travel/runtime.ts',
]) {
  assertIncludes(relPath, 'engines:', 'product runtime must declare engines');
}

assertNotIncludes(
  'backend/products/motor/MotorProductAdapter.ts',
  [
    'autoInsuranceCalculator',
    'motorUwAutomation',
    'executeMotorDocPackGeneration',
    'buildMotorDocViewModel',
  ],
  'Motor adapter must not bypass product engines',
);

const guardedImports = [
  'products/motor/pricing/autoInsuranceCalculator',
  '../pricing/autoInsuranceCalculator',
  './pricing/autoInsuranceCalculator',
  'products/motor/underwriting/motorUwAutomation',
  '../underwriting/motorUwAutomation',
  './underwriting/motorUwAutomation',
  'executeMotorDocPackGeneration',
  'buildMotorDocViewModel',
];

const allowedProductionFiles = new Set([
  'backend/products/motor/engines/MotorCompiledRatingEngine.ts',
  'backend/products/motor/engines/MotorCompiledUwEngine.ts',
  'backend/products/motor/engines/MotorCompiledWordingEngine.ts',
  'backend/products/motor/pricing/autoInsuranceCalculator.ts',
  'backend/products/motor/documents/generateMotorDocPack.ts',
  'backend/modules/documents/infra/motorDocsService.ts',
  'backend/workers/handlers/DOC.GENERATE_MOTOR_DOC_PACK.ts',
]);

const burnDownAllowedFiles = new Set([
  // Existing production callers to migrate behind engines in the authority/schema phases.
  'backend/modules/recommendations/domain/catalog/abbeygate/auto.ts',
  'backend/modules/reporting/app/bdxImport/validator.ts',
  'backend/modules/underwriting/domain/underwritingAnalysis.ts',
  'backend/products/motor/quotes/service.ts',
  'backend/seed.ts',
  // Seed entrypoint was split in PR 2.3b; the helper module is the
  // only seed file that touches the Motor internals directly.
  'backend/seed/helpers.ts',
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (full.includes(`${path.sep}backend${path.sep}dist${path.sep}`)) return [];
    if (entry.isDirectory()) return walk(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

for (const absPath of walk(path.join(root, 'backend'))) {
  const relPath = path.relative(root, absPath);
  if (relPath.includes('__tests__') || relPath.endsWith('.test.ts')) continue;
  if (allowedProductionFiles.has(relPath)) continue;
  const text = fs.readFileSync(absPath, 'utf8');
  const importText = text
    .split('\n')
    .filter((line) => /\bimport\b/.test(line) || /\bfrom\b/.test(line))
    .join('\n');
  for (const needle of guardedImports) {
    if (importText.includes(needle) && !burnDownAllowedFiles.has(relPath)) {
      failures.push(`${relPath}: production code must access Motor internals through product engines (${needle})`);
    }
  }
}

// ─── Issuance funnel — single-canonical-gate enforcement ─────────────
//
// `evaluateIssueReadiness` is the canonical issuance gate
// (docs/architecture/contracts/products.md §"Single canonical issuance
// gate"). Bind / issue / public-quote handlers MUST NOT call
// `validateDraftQuote` directly; they go through `evaluateIssueReadiness`
// (which dispatches to the registered product adapter). Adding a direct
// call from any of the bypass-prone files below regresses the funnel
// and reintroduces the side-door class Wave 1 of `spine/v2` closed.
// The denylist targets bind / issue handlers specifically. Stateless
// rating endpoints (`/calculate-premium`, `POST /v1/quotes`) and the
// adapter implementations (`MotorProductAdapter.validateForIssuance`)
// are NOT bypasses — they are part of the canonical funnel and may
// (and must) call `validateDraftQuote` directly.
const ISSUANCE_FUNNEL_BYPASS_FORBIDDEN = [
  'backend/modules/policy/app/BindPolicy.ts',
  'backend/modules/quotes/http/genericPublicQuoteRouter.ts',
];

// `v1PoliciesRouter.ts` has both a bind handler (POST /) and an
// endorsement-quote handler that legitimately uses validateDraftQuote.
// Enforce the bind handler does not regress by checking only the
// `parsed.success` block region of the file: if the file contains a
// `validateDraftQuote` call within the same statement-block as a `bind`
// or `BindPolicyRequestSchema` reference, it has regressed.
const ISSUANCE_FUNNEL_REGION_CHECKS = [
  {
    path: 'backend/modules/policy/http/v1PoliciesRouter.ts',
    forbiddenAfter: 'BindPolicyRequestSchema.safeParse',
    forbiddenBefore: 'EndorsementQuoteRequestSchema',
    pattern: /\bvalidateDraftQuote\b/,
    explanation: 'POST /v1/policies must call evaluateIssueReadiness, not validateDraftQuote',
  },
];

for (const relPath of ISSUANCE_FUNNEL_BYPASS_FORBIDDEN) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) continue;
  const text = fs.readFileSync(abs, 'utf8');
  if (/\bvalidateDraftQuote\b/.test(text)) {
    failures.push(
      `${relPath}: must call evaluateIssueReadiness, not validateDraftQuote (issuance-funnel bypass; see docs/architecture/contracts/products.md §"Single canonical issuance gate")`,
    );
  }
}

for (const check of ISSUANCE_FUNNEL_REGION_CHECKS) {
  const abs = path.join(root, check.path);
  if (!fs.existsSync(abs)) continue;
  const text = fs.readFileSync(abs, 'utf8');
  const startIdx = text.indexOf(check.forbiddenAfter);
  const endIdx = text.indexOf(check.forbiddenBefore);
  if (startIdx >= 0 && endIdx > startIdx) {
    const region = text.slice(startIdx, endIdx);
    if (check.pattern.test(region)) {
      failures.push(`${check.path}: ${check.explanation}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Product engine contract guard failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Product engine contract guard passed.');
