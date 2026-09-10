import { describe, expect, it } from 'vitest';
import { evaluateHomeUw } from '../homeUwAutomation.js';

function codes(decision: ReturnType<typeof evaluateHomeUw>): string[] {
  return decision.reasons.map((reason) => reason.code);
}

function trigger(decision: ReturnType<typeof evaluateHomeUw>, code: string) {
  return decision.triggers.find((item) => item.code === code);
}

describe('evaluateHomeUw — Section C high risk items', () => {
  it('refers jewellery even when it is within 20% of contents and a safe is confirmed', () => {
    const decision = evaluateHomeUw({
      contentsSumInsured: 100_000,
      coverage: { allRiskJewellery: 5_000 },
      safeOnPremises: true,
    });
    expect(decision.lane).toBe('referral');
    expect(decision.outcome).toBe('referral');
    expect(codes(decision)).toContain('JEWELLERY_HIGH_VALUE_ITEMS_REFERRAL');
    expect(codes(decision)).not.toContain('HIGH_VALUE_ITEMS_OVER_20PCT');
  });

  it('refers when a single high value item exceeds 20% of the contents sum insured', () => {
    const decision = evaluateHomeUw({
      contentsSumInsured: 100_000,
      coverage: { allRiskJewellery: 30_000 },
      safeOnPremises: true,
    });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('HIGH_VALUE_ITEMS_OVER_20PCT');
  });

  it('refers when the aggregate of itemised high risk items exceeds 20% of contents', () => {
    const decision = evaluateHomeUw({
      contentsSumInsured: 50_000,
      specifiedItems: [{ sumInsured: 6_000 }, { sumInsured: 6_000 }],
      safeOnPremises: true,
    });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('HIGH_VALUE_ITEMS_OVER_20PCT');
  });

  it('refers when specified high risk items are present but no safe is confirmed', () => {
    const decision = evaluateHomeUw({
      contentsSumInsured: 100_000,
      coverage: { allRiskJewellery: 5_000 },
      safeOnPremises: false,
    });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('SPECIFIED_HIGH_RISK_NO_SAFE');
    expect(codes(decision)).not.toContain('HIGH_VALUE_ITEMS_OVER_20PCT');
  });

  it('treats a missing safe answer the same as no safe', () => {
    const decision = evaluateHomeUw({
      contentsSumInsured: 100_000,
      coverage: { allRiskJewellery: 5_000 },
    });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('SPECIFIED_HIGH_RISK_NO_SAFE');
  });

  it('refers high risk items declared without a contents sum insured to apply the cap', () => {
    const decision = evaluateHomeUw({
      contentsSumInsured: 0,
      coverage: { allRiskJewellery: 1_000 },
      safeOnPremises: true,
    });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('HIGH_VALUE_ITEMS_OVER_20PCT');
  });

  it('does not apply Section C rules when there are no specified high risk items', () => {
    const decision = evaluateHomeUw({
      contentsSumInsured: 100_000,
      coverage: { allRiskJewellery: 0 },
    });
    expect(decision.lane).toBe('accept');
  });
});

describe('evaluateHomeUw — online acceptance limits', () => {
  it('accepts the buildings and contents limits', () => {
    const decision = evaluateHomeUw({
      buildingsSumInsured: 1_500_000,
      contentsSumInsured: 100_000,
    });
    expect(decision.lane).toBe('accept');
  });

  it.each([
    [{ buildingsSumInsured: 1_500_001 }, 'BUILDINGS_SUM_INSURED_EXCEEDED'],
    [{ contentsSumInsured: 100_001 }, 'CONTENTS_SUM_INSURED_EXCEEDED'],
    [{ coverage: { allRiskOther: 5_001 } }, 'ALL_RISKS_SUM_INSURED_EXCEEDED'],
    [{ coverage: { solarPanels: 20_001 } }, 'SOLAR_PANELS_SUM_INSURED_EXCEEDED'],
  ] as const)('refers values above the online limit', (input, expectedCode) => {
    const decision = evaluateHomeUw(input);
    expect(decision.lane).toBe('referral');
    expect(decision.outcome).toBe('referral');
    expect(codes(decision)).toContain(expectedCode);
  });
});

