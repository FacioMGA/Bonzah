import { randomUUID } from 'node:crypto';
import {
  approvalOperations,
  approvalRecordSchema,
  approvalResultSchema,
  type ApprovalRecord,
  type ApprovalResult,
  type ApprovalOperationName,
  type BindApprovalEvidence,
} from '../contracts/approval.js';
import { scopeSchema, type Context } from '../contracts/configuration.js';
import type { InsuranceRecord } from '../contracts/insurance.js';
import type { InsuranceApplication } from './insurance.js';
import type { Store } from '../storage/store.js';
import { hash, KernelError } from '../domain/canonical.js';

type Assessment = ReturnType<InsuranceApplication['assessApproval']>;
const fail = (code: string, message: string, status = 422): never => {
  throw new KernelError(code, message, status);
};
const independent = (record: ApprovalRecord, actorId: string) =>
  ![record.requesterId, record.recordCreatorId, record.recordAuthorId].includes(actorId);
const targetMatches = (approval: ApprovalRecord, assessment: Assessment) =>
  hash(approval.target) === hash(assessment.target) &&
  hash(approval.gates) === hash(assessment.gates);
/** Called inside the same transaction as the insurance bind and its durable outbox. */
export function validateBindApproval(
  store: Store,
  context: Context,
  record: InsuranceRecord,
  assessment: Assessment,
  approvalId: string,
  now: Date,
): BindApprovalEvidence {
  const approval = store.approvals.read(context, approvalId);
  if (!targetMatches(approval, assessment))
    fail(
      'APPROVAL_STALE',
      'This review belongs to different quote, input, definition or release evidence',
      409,
    );
  if (assessment.blockers.length) fail('APPROVAL_GATE_BLOCKED', assessment.blockers.join(' '));
  if (approval.status !== 'approved')
    fail(
      'APPROVAL_NOT_APPROVED',
      'The selected review has not been approved or was withdrawn',
      409,
    );
  if (Date.parse(approval.expiresAt) <= now.getTime())
    fail(
      'APPROVAL_EXPIRED',
      'The independent review has expired; it cannot authorize binding',
      409,
    );
  if (!independent(approval, approval.actorId))
    fail('INTEGRITY_ERROR', 'The stored review was not independently authorized', 500);
  if (record.status !== 'quoted')
    fail('APPROVAL_CONSUMED', 'This review cannot authorize another insurance transition', 409);
  return {
    approvalId: approval.id,
    approvalVersion: approval.version,
    approvalHash: approval.approvalHash,
    target: approval.target,
    gates: approval.gates,
    reviewerId: approval.actorId,
    approvedAt: approval.occurredAt,
    expiresAt: approval.expiresAt,
    checkedAt: now.toISOString(),
  };
}
export class ApprovalApplication {
  constructor(
    private readonly store: Store,
    private readonly insurance: InsuranceApplication,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  private view(
    approval: ApprovalRecord,
    context: Context,
    now: Date,
  ): Omit<ApprovalResult, 'history' | 'reviewDefinition'> {
    const record = this.store.insuranceRead(context, approval.target.recordId);
    let effectiveStatus: ApprovalResult['effectiveStatus'] = approval.status;
    const blockers: string[] = [];
    if (record.approval?.approvalId === approval.id) {
      effectiveStatus = 'consumed';
      blockers.push(
        'This review is retained on the bound insurance record and cannot authorize another change',
      );
    } else if (
      record.version !== approval.target.recordVersion ||
      record.recordHash !== approval.target.recordHash
    ) {
      effectiveStatus = 'stale';
      blockers.push('The insurance record changed after this exact review was requested');
    } else if (Date.parse(approval.expiresAt) <= now.getTime()) {
      effectiveStatus = 'expired';
      blockers.push('The requested review expiry has passed');
    } else {
      const assessment = this.insurance.assessApproval(context, record, now);
      if (!targetMatches(approval, assessment) || assessment.blockers.length) {
        effectiveStatus = 'stale';
        blockers.push(...assessment.blockers);
        if (!targetMatches(approval, assessment))
          blockers.push('Pinned quote, definition, release or review gates differ');
      }
    }
    const mayReview = context.permissions.some((permission) => permission === 'insurance:approve');
    const isIndependent = independent(approval, context.actorId);
    if (!isIndependent)
      blockers.push(
        'The record creator, quote author and review requester cannot decide their own review',
      );
    return {
      approval,
      effectiveStatus,
      blockers,
      canDecide: mayReview && isIndependent && effectiveStatus === 'requested',
      canRevoke:
        mayReview &&
        ['requested', 'approved'].includes(approval.status) &&
        effectiveStatus !== 'consumed',
    };
  }
  private result(id: string, context: Context, now: Date): ApprovalResult {
    const history = this.store.approvals.history(context, id);
    const target = history.at(-1)!.target;
    const original = this.store.insuranceHistory(context, target.recordId).revisions[
      target.recordVersion - 1
    ];
    if (!original || original.recordHash !== target.recordHash)
      fail('INTEGRITY_ERROR', 'Review target revision is unavailable or differs', 500);
    return approvalResultSchema.parse({
      ...this.view(history.at(-1)!, context, now),
      history,
      reviewDefinition: this.insurance.approvalReviewDefinition(context, original!),
    });
  }
  execute(name: ApprovalOperationName, raw: unknown, context: Context): unknown {
    if (!['development', 'sandbox'].includes(context.environment))
      fail(
        'RUNTIME_ENVIRONMENT_UNSUPPORTED',
        'Independent review is limited to development and sandbox',
        403,
      );
    if (
      !context.permissions.some((permission) => permission === approvalOperations[name].permission)
    )
      fail('FORBIDDEN', 'The current actor cannot perform this independent review operation', 403);
    const now = this.clock();
    if (name === 'approval_list') {
      const input = approvalOperations.approval_list.input.parse(raw);
      const record = input.recordId
        ? this.store.insuranceHistory(context, input.recordId).revisions.at(-1)!
        : null;
      const records = this.store.approvals.list(context, input.recordId);
      const approvals = records.approvals.map((approval) => this.view(approval, context, now));
      let requestAvailability = null;
      if (record) {
        const assessment = this.insurance.assessApproval(context, record, now);
        const blockers = assessment.blockers.slice();
        if (!context.permissions.some((permission) => permission === 'insurance:quote'))
          blockers.push('The current actor cannot request an insurance review');
        if (this.store.approvals.forRecordVersion(context, record.id, record.version))
          blockers.push('This exact record revision already has a review; inspect its history');
        const maximum = Math.min(Date.parse(record.quote.expiresAt), now.getTime() + 7 * 86400000);
        requestAvailability = {
          canRequest: blockers.length === 0,
          blockers,
          gates: assessment.gates,
          maximumExpiresAt: maximum > now.getTime() ? new Date(maximum).toISOString() : null,
        };
      }
      return {
        approvals,
        hasMore: records.hasMore,
        requestAvailability,
        reviewDefinition: record ? this.insurance.approvalReviewDefinition(context, record) : null,
        bindableApprovalId: record
          ? (approvals.find(
              (view) =>
                view.effectiveStatus === 'approved' &&
                view.approval.target.recordVersion === record.version,
            )?.approval.id ?? null)
          : null,
      };
    }
    if (name === 'approval_get')
      return this.result(approvalOperations.approval_get.input.parse(raw).approvalId, context, now);
    const input = approvalOperations[name].input.parse(raw);
    const requestHash = hash({ input, actorId: context.actorId });
    const replay = this.store.approvals.replay(context, name, input.idempotencyKey, requestHash);
    // Replay retains the original action; its status projection is freshly resolved after expiry or revocation.
    if (replay) return this.result(replay, context, now);
    let value: Omit<ApprovalRecord, 'approvalHash'>;
    let previousVersion: number | null = null;
    if (name === 'approval_request') {
      const command = approvalOperations.approval_request.input.parse(input);
      const history = this.store.insuranceHistory(context, command.recordId);
      const record = history.revisions.at(-1)!;
      if (record.version !== command.expectedVersion || record.recordHash !== command.recordHash)
        fail(
          'VERSION_CONFLICT',
          'The quote revision changed; reload before requesting review',
          409,
        );
      const assessment = this.insurance.assessApproval(context, record, now);
      if (assessment.blockers.length) fail('APPROVAL_GATE_BLOCKED', assessment.blockers.join(' '));
      const expires = Date.parse(command.expiresAt);
      if (
        expires <= now.getTime() ||
        expires > Date.parse(record.quote.expiresAt) ||
        expires > now.getTime() + 7 * 86400000
      )
        fail(
          'APPROVAL_EXPIRY_INVALID',
          'Review expiry must be future, no later than quote expiry, and within seven days',
        );
      if (this.store.approvals.forRecordVersion(context, record.id, record.version))
        fail(
          'APPROVAL_EXISTS',
          'This quote revision already has an immutable review; inspect it rather than replace it',
          409,
        );
      value = {
        id: randomUUID(),
        scope: scopeSchema.parse({
          workspaceId: context.workspaceId,
          tenantId: context.tenantId,
          environment: context.environment,
          operatingEntityId: context.operatingEntityId,
        }),
        version: 1,
        previousApprovalHash: null,
        status: 'requested',
        target: assessment.target,
        gates: assessment.gates,
        requesterId: context.actorId,
        recordCreatorId: history.events[0]!.actorId,
        recordAuthorId: history.events.at(-1)!.actorId,
        requestedAt: now.toISOString(),
        expiresAt: new Date(expires).toISOString(),
        action: 'request',
        actorId: context.actorId,
        correlationId: context.correlationId,
        occurredAt: now.toISOString(),
        reason: command.reason,
        evidenceRefs: command.evidenceRefs,
      };
    } else {
      const command =
        name === 'approval_decide'
          ? approvalOperations.approval_decide.input.parse(input)
          : approvalOperations.approval_revoke.input.parse(input);
      const current = this.store.approvals.read(context, command.approvalId);
      if (
        current.version !== command.expectedVersion ||
        current.approvalHash !== command.approvalHash
      )
        fail('VERSION_CONFLICT', 'The review changed; reload its current decision and hash', 409);
      const view = this.view(current, context, now);
      if (name === 'approval_decide') {
        if (!independent(current, context.actorId))
          fail(
            'SELF_REVIEW_FORBIDDEN',
            'The record creator, quote author and requester cannot decide their own review',
            403,
          );
        if (view.effectiveStatus !== 'requested')
          fail(
            'APPROVAL_NOT_DECIDABLE',
            'Only a current, unexpired requested review may be decided: ' + view.effectiveStatus,
            409,
          );
      } else if (!view.canRevoke)
        fail(
          'APPROVAL_NOT_REVOCABLE',
          'Only an unused requested or approved review may be withdrawn',
          409,
        );
      const action =
        name === 'approval_decide'
          ? approvalOperations.approval_decide.input.parse(command).decision
          : 'revoke';
      const { approvalHash: _, ...previous } = current;
      value = {
        ...previous,
        version: current.version + 1,
        previousApprovalHash: current.approvalHash,
        status: action === 'approve' ? 'approved' : action === 'decline' ? 'declined' : 'revoked',
        action,
        actorId: context.actorId,
        correlationId: context.correlationId,
        occurredAt: now.toISOString(),
        reason: command.reason,
        evidenceRefs: command.evidenceRefs,
      };
      previousVersion = current.version;
    }
    const record = approvalRecordSchema.parse({ ...value, approvalHash: hash(value) });
    this.store.approvals.commit(record, previousVersion);
    this.store.approvals.remember(context, name, input.idempotencyKey, requestHash, record);
    return this.result(record.id, context, now);
  }
}
