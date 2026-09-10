import type {
  BindRulesResult,
  BuildQuoteResponseContext,
  BuildVersionRowsArgs,
  CustomerJourneyMeta,
  DocPackGenerationArgs,
  DocPackGenerationResult,
  EndorsementPremiumResult,
  QuoteResponseResult,
  UwNormalizationResult,
  VersionMeta,
  VersionRow,
} from '../../modules/policy/domain/productContracts.js';
import type { PremiumCalculation } from '../../platform/types/index.js';
import type { ManifestProductRuntimeConfig } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import { defineProgrammeDefinitionEditor } from '../../modules/policy/domain/productRuntimeDefinition.js';
import type { ProductEngines, UwEngineResult } from '../../modules/policy/domain/productEngines.js';
import { resolveProductEngines } from '../../modules/policy/domain/productEngines.js';
import { healthManifest } from '@facio/products';
import { calculateHealthPremium, type HealthQuoteData } from './pricing/healthCalculator.js';
import { parseHealthProgramRatingModel } from './pricing/programRatingModel.js';
import { toHealthPricingQuoteData } from './quoteDataAuthority.js';
import {
  evaluateHealthUw,
  parseHealthUwConfig,
  type HealthUwConfig,
  type HealthUwDecision,
} from './underwriting/healthUwAutomation.js';
import { healthGoldenFixtures } from './goldenFixtures.js';
import type { Prisma } from '@prisma/client';

// Local "any non-shaped JSON object" alias used at the canonical/wire
// boundary where the input shape is unknown. Mapped-type form is
// structurally identical to a string-indexed unknown record but does
// not trip the `no-new-any` diff tripwire's polite-any pattern.
type JsonObject = { [k in string]?: unknown };

const healthEngines: ProductEngines = {
  rating: {
    engineId: 'health.compiled.rating',
    kind: 'compiled',
    calculate(input) {
      const model = parseHealthProgramRatingModel(input.ratingModel);
      return { premiumCalculation: calculateHealthPremium(toHealthPricingQuoteData(input.quoteData), model.tables).premium };
    },
    buildQuoteResponse(input) {
      return buildHealthQuoteResponse(input.quoteData, {
        ...input.context,
        ratingModel: input.ratingModel ?? input.context?.ratingModel,
      });
    },
    validateProgramRatingModel(model) {
      parseHealthProgramRatingModel(model);
    },
    calculateEndorsementPremium(quoteData, _appliedEndorsements, context) {
      // HEALTH endorsements currently have no incremental premium, but the
      // preview still represents the policy's total premium. Reuse the mapped
      // programme model so the endorsement path cannot report a synthetic €0.
      const model = parseHealthProgramRatingModel(context?.ratingModel);
      const calculation = calculateHealthPremium(toHealthPricingQuoteData(quoteData), model.tables);
      return Promise.resolve({ premium: calculation.premium.premium, policyExcess: 0 });
    },
  },
  underwriting: {
    engineId: 'health.compiled.uw',
    kind: 'compiled',
    validateProgramUwConfig(config) {
      parseHealthUwConfig(config);
    },
    evaluate(input): UwEngineResult {
      const qd = toHealthPricingQuoteData(input.quoteData);
      const decision = evaluateHealthUw(mapHealthUwInput(qd), requireHealthUnderwriting(input.context));
      const decisionAsRecord = uwDecisionToRecord(decision);
      return { decision: decisionAsRecord, analysis: decisionAsRecord };
    },
  },
  wording: {
    engineId: 'health.compiled.wording',
    kind: 'compiled',
    getDocPackJobName() {
      return 'DOC.GENERATE_HEALTH_DOC_PACK';
    },
    async render(args) {
      const { executeHealthDocPackGeneration } = await import('./documents/generateHealthDocPack.js');
      // `args.db` is typed `unknown` on the engine surface (the generic
      // contract can't know each product's Prisma client type). Narrow
      // it to `TransactionClient | undefined` — when undefined, the
      // generic doc-pack generator defaults to `tenantScopedPrisma`
      // (the tenant-aware client that auto-populates the
      // `operatingTenant` relation required by `Document.create`).
      // Passing the raw `prisma` here would skip the tenant extension
      // and the integration test fails with "Argument `operatingTenant`
      // is missing".
      const db = args.db as Prisma.TransactionClient | undefined;
      return executeHealthDocPackGeneration({
        policyId: args.policyId,
        riskTransactionId: args.riskTransactionId ?? null,
        docPack: args.docPack,
        source: args.source,
        generatedByUserId: args.generatedByUserId ?? null,
        templateVersion: args.templateVersion ?? undefined,
        requiredIssuedDocTypes: args.requiredIssuedDocTypes,
        documentSources: args.documentSources,
        db,
      });
    },
  },
};