describe('evaluateHomeUw — Locus wildfire risk', () => {
  it('refers red wildfire territory before quote', () => {
    const decision = evaluateHomeUw({
      propertyCountry: 'Portugal',
      propertyTown: 'Pedrogao Grande',
    });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('WILDFIRE_RED_REFERRAL');
  });

  it('refers Portugal ICNF Alta territory even when the town has a lower broad match', () => {
    const decision = evaluateHomeUw({
      propertyCountry: 'Portugal',
      propertyTown: 'Lisbon',
      wildfireOfficialHazardClass: 'Alta',
    });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('WILDFIRE_RED_REFERRAL');
  });

  it('does not refer solely because Locus phase 1 cannot classify a territory', () => {
    const decision = evaluateHomeUw({
      propertyCountry: 'Cyprus',
      propertyTown: 'Unknown Village',
    });
    expect(decision.lane).toBe('accept');
    expect(codes(decision)).not.toContain('WILDFIRE_RED_REFERRAL');
  });

  it('accepts explicit green wildfire territory when no other referral rules fire', () => {
    const decision = evaluateHomeUw({
      propertyCountry: 'Cyprus',
      propertyTown: 'Nicosia',
    });
    expect(decision.lane).toBe('accept');
  });
});

describe('evaluateHomeUw — large plot size referral', () => {
  it('accepts property plots below 5,000 sqm when no other referral rules fire', () => {
    const decision = evaluateHomeUw({ landAreaSqm: 4_999 });
    expect(decision.lane).toBe('accept');
    expect(codes(decision)).not.toContain('LARGE_PLOT_SIZE_REFERRAL');
  });

  it('refers property plots of 5,000 sqm or more', () => {
    const decision = evaluateHomeUw({ landAreaSqm: 5_000 });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('LARGE_PLOT_SIZE_REFERRAL');
    expect(trigger(decision, 'LARGE_PLOT_SIZE_REFERRAL')?.fields).toEqual(['property.landAreaSqm']);
  });
});

describe('evaluateHomeUw — physical door/window security', () => {
  it('refers when external doors lack key operated locks', () => {
    const decision = evaluateHomeUw({ doorsFiveLeverLocks: false, windowsSecured: true });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('INSUFFICIENT_DOOR_WINDOW_SECURITY');
  });

  it('refers when easily accessible windows and patio doors lack interior locks', () => {
    const decision = evaluateHomeUw({ doorsFiveLeverLocks: true, windowsSecured: false });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('INSUFFICIENT_DOOR_WINDOW_SECURITY');
  });

  it('refers when both door and window security are absent', () => {
    const decision = evaluateHomeUw({ doorsFiveLeverLocks: false, windowsSecured: false });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('INSUFFICIENT_DOOR_WINDOW_SECURITY');
  });

  it('accepts when both door and window security are confirmed present', () => {
    const decision = evaluateHomeUw({ doorsFiveLeverLocks: true, windowsSecured: true });
    expect(decision.lane).toBe('accept');
  });

  it('does not refer on security when the questions are unanswered (undefined)', () => {
    const decision = evaluateHomeUw({});
    expect(codes(decision)).not.toContain('INSUFFICIENT_DOOR_WINDOW_SECURITY');
  });
});

describe('evaluateHomeUw — non-urban fire-station proximity', () => {
  it('refers a non-urban property that is not within 20 minutes of a fire station', () => {
    const decision = evaluateHomeUw({ urbanArea: false, within20MinFireStation: false });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('REMOTE_NON_URBAN_NO_FIRE_STATION');
  });

  it('accepts a non-urban property that is within 20 minutes of a fire station', () => {
    const decision = evaluateHomeUw({ urbanArea: false, within20MinFireStation: true });
    expect(decision.lane).toBe('accept');
    expect(codes(decision)).not.toContain('REMOTE_NON_URBAN_NO_FIRE_STATION');
  });

  it('accepts an urban property without considering the fire-station question', () => {
    const decision = evaluateHomeUw({ urbanArea: true, within20MinFireStation: false });
    expect(decision.lane).toBe('accept');
    expect(codes(decision)).not.toContain('REMOTE_NON_URBAN_NO_FIRE_STATION');
  });

  it('does not refer on fire-station proximity when the questions are unanswered', () => {
    const decision = evaluateHomeUw({});
    expect(codes(decision)).not.toContain('REMOTE_NON_URBAN_NO_FIRE_STATION');
  });
});

