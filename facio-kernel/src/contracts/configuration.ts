import { z } from 'zod';
import { id } from './primitives.js';
import { insuranceProductDefinitionSchema } from './insurance-definition.js';

export { id };
const label = z.string().min(1).max(200);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
export const fieldSchema = z.strictObject({
  id,
  label,
  type: z.enum(['text', 'number', 'boolean', 'date']),
  required: z.boolean(),
});
export const tenantSchema = z.strictObject({
  displayName: label,
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timeZone: z.string().min(1).max(100),
  residency: z.enum(['eu', 'uk', 'us', 'au']),
});
export const operatingEntitySchema = z.strictObject({
  id,
  name: label,
  territories: z.array(z.string().regex(/^[A-Z]{2}$/)).max(50),
});
export const productSchema = z.strictObject({
  id,
  version,
  name: label,
  operatingEntityId: id,
  processId: id,
  fields: z.array(fieldSchema).max(100),
  requiredCapabilities: z.array(id).max(50),
  insurance: insuranceProductDefinitionSchema.optional(),
});
export const processSchema = z.strictObject({
  id,
  version,
  name: label,
  initialStage: id,
  stages: z.array(z.strictObject({ id, label, terminal: z.boolean() })).max(50),
  transitions: z.array(z.strictObject({ from: id, to: id, command: id })).max(100),
});
export const integrationSchema = z.strictObject({
  id,
  adapterId: id,
  connectionRef: z.string().regex(/^connection:\/\/[a-z0-9/_-]{1,120}$/),
  connectionStatus: z.enum(['unverified', 'connected', 'disconnected']),
});
// Bounded definition metadata. Execution and unsupported aggregate payloads are rejected.
export const configurationSchema = z.strictObject({
  tenant: tenantSchema.nullable(),
  operatingEntities: z.array(operatingEntitySchema).max(50),
  products: z.array(productSchema).max(50),
  processes: z.array(processSchema).max(50),
  integrations: z.array(integrationSchema).max(50),
});
export type Configuration = z.infer<typeof configurationSchema>;
export const scopeSchema = z.strictObject({
  workspaceId: id,
  tenantId: id,
  environment: z.enum(['development', 'sandbox', 'uat', 'production']),
  operatingEntityId: id,
});
export type Scope = z.infer<typeof scopeSchema>;
export const permissions = [
  'configuration:read',
  'configuration:write',
  'audit:read',
  'insurance:read',
  'insurance:quote',
  'insurance:bind',
  'insurance:service',
  'insurance:approve',
  'provider:read',
  'provider:request',
  'documents:read',
  'documents:issue',
  'finance:read',
  'finance:post',
  'finance:reconcile',
  'fnol:read',
  'fnol:write',
  'fnol:handoff',
] as const;
export const contextSchema = scopeSchema.extend({
  actorId: id,
  permissions: z.array(z.enum(permissions)),
  correlationId: z.string().uuid(),
});
export type Context = z.infer<typeof contextSchema>;
export const viewSchema = z.enum(['draft', 'published']);
export const snapshotSchema = z.strictObject({
  view: viewSchema,
  version: z.number().int().positive(),
  hash: z.string(),
  updatedAt: z.string().datetime(),
  releaseId: z.string().nullable(),
  effectiveAt: z.string().datetime().nullable(),
  configuration: configurationSchema,
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const categoryIds = [
  'tenant',
  'operatingEntities',
  'partyDistribution',
  'products',
  'programmesBinders',
  'processes',
  'jurisdictions',
  'finance',
  'documents',
  'integrations',
  'reporting',
  'experience',
  'tenantRelease',
] as const;
export const categorySchema = z.strictObject({
  id: z.enum(categoryIds),
  name: label,
  support: z.enum(['complete', 'partial', 'missing', 'deprecated', 'unknown']),
  description: z.string(),
  requirementIds: z.array(z.string()),
  owner: z.string(),
  milestone: z.string(),
  surfaces: z.strictObject({ ui: z.boolean(), api: z.boolean(), mcp: z.boolean() }),
  validation: z.boolean(),
  simulation: z.boolean(),
});
export const gapSchema = z.strictObject({
  id: z.string(),
  tenantId: id,
  productId: id.nullable(),
  processId: id.nullable(),
  category: z.enum(categoryIds),
  field: z.string(),
  kind: z.enum(['missing', 'incomplete', 'invalid', 'inconsistent', 'unsupported', 'unknown']),
  requirementId: z.string(),
  currentState: z.string(),
  expectedState: z.string(),
  affectedJourney: z.string(),
  severity: z.enum(['blocker', 'warning', 'info']),
  remediation: z.string(),
  owner: z.string(),
  code: z.enum(['CONFIGURATION_GAP', 'REQUIRES_ENGINEERING', 'DISCOVERY_REQUIRED']),
});
export type Gap = z.infer<typeof gapSchema>;
export const reportSchema = z.strictObject({
  view: viewSchema,
  version: z.number().int().positive(),
  configurationHash: z.string(),
  definitionValid: z.boolean(),
  productionReady: z.literal(false),
  validationScope: z.literal('configuration-metadata-v0.1'),
  gaps: z.array(gapSchema),
});
export const errorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    correlationId: z.string().uuid(),
  }),
});
const sectionValue = z.union([
  tenantSchema.nullable(),
  z.array(operatingEntitySchema),
  z.array(productSchema),
  z.array(processSchema),
  z.array(integrationSchema),
]);
export const diffSchema = z.strictObject({
  path: z.string(),
  before: sectionValue,
  after: sectionValue,
});
