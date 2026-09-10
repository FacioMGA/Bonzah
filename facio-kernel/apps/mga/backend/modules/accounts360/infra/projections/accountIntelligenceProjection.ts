import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { buildDomainEvent } from '../../../../platform/events/domainEvents.js';
import { logger } from '../../../../platform/utils/logger.js';
import { deriveAccountIntelligenceState } from '../../domain/accountIntelligenceState.js';
import { buildAccountIntelligenceSearchTerms } from '../../domain/accountIntelligenceSearchTerms.js';

type UnknownRecord = Record<string, unknown>;

const ACTIVE_POLICY_STATUSES = new Set(['ACTIVE', 'ISSUED', 'BOUND', 'BOUND_DRAFT_ISSUED']);
const CLOSED_CLAIM_STATUSES = new Set(['CLOSED', 'DENIED', 'WITHDRAWN']);
const UNPAID_INVOICE_STATUSES = new Set(['DRAFT', 'OPEN', 'OVERDUE', 'PENDING', 'UNPAID', 'PARTIAL']);
const FAILED_PAYMENT_STATUSES = new Set(['FAILED', 'CANCELLED']);

type DbLike = {
  outbox?: {
    create?: (args: { data: Prisma.OutboxUncheckedCreateInput }) => Promise<unknown>;
  };
};

