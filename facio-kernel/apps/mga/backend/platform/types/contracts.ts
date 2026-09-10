import { z } from 'zod';
import { quoteDataInputSchema } from '../../modules/policy/app/quoteDataSchema.js';
const unknownRecordSchema = z.record(z.string(), z.unknown());

export const quoteOptionSchema = z.object({
  name: z.string(),
  annualPremium: z.number(),
  monthlyPremium: z.number().optional(),
  compulsoryExcess: z.number().optional(),
  voluntaryExcess: z.number().optional(),
  totalExcess: z.number(),
  tag: z.string().optional(),
  description: z.string().optional(),
  breakdown: z.unknown().optional(),
  costDetails: z.unknown().optional(),
  calculationTrace: z.unknown().optional(),
});

export const quoteResponseSchema = z.object({
  reference: z.string(),
  currency: z.string(),
  primaryOption: quoteOptionSchema,
  alternatives: z.array(quoteOptionSchema),
  warnings: z.array(z.string()).optional().default([]),
  validUntil: z.string().optional().default(''),
  status: z.enum(['quoted', 'referral', 'declined']),
  referralMessage: z.string().optional(),
});

export const quoteDataSchema = quoteDataInputSchema;

export const policySnapshotSchema = z.object({
  quoteData: quoteDataSchema.optional().default({}),
  quoteResponse: quoteResponseSchema.nullish(),
  compliance: unknownRecordSchema.optional().default({}),
  paymentInfo: unknownRecordSchema.optional().default({}),
  underwriting: unknownRecordSchema.optional().default({}),
});

export const issueBlockerActionSchema = z.object({
  label: z.string(),
  actionId: z
    .enum([
      'BO.RECALC_PREMIUM',
      'BO.OPEN_CUSTOMER_QUOTE',
      'BO.OPEN_PAYMENT',
      'BO.SEND_QUESTIONNAIRE',
      'BO.MANUAL_UW_APPROVAL',
      'CUSTOMER.GO_TO_STEP',
    ])
    .optional(),
  href: z.string().optional(),
  hash: z.string().optional(),
});

export const issueBlockerSchema = z.object({
  code: z.string(),
  message: z.string(),
  group: z.enum(['STATUS', 'PRICING', 'UNDERWRITING', 'DOCUMENTS', 'PAYMENT', 'LOCK', 'OTHER']).optional(),
  severity: z.enum(['BLOCK', 'WARN']).optional(),
  actions: z.array(issueBlockerActionSchema).optional(),
  details: unknownRecordSchema.optional(),
});

export const issueReadinessResultSchema = z.object({
  channel: z.enum(['bo', 'customer']),
  policyId: z.string(),
  status: z.string(),
  canIssue: z.boolean(),
  canGenerateQuotePack: z.boolean(),
  canGenerateIssuedDocs: z.boolean(),
  // ADR-0017 — `failed` is a terminal customer-facing outcome (worker
  // recorded a permanent failure paymentEvent newer than any generated
  // ISSUED_POLICY_PACK document). The wizard reads this to stop
  // polling and surface an operator-contact recovery state.
  customerOutcome: z.enum(['issued', 'pending', 'failed']).optional(),
  missingFields: z.array(
    z.object({
      slug: z.string(),
      label: z.string(),
      customerHash: z.string().optional(),
      boTab: z.string().optional(),
    })
  ),
  conditionalRequirements: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      severity: z.enum(['BLOCK', 'WARN']).optional(),
      details: unknownRecordSchema.optional(),
    })
  ),
  blockers: z.array(issueBlockerSchema),
  diagnostics: z
    .object({
      validation: z.array(
        z.object({
          productType: z.string().optional(),
          field: z.string(),
          validator: z.string(),
          readPath: z.string(),
          actualValuePresent: z.boolean().optional(),
          blocking: z.boolean(),
          message: z.string().optional(),
        })
      ),
    })
    .optional(),
  uwState: z.enum(['NOT_STARTED', 'CUSTOMER_STARTED', 'UW_STARTED', 'QUESTIONNAIRE_SENT', 'FOLLOWUPS_OPEN', 'QUOTE_READY']),
  uwStateMeta: z.object({
    questionnaireSentAt: z.string().optional(),
    customerStartedAt: z.string().optional(),
    uwStartedAt: z.string().optional(),
    followUpsSentAt: z.string().optional(),
    hasOpenFollowUps: z.boolean(),
    openFollowUpsCount: z.number(),
    lastSavedBy: z.enum(['customer', 'underwriter', 'system']).optional(),
    lastSavedByName: z.string().optional(),
    lastSavedAt: z.string().optional(),
    isQuoteReady: z.boolean(),
    lastModifiedBy: z.string().optional(),
  }),
  blockerGroups: z
    .array(
      z.object({
        group: z.enum(['STATUS', 'PRICING', 'UNDERWRITING', 'DOCUMENTS', 'PAYMENT', 'LOCK', 'OTHER']),
        blockers: z.array(issueBlockerSchema),
      })
    )
    .optional(),
  derived: z.object({
    hasQuoteData: z.boolean(),
    hasQuoteResponse: z.boolean(),
    hasPaymentConfirmed: z.boolean(),
    hasBoundInceptionTransaction: z.boolean(),
    hasIssuedPackDocuments: z.boolean(),
    hasWelcomeEmailSent: z.boolean(),
    isLocked: z.boolean(),
    hasUwCompleted: z.boolean(),
    pricingHashMatches: z.boolean(),
    missingForQuotePack: z.array(
      z.object({
        slug: z.string(),
        label: z.string(),
        customerHash: z.string().optional(),
        boTab: z.string().optional(),
      })
    ),
    missingForIssuedPack: z.array(
      z.object({
        slug: z.string(),
        label: z.string(),
        customerHash: z.string().optional(),
        boTab: z.string().optional(),
      })
    ),
    missingIssuedDocumentTypes: z.array(z.string()),
  }),
});

export type QuoteOptionDTO = z.infer<typeof quoteOptionSchema>;
export type QuoteResponseDTO = z.infer<typeof quoteResponseSchema>;
export type QuoteDataDTO = z.infer<typeof quoteDataSchema>;
export type PolicySnapshotDTO = z.infer<typeof policySnapshotSchema>;
export type IssueReadinessResultDTO = z.infer<typeof issueReadinessResultSchema>;
