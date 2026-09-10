import { describe, expect, it } from 'vitest';
import { getBinderByIdUseCase } from './getBinderById.js';

describe('getBinderByIdUseCase', () => {
  it('returns not found when binder does not exist', async () => {
    const result = await getBinderByIdUseCase(
      { binderId: 'missing' },
      {
        repo: {
          async findBinderById() {
            return null;
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

  it('returns binder payload when found', async () => {
    const binder = {
      id: 'b1',
      agreementNumber: 'AG-123',
      documents: [],
      parties: [],
      coverages: [],
      clauses: [],
      financials: null,
      reportingConfig: null,
    };
    const result = await getBinderByIdUseCase(
      { binderId: 'b1' },
      {
        repo: {
          async findBinderById() {
            return binder;
          },
        },
      }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      data: binder,
    });
  });
});
