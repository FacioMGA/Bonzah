/**
 * CLAIM_MEMORY.REFRESH — async refresh worker for the Claim Memory
 * projection (ADR-0041).
 *
 * Dispatched by:
 *   - the outbox relay when `CommunicationMessage` insert hooks emit a
 *     `CLAIM_MEMORY.REFRESH` envelope (Week 1 wires the BO route + MCP
 *     tool; the email-arrival hook lands in Week 2 alongside Neo4j infra);
 *   - the BO `POST /api/claims/:id/memory/refresh` route via
 *     `enqueueClaimMemoryRefresh`;
 *   - the nightly backfill CronJob (Week 3).
 *
 * Idempotent + debounced: BullMQ jobId = `claim:<claimId>` + 60-second
 * debounce so ten emails on one thread coalesce into one refresh.
 *
 * Wrapped in `runWithClaimOperatingTenant` so every `tenantScopedPrisma`
 * write inside the orchestrator satisfies the fail-closed extension
 * (ADR-0019).
 */

import { Job } from 'bullmq';
import { z } from 'zod';
import { refreshClaimMemoryUseCase, type RefreshReason } from '../../modules/claims/app/mailgraph/refreshClaimMemoryUseCase.js';
import { runWithClaimOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { registerHandler, JobHandler } from '../index.js';

const DataSchema = z.object({
  claimId: z.string().min(1, 'CLAIM_MEMORY.REFRESH missing envelope.data.claimId'),
  reason: z
    .enum(['email_arrived', 'manual_refresh', 'backfill', 'mcp_tool', 'bo_route'])
    .default('email_arrived'),
  actorId: z.string().optional(),
  actorName: z.string().optional(),
  actorType: z.enum(['USER', 'SYSTEM']).optional(),
});

// Two enqueue shapes are supported: the outbox-relay path produces an
// envelope (`{ data: {...} }`); direct `queue.add` calls from MCP /
// HTTP can pass the data object verbatim.  Both shapes pass through
// the same handler so callers can choose either.
const EnvelopeSchema = z.union([z.object({ data: DataSchema }), DataSchema]);

function extractData(jobData: unknown) {
  const parsed = EnvelopeSchema.parse(jobData);
  return 'data' in parsed ? parsed.data : parsed;
}

export const handleClaimMemoryRefresh: JobHandler = async (job: Job) => {
  const data = extractData(job.data);
  await runWithClaimOperatingTenant(data.claimId, () =>
    refreshClaimMemoryUseCase({
      claimId: data.claimId,
      reason: data.reason as RefreshReason,
      actorId: data.actorId,
      actorName: data.actorName,
      actorType: data.actorType,
    }),
  );
};

registerHandler('CLAIM_MEMORY.REFRESH', handleClaimMemoryRefresh);
