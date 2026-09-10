import {
  insuranceProductDefinitionV1Schema as insuranceProductDefinitionSchema,
  insuranceEvaluationV1Schema as insuranceEvaluationSchema,
  configuredSubmissionV1Schema as configuredSubmissionSchema,
  decimalValueSchema,
  insuranceDateSchema,
  type InsuranceProductDefinitionV1 as InsuranceProductDefinition,
  type InsuranceRiskField,
  type InsuranceCondition,
  type ConfiguredSubmissionV1 as ConfiguredSubmission,
  type InsuranceEvaluationV1 as InsuranceEvaluation,
  type DecisionIssue,
} from '../contracts/insurance-definition.js';
import { minorUnitSchema } from '../contracts/money.js';
import type { RuntimePolicy } from '../contracts/insurance.js';
import { hash, KernelError } from './canonical.js';

type Answer = string | number | boolean;
type Truth = 'true' | 'false' | 'unknown';
const own = (value: object, key: string) => Object.hasOwn(value, key);
const units = (value: string, scale = 6): bigint => {
  const sign = value.startsWith('-') ? -1n : 1n;
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return (
    sign *
    (BigInt(whole!) * 10n ** BigInt(scale) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale)))
  );
};
export const fraction = (value: string) => {
  const scale = (value.split('.')[1] ?? '').length;
  return { numerator: units(value, scale), denominator: 10n ** BigInt(scale) };
};
export const round = (numerator: bigint, denominator: bigint) => {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator * sign;
  return sign * ((absolute + denominator / 2n) / denominator);
};
export function typed(field: InsuranceRiskField, value: unknown): value is Answer {
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (field.type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value);
  if (field.type === 'decimal') return decimalValueSchema.safeParse(value).success;
  if (field.type === 'money') return minorUnitSchema.safeParse(value).success;
  if (field.type === 'date') return insuranceDateSchema.safeParse(value).success;
  return typeof value === 'string';
}
function compare(field: InsuranceRiskField, a: Answer, b: Answer): number {
  if (field.type === 'decimal') {
    const x = units(String(a)),
      y = units(String(b));
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (field.type === 'money') {
    const x = BigInt(String(a)),
      y = BigInt(String(b));
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a === b ? 0 : a < b ? -1 : 1;
}
export function validValue(field: InsuranceRiskField, value: unknown): boolean {
  if (!typed(field, value)) return false;
  switch (field.type) {
    case 'text':
      return (
        typeof value === 'string' &&
        value.length >= field.minLength &&
        value.length <= field.maxLength
      );
    case 'choice':
      return field.options.some((option) => option.id === value);
    case 'boolean':
      return true;
    case 'integer':
      return Number(value) >= field.minimum && Number(value) <= field.maximum;
    case 'decimal':
      return (
        (String(value).split('.')[1] ?? '').length <= field.scale &&
        units(String(value)) >= units(field.minimum) &&
        units(String(value)) <= units(field.maximum)
      );
    case 'money':
      return (
        BigInt(String(value)) >= BigInt(field.minimumMinor) &&
        BigInt(String(value)) <= BigInt(field.maximumMinor)
      );
    case 'date':
      return String(value) >= field.minimum && String(value) <= field.maximum;
  }
}
export function condition(
  definition: Pick<InsuranceProductDefinition, 'riskFields'>,
  answers: ConfiguredSubmission['answers'],
  when: InsuranceCondition,
): Truth {
  const results = when.conditions.map((predicate) => {
    const field = definition.riskFields.find((item) => item.id === predicate.fieldId);
    if (!field) return 'unknown' as const;
    const present = own(answers, predicate.fieldId);
    if (predicate.kind === 'presence')
      return (predicate.operator === 'present' ? present : !present)
        ? ('true' as const)
        : ('false' as const);
    if (!present || !validValue(field, answers[predicate.fieldId])) return 'unknown' as const;
    const value = answers[predicate.fieldId]!;
    if (predicate.kind === 'membership') {
      const included = predicate.values.some((candidate) => compare(field, value, candidate) === 0);
      return (predicate.operator === 'in' ? included : !included)
        ? ('true' as const)
        : ('false' as const);
    }
    const relation = compare(field, value, predicate.value);
    return {
      eq: relation === 0,
      neq: relation !== 0,
      lt: relation < 0,
      lte: relation <= 0,
      gt: relation > 0,
      gte: relation >= 0,
    }[predicate.operator]
      ? ('true' as const)
      : ('false' as const);
  });
  if (when.mode === 'all')
    return results.includes('false') ? 'false' : results.includes('unknown') ? 'unknown' : 'true';
  return results.includes('true') ? 'true' : results.includes('unknown') ? 'unknown' : 'false';
}
/** Semantic checks supplement strict schemas; no script or expression is interpreted. */
export function validateInsuranceDefinition(raw: unknown): DecisionIssue[] {
  const parsed = insuranceProductDefinitionSchema.safeParse(raw);
  if (!parsed.success)
    return parsed.error.issues.map((issue) => ({
      code: 'INVALID_DEFINITION',
      path: issue.path.join('.'),
      message: issue.message,
    }));
  const definition = parsed.data;
  const issues: DecisionIssue[] = [];
  const add = (path: string, message: string) =>
    issues.push({ code: 'INVALID_DEFINITION', path, message });
  const unique = (items: readonly string[], path: string) => {
    if (new Set(items).size !== items.length) add(path, 'Identifiers must be unique');
  };
  unique(definition.territories, 'territories');
  if (definition.termRules.minimumDays > definition.termRules.maximumDays)
    add('termRules', 'Minimum term duration exceeds maximum duration');
  unique(
    definition.riskFields.map((f) => f.id),
    'riskFields',
  );
  unique(
    definition.coverages.map((c) => c.id),
    'coverages',
  );
  unique(
    [
      ...definition.eligibilityRules.map((r) => r.id),
      ...definition.rating.factors.map((r) => r.id),
    ],
    'rules',
  );
  const fields = new Map(definition.riskFields.map((f) => [f.id, f]));
  const covers = new Map(definition.coverages.map((c) => [c.id, c]));
  for (const field of definition.riskFields) {
    const path = 'riskFields.' + field.id;
    if (field.type === 'text' && field.minLength > field.maxLength)
      add(path, 'Minimum length exceeds maximum length');
    if ((field.type === 'integer' || field.type === 'date') && field.minimum > field.maximum)
      add(path, 'Minimum exceeds maximum');
    if (
      field.type === 'decimal' &&
      (units(field.minimum) > units(field.maximum) ||
        [field.minimum, field.maximum].some((v) => (v.split('.')[1] ?? '').length > field.scale))
    )
      add(path, 'Decimal bounds must be ordered and fit the declared scale');
    if (field.type === 'money' && BigInt(field.minimumMinor) > BigInt(field.maximumMinor))
      add(path, 'Money bounds must be ordered');
    if (field.type === 'choice')
      unique(
        field.options.map((o) => o.id),
        path + '.options',
      );
  }
  for (const cover of definition.coverages) {
    const path = 'coverages.' + cover.id;
    unique(cover.dependsOn, path + '.dependsOn');
    unique(cover.excludes, path + '.excludes');
    if (
      BigInt(cover.limit.minimumMinor) > BigInt(cover.limit.maximumMinor) ||
      BigInt(cover.deductible.minimumMinor) > BigInt(cover.deductible.maximumMinor)
    )
      add(path, 'Coverage limits and deductibles must have ordered bounds');
    if (BigInt(cover.deductible.minimumMinor) > BigInt(cover.limit.maximumMinor))
      add(path, 'Every permitted deductible exceeds this coverage limit');
    for (const ref of [...cover.dependsOn, ...cover.excludes])
      if (ref === cover.id || !covers.has(ref))
        add(path, 'Coverage references must identify a different defined coverage');
    if (cover.dependsOn.some((ref) => cover.excludes.includes(ref)))
      add(path, 'A coverage cannot require and exclude the same coverage');
    if (cover.rate.method === 'per_unit') {
      const quantity = fields.get(cover.rate.quantityFieldId);
      if (!quantity || !['integer', 'decimal'].includes(quantity.type))
        add(path + '.rate', 'Per-unit rating requires an integer or decimal quantity field');
      else if (
        (quantity.type === 'integer' && quantity.minimum < 0) ||
        (quantity.type === 'decimal' && units(quantity.minimum) < 0n)
      )
        add(path + '.rate', 'Rating quantity fields cannot permit negative values');
    }
  }
  const states = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): void => {
    if (states.get(id) === 'visiting') {
      add('coverages.' + id + '.dependsOn', 'Coverage dependencies contain a cycle');
      return;
    }
    if (states.get(id) === 'done') return;
    states.set(id, 'visiting');
    for (const ref of covers.get(id)?.dependsOn ?? []) if (covers.has(ref)) visit(ref);
    states.set(id, 'done');
  };
  for (const cover of definition.coverages) visit(cover.id);
  // Every optional selection must coexist with its dependencies and the required covers.
  const closure = (initial: string[]): Set<string> => {
    const result = new Set<string>();
    const pending = initial.slice();
    while (pending.length) {
      const id = pending.pop()!;
      if (result.has(id)) continue;
      result.add(id);
      pending.push(...(covers.get(id)?.dependsOn ?? []));
    }
    return result;
  };
  const required = definition.coverages.filter((cover) => cover.required).map((cover) => cover.id);
  for (const cover of definition.coverages) {
    const selected = closure([...required, cover.id]);
    if ([...selected].some((id) => covers.get(id)?.excludes.some((ref) => selected.has(ref))))
      add(
        'coverages.' + cover.id,
        'This coverage cannot coexist with the required coverages and dependency set',
      );
  }
  for (const rule of [...definition.eligibilityRules, ...definition.rating.factors])
    for (const predicate of rule.when.conditions) {
      const field = fields.get(predicate.fieldId);
      const path = 'rules.' + rule.id;
      if (!field) {
        add(path, 'Condition references an undefined risk field');
        continue;
      }
      if (predicate.kind === 'presence') continue;
      const values = predicate.kind === 'comparison' ? [predicate.value] : predicate.values;
      if (
        values.some(
          (value) =>
            !typed(field, value) ||
            (field.type === 'choice' && !field.options.some((option) => option.id === value)),
        )
      )
        add(path, 'Condition values must match the declared field type and choices');
      if (
        predicate.kind === 'comparison' &&
        !['eq', 'neq'].includes(predicate.operator) &&
        ['text', 'choice', 'boolean'].includes(field.type)
      )
        add(path, 'Ordered comparisons require numeric or date fields');
    }
  return issues;
}
export type EvaluationContext = {
  productId: string;
  productVersion: string;
  definition: InsuranceProductDefinition;
  policy: RuntimePolicy;
  policyHash: string;
  runtimeReleaseId: string | null;
  releaseHash: string | null;
  now: Date;
};
export function evaluateInsuranceProduct(
  context: EvaluationContext,
  raw: ConfiguredSubmission,
): InsuranceEvaluation {
  const definition = insuranceProductDefinitionSchema.parse(context.definition);
  const submission = configuredSubmissionSchema.parse(raw);
  const definitionIssues = validateInsuranceDefinition(definition);
  if (definitionIssues.length)
    throw new KernelError(
      'INVALID_INSURANCE_DEFINITION',
      'The executable insurance definition failed validation',
      422,
    );
  const issues: DecisionIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const fields = new Map(definition.riskFields.map((field) => [field.id, field]));
  for (const field of definition.riskFields) {
    if (!own(submission.answers, field.id)) {
      if (field.required)
        add('REQUIRED_ANSWER', 'answers.' + field.id, `${field.label} is required`);
    } else if (!validValue(field, submission.answers[field.id]))
      add(
        'INVALID_ANSWER',
        'answers.' + field.id,
        `${field.label} must satisfy its declared type and bounds`,
      );
  }
  for (const fieldId of Object.keys(submission.answers))
    if (!fields.has(fieldId))
      add(
        'UNKNOWN_ANSWER',
        'answers.' + fieldId,
        'This field is not declared by the pinned insurance definition',
      );
  const selected = new Map(submission.coverages.map((cover) => [cover.coverageId, cover]));
  if (!submission.coverages.length)
    add('COVERAGE_REQUIRED', 'coverages', 'Select at least one configured coverage');
  if (selected.size !== submission.coverages.length)
    add('DUPLICATE_COVERAGE', 'coverages', 'Each coverage may be selected once');
  for (const selection of submission.coverages) {
    const cover = definition.coverages.find((item) => item.id === selection.coverageId);
    const path = 'coverages.' + selection.coverageId;
    if (!cover) {
      add('UNKNOWN_COVERAGE', path, 'Coverage is not part of the pinned product');
      continue;
    }
    if (
      BigInt(selection.limitMinor) < BigInt(cover.limit.minimumMinor) ||
      BigInt(selection.limitMinor) > BigInt(cover.limit.maximumMinor)
    )
      add('COVERAGE_LIMIT', path + '.limitMinor', 'Selected limit is outside permitted bounds');
    if (
      BigInt(selection.deductibleMinor) < BigInt(cover.deductible.minimumMinor) ||
      BigInt(selection.deductibleMinor) > BigInt(cover.deductible.maximumMinor) ||
      BigInt(selection.deductibleMinor) > BigInt(selection.limitMinor)
    )
      add(
        'COVERAGE_DEDUCTIBLE',
        path + '.deductibleMinor',
        'Selected deductible is outside permitted bounds or exceeds its limit',
      );
    for (const ref of cover.dependsOn)
      if (!selected.has(ref))
        add('COVERAGE_DEPENDENCY', path, `${cover.name} requires coverage ${ref}`);
    for (const ref of cover.excludes)
      if (selected.has(ref))
        add('COVERAGE_EXCLUSION', path, `${cover.name} excludes coverage ${ref}`);
  }
  for (const cover of definition.coverages)
    if (cover.required && !selected.has(cover.id))
      add('REQUIRED_COVERAGE', 'coverages.' + cover.id, `${cover.name} must be selected`);
  const today = context.now.toISOString().slice(0, 10);
  const applicability: string[] = [];
  if (!definition.territories.includes(submission.territory))
    applicability.push('The risk territory is outside the configured product territory set');
  if (today < context.policy.effectiveFrom || today > context.policy.effectiveTo)
    applicability.push('The runtime policy is not effective on the evaluation date');
  if (
    submission.term.startDate > submission.term.endDate ||
    submission.term.endDate < today ||
    submission.term.startDate < context.policy.effectiveFrom ||
    submission.term.startDate > context.policy.effectiveTo
  )
    applicability.push(
      'The requested term is unordered, expired or starts outside the policy effective window',
    );
  if (Date.parse(submission.expiresAt) <= context.now.getTime())
    applicability.push('The requested quote expiry has passed');
  const termDays =
    (Date.parse(submission.term.endDate) - Date.parse(submission.term.startDate)) / 86400000 + 1;
  if (termDays < definition.termRules.minimumDays || termDays > definition.termRules.maximumDays)
    applicability.push(
      `The inclusive UTC calendar-day term must be between ${definition.termRules.minimumDays} and ${definition.termRules.maximumDays} days`,
    );
  const backdated = submission.term.startDate < today;
  const backdatingApproval = backdated && definition.termRules.backdating === 'requires_approval';
  if (backdated && !backdatingApproval)
    applicability.push('Backdated inception is not permitted by the product definition');
  const rules = definition.eligibilityRules.map((rule) => ({
    ruleId: rule.id,
    outcome: rule.outcome,
    result: condition(definition, submission.answers, rule.when),
    reason: rule.reason,
    sourceRefs: rule.sourceRefs,
  }));
  const declined = rules.some((rule) => rule.result === 'true' && rule.outcome === 'decline');
  const uncertain = rules.some((rule) => rule.result === 'unknown');
  const referrals = rules
    .filter((rule) => rule.result === 'true' && rule.outcome === 'refer')
    .map((rule) => rule.ruleId);
  const factors = definition.rating.factors.map((rule) => ({
    ruleId: rule.id,
    result: condition(definition, submission.answers, rule.when),
    factorBps: rule.factorBps,
    reason: rule.reason,
  }));
  const lines: InsuranceEvaluation['rating']['lines'] = [];
  const ratingReasons: string[] = [];
  if (issues.length)
    ratingReasons.push('Resolve invalid or missing risk and coverage selections before rating');
  if (factors.some((factor) => factor.result === 'unknown'))
    ratingReasons.push('A rating factor depends on an unavailable or invalid answer');
  let subtotal = 0n;
  let premium: bigint | null = null;
  let minimumApplied = false;
  if (!ratingReasons.length) {
    for (const selection of submission.coverages
      .slice()
      .sort((a, b) => (a.coverageId < b.coverageId ? -1 : a.coverageId > b.coverageId ? 1 : 0))) {
      const cover = definition.coverages.find((item) => item.id === selection.coverageId)!;
      let amount = 0n;
      if (cover.rate.method === 'flat') amount = BigInt(cover.rate.premiumMinor);
      else if (cover.rate.method === 'limit_bps')
        amount = round(BigInt(selection.limitMinor) * BigInt(cover.rate.rateBps), 10000n);
      else {
        const value = submission.answers[cover.rate.quantityFieldId];
        if (value === undefined || !validValue(fields.get(cover.rate.quantityFieldId)!, value)) {
          ratingReasons.push(`Missing quantity for coverage ${cover.id}`);
          continue;
        }
        const quantity = fraction(String(value));
        amount = round(
          quantity.numerator * BigInt(cover.rate.premiumPerUnitMinor),
          quantity.denominator,
        );
      }
      if (!minorUnitSchema.safeParse(amount.toString()).success) {
        ratingReasons.push(`Coverage ${cover.id} exceeds supported exact money bounds`);
        continue;
      }
      lines.push({
        coverageId: cover.id,
        method: cover.rate.method,
        premiumMinor: amount.toString(),
      });
      subtotal += amount;
    }
    if (!ratingReasons.length) {
      let numerator = subtotal;
      let denominator = 1n;
      for (const factor of factors)
        if (factor.result === 'true') {
          numerator *= BigInt(factor.factorBps);
          denominator *= 10000n;
        }
      premium = round(numerator, denominator);
      const minimum = BigInt(definition.rating.minimumPremiumMinor);
      if (premium < minimum) {
        premium = minimum;
        minimumApplied = true;
      }
      if (!minorUnitSchema.safeParse(premium.toString()).success) {
        ratingReasons.push('Calculated premium exceeds supported exact money bounds');
        premium = null;
      }
    }
  }
  const authorityReasons: string[] = [];
  if (premium !== null && premium > BigInt(definition.authority.maximumPremiumMinor))
    authorityReasons.push('Calculated premium exceeds the configured delegated authority');
  const totalLimit = submission.coverages.reduce(
    (sum, cover) => sum + BigInt(cover.limitMinor),
    0n,
  );
  if (!issues.length && totalLimit > BigInt(definition.authority.maximumTotalLimitMinor))
    authorityReasons.push(
      'Sum of selected coverage limits exceeds the configured delegated authority',
    );
  if (premium !== null && premium > BigInt(context.policy.maximumPremiumMinor))
    authorityReasons.push('Calculated premium exceeds the runtime operating policy limit');
  const authority =
    issues.length || premium === null
      ? 'undetermined'
      : authorityReasons.length
        ? 'referral_required'
        : 'within_authority';
  const approval =
    backdatingApproval ||
    referrals.length ||
    authority === 'referral_required' ||
    Object.values(context.policy.requirements).some((value) => value !== 'not_required')
      ? 'required_unsupported'
      : uncertain || authority === 'undetermined'
        ? 'undetermined'
        : 'not_required';
  const bindReasons = [
    ...issues.map((issue) => issue.message),
    ...applicability,
    ...ratingReasons,
    ...authorityReasons,
  ];
  if (declined) bindReasons.push('A configured decline rule matched');
  if (uncertain)
    bindReasons.push(
      'A configured underwriting rule cannot be evaluated from the supplied answers',
    );
  if (referrals.length)
    bindReasons.push('A configured referral requires an approved review workflow');
  if (backdatingApproval)
    bindReasons.push('Backdated inception requires an approved review workflow');
  if (approval !== 'not_required')
    bindReasons.push(
      'Required approval or provider prerequisites are not available in this engine',
    );
  const content = {
    engineVersion: 'insurance-decision-v1' as const,
    productId: context.productId,
    productVersion: context.productVersion,
    definitionHash: hash(definition),
    policyHash: context.policyHash,
    runtimeReleaseId: context.runtimeReleaseId,
    releaseHash: context.releaseHash,
    inputHash: hash(submission),
    evaluatedOn: today,
    validation: { status: issues.length ? 'invalid' : 'valid', issues },
    applicability: {
      status: applicability.length ? 'inapplicable' : 'applicable',
      reasons: applicability,
    },
    eligibility: { status: declined ? 'declined' : uncertain ? 'undetermined' : 'eligible', rules },
    referral: {
      status: referrals.length ? 'required' : uncertain ? 'undetermined' : 'not_required',
      ruleIds: referrals,
    },
    rating: {
      status: premium === null ? 'blocked' : 'calculated',
      currency: context.policy.currency,
      premiumMinor: premium?.toString() ?? null,
      lines,
      factors,
      minimumApplied,
      rounding: 'half-away-from-zero',
      termBasis: 'whole_term',
      reasons: ratingReasons,
    },
    authority: { status: authority, reasons: authorityReasons },
    approval: { status: approval },
    bind: {
      status: bindReasons.length ? 'blocked' : 'allowed',
      reasons: [...new Set(bindReasons)],
    },
  };
  return insuranceEvaluationSchema.parse({ ...content, evaluationHash: hash(content) });
}
