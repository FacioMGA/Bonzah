import { appendDomainEvent, buildDomainEvent } from '../../../../platform/events/domainEvents.js';
import { buildClaimWorksheetProjection, persistClaimProjectionSnapshot } from '../worksheetProjection.js';
import type {
  PrismaClaimEventUncheckedCreateInput,
  PrismaInputJsonValue,
  PrismaTransactionClient,
} from '../../../../platform/types/prisma.js';
import type { ActorType, ClaimBucket, ClaimCommandType, ClaimWorksheetCommandInput } from './types.js';
import { ALL_BUCKETS, FINANCIAL_COMMANDS } from './types.js';

type ClaimsTx = PrismaTransactionClient;

export type LoadedClaim = {
  id: string;
  policyId: string | null;
  claimNumber: string;
  data: unknown;
  documents: unknown;
  events: Array<{ id: string; eventType: string; occurredAt: Date; payload: unknown; actorName: string | null }>;
};

export type ClaimGovernanceProfile = {
  settlementAuthorityLimit: number;
  largeLossThreshold: number;
  claimsFundLimit?: number;
  source: 'binder' | 'environment';
};

export type ClaimSnapshotSyncPayload = {
  projectedStatus: string;
  updatedClaimData: Record<string, unknown>;
  amountPaid: number;
  amountReserved: number;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function toMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function normalizeBucket(value: unknown, fallback: ClaimBucket = 'INDEMNITY'): ClaimBucket {
  const upper = String(value || '').trim().toUpperCase();
  if (ALL_BUCKETS.includes(upper as ClaimBucket)) return upper as ClaimBucket;
  if (upper === 'FEES') return 'LEGAL_FEES';
  return fallback;
}

export function actorAuthorityLimit(actorType: ActorType, settlementAuthorityLimit?: number): number {
  const underwriterLimit = Number(process.env.CLAIM_AUTH_LIMIT_UNDERWRITER || 50000);
  const userLimit = Number(process.env.CLAIM_AUTH_LIMIT_USER || 20000);
  const roleLimit = actorType === 'OPS'
    ? Number.MAX_SAFE_INTEGER
    : actorType === 'UNDERWRITER'
      ? (Number.isFinite(underwriterLimit) ? underwriterLimit : 50000)
      : (Number.isFinite(userLimit) ? userLimit : 20000);
  const delegatedLimit = Number(settlementAuthorityLimit || 0);
  if (!Number.isFinite(delegatedLimit) || delegatedLimit <= 0) return roleLimit;
  return Math.min(roleLimit, delegatedLimit);
}

function toFinitePositive(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export async function resolveClaimGovernanceProfile(args: {
  tx: ClaimsTx;
  policyId?: string | null;
}): Promise<ClaimGovernanceProfile> {
  const envLargeLoss = Number(process.env.CLAIM_LARGE_LOSS_THRESHOLD || 0);
  const envSettlementAuthority = Number(process.env.CLAIM_AUTH_LIMIT_USER || 20000);
  const fallbackAuthority = Number.isFinite(envSettlementAuthority) && envSettlementAuthority > 0 ? envSettlementAuthority : 20000;
  const fallbackLargeLoss = Number.isFinite(envLargeLoss) && envLargeLoss > 0 ? envLargeLoss : fallbackAuthority;

  const policyId = String(args.policyId || '').trim();
  if (!policyId) {
    return {
      settlementAuthorityLimit: fallbackAuthority,
      largeLossThreshold: fallbackLargeLoss,
      source: 'environment',
    };
  }
  const policy = await args.tx.policy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      binder: {
        select: {
          id: true,
          config: true,
        },
      },
    },
  });
  const binderConfig = asRecord(policy?.binder?.config);
  const operations = asRecord(binderConfig.operations);
  const claimsOps = asRecord(operations.claims);
  const settlementAuthorityLimit = toFinitePositive(claimsOps.tpaAuthorityLimit);
  const claimsFundLimit = toFinitePositive(claimsOps.claimsFundLimit);
  const explicitLargeLoss = toFinitePositive(claimsOps.largeLossThreshold);
  const largeLossThreshold = explicitLargeLoss || settlementAuthorityLimit || fallbackLargeLoss;

  if (!settlementAuthorityLimit) {
    return {
      settlementAuthorityLimit: fallbackAuthority,
      largeLossThreshold,
      claimsFundLimit,
      source: 'environment',
    };
  }
  return {
    settlementAuthorityLimit,
    largeLossThreshold,
    claimsFundLimit,
    source: 'binder',
  };
}

