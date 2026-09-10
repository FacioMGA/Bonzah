
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { bindPolicyHandler } from '../../../modules/policy/http/bindingRouter.js';
import { TEST_QUOTE_DATA } from '../../../platform/test/fixtures/testQuote.js';
import { registerAllProducts } from '../../../products/registerProducts.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../products/testHelpers/tenantFixtures.js';

// Binding reserves a policy number via `reserveNextPolicyId` -> `getTenantConfig()`
// (ADR-0019: ALS-only). Production runs the handler inside the resolveOperatingTenant
// middleware; unit tests must supply the same ALS scope explicitly.
const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;

// Mock dependencies
vi.mock('../../../platform/db/connection.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../platform/db/connection.js')>();
    const mockPrisma = {
        ...actual.prisma,
        policy: {
            findUnique: vi.fn(),
            findFirst: vi.fn(async () => null),
            update: vi.fn()
        },
        programBinderLink: {
            findFirst: vi.fn(async () => ({ id: 'pbl-1' })),
        },
        policyNumberSequence: {
            upsert: vi.fn(async () => ({ next: 1_000_002 })), // reserves 1_000_001
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
            upsert: vi.fn()
        },
        policySearchIndex: {
            upsert: vi.fn()
        },
        policyListIndex: {
            findUnique: vi.fn(async () => null),
            upsert: vi.fn(async () => ({})),
            update: vi.fn(async () => ({})),
        },
        endorsement: {
            findFirst: vi.fn(),
            create: vi.fn()
        },
        document: {
            create: vi.fn()
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
        outbox: {
            create: vi.fn(async () => ({ id: 'outbox-1' })),
        },
        // ABY-345: certificate / green-card reservation floors against the
        // GLOBAL numeric max via a raw query (bypasses the tenant extension).
        // No existing numeric rows in this unit context, so floor at base.
        $queryRawUnsafe: vi.fn(async () => [{ max: null }]),
        $transaction: vi.fn(async (callback) => await callback(mockPrisma))
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

vi.mock('../../../platform/audit/logger.js', () => ({
    AuditLogger: { log: vi.fn() }
}));

// `executeBindPolicy` now delegates the validation/pricing/UW gate to the
// canonical `evaluateIssueReadiness` function. This handler-level test
// exercises the bind transaction; the readiness gate has its own unit tests.
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

vi.mock('../../../modules/documents/app/documentService.js', () => ({
    DocumentService: {
        generate: vi.fn(async () => ({
            version: 1,
            documents: [
                { id: 'doc-1', type: 'MOTOR_CERTIFICATE_PDF', storageUri: 'http://mock-cert.pdf', filename: 'cert.pdf', fileHash: 'hash', status: 'GENERATED', version: 1 }
            ]
        }))
    }
}));

vi.mock('../../../modules/compliance/app/index.js', () => ({
    getSanctionsService: () => ({
        assertClearOrThrow: vi.fn(async () => ({ canBind: true })),
    }),
    resolveIndividualScreeningSubject: vi.fn(() => ({ subjectName: 'Acme', dateOfBirth: '1985-05-05' })),
    SanctionsBlockError: class extends Error {},
}));

describe('bindPolicyHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerAllProducts();
    });

    const mockRes = () => {
        const res: { status?: ReturnType<typeof vi.fn>; json?: ReturnType<typeof vi.fn> } = {};
        res.status = vi.fn().mockReturnValue(res);
        res.json = vi.fn().mockReturnValue(res);
        return res;
    };

    it('rejects binding for invalid status', async () => {
        vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
            id: 'pol-1',
            // Use a status that is explicitly NOT allowed for binding.
            status: 'CANCELLED'
        });

        const req = { params: { id: 'pol-1' }, user: { id: 'u1' } };
        const res = mockRes();

        await runWithOperatingTenant(cyTenant, () => bindPolicyHandler(req, res));

        expect(res.status).toHaveBeenCalledWith(400);
        // Relaxed match for error message
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false
        }));
    });

    it('binds policy successfully', async () => {
        vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
            id: 'pol-1',
            status: 'QUOTED',
            policyNumber: 'ABQ1000001',
            productType: 'MOTOR',
            programId: 'prog-1',
            inceptionDate: new Date(),
            expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
            policyHolder: { name: 'Acme' },
            binder: { defaultCurrency: 'EUR' },
            quoteData: {
                ...TEST_QUOTE_DATA,
                country: 'Cyprus',
                renewalDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
            },
            // After Wave 1 of `spine/v2`, BindPolicy refuses to compute a
            // premium fallback; the rated snapshot must already carry one.
            quoteResponse: { primaryOption: { annualPremium: 5000 }, currency: 'EUR' },
        });

        vi.mocked(tenantScopedPrisma.policyStateCurrent.findUnique).mockResolvedValue({
            policyId: 'pol-1',
            snapshot: JSON.stringify({
                smartUwFormData: {
                    itemsStoredValue: '10000',
                    // motor-only: legacy depositAmount removed
                }
            })
        });

        vi.mocked(tenantScopedPrisma.policy.update).mockResolvedValue({
            id: 'pol-1',
            policyNumber: 'POL-001',
            status: 'ACTIVE',
            inceptionDate: new Date(),
            expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
            updatedAt: new Date(),
        });

        const req = { params: { id: 'pol-1' }, user: { id: 'u1' } };
        const res = mockRes();

        await runWithOperatingTenant(cyTenant, () => bindPolicyHandler(req, res));

        // Assert Success
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({
                id: 'pol-1',
                policyNumber: 'POL-001',
                status: 'ISSUING',
                documentJobId: expect.any(String),
            })
        }));

        // Verify Snapshot update (re-calculated premium)
        // Expect object since jsonStringify is mock/identity in policies.ts
        expect(tenantScopedPrisma.policyStateCurrent.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { policyId: 'pol-1' },
            data: expect.objectContaining({
                snapshot: expect.objectContaining({
                    premium: 5000,
                    status: expect.any(String)
                })
            })
        }));
    });
});
