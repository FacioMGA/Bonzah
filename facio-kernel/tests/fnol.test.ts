import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/storage/store.js';
import { fnolViewSchema, syntheticFnolDestination } from '../src/contracts/fnol.js';
import { Kernel } from '../src/application/kernel.js';
import { setupConfiguredV2 } from './fixtures/configured-v2.js';
import { multiRiskSubmission } from './fixtures/insurance-v2.js';
import { configuredServiceEvaluationSchema } from '../src/contracts/insurance-service.js';
import { testNow } from './fixtures/insurance.js';
import { KernelError } from '../src/domain/canonical.js';
import { insuranceMutationResultSchema } from '../src/contracts/insurance.js';
import { fnolFixture, fnolCas, syntheticFnolDetails } from './fixtures/fnol.js';
const fails = (code: string) => (error: unknown) =>
  error instanceof KernelError && error.code === code;
const copy = <T>(value: T): T => structuredClone(value);

test('FNOL save/resume, single submission and internal acknowledgement preserve exact policy/preparer facts across restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fnol-test-')),
    path = join(directory, 'kernel.sqlite'),
    f = fnolFixture(path);
  try {
    const details = copy(syntheticFnolDetails);
    details.loss.description = '';
    details.evidence = [];
    details.declaration.confirmed = false;
    const command = f.command('source-stable-1', details),
      draft = fnolViewSchema.parse(f.execute('fnol_create', command));
    assert.equal(draft.notice.status, 'draft');
    assert.equal(draft.assessment.canSubmit, false);
    assert.throws(
      () => f.execute('fnol_submit', { ...fnolCas(draft.notice), duplicateReview: null }),
      fails('FNOL_VALIDATION_FAILED'),
    );
    const updated = fnolViewSchema.parse(
      f.execute('fnol_update', { ...fnolCas(draft.notice), details: copy(syntheticFnolDetails) }),
    );
    assert.equal(updated.notice.version, 2);
    assert.equal(updated.assessment.canSubmit, true);
    const submission = { ...fnolCas(updated.notice), duplicateReview: null };
    const submitted = fnolViewSchema.parse(f.execute('fnol_submit', submission));
    assert.equal(submitted.notice.status, 'submitted');
    assert.equal(submitted.assessment.adjudication, 'not_performed');
    assert.deepEqual(f.execute('fnol_submit', submission), submitted);
    const handoff = { ...fnolCas(submitted.notice) },
      ack = fnolViewSchema.parse(f.execute('fnol_handoff', handoff));
    assert.equal(ack.notice.status, 'acknowledged');
    assert.equal(ack.notice.acknowledgement!.submittedNoticeHash, submitted.notice.noticeHash);
    assert.equal(ack.notice.acknowledgement!.externalDelivery, 'not_attempted');
    assert.equal(ack.assessment.publicLink, 'not_implemented');
    assert.deepEqual(
      ack.history.map((item) => item.status),
      ['draft', 'draft', 'submitted', 'acknowledged'],
    );
    assert.deepEqual(f.execute('fnol_handoff', handoff), ack);
    assert.equal(
      fnolViewSchema.parse(f.execute('fnol_create', command)).notice.version,
      1,
      'Original idempotent receipt must not silently become a later action',
    );
    const recovered = fnolViewSchema.parse(
      f.execute(
        'fnol_create',
        { ...command, idempotencyKey: randomUUID() },
        { ...f.context, actorId: 'other-authorized-preparer' },
      ),
    );
    assert.deepEqual(
      recovered.notice,
      ack.notice,
      'Stable source ref returns existing record, without substituting actor or original facts',
    );
    assert.throws(
      () =>
        f.execute('fnol_create', {
          ...command,
          idempotencyKey: randomUUID(),
          details: copy(syntheticFnolDetails),
        }),
      fails('FNOL_SOURCE_CONFLICT'),
    );
    assert.throws(
      () =>
        f.execute('fnol_update', { ...fnolCas(ack.notice), details: copy(syntheticFnolDetails) }),
      fails('INVALID_TRANSITION'),
    );
    assert.deepEqual(f.store.insuranceRead(f.context, f.bound.id), f.bound);
    f.store.close();
    const reopened = new Store(path);
    try {
      assert.deepEqual(reopened.fnol.history(f.context, ack.notice.id), ack.history);
      assert.equal(
        reopened.fnol.read(f.context, ack.notice.id).policySnapshot.recordHash,
        f.bound.recordHash,
      );
    } finally {
      reopened.close();
    }
  } finally {
    try {
      f.store.close();
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});

