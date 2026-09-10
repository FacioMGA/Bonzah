import { describe, expect, it } from 'vitest';
import { getIssueReadinessUseCase } from './getIssueReadinessUseCase.js';

describe('getIssueReadinessUseCase', () => {
  it('returns success payload with service output', async () => {
    const result = await getIssueReadinessUseCase(
      { policyId: 'pol_1', channel: 'bo', riskTransactionId: 'rt_1' },
      {
        service: {
          async evaluateIssueReadiness(policyId, channel, opts) {
            expect(policyId).toBe('pol_1');
            expect(channel).toBe('bo');
            expect(opts).toEqual({ riskTransactionId: 'rt_1' });
            return { canIssue: true, blockers: [] };
          },
        },
      }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      data: { canIssue: true, blockers: [] },
    });
  });
});
