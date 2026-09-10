import type { Prisma } from '@prisma/client';
import { appendDomainEvent, buildDomainEvent } from '../../../../platform/events/domainEvents.js';
import { assertPolicyTransitionAllowed, type PolicyLifecycleStatus } from '../../domain/lifecycle/stateMachines.js';
import { enqueueAccounts360ProjectionUpdate } from '../../../accounts360/infra/projections/accounts360Projection.js';
import { enqueueAccountIntelligenceProjectionUpdate } from '../../../accounts360/infra/projections/accountIntelligenceProjection.js';
import { logger } from '../../../../platform/utils/logger.js';

type TransitionPolicyLifecycleInput = {
  tx: Prisma.TransactionClient;
  policyId: string;
  to: PolicyLifecycleStatus;
  actorId: string;
  actorType?: 'USER' | 'SYSTEM' | 'CUSTOMER' | 'UNDERWRITER' | 'OPS';
  reasonCode?: string;
  reasonText?: string;
  causationId?: string;
  correlationId?: string;
  data?: Prisma.InputJsonValue;
};

function asPolicyStatus(value: unknown): PolicyLifecycleStatus {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '_') as PolicyLifecycleStatus;
}

function parseSnapshotRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function transitionPolicyLifecycle(input: TransitionPolicyLifecycleInput): Promise<{
  from: PolicyLifecycleStatus;
  to: PolicyLifecycleStatus;
}> {
  const policy = await input.tx.policy.findUnique({
    where: { id: input.policyId },
    select: { id: true, status: true, issuedAt: true, inceptionDate: true, expiryDate: true, updatedAt: true, policyHolderId: true },
  });
  if (!policy) throw new Error('Policy not found');
  const from = asPolicyStatus(policy.status);
  const to = asPolicyStatus(input.to);

  assertPolicyTransitionAllowed(from, to);

  // Persist deterministic transition timestamps in snapshot metadata.
  const currentState = await input.tx.policyStateCurrent.findUnique({ where: { policyId: input.policyId } });
  const currentSnapshot = parseSnapshotRecord(currentState?.snapshot);
  const lifecycleMeta =
    currentSnapshot.lifecycleMeta && typeof currentSnapshot.lifecycleMeta === 'object'
      ? (currentSnapshot.lifecycleMeta as Record<string, unknown>)
      : {};
  const nowIso = new Date().toISOString();
  if (to === 'ISSUED') lifecycleMeta.issuedAt = lifecycleMeta.issuedAt || nowIso;
  if (to === 'ACTIVE') lifecycleMeta.activatedAt = lifecycleMeta.activatedAt || nowIso;
  if (to === 'EXPIRED') lifecycleMeta.expiredAt = lifecycleMeta.expiredAt || nowIso;
  if (to === 'CANCELLED') lifecycleMeta.cancelledAt = lifecycleMeta.cancelledAt || nowIso;

  const updated = await input.tx.policy.update({
    where: { id: input.policyId },
    data: {
      status: to,
      issuedAt: to === 'ISSUED' || to === 'ACTIVE' ? (policy.issuedAt || new Date(nowIso)) : policy.issuedAt,
    },
    select: { updatedAt: true },
  });

  const updatedSnapshot: Prisma.InputJsonValue = JSON.parse(JSON.stringify({
    ...currentSnapshot,
    lifecycleMeta,
  }));
  const createdSnapshot: Prisma.InputJsonValue = JSON.parse(JSON.stringify({
    lifecycleMeta,
  }));
  await input.tx.policyStateCurrent.upsert({
    where: { policyId: input.policyId },
    update: {
      snapshot: updatedSnapshot,
    },
    create: {
      policyId: input.policyId,
      snapshot: createdSnapshot,
    } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
  });

  logger.info({
    event: 'policy.status_changed',
    policyId: input.policyId,
    from,
    to,
    actorType: input.actorType || 'USER',
    actorId: input.actorId || 'system',
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
  }, 'policy.status_changed');

  const event = buildDomainEvent({
    eventType: 'POLICY.STATUS_CHANGED',
    aggregateType: 'POLICY',
    aggregateId: input.policyId,
    aggregateVersion: Number(updated.updatedAt.getTime()),
    from,
    to,
    actorType: input.actorType || 'USER',
    actorId: input.actorId || 'system',
    reasonCode: input.reasonCode,
    reasonText: input.reasonText,
    causationId: input.causationId,
    correlationId: input.correlationId,
    data: input.data,
  });
  await appendDomainEvent(input.tx, event);
  await enqueueAccounts360ProjectionUpdate(input.tx, policy.policyHolderId);
  await enqueueAccountIntelligenceProjectionUpdate(input.tx, policy.policyHolderId);

  return { from, to };
}

