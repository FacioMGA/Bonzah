import {
  insuranceProductDefinitionV2Schema,
  configuredSubmissionV2Schema,
  insuranceEvaluationV2Schema,
  type InsuranceProductDefinitionV2,
  type ConfiguredSubmissionV2,
  type InsuranceEvaluationV2,
  type InsuranceRiskFieldV2,
  type InsuranceCondition,
  type DecisionIssue,
  type SelectionScope,
} from '../contracts/insurance-definition.js';
import type { RuntimePolicy } from '../contracts/insurance.js';
import { minorUnitSchema } from '../contracts/money.js';
import { canonicalJson, hash, KernelError } from './canonical.js';
import { validValue, typed, condition, fraction, round } from './insurance-decision-v1.js';

type Truth = 'true' | 'false' | 'unknown';
type Answers = ConfiguredSubmissionV2['answers'];
const policyScope: SelectionScope = { kind: 'policy' };
const key = (scope: SelectionScope) => canonicalJson(scope);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const issue = (path: string, message: string, code = 'INVALID_DEFINITION'): DecisionIssue => ({
  code,
  path,
  message,
});
const stripped = (field: InsuranceRiskFieldV2) => {
  const { visibleWhen: _, requiredWhen: __, ...plain } = field;
  return plain;
};
const cond = (fields: InsuranceRiskFieldV2[], answers: Answers, when: InsuranceCondition) =>
  condition({ riskFields: fields.map(stripped) }, answers, when);
export const termDays = (start: string, end: string) =>
  (Date.parse(end) - Date.parse(start)) / 86400000 + 1;