test('FNOL duplicate review and out-of-term chronology flag retain reports without deciding coverage', () => {
  const f = fnolFixture();
  try {
    const first = f.create(),
      second = f.create('related-notice');
    assert.deepEqual(second.notice.possibleDuplicateIds, [first.notice.id]);
    assert.deepEqual(
      fnolViewSchema.parse(f.execute('fnol_get', { noticeId: first.notice.id })).assessment
        .possibleDuplicateIds,
      [second.notice.id],
    );
    assert.throws(
      () => f.execute('fnol_submit', { ...fnolCas(second.notice), duplicateReview: null }),
      fails('FNOL_DUPLICATE_REVIEW_REQUIRED'),
    );
    const submitted = fnolViewSchema.parse(
      f.execute('fnol_submit', {
        ...fnolCas(second.notice),
        duplicateReview: {
          disposition: 'related_notice',
          reason: 'Same reported incident from another declared preparer; retain provenance.',
        },
      }),
    );
    assert.equal(submitted.notice.duplicateReview?.disposition, 'related_notice');
    assert.equal(f.store.fnol.read(f.context, first.notice.id).status, 'draft');
    const earlier = copy(syntheticFnolDetails);
    earlier.loss.occurredAt = '2026-08-31T23:30:00-05:00';
    const outside = f.create('outside-term', earlier);
    assert.equal(outside.assessment.lossCalendarDate, '2026-08-31');
    assert.equal(outside.assessment.termStatus, 'outside_recorded_term');
    assert.equal(outside.assessment.canSubmit, true);
    assert(outside.assessment.flags.some((flag) => flag.includes('not a coverage denial')));
    assert.equal(
      fnolViewSchema.parse(
        f.execute('fnol_submit', { ...fnolCas(outside.notice), duplicateReview: null }),
      ).notice.status,
      'submitted',
    );
    const future = copy(syntheticFnolDetails);
    future.loss.occurredAt = '2026-09-11T00:00:00Z';
    assert.equal(f.create('future-source-date', future).assessment.canSubmit, false);
  } finally {
    f.store.close();
  }
});

test('FNOL rejects scoped access bypasses, stale writes, quote targets and injected authority fields', () => {
  const f = fnolFixture();
  try {
    const created = f.create();
    for (const field of ['workspaceId', 'tenantId', 'environment', 'operatingEntityId'] as const) {
      const actor = { ...f.context, [field]: field === 'environment' ? 'sandbox' : 'other-scope' };
      assert.throws(
        () => f.execute('fnol_get', { noticeId: created.notice.id }, actor),
        fails('NOT_FOUND'),
      );
    }
    assert.throws(
      () =>
        f.execute('fnol_create', f.command('denied'), { ...f.context, permissions: ['fnol:read'] }),
      fails('FORBIDDEN'),
    );
    assert.throws(
      () =>
        f.execute('fnol_handoff', fnolCas(created.notice), {
          ...f.context,
          permissions: ['fnol:write'],
        }),
      fails('FORBIDDEN'),
    );
    assert.throws(
      () =>
        f.execute('fnol_update', {
          ...fnolCas(created.notice),
          noticeHash: '0'.repeat(64),
          details: copy(syntheticFnolDetails),
        }),
      fails('VERSION_CONFLICT'),
    );
    assert.throws(
      () =>
        f.execute('fnol_create', {
          ...f.command('quote'),
          recordVersion: f.quoted.version,
          recordHash: f.quoted.recordHash,
        }),
      fails('FNOL_POLICY_NOT_BOUND'),
    );
    assert.throws(
      () =>
        f.execute('fnol_create', {
          ...f.command('unknown-destination'),
          destinationVersion: '99.0.0',
        }),
      fails('FNOL_DESTINATION_UNCONFIGURED'),
    );
    assert.throws(
      () => f.execute('fnol_create', { ...f.command('injected'), actorId: 'admin' }),
      /unrecognized/i,
    );
    const posted = insuranceMutationResultSchema.parse(
      f.kernel.execute(
        'insurance_service',
        {
          recordId: f.bound.id,
          expectedVersion: f.bound.version,
          recordHash: f.bound.recordHash,
          action: 'endorsement',
          premiumDeltaMinor: '100',
          effectiveDate: '2026-09-10',
          reason: 'Synthetic later transaction',
          idempotencyKey: randomUUID(),
        },
        f.context,
      ),
    ).record;
    assert.equal(posted.version, 3);
    assert.equal(
      fnolViewSchema.parse(f.execute('fnol_get', { noticeId: created.notice.id })).notice
        .policySnapshot.version,
      2,
    );
    assert.equal(f.store.fnol.list(f.context, f.bound.id).notices.length, 1);
  } finally {
    f.store.close();
  }
});

