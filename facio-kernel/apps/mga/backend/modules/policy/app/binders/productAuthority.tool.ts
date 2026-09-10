import { z } from 'zod';
import type { ToolDescriptor } from '../../../mcp/domain/toolDescriptor.js';
import { McpToolError } from '../../../mcp/domain/toolError.js';
import {
  consumeConfirmationToken,
  hashPreviewInput,
  issueConfirmationToken,
} from '../../../mcp/infra/confirmationTokenStore.js';
import {
  BinderProductAuthorityCreateSchema,
  BinderProductAuthorityError,
  listBinderProductAuthorities,
  upsertBinderProductAuthority,
  validateBinderProductAuthority,
} from './productAuthority.js';

const nullableString = z.string().nullable();
const AuthoritySchema = z.object({
  id: z.string().uuid(),
  binderId: z.string().uuid(),
  productCode: z.string(),
  classOfBusiness: z.string(),
  riskCode: nullableString,
  territorialScope: z.array(z.string()),
  maxPremiumAnnual: z.number().nullable(),
  maxPolicyPeriodDays: z.number().int().nullable(),
  maxAdvanceInceptionDays: z.number().int().nullable(),
  authorityClasses: z.array(z.string()),
  status: z.string(),
  effectiveFrom: nullableString,
  effectiveTo: nullableString,
  notes: nullableString,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

const DiffSchema = z.object({
  field: z.string(),
  from: z.union([z.string(), z.number(), z.array(z.string()), z.null()]),
  to: z.union([z.string(), z.number(), z.array(z.string()), z.null()]),
}).strict();

const ListInputSchema = z.object({ binderId: z.string().uuid() }).strict();
const ListOutputSchema = z.object({ authorities: z.array(AuthoritySchema) }).strict();

const PreviewOutputSchema = z.object({
  ok: z.literal(true),
  status: z.literal('preview'),
  summary: z.string(),
  confirmation_token: z.string().regex(/^tok_[a-f0-9]{32}$/),
  expires_at: z.string().datetime(),
  binderId: z.string().uuid(),
  productCode: z.string(),
  operation: z.enum(['create', 'update']),
  diff: z.array(DiffSchema),
}).strict();

const CommitInputSchema = z.object({
  binderId: z.string().uuid(),
  productCode: z.string().trim().min(1).max(64).transform((value) => value.toUpperCase()),
  confirmation_token: z.string().regex(/^tok_[a-f0-9]{32}$/),
}).strict();
const CommitOutputSchema = z.object({
  ok: z.literal(true),
  status: z.literal('completed'),
  summary: z.string(),
  created: z.boolean(),
  authority: AuthoritySchema,
}).strict();

function mapAuthorityError(error: unknown): never {
  if (error instanceof BinderProductAuthorityError) {
    throw new McpToolError({ code: 'VALIDATION_ERROR', message: error.message, suggestedFix: error.code });
  }
  throw error;
}

function comparable(value: unknown): string | number | string[] | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(String);
  return JSON.stringify(value);
}

export const listBinderProductAuthoritiesTool: ToolDescriptor<
  z.infer<typeof ListInputSchema>,
  z.infer<typeof ListOutputSchema>
> = {
  name: 'config.binders.listProductAuthorities',
  family: 'config',
  inputSchema: ListInputSchema,
  outputSchema: ListOutputSchema,
  requiredPermission: 'binders.view',
  auditClass: 'read',
  description: 'List the selected workspace binder product authorities and their effective limits. Identity is server-scoped.',
  run: async ({ binderId }) => {
    try {
      return { authorities: await listBinderProductAuthorities(binderId) };
    } catch (error) {
      return mapAuthorityError(error);
    }
  },
};

export const previewUpsertBinderProductAuthorityTool: ToolDescriptor<
  z.infer<typeof BinderProductAuthorityCreateSchema>,
  z.infer<typeof PreviewOutputSchema>
> = {
  name: 'config.binders.previewUpsertProductAuthority',
  family: 'config',
  inputSchema: BinderProductAuthorityCreateSchema,
  outputSchema: PreviewOutputSchema,
  requiredPermission: 'binders.edit',
  auditClass: 'validate',
  description: 'Validate and preview creation or replacement of one binder product authority. Returns a single-use confirmation token; it does not change authority.',
  run: async (input, ctx) => {
    try {
      const validated = await validateBinderProductAuthority(input);
      const { existing, input: normalized } = validated;
      const fields = [
        'classOfBusiness', 'riskCode', 'territorialScope', 'maxPremiumAnnual',
        'maxPolicyPeriodDays', 'maxAdvanceInceptionDays', 'authorityClasses',
        'effectiveFrom', 'effectiveTo', 'notes', 'status',
      ] as const;
      const diff = fields.flatMap((field) => {
        const before = existing ? comparable(existing[field]) : null;
        const after = comparable(normalized[field] ?? (field === 'status' ? 'ACTIVE' : null));
        return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ field, from: before, to: after }];
      });
      const entityId = `${normalized.binderId}:${normalized.productCode}`;
      const issued = await issueConfirmationToken({
        actorId: ctx.userId,
        toolName: 'config.binders.upsertProductAuthority',
        entityId,
        inputHash: hashPreviewInput(normalized),
        issuedAt: new Date().toISOString(),
        preview: normalized,
      });
      return {
        ok: true,
        status: 'preview',
        summary: `${existing ? 'Update' : 'Create'} ${normalized.productCode} authority with ${diff.length} changed field(s).`,
        confirmation_token: issued.token,
        expires_at: issued.expiresAt,
        binderId: normalized.binderId,
        productCode: normalized.productCode,
        operation: existing ? 'update' : 'create',
        diff,
      };
    } catch (error) {
      return mapAuthorityError(error);
    }
  },
};

export const upsertBinderProductAuthorityTool: ToolDescriptor<
  z.infer<typeof CommitInputSchema>,
  z.infer<typeof CommitOutputSchema>
> = {
  name: 'config.binders.upsertProductAuthority',
  family: 'config',
  inputSchema: CommitInputSchema,
  outputSchema: CommitOutputSchema,
  requiredPermission: 'binders.edit',
  auditClass: 'publish',
  description: 'Create or replace the previewed binder product authority using its actor-bound, single-use confirmation token.',
  run: async (input, ctx) => {
    const consumed = await consumeConfirmationToken(input.confirmation_token, {
      actorId: ctx.userId,
      toolName: 'config.binders.upsertProductAuthority',
      entityId: `${input.binderId}:${input.productCode}`,
    });
    if (!consumed) {
      throw new McpToolError({
        code: 'VALIDATION_ERROR',
        message: 'Confirmation token is invalid or expired.',
        suggestedFix: 'Run config.binders.previewUpsertProductAuthority again.',
      });
    }
    try {
      const preview = BinderProductAuthorityCreateSchema.parse(consumed.preview);
      if (preview.binderId !== input.binderId || preview.productCode !== input.productCode) {
        throw new McpToolError({ code: 'VALIDATION_ERROR', message: 'Confirmation token target does not match the requested authority.' });
      }
      const result = await upsertBinderProductAuthority(preview);
      return {
        ok: true,
        status: 'completed',
        summary: `${result.created ? 'Created' : 'Updated'} active ${result.authority.productCode} binder product authority.`,
        created: result.created,
        authority: result.authority,
      };
    } catch (error) {
      return mapAuthorityError(error);
    }
  },
};
