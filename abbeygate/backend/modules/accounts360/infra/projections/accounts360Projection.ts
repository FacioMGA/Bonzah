import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { TENANT_GUC_TX_OPTIONS } from '../../../../platform/db/tenantExtension.js';
import { buildDomainEvent } from '../../../../platform/events/domainEvents.js';
import { logger } from '../../../../platform/utils/logger.js';
import { deriveAccountHealth } from '../../domain/health.js';
import { getTenantConfig } from '../../../../platform/tenant/tenantConfig.js';

type UnknownRecord = Record<string, unknown>;

const ACTIVE_POLICY_STATUSES = new Set(['ACTIVE', 'ISSUED', 'BOUND', 'BOUND_DRAFT_ISSUED']);
const DRAFT_POLICY_STATUSES = new Set(['DRAFT', 'QUOTE', 'QUOTED', 'PENDING']);
const EXPIRED_POLICY_STATUSES = new Set(['EXPIRED', 'LAPSED']);
const CANCELLED_POLICY_STATUSES = new Set(['CANCELLED', 'VOID']);
const CLOSED_CLAIM_STATUSES = new Set(['CLOSED', 'DENIED', 'WITHDRAWN']);
const UNPAID_INVOICE_STATUSES = new Set(['DRAFT', 'OPEN', 'OVERDUE', 'PENDING', 'UNPAID', 'PARTIAL']);
const FAILED_PAYMENT_STATUSES = new Set(['FAILED', 'CANCELLED']);
/** Resolved per-call so that multi-tenant requests get the correct value. */
function brokerName() { return getTenantConfig().defaultBrokerName ?? 'Abbeygate'; }

