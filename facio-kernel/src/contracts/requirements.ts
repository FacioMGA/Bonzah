import { z } from 'zod';
import { categoryIds, id, scopeSchema } from './configuration.js';

const text = z.string().trim().min(1).max(4000);
const title = z.string().trim().min(1).max(200);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const requirementsProfileSchema = z.strictObject({
  id,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title,
  sources: z
    .array(
      z.strictObject({
        id,
        title,
        version: title.nullable(),
        capturedAt: z.string().datetime(),
        sha256,
        location: text,
        sourceBoundary: text,
      }),
    )
    .min(1)
    .max(100),
  requirements: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/),
        title,
        categories: z.array(z.enum(categoryIds)).min(1).max(categoryIds.length),
        expectedOutcome: text,
        priority: z.enum(['mandatory', 'optional', 'unresolved']),
        sourceRefs: z
          .array(z.strictObject({ sourceId: id, locator: text }))
          .min(1)
          .max(100),
        dependencies: z.array(text).max(100),
        sourceBoundary: text,
      }),
    )
    .min(1)
    .max(500),
});
export type RequirementsProfile = z.infer<typeof requirementsProfileSchema>;

/** A versioned source package supplied by the trusted composition root, never by API input. */
export const scopedRequirementsProfileSchema = z.strictObject({
  scope: scopeSchema,
  sourceProfileHash: sha256,
  profile: requirementsProfileSchema,
});
export type ScopedRequirementsProfile = z.infer<typeof scopedRequirementsProfileSchema>;

const evidenceBoundary = {
  scope: scopeSchema,
  runtimeStatus: z.literal('pending_evidence'),
  acceptanceStatus: z.literal('not_recorded'),
};
export const requirementsReportSchema = z.discriminatedUnion('sourceStatus', [
  z.strictObject({
    ...evidenceBoundary,
    sourceStatus: z.literal('source_attached'),
    sourceProfileHash: sha256,
    profile: requirementsProfileSchema,
    sourceClaimsStatus: z.literal('unverified').optional(),
  }),
  z.strictObject({
    ...evidenceBoundary,
    sourceStatus: z.literal('source_not_attached'),
    sourceProfileHash: z.null(),
    profile: z.null(),
  }),
]);
export type RequirementsReport = z.infer<typeof requirementsReportSchema>;
