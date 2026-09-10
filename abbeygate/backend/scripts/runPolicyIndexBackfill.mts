import { backfillPolicyListIndex } from '../modules/policy/infra/projections/policyListIndex.js';

async function main() {
  const batchSize = Number(process.env.POLICY_INDEX_BACKFILL_BATCH_SIZE || 500);
  const maxBatches = Number(process.env.POLICY_INDEX_BACKFILL_MAX_BATCHES || 200);
  const processed = await backfillPolicyListIndex(batchSize, maxBatches);
  console.log(JSON.stringify({ processed, batchSize, maxBatches }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
