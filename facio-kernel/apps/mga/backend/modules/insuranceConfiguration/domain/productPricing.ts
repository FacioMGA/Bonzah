import { z } from 'zod';

/** Symphony client.ts CoverageCalculation, SourceTargetBlock and ProductLine.
 * This is an import/authoring contract, not a replacement for a registered rating engine. */
const text = z.string().max(500);
const money = z.number().finite().nonnegative();
const timing = z.enum(['before-min-premium', 'after-base-premium', 'after-all-rules']);
export const sourceTargetSchema = z.object({
  sourceType: z.enum(['questionnaire', 'coverage', 'premium-component', 'external-table', 'clause', 'annual-turnover', 'questionnaire-question', 'constant-value']).optional(),
  calculationCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  sourceObject: text.optional(), sourceCoverage: text.optional(),
  applyTo: z.enum(['base-premium', 'final-coverage-premium', 'final-product-line-premium', 'risk-code-table']).optional(),
  operation: z.enum(['multiply', 'add', 'set', 'subtract']).optional(), applyTiming: timing.optional(),
}).strict();
const basePremiumMatrix = z.array(z.object({ coverage: text, version: text, rows: z.array(z.object({ riskCode: text, turnoverRange: text, rate: text }).strict()).max(10000) }).strict()).max(100);
const ilfSumMatrix = z.array(z.object({ coverageLimit: text, factor: text.optional(), factorsByCoverage: z.record(z.string(), text).optional() }).strict().refine((row) => row.factor !== undefined || Boolean(row.factorsByCoverage && Object.keys(row.factorsByCoverage).length), 'A limit factor or per-coverage factors are required.')).max(1000);
const ilfExcessMatrix = z.array(z.object({ deductible: text, factor: text }).strict()).max(1000);
export const coverageCalculationSchema = z.object({
  basePremiumMatrix: basePremiumMatrix.optional(), ilfSumMatrix: ilfSumMatrix.optional(), ilfExcessMatrix: ilfExcessMatrix.optional(),
  minimumPremiumFloor: money.optional(), enforceMinimumPremium: z.boolean().optional(), defaultGlobalAggregate: money.optional(), defaultExcess: money.optional(),
  riskCodeDiscounts: z.array(z.object({ riskCode: text, factor: text, floor: text.optional() }).strict()).max(1000).optional(),
  bundleMinimumPremium: money.optional(),
  riskCodeTable: z.array(z.object({ code: text, description: text.optional(), baseRate: text, minimumPremium: text.optional() }).strict()).max(10000).optional(),
  turnoverBands: z.array(z.object({ from: text, to: text, multiplier: text }).strict()).max(1000).optional(),
  sourceConfig: z.object({ basePremiumMatrix: sourceTargetSchema.optional(), turnoverBands: sourceTargetSchema.optional(), ilfSum: sourceTargetSchema.optional(), ilfExcess: sourceTargetSchema.optional(), loadingsExtensions: sourceTargetSchema.optional() }).strict().optional(),
  isStandalone: z.boolean().optional(), requiresBaseCoverage: text.optional(),
  loadingsExtensions: z.array(z.object({ id: text, name: text, factor: text, appliedAlways: z.boolean(), questionnaireKey: text.optional(), applyTiming: timing }).strict()).max(500).optional(),
}).strict();
export const productLineSchema = z.object({
  id: text, name: text, triggerSegmentId: text, linkedCoverages: z.array(text).max(100), isStandalone: z.boolean(), requiresBaseCoverage: text.optional(), templateId: text.optional(),
  basePremiumTable: z.array(z.object({ quantityFrom: text, quantityTo: text, fullPremium: text.optional(), perUnit: text.optional() }).strict()).max(1000),
  loadings: z.array(z.object({
    id: text, label: text, questionKey: text.optional(), clauseExtension: text.optional(),
    sourceType: sourceTargetSchema.shape.sourceType, sourceObject: text.optional(), applyTo: sourceTargetSchema.shape.applyTo,
    operation: z.enum(['add-pct', 'multiply', 'add', 'subtract', 'set']).optional(), appliesTo: z.array(text).max(100).optional(),
    factor: text, appliedAlways: z.boolean(), applyTiming: timing,
  }).strict()).max(500),
  minimumPremium: z.array(z.object({ id: text, type: z.enum(['Per Occurrence', 'Annual Aggregate']), perCoverage: z.record(z.string(), money), currency: z.enum(['USD', 'GBP', 'EUR', 'ILS']) }).strict()).max(100),
  sourceConfig: z.object({ basePremium: sourceTargetSchema.optional(), loadings: sourceTargetSchema.optional(), minimum: sourceTargetSchema.optional() }).strict().optional(),
  status: z.enum(['Draft', 'Ready']),
}).strict();
export const productPricingFields = {
  pricingReady: z.boolean().optional(), calculationProgramId: text.optional(),
  primaryCoverage: z.object({ kind: text, customLabel: text.optional() }).strict().optional(),
  allowOtherCoveragesStandalone: z.boolean().optional(), defaultGlobalAggregate: money.optional(), defaultExcess: money.optional(), enforceMinimumPremium: z.boolean().optional(),
  basePremiumMatrix: basePremiumMatrix.optional(), ilfSumMatrix: ilfSumMatrix.optional(), ilfExcessMatrix: ilfExcessMatrix.optional(),
  calculationsByCoverage: z.record(z.string(), coverageCalculationSchema).optional(),
  bundleMinimum: z.object({ amount: money, splitRule: text }).strict().optional(),
  selectedPremiumRule: z.object({ mode: z.enum(['max-minimum-calculated', 'custom']), expression: text.optional() }).strict().optional(),
  pricingTemplates: z.array(z.object({ id: text, name: text, createdAt: text, sourceCoverage: text.optional(), payload: coverageCalculationSchema }).strict()).max(100).optional(),
  productLines: z.array(productLineSchema).max(100).optional(),
  productLineTemplates: z.array(z.object({ id: text, name: text, createdAt: text, payload: productLineSchema.omit({ id: true, name: true, status: true }) }).strict()).max(100).optional(),
  selectedPremiumLogic: text.optional(), finalTPPremium: text.optional(),
};
