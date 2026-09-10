import { backfillAccounts360Projection } from '../modules/accounts360/infra/projections/accounts360Projection.js';

async function main() {
  const batchSize = Number(process.env.ACCOUNTS360_BACKFILL_BATCH_SIZE || 250);
  const maxBatches = Number(process.env.ACCOUNTS360_BACKFILL_MAX_BATCHES || 400);
  const processed = await backfillAccounts360Projection(batchSize, maxBatches);
  console.log(JSON.stringify({ processed, batchSize, maxBatches }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
