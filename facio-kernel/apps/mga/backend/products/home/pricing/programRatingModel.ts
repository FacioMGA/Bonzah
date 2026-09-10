import { z } from 'zod';
import { HomeRatesSchema, type HomeRates } from './data/home-rates.schema.js';

export class HomeRatingModelConfigurationError extends Error {
  readonly code = 'HOME_RATING_MODEL_CONFIGURATION_INVALID' as const;

  constructor(reason: string) {
    super(`Home rating model configuration is invalid: ${reason}`);
    this.name = 'HomeRatingModelConfigurationError';
  }
}

const HomeProgramRatingModelSchema = z.object({
  id: z.string().min(1),
  programId: z.string().min(1),
  version: z.number().int().positive(),
  binderProductAuthorityId: z.string().min(1),
  tables: HomeRatesSchema,
});

export type HomeProgramRatingModel = {
  id: string;
  programId: string;
  version: number;
  binderProductAuthorityId: string;
  tables: HomeRates;
};

export function parseHomeProgramRatingModel(value: unknown): HomeProgramRatingModel {
  const parsed = HomeProgramRatingModelSchema.safeParse(value);
  if (!parsed.success) {
    throw new HomeRatingModelConfigurationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'model'}: ${issue.message}`).join('; '),
    );
  }
  return parsed.data;
}
