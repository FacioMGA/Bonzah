import type { QuoteData } from '../../../../platform/types/autoInsurance.js';
import { MOTOR_UW_CONFIG_FIXTURE } from '../../../../test/fixtures/motor/underwriting.js';
import {
  evaluateConfiguredMotorUwAutomation,
  type MotorUwConfig,
  type UwAutomationDecision,
} from '../motorUwAutomation.js';

export function mergeMotorUwFixture(override?: Partial<MotorUwConfig>): MotorUwConfig {
  const base = structuredClone(MOTOR_UW_CONFIG_FIXTURE) as MotorUwConfig;
  if (!override) return base;
  return {
    ...base,
    ...override,
    referralFlags: { ...base.referralFlags, ...override.referralFlags },
    thresholds: { ...base.thresholds, ...override.thresholds },
  };
}

export function evaluateMotorUwFixture(
  quoteData: QuoteData,
  configOverride?: Partial<MotorUwConfig>,
): UwAutomationDecision {
  return evaluateConfiguredMotorUwAutomation(quoteData, mergeMotorUwFixture(configOverride));
}
