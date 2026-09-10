import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import {
    bindPolicyFromMcp,
    getPolicyIssuanceStatus,
    listPolicyDocumentsFromMcp,
    previewPolicyBind,
} from './policyIssuanceMcp.js';

const PolicyInputSchema = z.object({ policyId: z.string().uuid() }).strict();
const BindInputSchema = z.object({
    policyId: z.string().uuid(),
    confirmation_token: z.string().regex(/^tok_[a-f0-9]{32}$/),
}).strict();

const ErrorSchema = z.object({ code: z.string(), message: z.string(), suggested_fix: z.string().optional() }).strict();
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
    next_actions: z.array(z.string()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
    error: ErrorSchema.optional(),
}).strict();

export const previewPolicyBindTool: ToolDescriptor<z.infer<typeof PolicyInputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.preview_policy_bind',
    family: 'operator',
    inputSchema: PolicyInputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'policies.bind',
    auditClass: 'validate',
    description: 'Evaluate payment, underwriting, pricing, programme, binder-authority, sanctions, and document readiness. Returns an actor-bound, single-use, retained-configuration-hash-bound bind token.',
    run: previewPolicyBind,
};

export const bindPolicyTool: ToolDescriptor<z.infer<typeof BindInputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.bind_policy',
    family: 'operator',
    inputSchema: BindInputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'policies.bind',
    auditClass: 'publish',
    description: 'Legally bind a ready policy through the canonical bind/issuance spine using the single-use token from operator.preview_policy_bind.',
    run: bindPolicyFromMcp,
};

export const getPolicyIssuanceStatusTool: ToolDescriptor<z.infer<typeof PolicyInputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.get_policy_issuance_status',
    family: 'operator',
    inputSchema: PolicyInputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.read',
    auditClass: 'read',
    description: 'Read canonical payment, bind, issuance, risk-transaction, readiness, and generated-document status for one policy.',
    run: getPolicyIssuanceStatus,
};

export const listPolicyDocumentsTool: ToolDescriptor<z.infer<typeof PolicyInputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.list_policy_documents',
    family: 'operator',
    inputSchema: PolicyInputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'documents.view',
    auditClass: 'read',
    description: 'List generated policy documents with immutable type/version/hash evidence and customer-authorized download URLs.',
    run: listPolicyDocumentsFromMcp,
};
