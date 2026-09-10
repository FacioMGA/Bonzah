import { describe, expect, it } from 'vitest';
import { simulateBinderCheckUseCase } from './simulateBinderCheck.js';

describe('simulateBinderCheckUseCase', () => {
  it('returns not found when binder is missing', async () => {
    const result = await simulateBinderCheckUseCase(
      { binderId: 'missing', payload: {} },
      {
        repo: {
          async findBinderById() {
            return null;
          },
          async listActiveProgramLinksByBinderId() {
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

  it('returns fail reasons with authoritative status', async () => {
    const result = await simulateBinderCheckUseCase(
      { binderId: 'b1', payload: { territory: 'CY', insuredValue: 25000 } },
      {
        repo: {
          async findBinderById() {
            return {
              id: 'b1',
              config: {
                limits: { maxVehicleValue: '20000' },
                authority: { territories: ['UK'] },
              },
            };
          },
          async listActiveProgramLinksByBinderId() {
            return [{ programStatus: 'ACTIVE' }];
          },
        },
      }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        pass: false,
        authoritative: true,
        reasons: expect.arrayContaining([
          "Territory 'CY' is not allowed by this binder.",
          'Vehicle value 25000 exceeds binder maxVehicleValue 20000.',
        ]),
        matchedRules: expect.arrayContaining([
          expect.objectContaining({ ruleCode: 'TERRITORIAL_LIMIT', status: 'fail' }),
          expect.objectContaining({ ruleCode: 'MAX_VEHICLE_VALUE', status: 'fail' }),
        ]),
        inputs: expect.objectContaining({ territory: 'CY', insuredValue: 25000 }),
      }),
    }));
  });

  it('returns pass when checks succeed', async () => {
    const result = await simulateBinderCheckUseCase(
      { binderId: 'b2', payload: { territory: 'UK', insuredValue: 15000 } },
      {
        repo: {
          async findBinderById() {
            return {
              id: 'b2',
              config: {
                limits: { vehicleValueMax: '20000' },
                authority: { territories: ['UK', 'IE'] },
              },
            };
          },
          async listActiveProgramLinksByBinderId() {
            return [{ programStatus: 'DRAFT' }];
          },
        },
      }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        pass: true,
        authoritative: false,
        reasons: [],
        matchedRules: expect.arrayContaining([
          expect.objectContaining({ ruleCode: 'TERRITORIAL_LIMIT', status: 'pass' }),
          expect.objectContaining({ ruleCode: 'MAX_VEHICLE_VALUE', status: 'pass' }),
        ]),
        inputs: expect.objectContaining({ territory: 'UK', insuredValue: 15000 }),
      }),
    }));
  });
});
