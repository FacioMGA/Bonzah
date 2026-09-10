import { describe, expect, it } from 'vitest';
import { calculateAutoInsurancePremium, calculateAutoInsuranceQuoteResponse } from '../../pricing/autoInsuranceCalculator.js';
import { MOTOR_UW_CONFIG_FIXTURE } from '../../../../test/fixtures/motor/underwriting.js';
import { evaluateMotorUwFixture as evaluateMotorUwAutomation } from '../../underwriting/__tests__/fixtureHelper.js';
import { MotorCompiledRatingEngine } from '../MotorCompiledRatingEngine.js';
import { MotorCompiledUwEngine } from '../MotorCompiledUwEngine.js';
import { registerAllProducts } from '../../../registerProducts.js';
import { motorGoldenFixtures } from '../../goldenFixtures.js';
import { fixtureRatingModelTables } from '../../../programDefinitionFixtures.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';
import { MOTOR_RATING_PIPELINE } from '../../pricing/programRatingModel.js';

registerAllProducts();

const quoteData = motorGoldenFixtures.minimumValid;
const ratingModel = {
  id: 'rating-model-v1',
  programId: 'motor-program',
  version: 1,
  binderProductAuthorityId: 'binder-authority-motor',
  stages: MOTOR_RATING_PIPELINE.map((operator) => ({ id: operator, operator })),
  tables: fixtureRatingModelTables('MOTOR')!,
};
const programmeDefinition = {
  id: 'definition-motor-v1',
  programId: 'motor-program',
  version: 1,
  pricingMode: 'AUTOMATED' as const,
  binderProductAuthorityId: 'binder-authority-motor',
  underwriting: MOTOR_UW_CONFIG_FIXTURE,
  coverage: {},
  questionnaire: {},
  workflow: {},
  channels: {},
  documents: {},
};
const cyTenant = getTenantFixtures().find((tenant) => tenant.countryCode === 'CY')!;
const runInCY = <T>(fn: () => T): T => runWithOperatingTenant(cyTenant, fn);

