import { backfillAccountIntelligenceProjection } from '../modules/accounts360/infra/projections/accountIntelligenceProjection.js';
import { runWithOperatingTenant } from '../platform/tenant/tenantAls.js';
import { buildTenantConfigFromEnv } from '../platform/tenant/tenantConfigForCli.js';

function positiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const batchSize = positiveInt('ACCOUNT_INTELLIGENCE_BACKFILL_BATCH_SIZE', 250);
  const maxBatches = positiveInt('ACCOUNT_INTELLIGENCE_BACKFILL_MAX_BATCHES', 400);
  const processed = await runWithOperatingTenant(buildTenantConfigFromEnv(), () =>
    backfillAccountIntelligenceProjection(batchSize, maxBatches),
  );
  process.stdout.write(`${JSON.stringify({ event: 'ACCOUNT_INTELLIGENCE.PROJECTION_BACKFILL', processed, batchSize, maxBatches })}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
