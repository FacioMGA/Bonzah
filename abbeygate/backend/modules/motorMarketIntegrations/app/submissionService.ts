import { Prisma } from '@prisma/client';

import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import {
  type MotorMarketChannel,
  type MotorMarketConnector,
  type MotorMarketJson,
  type MotorMarketProvider,
  type MotorMarketSubmissionPayload,
  type MotorMarketSubmissionStatus,
  providerForChannel,
} from '../domain/types.js';
import { SpecPendingMotorMarketConnector } from '../infra/specPendingConnector.js';

export class MotorMarketIntegrationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'MotorMarketIntegrationError';
  }
}

type ActorInput = {
  actorId?: string | null;
  actorName?: string | null;
};

type SubmissionListFilters = {
  provider?: MotorMarketProvider;
  channel?: MotorMarketChannel;
  status?: MotorMarketSubmissionStatus;
  limit?: number;
};

type PreparePolicyInput = ActorInput & {
  policyId: string;
  riskTransactionId?: string | null;
};

type PrepareClaimInput = ActorInput & {
  claimId: string;
  channel: Extract<MotorMarketChannel, 'E_SEGURNET' | 'IDS_CIDS'>;
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;

const SEGURNET_CHECKLIST = [
  'FNM policy data integration pack',
  'e SEGURNET FNOL API/webservice pack',
  'IDS/CIDS claims webservice pack',
  'Test and production endpoints',
  'OpenAPI, Swagger, WSDL, XSD, JSON schema or file specs',
  'Certificates, OAuth, mTLS and IP allowlisting requirements',
  'Test credentials and production credential process',
  'Required policy, transaction, claim, document, photo and signature fields',
  'Acknowledgement messages, validation rules, error codes and duplicate rules',
  'Certification cases and production approval process',
  'Reconciliation and rejected transaction reports',
] as const;

function clampLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

function toMotorMarketJson(value: Prisma.JsonValue | null | undefined): MotorMarketJson | null {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as MotorMarketJson;
}

function specMissingPayload(channel: MotorMarketChannel): MotorMarketJson {
  return {
    channel,
    missingExternalRequirements: [...SEGURNET_CHECKLIST],
    liveTransmissionEnabled: false,
  };
}

function nullableJson(value: MotorMarketJson | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function assertPortugalMotorPolicy(policy: {
  productType: string | null;
  operatingTenant: { countryCode: string | null } | null;
}): void {
  const productType = String(policy.productType || '').toUpperCase();
  const countryCode = String(policy.operatingTenant?.countryCode || '').toUpperCase();
  if (productType !== 'MOTOR' || countryCode !== 'PT') {
    throw new MotorMarketIntegrationError(
      400,
      'PORTUGAL_MOTOR_POLICY_REQUIRED',
      'Segurnet submissions are limited to Portugal Motor policies and claims',
    );
  }
}

export class MotorMarketSubmissionService {
  constructor(private readonly connector: MotorMarketConnector = new SpecPendingMotorMarketConnector()) {}

  checklist() {
    return {
      status: 'BLOCKED_WAITING_FOR_EXTERNAL_SPEC',
      items: SEGURNET_CHECKLIST.map((label) => ({ label, received: false })),
    };
  }

  async listSubmissions(filters: SubmissionListFilters) {
    const rows = await tenantScopedPrisma.motorMarketSubmission.findMany({
      where: {
        ...(filters.provider ? { provider: filters.provider } : {}),
        ...(filters.channel ? { channel: filters.channel } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: {
        attempts: { orderBy: { attemptedAt: 'desc' }, take: 3 },
      },
      orderBy: { updatedAt: 'desc' },
      take: clampLimit(filters.limit),
    });
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      channel: row.channel,
      status: row.status,
      policyId: row.policyId,
      claimId: row.claimId,
      riskTransactionId: row.riskTransactionId,
      externalReference: row.externalReference,
      lastErrorCode: row.lastErrorCode,
      lastErrorMessage: row.lastErrorMessage,
      attemptCount: row.attemptCount,
      nextRetryAt: row.nextRetryAt?.toISOString() || null,
      updatedAt: row.updatedAt.toISOString(),
      attempts: row.attempts.map((attempt) => ({
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        errorCode: attempt.errorCode,
        errorMessage: attempt.errorMessage,
        attemptedAt: attempt.attemptedAt.toISOString(),
      })),
    }));
  }

  async reconciliation() {
    const statuses: MotorMarketSubmissionStatus[] = [
      'DRAFT',
      'QUEUED',
      'SUBMITTED',
      'ACCEPTED',
      'REJECTED',
      'RETRYABLE_FAILURE',
      'TERMINAL_FAILURE',
      'BLOCKED_WAITING_FOR_EXTERNAL_SPEC',
    ];
    const rows = await Promise.all(statuses.map(async (status) => ({
      status,
      count: await tenantScopedPrisma.motorMarketSubmission.count({ where: { status } }),
    })));
    return { statuses: rows };
  }

  async preparePolicySubmission(input: PreparePolicyInput) {
    const policy = await tenantScopedPrisma.policy.findUnique({
      where: { id: input.policyId },
      include: {
        policyHolder: true,
        operatingTenant: { select: { countryCode: true } },
        program: true,
        binder: true,
        riskTransactions: {
          orderBy: { transactionNumber: 'desc' },
          take: 1,
        },
      },
    });
    if (!policy) throw new MotorMarketIntegrationError(404, 'POLICY_NOT_FOUND', 'Policy not found');
    assertPortugalMotorPolicy(policy);
    const selectedRiskTransaction = input.riskTransactionId
      ? await tenantScopedPrisma.riskTransaction.findFirst({ where: { id: input.riskTransactionId, policyId: policy.id } })
      : policy.riskTransactions[0] || null;
    const payload: MotorMarketSubmissionPayload = {
      source: 'Policy',
      purpose: 'Segurnet FNM policy/contract submission draft',
      policy: {
        id: policy.id,
        policyNumber: policy.policyNumber,
        productType: policy.productType,
        status: policy.status,
        inceptionDate: policy.inceptionDate.toISOString(),
        expiryDate: policy.expiryDate.toISOString(),
        policyHolderName: policy.policyHolder.name,
        programId: policy.programId,
        binderId: policy.binderId,
      },
      riskTransaction: selectedRiskTransaction ? {
        id: selectedRiskTransaction.id,
        transactionNumber: selectedRiskTransaction.transactionNumber,
        transactionType: selectedRiskTransaction.transactionType,
        status: selectedRiskTransaction.status,
        effectiveDate: selectedRiskTransaction.effectiveDate.toISOString(),
        snapshotFinal: toMotorMarketJson(selectedRiskTransaction.snapshotFinal),
        pricingFinal: toMotorMarketJson(selectedRiskTransaction.pricingFinal),
      } : null,
      specGate: specMissingPayload('SEGURNET_FNM'),
    };
    return this.prepareSubmission({
      provider: 'SEGURNET',
      channel: 'SEGURNET_FNM',
      policyId: policy.id,
      riskTransactionId: selectedRiskTransaction?.id || null,
      claimId: null,
      idempotencyKey: `segurnet:fnm:policy:${policy.id}:risk:${selectedRiskTransaction?.id || 'current'}`,
      payload,
      actorId: input.actorId,
      actorName: input.actorName,
    });
  }

  async prepareClaimSubmission(input: PrepareClaimInput) {
    const claim = await tenantScopedPrisma.claim.findUnique({
      where: { id: input.claimId },
      include: {
        policy: {
          include: {
            policyHolder: true,
            operatingTenant: { select: { countryCode: true } },
          },
        },
      },
    });
    if (!claim) throw new MotorMarketIntegrationError(404, 'CLAIM_NOT_FOUND', 'Claim not found');
    if (!claim.policy) {
      throw new MotorMarketIntegrationError(400, 'PORTUGAL_MOTOR_POLICY_REQUIRED', 'Segurnet claims require a linked Portugal Motor policy');
    }
    assertPortugalMotorPolicy(claim.policy);
    const provider = providerForChannel(input.channel);
    const payload: MotorMarketSubmissionPayload = {
      source: 'Claim',
      purpose: input.channel === 'E_SEGURNET'
        ? 'e SEGURNET FNOL / DAAA notification draft'
        : 'Segurnet IDS/CIDS claims message draft',
      claim: {
        id: claim.id,
        claimNumber: claim.claimNumber,
        status: claim.status,
        claimType: claim.claimType,
        incidentDate: claim.incidentDate.toISOString(),
        reportedDate: claim.reportedDate.toISOString(),
        data: toMotorMarketJson(claim.data),
      },
      policy: claim.policy ? {
        id: claim.policy.id,
        policyNumber: claim.policy.policyNumber,
        productType: claim.policy.productType,
        policyHolderName: claim.policy.policyHolder.name,
      } : null,
      specGate: specMissingPayload(input.channel),
    };
    return this.prepareSubmission({
      provider,
      channel: input.channel,
      policyId: claim.policyId || null,
      claimId: claim.id,
      riskTransactionId: null,
      idempotencyKey: `segurnet:${input.channel.toLowerCase()}:claim:${claim.id}`,
      payload,
      actorId: input.actorId,
      actorName: input.actorName,
    });
  }

  async retrySubmission(id: string, actor: ActorInput = {}) {
    const submission = await tenantScopedPrisma.motorMarketSubmission.findUnique({ where: { id } });
    if (!submission) throw new MotorMarketIntegrationError(404, 'SUBMISSION_NOT_FOUND', 'Submission not found');
    const result = await this.connector.submit({
      submissionId: submission.id,
      provider: submission.provider as MotorMarketProvider,
      channel: submission.channel as MotorMarketChannel,
      idempotencyKey: submission.idempotencyKey,
      payload: (submission.requestPayload || {}) as MotorMarketSubmissionPayload,
    });
    return this.recordAttempt(submission.id, result, actor);
  }

  private async prepareSubmission(input: {
    provider: MotorMarketProvider;
    channel: MotorMarketChannel;
    policyId: string | null;
    claimId: string | null;
    riskTransactionId: string | null;
    idempotencyKey: string;
    payload: MotorMarketSubmissionPayload;
  } & ActorInput) {
    const tenantId = getTenantConfig().id;
    const data: WithoutTenantScope<Prisma.MotorMarketSubmissionUncheckedCreateInput> = {
      provider: input.provider,
      channel: input.channel,
      status: 'DRAFT',
      policyId: input.policyId,
      claimId: input.claimId,
      riskTransactionId: input.riskTransactionId,
      idempotencyKey: input.idempotencyKey,
      requestPayload: input.payload as Prisma.InputJsonValue,
      createdByUserId: input.actorId || null,
    };
    const submission = await tenantScopedPrisma.motorMarketSubmission.upsert({
      where: { operatingTenantId_idempotencyKey: { operatingTenantId: tenantId, idempotencyKey: input.idempotencyKey } },
      create: data as Prisma.MotorMarketSubmissionUncheckedCreateInput,
      update: {
        requestPayload: input.payload as Prisma.InputJsonValue,
        status: 'DRAFT',
        policyId: input.policyId,
        claimId: input.claimId,
        riskTransactionId: input.riskTransactionId,
        lastErrorCode: null,
        lastErrorMessage: null,
        latestResponse: Prisma.JsonNull,
      },
    });
    await AuditLogger.log(
      submission.id,
      'OPERATOR_ACTION',
      'MOTOR_MARKET.SUBMISSION_PREPARED',
      input.actorId || 'system',
      input.actorId ? 'USER' : 'SYSTEM',
      {
        provider: input.provider,
        channel: input.channel,
        policyId: input.policyId,
        claimId: input.claimId,
        status: submission.status,
      },
      input.actorName || undefined,
    );
    return this.retrySubmission(submission.id, input);
  }

  private async recordAttempt(
    submissionId: string,
    result: {
      status: MotorMarketSubmissionStatus;
      externalReference?: string | null;
      responsePayload?: MotorMarketJson | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
    actor: ActorInput,
  ) {
    const current = await tenantScopedPrisma.motorMarketSubmission.findUnique({ where: { id: submissionId } });
    if (!current) throw new MotorMarketIntegrationError(404, 'SUBMISSION_NOT_FOUND', 'Submission not found');
    const attemptNumber = current.attemptCount + 1;
    const attemptData: WithoutTenantScope<Prisma.MotorMarketSubmissionAttemptUncheckedCreateInput> = {
      submissionId,
      attemptNumber,
      status: result.status,
      requestPayload: (current.requestPayload || {}) as Prisma.InputJsonValue,
      responsePayload: nullableJson(result.responsePayload || null),
      externalReference: result.externalReference || null,
      errorCode: result.errorCode || null,
      errorMessage: result.errorMessage || null,
    };
    const attempt = await tenantScopedPrisma.motorMarketSubmissionAttempt.create({
      data: attemptData as Prisma.MotorMarketSubmissionAttemptUncheckedCreateInput,
    });
    const updated = await tenantScopedPrisma.motorMarketSubmission.update({
      where: { id: submissionId },
      data: {
        status: result.status,
        externalReference: result.externalReference || current.externalReference,
        latestResponse: nullableJson(result.responsePayload || null),
        lastErrorCode: result.errorCode || null,
        lastErrorMessage: result.errorMessage || null,
        attemptCount: attemptNumber,
        submittedAt: result.status === 'SUBMITTED' ? new Date() : current.submittedAt,
        acceptedAt: result.status === 'ACCEPTED' ? new Date() : current.acceptedAt,
        rejectedAt: result.status === 'REJECTED' ? new Date() : current.rejectedAt,
      },
    });
    await AuditLogger.log(
      submissionId,
      'OPERATOR_ACTION',
      'MOTOR_MARKET.SUBMISSION_ATTEMPTED',
      actor.actorId || 'system',
      actor.actorId ? 'USER' : 'SYSTEM',
      {
        provider: updated.provider,
        channel: updated.channel,
        status: updated.status,
        attemptNumber,
        errorCode: result.errorCode || null,
      },
      actor.actorName || undefined,
    );
    return { submission: updated, attempt };
  }
}

export const motorMarketSubmissionService = new MotorMarketSubmissionService();
