import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { getTenantConfig } from '../tenant/tenantConfig.js';
import { getCorrelationId } from '../observability/context.js';

export type DomainAggregateType =
  | 'CLAIM'
  | 'POLICY'
  | 'ACCOUNT'
  | 'UW_WORKFLOW'
  | 'RISK_TRANSACTION'
  | 'PAYMENT'
  | 'DOCUMENT_SET'
  | 'COMMUNICATION'
  | 'WEBHOOK';

export type DomainEventEnvelope = {
  eventId: string;
  eventType: string;
  aggregateType: DomainAggregateType;
  aggregateId: string;
  aggregateVersion: number;
  from?: string;
  to?: string;
  actorType: 'USER' | 'SYSTEM' | 'CUSTOMER' | 'UNDERWRITER' | 'OPS';
  actorId: string;
  correlationId: string;
  causationId?: string;
  reasonCode?: string;
  reasonText?: string;
  occurredAt: string;
  data?: Prisma.InputJsonValue;
  idempotencyKey?: string;
};

export function buildDomainEvent(input: Omit<DomainEventEnvelope, 'eventId' | 'occurredAt' | 'correlationId'> & {
  eventId?: string;
  occurredAt?: string;
  correlationId?: string;
}): DomainEventEnvelope {
  const correlationId = String(input.correlationId || getCorrelationId() || '').trim() || crypto.randomUUID();
  return {
    eventId: String(input.eventId || '').trim() || crypto.randomUUID(),
    occurredAt: String(input.occurredAt || '').trim() || new Date().toISOString(),
    correlationId,
    ...input,
  };
}

/**
 * Structural minimum a transaction client must expose to be usable as
 * the carrier for a domain-event outbox write. Both
 * `Prisma.TransactionClient` and the tenant-scoped extended client
 * (`TenantScopedTx` from `connection.ts`) satisfy this shape — so
 * callers can pass either without a cast.
 *
 * Lives at the events boundary because the events layer owns the
 * write contract; module-layer code consumes this type and never
 * widens it.
 */
export type OutboxClient = {
  outbox: {
    create: (args: {
      data: Prisma.OutboxUncheckedCreateInput;
    }) => Promise<unknown>;
  };
};

export async function appendDomainEvent(
  tx: OutboxClient,
  event: DomainEventEnvelope
): Promise<void> {
  const outboxData: Prisma.OutboxUncheckedCreateInput = {
    operatingTenantId: getTenantConfig().id,
    eventId: event.eventId,
    idempotencyKey: event.idempotencyKey || null,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    payload: event as Prisma.InputJsonValue,
  };
  await tx.outbox.create({ data: outboxData });
}

