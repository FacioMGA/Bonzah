/**
 * Validation profile types.
 *
 * A `ValidationProfile` is the per-product declarative contract that drives
 * every validation surface (customer wizard, BO Underwriting tab, backend
 * draft + issuance checks). The runner reads this profile and builds a
 * Zod schema on demand.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Ownership boundary (Amendment #1 — hard rule, not a suggestion)
 * ────────────────────────────────────────────────────────────────────────
 *
 * `ValidationProfile` owns VALIDATION SEMANTICS ONLY. That is:
 *
 *     - per-field rule refs (which atom governs this field)
 *     - per-field requiredness (by stage OR by the `required` flag)
 *     - per-field audience (customer / underwriter / all)
 *     - cross-field refinements (the named escape hatch)
 *     - wizard-step field sets (WHICH fields count at step N)
 *     - lifecycle-stage field sets (WHICH fields count at bind / issuance)
 *
 * NB: as of Phase 2.5 (Apr 2026), `canonicalShape` is gone. Profiles
 * validate the canonical shape directly. Data canonicalization happens
 * once at write time (Prisma migrations + HTTP boundary rejection), never
 * inside the runner.
 *
 * Everything else explicitly belongs somewhere else:
 *
 *     - RENDERING (labels, placeholders, options, field order in the UI,
 *       icons, tooltips, conditional UI visibility for the user)
 *         -> belongs to the ProductManifest + the renderer component.
 *     - PRODUCT WIRING (adapter creation, pricing calls, document packs,
 *       endorsement catalogues, claim defaults)
 *         -> belongs to the product's `runtime.ts` + adapter.
 *     - WORKFLOW (which stage a policy can transition to next, who can
 *       trigger it, side-effects like "send an email when policy issues")
 *         -> belongs to the policy-lifecycle state machine.
 *     - DATA SHAPE (how the quote is nested, naming of DB columns, etc.)
 *         -> belongs to the manifest and the Prisma schema.
 *
 * FORBIDDEN ADDITIONS to this type (enforced by code review + the
 * guardrail at tools/quality/check-validation-purity.mjs, which scans
 * packages/validation/src):
 *
 *     - UI rendering hints (labels are OK on FieldContract for error
 *       summaries, but placeholder/options/order etc. are not)
 *     - Workflow transitions, actor permission logic, email triggers
 *     - Product registry wiring, rating definitions, document types
 *     - Any function that performs IO (network, storage, crypto)
 *
 * When in doubt: if removing the field from this type would not break
 * "is this quote valid?", it does not belong here.
 * ────────────────────────────────────────────────────────────────────────
 */

import type { RefinementCtx } from 'zod';

/** What we're validating for — a step of the wizard or a lifecycle stage. */
export type ValidationStage =
  | { kind: 'wizardStep'; id: string }
  | { kind: 'stage'; id: LifecycleStageId };

export type LifecycleStageId = 'draft' | 'pricing' | 'quote' | 'bind' | 'issuance';

/** Who the answer came from. Drives visibility filtering for audience-scoped fields. */
export type ValidationActor = 'customer' | 'underwriter' | 'server';

/**
 * One field's declarative validation metadata.
 *
 * `rule` is a reference into the atomic rule library. Parameterised rules
 * use a `:` suffix, e.g. `'postcode:portugal'`, `'dob:18-85'`.
 *
 * AUDIENCE (Amendment #3):
 *   - 'all' (default): validated for customer AND underwriter.
 *   - 'customer': validated only when actor='customer' (e.g. marketing
 *     consent — underwriters should not be asked about it).
 *   - 'underwriter': validated only when actor='underwriter' (e.g. internal
 *     risk notes).
 *   - actor='server' always sees every field (server is authoritative).
 *
 * METADATA-ONLY FIELDS (Amendment #7 — Phase 1 absorption):
 *   When `rule` is omitted, the field is registered with the runner for
 *   metadata purposes only. The runner skips the schema-build step for
 *   metadata-only fields, so atomic-rule validation does not run for
 *   them — typically because a step-level refinement already owns the
 *   validation (e.g. Motor's Step1/2/3 schemas). Selectors that read
 *   `requiredAtStages` / `requiredAtByActor` / `audience` for "what is
 *   required for this context?" still see the entry.
 *
 *   This is the absorption surface for the deprecated Gen1 questionnaire
 *   contract. After Phase 1, no parallel "questionnaire contract" exists;
 *   per-product validation profiles are the single source of truth.
 */
