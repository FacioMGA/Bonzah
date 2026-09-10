import type { PremiumCalculation } from '../../../platform/types/index.js';
import type {
  IRatingEngine,
  RatingEngineCalculateInput,
  RatingEngineCalculateResult,
} from '../../../modules/policy/domain/productEngines.js';
import type { EndorsementPremiumResult, QuoteResponseResult } from '../../../modules/policy/domain/productContracts.js';
import {
  calculateAutoInsurancePremium,
  calculateAutoInsuranceQuoteResponse,
} from '../pricing/autoInsuranceCalculator.js';
import { parseMotorProgramRatingModel } from '../pricing/programRatingModel.js';
import type { AutoInsurancePremiumCalculation } from '../pricing/autoInsurancePricingTypes.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { resolveJurisdictionProductConfig } from '../../../modules/jurisdiction/domain/productConfiguration.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeOverrideExcess(options: RatingEngineCalculateInput['options']): number | undefined {
  const raw = options?.overrideExcess;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toPremiumCalculation(result: AutoInsurancePremiumCalculation): PremiumCalculation {
  return {
    premium: result.premium,
    basis: 'HYBRID',
    calculationDetails: {
      fixedAmount: result.premium,
      proRataFactor: result.policyExcess,
    },
  };
}

function resolveMotorJurisdictionConfig(input: RatingEngineCalculateInput) {
  // An imported program's country cannot authorise an unavailable operating product.
  resolveJurisdictionProductConfig({ productCode: 'MOTOR', tenant: getTenantConfig() });
  return resolveJurisdictionProductConfig({
    productCode: 'MOTOR',
    program: input.context?.programDefinition
      ? { id: input.context.programDefinition.programId, productType: 'MOTOR' }
      : null,
    tenant: getTenantConfig(),
  });
}

export class MotorCompiledRatingEngine implements IRatingEngine {
  readonly engineId = 'motor.compiled.rating';
  readonly kind = 'compiled' as const;

  validateProgramRatingModel(model: unknown): void {
    parseMotorProgramRatingModel(model);
  }

  calculate(input: RatingEngineCalculateInput): RatingEngineCalculateResult {
    const jurisdictionConfig = resolveMotorJurisdictionConfig(input);
    const ratingModel = parseMotorProgramRatingModel(input.ratingModel);
    const matrix = ratingModel.tables;
    const calculation = calculateAutoInsurancePremium(
      asRecord(input.quoteData) as never,
      normalizeOverrideExcess(input.options),
      [],
      matrix,
      jurisdictionConfig,
    );
    return {
      premiumCalculation: toPremiumCalculation(calculation),
      trace: {
        engineId: this.engineId,
        calculatorVersion: calculation.calculationDetails?.calculatorVersion,
        ratingModel: {
          id: ratingModel.id,
          programId: ratingModel.programId,
          version: ratingModel.version,
          binderProductAuthorityId: ratingModel.binderProductAuthorityId,
          pipeline: ratingModel.stages,
        },
        steps: calculation.calculationDetails?.steps || [],
      },
    };
  }

  async buildQuoteResponse(input: RatingEngineCalculateInput): Promise<QuoteResponseResult> {
    if (!input.uwDecision || typeof input.uwDecision !== 'object') {
      throw new Error('Motor quote response requires an underwriting decision from the published programme definition.');
    }
    const jurisdictionConfig = resolveMotorJurisdictionConfig(input);
    const ratingModel = parseMotorProgramRatingModel(input.ratingModel ?? input.context?.ratingModel);
    const overrideExcess =
      normalizeOverrideExcess(input.options) ??
      normalizeOverrideExcess({ overrideExcess: input.context?.overrideExcess as number | string | null | undefined });
    const quoteResponse = calculateAutoInsuranceQuoteResponse(
      asRecord(input.quoteData) as never,
      overrideExcess,
      {
        uwDecision: input.uwDecision as never,
        jurisdictionConfig,
        reference: input.context?.reference,
        currency: input.context?.currency,
      },
      input.context?.resolvedCoverageSet?.applied,
      ratingModel.tables,
    );
    return {
      quoteResponse: quoteResponse as unknown as Record<string, unknown>,
    };
  }

  async calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }>,
    context?: import('../../../modules/policy/domain/productContracts.js').BuildQuoteResponseContext,
  ): Promise<EndorsementPremiumResult> {
    const jurisdictionConfig = resolveJurisdictionProductConfig({
      productCode: 'MOTOR',
      tenant: getTenantConfig(),
    });
    const matrix = parseMotorProgramRatingModel(context?.ratingModel).tables;
    const result = calculateAutoInsurancePremium(quoteData as never, undefined, appliedEndorsements, matrix, jurisdictionConfig);
    return { premium: result.premium, policyExcess: result.policyExcess };
  }
}
