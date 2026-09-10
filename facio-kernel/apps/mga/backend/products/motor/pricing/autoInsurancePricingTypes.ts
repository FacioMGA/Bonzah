import type { BreakdownCost, PremiumBreakdown } from '../../../platform/types/autoInsurance.js';
import type { CalculationStep } from '../../../platform/types/pricing.js';
import type { TaxBreakdown } from '../../../modules/jurisdiction/domain/productConfiguration.js';

export type UnknownRecord = Record<string, unknown>;

/** Motor calculator version — bump on every pricing-logic change. */
export const MOTOR_CALCULATOR_VERSION = 'motor@1.0.0';

export interface AutoInsurancePremiumCalculation {
  premium: number;
  policyExcess: number;
  basis: 'MOTOR';
  calculationDetails: {
    premiumBreakdown: PremiumBreakdown;
    costBreakdown: BreakdownCost;
    taxRows?: TaxBreakdown[];
    taxProfileCode?: string;
    steps: CalculationStep[];
    calculatorVersion: string;
  };
}
