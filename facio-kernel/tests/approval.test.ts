import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { approvalOperations, approvalResultSchema } from '../src/contracts/approval.js';
import { insuranceMutationResultSchema } from '../src/contracts/insurance.js';
import { KernelError, hash } from '../src/domain/canonical.js';
import { Store } from '../src/storage/store.js';
import { Kernel } from '../src/application/kernel.js';
import {
  approvalFixture,
  approvalBuilder,
  approvalReviewer,
  approvalOtherReviewer,
  approvalOutsider,
  reviewEvidence,
} from './fixtures/approval.js';
import {
  syntheticInsuranceDefinition,
  configuredRuntimePolicy,
} from './fixtures/insurance-definition.js';
import { externalQuote, insuranceContext, runtimePolicy, testNow } from './fixtures/insurance.js';
const fail = (code: string) => (error: unknown) =>
  error instanceof KernelError && error.code === code;

test('independent approval resolves a supported referral without rewriting the quote or original decision', () => {
  const f = approvalFixture();
  try {
    const record = f.create();
    const original = JSON.stringify(f.store.insuranceRead(f.context, record.id));
    assert.throws(() => f.bind(record), fail('QUOTE_NOT_READY'));
    const requested = f.request(record);
    assert.equal(requested.effectiveStatus, 'requested');
    assert.equal(requested.canDecide, false);
    assert.equal(requested.approval.target.inputHash, record.decision!.evaluation.inputHash);
    assert.throws(
      () => f.execute('approval_decide', f.decisionInput(requested.approval)),
      fail('FORBIDDEN'),
    );
    const approved = f.decide(requested.approval);
    assert.equal(approved.effectiveStatus, 'approved');
    assert.equal(approved.history.length, 2);
    assert.equal(JSON.stringify(f.store.insuranceRead(f.context, record.id)), original);
    const list = approvalOperations.approval_list.output.parse(
      f.execute('approval_list', { recordId: record.id }),
    );
    assert.equal(list.bindableApprovalId, approved.approval.id);
    const bound = f.bind(record, approved.approval.id);
    assert.equal(bound.approval!.reviewerId, approvalReviewer.actorId);
    assert.equal(bound.approval!.target.recordHash, record.recordHash);
    assert.deepEqual(bound.decision!.evaluation, record.decision!.evaluation);
    assert.equal(bound.decision!.bindEvaluation!.evaluation.bind.status, 'blocked');
    assert.equal(bound.status, 'bound');
    assert.equal(bound.quote.eligibility, 'referred');
    const consumed = approvalResultSchema.parse(
      f.execute('approval_get', { approvalId: approved.approval.id }, approvalReviewer),
    );
    assert.equal(consumed.effectiveStatus, 'consumed');
    assert.equal(consumed.canRevoke, false);
    assert.throws(
      () =>
        f.execute(
          'approval_revoke',
          { ...f.decisionInput(approved.approval), decision: undefined },
          approvalReviewer,
        ),
      fail('VALIDATION_ERROR'),
    );
    const { decision: _, ...revoke } = f.decisionInput(approved.approval);
    assert.throws(
      () => f.execute('approval_revoke', revoke, approvalReviewer),
      fail('APPROVAL_NOT_REVOCABLE'),
    );
    assert.equal(f.store.insuranceOutbox(f.context).length, 2);
  } finally {
    f.store.close();
  }
});

