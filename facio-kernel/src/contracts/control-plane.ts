import { z } from 'zod';
import { id, scopeSchema, snapshotSchema } from './configuration.js';
import { requirementsProfileSchema } from './requirements.js';
import { runtimePolicySchema } from './insurance.js';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
export const principalSchema = z.strictObject({
  issuer: z.string().url(),
  subject: z.string().min(1).max(300),
  actorId: id,
  email: z.string().max(320).optional(),
  correlationId: uuid,
});
export type Principal = z.infer<typeof principalSchema>;
export const accountRoleSchema = z.enum(['owner', 'admin', 'builder', 'viewer']);
export type AccountRole = z.infer<typeof accountRoleSchema>;
export const accountSchema = z.strictObject({
  id,
  workspaceId: id,
  displayName: z.string().min(1).max(200),
  role: accountRoleSchema,
});
export const tenantRecordSchema = z.strictObject({
  id: uuid,
  accountId: id,
  scope: scopeSchema,
  displayName: z.string().min(1).max(200),
  region: z.string().min(1).max(100),
  ownerActorId: id,
  operationId: uuid,
  provisioningState: z.enum(['Requested', 'Provisioning', 'Ready', 'Failed']),
  setupStatus: z.enum(['awaiting_requirements', 'configured']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  failureCode: z.string().nullable(),
});
export type TenantRecord = z.infer<typeof tenantRecordSchema>;
export const requirementsAttachmentSchema = z.strictObject({
  version: z.number().int().positive(),
  sourceProfileHash: sha256,
  profile: requirementsProfileSchema,
  sourceClaimsStatus: z.literal('unverified'),
  attachedAt: z.string().datetime(),
  attachedBy: id,
});
export type RequirementsAttachment = z.infer<typeof requirementsAttachmentSchema>;
export const runtimeDraftSchema = z.strictObject({
  version: z.number().int().positive(),
  hash: sha256,
  policies: z.array(runtimePolicySchema).max(50),
});
export type RuntimeDraft = z.infer<typeof runtimeDraftSchema>;
export const sandboxReleaseSchema = z.strictObject({
  id: uuid,
  tenantId: uuid,
  scope: scopeSchema,
  version: z.number().int().positive(),
  hash: sha256,
  configuration: snapshotSchema,
  requirements: requirementsAttachmentSchema,
  runtimeDraft: runtimeDraftSchema,
  buildSha: z.string().min(1).max(100),
  compatibilityVersion: z.enum(['sandbox-manual-quote-v1', 'sandbox-insurance-decision-v1']),
  activatedAt: z.string().datetime(),
  activatedBy: id,
  runtimeStatus: z.enum(['manual_external_quote_only', 'configured_product_decisions']),
  acceptanceStatus: z.literal('not_recorded'),
});
export type SandboxRelease = z.infer<typeof sandboxReleaseSchema>;
export const activationCandidateSchema = z.strictObject({
  draftVersion: z.number().int().positive(),
  draftHash: sha256,
  requirementsHash: sha256.nullable(),
  runtimeDraftVersion: z.number().int().positive(),
  runtimeDraftHash: sha256,
  canActivate: z.boolean(),
  blockers: z.array(z.string()),
});
export const tenantSetupSchema = z.strictObject({
  tenant: tenantRecordSchema,
  requirements: requirementsAttachmentSchema.nullable(),
  runtimeDraft: runtimeDraftSchema,
  activeRelease: sandboxReleaseSchema.nullable(),
  candidate: activationCandidateSchema,
});
export type TenantSetup = z.infer<typeof tenantSetupSchema>;
const identity = { idempotencyKey: uuid };
export const controlOperations = {
  control_tenants: {
    method: 'GET',
    path: '/api/control/tenants',
    target: false,
    write: false,
    summary: 'List only tenants authorized by current account and tenant memberships',
    input: z.strictObject({}),
    output: z.strictObject({ tenants: z.array(tenantRecordSchema) }),
  },
  control_create_tenant: {
    method: 'POST',
    path: '/api/control/tenants',
    target: false,
    write: true,
    summary: 'Provision a durable sandbox on the deployed shared host',
    input: z.strictObject({
      ...identity,
      accountId: id,
      displayName: z.string().trim().min(1).max(200),
      environment: z.literal('sandbox'),
      region: z.string().min(1).max(100),
    }),
    output: z.strictObject({ tenant: tenantRecordSchema }),
  },
  control_retry_tenant: {
    method: 'POST',
    path: '/api/control/tenants/retry',
    target: false,
    write: true,
    summary: 'Retry the same authorized durable provisioning operation',
    input: z.strictObject({ ...identity, operationId: uuid }),
    output: z.strictObject({ tenant: tenantRecordSchema }),
  },
  control_setup: {
    method: 'GET',
    path: '/api/control/setup',
    target: true,
    write: false,
    summary: 'Inspect setup, source claims, activation blockers and active sandbox release',
    input: z.strictObject({}),
    output: tenantSetupSchema,
  },
  control_attach_requirements: {
    method: 'PUT',
    path: '/api/control/requirements',
    target: true,
    write: true,
    summary:
      'Retain an immutable requirements profile version; source document claims remain unverified',
    input: z.strictObject({
      ...identity,
      expectedVersion: z.number().int().nonnegative(),
      profile: requirementsProfileSchema,
    }),
    output: tenantSetupSchema,
  },
  control_update_runtime_draft: {
    method: 'PUT',
    path: '/api/control/runtime-draft',
    target: true,
    write: true,
    summary: 'Author a versioned draft of supported manual external quote policies',
    input: z.strictObject({
      ...identity,
      expectedVersion: z.number().int().positive(),
      policies: z.array(runtimePolicySchema).max(50),
    }),
    output: tenantSetupSchema,
  },
  control_activate: {
    method: 'POST',
    path: '/api/control/activate',
    target: true,
    write: true,
    summary:
      'Atomically activate the exact validated sandbox configuration, requirements and runtime policy versions',
    input: z.strictObject({
      ...identity,
      draftVersion: z.number().int().positive(),
      draftHash: sha256,
      requirementsHash: sha256,
      runtimeDraftVersion: z.number().int().positive(),
      runtimeDraftHash: sha256,
    }),
    output: tenantSetupSchema,
  },
  control_rollback: {
    method: 'POST',
    path: '/api/control/rollback',
    target: true,
    write: true,
    summary:
      'Select a retained compatible sandbox release without changing drafts or transaction history',
    input: z.strictObject({ ...identity, releaseId: uuid, expectedActiveReleaseId: uuid }),
    output: tenantSetupSchema,
  },
  control_revoke_membership: {
    mcp: false,
    method: 'POST',
    path: '/api/control/memberships/revoke',
    target: false,
    write: true,
    summary: 'Revoke an account or tenant membership using an authorized account administrator',
    input: z.strictObject({
      ...identity,
      accountId: id,
      actorId: id,
      membershipTenantId: uuid.optional(),
    }),
    output: z.strictObject({
      revoked: z.literal(true),
      accountId: id,
      actorId: id,
      tenantId: uuid.nullable(),
    }),
  },
} as const;
export type ControlOperationName = keyof typeof controlOperations;
export type ControlPlaneOptions = { region: string; buildSha: string };
/** Approved shared-host regions and the physical storage residency represented by each. */
export const sandboxRegionResidencies = { westeurope: 'eu' } as const;
export type AccountBootstrap = {
  accountId: string;
  workspaceId: string;
  displayName: string;
  members: (
    | { issuer: string; subject: string; actorId: string; role: AccountRole }
    | { issuer: string; email: string; role: AccountRole }
  )[];
};
