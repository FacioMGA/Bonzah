import type { Prisma } from '@prisma/client';
import { appendDomainEvent, buildDomainEvent, type OutboxClient } from '../../../../platform/events/domainEvents.js';
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

type AccountProjectionTx = OutboxClient & {
  policy: Pick<Prisma.TransactionClient['policy'], 'findUnique'>;
};

type PaymentStatusTransitionTx = AccountProjectionTx & {
  payment: Pick<Prisma.TransactionClient['payment'], 'findMany' | 'findUnique' | 'updateMany'>;
};

export class PaymentStatusTransitionConflictError extends Error {
  readonly code = 'PAYMENT_STATUS_TRANSITION_CONFLICT' as const;
  constructor(paymentId: string) {
    super(`Payment ${paymentId} changed while its status transition was being applied.`);
  }
}

async function enqueueAccountProjectionRefresh(tx: AccountProjectionTx, policyId?: string | null) {
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
  tx: PaymentStatusTransitionTx;
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

  const transition = await input.tx.payment.updateMany({
    where: { id: input.paymentId, status: current.status },
    data: { status: to },
  });
  if (transition.count !== 1) throw new PaymentStatusTransitionConflictError(input.paymentId);
  const updated = await input.tx.payment.findUnique({
    where: { id: input.paymentId },
    select: { updatedAt: true, policyId: true },
  });
  if (!updated) throw new Error('Payment not found after status transition');
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

/**
 * The rating spine owns invalidation of a customer checkout when a fresh
 * calculation returns the risk to referral. Cancelling only the policy lock
 * would leave a provider checkout carrying a superseded premium.
 */
export async function invalidatePendingCardcorpCheckouts(input: {
  tx: PaymentStatusTransitionTx & {
    policy: Pick<Prisma.TransactionClient['policy'], 'findUnique' | 'update'>;
  };
  policyId: string;
  actorId: string;
  correlationId?: string;
}) {
  const pendingPayments = await input.tx.payment.findMany({
    where: { policyId: input.policyId, provider: 'CARDCORP', status: 'PENDING' },
    select: { id: true },
  });
  for (const payment of pendingPayments) {
    await transitionPaymentStatus({
      tx: input.tx,
      paymentId: payment.id,
      to: 'CANCELLED',
      actorId: input.actorId,
      actorType: 'SYSTEM',
      reasonCode: 'QUOTE_RERATED_TO_REFERRAL',
      correlationId: input.correlationId,
    });
  }
  await input.tx.policy.update({
    where: { id: input.policyId },
    data: { isLocked: false, paymentStatus: 'NOT_REQUIRED' },
  });
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