describe('evaluateHomeUw — business use of property (ABY-359)', () => {
  it('refers when the property is used for business, trade or professional purpose', () => {
    const decision = evaluateHomeUw({ usage: { permanentHome: true, businessUse: true } });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('BUSINESS_USE_OF_PROPERTY');
  });

  it('accepts when the property is not used for business', () => {
    const decision = evaluateHomeUw({ usage: { permanentHome: true, businessUse: false } });
    expect(decision.lane).toBe('accept');
    expect(codes(decision)).not.toContain('BUSINESS_USE_OF_PROPERTY');
  });

  it('does not refer on business use when the question is unanswered (undefined)', () => {
    const decision = evaluateHomeUw({});
    expect(codes(decision)).not.toContain('BUSINESS_USE_OF_PROPERTY');
  });
});

describe('evaluateHomeUw — operating-territory nationality referral (must never regress)', () => {
  it.each([
    ['Cyprus', 'Cypriot'],
    ['Portugal', 'Portuguese'],
    ['Greece', 'Greek'],
  ] as const)('refers %s nationals in their same operating market', (nationality, demonym) => {
    const decision = evaluateHomeUw({ proposerNationality: nationality, tenantCountry: nationality });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
    expect(trigger(decision, 'LOCAL_MARKET_NATIONALITY_REFERRAL')?.fields).toEqual(['proposer.nationality']);
    expect(trigger(decision, 'LOCAL_MARKET_NATIONALITY_REFERRAL')?.message).toContain(demonym);
  });

  it('matches demonym and ISO spellings case-insensitively', () => {
    expect(codes(evaluateHomeUw({ proposerNationality: 'cypriot', tenantCountry: 'CY' }))).toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
    expect(codes(evaluateHomeUw({ proposerNationality: 'CY', tenantCountry: 'cyprus' }))).toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
    expect(codes(evaluateHomeUw({ proposerNationality: 'portuguese', tenantCountry: 'PT' }))).toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
    expect(codes(evaluateHomeUw({ proposerNationality: 'PT', tenantCountry: 'portugal' }))).toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
  });

  it('does not refer approved CY/PT cross-market expats', () => {
    expect(codes(evaluateHomeUw({ proposerNationality: 'Portuguese', tenantCountry: 'Cyprus' }))).not.toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
    expect(codes(evaluateHomeUw({ proposerNationality: 'Cypriot', tenantCountry: 'Portugal' }))).not.toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
    expect(codes(evaluateHomeUw({ proposerNationality: 'Greek', tenantCountry: 'Cyprus' }))).not.toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
  });

  it('does not refer Spanish or Italian same-market nationals under the clarified live-market rule', () => {
    expect(codes(evaluateHomeUw({ proposerNationality: 'Spanish', tenantCountry: 'Spain' }))).not.toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
    expect(codes(evaluateHomeUw({ proposerNationality: 'Italian', tenantCountry: 'Italy' }))).not.toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
  });

  it('uses the property risk country ahead of tenant country for Home market matching', () => {
    expect(codes(evaluateHomeUw({
      proposerNationality: 'Portuguese',
      tenantCountry: 'Portugal',
      propertyCountry: 'Cyprus',
    }))).not.toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
    expect(codes(evaluateHomeUw({
      proposerNationality: 'Cypriot',
      tenantCountry: 'Portugal',
      propertyCountry: 'Cyprus',
    }))).toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
  });

  it('does not refer other nationalities', () => {
    const decision = evaluateHomeUw({ proposerNationality: 'United Kingdom' });
    expect(decision.lane).toBe('accept');
    expect(codes(decision)).not.toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
  });

  it('does not refer when nationality is not provided', () => {
    const decision = evaluateHomeUw({});
    expect(codes(decision)).not.toContain('LOCAL_MARKET_NATIONALITY_REFERRAL');
  });
});

