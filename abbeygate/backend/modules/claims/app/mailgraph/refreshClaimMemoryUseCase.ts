/**
 * refreshClaimMemoryUseCase — orchestrator for the Claim Memory pipeline (ADR-0041).
 *
 * SOLE writer to `claim_memory_projections`.  All triggers — BullMQ
 * `CLAIM_MEMORY.REFRESH` worker, BO `POST /api/claims/:id/memory/refresh`
 * route, MCP `operator.refresh_claim_memory` tool — funnel through here.
 *
 * Pipeline (per ADR-0041 §2):
 *
 *   1. Resolve claim linkage          (`resolveClaimLinkage`)
 *   2. Load canonical claim context   (`loadClaimContext`)
 *   3. Normalize messages             (`normalizeThreads`)
 *   4. PII redaction                  (`redactThreads`)
 *   5+6. Extract events + entities    (`extractThreadAnalyses`)
 *   7. Aggregate ClaimMemoryObject    (`buildClaimMemoryObject`)
 *   8. Upsert Neo4j graph             (`upsertClaimGraph` — Week 2 stub)
 *   9. Run similarity queries         (`findSimilarClaims` — Week 2 stub)
 *  10. Save projection                (`saveClaimMemoryProjection`)
 *  11. Audit                          (`AuditLogger.log('CLAIM_MEMORY.REFRESHED', ...)`)
 *
 * Failure rules (ADR-0041 §2 step 8/9, §1):
 *   - Step 1 fails → return early with NOT_FOUND.
 *   - Steps 2-7 fail → exception bubbles; caller decides retry.
 *   - Step 8 fails (Neo4j down) → projection still written with
 *     refreshStatus='failed' + refreshError='neo4j_unavailable';
 *     previous similarClaims preserved.
 *   - Step 9 fails (Cypher errors) → identical to step 8 — projection
 *     written, previous enrichment preserved.
 *   - All other failures → projection marked 'failed', refreshError set.
 *
 * Idempotent per claim: BullMQ jobId = `claim:<claimId>` + 60s debounce,
 * the pipeline itself is replay-safe (deterministic input + UPSERT).
 */

import type { CommunicationMessage } from '@prisma/client';
import { logger } from '../../../../platform/utils/logger.js';
import { AuditLogger } from '../../../../platform/audit/logger.js';

function extractSenderDomain(message: CommunicationMessage): string | null {
  const fromActor = String(message.fromActor || '');
  const at = fromActor.indexOf('@');
  if (at >= 0) return fromActor.substring(at + 1).toLowerCase();
  return null;
}
import type { ClaimMemoryObject } from '../../domain/mailgraph/claimMemoryObject.js';
import { resolveClaimLinkage } from './resolveClaimLinkage.js';
import { loadClaimContext } from './loadClaimContext.js';
import { normalizeThreads } from './normalizeThreads.js';
import { redactThreads } from './redactPii.js';
import { extractThreadAnalyses } from './extractThreadAnalyses.js';
import { buildClaimMemoryObject } from './buildClaimMemoryObject.js';
import { upsertClaimGraph } from './upsertClaimGraph.js';
import { findSimilarClaims } from './findSimilarClaims.js';
import {
  findClaimMemory,
  markRefreshFailed,
  markRefreshing,
  saveClaimMemoryProjection,
} from '../../infra/mailgraph/claimMemoryProjectionRepo.js';

export type RefreshReason = 'email_arrived' | 'manual_refresh' | 'backfill' | 'mcp_tool' | 'bo_route';

export interface RefreshClaimMemoryInput {
  claimId: string;
  reason: RefreshReason;
  actorId?: string;
  actorName?: string;
  actorType?: 'USER' | 'SYSTEM';
}

export type RefreshClaimMemoryResult =
  | {
      ok: true;
      claimId: string;
      reason: RefreshReason;
      refreshStatus: 'fresh' | 'failed';
      eventCount: number;
      similarClaimsCount: number;
      graphAvailable: boolean;
      refreshDurationMs: number;
      refreshError?: string;
    }
  | {
      ok: false;
      claimId: string;
      reason: RefreshReason;
      code: 'CLAIM_NOT_FOUND' | 'CONTEXT_LOAD_FAILED' | 'UNEXPECTED';
      message: string;
    };

