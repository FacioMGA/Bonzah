import { z } from 'zod';
import type { ToolDescriptor } from '../../../mcp/domain/toolDescriptor.js';
import type { McpContext } from '../../../mcp/domain/mcpContext.js';
import { buildOperatorActionContext } from '../../../operator/domain/operatorContext.js';
import type { OperatorSuccessEnvelope } from '../../../operator/domain/operatorEnvelope.js';
import { getClaimMemory } from './getClaimMemory.js';

const InputSchema = z
  .object({
    claimId: z.string().trim().min(1),
    ttl_hours: z.number().int().min(1).max(72).optional(),
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
  const ttlMs = input.ttl_hours ? input.ttl_hours * 60 * 60 * 1000 : undefined;
  const memory = await getClaimMemory({ claimId: input.claimId, ttlMs });

  if (!memory) {
    const envelope: OperatorSuccessEnvelope<{
      status: 'absent';
      next_step: string;
    }> = {
      ok: true,
      status: 'completed',
      action_id: action.actionId,
      correlation_id: action.correlationId,
      summary: `Claim memory has not been computed for claim ${input.claimId} yet.`,
      entities: { claimId: input.claimId },
      next_actions: ['operator.refresh_claim_memory'],
      extra: { status: 'absent', next_step: 'Call operator.refresh_claim_memory then re-read.' },
    };
    return envelope as unknown as Output;
  }

  const envelope: OperatorSuccessEnvelope<{
    refresh_status: string;
    staleness_warning: boolean;
    last_refreshed_at: string | null;
    timeline_count: number;
    missing_information_count: number;
    authority_flag_count: number;
    similar_claims_count: number;
    memory: unknown;
    similar_claims: unknown;
    graph_signals: unknown;
  }> = {
    ok: true,
    status: 'completed',
    action_id: action.actionId,
    correlation_id: action.correlationId,
    summary:
      `Claim memory for ${input.claimId}: ${memory.projection.memoryObject.timeline?.length ?? 0} timeline events, ` +
      `${memory.projection.memoryObject.missingInformation?.length ?? 0} missing-doc rows, ` +
      `${memory.projection.memoryObject.authorityFlags?.length ?? 0} authority flag(s), ` +
      `${memory.projection.similarClaims.length} similar claim(s). ` +
      (memory.stalenessWarning ? '[stale — refresh recommended]' : '[fresh]'),
    entities: { claimId: input.claimId },
    next_actions: memory.stalenessWarning
      ? ['operator.refresh_claim_memory', 'operator.find_similar_claims']
      : ['operator.find_similar_claims', 'operator.analyze_claim_memory'],
    extra: {
      refresh_status: memory.projection.refreshStatus,
      staleness_warning: memory.stalenessWarning,
      last_refreshed_at: memory.projection.lastRefreshedAt ? memory.projection.lastRefreshedAt.toISOString() : null,
      timeline_count: memory.projection.memoryObject.timeline?.length ?? 0,
      missing_information_count: memory.projection.memoryObject.missingInformation?.length ?? 0,
      authority_flag_count: memory.projection.memoryObject.authorityFlags?.length ?? 0,
      similar_claims_count: memory.projection.similarClaims.length,
      memory: memory.projection.memoryObject,
      similar_claims: memory.projection.similarClaims,
      graph_signals: memory.projection.graphSignals,
    },
  };
  return envelope as unknown as Output;
}

export const getClaimMemoryTool: ToolDescriptor<Input, Output> = {
  name: 'operator.get_claim_memory',
  family: 'operator',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  requiredPermission: 'operator.read',
  description:
    'INTERNAL BACK-OFFICE TOOL for licensed Lloyd\u2019s MGA underwriters. Returns the cached ClaimMemoryProjection for a claim in the current operating tenant: structured timeline, missing-document rows, authority flags, recommended actions, similar-claims, and graph signals. Reads from Postgres only \u2014 never queries Neo4j or the LLM synchronously. Sets `staleness_warning: true` when the cached projection is older than TTL (default 6h, configurable via `ttl_hours` 1\u201372). Required input: { "claimId": "<uuid>" }. Optional: { "ttl_hours": <1-72> }. If the projection does not exist yet, returns next_actions=["operator.refresh_claim_memory"].',
  auditClass: 'read',
  run,
};
