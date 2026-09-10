import { z } from 'zod';
import { prisma } from '../../../../platform/db/connection.js';
import type { ToolDescriptor } from '../../../mcp/domain/toolDescriptor.js';
import type { McpContext } from '../../../mcp/domain/mcpContext.js';
import { buildOperatorActionContext } from '../../../operator/domain/operatorContext.js';
import type { OperatorSuccessEnvelope } from '../../../operator/domain/operatorEnvelope.js';
import { getClaimMemory } from './getClaimMemory.js';
import { enqueueClaimMemoryRefresh } from '../../infra/mailgraph/enqueueClaimMemoryRefresh.js';

const InputSchema = z
  .object({
    claimId: z.string().trim().min(1),
    limit: z.number().int().min(1).max(5).optional(),
    auto_refresh_if_stale: z.boolean().optional(),
  })
  .strict();

const OutputSchema = z.object({
  ok: z.boolean(),
  status: z.string(),
  action_id: z.string().optional(),
  correlation_id: z.string().optional(),
  summary: z.string(),
  entities: z.record(z.string(), z.string().optional()).optional(),
  next_actions: z.array(z.string()).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

async function run(input: Input, ctx: McpContext): Promise<Output> {
  const action = buildOperatorActionContext(ctx);
  const memory = await getClaimMemory({ claimId: input.claimId });

  if (!memory) {
    const envelope: OperatorSuccessEnvelope<{ status: 'absent' }> = {
      ok: true,
      status: 'completed',
      action_id: action.actionId,
      correlation_id: action.correlationId,
      summary: `Claim memory not computed for ${input.claimId} yet \u2014 no similar claims available.`,
      entities: { claimId: input.claimId },
      next_actions: ['operator.refresh_claim_memory'],
      extra: { status: 'absent' },
    };
    return envelope as unknown as Output;
  }

  // Auto-refresh when stale, per ADR-0041 §7.
  const shouldAutoRefresh = input.auto_refresh_if_stale !== false && memory.stalenessWarning;
  if (shouldAutoRefresh) {
    await enqueueClaimMemoryRefresh(prisma, {
      claimId: input.claimId,
      reason: 'mcp_tool',
      actorId: ctx.userId || 'mcp-operator',
      actorType: ctx.role === 'USER' ? 'USER' : 'SYSTEM',
      correlationId: action.correlationId,
    });
  }

  const limit = input.limit ?? 5;
  const similar = memory.projection.similarClaims.slice(0, limit);
  const graphSignals = memory.projection.graphSignals;

  const envelope: OperatorSuccessEnvelope<{
    similar_claims: unknown[];
    graph_signals: unknown;
    staleness_warning: boolean;
    auto_refresh_enqueued: boolean;
  }> = {
    ok: true,
    status: 'completed',
    action_id: action.actionId,
    correlation_id: action.correlationId,
    summary:
      similar.length === 0
        ? `No similar claims found for ${input.claimId}.${memory.stalenessWarning ? ' (Projection stale \u2014 refresh enqueued.)' : ''}`
        : `Found ${similar.length} similar claim(s) for ${input.claimId} (top match score: ${similar[0]?.score ?? 0}).${memory.stalenessWarning ? ' [STALE \u2014 refresh enqueued]' : ''}`,
    entities: { claimId: input.claimId },
    next_actions:
      similar.length > 0
        ? ['operator.get_claim_memory', 'operator.analyze_claim_memory']
        : ['operator.refresh_claim_memory'],
    extra: {
      similar_claims: similar,
      graph_signals: graphSignals,
      staleness_warning: memory.stalenessWarning,
      auto_refresh_enqueued: shouldAutoRefresh,
    },
  };
  return envelope as unknown as Output;
}

export const findSimilarClaimsTool: ToolDescriptor<Input, Output> = {
  name: 'operator.find_similar_claims',
  family: 'operator',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  requiredPermission: 'operator.read',
  description:
    'INTERNAL BACK-OFFICE TOOL for licensed Lloyd\u2019s MGA underwriters. Returns the cached similar-claims list for one claim in the current operating tenant: each entry includes a score, the matched reasons (SHARED_REPAIRER, SHARED_BROKER, SHARED_VEHICLE, SAME_MISSING_DOC_PATTERN, SAME_AUTHORITY_ESCALATION_PATTERN), and graph-derived counters. Reads from Postgres only. If the cached projection is older than TTL, the tool auto-enqueues a refresh and surfaces `staleness_warning: true` so the operator sees today\u2019s data while tomorrow\u2019s is computing. Required input: { "claimId": "<uuid>" }. Optional: { "limit": <1-5>, "auto_refresh_if_stale": <bool> }.',
  auditClass: 'read',
  run,
};
