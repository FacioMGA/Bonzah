import { z } from 'zod';
import { runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { parseImmutablePolicyDocumentConfiguration } from './productRegistryService.js';
import {
  buildIssuedPackEventIdFromIdempotencyKey,
  buildIssuedPackReplayIdempotencyKey,
  enqueueIssuedPolicyPack,
} from './commands/issuedPackEnqueue.js';

export const retryIssuedPolicyDocumentsInputSchema = z.object({ policyId: z.string().uuid() }).strict();

export class IssuedDocumentRetryError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** Trusted request context only. No actor, scope, snapshot, or retry key is accepted in the body. */
export type IssuedDocumentRetryActor = { id: string; role: string; permissions: readonly string[]; correlationId?: string };

const retryableStatuses = new Set(['BOUND', 'BOUND_DRAFT_ISSUED', 'ISSUING', 'ISSUED', 'ACTIVE']);

/** Replay the original issued pack from retained evidence; never re-rate or re-bind. */
export async function retryIssuedPolicyDocuments(
  input: z.infer<typeof retryIssuedPolicyDocumentsInputSchema>,
  actor: IssuedDocumentRetryActor,
  now = new Date(),
): Promise<{ status: 'queued'; eventId: string; riskTransactionId: string; replayed: boolean }> {
  const { policyId } = retryIssuedPolicyDocumentsInputSchema.parse(input);
  if (!actor.id || !['ADMIN', 'UNDERWRITER'].includes(actor.role.toUpperCase())
    || !['policies.view', 'documents.generate'].every((permission) => actor.permissions.includes(permission))) {
    throw new IssuedDocumentRetryError(403, 'FORBIDDEN', 'Issued document recovery requires policy access and document generation permission.');
  }
  if (!Number.isFinite(now.getTime())) throw new Error('Document retry requires a valid server time.');
  const operatingTenantId = getTenantConfig().id;
  return runTenantScopedTransaction(async (tx) => {
    // Lock the actual scoped policy as well as serialising retries. All reads
    // and the outbox write share this RLS transaction and its selected tenant.
    await tx.$queryRaw`SELECT id FROM policies WHERE id = ${policyId} AND "operatingTenantId" = ${operatingTenantId} FOR UPDATE`;
    const policy = await tx.policy.findFirst({
      where: { id: policyId, operatingTenantId },
      select: { id: true, status: true, productType: true, programId: true },
    });
    if (!policy) throw new IssuedDocumentRetryError(404, 'NOT_FOUND', 'Policy not found.');
    if (!retryableStatuses.has(policy.status.toUpperCase())) {
      throw new IssuedDocumentRetryError(409, 'INVALID_STATUS', 'Only a bound or issued policy can retry its original issued document pack.');
    }
    const risk = await tx.riskTransaction.findFirst({
      where: { policyId, operatingTenantId, transactionType: 'INCEPTION', status: { in: ['BOUND', 'PENDING_DOCS', 'ISSUED'] } },
      orderBy: { transactionNumber: 'desc' },
      select: { id: true, policyId: true, programId: true, snapshotFinal: true },
    });
    if (!risk) throw new IssuedDocumentRetryError(409, 'MISSING_BOUND_SNAPSHOT', 'No retained bound inception transaction is available. Recovery cannot use current quote data.');
    try {
      if (risk.policyId !== policy.id || risk.programId !== policy.programId) throw new Error('The retained transaction does not match this policy and programme.');
      const snapshot = z.object({ quoteData: z.record(z.string(), z.unknown()), quoteResponse: z.record(z.string(), z.unknown()) }).passthrough().parse(risk.snapshotFinal);
      if (!Object.keys(snapshot.quoteData).length || !Object.keys(snapshot.quoteResponse).length) throw new Error('The retained transaction requires its original quote data and quote response.');
      parseImmutablePolicyDocumentConfiguration({ productType: policy.productType || '', policyProgramId: policy.programId || '', snapshot: risk.snapshotFinal });
    } catch (error) {
      throw new IssuedDocumentRetryError(409, 'INVALID_BOUND_SNAPSHOT', `Issued document recovery is blocked: ${error instanceof Error ? error.message : 'retained decision evidence is invalid'}`);
    }
    // Separate namespace from normal issuance so a retry can never inherit a
    // welcome-email/lifecycle job. Repeated requests within 60s share one event.
    const idempotencyKey = `documents-only:${operatingTenantId}:${buildIssuedPackReplayIdempotencyKey({ policyId, riskTransactionId: risk.id, now, bucketSeconds: 60 })}`;
    const eventId = buildIssuedPackEventIdFromIdempotencyKey(idempotencyKey);
    const existing = await tx.outbox.findFirst({ where: { operatingTenantId, eventId }, select: { eventId: true } });
    if (existing) return { status: 'queued', eventId, riskTransactionId: risk.id, replayed: true };
    await enqueueIssuedPolicyPack(tx, {
      policyId, riskTransactionId: risk.id, source: 'BO', generatedByUserId: actor.id,
      correlationId: actor.correlationId, idempotencyKey, documentsOnly: true,
    });
    return { status: 'queued', eventId, riskTransactionId: risk.id, replayed: false };
  });
}
