import { z } from 'zod';
import { requirementsReportSchema } from './requirements.js';
import { insuranceOperations } from './insurance.js';
import { approvalOperations } from './approval.js';
import { providerOperations } from './provider-execution.js';
import { documentOperations } from './documents.js';
import { financeOperations } from './finance.js';
import { fnolOperations } from './fnol.js';
import {
  categorySchema,
  configurationSchema,
  diffSchema,
  reportSchema,
  scopeSchema,
  snapshotSchema,
  viewSchema,
} from './configuration.js';

const readInput = z.strictObject({ view: viewSchema });
const configurationOperations = {
  configuration_requirements: {
    method: 'GET',
    path: '/api/requirements',
    permission: 'configuration:read',
    summary:
      'Inspect scoped source requirements and declared dependencies without asserting runtime readiness',
    input: z.strictObject({}),
    output: requirementsReportSchema,
  },
  configuration_catalog: {
    method: 'GET',
    path: '/api/catalog',
    permission: 'configuration:read',
    summary: 'Discover all configuration categories and implementation limits',
    input: z.strictObject({}),
    output: z.strictObject({
      contractVersion: z.literal('0.1.0'),
      categories: z.array(categorySchema),
    }),
  },
  configuration_inspect: {
    method: 'GET',
    path: '/api/configuration',
    permission: 'configuration:read',
    summary: 'Inspect the scoped draft or immutable published definition',
    input: readInput,
    output: snapshotSchema,
  },
  configuration_gaps: {
    method: 'GET',
    path: '/api/gaps',
    permission: 'configuration:read',
    summary: 'Validate definition metadata and report unsupported capabilities',
    input: readInput,
    output: reportSchema,
  },
  configuration_update_draft: {
    method: 'PUT',
    path: '/api/draft',
    permission: 'configuration:write',
    summary: 'Replace definition draft with optimistic concurrency and idempotency',
    input: z.strictObject({
      expectedVersion: z.number().int().positive(),
      idempotencyKey: z.string().uuid(),
      configuration: configurationSchema,
    }),
    output: z.strictObject({
      snapshot: snapshotSchema,
      diff: z.array(diffSchema),
      summary: z.string(),
    }),
  },
  configuration_context: {
    method: 'GET',
    path: '/api/context',
    permission: 'configuration:read',
    summary: 'Inspect server-authorized scope and permissions',
    input: z.strictObject({}),
    output: scopeSchema.extend({ actorId: z.string(), permissions: z.array(z.string()) }),
  },
  configuration_audit: {
    method: 'GET',
    path: '/api/audit',
    permission: 'audit:read',
    summary: 'Read the latest 100 scoped command audit records without input payloads',
    input: z.strictObject({}),
    output: z.strictObject({
      records: z.array(
        z.strictObject({
          id: z.string(),
          actorId: z.string(),
          operation: z.string(),
          outcome: z.string(),
          correlationId: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
  },
} as const;
type OperationRegistry = typeof configurationOperations &
  typeof insuranceOperations &
  typeof approvalOperations &
  typeof providerOperations &
  typeof documentOperations &
  typeof financeOperations &
  typeof fnolOperations;
export const operations: OperationRegistry = {
  ...configurationOperations,
  ...insuranceOperations,
  ...approvalOperations,
  ...providerOperations,
  ...documentOperations,
  ...financeOperations,
  ...fnolOperations,
};
export type OperationName = keyof OperationRegistry;