export function requireMovementReason(payload: Record<string, unknown>, movement: string): { reasonCode: string; explanation: string } {
  const reasonCode = String(payload.reasonCode || '').trim().toUpperCase();
  const explanation = String(payload.explanation ?? payload.reason ?? '').trim();
  if (!reasonCode) throw new Error(`${movement} requires reasonCode`);
  if (!explanation) throw new Error(`${movement} requires explanation`);
  return { reasonCode, explanation };
}

export function assertFnolConfirmedForFinancialCommands(args: {
  type: ClaimCommandType;
  projection: { intake: { status: string; confirmedVersion?: number; currentVersion?: number } };
}) {
  if (!FINANCIAL_COMMANDS.has(args.type)) return;
  const intake = args.projection.intake;
  const confirmed = intake.status === 'FNOL_CONFIRMED' && intake.confirmedVersion && intake.currentVersion && intake.confirmedVersion === intake.currentVersion;
  if (!confirmed) throw new Error('FNOL must be confirmed before financial commands');
}

async function nextAggregateVersion(tx: ClaimsTx, claimId: string): Promise<number> {
  const latest = await tx.claimEvent.findFirst({
    where: { claimId },
    orderBy: [{ aggregateVersion: 'desc' }, { occurredAt: 'desc' }],
    select: { aggregateVersion: true },
  });
  return Number(latest?.aggregateVersion || 0) + 1;
}

export async function appendClaimEvent(args: {
  tx: ClaimsTx;
  claimId: string;
  claimNumber: string;
  command: ClaimCommandType;
  eventType: string;
  payload: Record<string, unknown>;
  input: ClaimWorksheetCommandInput;
}) {
  const aggregateVersion = await nextAggregateVersion(args.tx, args.claimId);
  const occurredAt = String(args.payload.occurredAt || '').trim() || new Date().toISOString();
  const event = await args.tx.claimEvent.create({
    data: {
      claimId: args.claimId,
      eventType: args.eventType,
      aggregateType: 'CLAIM',
      aggregateId: args.claimId,
      aggregateVersion,
      payload: args.payload as PrismaInputJsonValue,
      occurredAt: new Date(occurredAt),
      actorType: args.input.actorType,
      actorId: args.input.actorId,
      actorName: args.input.actorName || null,
      correlationId: args.input.correlationId || null,
      causationId: args.command,
      idempotencyKey: args.input.idempotencyKey || null,
    } as unknown as PrismaClaimEventUncheckedCreateInput,
  });
  const eventData: Record<string, unknown> = {
    claimNumber: args.claimNumber,
    ...args.payload,
  };
  await appendDomainEvent(args.tx as never, buildDomainEvent({
    eventType: `CLAIM.${args.eventType}`,
    aggregateType: 'CLAIM',
    aggregateId: args.claimId,
    aggregateVersion,
    actorType: args.input.actorType,
    actorId: args.input.actorId,
    causationId: args.command,
    correlationId: args.input.correlationId,
    data: eventData as never,
  }));
  return event;
}

export async function refreshClaimSnapshot(tx: ClaimsTx, claimId: string): Promise<ClaimSnapshotSyncPayload | null> {
  const claim = await tx.claim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      claimNumber: true,
      data: true,
      events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
    },
  });
  if (!claim) return null;
  const claimData = asRecord(claim.data);
  const projection = buildClaimWorksheetProjection({
    claimId: claim.id,
    claimReference: claim.claimNumber,
    certificateReference: String(claimData.cr0029_certificate_reference || ''),
    events: claim.events,
  });
  await persistClaimProjectionSnapshot({ tx, claimId, projection });
  const statusMap: Record<string, string> = {
    PENDING: 'PENDING',
    OPEN: 'OPEN',
    DENIED: 'DENIED',
    CLOSED: 'CLOSED',
    CLOSED_THIS_MONTH: 'CLOSED',
    REOPENED: 'UNDER_REVIEW',
    WITHDRAWN: 'CLOSED',
    OPEN_CLAIM_PAID_FEES_OUTSTANDING: 'OPEN',
    OPEN_FEES_PAID_CLAIMS_OUTSTANDING: 'OPEN',
    OPEN_CLAIM_AND_FEES_PAID: 'OPEN',
    CLOSED_RECOVERY_PURSUED: 'CLOSED',
  };
  const projectedStatus = statusMap[projection.status] || 'OPEN';
  const updatedClaimData: Record<string, unknown> = {
    ...claimData,
    worksheetProjection: {
      status: projection.status,
      phase: projection.phase,
      intake: projection.intake,
      cr0106ReferredToUnderwriters: projection.cr0106ReferredToUnderwriters,
      cr0107Denial: projection.cr0107Denial,
      closedAt: projection.closedAt || null,
      reopenedAt: projection.reopenedAt || null,
      deniedAt: projection.deniedAt || null,
      deniedReason: projection.denialReason || null,
      buckets: projection.buckets,
      totalPaid: projection.totalPaid,
      totalOutstanding: projection.totalOutstanding,
      totalIncurred: projection.totalIncurred,
      totalRecovered: projection.totalRecovered,
      netIncurred: projection.netIncurred,
      recoveriesExpected: projection.recoveriesExpected,
      salvageRealized: projection.salvageRealized,
      salvageExpected: projection.salvageExpected,
      referralRequired: projection.referralRequired,
      referralApprovedAt: projection.referralApprovedAt || null,
      largeLossIndicator: projection.largeLossIndicator,
      largeLossNotifiedAt: projection.largeLossNotifiedAt || null,
      lockedDeductible: projection.lockedDeductible ?? null,
    },
  };
  return {
    projectedStatus,
    updatedClaimData,
    amountPaid: projection.totalPaid,
    amountReserved: projection.totalOutstanding,
  };
}