function requireHealthUnderwriting(context: BuildQuoteResponseContext | undefined): HealthUwConfig {
  const underwriting = context?.programDefinition?.underwriting;
  if (!underwriting) throw new Error('Health underwriting requires a published programme definition.');
  return parseHealthUwConfig(underwriting);
}

export const healthProductRuntimeConfig: ManifestProductRuntimeConfig = {
  productType: 'HEALTH',
  displayName: 'Immigration Medical Insurance',
  executionMode: 'runtime_config',
  manifest: healthManifest,
  goldenFixtures: healthGoldenFixtures,
  customerJourney: { pricingStep: 'quote', uwStep: 'period-and-ghs', detailsStep: 'your-details' },
  intake: {
    publicSessionSlug: 'health',
    publicEntryPath: '/quote/health/new',
    firstStep: 'your-details',
    validationMode: 'manifest_only',
  },
  rating: {
    framework: 'unified-rating',
    mode: 'table_assets',
    source: 'program_model',
    assetRefs: [],
    traceSchemaVersion: 'v1',
  },
  programmeDefinitionEditor: defineProgrammeDefinitionEditor({
    productType: 'HEALTH',
    pricingModes: ['AUTOMATED'],
    componentControls: { underwriting: 'health-underwriting' },
  }),
  engines: healthEngines,
  getDocPackJobName(): string {
    return resolveProductEngines(healthProductRuntimeConfig.engines).wording.getDocPackJobName();
  },
  calculatePremium(_data: unknown): PremiumCalculation {
    throw new Error('HEALTH pricing must use the mapped programme rating model through the canonical quote-rating service.');
  },
  async buildQuoteResponse(quoteData: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult> {
    return resolveProductEngines(healthProductRuntimeConfig.engines).rating.buildQuoteResponse({ productType: 'HEALTH', quoteData, context });
  },
  validateBindRules(_quoteData: unknown, _binderConfig: unknown): BindRulesResult {
    return { valid: true, errors: [] };
  },
  normalizeUwData(quoteData: unknown): UwNormalizationResult {
    const qd = asRecord(quoteData);
    return {
      normalizedQuoteData: qd,
      productFields: {
        eligibility: asRecord(qd.eligibility),
        insureds: asRecord(qd.insureds),
        period: asRecord(qd.period),
        ghs: asRecord(qd.ghs),
      },
    };
  },
  buildVersionMeta(quoteData: unknown): VersionMeta {
    const qd = asRecord(quoteData);
    const insureds = asRecord(qd.insureds);
    const persons = Array.isArray(insureds.persons) ? insureds.persons : [];
    const ghs = asRecord(qd.ghs);
    const coverType = String(insureds.coverType || 'single');
    const coverLabel = `${coverType.charAt(0).toUpperCase() + coverType.slice(1).replace(/_/g, ' ')} — Immigration Medical`;
    return {
      sectionLabel: 'Health',
      coverageLabel: `${coverLabel}${ghs.isBeneficiary ? ' (GESY extension)' : ''}`,
      insuredValueDisplay: `${persons.length} insured`,
      bdxClassOfBusiness: 'A&H',
    };
  },
  getCustomerJourneyMeta(): CustomerJourneyMeta {
    return healthProductRuntimeConfig.customerJourney;
  },
  buildVersionRows(args: BuildVersionRowsArgs): VersionRow[] {
    return [{
      section: 'Health',
      riskTransType: args.riskTransTypeLabel,
      limitText: args.versionMeta?.coverageLabel || 'Section A — Inbound Individual Medical',
      excessText: 'Age-banded',
      premium: args.premiumDeltaTotal,
      currency: 'EUR',
    }];
  },
  async generateDocPack(args: DocPackGenerationArgs): Promise<DocPackGenerationResult> {
    return resolveProductEngines(healthProductRuntimeConfig.engines).wording.render(args);
  },
  async calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }> = [],
    context?: BuildQuoteResponseContext,
  ): Promise<EndorsementPremiumResult> {
    return resolveProductEngines(healthProductRuntimeConfig.engines).rating.calculateEndorsementPremium(quoteData, appliedEndorsements, context);
  },
};

