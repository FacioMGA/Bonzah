/**
 * Pre-go-live test-data reset (ADR-0051) — delete the internal/seed TEST
 * policies/quotes on a single tenant, identified by the customer proposer
 * email (see backend/modules/policy/app/bdxImport/testDataReset.ts).
 *
 * Selection = proposer email matches a TEST_EMAIL_PATTERN AND the policy is
 * NOT BDX-tagged. Real customers and migrated books are never touched. The
 * "remainder" (untagged rows with real/other emails) is reported only.
 *
 * Safety gates (ALL must pass to commit):
 *   - process.env.ALLOW_DESTRUCTIVE_TESTDATA_RESET === '1'
 *   - explicit `--tenant <slug>` in {abbeygate-cy, abbeygate-pt, abbeygate-gr}
 *   - explicit `--commit` flag (default = dry-run: preview only)
 *
 * Examples:
 *   # Dry-run preview on abbeygate-cy (matched set + distinct emails + remainder)
 *   npx tsx tools/migrations/wipe_non_bdx_test_policies.ts --tenant abbeygate-cy
 *
 *   # Live reset (after eyeballing the preview)
 *   ALLOW_DESTRUCTIVE_TESTDATA_RESET=1 \
 *     npx tsx tools/migrations/wipe_non_bdx_test_policies.ts --tenant abbeygate-cy --commit
 */

import { prisma } from '../../backend/platform/db/connection.js';
import { runWithOperatingTenant } from '../../backend/platform/tenant/tenantAls.js';
import { loadTenantBySlug } from '../../backend/platform/tenant/tenantJobContext.js';
import {
  assertTenantEligibleForTestDataReset,
  runTestDataReset,
} from '../../backend/modules/policy/app/bdxImport/testDataReset.js';

type Args = { tenantSlug: string; commit: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { tenantSlug: '', commit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tenant') {
      args.tenantSlug = String(argv[i + 1] || '').trim();
      i += 1;
    } else if (arg === '--commit') {
      args.commit = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsageAndExit(0);
    } else if (arg) {
      throw new Error(`Unknown arg: ${arg}`);
    }
  }
  if (!args.tenantSlug) throw new Error('--tenant <slug> is required');
  return args;
}

function printUsageAndExit(code: number): never {
  process.stdout.write(
    `Usage: npx tsx tools/migrations/wipe_non_bdx_test_policies.ts \\\n` +
      `  --tenant <abbeygate-cy|abbeygate-pt|abbeygate-gr> [--commit]\n\n` +
      `Defaults to dry-run (preview only). Set ALLOW_DESTRUCTIVE_TESTDATA_RESET=1 to enable --commit.\n`,
  );
  process.exit(code);
}

function assertSafetyGates(args: Args) {
  assertTenantEligibleForTestDataReset(args.tenantSlug);
  if (args.commit && process.env.ALLOW_DESTRUCTIVE_TESTDATA_RESET !== '1') {
    throw new Error('--commit requires ALLOW_DESTRUCTIVE_TESTDATA_RESET=1 in the environment.');
  }
}

function logLine(message: string) {
  process.stdout.write(`[testdata-reset] ${message}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertSafetyGates(args);

  const tenant = await loadTenantBySlug(args.tenantSlug);
  if (!tenant) throw new Error(`Unknown tenant slug: ${args.tenantSlug}`);

  logLine(`tenant=${tenant.tenantSlug} (${tenant.id}) commit=${args.commit}`);

  const result = await runWithOperatingTenant(tenant, () =>
    runTestDataReset({
      tenantSlug: tenant.tenantSlug,
      operatingTenantId: tenant.id,
      commit: args.commit,
      onProgress: (deleted, total) => {
        if (deleted % 50 === 0) logLine(`progress: deleted=${deleted}/${total}`);
      },
    }),
  );

  logLine(`bdx-tagged (never touched) in tenant: ${result.bdxTaggedCount}`);
  const productSummary = Object.entries(result.matched.byProduct)
    .map(([product, count]) => `${product.toLowerCase()}=${count}`)
    .join(' ') || '(none)';
  const statusSummary = Object.entries(result.matched.byStatus)
    .map(([status, count]) => `${status}=${count}`)
    .join(' ') || '(none)';
  logLine(`MATCHED test-email policies to delete: total=${result.matched.total} ${productSummary}`);
  logLine(`  by status: ${statusSummary}`);
  logLine(`  distinct emails (${result.matched.distinctEmails.length}):`);
  for (const e of result.matched.distinctEmails.slice(0, 40)) logLine(`    ${e.email} (${e.n})`);
  if (result.matched.distinctEmails.length > 40) logLine(`    ... +${result.matched.distinctEmails.length - 40} more`);
  logLine(`REMAINDER (untagged, non-test email — NOT deleted): total=${result.remainderUntagged.total}`);
  for (const r of result.remainderUntagged.byProductStatus) logLine(`    ${r.product}/${r.status}=${r.n}`);

  if (!result.committed) {
    logLine('dry-run mode — no deletions performed. Re-run with --commit to apply.');
    return;
  }

  logLine(`done: deleted=${result.deleted} failed=${result.failed} of matched=${result.matched.total}`);
  if (result.failures.length > 0) {
    const sample = result.failures.slice(0, 10);
    logLine(`failure sample (showing ${sample.length} of ${result.failures.length}):`);
    for (const f of sample) {
      logLine(`  policyId=${f.policyId} policyNumber=${f.policyNumber || '?'} error=${f.error}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[testdata-reset] fatal: ${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