test('reviewer independence includes record creator, current author and requester; authoritative role and scope deny bypasses', () => {
  const f = approvalFixture();
  try {
    const record = f.create(undefined, approvalReviewer);
    const requested = f.request(record);
    assert.throws(() => f.decide(requested.approval), fail('SELF_REVIEW_FORBIDDEN'));
    assert.equal(
      f.decide(requested.approval, 'approve', approvalOtherReviewer).effectiveStatus,
      'approved',
    );
    const another = f.create({ ...f.submission, reference: 'second-independent' });
    const adminRequested = f.request(another, approvalReviewer);
    assert.throws(() => f.decide(adminRequested.approval), fail('SELF_REVIEW_FORBIDDEN'));
    const prepared = f.create({ ...f.submission, reference: 'independent-author' });
    const revisedSubmission = { ...f.submission, reference: 'independent-author', version: '2' };
    const revised = insuranceMutationResultSchema.parse(
      f.execute(
        'insurance_revise_configured_quote',
        {
          idempotencyKey: randomUUID(),
          recordId: prepared.id,
          expectedVersion: prepared.version,
          recordHash: prepared.recordHash,
          submission: revisedSubmission,
          participants: externalQuote.participants,
          expectedEvaluationHash: f.evaluate(revisedSubmission, prepared.id).evaluationHash,
        },
        approvalReviewer,
      ),
    ).record;
    const authorRequest = f.request(revised);
    assert.equal(authorRequest.approval.recordAuthorId, approvalReviewer.actorId);
    assert.throws(() => f.decide(authorRequest.approval), fail('SELF_REVIEW_FORBIDDEN'));
    assert.throws(
      () => f.execute('approval_get', { approvalId: requested.approval.id }, approvalOutsider),
      fail('FORBIDDEN'),
    );
    for (const scope of [
      { workspaceId: 'other' },
      { tenantId: 'other' },
      { operatingEntityId: 'other' },
      { environment: 'development' as const },
    ])
      assert.throws(
        () => f.store.approvals.read({ ...f.context, ...scope }, requested.approval.id),
        fail('NOT_FOUND'),
      );
    assert.throws(
      () =>
        f.kernel.execute(
          'approval_get',
          { approvalId: requested.approval.id },
          { ...f.context, environment: 'production' },
        ),
      fail('RUNTIME_ENVIRONMENT_UNSUPPORTED'),
    );
  } finally {
    f.store.close();
  }
});

test('decision expiry, stale hashes, decline finality and fresh membership revocation fail closed', () => {
  const f = approvalFixture();
  try {
    const record = f.create();
    const requested = f.request(record);
    assert.throws(
      () =>
        f.execute(
          'approval_decide',
          { ...f.decisionInput(requested.approval), approvalHash: '0'.repeat(64) },
          approvalReviewer,
        ),
      fail('VERSION_CONFLICT'),
    );
    const declined = f.decide(requested.approval, 'decline');
    assert.equal(declined.effectiveStatus, 'declined');
    assert.throws(() => f.decide(declined.approval), fail('APPROVAL_NOT_DECIDABLE'));
    assert.throws(() => f.bind(record, declined.approval.id), fail('APPROVAL_NOT_APPROVED'));
    assert.throws(() => f.request(record), fail('APPROVAL_EXISTS'));
    const expiring = f.request(f.create({ ...f.submission, reference: 'expire-before-review' }));
    const longQuote = f.create({
      ...f.submission,
      reference: 'seven-day-cap',
      expiresAt: '2026-09-25T12:00:00.000Z',
    });
    assert.throws(
      () =>
        f.execute('approval_request', {
          ...f.requestInput(longQuote),
          expiresAt: '2026-09-17T12:00:00.001Z',
        }),
      fail('APPROVAL_EXPIRY_INVALID'),
    );
    f.kernel.control.execute(
      'control_revoke_membership',
      {
        idempotencyKey: randomUUID(),
        accountId: 'review-account',
        actorId: approvalReviewer.actorId,
      },
      approvalOtherReviewer,
    );
    assert.throws(() => f.decide(expiring.approval), fail('FORBIDDEN'));
    f.setNow('2026-09-12T12:00:00.000Z');
    assert.throws(
      () => f.decide(expiring.approval, 'approve', approvalOtherReviewer),
      fail('APPROVAL_NOT_DECIDABLE'),
    );
  } finally {
    f.store.close();
  }
});

