import { prisma, tenantScopedPrisma } from '../../../../platform/db/connection.js';
import type { JsonObject } from '../../../../platform/types/json.js';
import { ISSUANCE_TRANSACTION_TYPES } from '../../domain/riskTransactionTypes.js';
import { latestTermOrderBy } from '../../app/policyTermFamily.js';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function findPolicyForIssueReadiness(policyId: string) {
  return isUuid(policyId)
    ? tenantScopedPrisma.policy.findUnique({
      where: { id: policyId },
      include: {
        payments: { orderBy: { createdAt: 'desc' } },
        stateCurrent: true,
      },
    })
    : tenantScopedPrisma.policy.findFirst({
      where: { policyNumber: policyId },
      orderBy: latestTermOrderBy(),
      include: {
        payments: { orderBy: { createdAt: 'desc' } },
        stateCurrent: true,
      },
    });
}

// Loads the program + binder + matching binder-product authority
// for the policy. Used by `evaluateIssueReadiness` to gate issuance
// on lifecycle status + the `[effectiveFrom, effectiveTo]` window.
// Returns nulls for any leg that the policy has not bound yet.
export async function findAuthorityWindowContext(policyId: string, productCode: string | null) {
  if (!isUuid(policyId)) return null;
  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      programId: true,
      binderId: true,
      inceptionDate: true,
      stateCurrent: { select: { snapshot: true } },
    },
  });
  if (!policy) return null;
  const [program, binder, binderAuthority] = await Promise.all([
    policy.programId
      ? tenantScopedPrisma.program.findUnique({
        where: { id: policy.programId },
        select: { id: true, status: true, effectiveFrom: true, effectiveTo: true, name: true },
      })
      : Promise.resolve(null),
    policy.binderId
      ? tenantScopedPrisma.binder.findUnique({
        where: { id: policy.binderId },
        select: { id: true, status: true, startDate: true, endDate: true, agreementNumber: true },
      })
      : Promise.resolve(null),
    policy.binderId && productCode
      ? tenantScopedPrisma.binderProductAuthority.findFirst({
        where: { binderId: policy.binderId, productCode },
        select: {
          id: true, productCode: true, status: true, classOfBusiness: true, riskCode: true,
          territorialScope: true, maxPremiumAnnual: true, maxPolicyPeriodDays: true,
          maxAdvanceInceptionDays: true, authorityClasses: true, effectiveFrom: true, effectiveTo: true,
        },
      })
      : Promise.resolve(null),
  ]);
  const programDefinition = policy.programId && binderAuthority?.id
    ? await tenantScopedPrisma.binderProductAuthorityProgramDefinition.findUnique({
      where: { binderProductAuthorityId: binderAuthority.id },
      select: {
        programDefinitionVersion: {
          select: {
            id: true, programId: true, version: true, status: true, pricingMode: true,
            underwriting: true, coverage: true, questionnaire: true, workflow: true, channels: true, documents: true,
            programRatingModel: { select: { id: true, programId: true, version: true, stages: true, tables: true } },
          },
        },
      },
    })
    : null;
  const definition = programDefinition?.programDefinitionVersion;
  if (definition && (definition.programId !== policy.programId || definition.status !== 'PUBLISHED')) {
    throw new Error('Issue readiness requires a published programme definition mapped to the policy authority.');
  }
  return {
    policy, program, binder, binderAuthority,
    programDefinition: definition ? {
      id: definition.id,
      programId: definition.programId,
      version: definition.version,
      pricingMode: definition.pricingMode as 'AUTOMATED' | 'MANUAL',
      underwriting: definition.underwriting,
      coverage: definition.coverage,
      questionnaire: definition.questionnaire,
      workflow: definition.workflow,
      channels: definition.channels,
      documents: definition.documents,
      ratingModel: definition.programRatingModel ? {
        id: definition.programRatingModel.id,
        programId: definition.programRatingModel.programId,
        version: definition.programRatingModel.version,
        stages: definition.programRatingModel.stages as JsonObject[],
        tables: definition.programRatingModel.tables as JsonObject,
      } : null,
    } : null,
  };
}

