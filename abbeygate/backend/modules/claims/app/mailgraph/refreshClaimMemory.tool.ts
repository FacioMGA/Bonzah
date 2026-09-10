import { z } from 'zod';
import { prisma, tenantScopedPrisma } from '../../../../platform/db/connection.js';
import type { ToolDescriptor } from '../../../mcp/domain/toolDescriptor.js';
import type { McpContext } from '../../../mcp/domain/mcpContext.js';
import { buildOperatorActionContext } from '../../../operator/domain/operatorContext.js';
import type { OperatorErrorEnvelope, OperatorSuccessEnvelope } from '../../../operator/domain/operatorEnvelope.js';
import { enqueueClaimMemoryRefresh } from '../../infra/mailgraph/enqueueClaimMemoryRefresh.js';

const InputSchema = z
  .object({
    claimId: z.string().trim().min(1),
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
  error: z
    .object({ code: z.string(), message: z.string() })
    .optional(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

async function run(input: Input, ctx: McpContext): Promise<Output> {
  const action = buildOperatorActionContext(ctx);
  const exists = await tenantScopedPrisma.claim.findUnique({
    where: { id: input.claimId },
    select: { id: true },
  });
  if (!exists) {
    const envelope: OperatorErrorEnvelope & {
      action_id: string;
      correlation_id: string;
      entities: { claimId: string };
    } = {
      ok: false,
      status: 'error',
      action_id: action.actionId,
      correlation_id: action.correlationId,
      summary: `Claim ${input.claimId} not found in current tenant scope.`,
      entities: { claimId: input.claimId },
      error: { code: 'CLAIM_NOT_FOUND', message: 'Claim not found in this tenant.' },
    };
    return envelope as unknown as Output;
  }

  await enqueueClaimMemoryRefresh(prisma, {
    claimId: input.claimId,
    reason: 'mcp_tool',
    actorId: ctx.userId || 'mcp-operator',
    actorType: ctx.role === 'USER' ? 'USER' : 'SYSTEM',
    correlationId: action.correlationId,
  });

  const envelope: OperatorSuccessEnvelope<{ enqueued: boolean; debounce_window_seconds: number }> = {
    ok: true,
    status: 'completed',
    action_id: action.actionId,
    correlation_id: action.correlationId,
    summary: `Claim memory refresh enqueued for ${input.claimId}. Projection will update within ~60 seconds.`,
    entities: { claimId: input.claimId },
    next_actions: ['operator.get_claim_memory', 'operator.find_similar_claims'],
    extra: { enqueued: true, debounce_window_seconds: 60 },
  };
  return envelope as unknown as Output;
}

export const refreshClaimMemoryTool: ToolDescriptor<Input, Output> = {
  name: 'operator.refresh_claim_memory',
  family: 'operator',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  requiredPermission: 'operator.read',
  description:
    'INTERNAL BACK-OFFICE TOOL for licensed Lloyd\u2019s MGA underwriters. Enqueues an async refresh of the ClaimMemoryProjection (timeline, missing-doc rows, authority flags, similar claims, graph signals) for one claim in the current operating tenant. Idempotent + debounced: ten calls within 60s coalesce to one rebuild. Does NOT block on completion \u2014 returns an action_id and the operator should poll `operator.get_claim_memory` ~60 seconds later. Required input: { "claimId": "<uuid>" }.',
  auditClass: 'read',
  run,
};
