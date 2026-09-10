import fs from 'node:fs';
import path from 'node:path';

/**
 * Regression guard: reportsRouter.ts must not hydrate `Policy.quoteResponse` /
 * `quoteData` (JSONB) to compute the dashboard core tiles. Use a groupBy /
 * aggregate over `policySearchIndex` instead — see dashboardAggregates.ts.
 *
 * Doing the BI work in Node over hydrated JSONB caused 502s on wide ranges
 * (~5k policies × 3 windows). This script keeps the slow path out.
 */

const TARGET = path.resolve('backend/modules/policy/http/reportsRouter.ts');

if (!fs.existsSync(TARGET)) {
  // eslint-disable-next-line no-console
  console.error(`[dashboard-no-policy-jsonb-hydration] target file missing: ${TARGET}`);
  process.exit(1);
}

const content = fs.readFileSync(TARGET, 'utf8');

// Strip block + line comments so guidance comments cannot accidentally trip the guard.
const stripped = content
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');

const FORBIDDEN_COLUMNS = ['quoteResponse', 'quoteData'];
const FIND_MANY_PATTERN = /\b(?:tenantScopedPrisma|prisma)\.policy\.(?:findMany|findFirst|findUnique)\s*\(\s*\{[\s\S]*?\}\s*\)/g;

const violations = [];

for (const match of stripped.matchAll(FIND_MANY_PATTERN)) {
  const block = String(match[0] || '');
  for (const column of FORBIDDEN_COLUMNS) {
    const re = new RegExp(`\\b${column}\\s*:\\s*true\\b`);
    if (re.test(block)) {
      const start = match.index ?? 0;
      const lineNumber = stripped.slice(0, start).split('\n').length;
      const snippet = block.replace(/\s+/g, ' ').slice(0, 220);
      violations.push({ column, lineNumber, snippet });
    }
  }
}

if (violations.length > 0) {
  // eslint-disable-next-line no-console
  console.error('[dashboard-no-policy-jsonb-hydration] reports/dashboard handler must not hydrate Policy JSONB columns to compute core tiles.');
  // eslint-disable-next-line no-console
  console.error('[dashboard-no-policy-jsonb-hydration] Use a groupBy / aggregate over `policySearchIndex` instead — see dashboardAggregates.ts.');
  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.error(`- ${path.relative(process.cwd(), TARGET)}:${v.lineNumber}  selects \`${v.column}: true\` in policy.findMany — \`${v.snippet}\``);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[dashboard-no-policy-jsonb-hydration] ok');
