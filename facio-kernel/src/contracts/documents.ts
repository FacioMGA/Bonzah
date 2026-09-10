import { z } from 'zod';
import { id, scopeSchema } from './configuration.js';
import { insuranceProductDefinitionSchema } from './insurance-definition.js';
import { insuranceRecordSchema, insuranceEventSchema } from './insurance.js';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(1000);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const documentTemplateSchema = z.strictObject({
  id,
  version,
  title: z.string().trim().min(1).max(160),
  kind: z.enum(['transaction_summary', 'coverage_schedule']),
  sourceRefs: z.array(text).min(1).max(20),
  legalRefs: z.array(text).min(1).max(20),
  wording: z.string().trim().min(1).max(4000),
});
export const documentPackSchema = z
  .strictObject({
    id,
    version,
    name: z.string().trim().min(1).max(160),
    rendererVersion: z.literal('insurance-document-v1'),
    evidenceBoundary: z.literal('synthetic_training'),
    issuerLabel: z.string().trim().min(1).max(160),
    legalRole: z.literal('training_document_generator_not_insurer'),
    sourceRefs: z.array(text).min(1).max(20),
    templates: z.array(documentTemplateSchema).min(1).max(5),
  })
  .refine(
    (value) => new Set(value.templates.map((item) => item.id)).size === value.templates.length,
    'Template identifiers must be unique in a pack',
  );
export type DocumentPack = z.infer<typeof documentPackSchema>;
export const documentRequestSchema = z.strictObject({
  id: z.string().uuid(),
  scope: scopeSchema,
  documentNumber: z.string().regex(/^TRN-[A-F0-9]{32}$/),
  recordId: z.string().uuid(),
  recordVersion: z.number().int().positive(),
  recordHash: sha,
  pack: documentPackSchema,
  packHash: sha,
  snapshot: z.strictObject({
    record: insuranceRecordSchema,
    event: insuranceEventSchema,
    definition: insuranceProductDefinitionSchema.nullable(),
  }),
  snapshotHash: sha,
  actorId: id,
  correlationId: z.string().uuid(),
  createdAt: z.string().datetime(),
  requestHash: sha,
});
export type DocumentRequest = z.infer<typeof documentRequestSchema>;
export const documentStateSchema = z.strictObject({
  jobId: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(['queued', 'rendering', 'failed', 'completed']),
  attempts: z.number().int().min(0).max(3),
  claim: z.strictObject({ token: z.string().uuid(), expiresAt: z.string().datetime() }).nullable(),
  failureCode: z
    .enum(['RENDER_FAILED', 'UNSUPPORTED_GLYPH', 'OUTPUT_TOO_LARGE', 'LEASE_EXPIRED'])
    .nullable(),
  actorId: id.nullable(),
  correlationId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  previousStateHash: sha.nullable(),
  stateHash: sha,
});
export type DocumentState = z.infer<typeof documentStateSchema>;
export const documentArtifactSchema = z.strictObject({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  templateId: id,
  templateVersion: version,
  documentNumber: z.string().min(1).max(160),
  documentVersion: z.number().int().positive(),
  format: z.enum(['pdf', 'html']),
  mimeType: z.enum(['application/pdf', 'text/html']),
  filename: z.string().regex(/^[a-zA-Z0-9_.-]+\.(pdf|html)$/),
  byteLength: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
  contentHash: sha,
  recordHash: sha,
  snapshotHash: sha,
  packHash: sha,
  createdAt: z.string().datetime(),
});
export type DocumentArtifact = z.infer<typeof documentArtifactSchema>;
export const documentViewSchema = z.strictObject({
  request: documentRequestSchema,
  state: documentStateSchema.omit({ claim: true }),
  history: z.array(documentStateSchema.omit({ claim: true })).min(1),
  artifacts: z.array(documentArtifactSchema).max(10),
  canRetry: z.boolean(),
  authority: z.literal('synthetic_document_not_insurance_issuance'),
});
export type DocumentView = z.infer<typeof documentViewSchema>;
export const documentOperations = {
  documents_catalog: {
    method: 'GET',
    path: '/api/insurance/documents/catalog',
    permission: 'documents:read',
    summary: 'Discover explicitly registered synthetic document packs and template provenance',
    input: z.strictObject({}),
    output: z.strictObject({
      packs: z.array(z.strictObject({ pack: documentPackSchema, packHash: sha })),
    }),
  },
  documents_list: {
    method: 'GET',
    path: '/api/insurance/documents',
    permission: 'documents:read',
    summary: 'Read retained document packs and generation state for an authorized insurance record',
    input: z.strictObject({ recordId: z.string().uuid() }),
    output: z.strictObject({
      documents: z.array(documentViewSchema).max(50),
      hasMore: z.boolean(),
    }),
  },
  documents_get: {
    method: 'GET',
    path: '/api/insurance/documents/job',
    permission: 'documents:read',
    summary: 'Inspect exact document snapshot, immutable attempt history and output references',
    input: z.strictObject({ jobId: z.string().uuid() }),
    output: documentViewSchema,
  },
  documents_content: {
    method: 'GET',
    path: '/api/insurance/documents/content',
    permission: 'documents:read',
    summary: 'Retrieve one authorized immutable PDF or HTML artifact with its exact byte hash',
    input: z.strictObject({ artifactId: z.string().uuid() }),
    output: z.strictObject({
      artifact: documentArtifactSchema,
      encoding: z.literal('base64'),
      content: z.string().max(Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4),
    }),
  },
  documents_request: {
    method: 'POST',
    path: '/api/insurance/documents',
    permission: 'documents:issue',
    mcp: false,
    summary: 'Queue a registered synthetic pack pinned to an exact bound or serviced transaction',
    input: z.strictObject({
      recordId: z.string().uuid(),
      recordVersion: z.number().int().positive(),
      recordHash: sha,
      packId: id,
      packVersion: version,
      idempotencyKey: z.string().uuid(),
    }),
    output: documentViewSchema,
  },
  documents_retry: {
    method: 'POST',
    path: '/api/insurance/documents/retry',
    permission: 'documents:issue',
    mcp: false,
    summary: 'Retry a failed or expired document render within its fixed three-attempt budget',
    input: z.strictObject({
      jobId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      stateHash: sha,
      idempotencyKey: z.string().uuid(),
    }),
    output: documentViewSchema,
  },
} as const;
export type DocumentOperationName = keyof typeof documentOperations;