async function buildHealthQuoteResponse(quoteData: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult> {
  const qd = toHealthPricingQuoteData(quoteData);
  const ratingModel = parseHealthProgramRatingModel(context?.ratingModel);
  const uwDecision = evaluateHealthUw(mapHealthUwInput(qd), requireHealthUnderwriting(context));

  if (uwDecision.lane === 'decline') {
    return {
      quoteResponse: { status: 'DECLINED', uwDecision, primaryOption: null },
      underwritingAnalysis: uwDecisionToRecord(uwDecision),
    };
  }

  let calculation;
  try {
    calculation = calculateHealthPremium(qd, ratingModel.tables);
  } catch (err) {
    // Pricing validation errors surface as REFER (consistent with travel).
    const message = err instanceof Error ? err.message : 'Unable to calculate health premium';
    return {
      quoteResponse: {
        status: 'REFERRAL',
        uwDecision: { lane: 'referral', reasons: [{ code: 'RATING_INPUT_INVALID', message }], isExpat: uwDecision.isExpat },
        primaryOption: null,
      },
      underwritingAnalysis: { lane: 'referral' },
    };
  }

  const { premium, breakdown, refer, reason, declined, declineReason } = calculation;
  if (declined) {
    return {
      quoteResponse: {
        status: 'DECLINED',
        uwDecision: { lane: 'decline', reasons: [{ code: 'NO_RATE', message: declineReason || 'No rate available' }], isExpat: false },
        primaryOption: null,
      },
      underwritingAnalysis: { lane: 'decline' },
    };
  }
  if (refer) {
    return {
      quoteResponse: {
        status: 'REFERRAL',
        uwDecision: { lane: 'referral', reasons: [{ code: 'RATE_REFERRAL', message: reason || 'Manual review required' }], isExpat: uwDecision.isExpat },
        primaryOption: null,
      },
      underwritingAnalysis: { lane: 'referral' },
    };
  }

  const primaryOption = {
    // Brit Immigration is an annual policy paid once: `annualPremium` is the
    // full price charged a single time at checkout (no monthly instalments).
    annualPremium: premium.premium,
    premiumBillingPeriod: 'annual',
    policyTerm: 'annual',
    netPremium: breakdown.netPremium,
    iptAmount: breakdown.iptAmount,
    adminFee: breakdown.adminFee,
    breakdown,
    costDetails: { subtotalNetPremium: breakdown.netPremium },
  };

  return {
    quoteResponse: {
      status: uwDecision.lane === 'referral' ? 'REFERRAL' : 'QUOTED',
      currency: 'EUR',
      primaryOption,
      uwDecision,
    },
    underwritingAnalysis: uwDecisionToRecord(uwDecision),
  };
}

function uwDecisionToRecord(d: HealthUwDecision): JsonObject {
  return { lane: d.lane, reasons: d.reasons, isExpat: d.isExpat };
}

function mapHealthUwInput(qd: HealthQuoteData) {
  const eligibility = asRecord(qd.eligibility);
  const insureds = asRecord(qd.insureds);
  const persons: JsonObject[] = Array.isArray(insureds.persons) ? insureds.persons : [];
  const inception = String(asRecord(qd.period).inceptionDate || '');
  const personAges = persons
    .map((person) => String(person.dob || ''))
    .filter((dob) => dob.trim())
    .map((dob) => ageFromDOB(dob, inception));
  const oldestInsuredAge = personAges.length > 0 ? Math.max(...personAges) : undefined;
  return {
    oldestInsuredAge,
    countryOfResidence: String(eligibility.countryOfResidence || ''),
    nationality: String(eligibility.nationality || ''),
    hasOtherNationality: eligibility.hasOtherNationality === true,
    otherNationality: String(eligibility.otherNationality || ''),
    willRemainResident: eligibility.willRemainResident === true ? true : eligibility.willRemainResident === false ? false : undefined,
    legallyPermittedToReside: eligibility.legallyPermittedToReside === true ? true : eligibility.legallyPermittedToReside === false ? false : undefined,
    informationAccurate: eligibility.informationAccurate === true ? true : eligibility.informationAccurate === false ? false : undefined,
  };
}

function asRecord(v: unknown): JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as JsonObject : {};
}

function ageFromDOB(dob: string, atIso?: string): number {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return 0;
  const ref = atIso ? new Date(atIso) : new Date();
  if (Number.isNaN(ref.getTime())) return 0;
  let age = ref.getFullYear() - d.getFullYear();
  const m = ref.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < d.getDate())) age -= 1;
  return age;
}
