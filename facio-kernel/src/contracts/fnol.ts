import { z } from 'zod';
import { id, scopeSchema } from './configuration.js';
import { insuranceRecordSchema } from './insurance.js';
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const text = z.string().trim().min(1).max(1000);
const optionalText = z.string().trim().max(1000);
export const fnolDestinationSchema = z.strictObject({
  id,
  version,
  label: z.string().trim().min(1).max(160),
  kind: z.literal('synthetic_internal_queue'),
  sourceRefs: z.array(text).min(1).max(20),
  authority: z.literal('internal_training_acknowledgement_only'),
});
export type FnolDestination = z.infer<typeof fnolDestinationSchema>;
const contact = z.strictObject({
  email: z.union([z.literal(''), z.string().email().max(254)]),
  phone: z.string().trim().max(80),
});
export const fnolDetailsSchema = z.strictObject({
  insured: z.strictObject({ displayName: optionalText, reference: optionalText }),
  reporter: z.strictObject({
    displayName: optionalText,
    role: z.enum(['insured', 'renter', 'driver', 'broker', 'other']),
    contact,
  }),
  preparer: z.strictObject({
    displayName: optionalText,
    role: z.enum(['reporter', 'broker', 'authorized_representative', 'other']),
    company: optionalText,
    contact,
  }),
  loss: z.strictObject({
    occurredAt: z.union([z.literal(''), z.string().datetime({ offset: true })]),
    reportedTimeZone: optionalText,
    location: optionalText,
    kind: z.enum(['property', 'vehicle', 'injury', 'other']),
    description: z.string().trim().max(5000),
    injuryStatus: z.enum(['none_reported', 'reported', 'unknown']),
  }),
  evidence: z
    .array(
      z.strictObject({
        kind: z.enum([
          'photo',
          'police_report',
          'rental_contract',
          'certificate',
          'repair_estimate',
          'other',
        ]),
        reference: text,
        description: optionalText,
      }),
    )
    .max(30),
  declaration: z.strictObject({
    confirmed: z.boolean(),
    statementVersion: z.literal('synthetic-intake-v1'),
  }),
});
export type FnolDetails = z.infer<typeof fnolDetailsSchema>;
const duplicateReview = z.strictObject({
  disposition: z.enum(['not_duplicate', 'related_notice', 'needs_review']),
  reason: text,
});
export const fnolNoticeSchema = z.strictObject({
  id: z.string().uuid(),
  scope: scopeSchema,
  version: z.number().int().positive(),
  noticeHash: sha,
  previousNoticeHash: sha.nullable(),
  sourceReference: z.string().trim().min(1).max(200),
  sourceRequestHash: sha,
  policySnapshot: insuranceRecordSchema,
  policySnapshotHash: sha,
  destination: fnolDestinationSchema,
  destinationHash: sha,
  details: fnolDetailsSchema,
  status: z.enum(['draft', 'submitted', 'acknowledged']),
  possibleDuplicateIds: z.array(z.string().uuid()).max(100),
  duplicateReview: duplicateReview.nullable(),
  createdBy: id,
  createdAt: z.string().datetime(),
  actorId: id,
  correlationId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  submittedAt: z.string().datetime().nullable(),
  acknowledgement: z
    .strictObject({
      id: z.string().uuid(),
      destinationHash: sha,
      submittedNoticeHash: sha,
      acknowledgedAt: z.string().datetime(),
      kind: z.literal('synthetic_internal_queue_receipt'),
      externalDelivery: z.literal('not_attempted'),
    })
    .nullable(),
});
export type FnolNotice = z.infer<typeof fnolNoticeSchema>;
export const fnolViewSchema = z.strictObject({
  notice: fnolNoticeSchema,
  history: z.array(fnolNoticeSchema).min(1),
  assessment: z.strictObject({
    lossCalendarDate: z.string().nullable(),
    term: z.strictObject({ startDate: z.string(), endDate: z.string() }),
    termStatus: z.enum(['not_supplied', 'within_recorded_term', 'outside_recorded_term']),
    dateBasis: z.literal('reported_loss_offset_calendar_date'),
    flags: z.array(text),
    possibleDuplicateIds: z.array(z.string().uuid()).max(100),
    canSubmit: z.boolean(),
    submitIssues: z.array(z.strictObject({ path: z.string(), message: text })),
    canHandoff: z.boolean(),
    adjudication: z.literal('not_performed'),
    publicLink: z.literal('not_implemented'),
  }),
});
export type FnolView = z.infer<typeof fnolViewSchema>;
const cas = {
  noticeId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  noticeHash: sha,
  idempotencyKey: z.string().uuid(),
};
export const fnolOperations = {
  fnol_catalog: {
    method: 'GET',
    path: '/api/insurance/fnol/catalog',
    permission: 'fnol:read',
    summary: 'List registered internal training FNOL destinations',
    input: z.strictObject({}),
    output: z.strictObject({
      destinations: z.array(
        z.strictObject({ destination: fnolDestinationSchema, destinationHash: sha }),
      ),
    }),
  },
  fnol_list: {
    method: 'GET',
    path: '/api/insurance/fnol',
    permission: 'fnol:read',
    summary: 'List scoped notices linked to one insurance record',
    input: z.strictObject({ recordId: z.string().uuid() }),
    output: z.strictObject({ notices: z.array(fnolViewSchema).max(50), hasMore: z.boolean() }),
  },
  fnol_get: {
    method: 'GET',
    path: '/api/insurance/fnol/notice',
    permission: 'fnol:read',
    summary: 'Inspect immutable notice revisions, term flags and acknowledgement',
    input: z.strictObject({ noticeId: z.string().uuid() }),
    output: fnolViewSchema,
  },
  fnol_create: {
    method: 'POST',
    path: '/api/insurance/fnol',
    permission: 'fnol:write',
    mcp: false,
    summary: 'Save an internal FNOL draft pinned to an exact historical policy version',
    input: z.strictObject({
      recordId: z.string().uuid(),
      recordVersion: z.number().int().positive(),
      recordHash: sha,
      sourceReference: z.string().trim().min(1).max(200),
      destinationId: id,
      destinationVersion: version,
      details: fnolDetailsSchema,
      idempotencyKey: z.string().uuid(),
    }),
    output: fnolViewSchema,
  },
  fnol_update: {
    method: 'PUT',
    path: '/api/insurance/fnol',
    permission: 'fnol:write',
    mcp: false,
    summary: 'Save a new immutable FNOL draft revision',
    input: z.strictObject({ ...cas, details: fnolDetailsSchema }),
    output: fnolViewSchema,
  },
  fnol_submit: {
    method: 'POST',
    path: '/api/insurance/fnol/submit',
    permission: 'fnol:write',
    mcp: false,
    summary: 'Submit reviewed FNOL facts and retain duplicate disposition without adjudication',
    input: z.strictObject({ ...cas, duplicateReview: duplicateReview.nullable() }),
    output: fnolViewSchema,
  },
  fnol_handoff: {
    method: 'POST',
    path: '/api/insurance/fnol/handoff',
    permission: 'fnol:handoff',
    mcp: false,
    summary: 'Acknowledge a submitted notice in its registered synthetic internal queue',
    input: z.strictObject(cas),
    output: fnolViewSchema,
  },
} as const;
export type FnolOperationName = keyof typeof fnolOperations;
export const syntheticFnolDestination: FnolDestination = {
  id: 'synthetic_internal_intake',
  version: '1.0.0',
  label: 'Synthetic internal intake queue',
  kind: 'synthetic_internal_queue',
  sourceRefs: ['fixture://fnol/internal-training-intake-v1'],
  authority: 'internal_training_acknowledgement_only',
};
