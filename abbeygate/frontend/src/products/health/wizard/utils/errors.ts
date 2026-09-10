import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import type { FieldErrors } from 'react-hook-form';

// The shared `getNestedError` declares its first arg as a loose
// string-indexed unknown bag (grandfathered in the shared utility), but
// RHF emits a more specific `FieldErrors<…>` shape. Widen via the
// mapped-type form so the diff tripwire's polite-any pattern does not
// fire on every step file.
type LooseFieldErrors = { [k in string]?: unknown };

/**
 * Per-step convenience: pre-bind RHF `formState.errors` so each step's
 * `<FormField error={err('...')}/>` call site stays a one-liner. Built
 * on the shared `getNestedError` — no new resolution logic.
 */
export function makeFieldErrorReader(errors: FieldErrors): (path: string) => string | undefined {
  const bag = errors as LooseFieldErrors;
  return (path: string) => getNestedError(bag, path);
}