export async function enforceAuthorityOrRequireReferral(args: {
  tx: ClaimsTx;
  claimId: string;
  claimNumber: string;
  command: ClaimCommandType;
  input: ClaimWorksheetCommandInput;
  projection: { totalIncurred: number; referralApprovedAt?: string };
  postMovementIncurred: number;
  reasonCode: string;
  explanation: string;
  settlementAuthorityLimit?: number;
  governanceSource?: ClaimGovernanceProfile['source'];
}) {
  const limit = actorAuthorityLimit(args.input.actorType, args.settlementAuthorityLimit);
  const approvedReferral = Boolean(args.projection.referralApprovedAt);
  if (args.postMovementIncurred <= limit || approvedReferral) return;
  await appendClaimEvent({
    tx: args.tx,
    claimId: args.claimId,
    claimNumber: args.claimNumber,
    command: args.command,
    input: args.input,
    eventType: 'REFERRAL_REQUIRED',
    payload: {
      reasonCode: args.reasonCode,
      explanation: args.explanation,
      userAuthorityLimit: limit,
      settlementAuthorityLimit: Number(args.settlementAuthorityLimit || 0) || undefined,
      governanceSource: args.governanceSource || undefined,
      postMovementIncurred: args.postMovementIncurred,
      requiredAt: new Date().toISOString(),
    },
  });
  throw new Error('Movement exceeds authority; referral approval required');
}

export function extractLockedDeductible(policyData: Record<string, unknown>): number | undefined {
  const quoteData = asRecord(policyData.quoteData);
  const value = toMoney(quoteData.requiredExcess);
  return value > 0 ? value : undefined;
}

export async function maybeFlagLargeLoss(args: {
  tx: ClaimsTx;
  claimId: string;
  claimNumber: string;
  input: ClaimWorksheetCommandInput;
  command: ClaimCommandType;
  largeLossThreshold?: number;
  governanceSource?: ClaimGovernanceProfile['source'];
}) {
  const threshold = Number(args.largeLossThreshold || process.env.CLAIM_LARGE_LOSS_THRESHOLD || 0);
  if (!Number.isFinite(threshold) || threshold <= 0) return;
  const claim = await args.tx.claim.findUnique({
    where: { id: args.claimId },
    select: {
      id: true,
      claimNumber: true,
      data: true,
      events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
    },
  });
  if (!claim) return;
  const alreadyFlagged = claim.events.some((ev: { eventType?: string }) => ev.eventType === 'LARGE_LOSS_FLAGGED');
  if (alreadyFlagged) return;
  const projection = buildClaimWorksheetProjection({
    claimId: claim.id,
    claimReference: claim.claimNumber,
    certificateReference: String(asRecord(claim.data).cr0029_certificate_reference || ''),
    events: claim.events,
  });
  if (projection.totalIncurred < threshold) return;
  await appendClaimEvent({
    tx: args.tx,
    claimId: args.claimId,
    claimNumber: args.claimNumber,
    command: args.command,
    input: args.input,
    eventType: 'LARGE_LOSS_FLAGGED',
    payload: {
      flaggedAt: new Date().toISOString(),
      threshold,
      governanceSource: args.governanceSource || undefined,
      totalIncurred: projection.totalIncurred,
      largeLossNotifiedAt: new Date().toISOString(),
    },
  });
}

export type CommandContext = {
  tx: ClaimsTx;
  claim: LoadedClaim;
  claimNumber: string;
  claimData: Record<string, unknown>;
  projection: ReturnType<typeof buildClaimWorksheetProjection>;
  payload: Record<string, unknown>;
  input: ClaimWorksheetCommandInput;
  type: ClaimCommandType;
  governance: ClaimGovernanceProfile;
};

