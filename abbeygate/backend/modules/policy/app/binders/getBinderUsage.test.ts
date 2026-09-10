import { describe, expect, it } from 'vitest';
import { getBinderUsageUseCase } from './getBinderUsage.js';

describe('getBinderUsageUseCase', () => {
  it('returns not found when binder is missing', async () => {
    const result = await getBinderUsageUseCase(
      { binderId: 'missing' },
      {
        repo: {
          async findBinderById() {
            return null;
          },
          async listProgramLinksByBinderId() {
            return [];
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

  it('returns mapped usage rows', async () => {
    const now = new Date('2026-03-07T00:00:00.000Z');
    const result = await getBinderUsageUseCase(
      { binderId: 'b1' },
      {
        repo: {
          async findBinderById() {
            return { id: 'b1' };
          },
          async listProgramLinksByBinderId() {
            return [
              {
                id: 'l1',
                status: 'ACTIVE',
                programId: 'p1',
                programName: 'Motor',
                programStatus: 'ACTIVE',
                mapping: { key: 'value' },
                updatedAt: now,
              },
            ];
          },
        },
      }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      data: [
        {
          id: 'l1',
          status: 'ACTIVE',
          programId: 'p1',
          programName: 'Motor',
          programStatus: 'ACTIVE',
          mapping: { key: 'value' },
          updatedAt: now,
        },
      ],
    });
  });
});
