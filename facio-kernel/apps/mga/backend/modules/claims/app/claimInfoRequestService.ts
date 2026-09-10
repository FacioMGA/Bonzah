import { Prisma } from '@prisma/client';

import { prisma, tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { dispatchCustomerEmailTrigger } from '../../communications/app/customerEmailTriggerService.js';
import { appendClaimEvent } from '../domain/commands/shared.js';
import { resolvePublicAppBaseUrlFromTenant } from '../../../platform/http/publicAppLinks.js';

type ServiceError = { ok: false; status: number; code: string; message: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstEmail(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? String(m[0]).trim() : '';
}

export async function createClaimInfoRequest(args: {
  claimId: string;
  message: string;
  requestedByUserId: string;
  requestedByName?: string;
}): Promise<{ ok: true; data: unknown } | ServiceError> {
  const claim = await tenantScopedPrisma.claim.findUnique({
    where: { id: args.claimId },
    include: { policy: { include: { policyHolder: true } } },
  });
  if (!claim) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Claim not found' };
  }
  const claimData = asRecord(claim.data);
  const caseIntakeDraft = asRecord(claimData.caseIntakeDraft);
  const recipientEmail = firstEmail(caseIntakeDraft.contactEmail) || firstEmail(claim.policy?.policyHolder?.contact);
  const isUnknownPolicyCase = !claim.policyId;
  if (!recipientEmail) {
    return {
      ok: false,
      status: 409,
      code: 'CONTACT_EMAIL_REQUIRED',
      message: 'A contact email is required before requesting more information.',
    };
  }

  // Tenant-aware: invoked from BO endpoints inside the operating-tenant ALS
  // scope. Resolves to the operating tenant's `publicBaseUrl`.
  const appBase = resolvePublicAppBaseUrlFromTenant();
  let deliveryStatus: 'QUEUED' | 'FAILED' = 'QUEUED';
  let emailFailureReason = '';
  let emailResult: { messageId?: string; skipped?: boolean; reason?: string } = {};
  try {
    emailResult = await dispatchCustomerEmailTrigger({
      trigger: isUnknownPolicyCase ? 'CLAIMS_INFO_REQUEST_UNLINKED' : 'CLAIMS_INFO_REQUEST',
      entityType: 'CLAIM',
      entityId: claim.id,
      toEmail: recipientEmail,
      fromActor: args.requestedByUserId || 'system',
      variables: {
        customer: {
          firstName: (asText(caseIntakeDraft.contactName) || asText(claim.policy?.policyHolder?.name)).split(/\s+/)[0] || 'there',
        },
        claim: {
          message: args.message,
          url: isUnknownPolicyCase ? undefined : `${appBase}/claims/${encodeURIComponent(claim.id)}#overview`,
          referenceLine: claim.claimNumber ? `Claim reference: ${claim.claimNumber}` : '',
        },
      },
      idempotencySeed: `${claim.id}:${args.message}`,
    });
    if (emailResult.skipped) {
      deliveryStatus = 'FAILED';
      emailFailureReason = emailResult.reason || 'Failed to queue the information request email.';
    }
  } catch (error) {
    deliveryStatus = 'FAILED';
    emailFailureReason = error instanceof Error ? error.message : 'Failed to queue the information request email.';
  }

  const requestedAt = new Date();
  const created = await runTenantScopedTransaction(async (_tx) => {
    const tx = _tx as unknown as Prisma.TransactionClient;
    const infoRequest = await tx.claimInfoRequest.create({
      data: {
        claimId: args.claimId,
        status: 'OPEN',
        message: args.message,
        requestedByUserId: args.requestedByUserId,
        requestedAt,
      },
    });
    await appendClaimEvent({
      tx,
      claimId: claim.id,
      claimNumber: claim.claimNumber,
      command: 'REQUEST_CLAIM_INFO',
      eventType: 'CLAIM_INFO_REQUESTED',
      input: {
        actorType: 'USER',
        actorId: args.requestedByUserId || 'system',
        actorName: args.requestedByName || '',
      },
      payload: {
        occurredAt: requestedAt.toISOString(),
        requestId: infoRequest.id,
        message: args.message,
        recipient: recipientEmail,
        deliveryStatus,
        messageId: emailResult.messageId || '',
        failureReason: emailFailureReason || undefined,
      },
    });
    return infoRequest;
  });
  return {
    ok: true,
    data: {
      ...created,
      recipientEmail,
      deliveryStatus,
      messageId: emailResult.messageId || null,
      warning: emailFailureReason || null,
    },
  };
}

export async function respondToClaimInfoRequest(args: {
  claimId: string;
  requestId: string;
  message: string;
  documents?: Record<string, unknown>[];
  resolvedByUserId: string;
}): Promise<{ ok: true; data: unknown } | ServiceError> {
  const existing = await prisma.claimInfoRequest.findFirst({
    where: { id: args.requestId, claimId: args.claimId },
    select: { id: true },
  });
  if (!existing) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Info request not found' };
  }

  const updated = await prisma.claimInfoRequest.update({
    where: { id: args.requestId },
    data: {
      responseMessage: args.message,
      responseDocuments: (args.documents || []) as Prisma.InputJsonValue,
      respondedAt: new Date(),
      resolvedAt: new Date(),
      resolvedByUserId: args.resolvedByUserId,
      status: 'RESOLVED',
    },
  });
  return { ok: true, data: updated };
}