test('retry keys replay the immutable action with fresh status and cannot create duplicate or replace terminal reviews', () => {
  const f = approvalFixture();
  try {
    const record = f.create();
    const input = f.requestInput(record);
    const requested = approvalResultSchema.parse(f.execute('approval_request', input));
    assert.equal(
      approvalResultSchema.parse(f.execute('approval_request', input)).approval.id,
      requested.approval.id,
    );
    assert.throws(() => f.request(record), fail('APPROVAL_EXISTS'));
    assert.throws(
      () => f.execute('approval_request', input, approvalReviewer),
      fail('IDEMPOTENCY_CONFLICT'),
    );
    const decision = f.decisionInput(requested.approval);
    const approved = approvalResultSchema.parse(
      f.execute('approval_decide', decision, approvalReviewer),
    );
    assert.deepEqual(
      approvalResultSchema.parse(f.execute('approval_decide', decision, approvalReviewer)),
      approved,
    );
    const { decision: _, ...revoke } = f.decisionInput(approved.approval);
    const revoked = approvalResultSchema.parse(
      f.execute('approval_revoke', revoke, approvalReviewer),
    );
    assert.equal(revoked.history.length, 3);
    assert.equal(revoked.effectiveStatus, 'revoked');
    assert.equal(
      approvalResultSchema.parse(f.execute('approval_decide', decision, approvalReviewer))
        .effectiveStatus,
      'revoked',
    );
    assert.throws(() => f.bind(record, requested.approval.id), fail('APPROVAL_NOT_APPROVED'));
    assert.throws(() => f.request(record), fail('APPROVAL_EXISTS'));
    assert.throws(() => f.decide(revoked.approval), fail('APPROVAL_NOT_DECIDABLE'));
  } finally {
    f.store.close();
  }
});

test('expiry is bounded by quote expiry and seven days; expiry and UTC backdating are rechecked at decision and bind', () => {
  const f = approvalFixture();
  try {
    const record = f.create();
    const input = f.requestInput(record);
    for (const expiresAt of [
      '2026-09-10T12:00:00.000Z',
      '2026-09-16T12:00:00.000Z',
      '2026-09-20T12:00:00.000Z',
    ])
      assert.throws(
        () => f.execute('approval_request', { ...input, idempotencyKey: randomUUID(), expiresAt }),
        fail('APPROVAL_EXPIRY_INVALID'),
      );
    const requested = f.request(record);
    const approved = f.decide(requested.approval);
    f.setNow('2026-09-11T12:00:00.000Z');
    assert.equal(
      approvalResultSchema.parse(f.execute('approval_get', { approvalId: approved.approval.id }))
        .effectiveStatus,
      'approved',
    );
    f.setNow('2026-09-12T12:00:00.000Z');
    assert.equal(
      approvalResultSchema.parse(f.execute('approval_get', { approvalId: approved.approval.id }))
        .effectiveStatus,
      'expired',
    );
    assert.throws(() => f.bind(record, approved.approval.id), fail('APPROVAL_EXPIRED'));
    const next = f.create({ ...f.submission, reference: 'longer-review' });
    const nextRequest = approvalResultSchema.parse(
      f.execute('approval_request', {
        ...f.requestInput(next),
        expiresAt: '2026-09-15T11:00:00.000Z',
      }),
    );
    f.decide(nextRequest.approval);
    f.setNow('2026-09-13T12:00:00.000Z');
    assert.equal(
      approvalResultSchema.parse(f.execute('approval_get', { approvalId: nextRequest.approval.id }))
        .effectiveStatus,
      'stale',
    );
    assert.throws(() => f.bind(next, nextRequest.approval.id), fail('APPROVAL_GATE_BLOCKED'));
  } finally {
    f.store.close();
  }
});

test('a review never changes quote selection; revision stales old approval while new activation preserves pinned old evidence', () => {
  const f = approvalFixture();
  try {
    const record = f.create();
    const approved = f.decide(f.request(record).approval);
    const changed = structuredClone(syntheticInsuranceDefinition);
    changed.coverages[0]!.rate = { method: 'flat', premiumMinor: '15000' };
    f.configure(changed);
    f.activate();
    const reviewed = approvalResultSchema.parse(
      f.execute('approval_get', { approvalId: approved.approval.id }),
    );
    assert.equal(hash(reviewed.reviewDefinition), record.decision!.evaluation.definitionHash);
    assert.notEqual(hash(reviewed.reviewDefinition), hash(changed));
    const reviewList = approvalOperations.approval_list.output.parse(
      f.execute('approval_list', { recordId: record.id }),
    );
    assert.deepEqual(reviewList.reviewDefinition, reviewed.reviewDefinition);
    assert.equal(
      approvalResultSchema.parse(f.execute('approval_get', { approvalId: approved.approval.id }))
        .effectiveStatus,
      'approved',
    );
    const submission = { ...f.submission, version: '2' };
    const revised = insuranceMutationResultSchema.parse(
      f.execute('insurance_revise_configured_quote', {
        idempotencyKey: randomUUID(),
        recordId: record.id,
        expectedVersion: record.version,
        recordHash: record.recordHash,
        submission,
        participants: externalQuote.participants,
        expectedEvaluationHash: f.evaluate(submission, record.id).evaluationHash,
      }),
    ).record;
    assert.equal(revised.premiumMinor, '10152');
    assert.equal(
      approvalResultSchema.parse(f.execute('approval_get', { approvalId: approved.approval.id }))
        .effectiveStatus,
      'stale',
    );
    assert.throws(() => f.bind(revised, approved.approval.id), fail('APPROVAL_STALE'));
    const next = f.request(revised);
    assert.notEqual(next.approval.id, approved.approval.id);
    assert.equal(next.approval.target.recordVersion, 2);
    assert.equal(f.bind(revised, f.decide(next.approval).approval.id).premiumMinor, '10152');
  } finally {
    f.store.close();
  }
});