type DbLike = {
  outbox?: {
    create?: (args: { data: Prisma.OutboxUncheckedCreateInput }) => Promise<unknown>;
  };
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function parseContactRecord(contact: unknown): UnknownRecord {
  if (!contact) return {};
  if (typeof contact === 'string') {
    try {
      const parsed = JSON.parse(contact);
      return asRecord(parsed);
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

function classifyAccountType(input: { policiesCount: number; segment: string }): string {
  const segmentUp = input.segment.trim().toUpperCase();
  if (input.policiesCount >= 5) return 'FLEET';
  if (segmentUp.includes('BUSINESS') || segmentUp.includes('COMMERCIAL') || segmentUp.includes('COMPANY')) {
    return 'BUSINESS';
  }
  return 'INDIVIDUAL';
}

export async function enqueueAccounts360ProjectionUpdate(db: DbLike, accountId: string) {
  const id = String(accountId || '').trim();
  if (!id) return;
  const outboxCreate = db?.outbox?.create;
  if (!outboxCreate) return;

  const envelope = buildDomainEvent({
    eventType: 'ACCOUNTS360.PROJECTION_UPDATE',
    aggregateType: 'ACCOUNT',
    aggregateId: id,
    aggregateVersion: Date.now(),
    actorType: 'SYSTEM',
    actorId: 'accounts360-projection-dispatcher',
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

type FeedEvent = {
  sourceDomain: string;
  eventType: string;
  eventSummary: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: Date;
  metadata?: Prisma.InputJsonValue;
};

export async function rebuildAccount360Projection(accountId: string) {
  const id = String(accountId || '').trim();
  if (!id) return;

  const holder = await tenantScopedPrisma.policyHolder.findUnique({
    where: { id },
    include: {
      policies: {
        select: {
          id: true,
          policyNumber: true,
          status: true,
          bo_status: true,
          productType: true,
          expiryDate: true,
          updatedAt: true,
          quoteResponse: true,
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
              purpose: true,
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
    await tenantScopedPrisma.$transaction([
      tenantScopedPrisma.accountSummaryProjection.deleteMany({ where: { accountId: id } }),
      tenantScopedPrisma.accountPortfolioMetrics.deleteMany({ where: { accountId: id } }),
      tenantScopedPrisma.accountAlertsProjection.deleteMany({ where: { accountId: id } }),
      tenantScopedPrisma.accountActivityFeed.deleteMany({ where: { accountId: id } }),
    ]);
    return;
  }

  const contact = parseContactRecord(holder.contact);
  const policies = holder.policies || [];
  const policyIds = policies.map((p) => p.id);
  const claimIds = policies.flatMap((p) => (p.claims || []).map((c) => c.id));

  const threadEntityOr: Array<{ entityType: string; entityId: { in: string[] } }> = [];
  if (policyIds.length > 0) threadEntityOr.push({ entityType: 'POLICY', entityId: { in: policyIds } });
  if (claimIds.length > 0) threadEntityOr.push({ entityType: 'CLAIM', entityId: { in: claimIds } });

  const communicationThreads = threadEntityOr.length
    ? await prisma.communicationThread.findMany({
        where: { OR: threadEntityOr },
        select: { id: true, entityType: true, entityId: true },
      })
    : [];

  const threadIds = communicationThreads.map((t) => t.id);
  const communicationMessages = threadIds.length
    ? await prisma.communicationMessage.findMany({
        where: { threadId: { in: threadIds } },
        select: {
          id: true,
          threadId: true,
          channel: true,
          status: true,
          subject: true,
          createdAt: true,
          sentAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
    : [];

  let activePoliciesCount = 0;
  let draftPoliciesCount = 0;
  let expiredPoliciesCount = 0;
  let cancelledPoliciesCount = 0;
  let annualizedPremium = 0;
  let openClaimsCount = 0;
  let outstandingBalance = 0;
  let failedPayments = 0;
  let billingIssueCount = 0;
  let renewalIn30DaysCount = 0;
  let renewalIn60DaysCount = 0;
  const productMix: Record<string, number> = {};
  const feedEvents: FeedEvent[] = [];

  const now = Date.now();
  for (const policy of policies) {
    const statusUp = String(policy.bo_status || policy.status || '').toUpperCase();
    const premium = parsePremiumFromPolicy(asRecord(policy));
    const productType = String(policy.productType || 'UNKNOWN');
    productMix[productType] = (productMix[productType] || 0) + 1;

    if (ACTIVE_POLICY_STATUSES.has(statusUp)) {
      activePoliciesCount += 1;
      annualizedPremium += premium;
    } else if (DRAFT_POLICY_STATUSES.has(statusUp)) {
      draftPoliciesCount += 1;
    } else if (EXPIRED_POLICY_STATUSES.has(statusUp)) {
      expiredPoliciesCount += 1;
    } else if (CANCELLED_POLICY_STATUSES.has(statusUp)) {
      cancelledPoliciesCount += 1;
    }

    const expiryMs = new Date(policy.expiryDate).getTime();
    if (ACTIVE_POLICY_STATUSES.has(statusUp) && Number.isFinite(expiryMs)) {
      const days = Math.ceil((expiryMs - now) / (24 * 60 * 60 * 1000));
      if (days >= 0 && days <= 30) renewalIn30DaysCount += 1;
      if (days >= 0 && days <= 60) renewalIn60DaysCount += 1;
    }

    const policyNumber = String(policy.policyNumber || '').trim();
    const policyUpdatedAt = new Date(policy.updatedAt);
    feedEvents.push({
      sourceDomain: 'POLICY',
      eventType: 'POLICY_UPDATED',
      eventSummary: policyNumber ? `Policy ${policyNumber} updated` : 'Policy updated',
      aggregateType: 'POLICY',
      aggregateId: policy.id,
      occurredAt: policyUpdatedAt,
    });

    for (const claim of policy.claims || []) {
      const claimStatusUp = String(claim.status || '').toUpperCase();
      if (!CLOSED_CLAIM_STATUSES.has(claimStatusUp)) openClaimsCount += 1;
      feedEvents.push({
        sourceDomain: 'CLAIMS',
        eventType: 'CLAIM_UPDATED',
        eventSummary: claim.claimNumber ? `Claim ${claim.claimNumber} updated` : 'Claim updated',
        aggregateType: 'CLAIM',
        aggregateId: claim.id,
        occurredAt: new Date(claim.updatedAt),
        metadata: { status: claim.status, reserve: String(claim.amountReserved || 0) },
      });
    }

    for (const invoice of policy.invoices || []) {
      const invoiceStatusUp = String(invoice.status || '').toUpperCase();
      const invoiceAmount = toNum(invoice.amount);
      if (UNPAID_INVOICE_STATUSES.has(invoiceStatusUp)) {
        outstandingBalance += invoiceAmount;
        billingIssueCount += 1;
      }
      const dueMs = invoice.dueDate ? new Date(invoice.dueDate).getTime() : NaN;
      const overdue = Number.isFinite(dueMs) && dueMs < now && UNPAID_INVOICE_STATUSES.has(invoiceStatusUp);
      if (overdue) {
        feedEvents.push({
          sourceDomain: 'BILLING',
          eventType: 'INVOICE_OVERDUE',
          eventSummary: `Invoice overdue on policy ${policyNumber || policy.id}`,
          aggregateType: 'INVOICE',
          aggregateId: invoice.id,
          occurredAt: new Date(invoice.updatedAt || invoice.dueDate || policy.updatedAt),
          metadata: { amount: invoiceAmount, status: invoice.status },
        });
      }
    }

    for (const payment of policy.payments || []) {
      const paymentStatusUp = String(payment.status || '').toUpperCase();
      if (FAILED_PAYMENT_STATUSES.has(paymentStatusUp)) {
        failedPayments += 1;
        billingIssueCount += 1;
        feedEvents.push({
          sourceDomain: 'BILLING',
          eventType: 'PAYMENT_FAILED',
          eventSummary: `Payment failed on policy ${policyNumber || policy.id}`,
          aggregateType: 'PAYMENT',
          aggregateId: payment.id,
          occurredAt: new Date(payment.updatedAt),
          metadata: { status: payment.status, amount: toNum(payment.amount) },
        });
      }
    }

    for (const document of policy.documents || []) {
      feedEvents.push({
        sourceDomain: 'DOCUMENTS',
        eventType: 'DOCUMENT_GENERATED',
        eventSummary: `${String(document.type || 'Document')} generated`,
        aggregateType: 'DOCUMENT',
        aggregateId: document.id,
        occurredAt: new Date(document.createdAt),
      });
    }
  }

  for (const message of communicationMessages) {
    const channel = String(message.channel || 'MESSAGE').toUpperCase();
    const occurredAt = message.sentAt ? new Date(message.sentAt) : new Date(message.createdAt);
    feedEvents.push({
      sourceDomain: 'COMMUNICATIONS',
      eventType: 'COMMUNICATION_SENT',
      eventSummary: `${channel} communication ${String(message.status || '').toLowerCase() || 'recorded'}`,
      aggregateType: 'COMMUNICATION',
      aggregateId: message.id,
      occurredAt,
      metadata: {
        channel: message.channel,
        status: message.status,
        subject: message.subject,
      },
    });
  }

  const cancellationSignals = cancelledPoliciesCount > 0 ? 1 : 0;
  const health = deriveAccountHealth({
    overdueBalance: outstandingBalance,
    failedPayments,
    openClaimsCount,
    renewalIn30DaysCount,
    billingIssueCount,
    cancellationSignals,
  });

  const alerts: Array<Omit<Prisma.AccountAlertsProjectionCreateManyInput, 'operatingTenantId'>> = [];
  if (outstandingBalance > 0) {
    alerts.push({
      accountId: id,
      alertCode: 'OUTSTANDING_BALANCE',
      severity: outstandingBalance > 1000 ? 'HIGH' : 'MEDIUM',
      title: 'Outstanding balance',
      description: `Outstanding balance is ${outstandingBalance.toFixed(2)}`,
      sourceDomain: 'BILLING',
      occurredAt: new Date(),
      metadata: { outstandingBalance },
    });
  }
  if (failedPayments > 0) {
    alerts.push({
      accountId: id,
      alertCode: 'FAILED_PAYMENT',
      severity: failedPayments > 1 ? 'HIGH' : 'MEDIUM',
      title: 'Failed payment',
      description: `${failedPayments} failed payment event(s)`,
      sourceDomain: 'BILLING',
      occurredAt: new Date(),
      metadata: { failedPayments },
    });
  }
  if (openClaimsCount > 0) {
    alerts.push({
      accountId: id,
      alertCode: 'OPEN_CLAIMS',
      severity: openClaimsCount > 2 ? 'HIGH' : 'MEDIUM',
      title: 'Open claims',
      description: `${openClaimsCount} open claim(s)`,
      sourceDomain: 'CLAIMS',
      occurredAt: new Date(),
      metadata: { openClaimsCount },
    });
  }
  if (renewalIn30DaysCount > 0) {
    alerts.push({
      accountId: id,
      alertCode: 'RENEWAL_SOON',
      severity: 'LOW',
      title: 'Renewal approaching',
      description: `${renewalIn30DaysCount} policy renewal(s) in 30 days`,
      sourceDomain: 'POLICY',
      occurredAt: new Date(),
      metadata: { renewalIn30DaysCount },
    });
  }

  const sortedFeed = feedEvents
    .filter((event) => !Number.isNaN(event.occurredAt.getTime()))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, 200);

  const lastActivity = sortedFeed[0];
  const segment = String(holder.segment || '');
  const accountType = classifyAccountType({ policiesCount: policies.length, segment });
  const email = String(contact.email || '').trim();
  const phone = String(contact.phone || '').trim();
  const secondaryIdentity = email || phone || null;
  const ownerBroker = brokerName();

  await tenantScopedPrisma.$transaction(async (_tx) => {
    const tx = _tx as unknown as Prisma.TransactionClient;
    await tx.accountSummaryProjection.upsert({
      where: { accountId: id },
      create: {
        accountId: id,
        accountName: holder.name,
        accountType,
        secondaryIdentity,
        ownerBroker,
        activePoliciesCount,
        openClaimsCount,
        outstandingBalance,
        annualizedPremium,
        renewalIn30DaysCount,
        renewalIn60DaysCount,
        billingIssueCount,
        healthStatus: health.status,
        healthScore: health.score,
        healthReasons: health.reasons,
        healthRuleVersion: health.ruleVersion,
        lastActivityAt: lastActivity?.occurredAt || null,
        lastActivityType: lastActivity?.eventType || null,
        lastActivitySummary: lastActivity?.eventSummary || null,
        productMix,
        computedAt: new Date(),
      } as unknown as Prisma.AccountSummaryProjectionUncheckedCreateInput,
      update: {
        accountName: holder.name,
        accountType,
        secondaryIdentity,
        ownerBroker,
        activePoliciesCount,
        openClaimsCount,
        outstandingBalance,
        annualizedPremium,
        renewalIn30DaysCount,
        renewalIn60DaysCount,
        billingIssueCount,
        healthStatus: health.status,
        healthScore: health.score,
        healthReasons: health.reasons,
        healthRuleVersion: health.ruleVersion,
        lastActivityAt: lastActivity?.occurredAt || null,
        lastActivityType: lastActivity?.eventType || null,
        lastActivitySummary: lastActivity?.eventSummary || null,
        productMix,
        computedAt: new Date(),
      },
    });

    await tx.accountPortfolioMetrics.upsert({
      where: { accountId: id },
      create: {
        accountId: id,
        activePoliciesCount,
        draftPoliciesCount,
        expiredPoliciesCount,
        cancelledPoliciesCount,
        annualizedPremium,
        productMix,
        renewalBuckets: {
          in30Days: renewalIn30DaysCount,
          in60Days: renewalIn60DaysCount,
        },
        computedAt: new Date(),
      } as unknown as Prisma.AccountPortfolioMetricsUncheckedCreateInput,
      update: {
        activePoliciesCount,
        draftPoliciesCount,
        expiredPoliciesCount,
        cancelledPoliciesCount,
        annualizedPremium,
        productMix,
        renewalBuckets: {
          in30Days: renewalIn30DaysCount,
          in60Days: renewalIn60DaysCount,
        },
        computedAt: new Date(),
      },
    });

    await tx.accountAlertsProjection.deleteMany({ where: { accountId: id } });
    if (alerts.length > 0) {
      await tx.accountAlertsProjection.createMany({ data: alerts as Prisma.AccountAlertsProjectionCreateManyInput[] });
    }

    await tx.accountActivityFeed.deleteMany({ where: { accountId: id } });
    if (sortedFeed.length > 0) {
      await tx.accountActivityFeed.createMany({
        data: sortedFeed.map((event) => ({
          accountId: id,
          sourceDomain: event.sourceDomain,
          eventType: event.eventType,
          eventSummary: event.eventSummary,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          occurredAt: event.occurredAt,
          metadata: event.metadata,
        })) as Prisma.AccountActivityFeedCreateManyInput[],
      });
    }
  }, TENANT_GUC_TX_OPTIONS);

  logger.info(
    {
      accountId: id,
      activePoliciesCount,
      openClaimsCount,
      outstandingBalance,
      healthStatus: health.status,
      alerts: alerts.length,
      feedEvents: sortedFeed.length,
    },
    'accounts360.projection_rebuilt'
  );
}

export async function reconcileAccounts360ProjectionBatch(limit = 300) {
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

  for (const id of ids) {
    await rebuildAccount360Projection(id);
  }

  return ids.length;
}

export async function backfillAccounts360Projection(batchSize = 250, maxBatches = 400) {
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
      await rebuildAccount360Projection(row.id);
      total += 1;
    }
    cursor = chunk[chunk.length - 1]?.id || null;
  }

  return total;
}
