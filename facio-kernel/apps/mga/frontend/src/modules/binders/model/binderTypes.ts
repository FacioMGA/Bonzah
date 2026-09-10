
import { z } from 'zod';

// --- 1. Core Agreement (The Master Record) ---

export const CoreAgreementSchema = z.object({
    agreementNumber: z.string().min(1, "Agreement Number is required"),
    umr: z.string().regex(/^B\d+[A-Z0-9]+$/, "UMR must follow Lloyd's format (e.g. B1234XYZ)"),
    status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'ARCHIVED', 'PENDING']),
    period: z.object({
        inceptionDate: z.string().datetime().or(z.date().transform(d => d.toISOString())),
        expiryDate: z.string().datetime().or(z.date().transform(d => d.toISOString()))
    }).refine(data => new Date(data.expiryDate) > new Date(data.inceptionDate), {
        message: "Expiry date must be after inception date",
        path: ["expiryDate"]
    }),
    coverholders: z.array(z.object({
        id: z.string().uuid().optional(), // Links to Entity ID
        name: z.string(),
        role: z.enum(['Primary', 'Secondary']).default('Primary')
    })).min(1, "At least one coverholder is required"),
    lloydsBroker: z.object({
        id: z.string().uuid().optional(), // Links to Entity ID
        name: z.string()
    })
});

export type CoreAgreement = z.infer<typeof CoreAgreementSchema>;

// --- 2. Underwriting Authority (The Guardrails) ---

export const ClassOfBusinessSchema = z.enum(['TPBI', 'TPPD', 'OD', 'PA', 'LE', 'GLASS']);

export const UnderwritingAuthoritySchema = z.object({
    authorizedClasses: z.array(ClassOfBusinessSchema).min(1, "At least one class of business is required"),
    territorialLimits: z.array(z.string()).min(1, "At least one territory is required"),
    maxAdvanceInceptionDays: z.number().int().min(0).max(365).default(90),
    maxPolicyPeriodMonths: z.number().int().min(1).max(36).default(12),
    coverholder1MaxMaterialDamage: z.number().min(0).optional(),
    coverholder2MaxMaterialDamage: z.number().min(0).optional(),
    maxInsuredValueByActor: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
    limitsOfLiability: z.record(
        z.string(), // Key is Coverholder ID (or 'default')
        z.object({
            materialDamageMax: z.number().min(0),
            tppdMax: z.number().min(0).optional(),
            tpbiMax: z.number().min(0).optional(),
            currency: z.enum(['EUR', 'USD', 'GBP']).default('EUR')
        })
    )
});

export type UnderwritingAuthority = z.infer<typeof UnderwritingAuthoritySchema>;

export const BinderScopeSchema = z.object({
    authorizedClass: z.string().optional(),
    authorizedCoverages: z.array(z.string()).optional(),
    excludedClasses: z.array(z.string()).optional(),
    riskLocationCountries: z.array(z.string()).optional(),
    insuredDomicileCountries: z.array(z.string()).optional(),
    territorialLimitCountries: z.array(z.string()).optional(),
});

// --- 3. Financials & Capacity (The Live Radar) ---

export const FinancialControlsSchema = z.object({
    premiumCalculationBasis: z.string().optional(),
    deductiblesBasis: z.string().optional(),
    grossPremiumIncomeLimit: z.number().min(0, "GPI Limit must be positive"),
    currency: z.enum(['EUR', 'USD', 'GBP']).default('EUR'),
    notifiablePercentage: z.number().min(0).max(100).optional(),
    warningThresholdPercentage: z.number().min(1).max(100).default(85),
    coverholderCommissionRate: z.number().min(0).max(100),
    brokerageRate: z.number().min(0).max(100).default(0),
    profitCommissionRate: z.number().min(0).max(100).default(0),
    profitCommissionDescription: z.string().optional(),
    premiumTaxRate: z.number().min(0).max(100).default(0) // Optional standard tax
});

export type FinancialControls = z.infer<typeof FinancialControlsSchema>;

// --- 4. Claims & Bordereaux Operations (The Automator) ---


export const PersonnelSchema = z.object({
    opsControl: z.array(z.string()).optional(),
    authorisedToBind: z.array(z.string()).optional(),
    docsResponsible: z.array(z.string()).optional()
});


export const ConditionsSchema = z.object({
    territoryRegulationRequirement: z.boolean().default(false),
    euEeaCustomerRequirement: z.boolean().default(false),
    territorialApproval: z.boolean().default(false),
    crystalUsageRequirement: z.boolean().default(false),
    preContractualCompliance: z.boolean().default(false),
    businessPlanApproval: z.boolean().default(false),
    cypriotLaw2016Notice: z.boolean().default(false),
    applicableClauses: z.array(z.string()).optional(),
    dataRequirementsFormat: z.string().optional(),
    coverholder1Roles: z.string().optional(),
    coverholder2Roles: z.string().optional()
});

