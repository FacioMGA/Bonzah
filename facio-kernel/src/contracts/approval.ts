import { z } from 'zod';
import { id, scopeSchema } from './configuration.js';
import { insuranceProductDefinitionSchema } from './insurance-definition.js';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(1000);
const evidenceRefs = z.array(text).min(1).max(20);
export const approvalGateSchema = z.enum(['referral', 'routine_approval']);
export type ApprovalGate = z.infer<typeof approvalGateSchema>;
export const approvalTargetSchema = z.strictObject({
  recordId: z.string().uuid(),
  recordVersion: z.number().int().positive(),
  recordHash: sha,
  quoteHash: sha,
  productId: id,
  productVersion: z.string(),
  policyHash: sha,
  runtimeReleaseId: z.string().uuid().nullable(),
  releaseHash: sha.nullable(),
  definitionHash: sha.nullable(),
  inputHash: sha.nullable(),
  decisionHash: sha.nullable(),
});
export type ApprovalTarget = z.infer<typeof approvalTargetSchema>;
export const approvalRecordSchema = z.strictObject({
  id: z.string().uuid(),
  scope: scopeSchema,
  version: z.number().int().positive(),
  approvalHash: sha,
  previousApprovalHash: sha.nullable(),
  status: z.enum(['requested', 'approved', 'declined', 'revoked']),
  target: approvalTargetSchema,
  gates: z.array(approvalGateSchema).min(1).max(2),
  requesterId: id,
  recordCreatorId: id,
  recordAuthorId: id,
  requestedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  action: z.enum(['request', 'approve', 'decline', 'revoke']),
  actorId: id,
  correlationId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  reason: text,
  evidenceRefs,
});
export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;
export const approvalViewSchema = z.strictObject({
  approval: approvalRecordSchema,
  effectiveStatus: z.enum([
    'requested',
    'approved',
    'declined',
    'revoked',
    'expired',
    'stale',
    'consumed',
  ]),
  blockers: z.array(z.string()),
  canDecide: z.boolean(),
  canRevoke: z.boolean(),
});
export const approvalResultSchema = z.strictObject({
  ...approvalViewSchema.shape,
  history: z.array(approvalRecordSchema),
  reviewDefinition: insuranceProductDefinitionSchema.nullable(),
});
export type ApprovalResult = z.infer<typeof approvalResultSchema>;
export const approvalRequestAvailabilitySchema = z.strictObject({
  canRequest: z.boolean(),
  blockers: z.array(z.string()),
  gates: z.array(approvalGateSchema),
  maximumExpiresAt: z.string().datetime().nullable(),
});
export const bindApprovalEvidenceSchema = z.strictObject({
  approvalId: z.string().uuid(),
  approvalVersion: z.number().int().positive(),
  approvalHash: sha,
  target: approvalTargetSchema,
  gates: z.array(approvalGateSchema).min(1).max(2),
  reviewerId: id,
  approvedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  checkedAt: z.string().datetime(),
});
export type BindApprovalEvidence = z.infer<typeof bindApprovalEvidenceSchema>;
const decisionInput = {
  idempotencyKey: z.string().uuid(),
  approvalId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  approvalHash: sha,
  reason: text,
  evidenceRefs,
};
export const approvalOperations = {
  approval_list: {
    method: 'GET',
    path: '/api/insurance/approvals',
    permission: 'insurance:read',
    summary: 'Inspect scoped independent reviews and current quote request availability',
    input: z.strictObject({ recordId: z.string().uuid().optional() }),
    output: z.strictObject({
      approvals: z.array(approvalViewSchema),
      hasMore: z.boolean(),
      requestAvailability: approvalRequestAvailabilitySchema.nullable(),
      bindableApprovalId: z.string().uuid().nullable(),
      reviewDefinition: insuranceProductDefinitionSchema.nullable(),
    }),
  },
  approval_get: {
    method: 'GET',
    path: '/api/insurance/approval',
    permission: 'insurance:read',
    summary: 'Inspect an exact independent review and its immutable action history',
    input: z.strictObject({ approvalId: z.string().uuid() }),
    output: approvalResultSchema,
  },
  approval_request: {
    method: 'POST',
    path: '/api/insurance/approvals',
    permission: 'insurance:quote',
    mcp: false,
    summary:
      'Request independent human review of explicitly supported gates on an exact quote revision',
    input: z.strictObject({
      idempotencyKey: z.string().uuid(),
      recordId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      recordHash: sha,
      reason: text,
      evidenceRefs,
      expiresAt: z.string().datetime(),
    }),
    output: approvalResultSchema,
  },
  approval_decide: {
    method: 'POST',
    path: '/api/insurance/approval/decision',
    permission: 'insurance:approve',
    mcp: false,
    summary: 'Approve or decline an exact review as an independently authorized human operator',
    input: z.strictObject({ ...decisionInput, decision: z.enum(['approve', 'decline']) }),
    output: approvalResultSchema,
  },
  approval_revoke: {
    method: 'POST',
    path: '/api/insurance/approval/revoke',
    permission: 'insurance:approve',
    mcp: false,
    summary: 'Withdraw an unused requested or approved review without changing insurance history',
    input: z.strictObject(decisionInput),
    output: approvalResultSchema,
  },
} as const;
export type ApprovalOperationName = keyof typeof approvalOperations;
