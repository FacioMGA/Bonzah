import type { JsonObject } from '../../../platform/types/json.js';

/**
 * ADR-0101's product-neutral configuration envelope. Each component is
 * validated further by its product-owned schema before publication/execution.
 * This boundary guarantees that no component can disappear into an implicit
 * product default.
 */
export type ProgramDefinitionComponents = {
  underwriting: JsonObject;
  coverage: JsonObject;
  questionnaire: JsonObject;
  workflow: JsonObject;
  channels: JsonObject;
  documents: JsonObject;
};

export type ResolvedProgramDefinition = ProgramDefinitionComponents & {
  id: string;
  programId: string;
  version: number;
  pricingMode: 'AUTOMATED' | 'MANUAL';
  binderProductAuthorityId: string;
  ratingModel?: {
    id: string;
    programId: string;
    version: number;
    stages: JsonObject[];
    tables: JsonObject;
  };
};

type DefinitionComponentSource = {
  underwriting: unknown;
  coverage: unknown;
  questionnaire: unknown;
  workflow: unknown;
  channels: unknown;
  documents: unknown;
};

function asJsonObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

export class ProgramDefinitionConfigurationError extends Error {
  readonly code = 'BINDER_PROGRAM_DEFINITION_NOT_PUBLISHED' as const;

  constructor(binderProductAuthorityId: string, reason: string) {
    super(`Binder product authority ${binderProductAuthorityId} has no usable published programme definition: ${reason}`);
    this.name = 'ProgramDefinitionConfigurationError';
  }
}

export function requireDefinitionComponents(
  binderProductAuthorityId: string,
  value: DefinitionComponentSource,
): ProgramDefinitionComponents {
  const requireComponent = (component: keyof DefinitionComponentSource): JsonObject => {
    const parsed = asJsonObject(value[component]);
    if (!parsed) throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, `${component} component is not an object`);
    return parsed;
  };
  return {
    underwriting: requireComponent('underwriting'),
    coverage: requireComponent('coverage'),
    questionnaire: requireComponent('questionnaire'),
    workflow: requireComponent('workflow'),
    channels: requireComponent('channels'),
    documents: requireComponent('documents'),
  };
}

export function requireRecord(
  binderProductAuthorityId: string,
  value: unknown,
  label: string,
): JsonObject {
  const parsed = asJsonObject(value);
  if (!parsed) throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, `${label} is not an object`);
  return parsed;
}
