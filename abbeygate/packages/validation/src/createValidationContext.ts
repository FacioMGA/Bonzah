/**
 * `createValidationContext` — the single factory that wires together every
 * piece of `@facio/validation` into a fully-built validation API.
 *
 * Phase 3 introduced a single environment-specific dependency: the phone
 * validator. Frontend code injects `react-phone-number-input`'s
 * `isPossiblePhoneNumber`; backend code injects a wrapped
 * `libphonenumber-js` `isValidPhoneNumber`. Everything else (rules,
 * resolver, registry, runner) is environment-agnostic and produced from
 * this factory.
 *
 * Consumers do NOT call this factory directly. They import a
 * pre-instantiated context from a subpath export
 * (`@facio/validation/frontend` or `@facio/validation/backend`). See
 * `src/adapters/frontend.ts` and `src/adapters/backend.ts`.
 *
 * The factory is exported so package tests, custom adapters, and
 * future bespoke surfaces (e.g. a CLI validator) can build their own
 * context without going through one of the two named adapters.
 */

import type { ZodTypeAny } from 'zod';

import { Registry } from './registry.js';
import { createRuleRegistry, createResolveRule, type RuleRegistry } from './rules-registry.js';
import { createRunner, type Runner } from './runner.js';
import type { PhoneValidator } from './rules-phone.js';

export type { PhoneValidator } from './rules-phone.js';
export type { Runner, RunnerDeps } from './runner.js';
export type { RuleRegistry } from './rules-registry.js';

export interface ValidationContext {
  /** Per-context registry instance. Each context owns its own product profiles. */
  ValidationRegistry: Registry;
  /** The full rule registry (`ref -> schema`). Exposed for advanced consumers. */
  ruleRegistry: RuleRegistry;
  /** Resolves a rule ref to a Zod schema. */
  resolveRule: (ref: string) => ZodTypeAny;
  /** Validate a slice of data for the given product/stage/actor. */
  validateForContext: Runner['validateForContext'];
  /** RHF helper: clear-then-setError from a `FieldErrors` map. */
  applyValidationErrors: Runner['applyValidationErrors'];
}

export interface ValidationContextDeps {
  phoneValidator: PhoneValidator;
}

/**
 * Build a fully-wired validation context for the supplied phone validator.
 *
 * Implementation:
 *   1. Build a fresh `Registry` (each context owns its own profiles).
 *   2. Build the rule registry from the injected phone validator.
 *   3. Build `resolveRule` over that registry.
 *   4. Build the runner over `resolveRule` + registry.
 *   5. Return the bundled API.
 */
export function createValidationContext(deps: ValidationContextDeps): ValidationContext {
  const ValidationRegistry = new Registry();
  const ruleRegistry = createRuleRegistry({ phoneValidator: deps.phoneValidator });
  const resolveRule = createResolveRule(ruleRegistry);
  const runner = createRunner({ resolveRule, registry: ValidationRegistry });

  return {
    ValidationRegistry,
    ruleRegistry,
    resolveRule,
    validateForContext: runner.validateForContext,
    applyValidationErrors: runner.applyValidationErrors,
  };
}
