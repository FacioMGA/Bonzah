import type { Prisma } from '@prisma/client';
import { appendDomainEvent, buildDomainEvent } from '../../../../platform/events/domainEvents.js';
import { assertUwTransitionAllowed, type UwWorkflowStatus } from '../../domain/lifecycle/stateMachines.js';

type TransitionUwWorkflowInput = {
  tx: Prisma.TransactionClient;
  policyId: string;
  to: UwWorkflowStatus;
  actorId: string;
  actorType?: 'USER' | 'SYSTEM' | 'CUSTOMER' | 'UNDERWRITER' | 'OPS';
  reasonCode?: string;
  reasonText?: string;
  causationId?: string;
  correlationId?: string;
  data?: Prisma.InputJsonValue;
};

function normalizeUw(value: unknown): UwWorkflowStatus {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '_') as UwWorkflowStatus;
}

function readSnapshot(snapshot: unknown): Record<string, unknown> {
  return snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>) : {};
}

export async function transitionUwWorkflow(input: TransitionUwWorkflowInput): Promise<{
  from: UwWorkflowStatus;
  to: UwWorkflowStatus;
}> {
  const currentState = await input.tx.policyStateCurrent.findUnique({
    where: { policyId: input.policyId },
    select: { snapshot: true },
  });
  const snapshot = readSnapshot(currentState?.snapshot);
  const from = normalizeUw(snapshot.uwWorkflowState || 'NOT_STARTED');
  const to = normalizeUw(input.to);
  assertUwTransitionAllowed(from, to);

  const nextSnapshot = {
    ...snapshot,
    uwWorkflowState: to,
    uwWorkflowLastActor: input.actorId,
    uwWorkflowLastActorType: input.actorType || 'USER',
    uwWorkflowUpdatedAt: new Date().toISOString(),
  };

  await input.tx.policyStateCurrent.upsert({
    where: { policyId: input.policyId },
    update: { snapshot: nextSnapshot as Prisma.InputJsonValue },
    create: { policyId: input.policyId, snapshot: nextSnapshot as Prisma.InputJsonValue } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
  });

  const event = buildDomainEvent({
    eventType: 'UW.READINESS_CHANGED',
    aggregateType: 'UW_WORKFLOW',
    aggregateId: input.policyId,
    aggregateVersion: Date.now(),
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
  return { from, to };
}

