import type { Prisma } from '@prisma/client';
import { appendDomainEvent, buildDomainEvent } from '../../../../platform/events/domainEvents.js';
import { enqueueAccounts360ProjectionUpdate } from '../../../accounts360/infra/projections/accounts360Projection.js';
import { enqueueAccountIntelligenceProjectionUpdate } from '../../../accounts360/infra/projections/accountIntelligenceProjection.js';
import {
  assertDocumentSetTransitionAllowed,
  assertPaymentTransitionAllowed,
  assertRiskTransactionTransitionAllowed,
  type DocumentSetStatus,
  type PaymentGatewayStatus,
  type RiskTransactionStatus,
} from '../../domain/lifecycle/stateMachines.js';

function normalize(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
}

async function enqueueAccountProjectionRefresh(tx: Prisma.TransactionClient, policyId?: string | null) {
  const id = String(policyId || '').trim();
  if (!id) return;
  const policy = await tx.policy.findUnique({ where: { id }, select: { policyHolderId: true } });
  const accountId = String(policy?.policyHolderId || '').trim();
  if (!accountId) return;
  await enqueueAccounts360ProjectionUpdate(tx, accountId);
  await enqueueAccountIntelligenceProjectionUpdate(tx, accountId);
}

export async function transitionRiskTransactionStatus(input: {
  tx: Prisma.TransactionClient;
  riskTransactionId: string;
  to: RiskTransactionStatus;
  actorId: string;
  actorType?: 'USER' | 'SYSTEM' | 'CUSTOMER' | 'UNDERWRITER' | 'OPS';
  reasonCode?: string;
  reasonText?: string;
  correlationId?: string;
  causationId?: string;
}) {
  const current = await input.tx.riskTransaction.findUnique({
    where: { id: input.riskTransactionId },
    select: { id: true, status: true, policyId: true },
  });
  if (!current) throw new Error('Risk transaction not found');
  const from = normalize(current.status) as RiskTransactionStatus;
  const to = normalize(input.to) as RiskTransactionStatus;
  assertRiskTransactionTransitionAllowed(from, to);

  const updated = await input.tx.riskTransaction.update({
    where: { id: input.riskTransactionId },
    data: { status: to, changeReason: input.reasonCode || undefined },
    select: { policyId: true },
  });
  await appendDomainEvent(
    input.tx,
    buildDomainEvent({
      eventType: 'RISK_TRANSACTION.STATUS_CHANGED',
      aggregateType: 'RISK_TRANSACTION',
      aggregateId: input.riskTransactionId,
      aggregateVersion: Date.now(),
      from,
      to,
      actorType: input.actorType || 'USER',
      actorId: input.actorId || 'system',
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      correlationId: input.correlationId,
      causationId: input.causationId,
      data: { policyId: updated.policyId },
    })
  );
  await enqueueAccountProjectionRefresh(input.tx, updated.policyId);
}

export async function transitionPaymentStatus(input: {
  tx: Prisma.TransactionClient;
  paymentId: string;
  to: PaymentGatewayStatus;
  actorId: string;
  actorType?: 'USER' | 'SYSTEM' | 'CUSTOMER' | 'UNDERWRITER' | 'OPS';
  reasonCode?: string;
  reasonText?: string;
  correlationId?: string;
  causationId?: string;
}) {
  const current = await input.tx.payment.findUnique({
    where: { id: input.paymentId },
    select: { id: true, status: true, updatedAt: true, policyId: true },
  });
  if (!current) throw new Error('Payment not found');
  const from = normalize(current.status) as PaymentGatewayStatus;
  const to = normalize(input.to) as PaymentGatewayStatus;
  assertPaymentTransitionAllowed(from, to);

  const updated = await input.tx.payment.update({
    where: { id: input.paymentId },
    data: { status: to },
    select: { updatedAt: true, policyId: true },
  });
  await appendDomainEvent(
    input.tx,
    buildDomainEvent({
      eventType: 'PAYMENT.STATUS_CHANGED',
      aggregateType: 'PAYMENT',
      aggregateId: input.paymentId,
      aggregateVersion: Number(updated.updatedAt.getTime()),
      from,
      to,
      actorType: input.actorType || 'SYSTEM',
      actorId: input.actorId || 'system',
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      correlationId: input.correlationId,
      causationId: input.causationId,
      data: { policyId: updated.policyId },
    })
  );
  await enqueueAccountProjectionRefresh(input.tx, updated.policyId);
}

export async function transitionDocumentSetStatus(input: {
  tx: Prisma.TransactionClient;
  documentSetId: string;
  to: DocumentSetStatus;
  actorId: string;
  actorType?: 'USER' | 'SYSTEM' | 'CUSTOMER' | 'UNDERWRITER' | 'OPS';
  reasonCode?: string;
  reasonText?: string;
  correlationId?: string;
  causationId?: string;
}) {
  const current = await input.tx.documentSet.findUnique({
    where: { id: input.documentSetId },
    select: { id: true, status: true, updatedAt: true, policyId: true },
  });
  if (!current) throw new Error('Document set not found');
  const from = normalize(current.status) as DocumentSetStatus;
  const to = normalize(input.to) as DocumentSetStatus;
  assertDocumentSetTransitionAllowed(from, to);

  const updated = await input.tx.documentSet.update({
    where: { id: input.documentSetId },
    data: { status: to },
    select: { updatedAt: true, policyId: true },
  });
  await appendDomainEvent(
    input.tx,
    buildDomainEvent({
      eventType: 'DOCUMENT_SET.STATUS_CHANGED',
      aggregateType: 'DOCUMENT_SET',
      aggregateId: input.documentSetId,
      aggregateVersion: Number(updated.updatedAt.getTime()),
      from,
      to,
      actorType: input.actorType || 'SYSTEM',
      actorId: input.actorId || 'system',
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      correlationId: input.correlationId,
      causationId: input.causationId,
      data: { policyId: updated.policyId },
    })
  );
  await enqueueAccountProjectionRefresh(input.tx, updated.policyId);
}

