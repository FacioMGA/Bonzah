import type { ZodIssue } from 'zod';
import { getQuestionnaireField } from '@/src/shared/lib/products/questionnaire';

// Validation ownership note:
// Keep UX-safe validation message mapping in this module so pages never render
// raw schema/type errors directly.
export function normalizeSchemaIssueMessage(issue: ZodIssue): string {
  return normalizeSchemaMessageText(issue.message, {
    code: issue.code,
    fieldKey: String(issue.path?.[0] ?? '').trim(),
  });
}

export function normalizeSchemaMessageText(
  rawMessage: unknown,
  opts?: { code?: string; fieldKey?: string; productType?: string }
): string {
  const msg = String(rawMessage || '').trim();
  const code = String(opts?.code || '').trim();
  const fieldKey = String(opts?.fieldKey || '').trim();
  if (!msg) return 'Please complete this field.';

  const looksLikeInvalidType =
    code === 'invalid_type' ||
    /invalid input[:\s]/i.test(msg) ||
    /expected .* received /i.test(msg);

  if (looksLikeInvalidType) {
    const type = getQuestionnaireField(opts?.productType, fieldKey)?.type;
    if (type === 'boolean') return 'Please choose Yes or No.';
    if (type === 'select') return 'Please select an option.';
    return 'Please complete this field.';
  }

  if (/required/i.test(msg) && /^invalid input/i.test(msg)) {
    return 'Please complete this field.';
  }
  return msg;
}