export function validateInsuranceDefinitionV2(raw: unknown): DecisionIssue[] {
  const parsed = insuranceProductDefinitionV2Schema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((i) => issue(i.path.join('.'), i.message));
  const d = parsed.data,
    issues: DecisionIssue[] = [];
  const add = (path: string, message: string) => issues.push(issue(path, message));
  const unique = (ids: string[], path: string) => {
    if (new Set(ids).size !== ids.length) add(path, 'Identifiers must be unique within this scope');
  };
  unique(d.territories, 'territories');
  unique(
    d.riskGroups.map((g) => g.id),
    'riskGroups',
  );
  unique(
    d.coverages.map((c) => c.id),
    'coverages',
  );
  if (d.termRules.minimumDays > d.termRules.maximumDays)
    add('termRules', 'Minimum duration exceeds maximum duration');
  if (!d.riskFields.length && !d.riskGroups.length)
    add('riskFields', 'Declare at least one policy question or repeated risk group');
  const validateCondition = (
    fields: InsuranceRiskFieldV2[],
    when: InsuranceCondition,
    path: string,
  ) => {
    for (const p of when.conditions) {
      const field = fields.find((f) => f.id === p.fieldId);
      if (!field) {
        add(path, 'Condition refers to a question outside its own policy or risk-row scope');
        continue;
      }
      if (p.kind === 'presence') continue;
      const values = p.kind === 'comparison' ? [p.value] : p.values;
      if (
        values.some(
          (v) =>
            !typed(field, v) || (field.type === 'choice' && !field.options.some((o) => o.id === v)),
        )
      )
        add(path, 'Condition value does not match the question type or options');
      if (
        p.kind === 'comparison' &&
        !['eq', 'neq'].includes(p.operator) &&
        ['text', 'choice', 'boolean'].includes(field.type)
      )
        add(path, 'Ordered conditions require a numeric or date question');
    }
  };
  const validateFields = (fields: InsuranceRiskFieldV2[], path: string) => {
    unique(
      fields.map((f) => f.id),
      path,
    );
    for (const f of fields) {
      const p = path + '.' + f.id;
      if (f.type === 'text' && f.minLength > f.maxLength)
        add(p, 'Minimum length exceeds maximum length');
      if ((f.type === 'integer' || f.type === 'date') && f.minimum > f.maximum)
        add(p, 'Minimum exceeds maximum');
      if (f.type === 'money' && BigInt(f.minimumMinor) > BigInt(f.maximumMinor))
        add(p, 'Money bounds are reversed');
      if (f.type === 'decimal') {
        const a = fraction(f.minimum),
          b = fraction(f.maximum);
        if (
          a.numerator * b.denominator > b.numerator * a.denominator ||
          [f.minimum, f.maximum].some((v) => (v.split('.')[1] ?? '').length > f.scale)
        )
          add(p, 'Decimal bounds must be ordered and fit their scale');
      }
      if (f.type === 'choice')
        unique(
          f.options.map((o) => o.id),
          p + '.options',
        );
      for (const [name, when] of [
        ['visibleWhen', f.visibleWhen],
        ['requiredWhen', f.requiredWhen],
      ] as const)
        if (when) validateCondition(fields, when, p + '.' + name);
    }
    const visiting = new Set<string>(),
      done = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) {
        add(path + '.' + id, 'Conditional question dependencies contain a cycle');
        return;
      }
      if (done.has(id)) return;
      visiting.add(id);
      const f = fields.find((f) => f.id === id);
      for (const w of [f?.visibleWhen, f?.requiredWhen])
        for (const p of w?.conditions ?? [])
          if (fields.some((f) => f.id === p.fieldId)) visit(p.fieldId);
      visiting.delete(id);
      done.add(id);
    };
    fields.forEach((f) => visit(f.id));
  };
  validateFields(d.riskFields, 'riskFields');
  unique([...d.eligibilityRules.map((r) => r.id), ...d.rating.factors.map((r) => r.id)], 'rules');
  for (const r of [...d.eligibilityRules, ...d.rating.factors])
    validateCondition(d.riskFields, r.when, 'rules.' + r.id);
  for (const group of d.riskGroups) {
    if (group.minimumRows > group.maximumRows)
      add('riskGroups.' + group.id, 'Minimum row count exceeds maximum');
    validateFields(group.fields, 'riskGroups.' + group.id + '.fields');
    unique(
      group.eligibilityRules.map((r) => r.id),
      'riskGroups.' + group.id + '.rules',
    );
    for (const r of group.eligibilityRules)
      validateCondition(group.fields, r.when, 'riskGroups.' + group.id + '.rules.' + r.id);
  }
  const covers = new Map(d.coverages.map((c) => [c.id, c]));
  for (const c of d.coverages) {
    const p = 'coverages.' + c.id;
    const coverageScope = c.scope;
    const group =
      coverageScope.kind === 'risk_group'
        ? d.riskGroups.find((g) => g.id === coverageScope.groupId)
        : undefined;
    if (c.scope.kind === 'risk_group' && !group)
      add(p + '.scope', 'Coverage names an undefined risk group');
    unique(c.dependsOn, p + '.dependsOn');
    unique(c.excludes, p + '.excludes');
    for (const bounds of [
      c.limit,
      c.deductible,
      c.aggregateLimit,
      c.layer.kind === 'excess' ? c.layer.attachment : null,
    ])
      if (bounds && BigInt(bounds.minimumMinor) > BigInt(bounds.maximumMinor))
        add(p, 'Coverage money bounds are reversed');
    if (c.limitBasis === 'per_person' && !c.aggregateLimit)
      add(
        p + '.aggregateLimit',
        'Per-person cover requires an explicit aggregate cap and basis for bounded authority checks',
      );
    if (c.limitBasis === 'policy_term_aggregate' && c.aggregateLimit)
      add(
        p + '.aggregateLimit',
        'A policy-term aggregate primary limit cannot assert a second aggregate',
      );
    const references = [
      ...c.dependsOn,
      ...c.excludes,
      ...(c.layer.kind === 'excess' ? [c.layer.underlyingCoverageId] : []),
    ];
    for (const id of references) {
      const other = covers.get(id);
      if (id === c.id || !other)
        add(p, 'Coverage references must name a different declared coverage');
      else if (canonicalJson(other.scope) !== canonicalJson(c.scope))
        add(
          p,
          'Cross-scope dependencies and excess layers require a separately supported contract',
        );
    }
    if (c.dependsOn.some((id) => c.excludes.includes(id)))
      add(p, 'Coverage cannot require and exclude the same cover');
    if (c.layer.kind === 'excess') {
      const underlying = covers.get(c.layer.underlyingCoverageId);
      if (c.excludes.includes(c.layer.underlyingCoverageId))
        add(p, 'Excess cover cannot exclude its underlying cover');
      if (underlying && underlying.limitBasis !== c.limitBasis)
        add(
          p + '.layer',
          'Continuous excess layers must share the underlying limit basis; an aggregate is not a per-occurrence attachment',
        );
    }
    if (c.rate.method === 'per_unit') {
      const fields = group?.fields ?? d.riskFields;
      const rate = c.rate;
      const f = fields.find((f) => f.id === rate.quantityFieldId);
      if (!f || !['integer', 'decimal'].includes(f.type))
        add(p + '.rate', 'Per-unit quantity must be a numeric question in the coverage scope');
      else if (
        (f.type === 'integer' && f.minimum < 0) ||
        (f.type === 'decimal' && fraction(f.minimum).numerator < 0n)
      )
        add(p + '.rate', 'Rating quantity cannot permit negative values');
    }
  }
  const dependencies = (id: string) => {
    const c = covers.get(id);
    return c
      ? [...c.dependsOn, ...(c.layer.kind === 'excess' ? [c.layer.underlyingCoverageId] : [])]
      : [];
  };
  const walking = new Set<string>(),
    done = new Set<string>();
  const visit = (id: string) => {
    if (walking.has(id)) {
      add('coverages.' + id, 'Coverage dependencies or excess layers contain a cycle');
      return;
    }
    if (done.has(id)) return;
    walking.add(id);
    dependencies(id)
      .filter((id) => covers.has(id))
      .forEach(visit);
    walking.delete(id);
    done.add(id);
  };
  d.coverages.forEach((c) => visit(c.id));
  for (const c of d.coverages) {
    const selected = new Set<string>(),
      pending = [
        c.id,
        ...d.coverages
          .filter((o) => o.required && canonicalJson(o.scope) === canonicalJson(c.scope))
          .map((o) => o.id),
      ];
    while (pending.length) {
      const id = pending.pop()!;
      if (selected.has(id)) continue;
      selected.add(id);
      pending.push(...dependencies(id));
    }
    if ([...selected].some((id) => covers.get(id)?.excludes.some((x) => selected.has(x))))
      add('coverages.' + c.id, 'Cover cannot coexist with its required/dependent cover set');
  }
  if (
    d.cancellation &&
    ((d.cancellation.calculation === 'per_day_remaining' && d.rating.termBasis !== 'per_day') ||
      (d.cancellation.calculation === 'actual_days_pro_rata' &&
        d.rating.termBasis !== 'whole_term'))
  )
    add('cancellation', 'Cancellation calculation must match the declared rate term basis');
  if (d.servicing.mode === 'recalculate_remaining') {
    if (!d.servicing.allowRiskChanges && !d.servicing.allowTermExtension)
      add('servicing', 'Enable at least one supported change');
    if (
      (d.servicing.calculation === 'per_day_remaining' || d.servicing.allowTermExtension) &&
      d.rating.termBasis !== 'per_day'
    )
      add(
        'servicing',
        'Term extension and per-day servicing require explicit per-day product pricing',
      );
    if (d.servicing.calculation === 'actual_days_pro_rata' && d.rating.termBasis !== 'whole_term')
      add('servicing', 'Actual-days pro-rata uses an explicit whole-term premium basis');
  }
  return issues;
}

