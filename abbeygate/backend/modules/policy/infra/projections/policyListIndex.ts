import { prisma, tenantScopedPrisma } from '../../../../platform/db/connection.js';
import type { Prisma } from '@prisma/client';
import { logger } from '../../../../platform/utils/logger.js';
import { buildDomainEvent } from '../../../../platform/events/domainEvents.js';
import { getTenantConfig } from '../../../../platform/tenant/tenantConfig.js';
import { upsertPolicyListDiscoverabilityRow } from './discoverabilityWriter.js';
import { assertPolicyListIndexOwnership } from './discoverabilityOwnership.js';
import { derivePolicyState } from '../../domain/policyStateService.js';
import { evaluatePolicyCompliance } from '../../app/policyCompliance.js';

const TX_DISCOVERABILITY_ENABLED =
  String(process.env.POLICY_TX_DISCOVERABILITY_ENABLED || 'true').trim().toLowerCase() !== 'false';
type UnknownRecord = Record<string, unknown>;
const asRecord = (v: unknown): UnknownRecord =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : {};

const asCallable = (value: unknown): ((args: unknown) => Promise<unknown>) | null =>
  typeof value === 'function' ? (value as (args: unknown) => Promise<unknown>) : null;

const readDelegate = (db: object, key: string): UnknownRecord => asRecord(Reflect.get(db, key));

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function attentionFor(policy: {
  status: string;
  boStatus?: string;
  expiryDate: Date | null;
  invoiceOverdue: boolean;
  hasOpenClaim: boolean;
}): { bucket: string; score: number; customerActionRequired: boolean; uwActionRequired: boolean } {
  const status = String(policy.boStatus || policy.status || '').toUpperCase();
  const now = Date.now();
  const expiryMs = policy.expiryDate ? new Date(policy.expiryDate).getTime() : NaN;
  const daysToExpiry = Number.isFinite(expiryMs) ? Math.ceil((expiryMs - now) / (24 * 60 * 60 * 1000)) : null;

  if (status === 'INFO_REQUIRED') return { bucket: 'CUSTOMER_INFO_REQUIRED', score: 100, customerActionRequired: true, uwActionRequired: false };
  if (status === 'REFERRAL') return { bucket: 'UW_REFERRAL', score: 95, customerActionRequired: false, uwActionRequired: true };
  if (status === 'AWAITING_PAYMENT') return { bucket: 'AWAITING_PAYMENT', score: 90, customerActionRequired: true, uwActionRequired: false };
  if (status === 'CANCELLATION_REQUESTED') return { bucket: 'CANCELLATION_REQUESTED', score: 88, customerActionRequired: false, uwActionRequired: true };
  if (policy.invoiceOverdue) return { bucket: 'INVOICE_OVERDUE', score: 85, customerActionRequired: true, uwActionRequired: false };
  if (daysToExpiry !== null && daysToExpiry <= 30 && daysToExpiry >= 0) return { bucket: 'EXPIRING_SOON', score: 80, customerActionRequired: false, uwActionRequired: false };
  if (policy.hasOpenClaim) return { bucket: 'OPEN_CLAIM', score: 72, customerActionRequired: false, uwActionRequired: false };
  if (status === 'ACTIVE' || status === 'ISSUED') return { bucket: 'IN_FORCE', score: 55, customerActionRequired: false, uwActionRequired: false };
  if (status === 'QUOTED' || status === 'QUOTE') return { bucket: 'QUOTED', score: 50, customerActionRequired: false, uwActionRequired: false };
  if (status === 'EXPIRED') return { bucket: 'EXPIRED', score: 20, customerActionRequired: false, uwActionRequired: false };
  return { bucket: 'NORMAL', score: 40, customerActionRequired: false, uwActionRequired: false };
}

export async function enqueuePolicyListIndexUpdate(db: object, policyId: string) {
  const pid = String(policyId || '').trim();
  if (!pid) return;
  // Primary discoverability must be immediate and transactional where possible.
  if (TX_DISCOVERABILITY_ENABLED) {
    await upsertPolicyListDiscoverabilityRow(db, pid);
  }

  const outboxCreate = asCallable(readDelegate(db, 'outbox').create);
  if (!outboxCreate) return;

  const envelope = buildDomainEvent({
    eventType: 'POLICY.INDEX_UPDATE',
    aggregateType: 'POLICY',
    aggregateId: pid,
    aggregateVersion: Date.now(),
    actorType: 'SYSTEM',
    actorId: 'projection-dispatcher',
    reasonCode: 'PROJECTION_REBUILD_REQUESTED',
    data: { policyId: pid },
  });
  await outboxCreate({
    data: {
      operatingTenantId: getTenantConfig().id,
      aggregateId: pid,
      eventType: envelope.eventType,
      payload: envelope as Prisma.InputJsonValue,
    },
  });
  logger.info(
    { policyId: pid, txDiscoverabilityEnabled: TX_DISCOVERABILITY_ENABLED },
    'policy_list.index_update_enqueued',
  );
}

