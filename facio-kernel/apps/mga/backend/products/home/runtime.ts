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
import { homeManifest } from '@facio/products';
import { getTenantConfig } from '../../platform/tenant/tenantConfig.js';
import { calculateHomePremium, type HomeQuoteData } from './pricing/homeCalculator.js';
import { parseHomeProgramRatingModel } from './pricing/programRatingModel.js';
import { enforceHomeCoverageDefaults, enforceHomeCoverEligibility, toHomePricingQuoteData } from './quoteDataAuthority.js';
import { evaluateHomeUw, parseHomeUwConfig, type HomeUwConfig } from './underwriting/homeUwAutomation.js';
import { buildUnderwritingAnalysis } from '../../modules/underwriting/domain/underwritingAnalysis.js';
import { homeGoldenFixtures } from './goldenFixtures.js';

const homeEngines: ProductEngines = {
  rating: {
    engineId: 'home.compiled.rating',
    kind: 'compiled',
    calculate(input) {
      const model = parseHomeProgramRatingModel(input.ratingModel);
      return { premiumCalculation: calculateHomePremium(toHomePricingQuoteData(input.quoteData, getTenantConfig().countryCode), model.tables).premium };
    },
    buildQuoteResponse(input) {
      return buildHomeQuoteResponse(input.quoteData, {
        ...input.context,
        ratingModel: input.ratingModel ?? input.context?.ratingModel,
      });
    },
    validateProgramRatingModel(model) {
      parseHomeProgramRatingModel(model);
    },
    calculateEndorsementPremium(quoteData, appliedEndorsements = [], context) {
      const model = parseHomeProgramRatingModel(context?.ratingModel);
      const tenantCountryCode = getTenantConfig().countryCode;
      const baseQd = stripHomeOptionalCoverageState(toHomePricingQuoteData(quoteData, tenantCountryCode));
      const derivedQd = enforceHomeCoverEligibility(enforceHomeCoverageDefaults(
        applyHomeEndorsementsToQuoteData(baseQd, appliedEndorsements),
        tenantCountryCode,
      ));
      const { breakdown } = calculateHomePremium(derivedQd, model.tables);
      return Promise.resolve({ premium: breakdown.grossPremium, policyExcess: 150 });
    },
  },
  underwriting: {
    engineId: 'home.compiled.uw',
    kind: 'compiled',
    validateProgramUwConfig(config) {
      parseHomeUwConfig(config);
    },
    evaluate(input): UwEngineResult {
      const qd = toHomePricingQuoteData(input.quoteData, getTenantConfig().countryCode);
      const decision = evaluateHomeUw(mapUwInput(qd, input.quoteData), requireHomeUnderwriting(input.context));
      return {
        decision: asRecord(decision),
        analysis: asRecord(buildUnderwritingAnalysis({ uwDecision: asRecord(decision) })),
      };
    },
  },
  wording: {
    engineId: 'home.compiled.wording',
    kind: 'compiled',
    getDocPackJobName() {
      return 'DOC.GENERATE_HOME_DOC_PACK';
    },
    async render(args) {
      // Production wording engine: renders Handlebars templates → PDF →
      // uploads to storage → persists Document rows. The previous stub
      // returned only `HOME_SCHEDULE_PDF` with a `stub://...` URI and
      // never wrote a `Document` row, which caused
      // `DOC.GENERATE_ISSUED_POLICY_PACK` to throw on missing required
      // doc types (e.g. `HOME_STATEMENT_OF_FACT_PDF`) and the
      // welcome-email orchestrator to fail with `Issued-pack DB
      // validation failed (missing docs)`.
      const { executeHomeDocPackGeneration } = await import('./documents/generateHomeDocPack.js');
      return executeHomeDocPackGeneration({
        policyId: args.policyId,
        riskTransactionId: args.riskTransactionId ?? null,
        docPack: args.docPack,
        source: args.source,
        generatedByUserId: args.generatedByUserId ?? null,
        templateVersion: args.templateVersion ?? undefined,
        requiredIssuedDocTypes: args.requiredIssuedDocTypes,
        documentSources: args.documentSources,
        db: args.db as never,
      });
    },
  },
};

