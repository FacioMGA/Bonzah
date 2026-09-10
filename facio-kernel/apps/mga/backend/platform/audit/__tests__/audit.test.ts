
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogger } from '../logger.js';
import { tenantScopedPrisma } from '../../db/connection.js';
import { runWithOperatingTenant } from '../../tenant/tenantAls.js';
import { TENANT_IDS, type TenantConfig } from '../../tenant/tenantConfig.js';

vi.mock('../../../platform/db/connection.js', () => {
    const prisma = {
        auditAction: {
            create: vi.fn(),
            findMany: vi.fn()
        },
    };
    return { prisma, tenantScopedPrisma: prisma };
});

const CY_CONFIG: TenantConfig = {
    id: TENANT_IDS.CY,
    tenantSlug: 'abbeygate-cy',
    countryCode: 'CY',
    country: 'Cyprus',
    currency: 'EUR',
    ipt: { flatFee: 0 },
    adminFee: 18,
    legalPack: 'cy',
    publicBaseUrl: 'https://abbeygate-cy.facio.io',
    fromEmail: 'no-reply@abbeygate.cy',
    brandLogo: { white: '', blue: '' },
};

describe('Audit & Feed', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('AuditLogger (Emission)', () => {
        it('logs an event correctly', async () => {
            // ADR-0019: AuditLogger.log() reads getTenantConfig() to stamp
            // operatingTenantId; needs to run inside an ALS context.
            await runWithOperatingTenant(CY_CONFIG, () =>
                AuditLogger.log(
                    'pol-1',
                    'POLICY',
                    'POLICY.CREATED',
                    'user-1',
                    'USER',
                    { details: 'foo' },
                    'John Doe'
                )
            );

            expect(tenantScopedPrisma.auditAction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    entityId: 'pol-1',
                    entityType: 'POLICY',
                    actionName: 'POLICY.CREATED',
                    actorId: 'user-1',
                    actorType: 'USER',
                    diff: { details: 'foo' },
                    actorName: 'John Doe',
                    hash: expect.any(String)
                })
            });
        });
    });

});
