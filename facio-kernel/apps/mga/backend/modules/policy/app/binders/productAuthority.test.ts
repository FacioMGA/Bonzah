import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    binderFindFirst: vi.fn(),
    productFindUnique: vi.fn(),
    authorityFindFirst: vi.fn(),
    authorityFindMany: vi.fn(),
    authorityUpsert: vi.fn(),
}));

vi.mock('../../../../platform/db/connection.js', () => ({
    prisma: { productDefinition: { findUnique: mocks.productFindUnique } },
    tenantScopedPrisma: {
        binder: { findFirst: mocks.binderFindFirst },
        binderProductAuthority: {
            findFirst: mocks.authorityFindFirst,
            findMany: mocks.authorityFindMany,
            upsert: mocks.authorityUpsert,
        },
    },
}));
vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({
    getTenantConfig: () => ({ id: '00000000-0000-0000-0000-000000000099' }),
}));

import {
    BinderProductAuthorityCreateSchema,
    BinderProductAuthorityError,
    upsertBinderProductAuthority,
} from './productAuthority.js';

const binderId = '10000000-0000-4000-8000-000000000001';
const now = new Date('2026-09-09T12:00:00.000Z');

beforeEach(() => {
    vi.clearAllMocks();
    mocks.binderFindFirst.mockResolvedValue({ id: binderId, status: 'ACTIVE' });
    mocks.productFindUnique.mockResolvedValue({ code: 'RENTAL' });
    mocks.authorityFindFirst.mockResolvedValue(null);
    mocks.authorityUpsert.mockResolvedValue({
        id: '20000000-0000-4000-8000-000000000002',
        binderId,
        productCode: 'RENTAL',
        classOfBusiness: 'RENTAL',
        riskCode: 'RCLI',
        territorialScope: ['US'],
        maxPremiumAnnual: 50000,
        maxPolicyPeriodDays: 90,
        maxAdvanceInceptionDays: 365,
        authorityClasses: ['CDW', 'RCLI', 'SLI', 'PAI_PEI'],
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-12-31T23:59:59.000Z'),
        notes: 'Synthetic sandbox authority',
        createdAt: now,
        updatedAt: now,
    });
});

describe('binder product authority MCP application service', () => {
    it('normalizes product and territory codes before persistence', () => {
        expect(BinderProductAuthorityCreateSchema.parse({
            binderId,
            productCode: 'rental',
            classOfBusiness: 'RENTAL',
            territorialScope: ['us'],
        })).toMatchObject({ productCode: 'RENTAL', territorialScope: ['US'] });
    });

    it('creates an auditable tenant-scoped RENTAL authority with effective limits', async () => {
        const result = await upsertBinderProductAuthority({
            binderId,
            productCode: 'rental',
            classOfBusiness: 'RENTAL',
            riskCode: 'RCLI',
            territorialScope: ['us'],
            maxPremiumAnnual: 50000,
            maxPolicyPeriodDays: 90,
            maxAdvanceInceptionDays: 365,
            authorityClasses: ['CDW', 'RCLI', 'SLI', 'PAI_PEI'],
            effectiveFrom: '2026-01-01T00:00:00.000Z',
            effectiveTo: '2026-12-31T23:59:59.000Z',
            notes: 'Synthetic sandbox authority',
        });

        expect(result).toMatchObject({ created: true, authority: { productCode: 'RENTAL', territorialScope: ['US'] } });
        expect(mocks.binderFindFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: binderId, operatingTenantId: '00000000-0000-0000-0000-000000000099' },
        }));
        expect(mocks.authorityUpsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({
                operatingTenantId: '00000000-0000-0000-0000-000000000099',
                productCode: 'RENTAL',
                territorialScope: ['US'],
            }),
        }));
    });

    it('refuses to activate product authority on an inactive binder', async () => {
        mocks.binderFindFirst.mockResolvedValue({ id: binderId, status: 'DRAFT' });
        await expect(upsertBinderProductAuthority({
            binderId,
            productCode: 'RENTAL',
            classOfBusiness: 'RENTAL',
            status: 'ACTIVE',
        })).rejects.toMatchObject<BinderProductAuthorityError>({ code: 'BINDER_NOT_ACTIVE' });
        expect(mocks.authorityUpsert).not.toHaveBeenCalled();
    });

    it('rejects reversed authority dates before writing', async () => {
        await expect(upsertBinderProductAuthority({
            binderId,
            productCode: 'RENTAL',
            classOfBusiness: 'RENTAL',
            effectiveFrom: '2026-12-31T00:00:00.000Z',
            effectiveTo: '2026-01-01T00:00:00.000Z',
        })).rejects.toMatchObject<BinderProductAuthorityError>({ code: 'INVALID_DATE_RANGE' });
        expect(mocks.authorityUpsert).not.toHaveBeenCalled();
    });
});
