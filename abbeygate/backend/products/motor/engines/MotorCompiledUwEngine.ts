import type { IUwEngine, UwEngineInput, UwEngineResult } from '../../../modules/policy/domain/productEngines.js';
import { evaluateMotorUwAutomation, type MotorUwConfig } from '../underwriting/motorUwAutomation.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export class MotorCompiledUwEngine implements IUwEngine {
  readonly engineId = 'motor.compiled.uw';
  readonly kind = 'compiled' as const;

  evaluate(input: UwEngineInput): UwEngineResult {
    const programMeta = asRecord(input.programMeta);
    const config = (programMeta.abbeygateMotorUwConfig || programMeta.uwConfig || undefined) as Partial<MotorUwConfig> | undefined;
    const decision = evaluateMotorUwAutomation(asRecord(input.quoteData) as never, config as MotorUwConfig | undefined);
    return {
      decision: decision as unknown as Record<string, unknown>,
      analysis: decision as unknown as Record<string, unknown>,
      trace: {
        engineId: this.engineId,
        productType: input.productType,
        lane: decision.lane,
        outcome: decision.outcome,
      },
    };
  }
}
