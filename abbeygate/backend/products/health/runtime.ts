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
import type { ClaimsContract } from '../../modules/claims/domain/claimsContract.js';
import type { ManifestProductRuntimeConfig } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import type { ProductEngines, UwEngineResult } from '../../modules/policy/domain/productEngines.js';
import { resolveProductEngines } from '../../modules/policy/domain/productEngines.js';
import { healthManifest } from '@facio/products';
import { calculateHealthPremium, type HealthQuoteData } from './pricing/healthCalculator.js';
import { toHealthPricingQuoteData } from './quoteDataAuthority.js';
import {
  evaluateHealthUw,
  DEFAULT_HEALTH_UW_CONFIG,
  type HealthUwDecision,
} from './underwriting/healthUwAutomation.js';
import { healthDefaultClaimsContract } from './claims/defaultClaimsContract.js';
import { healthGoldenFixtures } from './goldenFixtures.js';
import { HEALTH_REQUIRED_ISSUED_DOC_TYPES } from './documents/documentPackContract.js';
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
      return { premiumCalculation: calculateHealthPremium(toHealthPricingQuoteData(input.quoteData)).premium };
    },
    buildQuoteResponse(input) {
      return buildHealthQuoteResponse(input.quoteData, input.context);
    },
    async getRatingMatrixSnapshot() {
      return {
        source: 'backend/products/health/pricing/data/brit-health-2026.json',
        sheet: 'brit-immigration-medical',
        note: 'Age-banded premium + excess; cover amounts fixed; GHS extension free.',
      };
    },
    calculateEndorsementPremium(quoteData) {
      // HEALTH endorsements (BASE + GHS-EXTENSION) carry no premium
      // delta — base cover is folded into the calculator total and the
      // GHS extension is no-cost. Returning gross premium here keeps
      // the MBE plumbing happy without inventing a number.
      const { breakdown } = calculateHealthPremium(toHealthPricingQuoteData(quoteData));
      return Promise.resolve({ premium: breakdown.grossPremium, policyExcess: 0 });
    },
  },
  underwriting: {
    engineId: 'health.compiled.uw',
    kind: 'compiled',
    evaluate(input): UwEngineResult {
      const qd = toHealthPricingQuoteData(input.quoteData);
      const decision = evaluateHealthUw(mapHealthUwInput(qd), DEFAULT_HEALTH_UW_CONFIG);
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
        db,
      });
    },
  },
};

export const healthProductRuntimeConfig: ManifestProductRuntimeConfig = {
  productType: 'HEALTH',
  displayName: 'Immigration Medical Insurance',
  executionMode: 'runtime_config',
  manifest: healthManifest,
  defaultClaimsContract: healthDefaultClaimsContract satisfies ClaimsContract,
  requiredIssuedDocTypes: HEALTH_REQUIRED_ISSUED_DOC_TYPES,
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
    assetRefs: ['backend/products/health/pricing/data/brit-health-2026.json'],
    traceSchemaVersion: 'v1',
  },
  engines: healthEngines,
  getDocPackJobName(): string {
    return resolveProductEngines(healthProductRuntimeConfig.engines).wording.getDocPackJobName();
  },
  calculatePremium(data: unknown): PremiumCalculation {
    const result = resolveProductEngines(healthProductRuntimeConfig.engines).rating.calculate({ productType: 'HEALTH', quoteData: data });
    if (result instanceof Promise) throw new Error('Health rating engine returned async result for calculatePremium');
    return result.premiumCalculation;
  },
  async buildQuoteResponse(quoteData: unknown, _programMeta: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult> {
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
  async getRatingMatrixSnapshot(): Promise<JsonObject | null> {
    return resolveProductEngines(healthProductRuntimeConfig.engines).rating.getRatingMatrixSnapshot();
  },
  async calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }> = [],
  ): Promise<EndorsementPremiumResult> {
    return resolveProductEngines(healthProductRuntimeConfig.engines).rating.calculateEndorsementPremium(quoteData, appliedEndorsements);
  },
};

async function buildHealthQuoteResponse(quoteData: unknown, _context?: BuildQuoteResponseContext): Promise<QuoteResponseResult> {
  const qd = toHealthPricingQuoteData(quoteData);
  const uwDecision = evaluateHealthUw(mapHealthUwInput(qd), DEFAULT_HEALTH_UW_CONFIG);

  if (uwDecision.lane === 'decline') {
    return {
      quoteResponse: { status: 'DECLINED', uwDecision, primaryOption: null },
      underwritingAnalysis: uwDecisionToRecord(uwDecision),
    };
  }

  let calculation;
  try {
    calculation = calculateHealthPremium(qd);
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
