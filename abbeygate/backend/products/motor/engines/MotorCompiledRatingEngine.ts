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
import { loadAbbeygateAutoCyprus2022Matrix } from '../pricing/data/loader.js';
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
  return resolveJurisdictionProductConfig({
    productCode: 'MOTOR',
    program: input.programMeta && typeof input.programMeta === 'object'
      ? { metadata: input.programMeta }
      : null,
    tenant: getTenantConfig(),
  });
}

export class MotorCompiledRatingEngine implements IRatingEngine {
  readonly engineId = 'motor.compiled.rating';
  readonly kind = 'compiled' as const;

  calculate(input: RatingEngineCalculateInput): RatingEngineCalculateResult {
    const jurisdictionConfig = resolveMotorJurisdictionConfig(input);
    const matrix = loadAbbeygateAutoCyprus2022Matrix();
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
        steps: calculation.calculationDetails?.steps || [],
      },
    };
  }

  async buildQuoteResponse(input: RatingEngineCalculateInput): Promise<QuoteResponseResult> {
    const jurisdictionConfig = resolveMotorJurisdictionConfig(input);
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
    );
    return {
      quoteResponse: quoteResponse as unknown as Record<string, unknown>,
    };
  }

  async getRatingMatrixSnapshot(): Promise<Record<string, unknown> | null> {
    const matrix = loadAbbeygateAutoCyprus2022Matrix();
    return {
      source: 'products/motor/pricing/data/abbeygate-auto-cyprus-2022.json',
      sheet: 'canonical',
      baseMatrix: {
        xKey: 'vehicleValue',
        yKey: 'engineSize',
        x: [...matrix.baseMatrix.vehicleValueBands],
        y: [...matrix.baseMatrix.engineSizeBands],
        values: matrix.baseMatrix.values.map((row: readonly number[]) => [...row]),
        note: 'Canonical externalised matrix (workbook-independent).',
      },
      factors: {
        driverBasis: [
          { label: 'NAMED_DRIVERS', factor: 0.85 },
          { label: 'OPEN_DRIVERS', factor: 1.0 },
        ],
        proposerAge: [...matrix.factors.proposerAge],
        vehicleAge: [...matrix.factors.vehicleAge],
        licencePeriod: [...matrix.factors.licencePeriod],
        addedDriversUnder25: [...matrix.factors.addedDriversUnder25],
      },
    };
  }

  async calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }>,
  ): Promise<EndorsementPremiumResult> {
    const jurisdictionConfig = resolveJurisdictionProductConfig({
      productCode: 'MOTOR',
      tenant: getTenantConfig(),
    });
    const matrix = loadAbbeygateAutoCyprus2022Matrix();
    const result = calculateAutoInsurancePremium(quoteData as never, undefined, appliedEndorsements, matrix, jurisdictionConfig);
    return { premium: result.premium, policyExcess: result.policyExcess };
  }
}
