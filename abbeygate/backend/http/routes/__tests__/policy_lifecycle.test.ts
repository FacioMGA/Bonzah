
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { updatePolicyStatusHandler } from '../../../modules/policy/http/statusRouter.js';
import { updatePolicyUwFormHandler } from '../../../modules/policy/http/uwRouter.js';
import { transitionPolicyLifecycle } from '../../../modules/policy/app/commands/policyLifecycleCommands.js';

// Mock dependencies
vi.mock('../../../platform/db/connection.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../platform/db/connection.js')>();
    const mockPrisma = {
        ...actual.prisma,
        policy: {
            update: vi.fn(),
            findUnique: vi.fn()
        },
        policyStateCurrent: {
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            upsert: vi.fn()
        },
        policySearchIndex: {
            update: vi.fn()
        },
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
            policySearchIndex: mockPrisma.policySearchIndex,
        },
    };
});

vi.mock('../../../platform/audit/logger.js', () => ({
    AuditLogger: { log: vi.fn() }
}));

vi.mock('../../../modules/policy/app/commands/policyLifecycleCommands.js', () => ({
    transitionPolicyLifecycle: vi.fn(async () => ({ from: 'DRAFT', to: 'QUOTED' }))
}));

vi.mock('../../../modules/policy/infra/projections/policyListIndex.js', () => ({
    enqueuePolicyListIndexUpdate: vi.fn(async () => undefined)
}));