describe('evaluateHomeUw — holiday home non-resident domicile', () => {
  it('accepts a holiday home when domicile is in another EU state', () => {
    const decision = evaluateHomeUw({
      usage: { permanentHome: false },
      proposerDomicileCountry: 'United Kingdom',
      tenantCountry: 'Portugal',
    });
    expect(decision.lane).toBe('accept');
    expect(codes(decision)).not.toContain('HOLIDAY_HOME_NON_RESIDENT_DOMICILE');
  });

  it('accepts a holiday home when domicile is in another EU member state', () => {
    const decision = evaluateHomeUw({
      usage: { permanentHome: false },
      proposerDomicileCountry: 'Germany',
      tenantCountry: 'Portugal',
    });
    expect(decision.lane).toBe('accept');
    expect(codes(decision)).not.toContain('HOLIDAY_HOME_NON_RESIDENT_DOMICILE');
  });

  it('refers a holiday home when domicile is outside the UK/EU', () => {
    const decision = evaluateHomeUw({
      usage: { permanentHome: false },
      proposerDomicileCountry: 'United States of America',
      tenantCountry: 'Portugal',
    });
    expect(decision.lane).toBe('referral');
    expect(codes(decision)).toContain('HOLIDAY_HOME_NON_RESIDENT_DOMICILE');
  });
});

