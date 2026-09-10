import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { executeBindCoverage, type BindCoverageActor } from './BindCoverage.js';
import { executeIssuePolicy, type IssuePolicyActor } from './IssuePolicy.js';
import { resolveMappedProgramDefinition } from '../../programs/app/activeProgramDefinition.js';

export type ExternalIssuedDocumentInput = {
  type: string;
  storageUri: string;
  filename: string;
  fileHash: string;
};

export type CompleteExternalIssuanceResult =
  | { status: 'SUCCESS'; data: { policyStatus: string; riskTransactionId: string; documentIds: string[]; idempotent: boolean } }
  | { status: 'NOT_FOUND' | 'INVALID_STATUS' | 'VALIDATION_ERROR' | 'BLOCKED' | 'SERVER_ERROR' | 'UNAUTHORIZED' | 'MISSING_TRANSACTION'; error: unknown };

function normalizedTypes(documents: ExternalIssuedDocumentInput[]): string[] {
  return documents.map((document) => String(document.type || '').trim()).filter(Boolean);
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function asRecord(value: unknown): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Prisma.JsonObject : {};
}

/**
 * ADR-0096 canonical completion command for externally-issued Open Market
 * policies. The normal bind and issue use cases remain the only owners of
 * sanctions, issue-readiness and lifecycle transitions; this command supplies
 * the external issued pack between those two canonical stages.
 */
