import { z } from 'zod';
import { BritTravelRatesSchema, type BritTravelRates } from './data/brit-travel.schema.js';
import { TravelFeeBandsSchema, type TravelFeeBands } from './data/travel-fee-bands.schema.js';

export class TravelRatingModelConfigurationError extends Error {
  readonly code = 'TRAVEL_RATING_MODEL_CONFIGURATION_INVALID' as const;

  constructor(reason: string) {
    super(`Travel rating model configuration is invalid: ${reason}`);
    this.name = 'TravelRatingModelConfigurationError';
  }
}

export const TravelRatingTablesSchema = z.object({
  rateCard: BritTravelRatesSchema,
  adminFees: TravelFeeBandsSchema,
});

export type TravelRatingTables = {
  rateCard: BritTravelRates;
  adminFees: TravelFeeBands;
};

const TravelProgramRatingModelSchema = z.object({
  id: z.string().min(1),
  programId: z.string().min(1),
  version: z.number().int().positive(),
  binderProductAuthorityId: z.string().min(1),
  tables: TravelRatingTablesSchema,
});

export type TravelProgramRatingModel = {
  id: string;
  programId: string;
  version: number;
  binderProductAuthorityId: string;
  tables: TravelRatingTables;
};

export function parseTravelProgramRatingModel(value: unknown): TravelProgramRatingModel {
  const parsed = TravelProgramRatingModelSchema.safeParse(value);
  if (!parsed.success) {
    throw new TravelRatingModelConfigurationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'model'}: ${issue.message}`).join('; '),
    );
  }
  return parsed.data;
}