export const DelegatedOperationsSchema = z.object({
    claims: z.object({
        claimsAuthorityGranted: z.boolean().default(false),
        claimsAuthorityPersons: z.string().optional(),
        authorizedTPA: z.object({
            id: z.string().uuid().optional(),
            name: z.string()
        }).optional(),
        tpaName: z.string().optional(), // Fallback for simple string
        tpaAuthorityLimit: z.number().min(0).default(0),
        claimsFundLimit: z.number().min(0).default(0),
        largeLossThreshold: z.number().min(0).optional(),
        workingDaysJurisdiction: z.string().optional(),
        largeLossContact: z.string().optional(),
        complaintsAuthority: z.boolean().default(false),
        managingAgentComplaintsEmail: z.string().email().optional().or(z.literal(''))
    }),
    reporting: z.object({
        riskInfoSubmissionRole: z.string().optional(),
        paidPremSubmissionRole: z.string().optional(),
        claimsSubmissionRole: z.string().optional(),
        contractTransformationRole: z.string().optional(),

        riskReportingInterval: z.string().optional(),
        riskReportingDeadlineDays: z.number().int().min(0).default(15),

        premReportingInterval: z.string().optional(),
        premReportingDeadlineDays: z.number().int().min(0).default(30),

        claimsReportingInterval: z.string().optional(),
        claimsReportingDeadlineDays: z.number().int().min(0).default(30),

        // Backend-used reporting config
        writtenRiskSchedule: z.string().optional(),
        paidClaimsSchedule: z.string().optional(),
        bordereauFormat: z.string().optional(),
        destination: z.string().optional(),
        reportingContacts: z.string().optional()
    })
});

export type DelegatedOperations = z.infer<typeof DelegatedOperationsSchema>;

// --- 5. Documentation & Data ---


export const SignatoriesSchema = z.object({
    coverholder1Signatory: z.string().optional(),
    coverholder2Signatory: z.string().optional(),
    serviceProviderSignatory: z.string().optional()
});

export const DocumentationSchema = z.object({
    proposalForms: z.string().optional(),
    policyWordings: z.array(z.string()).optional(),
    certificateFormat: z.string().optional(),
    combinedCertificatesPermitted: z.boolean().default(false),
    manufacturerRoles: z.object({
        productApproval: z.string().optional(),
        targetMarket: z.string().optional(),
        productTesting: z.string().optional(),
        monitoring: z.string().optional(),
        distribution: z.string().optional(),
        ipid: z.string().optional(),
    }).optional()
});

export type DocumentationConfig = z.infer<typeof DocumentationSchema>;

// --- 7. Settlement & Termination ---

export const SettlementSchema = z.object({
    remittanceDays: z.number().int().min(0).default(30),
    dataProcessorActivities: z.string().optional()
});

export type SettlementConfig = z.infer<typeof SettlementSchema>;

export const TerminationSchema = z.object({
    noticeDays: z.number().int().min(0).default(90),
    noticeIssuer: z.string().optional(),
    recipient: z.object({
        name: z.string().optional(),
        email: z.string().email().optional().or(z.literal(''))
    }).optional(),
    copyTo: z.object({
        name: z.string().optional(),
        email: z.string().email().optional().or(z.literal(''))
    }).optional()
});

export type TerminationConfig = z.infer<typeof TerminationSchema>;

// --- 8. The Full Binder Configuration ---

export const BinderConfigSchema = z.object({
    agreement: CoreAgreementSchema,
    scope: BinderScopeSchema.optional(),
    authority: UnderwritingAuthoritySchema,
    financials: FinancialControlsSchema,
    personnel: PersonnelSchema.optional(),
    conditions: ConditionsSchema.optional(),
    operations: DelegatedOperationsSchema,
    signatories: SignatoriesSchema.optional(),
    documentation: DocumentationSchema.optional(),
    settlement: SettlementSchema.optional(),
    termination: TerminationSchema.optional(),
    // Catch-all for extra implementation-specific config (metadata, templates, etc.)
    meta: z.record(z.string(), z.unknown()).optional()
});

export type BinderConfig = z.infer<typeof BinderConfigSchema>;

// --- 6. API Payloads ---

// Used for POST/PUT /api/binders
export const CreateUpdateBinderSchema = z.object({
    agreementNumber: z.string().optional(), // Persisted column; usually derived from config.agreement at write time.
    coverholderName: z.string().optional(),
    startDate: z.string().datetime().or(z.date()).optional(),
    endDate: z.string().datetime().or(z.date()).optional(),
    status: z.string().optional(),
    config: BinderConfigSchema // The new strict schema
});