export async function rebuildPolicyListIndexRow(policyId: string) {
  const pid = String(policyId || '').trim();
  if (!pid) return;
  // Ensure transactional discoverability fields are fresh before enrichment.
  await upsertPolicyListDiscoverabilityRow(prisma, pid);

  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: pid },
    include: {
      policyHolder: { select: { name: true, address: true } },
      stateCurrent: { select: { snapshot: true } },
      documents: { select: { status: true, type: true } },
      claims: { select: { status: true, updatedAt: true } },
      riskTransactions: {
        select: { status: true, transactionType: true },
        take: 200,
      },
      invoices: { select: { amount: true, status: true, dueDate: true, updatedAt: true } },
    },
  });

  if (!policy) return;

  const policyRec = asRecord(policy);
  const parsedSnapshot = asRecord(policy.stateCurrent?.snapshot);
  const quoteData = asRecord(parsedSnapshot.quoteData ?? policy.quoteData);
  const quoteResponse = asRecord(parsedSnapshot.quoteResponse ?? policy.quoteResponse);
  const holderName = String(policy.policyHolder?.name || '').trim();
  const proposer = asRecord(quoteData?.proposer);
  const firstName = String(proposer.firstName || '').trim();
  const lastName = String(proposer.lastName || '').trim();
  const insuredName = holderName || [firstName, lastName].filter(Boolean).join(' ').trim() || 'Unknown';

  const address =
    String(policy.policyHolder?.address || '').trim() ||
    String(quoteData?.address || '').trim() ||
    null;

  const status = String(policy.status || '').toUpperCase() || 'DRAFT';
  const state = derivePolicyState({
    status: policy.status,
    inceptionDate: policy.inceptionDate,
    expiryDate: policy.expiryDate,
    isLocked: policyRec.isLocked,
    stateCurrentSnapshot: policy.stateCurrent?.snapshot,
    riskTransactions: policy.riskTransactions,
    claims: policy.claims,
  });
  const boStatus = state.boStatus;
  const cancellationPending = status === 'CANCELLATION_REQUESTED';
  const segment = String(policyRec.segment || 'Auto Insurance');
  const primaryOption = asRecord(quoteResponse.primaryOption);
  const costDetails = asRecord(primaryOption.costDetails);
  const pricing = asRecord(quoteResponse.pricing);
  const premium = toNum(
    costDetails.totalPremium ||
      primaryOption.annualPremium ||
      primaryOption.totalPremium ||
      pricing.total ||
      pricing.annualPremium ||
      quoteResponse.premium ||
      costDetails.subtotalNetPremium ||
      0,
  );

  const openClaimCount = (policy.claims || []).filter((c) => String(c.status || '').toUpperCase() === 'OPEN').length;
  const hasOpenClaim = openClaimCount > 0;

  const unpaidStatuses = new Set(['DRAFT', 'OPEN', 'OVERDUE', 'PENDING', 'UNPAID', 'PARTIAL']);
  const now = Date.now();
  let outstandingBalance = 0;
  let invoiceOverdue = false;
  for (const inv of policy.invoices || []) {
    const invStatus = String(inv.status || '').toUpperCase();
    if (unpaidStatuses.has(invStatus)) {
      outstandingBalance += toNum(inv.amount);
      const dueMs = inv.dueDate ? new Date(inv.dueDate).getTime() : NaN;
      if (Number.isFinite(dueMs) && dueMs < now) invoiceOverdue = true;
    }
  }

  const lastActivityCandidates: number[] = [];
  lastActivityCandidates.push(new Date(policy.updatedAt).getTime());
  for (const c of policy.claims || []) {
    if (c.updatedAt) lastActivityCandidates.push(new Date(c.updatedAt).getTime());
  }
  for (const inv of policy.invoices || []) {
    if (inv.updatedAt) lastActivityCandidates.push(new Date(inv.updatedAt).getTime());
  }
  const lastActivityAt = new Date(Math.max(...lastActivityCandidates.filter((t) => Number.isFinite(t))));

  const attention = attentionFor({
    status,
    boStatus,
    expiryDate: policy.expiryDate || null,
    invoiceOverdue,
    hasOpenClaim,
  });
  const compliance = evaluatePolicyCompliance({
    policyNumber: policy.policyNumber,
    productType: policy.productType,
    status: policy.status,
    boStatus,
    binderId: policy.binderId,
    programId: policy.programId,
    paymentStatus: policyRec.paymentStatus,
    inceptionDate: policy.inceptionDate,
    expiryDate: policy.expiryDate,
    isLocked: policyRec.isLocked,
    quoteData: policy.quoteData,
    stateCurrentSnapshot: policy.stateCurrent?.snapshot,
    riskTransactions: policy.riskTransactions,
    documents: policy.documents,
    claims: policy.claims,
    outstandingBalance,
    invoiceOverdue,
    totalPremium: premium,
  });

  // Async enrichment updates must never overwrite transactional discoverability ownership.
  assertPolicyListIndexOwnership('attentionBucket');
  assertPolicyListIndexOwnership('attentionScore');
  assertPolicyListIndexOwnership('hasOpenClaim');
  assertPolicyListIndexOwnership('openClaimCount');
  assertPolicyListIndexOwnership('outstandingBalance');
  assertPolicyListIndexOwnership('invoiceOverdue');
  assertPolicyListIndexOwnership('cancellationPending');
  assertPolicyListIndexOwnership('customerActionRequired');
  assertPolicyListIndexOwnership('uwActionRequired');
  assertPolicyListIndexOwnership('complianceState');
  assertPolicyListIndexOwnership('complianceProfile');
  assertPolicyListIndexOwnership('complianceReasons');
  assertPolicyListIndexOwnership('complianceCheckedAt');
  assertPolicyListIndexOwnership('cancellationExposureEUR');

  // ── OPERATIONS EUR: pro-rata unearned premium for cancellation-pending policies ──
  // Formula: totalPremium × (remainingDays / totalPolicyDays)
  // Requires both inceptionDate + expiryDate to be meaningful. Returns null when not cancellation-pending
  // or when dates are unavailable, so the dashboard can show "Exposure pending" gracefully.
  let cancellationExposureEUR: number | null = null;
  if (cancellationPending && policy.inceptionDate && policy.expiryDate && premium > 0) {
    const nowMs = Date.now();
    const inceptionMs = new Date(policy.inceptionDate).getTime();
    const expiryMs = new Date(policy.expiryDate).getTime();
    const totalDays = (expiryMs - inceptionMs) / (24 * 60 * 60 * 1000);
    const remainingDays = Math.max(0, (expiryMs - nowMs) / (24 * 60 * 60 * 1000));
    if (totalDays > 0) {
      cancellationExposureEUR = Math.round((premium * (remainingDays / totalDays)) * 100) / 100;
    }
  }

  await tenantScopedPrisma.policyListIndex.update({
    where: { policyId: pid },
    data: {
      attentionBucket: attention.bucket,
      attentionScore: attention.score,
      hasOpenClaim,
      openClaimCount,
      outstandingBalance,
      invoiceOverdue,
      cancellationPending,
      customerActionRequired: attention.customerActionRequired,
      uwActionRequired: attention.uwActionRequired,
      complianceState: compliance.state,
      complianceProfile: compliance.profile,
      complianceReasons: compliance.reasonCodes,
      complianceCheckedAt: new Date(),
      cancellationExposureEUR,
    },
  });

  const searchPayload: Record<string, unknown> = {
    policyNumber: policy.policyNumber,
    insuredName,
    status,
    bo_status: boStatus,
    address,
    segment,
    totalPremium: premium,
    updatedAt: lastActivityAt,
  };
  const searchCreate: Record<string, unknown> = { policyId: pid, ...searchPayload };
  const searchUpdate: Record<string, unknown> = { ...searchPayload };
  await tenantScopedPrisma.policySearchIndex.upsert({
    where: { policyId: pid },
    create: searchCreate as never,
    update: searchUpdate as never,
  });

}

