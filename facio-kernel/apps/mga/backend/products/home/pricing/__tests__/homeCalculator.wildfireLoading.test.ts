import { describe, expect, it } from 'vitest';
import { calculateHomePremium as calculateHomePremiumWithRates } from '../homeCalculator.js';
import { loadHomeRates } from '../data/loader.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';

const fixtures = getTenantFixtures();
const HOME_RATES = loadHomeRates();
const calculateHomePremium = (input: Parameters<typeof calculateHomePremiumWithRates>[0]) => calculateHomePremiumWithRates(input, HOME_RATES);

const baseInputs = {
  propertyUse: 'Permanent' as const,
  propertyType: 'Villa',
  buildingsSumInsured: 200_000,
  contentsSumInsured: 25_000,
  accidentalDamageBuildings: false,
  accidentalDamageContents: false,
  woodenConstruction: false,
  alarm: 'No' as const,
  yearBuilt: '1990 or Later' as const,
  previousClaims: 'None' as const,
  noClaimsDiscount: '0 Years' as const,
  increasedExcess: 'STD 150 XS' as const,
  proposerOver45: false,
  europAssistance: false,
};

function priceIn(countryCode: string, input: Parameters<typeof calculateHomePremium>[0]) {
  const tenant = fixtures.find((t) => t.countryCode === countryCode);
  if (!tenant) throw new Error(`No fixture for ${countryCode}`);
  return runWithOperatingTenant(tenant, () => calculateHomePremium(input));
}

describe('home wildfire risk loading (ADR-0050)', () => {
  it('loads the canonical wildfire loading rates from the home rates JSON', () => {
    expect(HOME_RATES.wildfireLoading).toEqual({ amber: 0.2, yellow: 0.1, green: 0 });
  });

  it('applies the 20% Amber loading before discounts and UW profit loading', () => {
    const result = priceIn('CY', {
      ...baseInputs,
      propertyCountry: 'Cyprus',
      propertyTown: 'Rural Paphos',
    });
    expect(result.breakdown.loadingBreakdown.wildfire).toBe(0.2);
    expect(result.breakdown.afterLoadings).toBeCloseTo(result.breakdown.basePremium * 1.2, 2);
    expect(result.breakdown.wildfireRisk?.tier).toBe('amber');
    const step = result.premium.calculationDetails?.steps?.find((s) => s.id === 'home.loading.wildfire');
    expect(step?.factor).toBe(1.2);
  });

  it('applies the 10% Yellow loading before discounts and UW profit loading', () => {
    const result = priceIn('ES', {
      ...baseInputs,
      propertyCountry: 'Spain',
      propertyTown: 'Developed coastal area not adjacent to forest',
    });
    expect(result.breakdown.loadingBreakdown.wildfire).toBe(0.1);
    expect(result.breakdown.afterLoadings).toBeCloseTo(result.breakdown.basePremium * 1.1, 2);
    expect(result.breakdown.wildfireRisk?.tier).toBe('yellow');
  });

  it('does not apply a loading for explicit Green territory', () => {
    const result = priceIn('CY', {
      ...baseInputs,
      propertyCountry: 'Cyprus',
      propertyTown: 'Nicosia',
    });
    expect(result.breakdown.loadingBreakdown.wildfire).toBeUndefined();
    expect(result.breakdown.afterLoadings).toBeCloseTo(result.breakdown.basePremium, 2);
    expect(result.breakdown.wildfireRisk?.tier).toBe('green');
  });

  it('preserves unclassified wildfire audit state without adding a loading', () => {
    const result = priceIn('CY', {
      ...baseInputs,
      propertyCountry: 'Cyprus',
      propertyTown: 'Unknown Village',
    });
    expect(result.breakdown.loadingBreakdown.wildfire).toBeUndefined();
    expect(result.breakdown.afterLoadings).toBeCloseTo(result.breakdown.basePremium, 2);
    expect(result.breakdown.wildfireRisk?.tier).toBe('unclassified');
  });

  it('does not price a loading when Portugal ICNF Alta forces referral', () => {
    const result = priceIn('PT', {
      ...baseInputs,
      propertyCountry: 'Portugal',
      propertyTown: 'Lisbon',
      wildfireOfficialHazardClass: 'Alta',
    });
    expect(result.breakdown.loadingBreakdown.wildfire).toBeUndefined();
    expect(result.breakdown.wildfireRisk?.tier).toBe('red');
    expect(result.breakdown.wildfireRisk?.matchedOn).toBe('official');
  });
});
