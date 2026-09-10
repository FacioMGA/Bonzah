import { describe, expect, it, vi } from 'vitest';
import { publishBinderUseCase } from './publishBinder.js';

describe('publishBinderUseCase', () => {
  it('returns 404 when binder missing', async () => {
    const result = await publishBinderUseCase(
      { binderId: 'missing' },
      {
        repo: {
          async findBinderById() {
            return null;
          },
          async publishBinderWithPeriods() {
            throw new Error('should not run');
          },
        },
        logger: { info() {} },
      }
    );
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ success: false, error: 'Binder not found' });
  });

  it('returns 400 when dates are missing', async () => {
    const result = await publishBinderUseCase(
      { binderId: 'b1' },
      {
        repo: {
          async findBinderById() {
            return { id: 'b1', agreementNumber: 'AG-1', startDate: null, endDate: null };
          },
          async publishBinderWithPeriods() {
            throw new Error('should not run');
          },
        },
        logger: { info() {} },
      }
    );
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      success: false,
      error: 'Binder must have valid Start and End dates to be published.',
    });
  });

  it('publishes and returns generated period count', async () => {
    const publishBinderWithPeriods = vi.fn(async () => undefined);
    const loggerInfo = vi.fn();
    const result = await publishBinderUseCase(
      { binderId: 'b1' },
      {
        repo: {
          async findBinderById() {
            return {
              id: 'b1',
              agreementNumber: 'AG-1',
              startDate: new Date('2026-01-10'),
              endDate: new Date('2026-03-05'),
            };
          },
          publishBinderWithPeriods,
        },
        logger: { info: loggerInfo },
      }
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      data: {
        id: 'b1',
        status: 'ACTIVE',
        reportingPeriodsCreated: 2,
        message: 'Published binder AG-1.',
      },
    });
    expect(publishBinderWithPeriods).toHaveBeenCalledTimes(1);
    expect(loggerInfo).toHaveBeenCalledTimes(1);
  });
});
