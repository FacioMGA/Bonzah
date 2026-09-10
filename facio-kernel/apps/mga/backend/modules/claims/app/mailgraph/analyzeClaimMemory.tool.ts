import { z } from 'zod';
import type { ToolDescriptor } from '../../../mcp/domain/toolDescriptor.js';
import type { McpContext } from '../../../mcp/domain/mcpContext.js';
import { buildOperatorActionContext } from '../../../operator/domain/operatorContext.js';
import type { OperatorSuccessEnvelope } from '../../../operator/domain/operatorEnvelope.js';
import { analyzeClaimMemory } from './analyzeClaimMemory.js';

const InputSchema = z
  .object({
    claimId: z.string().trim().min(1),
    question: z.string().trim().max(500).optional(),
    max_recommendations: z.number().int().min(1).max(10).optional(),
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
  const result = await analyzeClaimMemory({
    claimId: input.claimId,
    question: input.question,
    maxRecommendations: input.max_recommendations,
  });

  if (result.status === 'absent') {
    const envelope: OperatorSuccessEnvelope<{ status: 'absent' }> = {
      ok: true,
      status: 'completed',
      action_id: action.actionId,
      correlation_id: action.correlationId,
      summary: result.narrative,
      entities: { claimId: input.claimId },
      next_actions: ['operator.refresh_claim_memory'],
      extra: { status: 'absent' },
    };
    return envelope as unknown as Output;
  }

  const envelope: OperatorSuccessEnvelope<{
    narrative: string;
    citation_warning: boolean;
    verification: typeof result.verification;
    highlights: typeof result.highlights;
    staleness_warning: boolean;
    last_refreshed_at: string | null;
  }> = {
    ok: true,
    status: 'completed',
    action_id: action.actionId,
    correlation_id: action.correlationId,
    summary: result.citationWarning
      ? `${result.narrative} [CITATION WARNING \u2014 ${result.verification?.unsupportedReasons?.length ?? 0} unsupported]`
      : result.narrative,
    entities: { claimId: input.claimId },
    next_actions: result.stalenessWarning
      ? ['operator.refresh_claim_memory', 'operator.find_similar_claims']
      : ['operator.find_similar_claims'],
    extra: {
      narrative: result.narrative,
      citation_warning: result.citationWarning,
      verification: result.verification,
      highlights: result.highlights,
      staleness_warning: result.stalenessWarning,
      last_refreshed_at: result.lastRefreshedAt,
    },
  };
  return envelope as unknown as Output;
}

export const analyzeClaimMemoryTool: ToolDescriptor<Input, Output> = {
  name: 'operator.analyze_claim_memory',
  family: 'operator',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  requiredPermission: 'operator.read',
  description:
    'INTERNAL BACK-OFFICE TOOL for licensed Lloyd\u2019s MGA underwriters. Synthesises a short narrative + structured highlights (missing-doc rows, authority flags, recommended actions, top similar claims) over the cached ClaimMemoryProjection for one claim in the current operating tenant. Runs the citation verifier across every cited message and sets `citation_warning: true` (flag-and-return; does not silently drop) when any citation fails to resolve to a real CommunicationMessage in this claim\u2019s threads. Required input: { "claimId": "<uuid>" }. Optional: { "question": "<focus question>", "max_recommendations": <1-10> }.',
  auditClass: 'read',
  run,
};
