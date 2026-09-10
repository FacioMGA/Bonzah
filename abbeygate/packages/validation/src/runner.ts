/**
 * Unified validation runner.
 *
 * One factory entry point, four callers:
 *   - Customer wizard `handleNext` guards.
 *   - BO Underwriting tab `validateFieldOnBlur` + save path.
 *   - Backend draft validation.
 *   - Backend issuance validation.
 *
 * Phase 3 change (2026-04-27): the runner is now created via
 * `createRunner({ resolveRule, registry })`. The dependency injection
 * lets `@facio/validation` host one runner shape across both the FE and
 * BE adapters while keeping the env-specific phone validator out of this
 * file. Consumers continue to call
 * `validateForContext({ productCode, stage, actor, data, focusField? })`
 * and get back a `FieldErrors` map ready to feed into RHF `setError`.
 *
 * The runner's formal contracts are documented in
 * `docs/engineering/VALIDATION.md`. In short:
 *
 *   - Error contract (see Amendment #5):
 *     - Paths use RHF dot notation including numeric indices
 *       (`additionalDrivers.0.firstName`).
 *     - At most ONE message per path — first issue wins.
 *     - Order is insertion-preserving: fields in the order the profile
 *       declares them, followed by refinement-produced issues in
 *       emission order.
 *     - Object-level or refinement issues with an empty `issue.path`
 *       collapse to the reserved key `'form'`.
 *     - No alias or normalized paths — the profile's declared paths are
 *       the canonical address.
 *
 *   - Actor semantics (see Amendment #3):
 *     - Stage gates WHICH fields are in scope; actor gates WHICH OF those
 *       are visible.
 *     - Atomic-rule validation is skipped for fields whose `audience`
 *       excludes the actor. `server` sees everything.
 *     - Refinements run on the full (un-filtered) data because they
 *       often need siblings for cross-field logic. Refinement-authored
 *       errors that land on audience-hidden paths are DROPPED by the
 *       runner — refinements cannot leak hidden-field issues to an
 *       actor who cannot see them.
 *     - `focusField` narrows the output to just that path. This is a
 *       UX helper for blur handlers; cross-field errors attached to
 *       OTHER paths are suppressed during blur and will re-surface on
 *       save / next-click validation.
 *
 *   - Canonicalization (Amendment #4 — REPEALED in Phase 2.5):
 *     - `profile.canonicalShape` no longer exists. The runner does NOT
 *       coerce / normalize / lift incoming data. Profiles must validate
 *       the canonical shape directly. Data canonicalization happens once,
 *       at write time, via Prisma migrations and the HTTP boundary.
 *     - The runner's only built-in normalisation is: for REQUIRED
 *       fields, undefined/null -> "" so atomic string rules can emit
 *       friendly "please enter …" messages. That's it.
 */

import { z, type ZodTypeAny } from 'zod';
import type { Registry } from './registry.js';
import type {
  FieldContract,
  FieldErrors,
  LifecycleStageDefinition,
  RefinementFn,
  ValidateContextInput,
  ValidationActor,
  ValidationProfile,
  WizardStepDefinition,
} from './types.js';

/**
 * Traverse `data` by dot path. Matches RHF's path semantics.
 * `proposer.address.line1` -> data.proposer.address.line1
 *
 * Array indices encoded as dotted numeric segments work too
 * (`additionalDrivers.0.firstName`).
 */
function readPath(data: unknown, path: string): unknown {
  if (!data || typeof data !== 'object') return undefined;
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      current = current[idx];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function stageRequiresField(
  contract: FieldContract,
  stage: ValidateContextInput['stage'],
  actor: ValidationActor,
): boolean {
  if (contract.required === true) return true;
  if (stage.kind !== 'stage') return false;
  const requiredAt = contract.requiredAtStages || [];
  if (requiredAt.includes(stage.id)) return true;
  // Per-actor stage requirements absorbed from the Gen1 questionnaire
  // contract. Server is treated as the union of all actor requirements
  // (the server is authoritative — if any actor must answer, the server
  // must validate it).
  const byActor = contract.requiredAtByActor;
  if (!byActor) return false;
  if (actor === 'server') {
    return Object.values(byActor).some((stages) => stages?.includes(stage.id));
  }
  const stages = byActor[actor];
  return Boolean(stages && stages.includes(stage.id));
}

function isFieldVisibleToActor(contract: FieldContract, actor: ValidationActor): boolean {
  const aud = contract.audience || 'all';
  if (aud === 'all') return true;
  if (actor === 'server') return true;
  return aud === actor;
}

function resolveFieldSet(
  profile: ValidationProfile,
  stage: ValidateContextInput['stage'],
): { fields: string[]; refinements: RefinementFn[] } {
  if (stage.kind === 'wizardStep') {
    const step = profile.steps.find((s) => s.id === stage.id) as WizardStepDefinition | undefined;
    if (!step) return { fields: [], refinements: [] };
    return { fields: step.fields, refinements: step.refinements || [] };
  }
  const stageDef = profile.stages[stage.id] as LifecycleStageDefinition | undefined;
  if (!stageDef) return { fields: [], refinements: [] };
  return { fields: stageDef.fields, refinements: stageDef.refinements || [] };
}

function flattenIssues(error: z.ZodError, allowedPaths: Set<string>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    let path: string;
    if (issue.path.length === 0) {
      path = 'form';
    } else if (issue.path.length === 1) {
      path = String(issue.path[0]);
    } else {
      path = issue.path.map(String).join('.');
    }
    if (!allowedPaths.has(path) && allowedPaths.has(String(issue.path[0] ?? ''))) {
      path = String(issue.path[0]);
    }
    if (!(path in out)) out[path] = issue.message;
  }
  return out;
}