export type EvaluationContextV2 = {
  productId: string;
  productVersion: string;
  definition: InsuranceProductDefinitionV2;
  policy: RuntimePolicy;
  policyHash: string;
  runtimeReleaseId: string | null;
  releaseHash: string | null;
  now: Date;
  purpose?: 'new_business' | 'service';
  serviceEffectiveDate?: string;
};
export function evaluateInsuranceProductV2(
  context: EvaluationContextV2,
  raw: ConfiguredSubmissionV2,
): InsuranceEvaluationV2 {
  const d = insuranceProductDefinitionV2Schema.parse(context.definition),
    s = configuredSubmissionV2Schema.parse(raw);
  if (validateInsuranceDefinitionV2(d).length)
    throw new KernelError(
      'INVALID_INSURANCE_DEFINITION',
      'Resolve the v2 insurance definition findings before evaluation',
      422,
    );
  const issues: DecisionIssue[] = [],
    fieldStates: InsuranceEvaluationV2['fieldStates'] = [];
  const add = (code: string, path: string, message: string) =>
    issues.push(issue(path, message, code));
  const scopes = new Map<
    string,
    {
      scope: SelectionScope;
      fields: InsuranceRiskFieldV2[];
      answers: Answers;
      rules: InsuranceProductDefinitionV2['eligibilityRules'];
    }
  >();
  const validateAnswers = (
    scope: SelectionScope,
    fields: InsuranceRiskFieldV2[],
    rawAnswers: Answers,
    path: string,
  ) => {
    const answers: Answers = {},
      states = new Map<string, { visible: Truth; required: Truth }>();
    const evaluateField = (field: InsuranceRiskFieldV2) => {
      if (states.has(field.id)) return;
      for (const w of [field.visibleWhen, field.requiredWhen])
        for (const p of w?.conditions ?? []) {
          const dependency = fields.find((f) => f.id === p.fieldId);
          if (dependency) evaluateField(dependency);
        }
      const visible: Truth = field.visibleWhen ? cond(fields, answers, field.visibleWhen) : 'true';
      const required: Truth =
        visible === 'false'
          ? 'false'
          : field.required
            ? 'true'
            : field.requiredWhen
              ? cond(fields, answers, field.requiredWhen)
              : 'false';
      states.set(field.id, { visible, required });
      fieldStates.push({ scope, fieldId: field.id, visible, required });
      const present = Object.hasOwn(rawAnswers, field.id),
        p = path + '.' + field.id;
      if (visible === 'unknown')
        add(
          'VISIBILITY_UNKNOWN',
          p,
          'Answer the controlling questions before this question can be evaluated',
        );
      if (required === 'unknown')
        add('REQUIREDNESS_UNKNOWN', p, 'The requiredness condition is unresolved');
      if (visible === 'false') {
        if (present)
          add('HIDDEN_ANSWER', p, 'A hidden question must not supply an effective answer');
        return;
      }
      if (!present) {
        if (required === 'true') add('REQUIRED_ANSWER', p, field.label + ' is required');
        return;
      }
      if (!validValue(field, rawAnswers[field.id]))
        add('INVALID_ANSWER', p, field.label + ' must satisfy its type and bounds');
      else if (visible === 'true') answers[field.id] = rawAnswers[field.id]!;
    };
    fields.forEach(evaluateField);
    for (const id of Object.keys(rawAnswers))
      if (!fields.some((f) => f.id === id))
        add('UNKNOWN_ANSWER', path + '.' + id, 'Question is not defined in this scope');
    return answers;
  };
  scopes.set(key(policyScope), {
    scope: policyScope,
    fields: d.riskFields,
    answers: validateAnswers(policyScope, d.riskFields, s.answers, 'answers'),
    rules: d.eligibilityRules,
  });
  const groups = new Map(s.riskGroups.map((g) => [g.groupId, g]));
  if (groups.size !== s.riskGroups.length)
    add('DUPLICATE_RISK_GROUP', 'riskGroups', 'Each group appears once');
  for (const g of s.riskGroups)
    if (!d.riskGroups.some((x) => x.id === g.groupId))
      add('UNKNOWN_RISK_GROUP', 'riskGroups.' + g.groupId, 'Risk group is not declared');
  for (const group of d.riskGroups) {
    const rows = groups.get(group.id)?.rows ?? [],
      ids = new Set<string>();
    if (rows.length < group.minimumRows || rows.length > group.maximumRows)
      add(
        'RISK_ROW_COUNT',
        'riskGroups.' + group.id,
        `${group.label} requires ${group.minimumRows}–${group.maximumRows} rows`,
      );
    for (const row of rows) {
      if (ids.has(row.rowId))
        add(
          'DUPLICATE_RISK_ID',
          'riskGroups.' + group.id,
          'Stable row identifiers must be unique within a group',
        );
      ids.add(row.rowId);
      const scope: SelectionScope = { kind: 'risk', groupId: group.id, rowId: row.rowId };
      scopes.set(key(scope), {
        scope,
        fields: group.fields,
        answers: validateAnswers(
          scope,
          group.fields,
          row.answers,
          `riskGroups.${group.id}.${row.rowId}.answers`,
        ),
        rules: group.eligibilityRules,
      });
    }
  }
  const selectionKey = (id: string, scope: SelectionScope) => canonicalJson([id, scope]);
  const selected = new Map(s.coverages.map((c) => [selectionKey(c.coverageId, c.scope), c]));
  if (!s.coverages.length) add('COVERAGE_REQUIRED', 'coverages', 'Select at least one coverage');
  if (selected.size !== s.coverages.length)
    add(
      'DUPLICATE_COVERAGE',
      'coverages',
      'Coverage may be selected once for each policy or stable risk row',
    );
  const inScope = (c: InsuranceProductDefinitionV2['coverages'][number], scope: SelectionScope) =>
    c.scope.kind === 'policy'
      ? scope.kind === 'policy'
      : scope.kind === 'risk' && scope.groupId === c.scope.groupId;
  for (const selection of s.coverages) {
    const c = d.coverages.find((c) => c.id === selection.coverageId),
      p = 'coverages.' + selection.coverageId + '.' + key(selection.scope);
    if (!c) {
      add('UNKNOWN_COVERAGE', p, 'Coverage is not declared');
      continue;
    }
    if (!scopes.has(key(selection.scope)) || !inScope(c, selection.scope))
      add('COVERAGE_SCOPE', p, 'Coverage must select an existing risk row in its declared scope');
    if (
      BigInt(selection.limitMinor) < BigInt(c.limit.minimumMinor) ||
      BigInt(selection.limitMinor) > BigInt(c.limit.maximumMinor)
    )
      add('COVERAGE_LIMIT', p, 'Limit is outside its bounds');
    if (
      BigInt(selection.deductibleMinor) < BigInt(c.deductible.minimumMinor) ||
      BigInt(selection.deductibleMinor) > BigInt(c.deductible.maximumMinor) ||
      BigInt(selection.deductibleMinor) > BigInt(selection.limitMinor)
    )
      add('COVERAGE_DEDUCTIBLE', p, 'Deductible is outside its separate bounds');
    if (c.aggregateLimit) {
      if (
        !selection.aggregateMinor ||
        BigInt(selection.aggregateMinor) < BigInt(c.aggregateLimit.minimumMinor) ||
        BigInt(selection.aggregateMinor) > BigInt(c.aggregateLimit.maximumMinor) ||
        BigInt(selection.aggregateMinor) < BigInt(selection.limitMinor)
      )
        add(
          'COVERAGE_AGGREGATE',
          p,
          'Supply an aggregate within its declared basis/bounds and no lower than its individual limit',
        );
    } else if (selection.aggregateMinor !== undefined)
      add('UNDECLARED_AGGREGATE', p, 'This coverage has no additional aggregate');
    const dependencies = [
      ...c.dependsOn,
      ...(c.layer.kind === 'excess' ? [c.layer.underlyingCoverageId] : []),
    ];
    for (const ref of dependencies)
      if (!selected.has(selectionKey(ref, selection.scope)))
        add(
          'COVERAGE_DEPENDENCY',
          p,
          'Select underlying/dependent coverage ' + ref + ' in the same scope',
        );
    for (const ref of c.excludes)
      if (selected.has(selectionKey(ref, selection.scope)))
        add('COVERAGE_EXCLUSION', p, 'Coverage excludes ' + ref + ' in this scope');
    if (c.layer.kind === 'excess') {
      const underlying = selected.get(selectionKey(c.layer.underlyingCoverageId, selection.scope));
      const layer = c.layer;
      const underlyingDefinition = d.coverages.find((x) => x.id === layer.underlyingCoverageId);
      const expectedAttachment = underlying
        ? BigInt(underlying.limitMinor) +
          BigInt(
            underlyingDefinition?.layer.kind === 'excess'
              ? (underlying.attachmentMinor ?? '0')
              : '0',
          )
        : null;
      if (
        !selection.attachmentMinor ||
        BigInt(selection.attachmentMinor) < BigInt(c.layer.attachment.minimumMinor) ||
        BigInt(selection.attachmentMinor) > BigInt(c.layer.attachment.maximumMinor) ||
        expectedAttachment === null ||
        BigInt(selection.attachmentMinor) !== expectedAttachment
      )
        add(
          'EXCESS_ATTACHMENT',
          p,
          'Continuous excess must attach exactly above its selected underlying layer, within the declared attachment bounds',
        );
    } else if (selection.attachmentMinor !== undefined)
      add('UNDECLARED_ATTACHMENT', p, 'A primary coverage cannot assert an excess attachment');
  }
  for (const c of d.coverages)
    if (c.required)
      for (const scope of scopes.values())
        if (inScope(c, scope.scope) && !selected.has(selectionKey(c.id, scope.scope)))
          add(
            'REQUIRED_COVERAGE',
            'coverages.' + c.id + '.' + key(scope.scope),
            c.name + ' is required for this policy/risk row',
          );
  const today = context.now.toISOString().slice(0, 10),
    days = termDays(s.term.startDate, s.term.endDate),
    purpose = context.purpose ?? 'new_business',
    applicability: string[] = [];
  if (!d.territories.includes(s.territory))
    applicability.push('Risk territory is outside the configured territory set');
  if (
    purpose === 'new_business' &&
    (today < context.policy.effectiveFrom || today > context.policy.effectiveTo)
  )
    applicability.push('Operating policy is not effective for new business today');
  if (
    s.term.startDate > s.term.endDate ||
    s.term.endDate < today ||
    s.term.startDate < context.policy.effectiveFrom ||
    s.term.startDate > context.policy.effectiveTo
  )
    applicability.push('Term is unordered, expired or starts outside the policy version window');
  if (days < d.termRules.minimumDays || days > d.termRules.maximumDays)
    applicability.push('Inclusive UTC term duration is outside the configured bounds');
  if (Date.parse(s.expiresAt) <= context.now.getTime())
    applicability.push('Proposal expiry has passed');
  const backdated = purpose === 'new_business' && s.term.startDate < today;
  if (backdated)
    applicability.push(
      d.termRules.backdating === 'requires_approval'
        ? 'Backdated inception requires unsupported separate approval'
        : 'Backdated inception is not permitted',
    );
  if (
    purpose === 'service' &&
    (!context.serviceEffectiveDate ||
      context.serviceEffectiveDate < today ||
      context.serviceEffectiveDate < s.term.startDate ||
      context.serviceEffectiveDate > s.term.endDate)
  )
    applicability.push('Service requires a current/future effective date within the retained term');
  const rules: InsuranceEvaluationV2['eligibility']['rules'] = [];
  for (const scope of [...scopes.values()].sort((a, b) => compare(key(a.scope), key(b.scope))))
    for (const rule of scope.rules)
      rules.push({
        ruleId: rule.id,
        scope: scope.scope,
        outcome: rule.outcome,
        result: cond(scope.fields, scope.answers, rule.when),
        reason: rule.reason,
        sourceRefs: rule.sourceRefs,
      });
  const declined = rules.some((r) => r.result === 'true' && r.outcome === 'decline'),
    unknown = rules.some((r) => r.result === 'unknown');
  const referrals = [
    ...new Set(
      rules.filter((r) => r.result === 'true' && r.outcome === 'refer').map((r) => r.ruleId),
    ),
  ];
  const policyAnswers = scopes.get(key(policyScope))!.answers;
  const factors = d.rating.factors.map((r) => ({
    ruleId: r.id,
    result: cond(d.riskFields, policyAnswers, r.when),
    factorBps: r.factorBps,
    reason: r.reason,
  }));
  const ratingReasons: string[] = [],
    lines: InsuranceEvaluationV2['rating']['lines'] = [];
  if (days <= 0) ratingReasons.push('A positive ordered term is required for pricing');
  if (issues.length)
    ratingReasons.push('Resolve all risk, conditional-field and coverage findings before rating');
  if (factors.some((f) => f.result === 'unknown'))
    ratingReasons.push('A rating factor depends on an unavailable effective answer');
  let premium: bigint | null = null,
    daily: bigint | null = null,
    minimumApplied = false;
  if (!ratingReasons.length) {
    let subtotal = 0n;
    for (const selection of [...s.coverages].sort((a, b) =>
      compare(selectionKey(a.coverageId, a.scope), selectionKey(b.coverageId, b.scope)),
    )) {
      const c = d.coverages.find((c) => c.id === selection.coverageId)!,
        scope = scopes.get(key(selection.scope))!;
      let amount = 0n;
      if (c.rate.method === 'flat') amount = BigInt(c.rate.premiumMinor);
      else if (c.rate.method === 'limit_bps')
        amount = round(BigInt(selection.limitMinor) * BigInt(c.rate.rateBps), 10000n);
      else {
        const rate = c.rate;
        const f = scope.fields.find((f) => f.id === rate.quantityFieldId),
          value = scope.answers[rate.quantityFieldId];
        if (!f || value === undefined || !validValue(f, value)) {
          ratingReasons.push('Missing effective quantity for ' + c.id);
          continue;
        }
        const q = fraction(String(value));
        amount = round(q.numerator * BigInt(c.rate.premiumPerUnitMinor), q.denominator);
      }
      if (!minorUnitSchema.safeParse(amount.toString()).success) {
        ratingReasons.push('Coverage amount exceeds exact money bounds');
        continue;
      }
      subtotal += amount;
      lines.push({
        coverageId: c.id,
        scope: selection.scope,
        method: c.rate.method,
        premiumMinor: amount.toString(),
      });
    }
    if (!ratingReasons.length) {
      let numerator = subtotal,
        denominator = 1n;
      for (const f of factors)
        if (f.result === 'true') {
          numerator *= BigInt(f.factorBps);
          denominator *= 10000n;
        }
      const priced = round(numerator, denominator);
      daily = d.rating.termBasis === 'per_day' ? priced : null;
      premium = d.rating.termBasis === 'per_day' ? priced * BigInt(days) : priced;
      if (premium < BigInt(d.rating.minimumPremiumMinor)) {
        premium = BigInt(d.rating.minimumPremiumMinor);
        minimumApplied = true;
      }
      if (!minorUnitSchema.safeParse(premium.toString()).success) {
        ratingReasons.push('Premium exceeds exact money bounds');
        premium = null;
        daily = null;
      }
    }
  }
  const authorityReasons: string[] = [];
  const exposure = s.coverages.reduce(
    (sum, c) => sum + BigInt(c.aggregateMinor ?? c.limitMinor),
    0n,
  );
  if (!issues.length && exposure > BigInt(d.authority.maximumTotalLimitMinor))
    authorityReasons.push('Sum of declared maximum coverage exposures exceeds authority');
  if (
    premium !== null &&
    (premium > BigInt(d.authority.maximumPremiumMinor) ||
      premium > BigInt(context.policy.maximumPremiumMinor))
  )
    authorityReasons.push('Premium exceeds configured or operating authority');
  const authority =
    issues.length || premium === null
      ? 'undetermined'
      : authorityReasons.length
        ? 'referral_required'
        : 'within_authority';
  const approval =
    referrals.length ||
    authority === 'referral_required' ||
    backdated ||
    Object.values(context.policy.requirements).some((v) => v !== 'not_required')
      ? 'required_unsupported'
      : unknown || authority === 'undetermined'
        ? 'undetermined'
        : 'not_required';
  const reasons = [
    ...issues.map((i) => i.message),
    ...applicability,
    ...ratingReasons,
    ...authorityReasons,
  ];
  if (declined) reasons.push('A configured decline rule matched');
  if (unknown) reasons.push('A configured underwriting rule is undetermined');
  if (referrals.length) reasons.push('A configured referral requires independent review');
  if (approval !== 'not_required')
    reasons.push('Approval or external prerequisites remain required');
  const content = {
    engineVersion: 'insurance-decision-v2',
    purpose,
    serviceEffectiveDate: context.serviceEffectiveDate ?? null,
    productId: context.productId,
    productVersion: context.productVersion,
    definitionHash: hash(d),
    policyHash: context.policyHash,
    runtimeReleaseId: context.runtimeReleaseId,
    releaseHash: context.releaseHash,
    inputHash: hash(s),
    evaluatedOn: today,
    fieldStates,
    validation: { status: issues.length ? 'invalid' : 'valid', issues },
    applicability: {
      status: applicability.length ? 'inapplicable' : 'applicable',
      reasons: applicability,
    },
    eligibility: { status: declined ? 'declined' : unknown ? 'undetermined' : 'eligible', rules },
    referral: {
      status: referrals.length ? 'required' : unknown ? 'undetermined' : 'not_required',
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
      termBasis: d.rating.termBasis,
      dailyPremiumMinor: daily?.toString() ?? null,
      termDays: days,
      reasons: ratingReasons,
    },
    authority: { status: authority, reasons: authorityReasons },
    approval: { status: approval },
    bind: { status: reasons.length ? 'blocked' : 'allowed', reasons: [...new Set(reasons)] },
  };
  return insuranceEvaluationV2Schema.parse({ ...content, evaluationHash: hash(content) });
}
