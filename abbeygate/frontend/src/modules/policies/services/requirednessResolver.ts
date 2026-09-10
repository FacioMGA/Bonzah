import {
  getQuestionnaireFields,
  isFieldRequiredForData,
  isFieldVisibleForData,
} from '@/src/shared/lib/products/questionnaire';

export type ValidationActor = 'customer' | 'underwriter';
export type ValidationStage = 'draft' | 'pricing' | 'quote' | 'bind' | 'wizard' | 'underwriting' | 'issue' | 'endorsement';

export type RequirednessContext = {
  actor: ValidationActor;
  stage: ValidationStage;
  programId?: string;
  productType?: string;
  data?: Record<string, unknown>;
};

export type RequirednessResult = {
  requiredKeys: string[];
  visibleKeys: string[];
};

export function resolveRequiredness(context: RequirednessContext): RequirednessResult {
  const data = context.data ?? {};
  const fields = getQuestionnaireFields(context.productType);
  const visibleKeys = fields
    .filter((field) => isFieldVisibleForData(field, data))
    .map((field) => field.path);
  const requiredKeys = fields
    .filter((field) => isFieldVisibleForData(field, data) && isFieldRequiredForData(field, data))
    .map((field) => field.path);
  return { requiredKeys, visibleKeys };
}

