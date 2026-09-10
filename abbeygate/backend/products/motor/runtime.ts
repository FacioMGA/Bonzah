import type { ProductRuntimeDefinition } from '../../modules/policy/domain/productRuntimeDefinition.js';
import { motorManifest } from '@facio/products';
import { motorDefaultClaimsContract } from './claims/defaultClaimsContract.js';
import { MotorCompiledRatingEngine } from './engines/MotorCompiledRatingEngine.js';
import { MotorCompiledUwEngine } from './engines/MotorCompiledUwEngine.js';
import { MotorCompiledWordingEngine } from './engines/MotorCompiledWordingEngine.js';
import { buildMotorVersionRows } from './versionRows.js';
import { resolveProductEngines } from '../../modules/policy/domain/productEngines.js';
import { motorGoldenFixtures } from './goldenFixtures.js';
import { MOTOR_REQUIRED_ISSUED_DOC_TYPES } from './documents/documentPackContract.js';

export const motorRatingEngine = new MotorCompiledRatingEngine();
export const motorUwEngine = new MotorCompiledUwEngine();
export const motorWordingEngine = new MotorCompiledWordingEngine();

export const motorProductRuntimeDefinition: ProductRuntimeDefinition = {
  productType: 'MOTOR',
  displayName: 'Motor Insurance',
  executionMode: 'plugin',
  manifest: motorManifest,
  defaultClaimsContract: motorDefaultClaimsContract,
  requiredIssuedDocTypes: MOTOR_REQUIRED_ISSUED_DOC_TYPES,
  goldenFixtures: motorGoldenFixtures,
  customerJourney: { pricingStep: 'your-quote', uwStep: 'driving-history', detailsStep: 'your-details' },
  intake: {
    publicSessionSlug: 'motor',
    publicEntryPath: '/quote/motor/new',
    firstStep: 'policy-holder',
    validationMode: 'product_schema',
  },
  rating: {
    framework: 'unified-rating',
    mode: 'plugin',
    pluginKey: 'motor-rating-plugin',
    assetRefs: [
      'backend/products/motor/pricing/autoInsuranceCalculator.ts',
      'backend/products/motor/pricing/data/abbeygate-auto-cyprus-2022.json',
      'backend/products/motor/pricing/data/abbeygate-auto-cyprus-2022.schema.ts',
      'backend/products/motor/pricing/data/loader.ts',
    ],
    traceSchemaVersion: 'v1',
  },
  engines: {
    rating: motorRatingEngine,
    underwriting: motorUwEngine,
    wording: motorWordingEngine,
  },
  getDocPackJobName() {
    return resolveProductEngines(motorProductRuntimeDefinition.engines).wording.getDocPackJobName();
  },
  calculatePremium(data, options) {
    const result = resolveProductEngines(motorProductRuntimeDefinition.engines).rating.calculate({
      productType: motorProductRuntimeDefinition.productType,
      quoteData: data,
      options,
    });
    if (result instanceof Promise) throw new Error('Motor rating engine returned async result for calculatePremium');
    return result.premiumCalculation;
  },
  async buildQuoteResponse(quoteData, programMeta, context) {
    const engines = resolveProductEngines(motorProductRuntimeDefinition.engines);
    const uwResult = await engines.underwriting.evaluate({
      productType: motorProductRuntimeDefinition.productType,
      quoteData,
      programMeta,
    });
    const ratingResult = await engines.rating.buildQuoteResponse({
      productType: motorProductRuntimeDefinition.productType,
      quoteData,
      programMeta,
      context,
      uwDecision: uwResult.decision,
    });
    return {
      ...ratingResult,
      underwritingAnalysis: uwResult.analysis || uwResult.decision,
    };
  },
  validateBindRules(quoteData, binderConfig) {
    const qd = (quoteData && typeof quoteData === 'object') ? quoteData as Record<string, unknown> : {};
    const config = (binderConfig && typeof binderConfig === 'object') ? binderConfig as Record<string, unknown> : {};
    const errors: Array<{ field: string; message: string }> = [];
    const authority = (config.authority && typeof config.authority === 'object') ? config.authority as Record<string, unknown> : {};
    const scope = (config.scope && typeof config.scope === 'object') ? config.scope as Record<string, unknown> : {};
    const vehicleValue = Number(qd.vehicleValue || 0);
    const maxInsuredValue = Number(authority.maxInsuredValue || 0);
    if (maxInsuredValue > 0 && vehicleValue > maxInsuredValue) {
      errors.push({ field: 'vehicleValue', message: `Vehicle value €${vehicleValue.toLocaleString()} exceeds coverholder authority of €${maxInsuredValue.toLocaleString()}` });
    }
    const country = String(qd.countryOfRegistration || qd.vehicleLocation || '').trim();
    const allowedTerritories = Array.isArray(scope.riskLocationCountries) ? scope.riskLocationCountries.map((c: unknown) => String(c).trim()) : [];
    if (country && allowedTerritories.length > 0 && !allowedTerritories.includes(country)) {
      errors.push({ field: 'countryOfRegistration', message: `Territory '${country}' is not within binder scope` });
    }
    return { valid: errors.length === 0, errors };
  },
  normalizeUwData(quoteData) {
    const qd = (quoteData && typeof quoteData === 'object') ? { ...quoteData as Record<string, unknown> } : {};
    const vehicleType = String(qd.vehicleType || '').toLowerCase();
    if ((vehicleType.includes('motorbike') || vehicleType.includes('motorcycle')) && qd.motorcycleRidersNamed !== true) {
      qd.motorcycleRidersNamed = true;
    }
    const productFields: Record<string, unknown> = {};
    const vehicleFields = ['make', 'model', 'year', 'fuelType', 'engineSize', 'vehicleValue', 'registrationNumber', 'vin', 'countryOfRegistration', 'vehicleType', 'coverRequired'];
    const vehicleInfo: Record<string, unknown> = {};
    for (const f of vehicleFields) { if (qd[f] !== undefined) vehicleInfo[f] = qd[f]; }
    if (Object.keys(vehicleInfo).length > 0) productFields.vehicleInfo = vehicleInfo;
    const driverFields = ['dateOfBirth', 'licenseYears', 'licenseType', 'licenseIssuedIn', 'hasAdditionalDrivers', 'additionalDrivers'];
    const driverInfo: Record<string, unknown> = {};
    for (const f of driverFields) { if (qd[f] !== undefined) driverInfo[f] = qd[f]; }
    if (Object.keys(driverInfo).length > 0) productFields.driverInfo = driverInfo;
    return { normalizedQuoteData: qd, productFields };
  },
  buildVersionMeta(quoteData) {
    const qd = (quoteData && typeof quoteData === 'object') ? quoteData as Record<string, unknown> : {};
    const coverRequired = String(qd.coverRequired || 'Third Party Liability');
    const vehicleValue = Number(qd.vehicleValue || 0);
    return {
      sectionLabel: 'Motor',
      coverageLabel: coverRequired,
      insuredValueDisplay: vehicleValue > 0 ? `€${vehicleValue.toLocaleString()}` : '—',
      bdxClassOfBusiness: 'MOTOR',
    };
  },
  getCustomerJourneyMeta() {
    return motorProductRuntimeDefinition.customerJourney;
  },
  buildVersionRows(args) {
    return buildMotorVersionRows(args);
  },
  async generateDocPack(args) {
    return resolveProductEngines(motorProductRuntimeDefinition.engines).wording.render(args);
  },
  async getRatingMatrixSnapshot() {
    return resolveProductEngines(motorProductRuntimeDefinition.engines).rating.getRatingMatrixSnapshot();
  },
  async calculateEndorsementPremium(quoteData, appliedEndorsements) {
    return resolveProductEngines(motorProductRuntimeDefinition.engines).rating.calculateEndorsementPremium(quoteData, appliedEndorsements);
  },
};
