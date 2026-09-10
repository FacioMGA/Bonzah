// Top level imports
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bindPolicyHandler } from '../../../modules/policy/http/bindingRouter.js';
import { updatePolicyStatusHandler } from '../../../modules/policy/http/statusRouter.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { DocumentService } from '../../../modules/documents/app/documentService.js';
import { registerAllProducts } from '../../../products/registerProducts.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../products/testHelpers/tenantFixtures.js';

// Binding reserves a policy number via `reserveNextPolicyId` -> `getTenantConfig()`
// (ADR-0019: ALS-only). Production runs the handler inside the resolveOperatingTenant
// middleware; unit tests must supply the same ALS scope explicitly.
const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;

// Mocks
vi.mock('../../../platform/db/connection.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../platform/db/connection.js')>();
    const mockPrisma = {
        ...actual.prisma,
        policy: {
            findUnique: vi.fn(),
            findFirst: vi.fn(async () => null),
            update: vi.fn(),
        },
        programBinderLink: {
            findFirst: vi.fn(async () => ({ id: 'pbl-1' })),
        },
        policyNumberSequence: {
            upsert: vi.fn(async () => ({ next: 1_000_002 })),
        },
        binder: {
            findFirst: vi.fn(async () => ({ id: 'binder-1', defaultCurrency: 'EUR' })),
            findUnique: vi.fn(async () => ({
                id: 'binder-1',
                status: 'ACTIVE',
                umr: 'B176026EEA6152',
                startDate: new Date('2026-01-01T00:00:00.000Z'),
                endDate: new Date('2026-12-31T23:59:59.999Z'),
                config: {},
            })),
        },
        binderFinancials: {
            findUnique: vi.fn(async () => null),
        },
        endorsementInstance: {
            count: vi.fn(async () => 0),
        },
        policyStateCurrent: {
            findUnique: vi.fn(),
            update: vi.fn(),
            upsert: vi.fn(),
        },
        endorsement: {
            findFirst: vi.fn(),
            create: vi.fn(),
        },
        policySearchIndex: {
            upsert: vi.fn(),
        },
        policyListIndex: {
            findUnique: vi.fn(async () => null),
            upsert: vi.fn(async () => ({})),
            update: vi.fn(async () => ({})),
        },
        document: {
            create: vi.fn(),
        },
        invoice: {
            create: vi.fn(async () => ({ id: 'inv-1' })),
        },
        riskTransaction: {
            findFirst: vi.fn(async () => null),
            create: vi.fn(async () => ({ id: 'rt-1' })),
            update: vi.fn(async () => ({ id: 'rt-1', status: 'BOUND' })),
        },
        premiumTransaction: {
            create: vi.fn(async () => ({ id: 'pt-1' })),
        },
        program: {
            findFirst: vi.fn(async () => ({ id: 'prog-1', status: 'ACTIVE', metadata: {} })),
            findUnique: vi.fn(async () => ({ id: 'prog-1', status: 'ACTIVE', metadata: {} })),
        },
        auditAction: {
            create: vi.fn(),
        },
        policyLifecycleEvent: {
            create: vi.fn(),
        },
        domainEvent: {
            create: vi.fn(),
        },
        outbox: {
            create: vi.fn(),
        },
        // ABY-345: certificate / green-card reservation floors against the
        // GLOBAL numeric max via a raw query. No existing numeric rows here.
        $queryRawUnsafe: vi.fn(async () => [{ max: null }]),
        $transaction: vi.fn((callback) => callback(mockPrisma)),
    };
    return {
        ...actual,
        prisma: mockPrisma,
        tenantScopedPrisma: {
            ...actual.tenantScopedPrisma,
            $transaction: mockPrisma.$transaction,
            policy: mockPrisma.policy,
            policyStateCurrent: mockPrisma.policyStateCurrent,
            riskTransaction: mockPrisma.riskTransaction,
            invoice: mockPrisma.invoice,
            premiumTransaction: mockPrisma.premiumTransaction,
            endorsementInstance: mockPrisma.endorsementInstance,
            policyListIndex: mockPrisma.policyListIndex,
            policySearchIndex: mockPrisma.policySearchIndex,
        },
    };
});

