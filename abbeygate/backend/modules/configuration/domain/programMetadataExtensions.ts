import { z } from 'zod';

/**
 * Application-layer types + Zod schemas for the four `Program.metadata`
 * extension keys writable by Config MCP V1 (ADR-0038).
 *
 * Closed allowlist (declared in canonical-ownership row "Program metadata
 * extension keys (Config MCP V1)"):
 *
 *   - questionnaireOverrides  (this file)
 *   - approvalRules           (this file)
 *   - jurisdictionOverrides   (this file)
 *   - billing                 (this file)
 *
 * Plus the two pre-existing keys (abbeygateMotorUwConfig, mbeProductConfig)
 * whose canonical types live in their owning modules.
 *
 * No other module may add new top-level keys to Program.metadata via
 * Config MCP — enforced by `tools/quality/check-configuration-overlay-bounds.mjs`.
 */

// ---------------------------------------------------------------------
// Stage tokens shared across overrides
// ---------------------------------------------------------------------
export const QUESTIONNAIRE_STAGES = ['quote', 'bind', 'endorsement', 'claim_fnol'] as const;
export const DOCUMENT_STAGES = ['quote', 'bind', 'endorsement', 'cancellation'] as const;
export const APPROVAL_WORKFLOWS = ['quote_referral', 'endorsement', 'cancellation', 'claim_payment'] as const;

// ---------------------------------------------------------------------
// QuestionnaireOverrides — tighten-only requiredness overlay
// ---------------------------------------------------------------------
export const QuestionnaireOverridesSchema = z
    .object({
        requiredAt: z
            .record(
                z.string().min(1), // canonical question path
                z.array(z.enum(QUESTIONNAIRE_STAGES)).min(1),
            )
            .optional(),
    })
    .strict();
export type QuestionnaireOverrides = z.infer<typeof QuestionnaireOverridesSchema>;

// ---------------------------------------------------------------------
// ApprovalRuleEntry — programmable workflow approval rule
// ---------------------------------------------------------------------
export const ApprovalRuleConditionSchema = z
    .object({
        field: z.string().min(1),
        operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'in']),
        value: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.array(z.string()),
            z.array(z.number()),
        ]),
    })
    .strict();

export const ApprovalRuleEntrySchema = z
    .object({
        workflow: z.enum(APPROVAL_WORKFLOWS),
        ruleKey: z.string().min(1),
        name: z.string().min(1),
        condition: ApprovalRuleConditionSchema,
        requiredRole: z.string().min(1),
    })
    .strict();
export type ApprovalRuleEntry = z.infer<typeof ApprovalRuleEntrySchema>;

// ---------------------------------------------------------------------
// JurisdictionOverrides — document toggle overlay
// ---------------------------------------------------------------------
export const DOCUMENT_TYPES = [
    'certificate',
    'schedule',
    'statement_of_fact',
    'green_card',
    'invoice',
    'receipt',
] as const;

export const ISSUANCE_TRIGGERS = ['manual', 'on_bind', 'on_payment_received', 'on_request'] as const;

export const JurisdictionDocumentOverrideSchema = z
    .object({
        documentType: z.enum(DOCUMENT_TYPES),
        requiredAt: z.array(z.enum(DOCUMENT_STAGES)).optional(),
        issuanceTrigger: z.enum(ISSUANCE_TRIGGERS).optional(),
    })
    .strict();
export type JurisdictionDocumentOverride = z.infer<typeof JurisdictionDocumentOverrideSchema>;

export const JurisdictionOverridesSchema = z
    .object({
        documentConfig: z.array(JurisdictionDocumentOverrideSchema).optional(),
    })
    .strict();
export type JurisdictionOverrides = z.infer<typeof JurisdictionOverridesSchema>;

// ---------------------------------------------------------------------
// ProgramBillingTerms — non-numeric billing posture
// ---------------------------------------------------------------------
export const PAYMENT_TERMS = ['pay_before_bind', 'invoice_after_bind', 'installments'] as const;
export const CANCELLATION_REFUND_BASES = ['pro_rata', 'short_rate', 'manual_review'] as const;

export const ProgramBillingTermsSchema = z
    .object({
        paymentTerms: z.enum(PAYMENT_TERMS).optional(),
        cancellationRefundBasis: z.enum(CANCELLATION_REFUND_BASES).optional(),
        nonRefundableFees: z.array(z.string().min(1)).optional(),
    })
    .strict();
export type ProgramBillingTerms = z.infer<typeof ProgramBillingTermsSchema>;

// ---------------------------------------------------------------------
// Closed allowlist of writable Program.metadata top-level keys
// (consumed by the check-configuration-overlay-bounds guard).
// ---------------------------------------------------------------------
export const CONFIG_MCP_METADATA_KEYS = [
    'abbeygateMotorUwConfig',
    'mbeProductConfig',
    'questionnaireOverrides',
    'approvalRules',
    'jurisdictionOverrides',
    'billing',
] as const;

export type ConfigMcpMetadataKey = (typeof CONFIG_MCP_METADATA_KEYS)[number];
