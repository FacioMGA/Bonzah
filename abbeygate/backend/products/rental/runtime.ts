import { rentalManifest, type RentalQuoteRequest } from '@facio/products';
import type { PremiumCalculation } from '../../platform/types/index.js';
import type { ManifestProductRuntimeConfig } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import type { ProductEngines } from '../../modules/policy/domain/productEngines.js';
import { calculateRentalRating, RentalRatingError } from './pricing/calculator.js';
import { BONZAH_DEMO_RULES } from './pricing/demoConfig.js';
import { rentalDefaultClaimsContract } from './claims/defaultClaimsContract.js';
import { rentalGoldenFixtures } from './goldenFixtures.js';

function asRequest(value: unknown): RentalQuoteRequest {
  return value as RentalQuoteRequest;
}

function premiumCalculation(value: unknown): PremiumCalculation {
  const result = calculateRentalRating(asRequest(value));
  return {
    premium: result.total,
    basis: 'HYBRID',
    calculationDetails: {
      fixedAmount: result.total,
      daysActive: result.chargedPeriods,
      calculatorVersion: BONZAH_DEMO_RULES.version,
      steps: [{ id: 'rental-demo-total', name: 'Canonical Bonzah demo total', kind: 'total', output: result.total }],
    },
  };
}

const engines: ProductEngines = {
  rating: {
    engineId: 'rental.compiled.demo-rating', kind: 'compiled',
    calculate(input) { return { premiumCalculation: premiumCalculation(input.quoteData) }; },
    async buildQuoteResponse(input) {
      const rating = calculateRentalRating(asRequest(input.quoteData));
      return { quoteResponse: { ...rating, ruleVersion: BONZAH_DEMO_RULES.version, effectiveDate: BONZAH_DEMO_RULES.effectiveDate }, underwritingAnalysis: { status: rating.status, ruleReferences: rating.internalRuleReferences } };
    },
    async getRatingMatrixSnapshot() { return { source: 'effective-dated demo configuration', ...BONZAH_DEMO_RULES }; },
    async calculateEndorsementPremium(quoteData) { return { premium: premiumCalculation(quoteData).premium, policyExcess: 0 }; },
  },
  underwriting: {
    engineId: 'rental.compiled.demo-eligibility', kind: 'compiled',
    evaluate(input) { const rating = calculateRentalRating(asRequest(input.quoteData)); return { decision: { status: rating.status, reasons: rating.internalRuleReferences } }; },
  },
  wording: {
    engineId: 'rental.demo.wording', kind: 'template',
    getDocPackJobName() { return 'DOC.GENERATE_RENTAL_DEMO_PACK'; },
    async render() { return { version: 1, documents: [] }; },
  },
};

export const rentalProductRuntimeConfig: ManifestProductRuntimeConfig = {
  productType: 'RENTAL', displayName: 'Rental Vehicle Protection', executionMode: 'runtime_config',
  manifest: rentalManifest, defaultClaimsContract: rentalDefaultClaimsContract, requiredIssuedDocTypes: [],
  goldenFixtures: rentalGoldenFixtures,
  customerJourney: { pricingStep: 'protection', uwStep: 'vehicle', detailsStep: 'rental-search' },
  intake: { publicSessionSlug: 'rental', publicEntryPath: '/summit-rentals', firstStep: 'rental-search', validationMode: 'manifest_only' },
  rating: { framework: 'unified-rating', mode: 'table_assets', assetRefs: ['backend/products/rental/pricing/demoConfig.ts'], traceSchemaVersion: 'v1' },
  engines,
  getDocPackJobName: () => engines.wording.getDocPackJobName(),
  calculatePremium: premiumCalculation,
  async buildQuoteResponse(quoteData) { return engines.rating.buildQuoteResponse({ productType: 'RENTAL', quoteData }); },
  validateBindRules(quoteData) {
    try { calculateRentalRating(asRequest(quoteData)); return { valid: true, errors: [] }; }
    catch (error) { return { valid: false, errors: [{ field: 'quoteData', message: error instanceof RentalRatingError ? error.message : 'Rental quote is invalid' }] }; }
  },
  normalizeUwData(quoteData) { const request = asRequest(quoteData); return { normalizedQuoteData: request as unknown as Record<string, unknown>, productFields: { risk: request.risk, coverages: request.coverages } }; },
  buildVersionMeta(quoteData) { const request = asRequest(quoteData); return { sectionLabel: 'Rental protection', coverageLabel: request.coverages.join(', '), insuredValueDisplay: `$${request.risk.vehicle.declaredValue.toLocaleString()}`, bdxClassOfBusiness: 'RENTAL' }; },
  buildVersionRows(args) { return [{ section: 'Rental protection', riskTransType: args.riskTransTypeLabel, limitText: 'As quoted', excessText: 'See coverage', premium: args.premiumDeltaTotal, currency: 'USD' }]; },
  getCustomerJourneyMeta() { return rentalProductRuntimeConfig.customerJourney; },
  async generateDocPack() { return { version: 1, documents: [] }; },
  async getRatingMatrixSnapshot() { return engines.rating.getRatingMatrixSnapshot(); },
  async calculateEndorsementPremium(quoteData) { return engines.rating.calculateEndorsementPremium(quoteData, []); },
};