export interface FieldContract {
  /** RHF-style dot path into the quote data, e.g. `proposer.firstName`. */
  path: string;
  /**
   * Rule ref (see `rules-pure.ts` / `rules-registry.ts` -> `resolveRule`).
   * Omit for metadata-only fields whose validation is handled by a step
   * refinement.
   */
  rule?: string;
  /** If omitted, the field is optional; provide `true` to always require. */
  required?: boolean;
  /** Stages at which this field must be present. Additive to `required`. */
  requiredAtStages?: LifecycleStageId[];
  /**
   * Per-actor stage requirements. Honoured in addition to `requiredAtStages`:
   * a field is required for `(actor, stage)` if either map matches.
   * Use this when "the customer must answer X by quote, but the underwriter
   * is allowed to leave it blank until bind."
   */
  requiredAtByActor?: Partial<Record<ValidationActor, LifecycleStageId[]>>;
  /** Customer-only / underwriter-only visibility. Default `'all'`. */
  audience?: 'all' | 'customer' | 'underwriter';
  /**
   * Origin tag carried over from the Gen1 absorption. `canonical` fields
   * are part of the canonical data shape; `declaration` fields are consent
   * acknowledgements; `shortcut` fields are deprecated wizard fast-paths
   * superseded by `replacedBy`. Used by selectors that need to know which
   * questions count toward "complete" totals.
   */
  dataClassification?: 'canonical' | 'shortcut' | 'declaration' | 'product-specific';
  /**
   * If a richer canonical field has replaced this question, name the
   * canonical field's path here. Renderers use this to hide the shortcut
   * once the canonical path has data.
   */
  replacedBy?: string;
  /** Optional human label — used for error summaries only. NOT a rendering hint. */
  label?: string;
}

/**
 * Cross-field refinement callback.
 *
 * SCOPE RULE (Amendment #2 — enforced by convention):
 *   - USE field combinators (`requiredIf`, `visibleIf`) when the rule
 *     depends on ONE other field and the logic is trivial.
 *   - USE a profile-level refinement (named function passed here) for
 *     anything that:
 *       * involves more than two fields, or
 *       * encodes underwriting/product business policy, or
 *       * is non-obvious ("if claims-count > 2 in last 5y, require a
 *         narrative text").
 *
 *   A refinement is just a function — give it a meaningful NAME, write
 *   it in `profile.ts`, and test it. Anonymous multi-line predicates in
 *   `refinements: [(data, ctx) => { ... }]` blocks are a code smell.
 *
 * The runner calls these AFTER the atomic rules have run.
 *   - `data`: the flat object the runner is validating. Keys are the same
 *     dotted paths declared in the step's `fields`.
 *   - `ctx`: Zod's `RefinementCtx`. Add issues via
 *     `ctx.addIssue({ code, path: ['proposer.firstName'], message })`.
 *   - `extras.raw`: the original un-flattened canonical data. Use this
 *     when you want to reuse a legacy validator that expects the full
 *     nested shape (Motor's Step1/2/3Schema takes this path).
 *
 * Refinement-authored issues targeting audience-hidden fields are
 * silently dropped by the runner (Amendment #3).
 */
export type RefinementFn = (
  data: Record<string, unknown>,
  ctx: RefinementCtx,
  extras: { raw: unknown },
) => void;

/** One wizard step's declarative definition. */
export interface WizardStepDefinition {
  /** Stable id matching the wizard's step identifier, e.g. `policy-holder`. */
  id: string;
  /** RHF paths this step owns — same set used by handleNext guards. */
  fields: string[];
  /** Named cross-field refinements. See RefinementFn docstring for scope. */
  refinements?: Array<RefinementFn>;
}

/** One lifecycle stage's declarative definition. */
export interface LifecycleStageDefinition {
  fields: string[];
  refinements?: Array<RefinementFn>;
}

/**
 * The per-product validation profile.
 *
 * Retrieved via `ValidationRegistry.get(productCode)`. The runner composes
 * a Zod schema on demand from `fields` + a step or stage's subset.
 */
export interface ValidationProfile {
  productCode: string;

  /** All known fields for this product, keyed by RHF path. */
  fields: Record<string, FieldContract>;

  /** Wizard step definitions. */
  steps: WizardStepDefinition[];

  /** Lifecycle stage definitions. */
  stages: Partial<Record<LifecycleStageId, LifecycleStageDefinition>>;
}

/**
 * Flat error map returned to RHF.
 *
 * ERROR CONTRACT (Amendment #5 — formalised, with runner tests pinning it)
 *
 * Shape: `Record<path, message>` where:
 *
 *   - PATH FORMAT: RHF dot notation. Nested paths flatten with `.`
 *     (`proposer.address.line1`). Array indices encode as numeric
 *     segments (`additionalDrivers.0.firstName`). No bracket notation.
 *   - ONE MESSAGE PER PATH: if multiple issues target the same path,
 *     the FIRST one wins. Later issues are silently dropped.
 *   - STABLE ORDER: insertion-preserving (fields in the order the
 *     profile declares them, then refinement-authored issues in
 *     emission order). Callers may rely on iteration order.
 *   - OBJECT-LEVEL / REFINEMENT ERRORS with empty `issue.path` collapse
 *     to the reserved key `'form'`.
 *   - NO ALIASES: the profile's declared paths are the canonical
 *     address. There is no renaming or normalisation.
 */
export type FieldErrors = Record<string, string>;

/** Runner input. */
export interface ValidateContextInput {
  productCode: string;
  stage: ValidationStage;
  actor: ValidationActor;
  data: unknown;
  /**
   * When present, the runner narrows results to the supplied field only.
   * Used by BO Underwriting tab's `validateFieldOnBlur` so other untouched
   * fields aren't flagged during typing.
   *
   * NOTE: Cross-field errors that land on OTHER paths — even when the
   * focused field is an input to the refinement — are suppressed during
   * blur. They re-surface on save/next-click where `focusField` is absent.
   */
  focusField?: string;
}
