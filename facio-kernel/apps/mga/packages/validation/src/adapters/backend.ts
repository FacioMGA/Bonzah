/**
 * `@facio/validation/backend` — pre-built validation context for Node.js.
 *
 * Backend code imports from this subpath. The adapter:
 *   1. Pulls `isValidPhoneNumber` from `libphonenumber-js` directly so we
 *      do not pull the React-flavoured `react-phone-number-input` package
 *      server-side.
 *   2. Wraps it in try/catch to mirror the historical
 *      `isPossiblePhoneNumber` semantics (some inputs cause
 *      libphonenumber-js to throw rather than return false).
 *   3. Calls `createValidationContext({ phoneValidator })` once at module
 *      load.
 *   4. Re-exports the resolved API plus every env-agnostic export from
 *      `@facio/validation` so consumers only need one import line:
 *
 *        import {
 *          validateForContext,
 *          ValidationRegistry,
 *          Email,
 *          type ValidationProfile,
 *        } from '@facio/validation/backend';
 *
 * The instance returned here is shared across all BE consumers — there is
 * one ValidationRegistry per process (the BE entry point), exactly as the
 * pre-Phase-3 code expected.
 */

import { isValidPhoneNumber } from 'libphonenumber-js';

import { createValidationContext } from '../createValidationContext.js';

function safeIsValidPhoneNumber(raw: string): boolean {
  try {
    return isValidPhoneNumber(raw);
  } catch {
    return false;
  }
}

const ctx = createValidationContext({ phoneValidator: safeIsValidPhoneNumber });

export const ValidationRegistry = ctx.ValidationRegistry;
export const ruleRegistry = ctx.ruleRegistry;
export const resolveRule = ctx.resolveRule;
export const validateForContext = ctx.validateForContext;
export const applyValidationErrors = ctx.applyValidationErrors;

/**
 * The resolved E.164 phone schema, pre-bound to the BE's
 * `libphonenumber-js` validator. Exposed as a convenience for the rare
 * consumer that wants the schema directly — most callers should reference
 * the rule by ref (`phoneE164`) via `resolveRule` / a profile entry.
 */
export const PhoneE164 = ctx.resolveRule('phoneE164');

export * from '../index.js';
