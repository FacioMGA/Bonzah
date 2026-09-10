import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';
import { insuranceOperations, insuranceMutationResultSchema } from '../src/contracts/insurance.js';
import { configuredServiceEvaluationSchema } from '../src/contracts/insurance-service.js';
import { setupConfiguredV2 } from './fixtures/configured-v2.js';
import { multiRiskDefinition, multiRiskSubmission } from './fixtures/insurance-v2.js';
import { KernelError } from '../src/domain/canonical.js';
const copy = <T>(v: T): T => structuredClone(v);
const fails = (code: string) => (error: unknown) =>
  error instanceof KernelError && error.code === code;
test('configured service is durable, idempotent, pinned and scoped; original quote and immutable revision are preserved', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'facio-service-')),
    path = join(folder, 'store.sqlite');
  const f = setupConfiguredV2(path);
  try {
    const original = f.bind(f.create()),
      submission = copy(multiRiskSubmission);
    submission.version = '2';
    submission.term.endDate = '2026-09-15';
    const input = {
      recordId: original.id,
      expectedVersion: original.version,
      recordHash: original.recordHash,
      submission,
      effectiveDate: '2026-09-10',
      reason: 'Synthetic extension',
      evidenceRefs: ['synthetic://extension'],
    };
    const preview = configuredServiceEvaluationSchema.parse(
      f.execute('insurance_evaluate_service', input),
    );
    assert.equal(preview.status, 'allowed', preview.reasons.join(';'));
    const command = {
      ...input,
      expectedEvaluationHash: preview.evaluationHash,
      idempotencyKey: randomUUID(),
    };
    const result = insuranceMutationResultSchema.parse(
      f.execute('insurance_service_configured', command),
    );
    assert.equal(result.record.premiumMinor, '7200');
    assert.equal(result.event.premiumDeltaMinor, '2400');
    assert.equal(result.record.financials.commission.amountMinor, '720');
    assert.deepEqual(result.record.quote, original.quote);
    assert.deepEqual(result.record.decision, original.decision);
    assert.deepEqual(f.execute('insurance_service_configured', command), result);
    assert.throws(
      () => f.execute('insurance_service_configured', { ...command, idempotencyKey: randomUUID() }),
      fails('VERSION_CONFLICT'),
    );
    assert.throws(
      () =>
        f.kernel.execute('insurance_service_configured', command, {
          ...f.context,
          permissions: ['insurance:read'],
        }),
      fails('FORBIDDEN'),
    );
    assert.throws(
      () =>
        f.kernel.execute('insurance_evaluate_service', input, {
          ...f.context,
          tenantId: 'another',
        }),
      fails('NOT_FOUND'),
    );
    const current = result.record,
      duplicate = {
        ...input,
        expectedVersion: current.version,
        recordHash: current.recordHash,
        submission: { ...submission, term: { ...submission.term, endDate: '2026-09-16' } },
      };
    assert.equal(
      configuredServiceEvaluationSchema.parse(f.execute('insurance_evaluate_service', duplicate))
        .status,
      'blocked',
    );
    assert.deepEqual(f.store.insuranceHistory(f.context, original.id).revisions[1], original);
    f.store.close();
    const reopened = new Store(path);
    try {
      assert.deepEqual(reopened.insuranceRead(f.context, original.id), result.record);
    } finally {
      reopened.close();
    }
  } finally {
    try {
      f.store.close();
    } catch {}
    await rm(folder, { recursive: true, force: true });
  }
});

