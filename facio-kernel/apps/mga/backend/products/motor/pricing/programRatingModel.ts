import { z } from 'zod';
import {
  AbbeygateAutoCyprus2022MatrixSchema,
  type AbbeygateAutoCyprus2022Matrix,
} from './data/abbeygate-auto-cyprus-2022.schema.js';
import { ClassicCarRatesSchema, type ClassicCarRates } from './data/classic-car-rates.schema.js';

export class MotorRatingModelConfigurationError extends Error {
  readonly code = 'MOTOR_RATING_MODEL_CONFIGURATION_INVALID' as const;

  constructor(reason: string) {
    super(`Motor rating model configuration is invalid: ${reason}`);
    this.name = 'MotorRatingModelConfigurationError';
  }
}

/**
 * Product-owned execution contract for the compiled Motor rater. These are
 * calculation operators, not insurer rates or values. A published model must
 * declare the complete dependency-safe order; arbitrary drag reordering is
 * deliberately rejected because it could move tax/fees ahead of their base.
 */
export const MOTOR_RATING_PIPELINE = [
  'resolve-excess',
  'liability-premium',
  'own-damage-premium',
  'driver-loadings',
  'term-factor',
  'risk-subtotal',
  'discounts',
  'underwriter-adjustments',
  'endorsement-effects',
  'jurisdiction-charges',
  'total-premium',
] as const;

const MotorRatingPipelineOperatorSchema = z.enum(MOTOR_RATING_PIPELINE);

const MotorProgramRatingTablesSchema = AbbeygateAutoCyprus2022MatrixSchema.extend({
  /** Classic-car rate rows are part of the published programme model, never a runtime file lookup. */
  classicRates: ClassicCarRatesSchema,
});

const MotorProgramRatingModelSchema = z.object({
  id: z.string().min(1),
  programId: z.string().min(1),
  version: z.number().int().positive(),
  binderProductAuthorityId: z.string().min(1),
  stages: z.array(z.object({
    id: MotorRatingPipelineOperatorSchema,
    operator: MotorRatingPipelineOperatorSchema,
  }).strict()).length(MOTOR_RATING_PIPELINE.length),
  tables: MotorProgramRatingTablesSchema,
}).superRefine((model, context) => {
  for (const [index, operator] of MOTOR_RATING_PIPELINE.entries()) {
    const stage = model.stages[index];
    if (stage?.id !== operator || stage.operator !== operator) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stages', index],
        message: `expected ${operator} at pipeline position ${index + 1}`,
      });
    }
  }
});

export type MotorProgramRatingModel = {
  id: string;
  programId: string;
  version: number;
  binderProductAuthorityId: string;
  stages: Array<{ id: typeof MOTOR_RATING_PIPELINE[number]; operator: typeof MOTOR_RATING_PIPELINE[number] }>;
  tables: AbbeygateAutoCyprus2022Matrix & { classicRates: ClassicCarRates };
};

/**
 * The engine-facing boundary for a persisted `ProgramRatingModel`. The
 * database stores JSON, so only the Motor engine defines a valid model.
 */
export function parseMotorProgramRatingModel(value: unknown): MotorProgramRatingModel {
  const parsed = MotorProgramRatingModelSchema.safeParse(value);
  if (!parsed.success) {
    throw new MotorRatingModelConfigurationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'model'}: ${issue.message}`).join('; '),
    );
  }
  return parsed.data;
}
