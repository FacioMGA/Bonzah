import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateInsuranceProduct,
  validateInsuranceDefinition,
} from '../src/domain/insurance-decision.js';
import { validateConfiguration } from '../src/domain/validate.js';
import { hash } from '../src/domain/canonical.js';
import {
  configuredSubmissionSchema,
  insuranceProductDefinitionSchema,
} from '../src/contracts/insurance-definition.js';
import {
  configuredRuntimePolicy,
  syntheticInsuranceDefinition,
  syntheticConfiguredSubmission,
  configuredProductConfiguration,
} from './fixtures/insurance-definition.js';
import { insuranceContext, testNow } from './fixtures/insurance.js';

const copy = <T>(value: T): T => structuredClone(value);
const evaluate = (
  submission = copy(syntheticConfiguredSubmission),
  definition = copy(syntheticInsuranceDefinition),
  now = testNow(),
) =>
  evaluateInsuranceProduct(
    {
      productId: configuredRuntimePolicy.id,
      productVersion: configuredRuntimePolicy.version,
      definition,
      policy: configuredRuntimePolicy,
      policyHash: hash(configuredRuntimePolicy),
      runtimeReleaseId: null,
      releaseHash: null,
      now,
    },
    submission,
  );

test('exact coverage rating, factor evidence, minimum and authority remain separate', () => {
  assert.deepEqual(validateInsuranceDefinition(syntheticInsuranceDefinition), []);
  const baseline = evaluate();
  assert.equal(baseline.rating.premiumMinor, '10152');
  assert.equal(baseline.bind.status, 'allowed');
  assert.deepEqual(
    baseline.rating.lines.map((line) => line.premiumMinor),
    ['10000', '152'],
  );
  const submission = copy(syntheticConfiguredSubmission);
  submission.answers.class = 'high';
  assert.equal(evaluate(submission).rating.premiumMinor, '12690');
  submission.coverages.push({ coverageId: 'liability', limitMinor: '10050', deductibleMinor: '0' });
  assert.equal(evaluate(submission).rating.premiumMinor, '12816');
  const definition = copy(syntheticInsuranceDefinition);
  definition.rating.minimumPremiumMinor = '30000';
  const report = evaluate(undefined, definition);
  assert.equal(report.rating.premiumMinor, '30000');
  assert.equal(report.rating.minimumApplied, true);
  assert.equal(report.authority.status, 'referral_required');
  assert.equal(report.approval.status, 'required_unsupported');
  assert.equal(report.bind.status, 'blocked');
  assert.deepEqual(evaluate(), baseline);
});

test('rating stays exact above JS integer precision and fails closed on overflow', () => {
  const definition = copy(syntheticInsuranceDefinition);
  definition.coverages[0]!.rate = { method: 'flat', premiumMinor: '9007199254740993' };
  assert.equal(evaluate(undefined, definition).rating.premiumMinor, '9007199254741145');
  definition.coverages[0]!.rate = { method: 'flat', premiumMinor: '999999999999999999' };
  const report = evaluate(undefined, definition);
  assert.equal(report.rating.status, 'blocked');
  assert.equal(report.rating.premiumMinor, null);
  assert.equal(report.bind.status, 'blocked');
});

test('all seven typed fields reject invalid answers and preserve false/zero as supplied values', () => {
  const bad: Record<string, string | number | boolean> = {
    age: 1.5,
    units: '1.001',
    prohibited: 'false',
    class: 'unknown',
    value: 'abc',
    inspection: '2026-02-30',
    description: '',
  };
  for (const [field, value] of Object.entries(bad)) {
    const submission = copy(syntheticConfiguredSubmission);
    submission.answers[field] = value;
    if (field === 'age') {
      assert.equal(configuredSubmissionSchema.safeParse(submission).success, false);
      continue;
    }
    const report = evaluate(submission);
    assert.ok(report.validation.issues.some((issue) => issue.path === 'answers.' + field));
    assert.equal(report.bind.status, 'blocked');
  }
  const submission = copy(syntheticConfiguredSubmission);
  submission.answers.units = '0';
  assert.equal(evaluate(submission).rating.premiumMinor, '10000');
  submission.answers.extra = true;
  delete submission.answers.age;
  const report = evaluate(submission);
  assert.ok(report.validation.issues.some((issue) => issue.code === 'UNKNOWN_ANSWER'));
  assert.ok(report.validation.issues.some((issue) => issue.code === 'REQUIRED_ANSWER'));
});

test('underwriting preserves decline/referral evidence and unknown conditions cannot approve', () => {
  const submission = copy(syntheticConfiguredSubmission);
  delete submission.answers['prior-losses'];
  assert.equal(evaluate(submission).eligibility.status, 'undetermined');
  assert.equal(evaluate(submission).bind.status, 'blocked');
  submission.answers.age = 18;
  submission.answers.prohibited = true;
  const report = evaluate(submission);
  assert.equal(report.eligibility.status, 'declined');
  assert.equal(report.referral.status, 'required');
  assert.equal(report.eligibility.rules.length, 3);
  const definition = copy(syntheticInsuranceDefinition);
  definition.eligibilityRules[2]!.when.conditions.push({
    kind: 'comparison',
    fieldId: 'prohibited',
    operator: 'eq',
    value: false,
  });
  assert.equal(evaluate(submission, definition).eligibility.rules[2]!.result, 'false');
  definition.eligibilityRules[2]!.when.mode = 'any';
  definition.eligibilityRules[2]!.when.conditions[1] = {
    kind: 'presence',
    fieldId: 'prohibited',
    operator: 'present',
  };
  assert.equal(evaluate(submission, definition).eligibility.rules[2]!.result, 'true');
});

