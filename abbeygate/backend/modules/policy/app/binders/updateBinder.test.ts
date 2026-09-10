import { describe, expect, it, vi } from 'vitest';
import { updateBinderUseCase } from './updateBinder.js';

describe('updateBinderUseCase', () => {
  it('returns 404 when binder missing', async () => {
    const result = await updateBinderUseCase(
      {
        binderId: 'missing',
        payload: {},
        actor: { actorId: 'u1', actorType: 'USER' },
      },
      {
        repo: {
          async findBinderForUpdate() {
            return null;
          },
          async updateBinder() {
            throw new Error('should not run');
          },
          async syncBinderNormalized() {
            throw new Error('should not run');
          },
        },
        audit: {
          async logBinderSaved() {
            throw new Error('should not run');
          },
        },
      }
    );

    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Binder not found' },
    });
  });

  it('updates binder and syncs normalized data', async () => {
    const updateBinder = vi.fn(async () => ({
      id: 'b1',
      agreementNumber: 'AG-2',
      umr: 'UMR-2',
      status: 'ACTIVE',
    }));
    const syncBinderNormalized = vi.fn(async () => undefined);
    const logBinderSaved = vi.fn(async () => undefined);

    const result = await updateBinderUseCase(
      {
        binderId: 'b1',
        payload: {
          status: 'ACTIVE',
          config: {
            agreement: {
              agreementNumber: 'AG-2',
              umr: 'UMR-2',
              coverholders: [{ id: 'ch1', name: 'Cover Co', role: 'APPOINTED' }],
            },
            financials: { grossPremiumIncomeLimit: 120000 },
            operations: {
              claims: { authorizedTPA: { id: 't1', name: 'TPA Name' } },
              reporting: { writtenRiskSchedule: 'Monthly' },
            },
          },
        },
        actor: { actorId: 'u1', actorType: 'USER' },
      },
      {
        repo: {
          async findBinderForUpdate() {
            return {
              id: 'b1',
              coverholderName: 'Old',
              coverholderPin: null,
              agreementNumber: 'AG-1',
              umr: 'UMR-1',
              lloydsReportingVer: 'V5.2',
              defaultCurrency: 'USD',
              settlementCurrency: 'USD',
              startDate: null,
              endDate: null,
              status: 'DRAFT',
            };
          },
          updateBinder,
          syncBinderNormalized,
        },
        audit: { logBinderSaved },
      }
    );

    expect(updateBinder).toHaveBeenCalledTimes(1);
    expect(syncBinderNormalized).toHaveBeenCalledTimes(1);
    expect(logBinderSaved).toHaveBeenCalledWith({
      binderId: 'b1',
      actorId: 'u1',
      actorType: 'USER',
      agreementNumber: 'AG-2',
      umr: 'UMR-2',
      status: 'ACTIVE',
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      data: {
        id: 'b1',
        agreementNumber: 'AG-2',
        umr: 'UMR-2',
        status: 'ACTIVE',
      },
    });
  });
});
