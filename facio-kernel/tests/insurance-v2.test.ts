import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  evaluateInsuranceProduct,
  validateInsuranceDefinition,
} from '../src/domain/insurance-decision.js';
import { evaluateInsuranceProduct as evaluateV1 } from '../src/domain/insurance-decision-v1.js';
import { evaluateConfiguredService } from '../src/domain/insurance-service.js';
import { allocateFinancials } from '../src/domain/money.js';
import { hash } from '../src/domain/canonical.js';
import { insuranceEvaluationV2Schema } from '../src/contracts/insurance-definition.js';
import type { InsuranceRecord } from '../src/contracts/insurance.js';
import {
  syntheticConfiguredSubmission,
  syntheticInsuranceDefinition,
  configuredRuntimePolicy,
} from './fixtures/insurance-definition.js';
import { multiRiskDefinition, multiRiskSubmission } from './fixtures/insurance-v2.js';
import { externalQuote, insuranceContext, testNow } from './fixtures/insurance.js';
const copy = <T>(v: T): T => structuredClone(v);
const releaseId = randomUUID(),
  releaseHash = 'a'.repeat(64);
const context = () => ({
  productId: configuredRuntimePolicy.id,
  productVersion: configuredRuntimePolicy.version,
  definition: copy(multiRiskDefinition),
  policy: configuredRuntimePolicy,
  policyHash: hash(configuredRuntimePolicy),
  runtimeReleaseId: releaseId,
  releaseHash,
  now: testNow(),
});
const evaluate = (s = copy(multiRiskSubmission), d = copy(multiRiskDefinition)) =>
  insuranceEvaluationV2Schema.parse(evaluateInsuranceProduct({ ...context(), definition: d }, s));
