import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizePayeeRoleCode, type PayeeRoleCode } from '../domain/paymentClassification.js';

type ClaimsCounterpartyTx = Prisma.TransactionClient | PrismaClient;

type CounterpartyCandidate = {
  slug: string;
  name: string;
  entityType: 'person' | 'organisation';
  roles: PayeeRoleCode[];
  providerType?: string;
  sourceType: string;
  sourceId?: string;
  data?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return String(value || '').trim();
}

function pushCandidate(target: CounterpartyCandidate[], next: CounterpartyCandidate) {
  const existing = target.find((candidate) => candidate.slug === next.slug);
  if (existing) {
    existing.name = next.name || existing.name;
    existing.entityType = next.entityType || existing.entityType;
    existing.providerType = next.providerType || existing.providerType;
    existing.sourceType = next.sourceType || existing.sourceType;
    existing.sourceId = next.sourceId || existing.sourceId;
    existing.data = { ...(existing.data || {}), ...(next.data || {}) };
    existing.roles = Array.from(new Set([...existing.roles, ...next.roles]));
    return;
  }
  target.push({
    ...next,
    roles: Array.from(new Set(next.roles)),
    data: next.data ? { ...next.data } : undefined,
  });
}

function defaultRoleLabel(role: PayeeRoleCode): string {
  switch (role) {
    case 'insured':
      return 'Insured';
    case 'claimant':
      return 'Claimant';
    case 'third_party':
      return 'Third party';
    case 'repairer':
      return 'Repairer';
    case 'legal_provider':
      return 'Legal provider';
    case 'adjuster':
      return 'Adjuster';
    case 'expert':
      return 'Expert';
    case 'tpa':
      return 'TPA';
    case 'medical_provider':
      return 'Medical provider';
    case 'vendor':
      return 'Vendor';
    case 'other':
    default:
      return 'Other payee';
  }
}

function deriveRolesFromAssignment(roleRaw: unknown): PayeeRoleCode[] {
  const normalized = asText(roleRaw).toLowerCase();
  switch (normalized) {
    case 'adjuster':
      return ['adjuster'];
    case 'lawyer':
      return ['legal_provider'];
    case 'estimator':
      return ['expert'];
    default:
      return ['other'];
  }
}

function extractClaimContactName(claimData: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const direct = asText(claimData[key]);
    if (direct) return direct;
  }
  const caseIntakeDraft = asRecord(claimData.caseIntakeDraft);
  for (const key of keys) {
    const fromDraft = asText(caseIntakeDraft[key]);
    if (fromDraft) return fromDraft;
  }
  return '';
}

function buildDefaultCandidates(args: {
  claimData: Record<string, unknown>;
  policyHolderId?: string;
  policyHolderName?: string;
}): CounterpartyCandidate[] {
  const candidates: CounterpartyCandidate[] = [];
  const insuredName = extractClaimContactName(args.claimData, ['insuredName', 'insured_name']) || asText(args.policyHolderName);
  const claimantName = extractClaimContactName(args.claimData, ['claimantName', 'claimant_name']) || insuredName;
  const thirdPartyName = extractClaimContactName(args.claimData, ['thirdPartyName', 'third_party_name']);
  const repairerName = extractClaimContactName(args.claimData, ['garageName', 'repairerName', 'repairer_name']);

  pushCandidate(candidates, {
    slug: args.policyHolderId ? `policyholder:${args.policyHolderId}` : 'default:insured',
    name: insuredName || defaultRoleLabel('insured'),
    entityType: 'person',
    roles: ['insured'],
    sourceType: args.policyHolderId ? 'POLICYHOLDER' : 'SYSTEM_DEFAULT',
    sourceId: args.policyHolderId,
  });
  pushCandidate(candidates, {
    slug: claimantName ? `claimant:${claimantName.toLowerCase()}` : 'default:claimant',
    name: claimantName || defaultRoleLabel('claimant'),
    entityType: 'person',
    roles: ['claimant'],
    sourceType: claimantName ? 'CLAIM_DATA' : 'SYSTEM_DEFAULT',
  });

  const genericRoleCandidates: Array<{ role: PayeeRoleCode; name?: string }> = [
    { role: 'third_party', name: thirdPartyName },
    { role: 'repairer', name: repairerName },
    { role: 'legal_provider' },
    { role: 'adjuster' },
    { role: 'expert' },
    { role: 'medical_provider' },
    { role: 'vendor' },
    { role: 'tpa' },
    { role: 'other' },
  ];

  for (const item of genericRoleCandidates) {
    pushCandidate(candidates, {
      slug: item.name ? `${item.role}:${item.name.toLowerCase()}` : `default:${item.role}`,
      name: item.name || defaultRoleLabel(item.role),
      entityType: 'organisation',
      roles: [item.role],
      sourceType: item.name ? 'CLAIM_DATA' : 'SYSTEM_DEFAULT',
    });
  }
  return candidates;
}

