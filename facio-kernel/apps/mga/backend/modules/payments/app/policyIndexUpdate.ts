import { enqueuePolicyListIndexUpdate } from '../../policy/infra/projections/policyListIndex.js';

export async function enqueuePolicyIndexFromPayments(
  tx: Parameters<typeof enqueuePolicyListIndexUpdate>[0],
  policyId: string,
) {
  return await enqueuePolicyListIndexUpdate(tx, policyId);
}
