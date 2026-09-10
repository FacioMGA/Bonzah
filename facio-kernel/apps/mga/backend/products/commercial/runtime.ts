import { resolveCommercialPolicyPeriod } from './policyPeriod.js';
import { commercialManifest } from '@facio/products';
import type { ManifestProductRuntimeConfig } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import { defineProgrammeDefinitionEditor } from '../../modules/policy/domain/productRuntimeDefinition.js';
import type { ProductEngines } from '../../modules/policy/domain/productEngines.js';
import type { BuildQuoteResponseContext } from '../../modules/policy/domain/productContracts.js';
import type { PremiumCalculation } from '../../platform/types/index.js';
import { getTenantConfig } from '../../platform/tenant/tenantConfig.js';
import { calculateCommercial, commercialRiskSchema, commercialUnderwritingSchema, validateCommercialRatingModel } from './pricing.js';
import { commercialGoldenFixtures } from './goldenFixtures.js';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function price(quoteData: unknown, context?: BuildQuoteResponseContext) { return calculateCommercial(quoteData, context, getTenantConfig().currency); }
function calculation(result: ReturnType<typeof calculateCommercial>): PremiumCalculation {
  return { premium: result.premium, basis: 'HYBRID', calculationDetails: { calculatorVersion: 'commercial@1.0.0', steps: [
    ...result.outputs.map(({ coverage, output }, index) => ({ id: `coverage-${index}`, name: coverage, kind: 'subtotal' as const, inputs: { ...result.inputs[index], audit: output.breakdown?.auditTrail ?? [] }, output: output.selectedPremium! })),
    { id: 'total', name: 'Configured commercial premium', kind: 'total', output: result.premium, notes: 'Symphony source engine; programme-defined rates. No external payment or insurer acceptance implied.' },
  ] } };
}
function uw(result: ReturnType<typeof calculateCommercial>) {
  return { lane: result.underwriting.mode === 'referral' ? 'referral' : 'green', outcome: result.underwriting.mode === 'referral' ? 'referral' : 'accept', reasons: [{ code: 'PUBLISHED_PROGRAMME_DECISION', message: result.underwriting.reason }], triggers: [] };
}
async function buildQuoteResponse(quoteData: unknown, context?: BuildQuoteResponseContext) {
  const result = price(quoteData, context);
  const premium = calculation(result);
  const decision = uw(result);
  return { quoteResponse: { status: result.underwriting.mode === 'referral' ? 'REFERRAL' : 'QUOTED', currency: result.currency, primaryOption: { annualPremium: result.premium, netPremium: result.premium, calculationTrace: premium.calculationDetails, breakdown: { coveragePremiums: result.outputs }, costDetails: { subtotalNetPremium: result.premium } }, uwDecision: decision, commercialEvidence: { engine: 'symphony-commercial-v1', definitionId: result.definitionId, definitionVersion: result.definitionVersion, productName: result.productName, selections: result.inputs.map(({ coverage, limit, excess }) => ({ coverage, limit, excess })) } }, underwritingAnalysis: { decision } };
}
const engines: ProductEngines = {
  rating: { engineId: 'commercial.symphony.rating', kind: 'compiled', calculate(input) { return { premiumCalculation: calculation(price(input.quoteData, { ...input.context, ratingModel: input.ratingModel ?? input.context?.ratingModel })) }; }, buildQuoteResponse(input) { return buildQuoteResponse(input.quoteData, { ...input.context, ratingModel: input.ratingModel ?? input.context?.ratingModel }); }, validateProgramRatingModel: validateCommercialRatingModel, async calculateEndorsementPremium() { throw new Error('Commercial servicing requires explicit programme transaction and return-premium rules; no automatic repricing is authorized.'); } },
  underwriting: { engineId: 'commercial.configured.uw', kind: 'compiled', validateProgramUwConfig(config) { commercialUnderwritingSchema.parse(config); }, evaluate(input) { const result = price(input.quoteData, input.context); return { decision: uw(result), analysis: { reason: result.underwriting.reason } }; } },
  wording: { engineId: 'commercial.configured.wording', kind: 'compiled', getDocPackJobName() { return 'DOC.GENERATE_COMMERCIAL_DOC_PACK'; }, async render(args) { const { executeCommercialDocPackGeneration } = await import('./documents/generateCommercialDocPack.js'); return executeCommercialDocPackGeneration({ ...args, db: args.db as never }); } },
};
export const commercialProductRuntimeConfig: ManifestProductRuntimeConfig = {
  productType: 'COMMERCIAL', displayName: 'Commercial insurance', executionMode: 'runtime_config', manifest: commercialManifest, goldenFixtures: commercialGoldenFixtures,
  customerJourney: { pricingStep: 'commercial-risk', uwStep: 'commercial-risk', detailsStep: 'policy-holder' },
  intake: { publicSessionSlug: 'commercial', publicEntryPath: '/quote/commercial/new', firstStep: 'policy-holder', validationMode: 'manifest_only' },
  rating: { framework: 'unified-rating', mode: 'table_assets', source: 'program_model', assetRefs: [], traceSchemaVersion: 'v1' },
  programmeDefinitionEditor: defineProgrammeDefinitionEditor({ productType: 'COMMERCIAL', pricingModes: ['AUTOMATED'], ratingPipeline: [{ operator: 'symphony-commercial-v1', label: 'Published Symphony commercial configuration' }] }),
  resolvePolicyPeriod: resolveCommercialPolicyPeriod,
  engines, getDocPackJobName: engines.wording.getDocPackJobName,
  calculatePremium() { throw new Error('Commercial pricing requires the canonical selected programme rating context.'); }, buildQuoteResponse,
  validateBindRules(quoteData) { try { resolveCommercialPolicyPeriod(quoteData); } catch (error) { return { valid: false, errors: [{ field: 'policy', message: error instanceof Error ? error.message : 'Invalid policy period' }] }; } const result = commercialRiskSchema.safeParse(object(quoteData).commercial); return { valid: result.success, errors: result.success ? [] : result.error.issues.map((issue) => ({ field: `commercial.${issue.path.join('.')}`, message: issue.message })) }; },
  normalizeUwData(quoteData) { return { normalizedQuoteData: object(quoteData), productFields: { commercial: object(object(quoteData).commercial) } }; },
  buildVersionMeta(quoteData) { const risk = commercialRiskSchema.parse(object(quoteData).commercial); return { sectionLabel: 'Commercial', coverageLabel: risk.coverages.map((row) => row.coverage).join(', '), insuredValueDisplay: risk.coverages.map((row) => `${row.coverage}: ${row.limit}`).join('; '), bdxClassOfBusiness: 'COMMERCIAL' }; },
  getCustomerJourneyMeta() { return commercialProductRuntimeConfig.customerJourney; },
  buildVersionRows(args) { const currency = String(args.quoteResponse.currency || ''); if (!currency) throw new Error('Commercial version rows require recorded currency.'); return [{ section: args.versionMeta?.coverageLabel || 'Commercial', riskTransType: args.riskTransTypeLabel, limitText: args.versionMeta?.insuredValueDisplay || 'See retained schedule', excessText: commercialRiskSchema.parse(args.quoteData.commercial).coverages.map((row) => `${row.coverage}: ${row.excess}`).join('; '), premium: args.premiumDeltaTotal, currency }]; },
  generateDocPack: engines.wording.render,
  calculateEndorsementPremium: engines.rating.calculateEndorsementPremium,
};