function requireHomeUnderwriting(context: BuildQuoteResponseContext | undefined): HomeUwConfig {
  const underwriting = context?.programDefinition?.underwriting;
  if (!underwriting) throw new Error('Home underwriting requires a published programme definition.');
  return parseHomeUwConfig(underwriting);
}

export const homeProductRuntimeConfig: ManifestProductRuntimeConfig = {
  productType: 'HOME',
  displayName: 'Home Insurance',
  executionMode: 'runtime_config',
  manifest: homeManifest,
  goldenFixtures: homeGoldenFixtures,
  customerJourney: { pricingStep: 'sums-insured', uwStep: 'construction-risk', detailsStep: 'policy-holder' },
  intake: {
    publicSessionSlug: 'home',
    publicEntryPath: '/quote/home/new',
    firstStep: 'policy-holder',
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
    productType: 'HOME',
    pricingModes: ['AUTOMATED'],
    componentControls: { underwriting: 'home-underwriting' },
  }),
  engines: homeEngines,
  getDocPackJobName(): string {
    return resolveProductEngines(homeProductRuntimeConfig.engines).wording.getDocPackJobName();
  },
  calculatePremium(_data: unknown): PremiumCalculation {
    throw new Error('HOME pricing must use the mapped programme rating model through the canonical quote-rating service.');
  },
  async buildQuoteResponse(quoteData: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult> {
    return resolveProductEngines(homeProductRuntimeConfig.engines).rating.buildQuoteResponse({ productType: 'HOME', quoteData, context });
  },
  validateBindRules(quoteData: unknown, binderConfig: unknown): BindRulesResult {
    const qd = asRecord(quoteData);
    const property = asRecord(qd.property);
    const propertyAddress = asRecord(property.address);
    const coverage = asRecord(qd.coverage);
    const config = asRecord(binderConfig);
    const authority = asRecord(config.authority);
    const scope = asRecord(config.scope);

    const errors: Array<{ field: string; message: string }> = [];
    const buildings = Number(coverage.buildings || 0);
    const maxBuildings = Number(authority.maxBuildingsSumInsured || 0);
    if (maxBuildings > 0 && buildings > maxBuildings) {
      errors.push({ field: 'coverage.buildings', message: `Buildings sum insured €${buildings.toLocaleString()} exceeds binder authority of €${maxBuildings.toLocaleString()}` });
    }
    const country = String(propertyAddress.country || '').trim();
    const allowedCountries = Array.isArray(scope.riskLocationCountries) ? scope.riskLocationCountries.map((c) => String(c).trim()) : [];
    if (country && allowedCountries.length > 0 && !allowedCountries.includes(country)) {
      errors.push({ field: 'property.address.country', message: `Country '${country}' is outside the binder's territorial scope` });
    }
    return { valid: errors.length === 0, errors };
  },
  normalizeUwData(quoteData: unknown): UwNormalizationResult {
    const qd = asRecord(quoteData);
    return {
      normalizedQuoteData: qd,
      productFields: {
        propertyInfo: asRecord(qd.property),
        coverageInfo: asRecord(qd.coverage),
      },
    };
  },
  buildVersionMeta(quoteData: unknown): VersionMeta {
    const qd = asRecord(quoteData);
    const coverage = asRecord(qd.coverage);
    const buildings = Number(coverage.buildings || 0);
    const contents = Number(coverage.contents || 0);
    return {
      sectionLabel: 'Home',
      coverageLabel: 'Buildings + Contents',
      insuredValueDisplay: `€${buildings.toLocaleString()} / €${contents.toLocaleString()}`,
      bdxClassOfBusiness: 'PROPERTY',
    };
  },
  getCustomerJourneyMeta(): CustomerJourneyMeta {
    return homeProductRuntimeConfig.customerJourney;
  },
  buildVersionRows(args: BuildVersionRowsArgs): VersionRow[] {
    const premium = args.premiumDeltaTotal;
    return [{
      section: 'Buildings + Contents',
      riskTransType: args.riskTransTypeLabel,
      limitText: args.versionMeta?.insuredValueDisplay || '—',
      excessText: '€150',
      premium,
      currency: 'EUR',
    }];
  },
  async generateDocPack(args: DocPackGenerationArgs): Promise<DocPackGenerationResult> {
    return resolveProductEngines(homeProductRuntimeConfig.engines).wording.render(args);
  },
  async calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }> = [],
    context?: BuildQuoteResponseContext,
  ): Promise<EndorsementPremiumResult> {
    return resolveProductEngines(homeProductRuntimeConfig.engines).rating.calculateEndorsementPremium(quoteData, appliedEndorsements, context);
  },
};

