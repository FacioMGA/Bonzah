import { z } from 'zod';
import { productPricingFields } from './productPricing.js';
import { ambiguousQuestionAnswerKeys } from './questionIdentities.js';

const text = z.string().max(500);
const key = z.string().min(1).max(120).regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/);
const date = z.union([z.literal('today'), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
/** Complete shared QuestionSettings source vocabulary; no silent property stripping. */
export const questionSettingsSchema = z.object({
  placeholder: text.optional(), helpText: z.string().max(5000).optional(), groupName: text.optional(), introText: z.string().max(10000).optional(),
  minLength: z.number().int().nonnegative().optional(), maxLength: z.number().int().nonnegative().optional(),
  minNumber: z.number().finite().optional(), maxNumber: z.number().finite().optional(), decimalPlaces: z.number().int().min(0).max(12).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(), minDate: date.optional(), maxDate: date.optional(),
  minSelections: z.number().int().nonnegative().optional(), maxSelections: z.number().int().nonnegative().optional(),
  outputType: z.enum(['text', 'number', 'boolean']).optional(), documentRequired: z.boolean().optional(), showOnProposal: z.boolean().optional(),
  defaultValue: text.optional(), dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(), informationalOnly: z.boolean().optional(),
  groupPosition: z.number().int().nonnegative().optional(), questionPosition: z.number().int().nonnegative().optional(), formKey: key.optional(), policyComponent: z.literal('insured_interest').optional(),
}).strict();
export const proposalQuestionSchema = z.object({
  id: key, field: z.string().min(1).max(500), fieldHe: text.optional(), slug: key,
  body: z.string().max(10000).optional(), answerType: z.enum(['Short Text', 'Long Text', 'Number', 'Currency ($)', 'Date', 'Dropdown (Yes/No)', 'Dropdown', 'Radio (single choice)', 'Multi-select', 'Yes/No Matrix', 'Boolean', 'Instruction', 'Details List', 'Google Address', 'Business ID', 'Signature', 'Table', 'Rows', 'Repeatable']),
  options: z.array(text).max(500).optional(), coverage: text, binder: text.optional(), segment: text.optional(), section: text.optional(), openIf: text.optional(), required: z.boolean().optional(),
  rowFields: z.array(z.object({ field: text, slug: key, answerType: text.optional(), required: z.boolean().optional() }).strict()).max(100).optional(), addLabel: text.optional(),
  validation: text.optional(), libraryId: key.optional(), settings: questionSettingsSchema.optional(),
}).strict();
export const coverageSectionSchema = z.object({
  sectionLabel: text.optional(), classOfBusinessKey: text, classOfBusinessLabel: text.optional(), includedClauseIds: z.array(text).max(500), excludedClauseIds: z.array(text).max(500),
  territorialLimit: text, notes: z.string().max(10000), scheduleFields: z.record(z.string(), text).optional(),
  maxLimit: text.optional(), deductible: text.optional(), basisForCalculation: text.optional(), calculationRef: text.optional(), wordingSlug: text.optional(),
  coverageName: text.optional(), coverageName_he: text.optional(), ratingBasis: text.optional(), brokerCommissionPct: z.number().min(0).max(100).optional(),
  commissionBranchId: text.nullable().optional(),
  wordingFile: z.object({ name: text, size: z.number().int().nonnegative(), documentId: text.optional() }).strict().optional(),
}).strict();
const clause = z.object({
  id: key, coverageType: text, name: text, category: z.enum(['Exclusion', 'Extension', 'Clause', 'Risk Mitigation']),
  mode: z.enum(['Mandatory (Locked)', 'Mandatory (Removable)', 'Mandatory-Locked', 'Mandatory-Removable', 'Conditional']),
  linkedTo: text, status: z.enum(['Active', 'Inactive']), body: z.string().max(100000), isManual: z.boolean(), source: z.enum(['manual', 'ai', 'catalog']).optional(), allowManualWording: z.boolean().optional(),
}).strict();
const profession = z.object({
  section: text, profession: z.string().min(1).max(500), professionHe: text.optional(), branch: text.optional(), subBranch: text.optional(), segmentId: key.optional(), minExcess: text.optional(),
  calcMethod: z.enum(['Risk Code', 'Risk Matrices', 'To Be Defined Later']), riskCodesByCoverage: z.record(z.string(), text),
  segmentCalculation: z.object({ basis: z.enum(['turnover', 'headcount', 'flat']), ladder: z.array(z.object({ upTo: z.number().finite(), rate: z.number().finite() }).strict()).max(1000).optional(), fallbackRate: z.number().finite() }).strict().optional(),
}).strict();

/** Product-owned subset of Symphony BinderDetailsJson, not binder authority/party data. */
export const symphonyProductSchema = z.object({
  name: z.string().min(1).max(200), classOfBusinessKey: text.nullable(), status: z.enum(['Draft', 'Active', 'Inactive']), active: z.boolean(),
  coverageSections: z.array(coverageSectionSchema).max(100),
  details: z.object({
    businessBranches: z.array(z.object({ number: text, name: text }).strict()).max(500).optional(),
    wordingClauses: z.record(z.string(), z.array(clause).max(500)).optional(), professions: z.array(profession).max(5000).optional(),
    proposalQuestionGroups: z.array(z.object({ name: z.string().min(1).max(200), coverage: text.optional(), binder: text.optional(), segment: text.optional(), section: text.optional(), introText: z.string().max(10000).optional(), questions: z.array(proposalQuestionSchema).max(300) }).strict()).max(100),
    reviewComments: z.record(z.string(), z.string().max(10000)).optional(),
    risksLocatedIn: z.array(text).max(300).optional(), insuredsDomiciledIn: z.array(text).max(300).optional(), territorialLimits: z.array(text).max(300).optional(),
    ...productPricingFields,
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const questions = value.details.proposalQuestionGroups.flatMap((group) => group.questions);
  for (const field of ['id', 'slug'] as const) if (new Set(questions.map((question) => question[field])).size !== questions.length) ctx.addIssue({ code: 'custom', path: ['details', 'proposalQuestionGroups'], message: `Question ${field}s must be unique across the product.` });
  for (const key of ambiguousQuestionAnswerKeys(questions)) ctx.addIssue({ code: 'custom', path: ['details', 'proposalQuestionGroups'], message: `Question answer key ${key} is ambiguous: an ID or slug cannot belong to more than one question.` });
  for (const [index, question] of questions.entries()) {
    const settings = question.settings;
    for (const [minimum, maximum] of [['minLength', 'maxLength'], ['minNumber', 'maxNumber'], ['minSelections', 'maxSelections']] as const) if (settings?.[minimum] !== undefined && settings?.[maximum] !== undefined && settings[minimum]! > settings[maximum]!) ctx.addIssue({ code: 'custom', path: ['details', 'proposalQuestionGroups', index], message: `${minimum} cannot exceed ${maximum}.` });
  }
});
export type SymphonyProductConfiguration = z.infer<typeof symphonyProductSchema>;
