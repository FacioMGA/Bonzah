import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupConfiguredV2 } from './fixtures/configured-v2.js';
import { multiRiskSubmission } from './fixtures/insurance-v2.js';
import { externalQuote } from './fixtures/insurance.js';
import { insuranceOperations, insuranceMutationResultSchema } from '../src/contracts/insurance.js';
import { KernelError } from '../src/domain/canonical.js';
const copy = <T>(v: T): T => structuredClone(v),
  fails = (code: string) => (error: unknown) => error instanceof KernelError && error.code === code;

test('renewal creates a distinct term with exact source comparison and fresh decisions; retries cannot duplicate it', () => {
  const f = setupConfiguredV2();
  try {
    const source = f.bind(f.create()),
      original = copy(source),
      s = copy(multiRiskSubmission);
    s.reference = 'synthetic-renewal';
    s.term = { startDate: '2026-09-14', endDate: '2026-09-17' };
    s.riskGroups[0]!.rows[0]!.answers.age = 40;
    const input = {
      sourceRecordId: source.id,
      sourceVersion: source.version,
      sourceRecordHash: source.recordHash,
      productId: source.productId,
      productVersion: source.productVersion,
      submission: s,
    };
    const report = insuranceOperations.insurance_evaluate_renewal.output.parse(
      f.execute('insurance_evaluate_renewal', input),
    );
    assert.deepEqual(report.comparison.changedRiskRows, ['drivers:driver-a']);
    assert.ok(report.comparison.changedSections.includes('term'));
    const command = {
      ...input,
      participants: externalQuote.participants,
      idempotencyKey: randomUUID(),
      expectedRenewalHash: report.renewalHash,
    };
    const created = insuranceMutationResultSchema.parse(
      f.execute('insurance_create_renewal_quote', command),
    );
    assert.notEqual(created.record.id, source.id);
    assert.equal(created.record.status, 'quoted');
    assert.equal(created.record.approval, undefined);
    assert.equal(created.record.renewal?.source.recordHash, source.recordHash);
    assert.deepEqual(f.execute('insurance_create_renewal_quote', command), created);
    assert.deepEqual(f.store.insuranceRead(f.context, source.id), original);
    const duplicateInput = { ...input, submission: { ...s, reference: 'another-quote-same-term' } };
    const duplicatePreview = insuranceOperations.insurance_evaluate_renewal.output.parse(
      f.execute('insurance_evaluate_renewal', duplicateInput),
    );
    assert.throws(
      () =>
        f.execute('insurance_create_renewal_quote', {
          ...duplicateInput,
          participants: externalQuote.participants,
          idempotencyKey: randomUUID(),
          expectedRenewalHash: duplicatePreview.renewalHash,
        }),
      fails('RENEWAL_EXISTS'),
    );
    const bound = f.bind(created.record);
    assert.equal(bound.status, 'bound');
    assert.deepEqual(bound.renewal, created.record.renewal);
    assert.equal(f.store.insuranceHistory(f.context, source.id).revisions.length, 2);
  } finally {
    f.store.close();
  }
});
test('renewal keeps missing inputs/referrals visible; overlap, cancellation branch and source mutation cannot silently bind', () => {
  const f = setupConfiguredV2();
  try {
    const source = f.bind(f.create()),
      s = copy(multiRiskSubmission);
    s.reference = 'synthetic-renewal-reviewed';
    s.term = { startDate: '2026-09-14', endDate: '2026-09-17' };
    const input = {
      sourceRecordId: source.id,
      sourceVersion: source.version,
      sourceRecordHash: source.recordHash,
      productId: source.productId,
      productVersion: source.productVersion,
      submission: s,
    };
    assert.throws(
      () =>
        f.execute('insurance_evaluate_renewal', {
          ...input,
          submission: { ...s, term: multiRiskSubmission.term },
        }),
      fails('RENEWAL_TERM_OVERLAP'),
    );
    delete s.riskGroups[0]!.rows[0]!.answers.name;
    assert.equal(
      insuranceOperations.insurance_evaluate_renewal.output.parse(
        f.execute('insurance_evaluate_renewal', input),
      ).evaluation.validation.status,
      'invalid',
    );
    s.riskGroups[0]!.rows[0]!.answers.name = 'Renewal Example';
    s.riskGroups[0]!.rows[0]!.answers.age = 19;
    let preview = insuranceOperations.insurance_evaluate_renewal.output.parse(
      f.execute('insurance_evaluate_renewal', input),
    );
    assert.equal(preview.evaluation.referral.status, 'required');
    const referred = insuranceMutationResultSchema.parse(
      f.execute('insurance_create_renewal_quote', {
        ...input,
        participants: externalQuote.participants,
        idempotencyKey: randomUUID(),
        expectedRenewalHash: preview.renewalHash,
      }),
    ).record;
    assert.throws(() => f.bind(referred), fails('QUOTE_NOT_READY'));
    const updated = copy(multiRiskSubmission);
    updated.version = '2';
    updated.riskGroups[0]!.rows[0]!.answers.name = 'Updated original risk';
    const service = {
      recordId: source.id,
      recordHash: source.recordHash,
      expectedVersion: source.version,
      submission: updated,
      effectiveDate: '2026-09-10',
      reason: 'Synthetic original risk change after renewal quote',
      evidenceRefs: ['synthetic://renewal-source-change'],
    };
    const sp = insuranceOperations.insurance_evaluate_service.output.parse(
      f.execute('insurance_evaluate_service', service),
    );
    f.execute('insurance_service_configured', {
      ...service,
      idempotencyKey: randomUUID(),
      expectedEvaluationHash: sp.evaluationHash,
    });
    assert.throws(() => f.bind(referred), fails('VERSION_CONFLICT'));
  } finally {
    f.store.close();
  }
});
