import {
  insuranceProductDefinitionSchema,
  configuredSubmissionV1Schema,
  configuredSubmissionV2Schema,
  type InsuranceProductDefinition,
  type ConfiguredSubmission,
  type InsuranceEvaluation,
  type DecisionIssue,
} from '../contracts/insurance-definition.js';
import { KernelError } from './canonical.js';
import {
  evaluateInsuranceProduct as evaluateV1,
  validateInsuranceDefinition as validateV1,
  type EvaluationContext as ContextV1,
} from './insurance-decision-v1.js';
import {
  evaluateInsuranceProductV2,
  validateInsuranceDefinitionV2,
} from './insurance-decision-v2.js';

export type EvaluationContext = Omit<ContextV1, 'definition'> & {
  definition: InsuranceProductDefinition;
  purpose?: 'new_business' | 'service';
  serviceEffectiveDate?: string;
};
export function validateInsuranceDefinition(raw: unknown): DecisionIssue[] {
  const parsed = insuranceProductDefinitionSchema.safeParse(raw);
  if (!parsed.success)
    return parsed.error.issues.map((issue) => ({
      code: 'INVALID_DEFINITION',
      path: issue.path.join('.'),
      message: issue.message,
    }));
  return parsed.data.schemaVersion === 'insurance-product-v1'
    ? validateV1(parsed.data)
    : validateInsuranceDefinitionV2(parsed.data);
}
/** The v1 path is deliberately frozen: no normalization/defaults or new date semantics enter old evidence. */
export function evaluateInsuranceProduct(
  context: EvaluationContext,
  submission: ConfiguredSubmission,
): InsuranceEvaluation {
  if (context.definition.schemaVersion === 'insurance-product-v1') {
    const parsed = configuredSubmissionV1Schema.safeParse(submission);
    if (!parsed.success || context.purpose === 'service')
      throw new KernelError(
        'INSURANCE_VERSION_MISMATCH',
        'This retained product requires the original v1 new-business submission contract',
        422,
      );
    return evaluateV1({ ...context, definition: context.definition }, parsed.data);
  }
  const parsed = configuredSubmissionV2Schema.safeParse(submission);
  if (!parsed.success)
    throw new KernelError(
      'INSURANCE_VERSION_MISMATCH',
      'This product requires an explicit insurance-submission-v2 submission',
      422,
    );
  return evaluateInsuranceProductV2({ ...context, definition: context.definition }, parsed.data);
}
