/**
 * Motor field value semantics that are not expressible in the manifest's
 * current `FieldDef` shape.
 *
 * The manifest renders these as selects, so browser/UI events emit strings.
 * The canonical motor schemas validate them as numbers. Keep that conversion
 * here so BO, wizard bridges, and validators do not each invent their own
 * string-to-number rules.
 */
export const MOTOR_NUMERIC_SELECT_FIELD_PATHS = [
  'licenseYears',
  'youngestDriverAge',
  'majorConvictionWithinYears',
] as const;

const MOTOR_NUMERIC_SELECT_FIELD_SET = new Set<string>(MOTOR_NUMERIC_SELECT_FIELD_PATHS);

export function coerceMotorQuestionnaireFieldValue(path: string, value: unknown): unknown {
  if (!MOTOR_NUMERIC_SELECT_FIELD_SET.has(path)) return value;
  if (value === '') return value;
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : value;
}

export function normalizeMotorQuoteDataForValidation(source: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...source };
  for (const path of MOTOR_NUMERIC_SELECT_FIELD_PATHS) {
    if (next[path] === '') {
      next[path] = undefined;
      continue;
    }
    next[path] = coerceMotorQuestionnaireFieldValue(path, next[path]);
  }
  return next;
}
