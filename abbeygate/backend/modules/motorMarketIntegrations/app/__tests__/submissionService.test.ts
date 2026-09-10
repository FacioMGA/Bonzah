import { describe, expect, it } from 'vitest';

import { MotorMarketSubmissionService } from '../submissionService.js';
import { SpecPendingMotorMarketConnector } from '../../infra/specPendingConnector.js';

describe('motor market submissions', () => {
  it('reports the onboarding checklist as spec-blocked', () => {
    const service = new MotorMarketSubmissionService();

    const checklist = service.checklist();

    expect(checklist.status).toBe('BLOCKED_WAITING_FOR_EXTERNAL_SPEC');
    expect(checklist.items.length).toBeGreaterThan(5);
    expect(checklist.items.every((item) => item.received === false)).toBe(true);
  });

  it('keeps connector attempts blocked until official external specs exist', async () => {
    const connector = new SpecPendingMotorMarketConnector();

    const result = await connector.submit({
      submissionId: 'sub-1',
      provider: 'SEGURNET',
      channel: 'E_SEGURNET',
      idempotencyKey: 'segurnet:test',
      payload: { claimId: 'claim-1' },
    });

    expect(result.status).toBe('BLOCKED_WAITING_FOR_EXTERNAL_SPEC');
    expect(result.errorCode).toBe('EXTERNAL_SPEC_REQUIRED');
    expect(result.responsePayload).toMatchObject({
      provider: 'SEGURNET',
      channel: 'E_SEGURNET',
    });
  });
});