describe('evaluateHomeUw — structured trigger field mapping', () => {
  const cases: Array<{
    code: string;
    expectedLane: 'yellow' | 'red';
    expectedFields: string[];
    input: Parameters<typeof evaluateHomeUw>[0];
  }> = [
    {
      code: 'PROPERTY_TYPE_NOT_SUPPORTED',
      expectedLane: 'red',
      expectedFields: ['property.propertyType'],
      input: { propertyType: 'Castle' },
    },
    {
      code: 'COUNTRY_NOT_SUPPORTED',
      expectedLane: 'red',
      expectedFields: ['property.address.country'],
      input: { propertyCountry: 'France' },
    },
    {
      code: 'GREEK_POSTCODE_NO_QUOTE',
      expectedLane: 'red',
      expectedFields: ['property.address.postcode'],
      input: { greekPostcode: '10' },
    },
    {
      code: 'WILDFIRE_RED_REFERRAL',
      expectedLane: 'yellow',
      expectedFields: ['property.address.country', 'property.address.city', 'property.address.postcode'],
      input: { propertyCountry: 'Portugal', propertyTown: 'Pedrogao Grande' },
    },
    {
      code: 'LARGE_PLOT_SIZE_REFERRAL',
      expectedLane: 'yellow',
      expectedFields: ['property.landAreaSqm'],
      input: { landAreaSqm: 5_000 },
    },
    {
      code: 'COMBUSTIBLE_CONSTRUCTION',
      expectedLane: 'yellow',
      expectedFields: ['property.woodenConstruction'],
      input: { woodenConstruction: true },
    },
    {
      code: 'PRE_2000_EARTHQUAKE_SUBSIDENCE',
      expectedLane: 'yellow',
      expectedFields: ['property.yearBuilt'],
      input: { yearBuilt: 'Prior to 1980' },
    },
    {
      code: 'LOCAL_MARKET_NATIONALITY_REFERRAL',
      expectedLane: 'yellow',
      expectedFields: ['proposer.nationality'],
      input: { proposerNationality: 'Cyprus', tenantCountry: 'Cyprus' },
    },
    {
      code: 'HOLIDAY_HOME_NON_RESIDENT_DOMICILE',
      expectedLane: 'yellow',
      expectedFields: ['usage.permanentHome', 'proposer.domicileCountry'],
      input: { usage: { permanentHome: false }, proposerDomicileCountry: 'United States of America', tenantCountry: 'Portugal' },
    },
    {
      code: 'HOLIDAY_ALL_RISKS_NOT_OFFERED',
      expectedLane: 'yellow',
      expectedFields: ['usage.permanentHome', 'coverage.allRiskJewellery', 'coverage.allRiskOther'],
      input: { usage: { permanentHome: false }, coverage: { allRiskJewellery: 1_000 }, contentsSumInsured: 100_000, safeOnPremises: true },
    },
    {
      code: 'HOLIDAY_ACCIDENTAL_DAMAGE_NOT_OFFERED',
      expectedLane: 'yellow',
      expectedFields: ['usage.permanentHome', 'coverage.accidentalDamageBuildings', 'coverage.accidentalDamageContents'],
      input: { usage: { permanentHome: false }, coverage: { accidentalDamageBuildings: true } },
    },
    {
      code: 'BUSINESS_USE_OF_PROPERTY',
      expectedLane: 'yellow',
      expectedFields: ['usage.businessUse'],
      input: { usage: { businessUse: true } },
    },
    {
      code: 'INSUFFICIENT_DOOR_WINDOW_SECURITY',
      expectedLane: 'yellow',
      expectedFields: ['security.doorsFiveLeverLocks', 'security.windowsSecured'],
      input: { doorsFiveLeverLocks: false, windowsSecured: true },
    },
    {
      code: 'REMOTE_NON_URBAN_NO_FIRE_STATION',
      expectedLane: 'yellow',
      expectedFields: ['property.urbanArea', 'property.within20MinFireStation'],
      input: { urbanArea: false, within20MinFireStation: false },
    },
    {
      code: 'HIGH_VALUE_ITEMS_OVER_20PCT',
      expectedLane: 'yellow',
      expectedFields: ['coverage.allRiskJewellery', 'coverage.allRiskOther', 'coverage.contents'],
      input: { contentsSumInsured: 100_000, coverage: { allRiskJewellery: 30_000 }, safeOnPremises: true },
    },
    {
      code: 'SPECIFIED_HIGH_RISK_NO_SAFE',
      expectedLane: 'yellow',
      expectedFields: ['security.safeOnPremises'],
      input: { contentsSumInsured: 100_000, coverage: { allRiskJewellery: 5_000 }, safeOnPremises: false },
    },
    {
      code: 'TWO_CLAIMS',
      expectedLane: 'yellow',
      expectedFields: ['risk.previousClaims'],
      input: { previousClaims: '2 claims < 3000' },
    },
    {
      code: 'CLAIMS_THRESHOLD',
      expectedLane: 'yellow',
      expectedFields: ['risk.previousClaims'],
      input: { previousClaims: '3 claims or > 3000' },
    },
    {
      code: 'BUILDINGS_SUM_INSURED_EXCEEDED',
      expectedLane: 'yellow',
      expectedFields: ['coverage.buildings'],
      input: { buildingsSumInsured: 1_500_001 },
    },
    {
      code: 'CONTENTS_SUM_INSURED_EXCEEDED',
      expectedLane: 'yellow',
      expectedFields: ['coverage.contents'],
      input: { contentsSumInsured: 100_001 },
    },
    {
      code: 'ALL_RISKS_SUM_INSURED_EXCEEDED',
      expectedLane: 'yellow',
      expectedFields: ['coverage.allRiskOther'],
      input: { coverage: { allRiskOther: 5_001 } },
    },
    {
      code: 'SOLAR_PANELS_SUM_INSURED_EXCEEDED',
      expectedLane: 'yellow',
      expectedFields: ['coverage.solarPanelCover'],
      input: { coverage: { solarPanels: 20_001 } },
    },
    {
      code: 'JEWELLERY_HIGH_VALUE_ITEMS_REFERRAL',
      expectedLane: 'yellow',
      expectedFields: ['coverage.allRiskJewellery', 'coverage.specifiedItems'],
      input: { contentsSumInsured: 100_000, coverage: { allRiskJewellery: 1_000 }, safeOnPremises: true },
    },
  ];

  it.each(cases)('emits %s with BO questionnaire fields', ({ code, expectedLane, expectedFields, input }) => {
    const decision = evaluateHomeUw(input);
    expect(trigger(decision, code)).toMatchObject({
      code,
      lane: expectedLane,
      fields: expectedFields,
    });
  });
});
