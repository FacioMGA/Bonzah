#!/usr/bin/env node
// E2E journey coverage guard.
//
// File existence alone is insufficient — the historical 13-file set
// was tautological (asserted inline object literals against their own
// keys). This guard now requires every required journey file to:
//
//   1. Exist on disk.
//   2. Import at least one symbol from production code paths.
//   3. Reference at least one of those imported bindings outside the
//      import statement itself (so re-exports do not count as use).
//
// See docs/develop/journey-registry.md for the canonical-owner index.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REQUIRED = [
  'e2e/journeys/quote-bind-issue.journey.test.ts',
  'e2e/journeys/bo-policy-detail.journey.test.ts',
  'e2e/journeys/public-login-dashboard.journey.test.ts',
  'e2e/journeys/public-quote-questionnaire.journey.test.ts',
  'e2e/journeys/bo-endorsement-draft-bind.journey.test.ts',
  'e2e/journeys/bo-cancellation-request.journey.test.ts',
  'e2e/journeys/bo-underwriting-followups.journey.test.ts',
  'e2e/journeys/bo-generate-doc-packs.journey.test.ts',
  'e2e/journeys/public-payment-to-issuance.journey.test.ts',
  'e2e/journeys/claims-fnol-intake.journey.test.ts',
  'e2e/journeys/bo-fnol-clarification-cycle.journey.test.ts',
  'e2e/journeys/bo-referral-review-approval.journey.test.ts',
  'e2e/journeys/public-payment-documents-failed.journey.test.ts',
];

// Production-import sources accepted by the guard. Relative paths must
// climb out of `e2e/journeys/` into a real production tree; alias
// paths are the configured vitest aliases.
const PROD_IMPORT_PATTERNS = [
  /^\.\.\/(\.\.\/)?frontend\/src\//,
  /^\.\.\/(\.\.\/)?backend\//,
  /^\.\.\/(\.\.\/)?packages\//,
  /^@web\//,
  /^@server\//,
  /^@facio\//,
  /^@\/src\//,
];

// Collects identifiers introduced by an import clause. Handles:
//   import Default from '...'
//   import * as ns from '...'
//   import { a, b as c, type T } from '...'
//   mixed forms
function extractImportBindings(clauseSource) {
  const bindings = new Set();
  const clause = clauseSource.trim();
  if (!clause) return bindings;

  const namespaceMatch = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespaceMatch) bindings.add(namespaceMatch[1]);

  const namedBlock = clause.match(/\{([^}]*)\}/);
  if (namedBlock) {
    for (const raw of namedBlock[1].split(',')) {
      const piece = raw.replace(/^\s*type\s+/, '').trim();
      if (!piece) continue;
      const aliasMatch = piece.match(/(?:[A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/);
      if (aliasMatch) {
        bindings.add(aliasMatch[1]);
      } else {
        const idMatch = piece.match(/^([A-Za-z_$][\w$]*)$/);
        if (idMatch) bindings.add(idMatch[1]);
      }
    }
  }

  const headBeforeNamed = clause.split('{')[0].split(',')[0].trim();
  const defaultMatch = headBeforeNamed.match(/^(?:type\s+)?([A-Za-z_$][\w$]*)$/);
  if (defaultMatch) bindings.add(defaultMatch[1]);

  return bindings;
}

const IMPORT_RE = /^\s*import\s+([\s\S]+?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm;

function analyse(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const errors = [];
  const prodBindings = new Set();
  let hasProdImport = false;

  IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    const [, clause, specifier] = match;
    if (!PROD_IMPORT_PATTERNS.some((re) => re.test(specifier))) continue;
    hasProdImport = true;
    for (const binding of extractImportBindings(clause)) prodBindings.add(binding);
  }

  if (!hasProdImport) {
    errors.push(
      'No production-code import found. Each journey file must import at least one symbol from `frontend/src/`, `backend/`, `packages/`, or a configured alias.',
    );
  }

  if (prodBindings.size > 0) {
    // Strip the import statements before checking for binding use so we
    // do not count the import declaration itself.
    const body = source.replace(IMPORT_RE, '');
    const used = [...prodBindings].some((id) => new RegExp(`\\b${id}\\b`).test(body));
    if (!used) {
      errors.push(
        `Imported production bindings [${[...prodBindings].join(', ')}] are not referenced outside the import statement. Add a real assertion or remove the dead import.`,
      );
    }
  }

  return errors;
}

const missing = REQUIRED.filter((file) => !fs.existsSync(path.join(ROOT, file)));
if (missing.length > 0) {
  console.error('E2E journey coverage guard failed. Missing required journey files:\n');
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

const failures = [];
for (const file of REQUIRED) {
  const issues = analyse(file);
  if (issues.length) failures.push({ file, issues });
}

if (failures.length > 0) {
  console.error('E2E journey coverage guard failed. Tautological / dead journey files:\n');
  for (const { file, issues } of failures) {
    console.error(`- ${file}`);
    for (const issue of issues) console.error(`    ${issue}`);
  }
  console.error(
    '\nSee docs/develop/journey-registry.md for the canonical-owner contract each journey file must bind to.',
  );
  process.exit(1);
}

console.log('E2E journey coverage guard passed.');
