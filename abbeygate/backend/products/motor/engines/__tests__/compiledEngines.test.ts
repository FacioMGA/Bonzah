import { describe, expect, it } from 'vitest';
import { calculateAutoInsurancePremium, calculateAutoInsuranceQuoteResponse } from '../../pricing/autoInsuranceCalculator.js';
import { evaluateMotorUwAutomation } from '../../underwriting/motorUwAutomation.js';
import { MotorCompiledRatingEngine } from '../MotorCompiledRatingEngine.js';
import { MotorCompiledUwEngine } from '../MotorCompiledUwEngine.js';
import { registerAllProducts } from '../../../registerProducts.js';
import { motorGoldenFixtures } from '../../goldenFixtures.js';

registerAllProducts();

const quoteData = motorGoldenFixtures.minimumValid;

describe('Motor compiled engines', () => {
  it('matches the existing Motor premium calculator', async () => {
    const engine = new MotorCompiledRatingEngine();
    const direct = calculateAutoInsurancePremium(quoteData as never, 250);
    const wrapped = await engine.calculate({
      productType: 'MOTOR',
      quoteData,
      options: { overrideExcess: 250 },
    });

    expect(wrapped.premiumCalculation.premium).toBe(direct.premium);
    expect(wrapped.trace?.calculatorVersion).toBe(direct.calculationDetails.calculatorVersion);
  });

  it('matches the existing Motor UW automation', async () => {
    const engine = new MotorCompiledUwEngine();
    const direct = evaluateMotorUwAutomation(quoteData as never);
    const wrapped = await engine.evaluate({ productType: 'MOTOR', quoteData });

    expect(wrapped.decision).toEqual(direct);
    expect(wrapped.analysis).toEqual(direct);
  });

  it('matches the existing Motor quote response premium', async () => {
    const ratingEngine = new MotorCompiledRatingEngine();
    const uwDecision = evaluateMotorUwAutomation(quoteData as never);
    const direct = calculateAutoInsuranceQuoteResponse(quoteData as never, 250, { reference: 'golden', uwDecision });
    const wrapped = await ratingEngine.buildQuoteResponse({
      productType: 'MOTOR',
      quoteData,
      options: { overrideExcess: 250 },
      uwDecision,
    });

    expect(wrapped.quoteResponse.status).toBe(direct.status);
    expect((wrapped.quoteResponse.primaryOption as { annualPremium?: number }).annualPremium).toBe(direct.primaryOption.annualPremium);
  });
});
