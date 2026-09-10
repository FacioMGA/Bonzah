import { describe, expect, it } from 'vitest';
import { runWithOperatingTenant } from '../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../testHelpers/tenantFixtures.js';
import { homeGoldenFixtures } from './goldenFixtures.js';
import { homeProductRuntimeConfig as homeRuntimeDefinition } from './runtime.js';
import { parseRecord, type UnknownRecord } from '../../platform/json/parseRecord.js';
import type { BuildQuoteResponseContext } from '../../modules/policy/domain/productContracts.js';
import { fixtureProgrammeDefinition, fixtureRatingModelTables } from '../programDefinitionFixtures.js';

const ptTenant = getTenantFixtures().find((t) => t.countryCode === 'PT')!;
const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInPT = <T>(fn: () => Promise<T>): Promise<T> => runWithOperatingTenant(ptTenant, fn);
const runInCY = <T>(fn: () => Promise<T>): Promise<T> => runWithOperatingTenant(cyTenant, fn);

const homeFixtureRatingModel = fixtureRatingModelTables('HOME');
if (!homeFixtureRatingModel) throw new Error('HOME fixture rating model is required.');
const homeFixtureDefinition = fixtureProgrammeDefinition('HOME');

const homeProductRuntimeConfig = {
  ...homeRuntimeDefinition,
  buildQuoteResponse(quoteData: unknown, context: BuildQuoteResponseContext = {}) {
    return homeRuntimeDefinition.buildQuoteResponse(quoteData, {
      ...context,
      programDefinition: homeFixtureDefinition,
      ratingModel: {
        id: 'home-runtime-test-model',
        programId: homeFixtureDefinition.programId,
        version: 1,
        binderProductAuthorityId: homeFixtureDefinition.binderProductAuthorityId,
        tables: homeFixtureRatingModel,
      },
    });
  },
};

function analysisTriggers(response: Awaited<ReturnType<typeof homeProductRuntimeConfig.buildQuoteResponse>>): UnknownRecord[] {
  const analysis = parseRecord(response.underwritingAnalysis);
  return Array.isArray(analysis.triggers) ? analysis.triggers.map(parseRecord) : [];
}

function annualPremium(response: Awaited<ReturnType<typeof homeProductRuntimeConfig.buildQuoteResponse>>): number {
  const primaryOption = response.quoteResponse.primaryOption;
  return Number((primaryOption && typeof primaryOption === 'object' ? primaryOption as UnknownRecord : {}).annualPremium || 0);
}