test('only supported referral/routine gates are resolvable; decline, unknown, limits and backdating remain blocked', () => {
  for (const scenario of ['decline', 'unknown', 'authority', 'backdate', 'routine']) {
    const definition = structuredClone(syntheticInsuranceDefinition);
    if (scenario === 'authority') definition.authority.maximumPremiumMinor = '100';
    if (scenario === 'backdate') definition.termRules.backdating = 'requires_approval';
    const policy = structuredClone(configuredRuntimePolicy);
    if (scenario === 'routine') policy.requirements.approval = 'independent_review';
    const f = approvalFixture(':memory:', definition, policy);
    try {
      const submission = structuredClone(f.submission);
      if (scenario === 'decline') submission.answers.prohibited = true;
      if (scenario === 'unknown') delete submission.answers['prior-losses'];
      if (scenario === 'backdate') submission.term.startDate = '2026-09-09';
      if (scenario === 'routine') submission.answers.age = 35;
      const record = f.create(submission);
      if (scenario !== 'routine')
        assert.throws(() => f.request(record), fail('APPROVAL_GATE_BLOCKED'));
      else {
        const approved = f.decide(f.request(record).approval);
        assert.deepEqual(approved.approval.gates, ['routine_approval']);
        assert.equal(f.bind(record, approved.approval.id).status, 'bound');
      }
    } finally {
      f.store.close();
    }
  }
});