export async function syncClaimCounterparties(tx: ClaimsCounterpartyTx, claimId: string) {
  const claim = await tx.claim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      data: true,
      policy: {
        select: {
          id: true,
          policyHolder: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      assignments: {
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          role: true,
          notes: true,
          pro: {
            select: {
              id: true,
              name: true,
              company: true,
            },
          },
        },
      },
    },
  });
  if (!claim) return [];

  const claimData = asRecord(claim.data);
  const candidates = buildDefaultCandidates({
    claimData,
    policyHolderId: claim.policy?.policyHolder?.id,
    policyHolderName: claim.policy?.policyHolder?.name,
  });

  for (const assignment of claim.assignments) {
    if (!assignment.pro) continue;
    const roles = deriveRolesFromAssignment(assignment.role);
    pushCandidate(candidates, {
      slug: `assignment:${assignment.id}`,
      name: asText(assignment.pro.company) || asText(assignment.pro.name) || defaultRoleLabel(roles[0] || 'other'),
      entityType: 'organisation',
      roles,
      providerType: asText(assignment.role).toLowerCase() || undefined,
      sourceType: 'ASSIGNMENT',
      sourceId: assignment.id,
      data: {
        proId: assignment.pro.id,
        role: assignment.role,
        notes: assignment.notes || undefined,
      },
    });
  }

  const activeSlugs = new Set<string>();
  for (const candidate of candidates) {
    activeSlugs.add(candidate.slug);
    await tx.claimCounterparty.upsert({
      where: {
        claimId_slug: {
          claimId,
          slug: candidate.slug,
        },
      },
      update: {
        name: candidate.name,
        entityType: candidate.entityType,
        roles: candidate.roles,
        status: 'ACTIVE',
        providerType: candidate.providerType || null,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId || null,
        data: (candidate.data || {}) as Prisma.InputJsonValue,
      },
      create: {
        claimId,
        slug: candidate.slug,
        name: candidate.name,
        entityType: candidate.entityType,
        roles: candidate.roles,
        status: 'ACTIVE',
        providerType: candidate.providerType || null,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId || null,
        data: (candidate.data || {}) as Prisma.InputJsonValue,
      },
    });
  }

  await tx.claimCounterparty.updateMany({
    where: {
      claimId,
      slug: { notIn: Array.from(activeSlugs) || ['__none__'] },
      sourceType: { in: ['POLICYHOLDER', 'CLAIM_DATA', 'ASSIGNMENT', 'SYSTEM_DEFAULT'] },
    },
    data: { status: 'INACTIVE' },
  });

  return tx.claimCounterparty.findMany({
    where: { claimId, status: 'ACTIVE' },
    orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function listClaimCounterparties(tx: ClaimsCounterpartyTx, claimId: string) {
  const counterparties = await syncClaimCounterparties(tx, claimId);
  return counterparties.map((counterparty) => ({
    id: counterparty.id,
    claimId: counterparty.claimId,
    name: counterparty.name,
    entityType: counterparty.entityType,
    roles: counterparty.roles
      .map((role) => normalizePayeeRoleCode(role))
      .filter((role): role is PayeeRoleCode => Boolean(role)),
    status: counterparty.status,
    providerType: counterparty.providerType || undefined,
    sourceType: counterparty.sourceType || undefined,
  }));
}

export async function getClaimCounterpartyById(tx: ClaimsCounterpartyTx, claimId: string, counterpartyId: string) {
  await syncClaimCounterparties(tx, claimId);
  const counterparty = await tx.claimCounterparty.findFirst({
    where: {
      id: counterpartyId,
      claimId,
      status: 'ACTIVE',
    },
  });
  if (!counterparty) return null;
  return {
    id: counterparty.id,
    claimId: counterparty.claimId,
    name: counterparty.name,
    entityType: counterparty.entityType,
    roles: counterparty.roles
      .map((role) => normalizePayeeRoleCode(role))
      .filter((role): role is PayeeRoleCode => Boolean(role)),
    status: counterparty.status,
    providerType: counterparty.providerType || undefined,
  };
}