export async function findBoundInceptionTransaction(policyId: string) {
  return tenantScopedPrisma.riskTransaction.findFirst({
    where: { policyId, transactionType: { in: [...ISSUANCE_TRANSACTION_TYPES] }, status: 'BOUND' },
    orderBy: { transactionNumber: 'desc' },
    select: { id: true },
  });
}

export async function findGeneratedIssuedDocuments(policyId: string, requiredIssuedDocTypes: string[]) {
  return tenantScopedPrisma.document.findMany({
    where: {
      policyId,
      docPack: 'ISSUED_POLICY_PACK',
      status: 'GENERATED',
      type: { in: requiredIssuedDocTypes },
    },
    select: { type: true },
  });
}

/**
 * ADR-0017 — `customerOutcome: 'failed'` requires a temporal comparison
 * between the latest worker-side failure audit and the latest GENERATED
 * `ISSUED_POLICY_PACK` document for the policy. If a failure is newer
 * (or no docs exist at all), the outcome is `failed`. If a doc was
 * generated AFTER the failure, the worker recovered on a retry and we
 * remain in `pending`/`issued`.
 *
 * Returning the timestamps lets the evaluator make that decision
 * without pulling the whole document row.
 */
export async function findLatestGeneratedIssuedDocumentTimestamp(policyId: string) {
  const doc = await tenantScopedPrisma.document.findFirst({
    where: {
      policyId,
      docPack: 'ISSUED_POLICY_PACK',
      status: 'GENERATED',
    },
    orderBy: { generatedAt: 'desc' },
    select: { generatedAt: true, createdAt: true },
  });
  if (!doc) return null;
  return doc.generatedAt ?? doc.createdAt ?? null;
}

/**
 * ADR-0017 — finds the most recent worker-side issued-pack failure
 * audit event across both `ISSUED_PACK_*` types regardless of payment
 * (the worker may run before payment resolution in BO-issued flows).
 * Returns `null` when no failure has been recorded.
 */
export async function findLatestIssuedPackFailureEvent(policyId: string) {
  const event = await prisma.paymentEvent.findFirst({
    where: {
      eventType: { in: ['ISSUED_PACK_MISSING_DOC_TYPES', 'ISSUED_PACK_GENERATION_FAILED'] },
      payment: { policyId },
    },
    orderBy: { receivedAt: 'desc' },
    select: { eventType: true, receivedAt: true, payload: true },
  });
  if (!event) return null;
  return {
    eventType: event.eventType as 'ISSUED_PACK_MISSING_DOC_TYPES' | 'ISSUED_PACK_GENERATION_FAILED',
    receivedAt: event.receivedAt,
    payload: event.payload,
  };
}

export async function findLatestPaidPayment(policyId: string) {
  return tenantScopedPrisma.payment.findFirst({
    where: { policyId, provider: 'CARDCORP', status: 'PAID' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });
}

export async function findPaymentEvent(paymentId: string, eventType: string) {
  return prisma.paymentEvent.findFirst({
    where: { paymentId, eventType },
    select: { paymentId: true },
  });
}

export async function findLatestPaymentFailureEvent(paymentId: string, eventType: string) {
  return prisma.paymentEvent.findFirst({
    where: { paymentId, eventType },
    orderBy: { receivedAt: 'desc' },
    select: { receivedAt: true, payload: true },
  });
}

export async function findRiskTransactionContext(riskTransactionId: string, policyId: string) {
  return tenantScopedPrisma.riskTransaction.findFirst({
    where: { id: riskTransactionId, policyId },
    select: { id: true, status: true, transactionType: true, snapshotDraft: true, snapshotFinal: true },
  });
}