type FeedEvent = {
  eventType: string;
  eventSummary: string;
  occurredAt: Date;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function extractPolicyRegistrationNumber(policy: UnknownRecord): string {
  const typedRegistrationNumber = String(policy.vehicleRegistrationNumber || '').trim();
  if (typedRegistrationNumber) return typedRegistrationNumber;
  return String(asRecord(policy.quoteData).registrationNumber || '').trim();
}

function parseContactRecord(contact: unknown): UnknownRecord {
  if (!contact) return {};
  if (typeof contact === 'string') {
    try {
      return asRecord(JSON.parse(contact));
    } catch {
      return {};
    }
  }
  return asRecord(contact);
}

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parsePremiumFromPolicy(policy: UnknownRecord): number {
  const quoteResponse = asRecord(policy.quoteResponse);
  const pricing = asRecord(quoteResponse.pricing);
  const primaryOption = asRecord(quoteResponse.primaryOption);
  return toNum(
    pricing.total ||
      pricing.annualPremium ||
      primaryOption.annualPremium ||
      quoteResponse.premium ||
      0
  );
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pickLatestEvent(events: FeedEvent[]): FeedEvent | null {
  const sorted = events
    .filter((event) => !Number.isNaN(event.occurredAt.getTime()))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  return sorted[0] || null;
}

export async function enqueueAccountIntelligenceProjectionUpdate(db: DbLike, accountId: string) {
  const id = String(accountId || '').trim();
  if (!id) return;
  const outboxCreate = db?.outbox?.create;
  if (!outboxCreate) return;

  const envelope = buildDomainEvent({
    eventType: 'ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE',
    aggregateType: 'ACCOUNT',
    aggregateId: id,
    aggregateVersion: Date.now(),
    actorType: 'SYSTEM',
    actorId: 'account-intelligence-projection-dispatcher',
    reasonCode: 'PROJECTION_REBUILD_REQUESTED',
    data: { accountId: id },
  });

  await outboxCreate({
    data: {
      aggregateId: id,
      eventType: envelope.eventType,
      payload: envelope as Prisma.InputJsonValue,
    } as unknown as Prisma.OutboxUncheckedCreateInput,
  });
}

export async function rebuildAccountIntelligenceProjection(accountId: string) {
  const id = String(accountId || '').trim();
  if (!id) return;

  const holder = await tenantScopedPrisma.policyHolder.findUnique({
    where: { id },
    include: {
      policies: {
        select: {
          id: true,
          policyNumber: true,
          productType: true,
          status: true,
          bo_status: true,
          expiryDate: true,
          updatedAt: true,
          quoteResponse: true,
          quoteData: true,
          vehicleRegistrationNumber: true,
          claims: {
            select: {
              id: true,
              claimNumber: true,
              status: true,
              amountReserved: true,
              updatedAt: true,
            },
          },
          invoices: {
            select: {
              id: true,
              amount: true,
              status: true,
              dueDate: true,
              updatedAt: true,
            },
          },
          payments: {
            select: {
              id: true,
              amount: true,
              status: true,
              updatedAt: true,
            },
          },
          documents: {
            select: {
              id: true,
              type: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  if (!holder) {
    await tenantScopedPrisma.accountIntelligenceProjection.deleteMany({ where: { accountId: id } });
    return;
  }

  const contact = parseContactRecord(holder.contact);
  const policies = holder.policies || [];
  const now = new Date();
  let activePolicies = 0;
  let totalPolicies = 0;
  let totalPremium = 0;
  const productMix: Record<string, number> = {};
  let openClaimsCount = 0;
  let outstandingReserve = 0;
  let overdueAmount = 0;
  let failedPaymentsCount = 0;
  let nextRenewalAt: Date | null = null;
  const feedEvents: FeedEvent[] = [];
  const policyNumbers: string[] = [];
  const registrationNumbers: string[] = [];

  for (const policy of policies) {
    totalPolicies += 1;
    const statusUp = String(policy.bo_status || policy.status || '').toUpperCase();
    const policyNumber = String(policy.policyNumber || '').trim();
    if (policyNumber) policyNumbers.push(policyNumber);
    const registrationNumber = extractPolicyRegistrationNumber(asRecord(policy));
    if (registrationNumber) registrationNumbers.push(registrationNumber);
    const productType = String(policy.productType || 'UNKNOWN');
    productMix[productType] = (productMix[productType] || 0) + 1;
    if (ACTIVE_POLICY_STATUSES.has(statusUp)) {
      activePolicies += 1;
      totalPremium += parsePremiumFromPolicy(asRecord(policy));
      const expiry = parseDate(policy.expiryDate);
      if (expiry && expiry.getTime() >= now.getTime()) {
        if (!nextRenewalAt || expiry.getTime() < nextRenewalAt.getTime()) nextRenewalAt = expiry;
      }
    }
    feedEvents.push({
      eventType: 'POLICY_UPDATED',
      eventSummary: policyNumber ? `Policy ${policyNumber} updated` : 'Policy updated',
      occurredAt: new Date(policy.updatedAt),
    });

    for (const claim of policy.claims || []) {
      const claimStatusUp = String(claim.status || '').toUpperCase();
      if (!CLOSED_CLAIM_STATUSES.has(claimStatusUp)) {
        openClaimsCount += 1;
        outstandingReserve += toNum(claim.amountReserved);
      }
      feedEvents.push({
        eventType: 'CLAIM_UPDATED',
        eventSummary: claim.claimNumber ? `Claim ${claim.claimNumber} updated` : 'Claim updated',
        occurredAt: new Date(claim.updatedAt),
      });
    }

    for (const invoice of policy.invoices || []) {
      const status = String(invoice.status || '').toUpperCase();
      const dueDate = parseDate(invoice.dueDate);
      if (UNPAID_INVOICE_STATUSES.has(status) && dueDate && dueDate.getTime() < now.getTime()) {
        overdueAmount += toNum(invoice.amount);
        feedEvents.push({
          eventType: 'INVOICE_OVERDUE',
          eventSummary: `Invoice overdue on policy ${policyNumber || policy.id}`,
          occurredAt: new Date(invoice.updatedAt || invoice.dueDate || policy.updatedAt),
        });
      }
    }

    for (const payment of policy.payments || []) {
      const status = String(payment.status || '').toUpperCase();
      if (FAILED_PAYMENT_STATUSES.has(status)) {
        failedPaymentsCount += 1;
        feedEvents.push({
          eventType: 'PAYMENT_FAILED',
          eventSummary: `Payment failed on policy ${policyNumber || policy.id}`,
          occurredAt: new Date(payment.updatedAt),
        });
      }
    }

    for (const document of policy.documents || []) {
      feedEvents.push({
        eventType: 'DOCUMENT_GENERATED',
        eventSummary: `${String(document.type || 'Document')} generated`,
        occurredAt: new Date(document.createdAt),
      });
    }
  }

  const latestEvent = pickLatestEvent(feedEvents);
  const email = String(contact.email || '').trim();
  const phone = String(contact.phone || '').trim();
  const secondaryIdentity = email || phone || null;
  const searchTerms = buildAccountIntelligenceSearchTerms({
    email,
    phone,
    policyNumbers,
    registrationNumbers,
  });
  const state = deriveAccountIntelligenceState({
    overdueAmount,
    failedPaymentsCount,
    openClaimsCount,
    nextRenewalAt,
    now,
  });

  await tenantScopedPrisma.accountIntelligenceProjection.upsert({
    where: { accountId: id },
    create: {
      accountId: id,
      accountName: holder.name,
      secondaryIdentity,
      searchTerms,
      activePolicies,
      totalPolicies,
      totalPremium,
      productMix,
      openClaimsCount,
      outstandingReserve,
      overdueAmount,
      failedPaymentsCount,
      nextRenewalAt,
      lastActivityAt: latestEvent?.occurredAt || null,
      lastActivityType: latestEvent?.eventType || null,
      lastActivitySummary: latestEvent?.eventSummary || null,
      state: state.state,
      stateReasons: state.reasons,
      stateScore: state.score,
      statePriority: state.priority,
      computedAt: new Date(),
    } as unknown as Prisma.AccountIntelligenceProjectionUncheckedCreateInput,
    update: {
      accountName: holder.name,
      secondaryIdentity,
      searchTerms,
      activePolicies,
      totalPolicies,
      totalPremium,
      productMix,
      openClaimsCount,
      outstandingReserve,
      overdueAmount,
      failedPaymentsCount,
      nextRenewalAt,
      lastActivityAt: latestEvent?.occurredAt || null,
      lastActivityType: latestEvent?.eventType || null,
      lastActivitySummary: latestEvent?.eventSummary || null,
      state: state.state,
      stateReasons: state.reasons,
      stateScore: state.score,
      statePriority: state.priority,
      computedAt: new Date(),
    },
  });

  logger.info(
    {
      accountId: id,
      state: state.state,
      activePolicies,
      totalPolicies,
      openClaimsCount,
      overdueAmount,
      failedPaymentsCount,
    },
    'account_intelligence.projection_rebuilt'
  );
}

export async function reconcileAccountIntelligenceProjectionBatch(limit = 300) {
  const take = Math.max(1, Math.min(Number(limit) || 300, 2000));
  const fromPolicyHolders = await tenantScopedPrisma.policyHolder.findMany({
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
    take,
  });
  const fromPolicies = await tenantScopedPrisma.policy.findMany({
    select: { policyHolderId: true },
    orderBy: { updatedAt: 'desc' },
    take: take * 2,
  });
  const ids = Array.from(
    new Set([
      ...fromPolicyHolders.map((row) => row.id),
      ...fromPolicies.map((row) => row.policyHolderId).filter(Boolean),
    ])
  ).slice(0, take);

  for (const accountId of ids) {
    await rebuildAccountIntelligenceProjection(accountId);
  }
  return ids.length;
}

export async function backfillAccountIntelligenceProjection(batchSize = 250, maxBatches = 400) {
  const take = Math.max(1, Math.min(Number(batchSize) || 250, 2000));
  const max = Math.max(1, Math.min(Number(maxBatches) || 400, 5000));
  let cursor: string | null = null;
  let total = 0;

  for (let i = 0; i < max; i += 1) {
    const chunk: Array<{ id: string }> = await tenantScopedPrisma.policyHolder.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!chunk.length) break;
    for (const row of chunk) {
      await rebuildAccountIntelligenceProjection(row.id);
      total += 1;
    }
    cursor = chunk[chunk.length - 1]?.id || null;
  }

  return total;
}
