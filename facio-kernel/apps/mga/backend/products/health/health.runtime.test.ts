import { describe, expect, it } from 'vitest';
import { healthGoldenFixtures } from './goldenFixtures.js';
import { healthProductRuntimeConfig } from './runtime.js';
import { loadBritHealthRates } from './pricing/data/loader.js';
import { runWithOperatingTenant } from '../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../testHelpers/tenantFixtures.js';
import { fixtureProgrammeDefinition } from '../programDefinitionFixtures.js';

const cyTenant = getTenantFixtures().find((tenant) => tenant.countryCode === 'CY')!;
const healthDefinition = fixtureProgrammeDefinition('HEALTH');

describe('health endorsement premium', () => {
  it('returns the mapped programme premium when a no-cost endorsement is previewed', async () => {
    const result = await runWithOperatingTenant(cyTenant, () => healthProductRuntimeConfig.calculateEndorsementPremium(
      healthGoldenFixtures.minimumValid,
      [{ code: 'GHS-EXTENSION' }],
      {
        ratingModel: {
          id: 'health-endorsement-test-model',
          programId: healthDefinition.programId,
          version: 1,
          binderProductAuthorityId: healthDefinition.binderProductAuthorityId,
          tables: loadBritHealthRates(),
        },
      },
    ));

    expect(result.premium).toBeGreaterThan(0);
    expect(result.policyExcess).toBe(0);
  });
});