function flattenForValidation(data: unknown, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of fields) {
    out[path] = readPath(data, path);
  }
  return out;
}

export interface Runner {
  validateForContext(input: ValidateContextInput): FieldErrors;
  applyValidationErrors(
    form: {
      clearErrors: (path?: string | string[]) => void;
      setError: (path: string, error: { type?: string; message: string }) => void;
    },
    errors: FieldErrors,
  ): void;
}

export interface RunnerDeps {
  /** Per-context resolver (built by `createResolveRule(createRuleRegistry({ phoneValidator }))`). */
  resolveRule: (ref: string) => ZodTypeAny;
  /** Per-context registry instance. */
  registry: Registry;
}

/**
 * Build a runner bound to the supplied dependencies. Exposes the public
 * `validateForContext` and `applyValidationErrors` API consumers expect.
 */
export function createRunner(deps: RunnerDeps): Runner {
  const { resolveRule, registry } = deps;

  /**
   * Produce a Zod schema for a single field. If the contract marks the
   * field as required for this stage, we refuse empty values; otherwise
   * empty is OK.
   *
   * For required fields, we coerce undefined/null to empty string so the
   * atomic rules (which all validate strings with friendly messages) emit
   * their own "Please enter …" message instead of Zod's generic type
   * error. Boolean rules degrade gracefully — they'll still fail, just
   * with the standard Zod message, which is fine for the rare
   * required-boolean case.
   */
  function schemaForField(contract: FieldContract, required: boolean): ZodTypeAny | null {
    if (!contract.rule) {
      if (!required) return null;
      // Metadata-only fields don't carry an atomic rule; the runner only
      // checks "is there a value?". Accept any defined, non-empty value
      // — strings, numbers, booleans, arrays, objects — so numeric
      // fields like `vehicleValue` / `engineSize` pass without being
      // coerced to strings.
      const message = contract.label ? `${contract.label} is required` : 'This field is required';
      return z.custom((value) => !isEmptyValue(value), { message });
    }
    const base = resolveRule(contract.rule);
    if (required) {
      return z.preprocess(
        (value) => (value === undefined || value === null ? '' : value),
        base,
      );
    }
    return z.preprocess(
      (value) => (isEmptyValue(value) ? undefined : value),
      base.optional(),
    );
  }

  /**
   * Build a flat Zod object whose keys are the dot-path field refs.
   * We validate on flattened keys and then re-project back to the dotted
   * form in `flattenIssues`, which keeps the runner independent of how
   * products nest their data.
   */
  function buildFlatObject(
    fields: string[],
    profile: ValidationProfile,
    stage: ValidateContextInput['stage'],
    actor: ValidationActor,
  ): ZodTypeAny {
    const shape: Record<string, ZodTypeAny> = {};
    for (const path of fields) {
      const contract = profile.fields[path];
      if (!contract) continue;
      if (!isFieldVisibleToActor(contract, actor)) continue;
      const required = stageRequiresField(contract, stage, actor);
      const schema = schemaForField(contract, required);
      if (schema) shape[path] = schema;
    }
    return z.object(shape).passthrough();
  }

  function validateForContext(input: ValidateContextInput): FieldErrors {
    const profile = registry.get(input.productCode);
    if (!profile) {
      // Post-`spine/v2` Wave 2 every product registers a profile at
      // module load (`backend/products/registerProducts.ts` + FE
      // `register.ts`). A missing profile is an integrity error, not a
      // migration state. Failing loud here closes the last fail-open
      // path through the validation runtime (cutover convergence gate).
      throw new Error(
        `[validation] no ValidationProfile registered for productCode='${input.productCode}'. ` +
        `Register the product at module-load (see backend/products/registerProducts.ts) ` +
        `before calling validateForContext.`,
      );
    }

    const { fields, refinements } = resolveFieldSet(profile, input.stage);
    if (fields.length === 0 && refinements.length === 0) return {};

    let composed: ZodTypeAny = buildFlatObject(fields, profile, input.stage, input.actor);
    for (const refinement of refinements) {
      composed = composed.superRefine((data, ctx) =>
        refinement(data as Record<string, unknown>, ctx, { raw: input.data }),
      );
    }
    const flat = flattenForValidation(input.data, fields);
    const result = composed.safeParse(flat);

    if (result.success) return {};

    const allowed = new Set<string>([...fields, 'form']);
    const rawErrors = flattenIssues(result.error, allowed);

    const errors: FieldErrors = {};
    for (const [path, message] of Object.entries(rawErrors)) {
      const contract = profile.fields[path];
      if (contract && !isFieldVisibleToActor(contract, input.actor)) continue;
      errors[path] = message;
    }

    if (input.focusField) {
      const focused: FieldErrors = {};
      if (errors[input.focusField]) focused[input.focusField] = errors[input.focusField];
      return focused;
    }
    return errors;
  }

  function applyValidationErrors(
    form: {
      clearErrors: (path?: string | string[]) => void;
      setError: (path: string, error: { type?: string; message: string }) => void;
    },
    errors: FieldErrors,
  ): void {
    form.clearErrors();
    for (const [path, message] of Object.entries(errors)) {
      form.setError(path, { type: 'manual', message });
    }
  }

  return { validateForContext, applyValidationErrors };
}
