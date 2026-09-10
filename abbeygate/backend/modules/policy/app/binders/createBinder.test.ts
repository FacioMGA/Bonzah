import { describe, expect, it, vi } from 'vitest';
import { createBinderUseCase } from './createBinder.js';

describe('createBinderUseCase', () => {
  it('creates binder with mapped defaults and logs audit', async () => {
    const createBinder = vi.fn(async (data: Record<string, unknown>) => ({
      id: 'b1',
      agreementNumber: data.agreementNumber,
      umr: data.umr,
      status: data.status,
    }));
    const logBinderCreated = vi.fn(async () => undefined);

    const result = await createBinderUseCase(
      {
        payload: {
          config: {
            agreement: {
              agreementNumber: 'AG-1',
              umr: 'UMR-1',
              status: 'DRAFT',
              coverholders: [{ name: 'Acme Coverholder' }],
              period: { inceptionDate: '2026-01-01', expiryDate: '2026-12-31' },
            },
            financials: { currency: 'EUR' },
          },
        },
        actor: { actorId: 'u1', actorType: 'USER' },
      },
      {
        repo: { createBinder },
        audit: { logBinderCreated },
      }
    );

    expect(createBinder).toHaveBeenCalledTimes(1);
    expect(logBinderCreated).toHaveBeenCalledWith({
      binderId: 'b1',
      actorId: 'u1',
      actorType: 'USER',
      agreementNumber: 'AG-1',
      umr: 'UMR-1',
      status: 'DRAFT',
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      data: { id: 'b1', agreementNumber: 'AG-1', umr: 'UMR-1', status: 'DRAFT' },
    });
  });

  it('falls back to defaults when payload is sparse', async () => {
    const createBinder = vi.fn(async (data: Record<string, unknown>) => ({
      id: 'b2',
      agreementNumber: data.agreementNumber,
      umr: data.umr,
      status: data.status,
    }));

    await createBinderUseCase(
      {
        payload: { config: {} },
        actor: { actorId: 'system', actorType: 'SYSTEM' },
      },
      {
        repo: { createBinder },
        audit: {
          async logBinderCreated() {
            return undefined;
          },
        },
      }
    );

    expect(createBinder).toHaveBeenCalledWith(
      expect.objectContaining({
        coverholderName: 'New Coverholder',
        agreementNumber: 'TBD',
        umr: 'TBD',
        defaultCurrency: 'USD',
        settlementCurrency: 'USD',
        status: 'DRAFT',
      })
    );
  });
});
