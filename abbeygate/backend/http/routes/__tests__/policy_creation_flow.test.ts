
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { createPolicyHandler } from '../../../modules/policy/http/mutationsRouter.js';

const mocks = vi.hoisted(() => ({
    findLatestActiveBinderLinkForProduct: vi.fn(),
}));

vi.mock('../../../modules/policy/app/binders/binderAuthority.js', () => ({
    findLatestActiveBinderLinkForProduct: mocks.findLatestActiveBinderLinkForProduct,
    assertBinderAuthorizesProduct: vi.fn(),
    BinderAuthorityError: class BinderAuthorityError extends Error {},
}));

// Mock dependencies
vi.mock('../../../platform/db/connection.js', () => {
    const prisma = {
        policy: {
            create: vi.fn(),
            findUnique: vi.fn(),
            update: vi.fn()
        },
        policyHolder: {
            findUnique: vi.fn(),
            create: vi.fn()
        },
        policySearchIndex: {
            upsert: vi.fn()
        },
        policyStateCurrent: {
            upsert: vi.fn()
        },
        $transaction: vi.fn(async (callback) => await callback(prisma))
    };
    return { prisma, tenantScopedPrisma: prisma };
});

vi.mock('../../../platform/audit/logger.js', () => ({
    AuditLogger: { log: vi.fn() }
}));

describe('createPolicyHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findLatestActiveBinderLinkForProduct.mockResolvedValue({
            programId: 'program-home',
            binderId: 'binder-home',
        });
    });

    const mockRes = () => {
        const res: {
            status?: ReturnType<typeof vi.fn>;
            json?: ReturnType<typeof vi.fn>;
            setHeader?: ReturnType<typeof vi.fn>;
        } = {};
        res.status = vi.fn().mockReturnValue(res);
        res.json = vi.fn().mockReturnValue(res);
        res.setHeader = vi.fn();
        return res;
    };

    it('creates a new policy draft successfully', async () => {
        // Setup Mocks
        vi.mocked(tenantScopedPrisma.policyHolder.create).mockResolvedValue({ id: 'ph-1', name: 'New Tenant' });

        vi.mocked(tenantScopedPrisma.policy.create).mockResolvedValue({
            id: 'pol-1',
            policyNumber: 'ABB-TEST-1',
            status: 'DRAFT',
            productType: 'MOTOR',
            inceptionDate: new Date(),
            expiryDate: new Date()
        });

        // Mock Request
        const req = {
            body: {
                name: 'New Tenant',
                contact: { email: 'test@example.com' },
                productType: 'home',
            },
            user: { id: 'u1', name: 'Tester' }
        };
        const res = mockRes();

        // Invoke Handler
        await createPolicyHandler(req, res);

        // Assertions
        expect(tenantScopedPrisma.$transaction).toHaveBeenCalled();

        // Contract-level side effects: holder and policy records are created.
        expect(tenantScopedPrisma.policyHolder.create).toHaveBeenCalled();
        expect(tenantScopedPrisma.policy.create).toHaveBeenCalled();
        expect(mocks.findLatestActiveBinderLinkForProduct).toHaveBeenCalledWith(expect.objectContaining({
            productCode: 'HOME',
            inceptionDate: expect.any(Date),
            db: expect.anything(),
        }));
        expect(tenantScopedPrisma.policy.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                productType: 'HOME',
                programId: 'program-home',
                binderId: 'binder-home',
            }),
        }));

        // Verify Initialization of State and Search Index
        expect(tenantScopedPrisma.policyStateCurrent.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({
                snapshot: expect.objectContaining({
                    productType: 'HOME',
                    programId: 'program-home',
                    binderId: 'binder-home',
                }),
            }),
        }));
        expect(tenantScopedPrisma.policySearchIndex.upsert).toHaveBeenCalled();

        // Verify Response
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({ id: 'pol-1' })
        }));
    });

    it('rejects a product-less BO creation request before resolving authority or writing a policy', async () => {
        const req = { body: {}, user: { id: 'u1' } };
        const res = mockRes();

        await createPolicyHandler(req, res);

        expect(mocks.findLatestActiveBinderLinkForProduct).not.toHaveBeenCalled();
        expect(tenantScopedPrisma.$transaction).not.toHaveBeenCalled();
        expect(tenantScopedPrisma.policyHolder.create).not.toHaveBeenCalled();
        expect(tenantScopedPrisma.policy.create).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            error: expect.objectContaining({ code: 'BAD_REQUEST' }),
        }));
    });

    it('fails closed without creating a policy when no active authority pair exists for the selected product', async () => {
        mocks.findLatestActiveBinderLinkForProduct.mockResolvedValue(null);
        const req = { body: { productType: 'HOME' }, user: { id: 'u1' } };
        const res = mockRes();

        await createPolicyHandler(req, res);

        expect(mocks.findLatestActiveBinderLinkForProduct).toHaveBeenCalledWith(expect.objectContaining({ productCode: 'HOME' }));
        expect(tenantScopedPrisma.policyHolder.create).not.toHaveBeenCalled();
        expect(tenantScopedPrisma.policy.create).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: {
                code: 'NO_ACTIVE_BINDER',
                message: 'No active binder linked for HOME in this tenant',
            },
        });
    });
});
