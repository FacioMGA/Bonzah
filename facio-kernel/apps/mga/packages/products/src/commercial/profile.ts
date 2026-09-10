import type { FieldContract, RefinementFn, ValidationProfile } from '@facio/validation';
import { z } from 'zod';
import { commercialManifest } from './manifest.js';

const selectedCoverages = z.array(z.object({ coverage: z.string().trim().min(1).max(160), limit: z.number().finite().nonnegative(), excess: z.number().finite().nonnegative() }).strict()).min(1).max(100).refine((rows) => new Set(rows.map((row) => row.coverage)).size === rows.length, 'Select each coverage once');
const validateCoverageAndTerm: RefinementFn = (data, ctx, extras) => {
  const raw = extras.raw && typeof extras.raw === 'object' ? extras.raw as Record<string, unknown> : {};
  const commercial = raw.commercial && typeof raw.commercial === 'object' ? raw.commercial as Record<string, unknown> : {};
  const parsed = selectedCoverages.safeParse(commercial.coverages ?? data['commercial.coverages']);
  if (!parsed.success) ctx.addIssue({ code: 'custom', path: ['commercial.coverages'], message: parsed.error.issues[0]?.message || 'Select valid coverages' });
  const start = String(data['policy.startDate'] || ''), end = String(data['policy.endDate'] || '');
  if (start && end && end <= start) ctx.addIssue({ code: 'custom', path: ['policy.endDate'], message: 'Expiry must be after inception' });
};
const fields: Record<string, FieldContract> = {};
for (const section of commercialManifest.questionnaire.sections) for (const field of section.fields) {
  const rule = field.type === 'date' ? 'isoDate' : field.path === 'proposer.email' ? 'email' : field.path === 'commercial.turnover' ? 'nonNegativeMoney' : field.path === 'commercial.quantity' ? 'positiveMoney' : field.type === 'list' ? undefined : 'nonEmptyString';
  fields[field.path] = { path: field.path, label: field.label, ...(rule ? { rule } : {}), ...(field.required ? { required: true } : {}) };
}
const paths = Object.keys(fields);
export const commercialValidationProfile: ValidationProfile = {
  productCode: 'COMMERCIAL', fields,
  steps: commercialManifest.questionnaire.sections.map((section) => ({ id: section.id, fields: section.fields.map((field) => field.path), ...(section.id === 'commercial-risk' || section.id === 'acceptance' ? { refinements: [validateCoverageAndTerm] } : {}) })),
  stages: { draft: { fields: [] }, pricing: { fields: paths, refinements: [validateCoverageAndTerm] }, quote: { fields: paths, refinements: [validateCoverageAndTerm] }, bind: { fields: paths, refinements: [validateCoverageAndTerm] }, issuance: { fields: paths, refinements: [validateCoverageAndTerm] } },
};
