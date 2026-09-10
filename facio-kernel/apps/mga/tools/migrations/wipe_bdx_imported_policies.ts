/**
 * Granular wipe of BDX-imported policies on a single tenant.
 *
 * Delegates to `wipeBdxImportedPoliciesForTenant` so CLI and the admin
 * HTTP route (`POST /imports/bdx/wipe`) share one source of truth.
 *
 * STAGING ONLY. See docs/operate/bdx-recovery-rules.md:
 *   - Staging validation = wipe-and-reimport.
 *   - Production correction = correction endorsement / reversal — never wipe.
 *
 * Safety gates (ALL must pass to commit):
 *   - process.env.NODE_ENV !== 'production'
 *   - process.env.ALLOW_DESTRUCTIVE_BDX_WIPE === '1'
 *   - explicit `--tenant <slug>` arg
 *   - explicit `--commit` flag (default = dry-run, prints totals only)
 *
 * Examples:
 *   # Dry-run on staging-cy
 *   npx tsx tools/migrations/wipe_bdx_imported_policies.ts --tenant abbeygate-cy
 *
 *   # Live wipe (after eyeballing the dry-run totals)
 *   ALLOW_DESTRUCTIVE_BDX_WIPE=1 \
 *     npx tsx tools/migrations/wipe_bdx_imported_policies.ts \
 *       --tenant abbeygate-cy --commit
 */

import { prisma } from '../../backend/platform/db/connection.js';
import { runWithOperatingTenant } from '../../backend/platform/tenant/tenantAls.js';
import { loadTenantBySlug } from '../../backend/platform/tenant/tenantJobContext.js';
import {
  wipeBdxImportedPoliciesForTenant,
  type BdxWipeProductFilter,
} from '../../backend/modules/policy/app/bdxImport/bdxImportWipe.js';

type Args = {
  tenantSlug: string;
  product: BdxWipeProductFilter;
  commit: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { tenantSlug: '', product: null, commit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tenant') {
      args.tenantSlug = String(argv[i + 1] || '').trim();
      i += 1;
    } else if (arg === '--product') {
      const v = String(argv[i + 1] || '').trim().toUpperCase();
      if (v !== 'MOTOR' && v !== 'TRAVEL' && v !== 'HOME') {
        throw new Error(`--product must be one of motor|travel|home, got '${v}'`);
      }
      args.product = v as BdxWipeProductFilter;
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
    `Usage: npx tsx tools/migrations/wipe_bdx_imported_policies.ts \\\n` +
      `  --tenant <abbeygate-cy|abbeygate-pt|...> \\\n` +
      `  [--product <motor|travel|home>] \\\n` +
      `  [--commit]\n\n` +
      `Defaults to dry-run (prints per-product totals, no deletes).\n` +
      `Set ALLOW_DESTRUCTIVE_BDX_WIPE=1 to enable --commit.\n` +
      `This opt-in MUST NOT be set on production deployments\n` +
      `(see docs/operate/bdx-recovery-rules.md).\n`,
  );
  process.exit(code);
}

function assertSafetyGates(args: Args) {
  // We do NOT gate on NODE_ENV because the staging cluster (cy4) runs with
  // NODE_ENV=production for startup-validation parity (helm runtime-configmap).
  // The explicit `ALLOW_DESTRUCTIVE_BDX_WIPE=1` opt-in is the only honest
  // signal. This opt-in MUST NOT be set on production deployments.
  if (args.commit && process.env.ALLOW_DESTRUCTIVE_BDX_WIPE !== '1') {
    throw new Error('--commit requires ALLOW_DESTRUCTIVE_BDX_WIPE=1 in the environment.');
  }
}

function logLine(message: string) {
  process.stdout.write(`[bdx-wipe] ${message}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertSafetyGates(args);

  const tenant = await loadTenantBySlug(args.tenantSlug);
  if (!tenant) throw new Error(`Unknown tenant slug: ${args.tenantSlug}`);

  logLine(`tenant=${tenant.tenantSlug} (${tenant.id}) product=${args.product || 'ALL'} commit=${args.commit}`);

  const result = await runWithOperatingTenant(tenant, () =>
    wipeBdxImportedPoliciesForTenant({
      tenantSlug: tenant.tenantSlug,
      operatingTenantId: tenant.id,
      product: args.product,
      commit: args.commit,
      onProgress: (deleted, total) => {
        if (deleted % 50 === 0) logLine(`progress: deleted=${deleted}/${total}`);
      },
    }),
  );

  const productSummary = Object.entries(result.totals.byProduct)
    .map(([product, count]) => `${product.toLowerCase()}=${count}`)
    .join(' ');
  logLine(`would-delete totals: total=${result.totals.total} ${productSummary}`);

  if (!result.committed) {
    logLine('dry-run mode — no deletions performed. Re-run with --commit to apply.');
    return;
  }

  logLine(`done: deleted=${result.deleted} failed=${result.failed} of total=${result.totals.total}`);
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
    process.stderr.write(`[bdx-wipe] fatal: ${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
