import { describe, expect, it } from 'vitest';
import { getPolicyFeedUseCase } from './getPolicyFeedUseCase.js';

describe('getPolicyFeedUseCase', () => {
  it('loads related entity feed and dedupes rows', async () => {
    const result = await getPolicyFeedUseCase(
      { policyId: 'pol_1' },
      {
        repo: {
          async findPolicyLinkage() {
            return { policyHolderId: 'holder_1', binderId: 'binder_1' };
          },
          async listAuditFeedByEntityIds(entityIds: string[]) {
            expect(entityIds).toEqual(['pol_1', 'holder_1', 'binder_1']);
            return [
              { id: 'evt_1', actionName: 'A', diff: { claimId: 'X' } },
              { id: 'evt_1_dup', actionName: 'A', diff: { claimId: 'X' } },
            ];
          },
        },
        rules: {
          dedupePolicyFeedRows(rows: Array<Record<string, unknown>>) {
            return rows.slice(0, 1);
          },
        },
      }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      data: [{ id: 'evt_1', actionName: 'A', diff: { claimId: 'X' } }],
    });
  });
});