test('subsequent service pins prior effective exposure and rejects reassigned risk IDs and changed retained evidence', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'facio-service-integrity-')),
    path = join(folder, 'store.sqlite'),
    f = setupConfiguredV2(path);
  try {
    let current = f.bind(f.create());
    const service = (submission: typeof multiRiskSubmission) => {
      const input = {
        recordId: current.id,
        expectedVersion: current.version,
        recordHash: current.recordHash,
        submission,
        effectiveDate: '2026-09-10',
        reason: 'Synthetic scheduled risk update',
        evidenceRefs: ['synthetic://service-integrity'],
      };
      const preview = configuredServiceEvaluationSchema.parse(
        f.execute('insurance_evaluate_service', input),
      );
      return {
        input,
        preview,
        commit: () =>
          insuranceMutationResultSchema.parse(
            f.execute('insurance_service_configured', {
              ...input,
              idempotencyKey: randomUUID(),
              expectedEvaluationHash: preview.evaluationHash,
            }),
          ).record,
      };
    };
    const first = copy(multiRiskSubmission);
    first.version = '2';
    first.riskGroups[0]!.rows.push({
      rowId: 'driver-b',
      answers: { name: 'Example B', age: 40, 'previous-loss': false },
    });
    current = service(first).commit();
    const second = copy(first);
    second.version = '3';
    second.riskGroups[0]!.rows.pop();
    current = service(second).commit();
    const third = copy(first);
    third.version = '4';
    assert.ok(service(third).preview.reasons.some((r) => r.includes('removed stable')));
    assert.equal(current.premiumMinor, '4800');
    assert.equal(f.store.insuranceHistory(f.context, current.id).revisions.length, 4);
    const { DatabaseSync } = await import('node:sqlite'),
      { canonicalJson, hash } = await import('../src/domain/canonical.js');
    const db = new DatabaseSync(path);
    assert.throws(
      () =>
        db
          .prepare('UPDATE insurance_revisions SET record_hash=? WHERE record_id=?')
          .run('0'.repeat(64), current.id),
      /immutable insurance revision/,
    );
    // Simulate offline corruption after proving normal immutable-table protection.
    db.exec('DROP TRIGGER insurance_revisions_no_update');
    const corrupt = copy(current);
    corrupt.configuredService!.calculation!.addedPremiumMinor = '9999';
    const { recordHash: _, ...content } = corrupt;
    corrupt.recordHash = hash(content);
    db.prepare(
      'UPDATE insurance_revisions SET record_json=?,record_hash=? WHERE record_id=? AND version=?',
    ).run(canonicalJson(corrupt), corrupt.recordHash, current.id, current.version);
    db.prepare('UPDATE insurance_records SET record_hash=? WHERE id=?').run(
      corrupt.recordHash,
      current.id,
    );
    db.close();
    assert.throws(() => f.store.insuranceRead(f.context, current.id), fails('INTEGRITY_ERROR'));
  } finally {
    f.store.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('configured cancellation is a distinct return-premium branch with zero and earned balances, no cash refund, durable exact evidence', () => {
  const f = setupConfiguredV2();
  try {
    const definition = copy(
      f.inspect().activeRelease!.configuration.configuration.products[0]!.insurance!,
    );
    assert.equal(definition.schemaVersion, 'insurance-product-v2');
    if (definition.schemaVersion !== 'insurance-product-v2') return;
    definition.cancellation = {
      calculation: 'per_day_remaining',
      minimumPremiumTreatment: 'block_if_applied',
      sourceRefs: ['synthetic://return-rule'],
    };
    f.update(definition);
    f.activate();
    for (const [offset, date, returned, total] of [
      ['1', '2026-09-10', '4800', '0'],
      ['2', '2026-09-12', '2400', '2400'],
      ['3', '2026-09-14', '0', '4800'],
    ]) {
      const submission = copy(multiRiskSubmission);
      submission.reference += '-cancel-' + offset;
      const original = f.bind(f.create(submission));
      const input = {
        recordId: original.id,
        expectedVersion: original.version,
        recordHash: original.recordHash,
        effectiveDate: date,
        reason: 'Synthetic separate cancellation branch',
        evidenceRefs: ['synthetic://cancellation'],
      };
      const preview = insuranceOperations.insurance_evaluate_cancellation.output.parse(
        f.execute('insurance_evaluate_cancellation', input),
      );
      assert.equal(preview.status, 'allowed', preview.reasons.join(';'));
      assert.equal(preview.calculation?.returnPremiumMinor, returned);
      const command = {
        ...input,
        idempotencyKey: randomUUID(),
        expectedEvaluationHash: preview.evaluationHash,
      };
      const result = insuranceMutationResultSchema.parse(
        f.execute('insurance_cancel_configured', command),
      );
      assert.equal(result.record.status, 'cancelled');
      assert.equal(result.record.premiumMinor, total);
      assert.equal(result.event.type, 'cancellation');
      assert.equal(result.event.premiumDeltaMinor, (-BigInt(returned!)).toString());
      assert.equal(result.record.configuredCancellation?.refundStatus, 'not_requested');
      assert.equal(result.record.configuredCancellation?.noticeStatus, 'not_issued');
      assert.deepEqual(result.record.quote, original.quote);
      assert.deepEqual(f.execute('insurance_cancel_configured', command), result);
      assert.deepEqual(f.store.insuranceRead(f.context, original.id), result.record);
    }
  } finally {
    f.store.close();
  }
});

test('event-only corruption cannot backdate known evidence or change effective chronology after rehashing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'facio-event-clock-')),
    path = join(directory, 'store.sqlite'),
    f = setupConfiguredV2(path);
  try {
    const record = f.bind(f.create());
    const { DatabaseSync } = await import('node:sqlite'),
      { canonicalJson, hash } = await import('../src/domain/canonical.js');
    const db = new DatabaseSync(path);
    db.exec('DROP TRIGGER insurance_events_no_update');
    const row = db
      .prepare('SELECT * FROM insurance_events WHERE record_id=? AND version=?')
      .get(record.id, record.version)!;
    const original = JSON.parse(String(row.event_json));
    for (const altered of [
      { ...original, createdAt: '2026-01-01T00:00:00.000Z' },
      { ...original, effectiveDate: '2026-09-11' },
    ]) {
      db.prepare('UPDATE insurance_events SET event_json=?,event_hash=? WHERE id=?').run(
        canonicalJson(altered),
        hash(altered),
        original.id,
      );
      assert.throws(() => f.store.insuranceHistory(f.context, record.id), fails('INTEGRITY_ERROR'));
    }
    db.close();
  } finally {
    f.store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('whole-term service and cancellation retain exact independently rounded remaining exposure', () => {
  const f = setupConfiguredV2();
  try {
    const definition = structuredClone(multiRiskDefinition);
    definition.rating.termBasis = 'whole_term';
    definition.servicing = {
      mode: 'recalculate_remaining',
      allowRiskChanges: true,
      allowTermExtension: false,
      calculation: 'actual_days_pro_rata',
      minimumPremiumTreatment: 'block_if_applied',
      sourceRefs: ['synthetic://review'],
    };
    definition.cancellation = {
      calculation: 'actual_days_pro_rata',
      minimumPremiumTreatment: 'block_if_applied',
      sourceRefs: ['synthetic://review'],
    };
    definition.coverages[0]!.rate = { method: 'flat', premiumMinor: '1' };
    definition.coverages[1]!.rate = { method: 'flat', premiumMinor: '2' };
    f.update(definition);
    f.activate();
    const record = f.bind(f.create());
    assert.equal(record.premiumMinor, '3');
    const submission = structuredClone(multiRiskSubmission);
    submission.version = '2';
    submission.coverages.pop();
    const input = {
      recordId: record.id,
      expectedVersion: record.version,
      recordHash: record.recordHash,
      submission,
      effectiveDate: '2026-09-11',
      reason: 'Whole term synthetic review',
      evidenceRefs: ['synthetic://review'],
    };
    const preview = insuranceOperations.insurance_evaluate_service.output.parse(
      f.execute('insurance_evaluate_service', input),
    );
    assert.equal(preview.status, 'allowed');
    assert.equal(preview.calculation?.removedPremiumMinor, '2');
    assert.equal(preview.calculation?.addedPremiumMinor, '1');
    const revised = insuranceMutationResultSchema.parse(
      f.execute('insurance_service_configured', {
        ...input,
        idempotencyKey: randomUUID(),
        expectedEvaluationHash: preview.evaluationHash,
      }),
    ).record;
    const cancellation = {
      recordId: revised.id,
      expectedVersion: revised.version,
      recordHash: revised.recordHash,
      effectiveDate: '2026-09-12',
      reason: 'Whole term synthetic cancellation review',
      evidenceRefs: ['synthetic://review'],
    };
    const quoted = insuranceOperations.insurance_evaluate_cancellation.output.parse(
      f.execute('insurance_evaluate_cancellation', cancellation),
    );
    assert.equal(quoted.status, 'allowed');
    assert.equal(quoted.calculation?.returnPremiumMinor, '1');
    assert.equal(quoted.calculation?.resultingPremiumMinor, '1');
    const cancelled = insuranceMutationResultSchema.parse(
      f.execute('insurance_cancel_configured', {
        ...cancellation,
        idempotencyKey: randomUUID(),
        expectedEvaluationHash: quoted.evaluationHash,
      }),
    ).record;
    assert.equal(f.store.insuranceRead(f.context, record.id).recordHash, cancelled.recordHash);
  } finally {
    f.store.close();
  }
});