export async function completeExternalIssuance(input: {
  policyId: string;
  actor: IssuePolicyActor & BindCoverageActor;
  documents: ExternalIssuedDocumentInput[];
  correlationId?: string;
}): Promise<CompleteExternalIssuanceResult> {
  const policyId = String(input.policyId || '').trim();
  if (!policyId) return { status: 'VALIDATION_ERROR', error: { code: 'POLICY_ID_REQUIRED', message: 'policyId is required' } };

  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      status: true,
      productType: true,
      programId: true,
      binderId: true,
      operatingTenantId: true,
    },
  });
  if (!policy) return { status: 'NOT_FOUND', error: { code: 'NOT_FOUND', message: 'Policy not found' } };

  const productType = String(policy.productType || '').trim().toUpperCase();
  const binderProductAuthority = policy.binderId && productType
    ? await tenantScopedPrisma.binderProductAuthority.findUnique({
      where: { binderId_productCode: { binderId: policy.binderId, productCode: productType } },
      select: { id: true },
    })
    : null;
  if (!policy.programId || !binderProductAuthority) {
    return {
      status: 'BLOCKED',
      error: { code: 'PROGRAM_AUTHORITY_REQUIRED', message: 'External issuance requires a policy programme and active binder authority.' },
    };
  }
  const programDefinition = await resolveMappedProgramDefinition({
    programId: policy.programId,
    binderProductAuthorityId: binderProductAuthority.id,
  });
  const workflowDefinition = asRecord(programDefinition.workflow);
  if (workflowDefinition.referralOnly === true) {
    return {
      status: 'BLOCKED',
      error: {
        code: 'REFERRAL_ONLY_PROGRAM',
        message: 'This referral-only program cannot be completed as an issued policy.',
      },
    };
  }

  const externalIssuance = asRecord(workflowDefinition.externalIssuance);
  if (externalIssuance.mode !== 'manager_upload_after_payment') {
    return {
      status: 'INVALID_STATUS',
      error: { code: 'EXTERNAL_ISSUANCE_NOT_CONFIGURED', message: 'This product is not configured for manager-issued external documents.' },
    };
  }

  const suppliedTypes = normalizedTypes(input.documents);
  const requiredTypes = Array.isArray(externalIssuance.documentTypes)
    ? externalIssuance.documentTypes.map((type) => String(type).trim()).filter(Boolean)
    : [];
  if (requiredTypes.length === 0) {
    return {
      status: 'BLOCKED',
      error: { code: 'EXTERNAL_ISSUANCE_DOCUMENT_TYPES_REQUIRED', message: 'The published external issuance workflow has no document types.' },
    };
  }
  const suppliedUnique = Array.from(new Set(suppliedTypes));
  const policyStatus = String(policy.status || '').trim().toUpperCase();
  const existingDocuments = await tenantScopedPrisma.document.findMany({
    where: {
      policyId,
      docPack: 'ISSUED_POLICY_PACK',
      status: 'GENERATED',
      type: { in: requiredTypes },
    },
    select: { id: true, type: true, riskTransactionId: true },
  });
  const existingTypes = Array.from(new Set(existingDocuments.map((document) => String(document.type || '').trim()).filter(Boolean)));
  const existingPackComplete = sameSet(existingTypes.sort(), [...requiredTypes].sort());

  if (!existingPackComplete && (
    input.documents.length !== suppliedTypes.length ||
    suppliedUnique.length !== suppliedTypes.length ||
    !sameSet(suppliedUnique.sort(), [...requiredTypes].sort()) ||
    input.documents.some((document) => !String(document.storageUri || '').startsWith('/api/documents/') || !String(document.filename || '').trim() || !String(document.fileHash || '').trim())
  )) {
    return {
      status: 'VALIDATION_ERROR',
      error: {
        code: 'EXTERNAL_ISSUED_DOCUMENTS_INVALID',
        message: 'Upload exactly the configured external issued-document pack as PDF files before activating this policy.',
        requiredDocumentTypes: requiredTypes,
      },
    };
  }

  if (['ACTIVE', 'ISSUED'].includes(policyStatus)) {
    if (!existingPackComplete) {
      return {
        status: 'INVALID_STATUS',
        error: { code: 'EXTERNAL_ISSUANCE_EVIDENCE_MISSING', message: 'An active policy is missing its required external issued-document evidence.' },
      };
    }
    const riskTransactionId = String(existingDocuments[0]?.riskTransactionId || '').trim();
    if (!riskTransactionId) {
      return {
        status: 'INVALID_STATUS',
        error: { code: 'EXTERNAL_ISSUANCE_TRANSACTION_MISSING', message: 'The external issued-document pack has no bound policy transaction.' },
      };
    }
    return {
      status: 'SUCCESS',
      data: { policyStatus, riskTransactionId, documentIds: existingDocuments.map((document) => document.id), idempotent: true },
    };
  }

  let riskTransactionId = String(existingDocuments[0]?.riskTransactionId || '').trim();
  if (policyStatus === 'AWAITING_EXTERNAL_ISSUANCE') {
    const bound = await executeBindCoverage({
      policyId,
      actor: input.actor,
      correlationId: input.correlationId,
      externalIssuanceCompletion: true,
    });
    if (bound.status !== 'SUCCESS') return { status: bound.status, error: bound.error };
    riskTransactionId = bound.data.riskTransactionId;
  } else if (policyStatus === 'BOUND') {
    const bound = await tenantScopedPrisma.riskTransaction.findFirst({
      where: { policyId, transactionType: 'INCEPTION', status: 'BOUND' },
      orderBy: { transactionNumber: 'desc' },
      select: { id: true },
    });
    riskTransactionId = String(bound?.id || '').trim();
    if (!riskTransactionId) {
      return {
        status: 'INVALID_STATUS',
        error: { code: 'EXTERNAL_ISSUANCE_TRANSACTION_MISSING', message: 'No bound inception transaction is available for the external issued documents.' },
      };
    }
  } else {
    return {
      status: 'INVALID_STATUS',
      error: { code: 'INVALID_STATUS', message: `External issuance cannot be completed from status '${policy.status}'.` },
    };
  }

  let documentIds = existingDocuments.map((document) => document.id);
  if (!existingPackComplete) {
    if (existingDocuments.length > 0) {
      return {
        status: 'BLOCKED',
        error: { code: 'EXTERNAL_ISSUED_DOCUMENT_PACK_INCOMPLETE', message: 'A partial external issued-document pack exists and must be resolved before activation.' },
      };
    }
    const createdDocuments = await runTenantScopedTransaction(async (tx) => {
      const documents = [] as Array<{ id: string }>;
      for (const document of input.documents) {
        const created = await tx.document.create({
          data: {
            operatingTenantId: policy.operatingTenantId,
            policyId,
            riskTransactionId,
            type: document.type,
            docPack: 'ISSUED_POLICY_PACK',
            version: 1,
            status: 'GENERATED',
            generatedByUserId: input.actor.id || null,
            source: 'BO',
            generatedAt: new Date(),
            storageUri: document.storageUri,
            filename: document.filename,
            fileHash: document.fileHash,
          } satisfies Prisma.DocumentUncheckedCreateInput,
          select: { id: true },
        });
        documents.push(created);
      }
      return documents;
    });
    documentIds = createdDocuments.map((document) => document.id);
  }

  const issued = await executeIssuePolicy({
    policyId,
    actor: input.actor,
    correlationId: input.correlationId,
    suppressIssuedPack: true,
    externalDocumentEmail: { documentIds },
  });
  if (issued.status !== 'SUCCESS') return { status: issued.status, error: issued.error };

  void AuditLogger.log(
    policyId,
    'POLICY',
    'POLICY.UPDATED',
    input.actor.id || 'system',
    'USER',
    { riskTransactionId, documentIds },
    input.actor.name || undefined,
  );
  return {
    status: 'SUCCESS',
    data: {
      policyStatus: issued.data.status,
      riskTransactionId,
      documentIds,
      idempotent: false,
    },
  };
}
