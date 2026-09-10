import { describe, expect, it } from 'vitest';
import { MotorProductAdapter } from '../MotorProductAdapter.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../testHelpers/tenantFixtures.js';

const tenant = getTenantFixtures().find((entry) => entry.countryCode === 'GR')!;
const adapter = new MotorProductAdapter();

describe('Greece Motor availability (ADR-0100)', () => {
  it('rejects rating even when an old program claims Cyprus jurisdiction', async () => {
    await runWithOperatingTenant(tenant, async () => {
      expect(() => adapter.calculatePremium({})).toThrow(/MOTOR\/GR/);
      await expect(adapter.buildQuoteResponse({}, { countryCode: 'CY' })).rejects.toThrow(/MOTOR\/GR/);
    });
  });

  it('fails both bind authority and issuance validation before any policy changes', async () => {
    await runWithOperatingTenant(tenant, async () => {
      expect(adapter.validateBindRules({}, {})).toMatchObject({ valid: false, errors: [{ field: 'productType', message: expect.stringContaining('MOTOR/GR') }] });
      expect(await adapter.validateForIssuance({})).toMatchObject({ valid: false, schemaIssues: [{ slug: 'productType', message: expect.stringContaining('MOTOR/GR') }] });
    });
  });
});
