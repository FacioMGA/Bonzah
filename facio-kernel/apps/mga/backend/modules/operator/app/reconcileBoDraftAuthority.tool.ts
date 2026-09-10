import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { operatorReconcileBoDraftAuthority } from './reconcileBoDraftAuthority.js';

const InputSchema = z
    .object({
        confirmation_token: z
            .string()
            .trim()
            .regex(/^tok_[a-f0-9]{32}$/, 'confirmation_token must be a tok_<32hex> value')
            .optional(),
    })
    .strict();

const OutputSchema = z.object({
    ok: z.boolean(),
    status: z.string(),
    summary: z.string(),
    action_id: z.string().optional(),
    correlation_id: z.string().optional(),
    requires_confirmation: z.boolean().optional(),
    confirmation_token: z.string().optional(),
    expires_at: z.string().optional(),
    entities: z.record(z.string(), z.string().optional()).optional(),
    diff: z.array(z.object({ field: z.string(), from: z.unknown().optional(), to: z.unknown().optional() })).optional(),
    readiness_blockers: z.array(z.object({ code: z.string(), message: z.string() })).optional(),
    preview_extra: z.record(z.string(), z.unknown()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
    error: z
        .object({ code: z.string(), message: z.string(), suggested_fix: z.string().optional() })
        .optional(),
});

export const reconcileBoDraftAuthorityTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.reconcile_bo_draft_authority',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.mutate',
    description:
        'Preview the explicit repair of BO-origin DRAFT policies with a known product but missing Program/Binder authority. Returns exact affected/safe/skipped counts and a confirmation_token; call again with that token to apply only the previewed safe rows.',
    auditClass: 'mutate',
    run: async (input, ctx) => operatorReconcileBoDraftAuthority(input, ctx),
};