describe('Motor compiled engines', () => {
  it('matches the existing Motor premium calculator', async () => {
    const engine = new MotorCompiledRatingEngine();
    const direct = runInCY(() => calculateAutoInsurancePremium(quoteData as never, 250, [], ratingModel.tables)); // TODO(FAC-1069): owner=platform-eng expires=2026-10-05 deletionPR=#1069 type shared golden fixture per product
    const wrapped = await runInCY(() => engine.calculate({
      productType: 'MOTOR',
      quoteData,
      options: { overrideExcess: 250 },
      ratingModel,
    }));

    expect(wrapped.premiumCalculation.premium).toBe(direct.premium);
    expect(wrapped.trace?.calculatorVersion).toBe(direct.calculationDetails.calculatorVersion);
    expect(wrapped.trace?.ratingModel).toMatchObject({ pipeline: ratingModel.stages });
  });

  it('uses the persisted model tables rather than a deployed matrix', async () => {
    const engine = new MotorCompiledRatingEngine();
    const changedModel = structuredClone(ratingModel);
    changedModel.id = 'rating-model-v2';
    changedModel.version = 2;
    changedModel.tables.baseMatrix.values = changedModel.tables.baseMatrix.values
      .map((row) => row.map((value) => value * 2));

    const baseline = await runInCY(() => engine.calculate({
      productType: 'MOTOR',
      quoteData,
      ratingModel,
    }));
    const changed = await runInCY(() => engine.calculate({
      productType: 'MOTOR',
      quoteData,
      ratingModel: changedModel,
    }));

    expect(changed.premiumCalculation.premium).not.toBe(baseline.premiumCalculation.premium);
    expect(changed.trace?.ratingModel).toMatchObject({ id: 'rating-model-v2', version: 2 });
  });

  it('uses persisted factor bands rather than code-owned age loadings', async () => {
    const engine = new MotorCompiledRatingEngine();
    const changedModel = structuredClone(ratingModel);
    changedModel.id = 'rating-model-factor-v2';
    changedModel.version = 2;
    changedModel.tables.factors.proposerAge = changedModel.tables.factors.proposerAge
      .map((band) => ({ ...band, factor: 2 }));

    const baseline = await runInCY(() => engine.calculate({
      productType: 'MOTOR', quoteData, ratingModel,
    }));
    const changed = await runInCY(() => engine.calculate({
      productType: 'MOTOR', quoteData, ratingModel: changedModel,
    }));

    expect(changed.premiumCalculation.premium).not.toBe(baseline.premiumCalculation.premium);
    expect(changed.trace?.ratingModel).toMatchObject({ id: 'rating-model-factor-v2', version: 2 });
  });

  it('uses published classic-car rate tables rather than a runtime data file', async () => {
    const engine = new MotorCompiledRatingEngine();
    const classicRow = ratingModel.tables.classicRates.vehicleGroups.find((row) =>
      ['1', '2', '3', '4', '5'].includes(row.group),
    );
    expect(classicRow).toBeDefined();
    const classicQuote = {
      ...quoteData,
      vehicleType: 'Classic Car',
      make: classicRow!.make,
      model: classicRow!.model,
      year: classicRow!.fromYear || classicRow!.toYear,
      engineSize: classicRow!.engineCc,
      kmsPerYear: '1000',
    };
    const changedModel = structuredClone(ratingModel);
    changedModel.id = 'rating-model-classic-v2';
    changedModel.version = 2;
    changedModel.tables.classicRates.premiumByMileageBand['0-1500'] = Object.fromEntries(
      Object.entries(changedModel.tables.classicRates.premiumByMileageBand['0-1500'])
        .map(([group, premium]) => [group, premium * 2]),
    ) as typeof changedModel.tables.classicRates.premiumByMileageBand['0-1500'];

    const baseline = await runInCY(() => engine.calculate({
      productType: 'MOTOR', quoteData: classicQuote, ratingModel,
    }));
    const changed = await runInCY(() => engine.calculate({
      productType: 'MOTOR', quoteData: classicQuote, ratingModel: changedModel,
    }));

    expect(changed.premiumCalculation.premium).not.toBe(baseline.premiumCalculation.premium);
    expect(changed.trace?.ratingModel).toMatchObject({ id: 'rating-model-classic-v2', version: 2 });
  });

  it('matches the existing Motor UW automation', async () => {
    const engine = new MotorCompiledUwEngine();
    const direct = runInCY(() => evaluateMotorUwAutomation(quoteData as never)); // TODO(FAC-1069): owner=platform-eng expires=2026-10-05 deletionPR=#1069 type shared golden fixture per product
    const wrapped = await runInCY(() => engine.evaluate({
      productType: 'MOTOR',
      quoteData,
      context: { programDefinition: programmeDefinition },
    }));

    expect(wrapped.decision).toEqual(direct);
    expect(wrapped.analysis).toEqual(direct);
  });

  it('normalizes country aliases before evaluating the published UW component', async () => {
    const engine = new MotorCompiledUwEngine();
    const result = await runInCY(() => engine.evaluate({
      productType: 'MOTOR',
      quoteData: { ...quoteData, countryOfRegistration: 'CY' },
      context: { programDefinition: programmeDefinition },
    }));

    expect((result.decision as { outcome?: string }).outcome).not.toBe('decline');
  });

  it('uses the persisted UW configuration and rejects a missing one', () => {
    const engine = new MotorCompiledUwEngine();
    const configured = structuredClone(MOTOR_UW_CONFIG_FIXTURE);
    configured.referralFlags.referElectricVehicles = false;
    const quote = { ...quoteData, fuelType: 'Electric', electricPowerKw: 160 };

    const result = runInCY(() => engine.evaluate({
      productType: 'MOTOR',
      quoteData: quote,
      context: { programDefinition: { ...programmeDefinition, underwriting: configured } },
    }));

    expect((result.decision.triggers as Array<{ ruleId: string }>).some((trigger) => trigger.ruleId === 'YELLOW.EV_REFERRAL')).toBe(false);
    expect(() => runInCY(() => engine.evaluate({ productType: 'MOTOR', quoteData: quote })))
      .toThrow(/published programme definition/i);
  });

  it('matches the existing Motor quote response premium', async () => {
    const ratingEngine = new MotorCompiledRatingEngine();
    const uwDecision = runInCY(() => evaluateMotorUwAutomation(quoteData as never)); // TODO(FAC-1069): owner=platform-eng expires=2026-10-05 deletionPR=#1069 type shared golden fixture per product
    const direct = runInCY(() => calculateAutoInsuranceQuoteResponse(quoteData as never, 250, { reference: 'golden', uwDecision }, [], ratingModel.tables)); // TODO(FAC-1069): owner=platform-eng expires=2026-10-05 deletionPR=#1069 type shared golden fixture per product
    const wrapped = await runInCY(() => ratingEngine.buildQuoteResponse({
      productType: 'MOTOR',
      quoteData,
      options: { overrideExcess: 250 },
      ratingModel,
      uwDecision,
    }));

    expect(wrapped.quoteResponse.status).toBe(direct.status);
    expect((wrapped.quoteResponse.primaryOption as { annualPremium?: number }).annualPremium).toBe(direct.primaryOption.annualPremium);
  });

  it('fails closed when a quote response has no programme-derived UW decision', async () => {
    const ratingEngine = new MotorCompiledRatingEngine();
    await expect(runInCY(() => ratingEngine.buildQuoteResponse({
      productType: 'MOTOR',
      quoteData,
      ratingModel,
    }))).rejects.toThrow('requires an underwriting decision from the published programme definition');
  });

  it('rejects an incomplete programme model instead of using the deployed matrix', () => {
    const engine = new MotorCompiledRatingEngine();
    expect(() => runInCY(() => engine.calculate({
      productType: 'MOTOR',
      quoteData,
      ratingModel: {
        id: 'incomplete',
        programId: 'motor-program',
        version: 1,
        binderProductAuthorityId: 'binder-authority-motor',
        stages: MOTOR_RATING_PIPELINE.map((operator) => ({ id: operator, operator })),
        tables: {},
      },
    }))).toThrow(/rating model configuration is invalid/i);
  });

  it('rejects a classic model without its published classic-car rates', () => {
    const engine = new MotorCompiledRatingEngine();
    const incomplete = structuredClone(ratingModel);
    delete (incomplete.tables as { classicRates?: unknown }).classicRates;

    expect(() => runInCY(() => engine.calculate({
      productType: 'MOTOR', quoteData, ratingModel: incomplete,
    }))).toThrow(/rating model configuration is invalid/i);
  });

  it('rejects a display-only or reordered pipeline instead of treating it as a rate-model authority', () => {
    const engine = new MotorCompiledRatingEngine();
    const reordered = structuredClone(ratingModel);
    [reordered.stages[0], reordered.stages[1]] = [reordered.stages[1]!, reordered.stages[0]!];

    expect(() => runInCY(() => engine.calculate({
      productType: 'MOTOR', quoteData, ratingModel: reordered,
    }))).toThrow(/expected resolve-excess at pipeline position 1/i);
  });
});