test('immutable notice/source/idempotency rows reject mutation and detect byte corruption on scoped reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fnol-integrity-')),
    path = join(directory, 'kernel.sqlite'),
    f = fnolFixture(path);
  try {
    const notice = f.create().notice,
      db = new DatabaseSync(path);
    try {
      assert.throws(
        () =>
          db
            .prepare('UPDATE fnol_notices SET notice_hash=? WHERE id=?')
            .run('0'.repeat(64), notice.id),
        /immutable FNOL/,
      );
      db.exec('DROP TRIGGER fnol_notices_no_update');
      db.prepare('UPDATE fnol_notices SET notice_hash=? WHERE id=?').run('0'.repeat(64), notice.id);
      assert.throws(() => f.execute('fnol_get', { noticeId: notice.id }), fails('INTEGRITY_ERROR'));
    } finally {
      db.close();
    }
  } finally {
    f.store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('possible duplicate search finds matching older notices beyond unrelated list pagination', () => {
  const f = fnolFixture();
  try {
    const original = f.create();
    for (let i = 0; i < 105; i++) {
      const details = copy(syntheticFnolDetails);
      details.loss.location = `Unrelated location ${i}`;
      f.create(`unrelated-${i}`, details);
    }
    const latest = f.create('matching-after-list-bound');
    assert.deepEqual(latest.notice.possibleDuplicateIds, [original.notice.id]);
    assert.throws(
      () => f.execute('fnol_submit', { ...fnolCas(latest.notice), duplicateReview: null }),
      fails('FNOL_DUPLICATE_REVIEW_REQUIRED'),
    );
  } finally {
    f.store.close();
  }
});

test('FNOL keeps the selected future-effective service snapshot and flags earlier loss chronology', () => {
  const f = setupConfiguredV2(),
    kernel = new Kernel(
      f.store,
      [],
      [],
      testNow,
      { region: 'test', buildSha: 'a'.repeat(40) },
      [],
      [],
      [syntheticFnolDestination],
    );
  try {
    const bound = f.bind(f.create()),
      submission = copy(multiRiskSubmission);
    submission.version = '2';
    submission.term.endDate = '2026-09-15';
    const input = {
      recordId: bound.id,
      expectedVersion: bound.version,
      recordHash: bound.recordHash,
      submission,
      effectiveDate: '2026-09-11',
      reason: 'Future-effective training extension',
      evidenceRefs: ['fixture://fnol/future-effective-service'],
    };
    const preview = configuredServiceEvaluationSchema.parse(
      f.execute('insurance_evaluate_service', input),
    );
    const changed = insuranceMutationResultSchema.parse(
      f.execute('insurance_service_configured', {
        ...input,
        expectedEvaluationHash: preview.evaluationHash,
        idempotencyKey: randomUUID(),
      }),
    ).record;
    const details = copy(syntheticFnolDetails);
    details.loss.occurredAt = '2026-09-10T10:00:00Z';
    const notice = fnolViewSchema.parse(
      kernel.execute(
        'fnol_create',
        {
          recordId: changed.id,
          recordVersion: changed.version,
          recordHash: changed.recordHash,
          sourceReference: 'future-effective-service-notice',
          destinationId: syntheticFnolDestination.id,
          destinationVersion: syntheticFnolDestination.version,
          details,
          idempotencyKey: randomUUID(),
        },
        f.context,
      ),
    );
    assert.equal(notice.notice.policySnapshot.version, 3);
    assert.equal(notice.assessment.term.endDate, '2026-09-15');
    assert(
      notice.assessment.flags.some((flag) =>
        flag.includes('takes effect 2026-09-11, after the reported loss date'),
      ),
    );
    assert.equal(notice.assessment.adjudication, 'not_performed');
    assert.deepEqual(notice.notice.policySnapshot.quote, bound.quote);
  } finally {
    f.store.close();
  }
});