export async function reconcilePolicyListIndexBatch(limit = 500) {
  const take = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const ids = await tenantScopedPrisma.policy.findMany({
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
    take,
  });
  for (const row of ids) {
    await rebuildPolicyListIndexRow(row.id);
  }
  return ids.length;
}

export async function reconcilePolicyBoStatusBatch(limit = 500) {
  const take = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const whereMissingBoStatus: Record<string, unknown> = { OR: [{ bo_status: null }, { bo_statusSortRank: null }] };
  const stale = await tenantScopedPrisma.policyListIndex.findMany({
    where: whereMissingBoStatus as never,
    select: { policyId: true },
    take,
    orderBy: { updatedAt: 'desc' },
  });
  for (const row of stale) {
    await rebuildPolicyListIndexRow(row.policyId);
  }
  return stale.length;
}

export async function backfillPolicyListIndex(batchSize = 500, maxBatches = 200) {
  const take = Math.max(1, Math.min(Number(batchSize) || 500, 2000));
  const max = Math.max(1, Math.min(Number(maxBatches) || 200, 5000));
  let cursor: string | null = null;
  let total = 0;

  for (let i = 0; i < max; i += 1) {
    const chunk: Array<{ id: string }> = await tenantScopedPrisma.policy.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!chunk.length) break;
    for (const row of chunk) {
      await rebuildPolicyListIndexRow(row.id);
      total += 1;
    }
    cursor = chunk[chunk.length - 1]?.id || null;
  }
  return total;
}
