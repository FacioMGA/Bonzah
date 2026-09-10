import { Job } from 'bullmq';
import { z } from 'zod';
import {
  enqueueCardcorpPaidIssuanceReconciliationContinuation,
  reconcileCardcorpPaidIssuanceBatch,
} from '../../modules/payments/app/cardcorpIssuanceHealService.js';
import { runWithOperatingTenantById } from '../../platform/tenant/tenantJobContext.js';
import { registerHandler, JobHandler } from '../index.js';

const DataSchema = z.object({
  operatingTenantId: z.string().uuid('POLICY.ISSUED_PACK_RECONCILE missing operatingTenantId'),
  limit: z.coerce.number().int().positive().max(500).optional(),
  cursor: z.object({
    updatedAt: z.string().datetime(),
    id: z.string().uuid(),
  }).optional(),
  // The initial scheduled event uses its envelope id as the sweep id. Every
  // continuation carries that same id so retries dedupe within one sweep but
  // a later scheduled sweep may revisit an unresolved candidate.
  sweepId: z.string().min(1).optional(),
});

const EnvelopeSchema = z.object({
  eventId: z.string().min(1),
  data: DataSchema.optional(),
});

type IssuedPackReconcileData = {
  operatingTenantId: string;
  limit?: number;
  cursor?: { updatedAt: string; id: string };
  sweepId?: string;
};

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), 500) : undefined;
}

// Reconciliation runs outside HTTP. Its envelope carries the tenant selected
// by the scheduler, so every page and continuation stays inside one explicit
// operating-tenant context rather than relying on a deployment default.
export async function runIssuedPackReconcile(jobData: unknown): Promise<void> {
  const envelope = EnvelopeSchema.parse(jobData);
  const data = DataSchema.parse(envelope.data) as IssuedPackReconcileData;
  const limit = data.limit ?? envInt('POLICY_ISSUED_PACK_RECONCILE_LIMIT') ?? 100;
  const sweepId = data.sweepId ?? envelope.eventId;

  await runWithOperatingTenantById(data.operatingTenantId, async () => {
    const result = await reconcileCardcorpPaidIssuanceBatch(
      limit,
      data.cursor ? { updatedAt: new Date(data.cursor.updatedAt), id: data.cursor.id } : undefined,
    );
    if (result.nextCursor) {
      await enqueueCardcorpPaidIssuanceReconciliationContinuation({
        cursor: result.nextCursor,
        limit,
        sweepId,
        operatingTenantId: data.operatingTenantId,
        correlationId: envelope.eventId,
      });
    }
  });
}

export const handleIssuedPackReconcile: JobHandler = async (job: Job) =>
  runIssuedPackReconcile(job.data);

registerHandler('POLICY.ISSUED_PACK_RECONCILE', handleIssuedPackReconcile);
