import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { rebuildPolicyListIndexRow } from '../policyListIndex.js';
import type { BdxProjectionSyncResult } from './bdxImportTypes.js';
import { errorMessage } from '../../../../platform/http/httpErrors.js';

// Projection semantics:
// - verified: rebuild succeeded and list/search statuses align with the policy row
// - repaired_with_warning: a second rebuild was needed to recover alignment
// - failed: rebuild/verification could not guarantee aligned projections
export async function synchronizeProjectionAfterImport(policyId: string): Promise<BdxProjectionSyncResult> {
  try {
    await rebuildPolicyListIndexRow(policyId);
    const [policy, listIndex, searchIndex] = await Promise.all([
      tenantScopedPrisma.policy.findUnique({ where: { id: policyId }, select: { status: true } }),
      tenantScopedPrisma.policyListIndex.findUnique({ where: { policyId }, select: { status: true } }),
      tenantScopedPrisma.policySearchIndex.findUnique({ where: { policyId }, select: { status: true } }),
    ]);
    const expectedStatus = String(policy?.status || '').toUpperCase();
    const listStatus = String(listIndex?.status || '').toUpperCase();
    const searchStatus = String(searchIndex?.status || '').toUpperCase();
    if (!listIndex || !searchIndex) {
      await rebuildPolicyListIndexRow(policyId);
      return { status: 'repaired_with_warning', warning: 'Projection index row missing after rebuild; rebuilt again for recovery.' };
    }
    if (expectedStatus && (listStatus !== expectedStatus || searchStatus !== expectedStatus)) {
      await rebuildPolicyListIndexRow(policyId);
      return {
        status: 'repaired_with_warning',
        warning: `Projection status mismatch after bind (policy=${expectedStatus}, list=${listStatus || 'n/a'}, search=${searchStatus || 'n/a'}).`,
      };
    }
    return { status: 'verified' };
  } catch (error) {
    return { status: 'failed', warning: errorMessage(error, 'Projection rebuild failed') };
  }
}
