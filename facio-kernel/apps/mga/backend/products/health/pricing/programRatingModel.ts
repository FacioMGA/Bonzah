import { z } from 'zod';
import { BritHealthRatesSchema, type BritHealthRates } from './data/brit-health.schema.js';

export class HealthRatingModelConfigurationError extends Error {
  readonly code = 'HEALTH_RATING_MODEL_CONFIGURATION_INVALID' as const;

  constructor(reason: string) {
    super(`Health rating model configuration is invalid: ${reason}`);
    this.name = 'HealthRatingModelConfigurationError';
  }
}

const HealthProgramRatingModelSchema = z.object({
  id: z.string().min(1),
  programId: z.string().min(1),
  version: z.number().int().positive(),
  binderProductAuthorityId: z.string().min(1),
  tables: BritHealthRatesSchema,
});

export type HealthProgramRatingModel = {
  id: string;
  programId: string;
  version: number;
  binderProductAuthorityId: string;
  tables: BritHealthRates;
};

/** Validates the persisted programme model at the Health engine boundary. */
export function parseHealthProgramRatingModel(value: unknown): HealthProgramRatingModel {
  const parsed = HealthProgramRatingModelSchema.safeParse(value);
  if (!parsed.success) {
    throw new HealthRatingModelConfigurationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'model'}: ${issue.message}`).join('; '),
    );
  }
  return parsed.data;
}