export async function refreshClaimMemoryUseCase(input: RefreshClaimMemoryInput): Promise<RefreshClaimMemoryResult> {
  const startedAt = Date.now();

  // Step 1 — resolve claim linkage (existence + tenant scope via tenantScopedPrisma).
  const linkage = await resolveClaimLinkage({ claimId: input.claimId });
  if (!linkage.ok) {
    return {
      ok: false,
      claimId: input.claimId,
      reason: input.reason,
      code: 'CLAIM_NOT_FOUND',
      message: `Claim ${input.claimId} not found in current tenant scope`,
    };
  }

  await markRefreshing(input.claimId);

  // Step 2 — load canonical context.
  const contextResult = await loadClaimContext({ claimId: input.claimId });
  if (!contextResult.ok) {
    await markRefreshFailed({ claimId: input.claimId, refreshError: 'context_load_failed' });
    return {
      ok: false,
      claimId: input.claimId,
      reason: input.reason,
      code: 'CONTEXT_LOAD_FAILED',
      message: contextResult.code,
    };
  }
  const { context } = contextResult;

  try {
    // Step 3 — normalize messages.
    const normalizedThreads = normalizeThreads(context.threads);
    // Step 4 — PII redaction.
    const redactedThreads = redactThreads(normalizedThreads);
    // Steps 5 + 6 — deterministic extraction (Week 1: regex-only; Week 2: + LLM).
    const threadAnalyses = await extractThreadAnalyses({ threads: redactedThreads });
    // Step 7 — aggregate.
    const memoryObject: ClaimMemoryObject = buildClaimMemoryObject({
      claim: context.claim,
      reserves: context.reserves,
      threadAnalyses,
    });

    // Step 8 — upsert Neo4j (Week 2: real driver; gracefully degrades
    // to projection-only when NEO4J_URI is unset or the driver is
    // unreachable).  The orchestrator passes thread + message metadata
    // so the graph repo can build the HAS_THREAD / HAS_MESSAGE edges
    // and link Event -> CITED_BY -> Message.
    const graphThreads = context.threads.map((thread) => ({
      threadId: thread.id,
      messages: thread.messages.map((message) => ({
        messageId: message.id,
        sentAt: (message.sentAt ?? message.createdAt).toISOString(),
        senderDomain: extractSenderDomain(message),
        channel: String(message.channel ?? 'EMAIL'),
      })),
    }));
    const graphResult = await upsertClaimGraph({
      tenantId: context.claim.operatingTenantId,
      claimId: context.claim.id,
      memoryObject,
      product: context.claim.claimType ?? context.policy?.productType ?? null,
      jurisdiction: context.claim.lossCountry ?? null,
      status: context.claim.status,
      threads: graphThreads,
    });

    // Step 9 — similarity queries (Week 1 stub → empty arrays).
    const similarity = await findSimilarClaims({
      tenantId: context.claim.operatingTenantId,
      claimId: context.claim.id,
    });

    // If Neo4j is unavailable we MUST preserve previously-computed
    // enrichment so the UI does not lose context on transient outages.
    let similarClaims = similarity.similarClaims;
    let graphSignals = similarity.graphSignals;
    if (!similarity.graphAvailable) {
      const existing = await findClaimMemory(context.claim.id);
      if (existing) {
        similarClaims = existing.similarClaims;
        graphSignals = existing.graphSignals;
      }
    }

    // Graph enrichment is OPTIONAL. A deployment that intentionally runs
    // without Neo4j (`neo4j_disabled`) is not a failure — the Postgres
    // memory is fully computed and fresh. Only a configured-but-unreachable
    // driver or a Cypher error degrades the projection to 'failed'.
    const graphDisabled = !graphResult.ok && graphResult.reason === 'neo4j_disabled';
    const refreshStatus: 'fresh' | 'failed' =
      similarity.graphAvailable || graphResult.ok || graphDisabled ? 'fresh' : 'failed';
    const refreshError = refreshStatus === 'failed' ? 'neo4j_unavailable' : null;

    // Step 10 — save projection.
    await saveClaimMemoryProjection({
      claimId: context.claim.id,
      memoryObject,
      similarClaims,
      graphSignals,
      refreshStatus,
      refreshError,
    });

    const refreshDurationMs = Date.now() - startedAt;

    // Step 11 — audit.
    void AuditLogger.log(
      context.claim.id,
      'CLAIM',
      refreshStatus === 'fresh' ? 'CLAIM_MEMORY.REFRESHED' : 'CLAIM_MEMORY.REFRESH_FAILED',
      input.actorId ?? 'claim-memory-worker',
      input.actorType ?? 'SYSTEM',
      {
        reason: input.reason,
        eventCount: memoryObject.timeline.length,
        missingInfoCount: memoryObject.missingInformation.length,
        authorityFlagCount: memoryObject.authorityFlags.length,
        similarClaimsCount: similarClaims.length,
        graphAvailable: similarity.graphAvailable,
        refreshDurationMs,
        refreshError: refreshError ?? undefined,
      },
      input.actorName,
    );

    return {
      ok: true,
      claimId: context.claim.id,
      reason: input.reason,
      refreshStatus,
      eventCount: memoryObject.timeline.length,
      similarClaimsCount: similarClaims.length,
      graphAvailable: similarity.graphAvailable,
      refreshDurationMs,
      refreshError: refreshError ?? undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, claimId: input.claimId, reason: input.reason }, 'claim_memory.refresh_unexpected');
    await markRefreshFailed({ claimId: input.claimId, refreshError: `unexpected:${message.slice(0, 200)}` });
    void AuditLogger.log(
      input.claimId,
      'CLAIM',
      'CLAIM_MEMORY.REFRESH_FAILED',
      input.actorId ?? 'claim-memory-worker',
      input.actorType ?? 'SYSTEM',
      { reason: input.reason, refreshError: message.slice(0, 500) },
      input.actorName,
    );
    return {
      ok: false,
      claimId: input.claimId,
      reason: input.reason,
      code: 'UNEXPECTED',
      message,
    };
  }
}