describe('home buildQuoteResponse uses resolvedCoverageSet', () => {
  const baseQuote = homeGoldenFixtures.minimumValid;

  it('includes €2,000 solar cover in CY and permits higher customer-selected cover', async () => {
    const baseCoverage = baseQuote.coverage as UnknownRecord;
    const defaultSolar = await runInCY(() => homeProductRuntimeConfig.buildQuoteResponse(baseQuote, { resolvedCoverageSet: null }));
    const belowMinimumSolar = await runInCY(() => homeProductRuntimeConfig.buildQuoteResponse({
      ...baseQuote,
      coverage: {
        ...baseCoverage,
        solarPanelCover: 1_000,
      },
    }, { resolvedCoverageSet: null }));
    const higherSolar = await runInCY(() => homeProductRuntimeConfig.buildQuoteResponse({
      ...baseQuote,
      coverage: {
        ...(baseQuote.coverage as Record<string, unknown>),
        solarPanelCover: 20_000,
      },
    }, { resolvedCoverageSet: null }));

    const defaultPremium = annualPremium(defaultSolar);
    const belowMinimumPremium = annualPremium(belowMinimumSolar);
    const higherPremium = annualPremium(higherSolar);
    expect(defaultPremium).toBeGreaterThan(0);
    expect(belowMinimumPremium).toBe(defaultPremium);
    expect(higherPremium).toBeGreaterThan(defaultPremium);
  });

  it.each([
    [{ buildings: 1_500_001, contents: 100_000 }, 'BUILDINGS_SUM_INSURED_EXCEEDED'],
    [{ buildings: 1_500_000, contents: 100_001 }, 'CONTENTS_SUM_INSURED_EXCEEDED'],
    [{ buildings: 1_500_000, contents: 100_000, allRiskOther: 5_001 }, 'ALL_RISKS_SUM_INSURED_EXCEEDED'],
    [{ buildings: 1_500_000, contents: 100_000, solarPanelCover: 20_001 }, 'SOLAR_PANELS_SUM_INSURED_EXCEEDED'],
    [{ buildings: 1_500_000, contents: 100_000, allRiskJewellery: 1_000 }, 'JEWELLERY_HIGH_VALUE_ITEMS_REFERRAL'],
  ])('routes Home online-limit breaches through UW referral', async (coverage, expectedCode) => {
    const response = await runInCY(() => homeProductRuntimeConfig.buildQuoteResponse({
      ...baseQuote,
      coverage,
      security: { safeOnPremises: true },
    }, { resolvedCoverageSet: null }));

    expect(response.quoteResponse.status).toBe('REFERRAL');
    expect(analysisTriggers(response)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: expectedCode, lane: 'yellow' }),
    ]));
  });

  it('does not let MBE selection remove or change product-owned solar cover', async () => {
    const withoutCoverage = await runInCY(() => homeProductRuntimeConfig.buildQuoteResponse(baseQuote, { resolvedCoverageSet: null }));
    const withCoverage = await runInCY(() => homeProductRuntimeConfig.buildQuoteResponse(baseQuote, {
      resolvedCoverageSet: {
        productType: 'HOME',
        programCode: 'abbeygate_home',
        selectedCodes: ['HOME-SOLAR-PANELS'],
        items: [],
        applied: [{ code: 'HOME-SOLAR-PANELS', params: { amount: 20000 } }],
      },
    }));
    const withoutPremium = Number((withoutCoverage.quoteResponse.primaryOption as Record<string, unknown>)?.annualPremium || 0);
    const withPremium = Number((withCoverage.quoteResponse.primaryOption as Record<string, unknown>)?.annualPremium || 0);
    expect(withPremium).toBe(withoutPremium);
  });

  it('strips accidental damage reintroduced by resolved cover before rating a holiday home', async () => {
    const holidayQuote = {
      ...baseQuote,
      usage: { ...(baseQuote.usage as UnknownRecord), permanentHome: false },
      proposer: { ...(baseQuote.proposer as UnknownRecord), domicileCountry: 'United Kingdom' },
    };
    const withoutCoverage = await runInPT(() => homeProductRuntimeConfig.buildQuoteResponse(
      holidayQuote,
      { resolvedCoverageSet: null },
    ));
    const withForbiddenCoverage = await runInPT(() => homeProductRuntimeConfig.buildQuoteResponse(
      holidayQuote,
      {
        resolvedCoverageSet: {
          productType: 'HOME',
          programCode: 'abbeygate_home',
          selectedCodes: ['HOME-ACC-DAMAGE-BUILDINGS'],
          items: [],
          applied: [{ code: 'HOME-ACC-DAMAGE-BUILDINGS' }],
        },
      },
    ));

    expect(withForbiddenCoverage.quoteResponse.status).toBe('REFERRAL');
    expect(analysisTriggers(withForbiddenCoverage)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HOLIDAY_ACCIDENTAL_DAMAGE_NOT_OFFERED', lane: 'yellow' }),
    ]));
    expect(Number((withForbiddenCoverage.quoteResponse.primaryOption as UnknownRecord)?.annualPremium || 0))
      .toBe(Number((withoutCoverage.quoteResponse.primaryOption as UnknownRecord)?.annualPremium || 0));
  });

  it('preserves raw holiday all-risks selections as UW evidence while excluding them from price', async () => {
    const holidayQuote = {
      ...baseQuote,
      usage: { ...(baseQuote.usage as UnknownRecord), permanentHome: false },
      proposer: { ...(baseQuote.proposer as UnknownRecord), domicileCountry: 'United Kingdom' },
      coverage: {
        ...(baseQuote.coverage as UnknownRecord),
        allRiskJewellery: 1_000,
      },
      security: { safeOnPremises: true },
    };
    const response = await runInPT(() => homeProductRuntimeConfig.buildQuoteResponse(
      holidayQuote,
      { resolvedCoverageSet: null },
    ));

    expect(response.quoteResponse.status).toBe('REFERRAL');
    expect(analysisTriggers(response)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HOLIDAY_ALL_RISKS_NOT_OFFERED', lane: 'yellow' }),
    ]));
  });

  it('refers holiday homes when proposer domicile is outside the tenant country and outside the UK/EU', async () => {
    const response = await runInCY(() => homeProductRuntimeConfig.buildQuoteResponse({
      ...baseQuote,
      proposer: {
        ...(baseQuote.proposer as Record<string, unknown>),
        domicileCountry: 'United States of America',
      },
      property: {
        ...(baseQuote.property as Record<string, unknown>),
        permanentHome: false,
      },
      usage: {
        ...(baseQuote.usage as Record<string, unknown>),
        permanentHome: false,
      },
    }, { resolvedCoverageSet: null }));

    expect(response.quoteResponse.status).toBe('REFERRAL');
    expect(response.underwritingAnalysis).toMatchObject({
      lane: 'yellow',
      outcome: 'referral',
      triggers: expect.arrayContaining([
        expect.objectContaining({
          code: 'HOLIDAY_HOME_NON_RESIDENT_DOMICILE',
          lane: 'yellow',
          fields: ['usage.permanentHome', 'proposer.domicileCountry'],
        }),
      ]),
    });
    expect(parseRecord(response.quoteResponse.uwDecision).reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HOLIDAY_HOME_NON_RESIDENT_DOMICILE' }),
    ]));
  });

  it('quotes holiday homes online when proposer domicile is in the UK or EU', async () => {
    const response = await runInPT(() => homeProductRuntimeConfig.buildQuoteResponse({
      ...baseQuote,
      proposer: {
        ...(baseQuote.proposer as Record<string, unknown>),
        domicileCountry: 'United Kingdom',
      },
      property: {
        ...(baseQuote.property as Record<string, unknown>),
        address: { line1: '1 Rua Nova', city: 'Lisbon', country: 'Portugal', postcode: '1000-001' },
        permanentHome: false,
      },
      usage: {
        ...(baseQuote.usage as Record<string, unknown>),
        permanentHome: false,
      },
    }, { resolvedCoverageSet: null }));

    expect(response.quoteResponse.status).toBe('QUOTED');
    expect(response.underwritingAnalysis).toMatchObject({ lane: 'green', outcome: 'accept', triggerCount: 0 });
    expect(
      (parseRecord(response.quoteResponse.uwDecision) as { reasons?: Array<{ code: string }> }).reasons || [],
    ).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HOLIDAY_HOME_NON_RESIDENT_DOMICILE' }),
    ]));
  });

  it('keeps ordinary quotes online when Locus phase 1 has no wildfire territory match', async () => {
    const response = await runInCY(() => homeProductRuntimeConfig.buildQuoteResponse({
      ...baseQuote,
      property: {
        address: { line1: '1 Village Road', city: 'Unknown Village', country: 'Cyprus', postcode: '5555' },
        sameAsProposer: true,
        propertyType: 'Villa',
        bedrooms: 3,
        floorAreaSqm: 140,
        landAreaSqm: 200,
        urbanArea: true,
        permanentHome: true,
        woodenConstruction: false,
        nonCombustibleMaterial: true,
        alarm: 'Yes',
        yearBuilt: '1990 or Later',
      },
    }, { resolvedCoverageSet: null }));

    expect(response.quoteResponse.status).toBe('QUOTED');
    expect(response.underwritingAnalysis).toMatchObject({ lane: 'green', outcome: 'accept', triggerCount: 0 });
    expect(response.quoteResponse.primaryOption).toMatchObject({
      breakdown: { wildfireRisk: { tier: 'unclassified' } },
    });
  });

  it('refers properties with plot size of 5,000 sqm or more', async () => {
    const response = await runInCY(() => homeProductRuntimeConfig.buildQuoteResponse({
      ...baseQuote,
      property: {
        ...(baseQuote.property as UnknownRecord),
        landAreaSqm: 5_000,
      },
    }, { resolvedCoverageSet: null }));

    expect(response.quoteResponse.status).toBe('REFERRAL');
    const plotTrigger = analysisTriggers(response).find((trigger) => trigger.code === 'LARGE_PLOT_SIZE_REFERRAL');
    expect(plotTrigger).toMatchObject({
      lane: 'yellow',
      fields: ['property.landAreaSqm'],
    });
  });

  it('surfaces Home automatic pricing factors in underwriting analysis', async () => {
    const response = await runInCY(() => homeProductRuntimeConfig.buildQuoteResponse({
      ...baseQuote,
      property: {
        ...(baseQuote.property as UnknownRecord),
        woodenConstruction: true,
      },
    }, { resolvedCoverageSet: null }));

    expect(response.quoteResponse.status).toBe('REFERRAL');
    const pricingAdjustment = parseRecord(parseRecord(response.underwritingAnalysis).pricingAdjustment);
    expect(pricingAdjustment).toMatchObject({
      type: 'automatic',
      sources: expect.arrayContaining([expect.stringContaining('Combustible construction loading')]),
    });
  });

  it('surfaces red wildfire referral fields for BO question navigation', async () => {
    const response = await runInPT(() => homeProductRuntimeConfig.buildQuoteResponse({
      ...baseQuote,
      property: {
        ...(baseQuote.property as UnknownRecord),
        address: { line1: '1 Forest Road', city: 'Pedrogao Grande', country: 'Portugal', postcode: '3270-001' },
      },
    }, { resolvedCoverageSet: null }));

    expect(response.quoteResponse.status).toBe('REFERRAL');
    expect(response.underwritingAnalysis).toMatchObject({ lane: 'yellow', outcome: 'referral' });
    const wildfireTrigger = analysisTriggers(response).find((trigger) => trigger.code === 'WILDFIRE_RED_REFERRAL');
    expect(wildfireTrigger).toMatchObject({
      lane: 'yellow',
      fields: expect.arrayContaining(['property.address.country', 'property.address.city', 'property.address.postcode']),
    });
  });
});