vi.mock('../../../modules/documents/app/documentService.js', () => ({
    DocumentService: { generate: vi.fn() }
}));

vi.mock('../../../modules/quotes/app/validator.js', () => ({
    validateDraftQuote: vi.fn().mockReturnValue({ valid: true, normalizedQuoteData: {} })
}));

// `executeBindPolicy` now delegates the validation/pricing/UW gate to the
// canonical `evaluateIssueReadiness` function. The test exercises the bind
// transaction itself, so we stub the gate to "OK" — the readiness path has
// its own dedicated unit tests.
vi.mock('../../../modules/policy/domain/issueReadiness.js', () => ({
    evaluateIssueReadiness: vi.fn(async () => ({
        canIssue: true,
        canGenerateQuotePack: true,
        canGenerateIssuedDocs: true,
        blockers: [],
        missingFields: [],
        conditionalRequirements: [],
        derived: {
            hasQuoteData: true,
            hasQuoteResponse: true,
            hasPaymentConfirmed: true,
            hasBoundInceptionTransaction: false,
            hasIssuedPackDocuments: false,
            hasWelcomeEmailSent: false,
            isLocked: false,
            hasUwCompleted: true,
            pricingHashMatches: true,
            missingForQuotePack: [],
            missingForIssuedPack: [],
            missingIssuedDocumentTypes: [],
        },
        uwState: 'COMPLETE',
        uwStateMeta: { hasOpenFollowUps: false, openFollowUpsCount: 0, isQuoteReady: true },
    })),
}));

vi.mock('../../../modules/compliance/app/index.js', () => ({
    getSanctionsService: () => ({
        assertClearOrThrow: vi.fn(async () => ({ canBind: true })),
    }),
    resolveIndividualScreeningSubject: vi.fn(() => ({ subjectName: 'Test', dateOfBirth: '1985-05-05' })),
    SanctionsBlockError: class extends Error {},
}));

describe('Binding Integrity via bindPolicyHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerAllProducts();
    });



    it('should SUCCESS binding if document generation succeeds', async () => {
        const req = { params: { id: 'policy-123' }, user: { id: 'u1' } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

        vi.mocked(tenantScopedPrisma.policy.findUnique).mockImplementation(async () => ({
            id: 'policy-123',
            status: 'QUOTED',
            policyNumber: 'ABQ1000001',
            productType: 'MOTOR',
            programId: 'prog-1',
            policyHolder: { name: 'Test' },
            quoteData: { renewalDate: new Date().toISOString() },
            // After Wave 1 of `spine/v2`, BindPolicy refuses to compute a
            // premium fallback; the rated snapshot must already carry one.
            quoteResponse: { primaryOption: { annualPremium: 500 }, currency: 'EUR' },
            inceptionDate: new Date(),
            expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
            binder: { defaultCurrency: 'EUR' },
        }));

        vi.mocked(tenantScopedPrisma.policy.update).mockImplementation(async () => ({
            id: 'policy-123',
            status: 'ACTIVE',
            policyNumber: 'B0001202400123',
            inceptionDate: new Date(),
            expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
            updatedAt: new Date(),
        }));

        vi.mocked(DocumentService.generate).mockResolvedValue({
            version: 1,
            documents: [
                { id: 'doc-1', type: 'MOTOR_CERTIFICATE_PDF', storageUri: 'http://doc-url.com', filename: 'cert.pdf', fileHash: 'hash', status: 'GENERATED', version: 1 }
            ]
        });

        await runWithOperatingTenant(cyTenant, () => bindPolicyHandler(req, res));

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true
        }));
    });
});

describe('Immutability via updatePolicyStatusHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should reject updates to BOUND policies', async () => {
        const reqBlocked = { params: { id: 'policy-123' }, body: { inceptionDate: '2025-01-01' } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

        vi.mocked(tenantScopedPrisma.policy.findUnique).mockImplementation(async () => ({
            id: 'policy-123',
            status: 'BOUND'
        }));

        await runWithOperatingTenant(cyTenant, () => updatePolicyStatusHandler(reqBlocked, res));

        expect(res.status).toHaveBeenCalledWith(403);
        expect(tenantScopedPrisma.policy.update).not.toHaveBeenCalled();
    });
});
