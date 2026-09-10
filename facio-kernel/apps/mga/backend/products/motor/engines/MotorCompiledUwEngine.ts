import type { IUwEngine, UwEngineInput, UwEngineResult } from '../../../modules/policy/domain/productEngines.js';
import { evaluateConfiguredMotorUwAutomation, parseMotorUwConfig } from '../underwriting/motorUwAutomation.js';
import { withNormalizedCountryBeforeUw } from '../pricing/factors/abbeygateFactors.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export class MotorCompiledUwEngine implements IUwEngine {
  readonly engineId = 'motor.compiled.uw';
  readonly kind = 'compiled' as const;

  validateProgramUwConfig(config: unknown): void {
    parseMotorUwConfig(config);
  }

  evaluate(input: UwEngineInput): UwEngineResult {
    const underwriting = input.context?.programDefinition?.underwriting;
    if (!underwriting) {
      throw new Error('Motor underwriting requires a published programme definition.');
    }
    const decision = evaluateConfiguredMotorUwAutomation(
      withNormalizedCountryBeforeUw(asRecord(input.quoteData) as never), // TODO(FAC-1069): owner=platform-eng expires=2026-10-05 deletionPR=#1069 narrow UwEngineInput quoteData by product
      underwriting,
    );
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
