/**
 * `@facio/validation/frontend` — pre-built validation context for the browser.
 *
 * Frontend code imports from this subpath. The adapter:
 *   1. Pulls `isPossiblePhoneNumber` from `react-phone-number-input` (the
 *      same helper the customer wizard's `<PhoneInput>` uses, so the
 *      structural verdict matches the input UX).
 *   2. Calls `createValidationContext({ phoneValidator })` once at module
 *      load.
 *   3. Re-exports the resolved API (`validateForContext`,
 *      `applyValidationErrors`, `resolveRule`, `ValidationRegistry`) plus
 *      every env-agnostic export from `@facio/validation` (types + pure
 *      rules + factories) so consumers only need one import line:
 *
 *        import {
 *          validateForContext,
 *          ValidationRegistry,
 *          Email,
 *          type ValidationProfile,
 *        } from '@facio/validation/frontend';
 *
 * The instance returned here is shared across all FE consumers — there is
 * one ValidationRegistry per process (the FE bundle), exactly as the
 * pre-Phase-3 code expected.
 */

import { isPossiblePhoneNumber } from 'react-phone-number-input';

import { createValidationContext } from '../createValidationContext.js';

const ctx = createValidationContext({ phoneValidator: isPossiblePhoneNumber });

export const ValidationRegistry = ctx.ValidationRegistry;
export const ruleRegistry = ctx.ruleRegistry;
export const resolveRule = ctx.resolveRule;
export const validateForContext = ctx.validateForContext;
export const applyValidationErrors = ctx.applyValidationErrors;

/**
 * The resolved E.164 phone schema, pre-bound to the FE's
 * `react-phone-number-input` validator. Exposed as a convenience for the
 * rare consumer that wants the schema directly (e.g. legacy `rules.ts`
 * tests) — most callers should reference the rule by ref (`phoneE164`)
 * via `resolveRule` / a profile entry.
 */
export const PhoneE164 = ctx.resolveRule('phoneE164');

export * from '../index.js';