test('coverage selection has actionable required/dependency/exclusion and inclusive money bounds', () => {
  const submission = copy(syntheticConfiguredSubmission);
  submission.coverages = [];
  assert.ok(
    evaluate(submission).validation.issues.some((issue) => issue.code === 'COVERAGE_REQUIRED'),
  );
  submission.coverages = [
    { coverageId: 'extension', limitMinor: '10000', deductibleMinor: '10000' },
  ];
  assert.ok(
    evaluate(submission).validation.issues.some((issue) => issue.code === 'COVERAGE_DEPENDENCY'),
  );
  submission.coverages.push({ coverageId: 'basic', limitMinor: '10000', deductibleMinor: '10000' });
  assert.equal(evaluate(submission).validation.status, 'valid');
  submission.coverages[0]!.deductibleMinor = '10001';
  assert.ok(
    evaluate(submission).validation.issues.some((issue) => issue.code === 'COVERAGE_DEDUCTIBLE'),
  );
  submission.coverages = [
    ...copy(syntheticConfiguredSubmission.coverages),
    { coverageId: 'liability', limitMinor: '10000', deductibleMinor: '0' },
    { coverageId: 'alternative', limitMinor: '10000', deductibleMinor: '0' },
  ];
  assert.ok(
    evaluate(submission).validation.issues.some((issue) => issue.code === 'COVERAGE_EXCLUSION'),
  );
});

test('term rules enforce inclusive UTC duration, backdating policy and expiry boundary', () => {
  const definition = copy(syntheticInsuranceDefinition);
  definition.termRules = { minimumDays: 2, maximumDays: 3, backdating: 'not_permitted' };
  const submission = copy(syntheticConfiguredSubmission);
  for (const [end, allowed] of [
    ['2026-09-10', false],
    ['2026-09-11', true],
    ['2026-09-12', true],
    ['2026-09-13', false],
  ] as const) {
    submission.term.endDate = end;
    assert.equal(evaluate(submission, definition).bind.status, allowed ? 'allowed' : 'blocked');
  }
  submission.term = { startDate: '2026-09-09', endDate: '2026-09-11' };
  assert.equal(evaluate(submission, definition).applicability.status, 'inapplicable');
  definition.termRules.backdating = 'requires_approval';
  const report = evaluate(submission, definition);
  assert.equal(report.approval.status, 'required_unsupported');
  assert.equal(report.bind.status, 'blocked');
  submission.term = { startDate: '2026-09-10', endDate: '2026-09-11' };
  submission.expiresAt = testNow().toISOString();
  assert.equal(evaluate(submission, definition).bind.status, 'blocked');
  const malformed = copy(definition);
  malformed.termRules.minimumDays = 4;
  assert.ok(validateInsuranceDefinition(malformed).some((issue) => issue.path === 'termRules'));
});

test('definition rejects unsupported basis, bad references, cycles and impossible dependency closures', () => {
  assert.equal(
    insuranceProductDefinitionSchema.safeParse({
      ...syntheticInsuranceDefinition,
      termRules: undefined,
    }).success,
    false,
  );
  const invalid = copy(syntheticInsuranceDefinition);
  invalid.coverages[0]!.dependsOn = ['extension'];
  assert.ok(validateInsuranceDefinition(invalid).some((issue) => issue.message.includes('cycle')));
  invalid.coverages[0]!.dependsOn = ['liability'];
  invalid.coverages[1]!.dependsOn = ['alternative'];
  assert.ok(
    validateInsuranceDefinition(invalid).some((issue) => issue.message.includes('coexist')),
  );
  invalid.coverages[1]!.rate = {
    method: 'per_unit',
    quantityFieldId: 'description',
    premiumPerUnitMinor: '1',
  };
  assert.ok(
    validateInsuranceDefinition(invalid).some((issue) => issue.message.includes('quantity')),
  );
});

test('rich capability and entity territory gaps invalidate activation inputs', () => {
  const configuration = configuredProductConfiguration(insuranceContext);
  const validate = () =>
    validateConfiguration(configuration, insuranceContext, {
      view: 'draft',
      version: 1,
      hash: hash(configuration),
    });
  assert.equal(validate().definitionValid, true);
  configuration.operatingEntities[0]!.territories = ['CY'];
  assert.ok(
    validate().gaps.some(
      (gap) => gap.field.endsWith('.insurance.territories') && gap.code === 'CONFIGURATION_GAP',
    ),
  );
  delete configuration.products[0]!.insurance;
  assert.ok(
    validate().gaps.some(
      (gap) => gap.field.endsWith('.insurance') && gap.code === 'CONFIGURATION_GAP',
    ),
  );
});
