import type { UseFormReturn } from 'react-hook-form';
import type { QuoteData } from './types';
import { validateDriverDraft } from './validation/driverValidation';
import {
  validateWizardDrivingHistoryStep,
  validateWizardPolicyHolderStep,
  validateWizardVehicleCoverStep,
} from '@facio/products';
import { collectErrorEntries, dedupeErrorEntries } from '@/src/shared/lib/wizard/utils/errors';

type ReconcileMode = 'blur' | 'change';

function isRelatedField(candidate: string, focus: string): boolean {
  const left = String(candidate || '').trim();
  const right = String(focus || '').trim();
  if (!left || !right) return false;
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

function normalizeField(input: string): string {
  return String(input || '').trim();
}

function topLevelField(input: string): string {
  const normalized = normalizeField(input);
  return normalized.split('.')[0] || normalized;
}

function setManualFieldError(form: UseFormReturn<QuoteData>, field: string, message: string): void {
  form.setError(field as never, { type: 'manual', message });
}

function clearFieldErrors(form: UseFormReturn<QuoteData>, fields: string[]): void {
  const cleaned = fields.map(normalizeField).filter((field) => field && field !== 'form');
  if (cleaned.length === 0) return;
  form.clearErrors(cleaned as never);
}

function unionFieldNames(...groups: Array<Array<string> | string[]>): string[] {
  const set = new Set<string>();
  groups.forEach((group) => {
    group.forEach((field) => {
      const normalized = normalizeField(field);
      if (!normalized || normalized === 'form') return;
      set.add(normalized);
    });
  });
  return Array.from(set);
}

export function validateWizardStep(step: number, data: QuoteData): Record<string, string> {
  if (step === 1) return validateWizardPolicyHolderStep(data);
  if (step === 2) return validateWizardVehicleCoverStep(data);
  if (step === 3) return validateWizardDrivingHistoryStep(data);
  return {};
}

export function applyWizardStepErrors(form: UseFormReturn<QuoteData>, stepErrors: Record<string, string>): void {
  form.clearErrors();
  for (const [field, message] of Object.entries(stepErrors)) {
    setManualFieldError(form, field, message);
  }
}

export function reconcileWizardStepErrors(args: {
  form: UseFormReturn<QuoteData>;
  currentStep: number;
  changedField: string;
  mode: ReconcileMode;
}): void {
  const changedField = normalizeField(args.changedField);
  if (!changedField) return;

  const topLevel = topLevelField(changedField);
  const stepErrors = validateWizardStep(args.currentStep, args.form.getValues());
  const existingFields = dedupeErrorEntries(collectErrorEntries(args.form.formState.errors)).map((entry) => entry.field);

  const relatedExistingFields = existingFields.filter((field) => isRelatedField(field, changedField) || isRelatedField(field, topLevel));
  const relatedNextFields = Object.keys(stepErrors).filter((field) => isRelatedField(field, changedField) || isRelatedField(field, topLevel));

  const targetFields =
    args.mode === 'blur'
      ? unionFieldNames([changedField, topLevel], relatedExistingFields, relatedNextFields)
      : unionFieldNames(existingFields, [changedField, topLevel], relatedNextFields);

  if (targetFields.length === 0) return;

  clearFieldErrors(args.form, targetFields);
  for (const field of targetFields) {
    const message = stepErrors[field];
    if (!message) continue;
    setManualFieldError(args.form, field, message);
  }
}

export function reconcileAdditionalDriverFieldError(args: {
  form: UseFormReturn<QuoteData>;
  changedField: string;
  mode: ReconcileMode;
  hasFieldError: boolean;
}): boolean {
  const fieldName = normalizeField(args.changedField);
  if (!fieldName.startsWith('additionalDrivers.')) return false;
  if (args.mode === 'change' && !args.hasFieldError) return true;

  const parts = fieldName.split('.');
  const idx = Number(parts[1]);
  const rowField = String(parts[2] || '').trim();
  const formValues = args.form.getValues();
  const rows = Array.isArray(formValues.additionalDrivers) ? formValues.additionalDrivers : [];
  const row = Number.isFinite(idx) ? rows[idx] : undefined;
  if (!Number.isFinite(idx) || !row || !rowField) return true;

  const rowErrors = validateDriverDraft(row || {}, { requireCore: true });
  const rowMessage = rowErrors[rowField as keyof typeof rowErrors];
  if (rowMessage) {
    args.form.setError(fieldName as never, { type: 'manual', message: rowMessage });
  } else {
    args.form.clearErrors(fieldName as never);
  }
  return true;
}
