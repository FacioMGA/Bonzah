import { resolveCommercialPolicyPeriod } from './policyPeriod.js';
import './pricing/segmentCalculation.js';
import { z } from 'zod';
import { calculateQuote } from './pricing/quote.js';
import { parseAmount, parseFactor } from './pricing/primitives.js';
import type { BinderDetailsLike, CalcInput } from './pricing/types.js';
import type { SymphonyProductConfiguration } from '../../modules/insuranceConfiguration/domain/productConfiguration.js';
import { readInsuranceConfiguration, assertConfiguredJourneyCapability } from '../../modules/insuranceConfiguration/domain/runtimeConfiguration.js';
import { assertConfiguredQuestions, configuredPricingAnswers } from '../../modules/insuranceConfiguration/domain/questionnaireEvaluation.js';
import type { BuildQuoteResponseContext } from '../../modules/policy/domain/productContracts.js';
import { configuredCommercialSegments } from '@facio/products';

const amount = z.number().finite().nonnegative().max(1e12);
export const commercialRiskSchema = z.object({
  turnover: amount, segmentId: z.string().min(1).max(500).optional(), quantity: amount.positive().optional(),
  coverages: z.array(z.object({ coverage: z.string().min(1).max(500), limit: amount, excess: amount }).strict()).min(1).max(100),
}).strict().superRefine((value, ctx) => { if (new Set(value.coverages.map((coverage) => coverage.coverage)).size !== value.coverages.length) ctx.addIssue({ code: 'custom', path: ['coverages'], message: 'A coverage may be selected only once.' }); });
export const commercialUnderwritingSchema = z.object({ schemaVersion: z.literal(1), mode: z.enum(['automatic_acceptance', 'referral']), reason: z.string().min(1).max(2000) }).strict();
const ratingTablesSchema = z.object({ schemaVersion: z.literal(1), engine: z.literal('symphony-commercial-v1'), configurationSource: z.literal('programme_definition') }).strict();
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function validateCommercialRatingModel(value: unknown): void {
  const model = object(value); ratingTablesSchema.parse(model.tables);
  const stages = z.array(z.object({ id: z.string().min(1), operator: z.literal('symphony-commercial-v1') }).strict()).length(1).parse(model.stages);
  if (!stages.length) throw new Error('Commercial rating requires an explicitly selected engine.');
}
const coverageName = (section: SymphonyProductConfiguration['coverageSections'][number]) => section.coverageName || section.classOfBusinessLabel || section.classOfBusinessKey;
export function validateCommercialConfiguration(product: SymphonyProductConfiguration): string[] {
  const issues: string[] = [];
  if (product.details.pricingReady === false) issues.push('The product pricing configuration is explicitly marked not ready.');
  for (const key of ['calculationProgramId', 'basePremiumMatrix', 'ilfSumMatrix', 'ilfExcessMatrix', 'defaultGlobalAggregate', 'defaultExcess', 'enforceMinimumPremium'] as const) { const value = product.details[key]; if (value !== undefined && value !== '' && (!Array.isArray(value) || value.length)) issues.push(`Product details.${key}: this engine uses explicit per-coverage calculations; this top-level instruction has no registered execution mapping.`); }
  const labels = product.coverageSections.map(coverageName);
  if (!labels.length || labels.some((label) => !label.trim()) || new Set(labels).size !== labels.length) issues.push('Commercial coverage sections require distinct, nonempty coverage identities.');
  for (const section of product.coverageSections) {
    if ([parseAmount(section.maxLimit), parseAmount(section.deductible)].some((value) => value === null || value < 0 || value > 1e12)) issues.push(`Coverage ${coverageName(section)} requires a numeric maximum limit and deductible in the programme currency.`);
  }
  if (!product.details.primaryCoverage || !labels.includes(product.details.primaryCoverage.kind)) issues.push('Select a primary coverage from the configured sections.');
  for (const [label, calculation] of Object.entries(product.details.calculationsByCoverage ?? {})) {
    if (!labels.includes(label) && label !== '__all__') issues.push(`Calculation ${label} is not a configured coverage.`);
    if (calculation.requiresBaseCoverage && !labels.includes(calculation.requiresBaseCoverage)) issues.push(`Calculation ${label} references an unknown base coverage.`);
    for (const key of ['defaultGlobalAggregate', 'defaultExcess', 'bundleMinimumPremium'] as const) if (calculation[key] !== undefined) issues.push(`Calculation ${label}.${key} has no registered execution mapping; explicit selected coverage terms and the product bundle minimum remain authoritative.`);
    if (calculation.sourceConfig?.loadingsExtensions) issues.push(`Calculation ${label}: loading source/target blocks are not executed; use the explicit loading rows.`);
    for (const [card, source] of Object.entries(calculation.sourceConfig ?? {})) {
      if (source?.applyTo) issues.push(`Calculation ${label}.${card}: output-target routing is not executed by this engine.`);
      if (card !== 'basePremiumMatrix' && card !== 'ilfSum' && (source?.sourceType || source?.sourceObject || source?.sourceCoverage || source?.calculationCurrency)) issues.push(`Calculation ${label}.${card}: the configured matrix supplies this factor; custom input-source routing is not registered.`);
      if (card === 'basePremiumMatrix' && source && (!source.operation || source.operation === 'multiply') && source.sourceType && !(source.sourceType === 'coverage' && source.sourceObject?.toLowerCase() === 'premium') && source.sourceType !== 'annual-turnover') issues.push(`Calculation ${label}: this base source requires an explicit supported source operation; implicit multiplication of an alternate source is not executed.`);
      if (card === 'basePremiumMatrix' && source?.applyTiming && source.applyTiming !== 'after-base-premium') issues.push(`Calculation ${label}: base-source operations currently execute after base premium only.`);
    }
    for (const loading of calculation.loadingsExtensions ?? []) if (parseFactor(loading.factor) === null) issues.push(`Calculation ${label}, loading ${loading.name} requires a valid factor.`);
    for (const row of calculation.riskCodeTable ?? []) if (row.minimumPremium !== undefined && parseAmount(row.minimumPremium) === null) issues.push(`Calculation ${label}, risk ${row.code} requires a valid minimum premium.`);
    for (const source of Object.values(calculation.sourceConfig ?? {})) if (source?.applyTo === 'risk-code-table') issues.push(`Calculation ${label}: the source engine does not implement risk-code-table output mutation.`);
  }
  for (const line of product.details.productLines ?? []) {
    if (line.status === 'Ready' && (!line.triggerSegmentId.trim() || line.triggerSegmentId !== line.triggerSegmentId.trim())) issues.push(`Product line ${line.name}: a Ready line requires an explicit canonical trigger segment ID without surrounding whitespace.`);
    if (line.linkedCoverages.some((label) => !labels.includes(label))) issues.push(`Product line ${line.name} references an unknown coverage.`);
    if (Object.keys(line.sourceConfig ?? {}).length) issues.push(`Product line ${line.name}: source/target routing is not executed by the imported product-line engine. Use explicit quantity bands and questionnaire loadings.`);
    for (const loading of line.loadings) {
      if ((loading.operation && loading.operation !== 'multiply') || loading.sourceType || loading.sourceObject || loading.applyTo || loading.appliesTo?.length || loading.clauseExtension) issues.push(`Product line ${line.name}, loading ${loading.label}: this engine executes multiplicative questionnaire/always loadings only; the additional source/target instruction must not be silently ignored.`);
      if (parseFactor(loading.factor) === null) issues.push(`Product line ${line.name}, loading ${loading.label} requires a valid factor.`);
    }
    for (const minimum of line.minimumPremium) if (minimum.type !== 'Per Occurrence') issues.push(`Product line ${line.name}: annual aggregate minimum semantics are not registered for this engine.`);
  }
  if (product.details.bundleMinimum && product.details.bundleMinimum.splitRule !== 'proportional') issues.push('The source engine currently supports proportional bundle minimum allocation only.');
  if (product.details.selectedPremiumRule?.mode === 'custom' || product.details.selectedPremiumLogic || product.details.finalTPPremium) issues.push('Arbitrary selected-premium expressions are not executable. Use the source engine’s explicit minimum/calculated strategy.');
  if (!Object.keys(product.details.calculationsByCoverage ?? {}).length && !product.details.productLines?.length && !product.details.professions?.some((profession) => profession.segmentCalculation)) issues.push('Configure actual coverage rates, product-line rates or an explicit profession calculation.');
  return issues;
}