describe('Policy Lifecycle Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockRes = () => {
        const res: { status?: ReturnType<typeof vi.fn>; json?: ReturnType<typeof vi.fn> } = {};
        res.status = vi.fn().mockReturnValue(res);
        res.json = vi.fn().mockReturnValue(res);
        return res;
    };

    describe('updatePolicyStatusHandler', () => {
        it('updates policy status successfully', async () => {
            const inceptionDate = new Date();
            const expiryDate = new Date();
            vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
                id: 'pol-1',
                status: 'DRAFT',
                inceptionDate,
                expiryDate,
            });

            const req = {
                params: { id: 'pol-1' },
                body: { status: 'QUOTED' },
                user: { id: 'u1' }
            };
            const res = mockRes();

            await updatePolicyStatusHandler(req, res);

            expect(transitionPolicyLifecycle).toHaveBeenCalledWith(expect.objectContaining({
                policyId: 'pol-1',
                to: 'QUOTED',
            }));
            expect(tenantScopedPrisma.policy.update).not.toHaveBeenCalled();

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({ status: 'QUOTED' })
            }));
        });

        it('returns 404 when policy is not visible to the current tenant', async () => {
            vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue(null);

            const req = {
                params: { id: 'missing-policy' },
                body: { inceptionDate: new Date().toISOString() },
            };
            const res = mockRes();

            await updatePolicyStatusHandler(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                error: expect.objectContaining({ code: 'NOT_FOUND' }),
            }));
            expect(tenantScopedPrisma.policy.update).not.toHaveBeenCalled();
        });

        it('updates only provided policy date fields', async () => {
            const start = new Date();
            const end = new Date(start);
            end.setFullYear(end.getFullYear() + 1);
            vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
                id: 'pol-1',
                status: 'DRAFT',
                inceptionDate: start,
                expiryDate: end,
            });
            vi.mocked(tenantScopedPrisma.policy.update).mockResolvedValue({
                id: 'pol-1',
                status: 'DRAFT',
                inceptionDate: start,
                expiryDate: end,
            });

            const req = {
                params: { id: 'pol-1' },
                body: { inceptionDate: start.toISOString() },
            };
            const res = mockRes();

            await updatePolicyStatusHandler(req, res);

            expect(tenantScopedPrisma.policy.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'pol-1' },
                data: { inceptionDate: expect.any(Date) },
            }));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });
    });

    describe('updatePolicyUwFormHandler', () => {
        it('creates initial snapshot if missing', async () => {
            vi.mocked(tenantScopedPrisma.policy.findUnique)
                .mockResolvedValueOnce({ id: 'pol-1', status: 'DRAFT', productType: 'MOTOR' })
                .mockResolvedValueOnce({ id: 'pol-1', quoteData: {}, stateCurrent: null });
            vi.mocked(tenantScopedPrisma.policyStateCurrent.findUnique).mockResolvedValue(null);
            vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mockResolvedValue({
                policyId: 'pol-1',
                snapshot: { quoteData: { some: 'data' } }
            });

            const req = {
                params: { id: 'pol-1' },
                body: { quoteDataUpdates: { some: 'data' } },
                user: { id: 'u1' }
            };
            const res = mockRes();

            await updatePolicyUwFormHandler(req, res);

            expect(tenantScopedPrisma.policyStateCurrent.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { policyId: 'pol-1' },
                create: expect.objectContaining({
                    policyId: 'pol-1',
                    snapshot: expect.objectContaining({
                        quoteData: expect.objectContaining({ some: 'data' })
                    })
                })
            }));

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });

        it('updates existing snapshot and recalculates premium', async () => {
            vi.mocked(tenantScopedPrisma.policy.findUnique)
                .mockResolvedValueOnce({ id: 'pol-1', status: 'DRAFT', productType: 'MOTOR' })
                .mockResolvedValueOnce({
                    id: 'pol-1',
                    quoteData: { old: 'val' },
                    stateCurrent: { snapshot: { quoteData: { old: 'val' } } }
                });
            vi.mocked(tenantScopedPrisma.policyStateCurrent.findUnique).mockResolvedValue({
                policyId: 'pol-1',
                snapshot: { quoteData: { old: 'val' } }
            });
            vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mockResolvedValue({});

            const req = {
                params: { id: 'pol-1' },
                body: {
                    quoteDataUpdates: { premiumRate: '20' },
                },
                user: { id: 'u1' }
            };
            const res = mockRes();

            await updatePolicyUwFormHandler(req, res);

            expect(tenantScopedPrisma.policyStateCurrent.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { policyId: 'pol-1' },
                update: expect.objectContaining({
                    snapshot: expect.objectContaining({
                        quoteData: expect.objectContaining({
                            old: 'val',
                            premiumRate: '20'
                        })
                    })
                })
            }));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });

        it('preserves the current snapshot fields when the policy quoteData column is empty', async () => {
            vi.mocked(tenantScopedPrisma.policy.findUnique)
                .mockResolvedValueOnce({ id: 'pol-1', status: 'DRAFT', productType: 'MOTOR' })
                .mockResolvedValueOnce({
                    id: 'pol-1',
                    quoteData: {},
                    stateCurrent: {
                        snapshot: {
                            quoteData: {
                                proposer: { firstName: 'Danny', email: 'danny@abbeygate.cy' },
                                vehicleValue: 12000,
                            },
                        },
                    },
                });
            vi.mocked(tenantScopedPrisma.policyStateCurrent.findUnique).mockResolvedValue({
                policyId: 'pol-1',
                snapshot: {
                    quoteData: {
                        proposer: { firstName: 'Danny', email: 'danny@abbeygate.cy' },
                        vehicleValue: 12000,
                    },
                },
            });
            vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mockResolvedValue({});

            await updatePolicyUwFormHandler({
                params: { id: 'pol-1' },
                body: { quoteDataUpdates: { vehicleRegistration: 'ABC123' } },
                user: { id: 'u1' },
            }, mockRes());

            expect(tenantScopedPrisma.policy.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'pol-1' },
                data: expect.objectContaining({
                    quoteData: expect.objectContaining({
                        proposer: { firstName: 'Danny', email: 'danny@abbeygate.cy' },
                        vehicleValue: 12000,
                        vehicleRegistration: 'ABC123',
                    }),
                }),
            }));
        });
    });
});