const bound = (): InsuranceRecord => {
  const submission = copy(multiRiskSubmission),
    evaluation = evaluate(submission),
    premiumMinor = evaluation.rating.premiumMinor!;
  const quote = {
    ...copy(externalQuote),
    sourceQuote: {
      reference: submission.reference,
      version: submission.version,
      evidenceRefs: submission.evidenceRefs,
    },
    term: submission.term,
    premiumMinor,
  };
  const content = {
    id: randomUUID(),
    scope: insuranceContext,
    status: 'bound' as const,
    sourceMode: 'configured_product' as const,
    version: 2,
    quoteHash: hash(quote),
    productId: configuredRuntimePolicy.id,
    productVersion: configuredRuntimePolicy.version,
    productPolicyHash: hash(configuredRuntimePolicy),
    runtimeReleaseId: releaseId,
    quote,
    currency: configuredRuntimePolicy.currency,
    premiumMinor,
    financials: allocateFinancials({
      currency: configuredRuntimePolicy.currency,
      premiumMinor,
      participants: quote.participants,
      commission: configuredRuntimePolicy.commission,
    }),
    createdAt: testNow().toISOString(),
    updatedAt: testNow().toISOString(),
    lastEffectiveDate: null,
    decision: { submission, evaluation, evaluatedAt: testNow().toISOString() },
  };
  return { ...content, recordHash: hash(content) };
};
test('v1 parsing and deterministic result remain byte-identical; v2 is explicit and cannot cross the old contract', () => {
  const c = { ...context(), definition: syntheticInsuranceDefinition };
  assert.deepEqual(
    evaluateInsuranceProduct(c, syntheticConfiguredSubmission),
    evaluateV1(c, syntheticConfiguredSubmission),
  );
  assert.throws(() => evaluateInsuranceProduct(c, multiRiskSubmission), /v1/);
  assert.throws(() => evaluateInsuranceProduct(context(), syntheticConfiguredSubmission), /v2/);
});
test('repeated stable risks, per-person scope, aggregates and continuous excess price exactly', () => {
  assert.deepEqual(validateInsuranceDefinition(multiRiskDefinition), []);
  const report = evaluate();
  assert.equal(report.bind.status, 'allowed');
  assert.equal(report.rating.premiumMinor, '4800');
  assert.equal(report.rating.dailyPremiumMinor, '1200');
  const s = copy(multiRiskSubmission);
  s.riskGroups[0]!.rows.push({
    rowId: 'driver-b',
    answers: { name: 'Example B', age: 40, 'previous-loss': false },
  });
  for (const row of s.riskGroups[0]!.rows)
    s.coverages.push({
      coverageId: 'person',
      scope: { kind: 'risk', groupId: 'drivers', rowId: row.rowId },
      limitMinor: '10000',
      deductibleMinor: '0',
      aggregateMinor: '100000',
    });
  const result = evaluate(s);
  assert.equal(result.rating.premiumMinor, '5600');
  assert.equal(result.eligibility.rules.length, 2);
  assert.equal(result.rating.lines.length, 4);
  s.riskGroups[0]!.rows[1]!.answers.age = 19;
  assert.equal(evaluate(s).referral.status, 'required');
  s.riskGroups[0]!.rows[1]!.rowId = 'driver-a';
  assert.ok(evaluate(s).validation.issues.some((i) => i.code === 'DUPLICATE_RISK_ID'));
});
test('conditional visibility and requiredness fail closed with no hidden answer influencing rating', () => {
  const s = copy(multiRiskSubmission),
    row = s.riskGroups[0]!.rows[0]!;
  row.answers['loss-detail'] = 'Not applicable';
  assert.ok(evaluate(s).validation.issues.some((i) => i.code === 'HIDDEN_ANSWER'));
  delete row.answers['loss-detail'];
  row.answers['previous-loss'] = true;
  assert.ok(evaluate(s).validation.issues.some((i) => i.code === 'REQUIRED_ANSWER'));
  row.answers['loss-detail'] = 'Synthetic loss';
  assert.equal(evaluate(s).validation.status, 'valid');
  delete row.answers['previous-loss'];
  assert.ok(evaluate(s).validation.issues.some((i) => i.code === 'VISIBILITY_UNKNOWN'));
  const d = copy(multiRiskDefinition);
  d.riskGroups[0]!.fields[2]!.visibleWhen = {
    mode: 'all',
    conditions: [{ kind: 'presence', fieldId: 'loss-detail', operator: 'present' }],
  };
  assert.ok(validateInsuranceDefinition(d).some((i) => i.message.includes('cycle')));
});
test('aggregate, attachment, same-risk dependency and semantic bounds cannot be conflated or bypassed', () => {
  for (const mutation of [
    (s: typeof multiRiskSubmission) => {
      s.coverages[1]!.attachmentMinor = '99999';
    },
    (s: typeof multiRiskSubmission) => {
      delete s.coverages[0]!.aggregateMinor;
    },
    (s: typeof multiRiskSubmission) => {
      s.coverages[1]!.scope = { kind: 'risk', groupId: 'drivers', rowId: 'missing' };
    },
    (s: typeof multiRiskSubmission) => {
      s.coverages.splice(0, 1);
    },
  ]) {
    const s = copy(multiRiskSubmission);
    mutation(s);
    assert.equal(evaluate(s).bind.status, 'blocked');
    assert.equal(evaluate(s).rating.status, 'blocked');
  }
  const d = copy(multiRiskDefinition);
  d.coverages[0]!.limitBasis = 'policy_term_aggregate';
  assert.ok(validateInsuranceDefinition(d).some((i) => i.message.includes('aggregate')));
  d.coverages[0]!.aggregateLimit = null;
  assert.ok(validateInsuranceDefinition(d).some((i) => i.message.includes('basis')));
});
test('4 to 6 day extension before inception retains original evidence and computes genuine added exposure', () => {
  const record = bound(),
    original = copy(record),
    s = copy(multiRiskSubmission);
  s.version = '2';
  s.term.endDate = '2026-09-15';
  const input = {
    recordId: record.id,
    expectedVersion: record.version,
    recordHash: record.recordHash,
    submission: s,
    effectiveDate: '2026-09-10',
    reason: 'Synthetic two-day extension',
    evidenceRefs: ['synthetic://service'],
  };
  const preview = evaluateConfiguredService(
    {
      record,
      definition: multiRiskDefinition,
      policy: configuredRuntimePolicy,
      releaseHash,
      now: testNow(),
    },
    input,
  );
  assert.equal(preview.status, 'allowed', preview.reasons.join(';'));
  assert.equal(preview.calculation?.removedPremiumMinor, '4800');
  assert.equal(preview.calculation?.addedPremiumMinor, '7200');
  assert.equal(preview.calculation?.premiumDeltaMinor, '2400');
  assert.equal(preview.calculation?.resultingPremiumMinor, '7200');
  assert.deepEqual(record, original);
  const late = evaluateConfiguredService(
    {
      record,
      definition: multiRiskDefinition,
      policy: configuredRuntimePolicy,
      releaseHash,
      now: new Date('2026-09-14T10:00:00Z'),
    },
    { ...input, effectiveDate: '2026-09-14' },
  );
  assert.equal(late.status, 'blocked');
  s.riskGroups[0]!.rows[0]!.answers.age = 19;
  assert.equal(
    evaluateConfiguredService(
      {
        record,
        definition: multiRiskDefinition,
        policy: configuredRuntimePolicy,
        releaseHash,
        now: testNow(),
      },
      input,
    ).status,
    'blocked',
  );
});
test('configured risk change rerates remaining days with exact delta and explicitly blocks unsupported rules', () => {
  const record = bound(),
    s = copy(multiRiskSubmission);
  s.version = '2';
  s.coverages.pop();
  const input = {
    recordId: record.id,
    expectedVersion: record.version,
    recordHash: record.recordHash,
    submission: s,
    effectiveDate: '2026-09-12',
    reason: 'Remove optional layer prospectively',
    evidenceRefs: ['synthetic://service'],
  };
  const preview = evaluateConfiguredService(
    {
      record,
      definition: multiRiskDefinition,
      policy: configuredRuntimePolicy,
      releaseHash,
      now: testNow(),
    },
    input,
  );
  assert.equal(preview.status, 'allowed', preview.reasons.join(';'));
  assert.equal(preview.calculation?.premiumDeltaMinor, '-400');
  assert.equal(preview.calculation?.resultingPremiumMinor, '4400');
  const policy = {
    ...configuredRuntimePolicy,
    requirements: {
      ...configuredRuntimePolicy.requirements,
      approval: 'independent_review' as const,
    },
  };
  assert.equal(
    evaluateConfiguredService(
      { record, definition: multiRiskDefinition, policy, releaseHash, now: testNow() },
      input,
    ).status,
    'blocked',
  );
  const d = copy(multiRiskDefinition);
  d.servicing = { mode: 'disabled' };
  assert.equal(
    evaluateConfiguredService(
      { record, definition: d, policy: configuredRuntimePolicy, releaseHash, now: testNow() },
      input,
    ).status,
    'blocked',
  );
});

test('per-day subtotal overflow returns a typed blocked evaluation rather than invalid output money', () => {
  const definition = copy(multiRiskDefinition);
  definition.coverages[0]!.rate = { method: 'flat', premiumMinor: '999999999999999999' };
  definition.coverages[1]!.rate = { method: 'flat', premiumMinor: '999999999999999999' };
  const report = evaluate(undefined, definition);
  assert.equal(report.rating.status, 'blocked');
  assert.equal(report.rating.premiumMinor, null);
  assert.equal(report.rating.dailyPremiumMinor, null);
  assert.equal(report.bind.status, 'blocked');
});
