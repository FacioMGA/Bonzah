export type ValidationMode = 'blur' | 'save' | 'submit';
export type ValidationSeverity = 'warning' | 'error';

export function requirednessSeverityByMode(mode: ValidationMode): ValidationSeverity {
  if (mode === 'save') return 'warning';
  return 'error';
}

export function schemaSeverityByMode(_mode: ValidationMode): ValidationSeverity {
  // Format/type errors are always errors, even in blur mode.
  return 'error';
}

export function shouldIncludeFieldInBlur(args: { focusField?: string; candidateField: string }): boolean {
  const focus = String(args.focusField || '').trim();
  if (!focus) return false;
  const candidate = String(args.candidateField || '').trim();
  return candidate === focus || candidate.startsWith(`${focus}.`) || focus.startsWith(`${candidate}.`);
}