test('manual routine approval cannot replace payment/provider gates or authorize later service', () => {
  for (const gate of ['payment', 'providerVerification', 'approval', 'none'] as const) {
    const store = new Store(':memory:');
    const policy = {
      ...structuredClone(runtimePolicy),
      requirements: {
        payment: 'not_required' as const,
        providerVerification: 'not_required' as const,
        approval: 'independent_review' as const,
      },
    };
    const selected =
      gate === 'none'
        ? policy
        : { ...policy, requirements: { ...policy.requirements, [gate]: 'required_unsupported' } };
    const kernel = new Kernel(
      store,
      [],
      [
        {
          scope: {
            workspaceId: insuranceContext.workspaceId,
            tenantId: insuranceContext.tenantId,
            environment: insuranceContext.environment,
            operatingEntityId: insuranceContext.operatingEntityId,
          },
          policy: selected as typeof runtimePolicy,
          policyHash: hash(selected),
        },
      ],
      testNow,
    );
    const reviewer = {
      ...insuranceContext,
      actorId: 'manual-reviewer',
      permissions: [...insuranceContext.permissions, 'insurance:approve' as const],
    };
    try {
      const quote = {
        ...structuredClone(externalQuote),
        term: { startDate: '2026-09-10', endDate: '2026-09-30' },
      };
      const record = insuranceMutationResultSchema.parse(
        kernel.execute(
          'insurance_create_quote',
          {
            idempotencyKey: randomUUID(),
            productId: policy.id,
            productVersion: policy.version,
            quote,
          },
          insuranceContext,
        ),
      ).record;
      const input = {
        idempotencyKey: randomUUID(),
        recordId: record.id,
        expectedVersion: record.version,
        recordHash: record.recordHash,
        reason: 'Synthetic manual review',
        evidenceRefs: reviewEvidence,
        expiresAt: '2026-09-12T12:00:00.000Z',
      };
      if (gate !== 'none') {
        assert.throws(
          () => kernel.execute('approval_request', input, insuranceContext),
          fail('APPROVAL_GATE_BLOCKED'),
        );
        assert.equal(store.approvals.list(insuranceContext).approvals.length, 0);
      } else {
        const request = approvalResultSchema.parse(
          kernel.execute('approval_request', input, insuranceContext),
        );
        const approved = approvalResultSchema.parse(
          kernel.execute(
            'approval_decide',
            {
              idempotencyKey: randomUUID(),
              approvalId: request.approval.id,
              expectedVersion: request.approval.version,
              approvalHash: request.approval.approvalHash,
              decision: 'approve',
              reason: 'Independent synthetic manual decision',
              evidenceRefs: reviewEvidence,
            },
            reviewer,
          ),
        );
        const bound = insuranceMutationResultSchema.parse(
          kernel.execute(
            'insurance_bind',
            {
              idempotencyKey: randomUUID(),
              recordId: record.id,
              expectedVersion: record.version,
              quoteHash: record.quoteHash,
              approvalId: approved.approval.id,
            },
            insuranceContext,
          ),
        ).record;
        assert.ok(bound.approval);
        assert.throws(
          () =>
            kernel.execute(
              'insurance_service',
              {
                idempotencyKey: randomUUID(),
                recordId: bound.id,
                expectedVersion: bound.version,
                recordHash: bound.recordHash,
                action: 'endorsement',
                premiumDeltaMinor: '1',
                effectiveDate: '2026-09-10',
                reason: 'Prior bind approval cannot authorize service',
              },
              insuranceContext,
            ),
          fail('PREREQUISITE_UNSUPPORTED'),
        );
        assert.deepEqual(store.insuranceRead(insuranceContext, bound.id), bound);
      }
    } finally {
      store.close();
    }
  }
});

test('approval persistence, idempotency and action trail share atomic transactions and detect tampering after reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'approval-store-'));
  const path = join(directory, 'kernel.sqlite');
  const f = approvalFixture(path);
  try {
    const record = f.create();
    const input = f.requestInput(record);
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TRIGGER fail_approval_request BEFORE INSERT ON approval_requests BEGIN SELECT RAISE(ABORT,'synthetic persistence failure'); END;",
    );
    assert.throws(() => f.execute('approval_request', input));
    assert.equal(f.store.approvals.list(f.context).approvals.length, 0);
    db.exec('DROP TRIGGER fail_approval_request');
    db.close();
    const request = approvalResultSchema.parse(f.execute('approval_request', input));
    const approved = f.decide(request.approval);
    const bound = f.bind(record, approved.approval.id);
    f.store.close();
    const reopened = new Store(path);
    assert.deepEqual(reopened.approvals.history(f.context, approved.approval.id), approved.history);
    assert.deepEqual(reopened.insuranceRead(f.context, bound.id), bound);
    reopened.close();
    const corrupt = new DatabaseSync(path);
    corrupt.exec('DROP TRIGGER approval_revisions_no_update');
    const damaged = structuredClone(approved.approval);
    damaged.requesterId = 'forged-requester';
    const { approvalHash: _, ...body } = damaged;
    damaged.approvalHash = hash(body);
    corrupt
      .prepare(
        'UPDATE approval_revisions SET record_json=?,approval_hash=? WHERE id=? AND version=?',
      )
      .run(JSON.stringify(damaged), damaged.approvalHash, damaged.id, damaged.version);
    corrupt
      .prepare('UPDATE approval_heads SET approval_hash=? WHERE id=?')
      .run(damaged.approvalHash, damaged.id);
    corrupt.close();
    const damagedStore = new Store(path);
    try {
      assert.throws(
        () => damagedStore.approvals.read(f.context, damaged.id),
        fail('INTEGRITY_ERROR'),
      );
      assert.throws(() => damagedStore.insuranceRead(f.context, bound.id), fail('INTEGRITY_ERROR'));
    } finally {
      damagedStore.close();
    }
  } finally {
    try {
      f.store.close();
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});
