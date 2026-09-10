import { describe, expect, it } from 'vitest';
import { listBindersUseCase } from './listBinders.js';

describe('listBindersUseCase', () => {
  it('returns binder list payload', async () => {
    const rows = [{ id: 'b1' }, { id: 'b2' }];
    const result = await listBindersUseCase({
      repo: {
        async listBinders() {
          return rows;
        },
      },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      data: rows,
    });
  });
});