async function buildHomeQuoteResponse(quoteData: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult> {
  const tenantCountryCode = getTenantConfig().countryCode;
  const requestedQd = applyHomeEndorsementsToQuoteData(
    toHomePricingQuoteData(quoteData, tenantCountryCode),
    context?.resolvedCoverageSet?.applied || [],
  );
  const qd = enforceHomeCoverEligibility(enforceHomeCoverageDefaults(requestedQd, tenantCountryCode));
  const ratingModel = parseHomeProgramRatingModel(context?.ratingModel);
  const uwDecision = evaluateHomeUw(mapUwInput(qd, quoteData, requestedQd), requireHomeUnderwriting(context));

  if (uwDecision.lane === 'decline') {
    const quoteResponse = {
      status: 'DECLINED',
      uwDecision,
      primaryOption: null,
    };
    return {
      quoteResponse,
      underwritingAnalysis: asRecord(buildUnderwritingAnalysis({ uwDecision: asRecord(uwDecision), quoteResponse })),
    };
  }

  const { premium, breakdown, declined, declineReason } = calculateHomePremium(qd, ratingModel.tables);
  if (declined) {
    const noRatesUwDecision = {
      lane: 'red',
      outcome: 'decline',
      reasons: [{ code: 'NO_RATES_AVAILABLE', message: declineReason || 'No rates available' }],
      triggers: [],
    };
    const quoteResponse = {
      status: 'DECLINED',
      uwDecision: noRatesUwDecision,
      primaryOption: null,
    };
    return {
      quoteResponse,
      underwritingAnalysis: asRecord(buildUnderwritingAnalysis({ uwDecision: asRecord(noRatesUwDecision), quoteResponse })),
    };
  }

  const primaryOption = {
    annualPremium: premium.premium,
    netPremium: breakdown.netPremium,
    iptAmount: breakdown.iptAmount,
    adminFee: breakdown.adminFee,
    calculationTrace: premium.calculationDetails,
    breakdown,
    costDetails: {
      subtotalNetPremium: breakdown.netPremium,
    },
  };

  const quoteResponse = {
    status: uwDecision.lane === 'referral' ? 'REFERRAL' : 'QUOTED',
    currency: 'EUR',
    primaryOption,
    uwDecision,
  };
  return {
    quoteResponse,
    underwritingAnalysis: asRecord(buildUnderwritingAnalysis({ uwDecision: asRecord(uwDecision), quoteResponse })),
  };
}

function stripHomeOptionalCoverageState(base: HomeQuoteData): HomeQuoteData {
  return {
    ...base,
    accidentalDamageBuildings: false,
    accidentalDamageContents: false,
    allRiskJewellery: 0,
    allRiskOther: 0,
    solarPanels: base.solarPanels,
    europAssistance: false,
  };
}

function applyHomeEndorsementsToQuoteData(
  base: HomeQuoteData,
  applied: Array<{ code: string; params?: unknown }>,
): HomeQuoteData {
  const derived: HomeQuoteData = { ...base };
  const codes = new Set(applied.map((e) => String(e.code || '').toUpperCase()));
  if (codes.has('HOME-ACC-DAMAGE-BUILDINGS') || codes.has('HOME-ACCIDENTAL-DAMAGE-BUILDINGS')) derived.accidentalDamageBuildings = true;
  if (codes.has('HOME-ACC-DAMAGE-CONTENTS') || codes.has('HOME-ACCIDENTAL-DAMAGE-CONTENTS')) derived.accidentalDamageContents = true;
  const jewellery = findParamNumber(applied, 'HOME-VALUABLES-PE', 'jewelleryAmount')
    ?? findParamNumber(applied, 'HOME-ALL-RISKS-JEWELLERY', 'amount');
  if (jewellery != null) derived.allRiskJewellery = jewellery;
  const otherAllRisks = findParamNumber(applied, 'HOME-VALUABLES-PE', 'personalEffectsAmount')
    ?? findParamNumber(applied, 'HOME-ALL-RISKS-UNSPECIFIED', 'amount');
  if (otherAllRisks != null) derived.allRiskOther = otherAllRisks;
  if (codes.has('HOME-EUROP-ASSISTANCE')) derived.europAssistance = true;
  return derived;
}

function findParamNumber(
  applied: Array<{ code: string; params?: unknown }>,
  code: string,
  key: string,
): number | null {
  const hit = applied.find((e) => String(e.code || '').toUpperCase() === code);
  if (!hit) return null;
  const params = hit.params && typeof hit.params === 'object' ? hit.params as Record<string, unknown> : {};
  const raw = params[key];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function optionalNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || String(v).trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function mapUwInput(qd: HomeQuoteData, rawQuoteData?: unknown, requestedQd: HomeQuoteData = qd) {
  const raw = asRecord(rawQuoteData);
  const rawProperty = asRecord(raw.property);
  const rawCoverage = asRecord(raw.coverage);
  const security = asRecord(raw.security);
  const specifiedItems = Array.isArray(rawCoverage.specifiedItems)
    ? (rawCoverage.specifiedItems as Array<Record<string, unknown>>).map((item) => ({
        sumInsured: Number(asRecord(item).sumInsured || 0),
      }))
    : [];
  const safeOnPremises = typeof security.safeOnPremises === 'boolean' ? (security.safeOnPremises as boolean) : undefined;
  const doorsFiveLeverLocks = typeof security.doorsFiveLeverLocks === 'boolean' ? (security.doorsFiveLeverLocks as boolean) : undefined;
  const windowsSecured = typeof security.windowsSecured === 'boolean' ? (security.windowsSecured as boolean) : undefined;
  const urbanArea = typeof rawProperty.urbanArea === 'boolean' ? (rawProperty.urbanArea as boolean) : undefined;
  const within20MinFireStation = typeof rawProperty.within20MinFireStation === 'boolean' ? (rawProperty.within20MinFireStation as boolean) : undefined;
  const rawUsage = asRecord(raw.usage);
  const businessUse = typeof rawUsage.businessUse === 'boolean' ? (rawUsage.businessUse as boolean) : undefined;
  const tenantConfig = getTenantConfig();
  return {
    propertyType: qd.propertyType,
    propertyCountry: qd.propertyCountry,
    propertyTown: qd.propertyTown,
    propertyProvince: qd.propertyProvince,
    propertyPostcode: qd.propertyPostcode,
    landAreaSqm: optionalNumber(rawProperty.landAreaSqm),
    wildfireOfficialHazardClass: qd.wildfireOfficialHazardClass,
    buildingsSumInsured: qd.buildingsSumInsured,
    contentsSumInsured: qd.contentsSumInsured,
    woodenConstruction: qd.woodenConstruction,
    previousClaims: qd.previousClaims,
    yearBuilt: qd.yearBuilt,
    proposerNationality: String(asRecord(raw.proposer).nationality || ''),
    proposerDomicileCountry: qd.proposerDomicileCountry,
    tenantCountry: tenantConfig.country,
    usage: { permanentHome: qd.propertyUse === 'Permanent', businessUse },
    coverage: {
      // UW sees attempted cover from both the raw request and resolved BO/MBE
      // endorsements even when the pricing projection strips ineligible cover.
      allRiskJewellery: Number(rawCoverage.allRiskJewellery || requestedQd.allRiskJewellery || 0),
      allRiskOther: Number(rawCoverage.allRiskOther || requestedQd.allRiskOther || 0),
      solarPanels: qd.solarPanels,
      accidentalDamageBuildings: rawCoverage.accidentalDamageBuildings === true || requestedQd.accidentalDamageBuildings === true,
      accidentalDamageContents: rawCoverage.accidentalDamageContents === true || requestedQd.accidentalDamageContents === true,
    },
    specifiedItems,
    safeOnPremises,
    doorsFiveLeverLocks,
    windowsSecured,
    urbanArea,
    within20MinFireStation,
  };
}
