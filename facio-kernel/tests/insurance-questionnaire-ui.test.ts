import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  evaluateInsuranceProduct,
  validateInsuranceDefinition,
} from '../src/domain/insurance-decision.js';
import { hash } from '../src/domain/canonical.js';
import { multiRiskDefinition, multiRiskSubmission } from './fixtures/insurance-v2.js';
import { configuredRuntimePolicy } from './fixtures/insurance-definition.js';
import { testNow } from './fixtures/insurance.js';
import type {
  InsuranceRiskFieldV2,
  InsuranceCondition,
  ConfiguredSubmissionV2,
} from '../src/contracts/insurance-definition.js';

type State = { visible: 'true' | 'false' | 'unknown'; required: 'true' | 'false' | 'unknown' };
const window: {
  createInsuranceDecisionView?: (helpers: unknown) => {
    questionPresentation: (
      fields: InsuranceRiskFieldV2[],
      answers: Record<string, string>,
      currency: string,
    ) => Map<string, State>;
  };
} = {};
vm.runInNewContext(
  readFileSync(new URL('../public/insurance-decision.js', import.meta.url), 'utf8'),
  { window },
);
const view = window.createInsuranceDecisionView!({
  moneyDigits: { GBP: 2 },
  toMinor: (raw: string) => {
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error('Invalid money input');
    const [whole, fraction = ''] = raw.replace(/^-/, '').split('.');
    const value =
      (raw.startsWith('-') ? -1n : 1n) * (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0')));
    if (value > 999999999999999999n || value < -999999999999999999n)
      throw new Error('Money overflow');
    return String(value);
  },
});
const base = {
  label: 'Synthetic question',
  description: 'Synthetic parity condition',
  required: false,
  sourceRefs: ['synthetic://questionnaire-parity'],
  visibleWhen: null,
  requiredWhen: null,
};
const controls: InsuranceRiskFieldV2[] = [
  { ...base, id: 'flag', type: 'boolean' },
  { ...base, id: 'count', type: 'integer', minimum: -2, maximum: 5 },
  { ...base, id: 'ratio', type: 'decimal', minimum: '-2', maximum: '5', scale: 3 },
  { ...base, id: 'price', type: 'money', minimumMinor: '0', maximumMinor: '999999999999999999' },
  { ...base, id: 'date', type: 'date', minimum: '2026-01-01', maximum: '2026-12-31' },
  { ...base, id: 'text', type: 'text', minLength: 0, maxLength: 20 },
  {
    ...base,
    id: 'choice',
    type: 'choice',
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
  },
  {
    ...base,
    id: 'derived',
    type: 'text',
    minLength: 1,
    maxLength: 20,
    visibleWhen: {
      mode: 'all',
      conditions: [{ kind: 'comparison', fieldId: 'flag', operator: 'eq', value: true }],
    },
  },
];
const predicates: InsuranceCondition['conditions'] = [
  { kind: 'comparison', fieldId: 'flag', operator: 'eq', value: true },
  { kind: 'comparison', fieldId: 'flag', operator: 'neq', value: false },
  { kind: 'comparison', fieldId: 'count', operator: 'gt', value: 2 },
  { kind: 'comparison', fieldId: 'count', operator: 'lte', value: 2 },
  { kind: 'comparison', fieldId: 'count', operator: 'gte', value: -2 },
  { kind: 'comparison', fieldId: 'count', operator: 'lt', value: 5 },
  { kind: 'comparison', fieldId: 'ratio', operator: 'gte', value: '1.001' },
  { kind: 'comparison', fieldId: 'ratio', operator: 'eq', value: '1.000' },
  { kind: 'membership', fieldId: 'ratio', operator: 'in', values: ['1', '2'] },
  { kind: 'comparison', fieldId: 'price', operator: 'gt', value: '9007199254740993' },
  { kind: 'comparison', fieldId: 'date', operator: 'lte', value: '2026-09-10' },
  { kind: 'membership', fieldId: 'choice', operator: 'in', values: ['a', 'b'] },
  { kind: 'membership', fieldId: 'choice', operator: 'not_in', values: ['a'] },
  { kind: 'presence', fieldId: 'text', operator: 'present' },
  { kind: 'presence', fieldId: 'derived', operator: 'absent' },
];
const conditions: InsuranceCondition[] = [
  ...predicates.map((predicate) => ({ mode: 'all' as const, conditions: [predicate] })),
  { mode: 'all', conditions: [predicates[0]!, predicates[2]!] },
  { mode: 'any', conditions: [predicates[0]!, predicates[2]!] },
];
const fields: InsuranceRiskFieldV2[] = [
  ...controls,
  ...conditions.map((condition, index) => ({
    ...base,
    id: `dependent-${index}`,
    type: 'text' as const,
    minLength: 1,
    maxLength: 20,
    visibleWhen: condition,
    requiredWhen: condition,
  })),
];
const definition = structuredClone(multiRiskDefinition);
definition.riskFields = fields;
const evaluate = (answers: ConfiguredSubmissionV2['answers']) =>
  evaluateInsuranceProduct(
    {
      productId: configuredRuntimePolicy.id,
      productVersion: configuredRuntimePolicy.version,
      definition,
      policy: configuredRuntimePolicy,
      policyHash: hash(configuredRuntimePolicy),
      runtimeReleaseId: '00000000-0000-4000-8000-000000000001',
      releaseHash: 'a'.repeat(64),
      now: testNow(),
    },
    { ...structuredClone(multiRiskSubmission), answers },
  );
const cases: Array<{
  name: string;
  raw: Record<string, string>;
  typed: ConfiguredSubmissionV2['answers'];
}> = [];
for (const flag of ['', 'true', 'false'])
  for (const count of ['', '-2', '2', '3', '5']) {
    const raw = {
      flag,
      count,
      ratio: '1.000',
      price: '90071992547409.94',
      date: '2026-09-10',
      text: 'present',
      choice: 'a',
      derived: 'visible only when true',
    };
    const typed: ConfiguredSubmissionV2['answers'] = {
      ratio: '1.000',
      price: '9007199254740994',
      date: '2026-09-10',
      text: 'present',
      choice: 'a',
      derived: raw.derived,
    };
    if (flag !== '') typed.flag = flag === 'true';
    if (count !== '') typed.count = Number(count);
    cases.push({ name: `flag=${flag || 'unknown'} count=${count || 'unknown'}`, raw, typed });
  }
for (const [field, raw, typed] of [
  ['ratio', '1.001', '1.001'],
  ['ratio', '-0.000', '-0.000'],
  ['ratio', '1.0001', '1.0001'],
  ['ratio', '01.1', '01.1'],
  ['price', '90071992547409.93', '9007199254740993'],
  ['price', 'not-a-number', 'not-a-number'],
  ['date', '2026-02-30', '2026-02-30'],
  ['date', '2027-01-01', '2027-01-01'],
  ['choice', 'unknown', 'unknown'],
  ['text', 'x'.repeat(21), 'x'.repeat(21)],
  ['count', '1.1', '1.1'],
  ['flag', 'invalid', 'invalid'],
] as const)
  cases.push({
    name: `invalid/boundary ${field}=${raw}`,
    raw: { [field]: raw },
    typed: { [field]: typed },
  });

test('UI question visibility and requiredness match canonical scoped three-valued conditions, exact decimals/money and invalid input boundaries', () => {
  assert.deepEqual(validateInsuranceDefinition(definition), []);
  for (const example of cases) {
    const server = evaluate(example.typed);
    assert.equal(server.engineVersion, 'insurance-decision-v2');
    if (server.engineVersion !== 'insurance-decision-v2')
      throw new Error('Wrong evaluation version');
    const ui = view.questionPresentation(fields, example.raw, 'GBP');
    for (const state of server.fieldStates.filter((state) => state.scope.kind === 'policy')) {
      const projected = ui.get(state.fieldId);
      assert.equal(
        projected?.visible,
        state.visible,
        `${example.name} ${state.fieldId} visibility`,
      );
      assert.equal(
        projected?.required,
        state.required,
        `${example.name} ${state.fieldId} requiredness`,
      );
    }
  }
  assert.equal(cases.length, 27);
});