export function calculateCommercial(quoteData: unknown, context: BuildQuoteResponseContext | undefined, currency: string) {
  if (!['EUR', 'GBP', 'USD', 'ILS', 'CAD'].includes(currency)) throw new Error('Commercial source engine currently supports explicit two-decimal currencies only.');
  resolveCommercialPolicyPeriod(quoteData);
  const definition = context?.programDefinition;
  if (!definition || definition.pricingMode !== 'AUTOMATED') throw new Error('Commercial pricing requires an automated published programme definition.');
  validateCommercialRatingModel(context?.ratingModel);
  const configuration = readInsuranceConfiguration(definition.workflow);
  if (!configuration) throw new Error('Commercial pricing requires its explicit source product configuration.');
  const issues = validateCommercialConfiguration(configuration.product);
  if (issues.length) throw new Error(issues.join(' '));
  assertConfiguredJourneyCapability(definition.workflow, 'operator', 'quote');
  assertConfiguredQuestions(definition.workflow, quoteData, definition);
  const risk = commercialRiskSchema.parse(object(quoteData).commercial);
  const product = configuration.product;
  for (const line of product.details.productLines ?? []) for (const minimum of line.minimumPremium) if (minimum.currency !== currency) throw new Error(`Product line ${line.name} minimum currency ${minimum.currency} differs from programme ${currency}; no currency conversion is registered.`);
  const sections = new Map(product.coverageSections.map((section) => [coverageName(section), section]));
  const professions = product.details.professions ?? [];
  const profession = professions.find((row) => (row.segmentId || row.profession) === risk.segmentId);
  const segments = configuredCommercialSegments(product);
  if (segments.length && !segments.some((segment) => segment.id === risk.segmentId)) throw new Error('Select an explicitly configured profession/segment.');
  const primary = product.details.primaryCoverage!.kind;
  const answers = configuredPricingAnswers(definition.workflow, quoteData, definition);
  const inputs: CalcInput[] = risk.coverages.map((selected) => {
    const section = sections.get(selected.coverage);
    if (!section) throw new Error(`Coverage ${selected.coverage} is not authorized by this published product.`);
    const maximum = parseAmount(section.maxLimit)!;
    const minimumExcess = parseAmount(section.deductible)!;
    if (selected.limit > maximum || selected.excess < minimumExcess || selected.excess > selected.limit) throw new Error(`Coverage ${selected.coverage} exceeds its maximum limit or violates the configured deductible.`);
    return { coverage: selected.coverage, riskCode: profession?.riskCodesByCoverage[selected.coverage] || null, turnover: risk.turnover, limit: selected.limit, excess: selected.excess, isPrimary: selected.coverage === primary, bundleCoverages: risk.coverages.filter((row) => row.coverage !== selected.coverage).map((row) => row.coverage), answers, segmentId: risk.segmentId, quantity: risk.quantity };
  });
  const details = { ...product.details, professions: profession ? [profession] : [], currency } as unknown as BinderDetailsLike;
  const outputs = calculateQuote(inputs, details);
  if (outputs.some((row) => row.output.reason !== 'ok' || row.output.selectedPremium === null || !Number.isFinite(row.output.selectedPremium) || row.output.selectedPremium < 0)) throw new Error(`Commercial rating did not resolve: ${outputs.filter((row) => row.output.reason !== 'ok').map((row) => `${row.coverage}: ${row.output.reason}`).join(', ')}`);
  const premium = Math.round(outputs.reduce((sum, row) => sum + row.output.selectedPremium!, 0) * 100) / 100;
  if (!Number.isFinite(premium) || premium <= 0 || premium > 1e12) throw new Error('Commercial premium must be positive and within the supported bound.');
  const underwriting = commercialUnderwritingSchema.parse(definition.underwriting);
  return { premium, currency, outputs, inputs, underwriting, productName: product.name, definitionId: definition.id, definitionVersion: definition.version };
}
