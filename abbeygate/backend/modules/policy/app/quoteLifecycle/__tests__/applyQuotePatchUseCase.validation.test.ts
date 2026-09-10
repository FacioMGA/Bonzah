/**
 * Operator MCP V2 — `applyQuotePatchUseCase` validation seam unit test.
 *
 * Verifies:
 *   1. With an OPERATOR_AGENT actor + a patch that fails
 *      validateForContext, the use case returns a VALIDATION_ERROR
 *      result and writes nothing.
 *   2. With an UNDERWRITER actor + the same failing patch, the use case
 *      emits a warn-only telemetry log but still proceeds (V2 warn-only
 *      seam — V3 will flip to strict).
 *
 * Mocks the canonical writes so the test stays pure-unit (no Prisma).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPolicyFindUnique = vi.fn();
const mockPolicyUpdate = vi.fn();
const mockStateCurrentUpsert = vi.fn();
const mockTransaction = vi.fn();

vi.mock('../../../../../platform/db/connection.js', () => ({
    tenantScopedPrisma: {
        policy: { findUnique: mockPolicyFindUnique },
        $transaction: (cb: (tx: unknown) => Promise<unknown>) => {
            mockTransaction();
            return cb({
                policy: { update: mockPolicyUpdate },
                policyStateCurrent: {
                    findUnique: vi.fn().mockResolvedValue(null),
                    upsert: mockStateCurrentUpsert,
                },
            });
        },
    },
}));

const mockValidateForContext = vi.fn();
vi.mock('@facio/validation/backend', () => ({
    validateForContext: (...args: unknown[]) => mockValidateForContext(...args),
}));

vi.mock('../../../../../platform/audit/logger.js', () => ({
    AuditLogger: { log: vi.fn() },
}));

vi.mock('../../productRegistryService.js', () => ({
    productAdapterExists: () => true,
    normalizeUwDataForProduct: (_p: string, d: unknown) => ({
        normalizedQuoteData: d,
        productFields: {},
    }),
}));

vi.mock('../../binders/binderAuthority.js', () => ({
    assertBinderAuthorizesProduct: vi.fn().mockResolvedValue(undefined),
    BinderAuthorityError: class extends Error {},
}));

describe('applyQuotePatchUseCase — validation seam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPolicyFindUnique.mockResolvedValue({
            id: 'pol-1',
            productType: 'MOTOR',
            binderId: null,
            quoteData: { excess: 400 },
            stateCurrent: { snapshot: { quoteData: { excess: 400 } } },
        });
    });

    it('OPERATOR_AGENT: validation error returns VALIDATION_ERROR and writes nothing', async () => {
        mockValidateForContext.mockReturnValue({
            excess: { message: 'Excess must be one of 250/500/750/1000', type: 'enum' },
        });
        const { applyQuotePatchUseCase } = await import('../applyQuotePatchUseCase.js');

        const result = await applyQuotePatchUseCase({
            policyId: 'pol-1',
            patch: { excess: 999 },
            actor: { id: 'apikey:k1', role: 'OPERATOR_AGENT' },
            correlationId: 'corr-1',
        });

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('expected failure');
        expect(result.code).toBe('VALIDATION_ERROR');
        expect(result.validationErrors).toHaveLength(1);
        expect(result.validationErrors?.[0]).toMatchObject({
            field: 'excess',
            message: 'Excess must be one of 250/500/750/1000',
        });
        expect(mockTransaction).not.toHaveBeenCalled();
        expect(mockPolicyUpdate).not.toHaveBeenCalled();
    });

    it('UNDERWRITER: same failing patch proceeds (warn-only V2 mode) and writes succeed', async () => {
        mockValidateForContext.mockReturnValue({
            excess: { message: 'Excess must be one of 250/500/750/1000', type: 'enum' },
        });
        const { applyQuotePatchUseCase } = await import('../applyQuotePatchUseCase.js');

        const result = await applyQuotePatchUseCase({
            policyId: 'pol-1',
            patch: { excess: 999 },
            actor: { id: 'user-uw-1', role: 'UNDERWRITER' },
            correlationId: 'corr-2',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected success (warn-only mode)');
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(mockPolicyUpdate).toHaveBeenCalledTimes(1);
        expect(result.changedFields).toEqual([{ field: 'excess', from: 400, to: 999 }]);
    });

    it('OPERATOR_AGENT: valid patch persists, writes via canonical tx', async () => {
        mockValidateForContext.mockReturnValue({}); // valid
        const { applyQuotePatchUseCase } = await import('../applyQuotePatchUseCase.js');

        const result = await applyQuotePatchUseCase({
            policyId: 'pol-1',
            patch: { excess: 750 },
            actor: { id: 'apikey:k1', role: 'OPERATOR_AGENT' },
            correlationId: 'corr-3',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected success');
        expect(result.changedFields).toEqual([{ field: 'excess', from: 400, to: 750 }]);
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(mockPolicyUpdate).toHaveBeenCalledTimes(1);
        expect(mockStateCurrentUpsert).toHaveBeenCalledTimes(1);
    });

    it('OPERATOR_AGENT: no-op patch (same value) does not transact', async () => {
        mockValidateForContext.mockReturnValue({});
        const { applyQuotePatchUseCase } = await import('../applyQuotePatchUseCase.js');

        const result = await applyQuotePatchUseCase({
            policyId: 'pol-1',
            patch: { excess: 400 },
            actor: { id: 'apikey:k1', role: 'OPERATOR_AGENT' },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected success');
        expect(result.changedFields).toEqual([]);
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('Policy not found returns NOT_FOUND, no writes', async () => {
        mockPolicyFindUnique.mockResolvedValueOnce(null);
        const { applyQuotePatchUseCase } = await import('../applyQuotePatchUseCase.js');

        const result = await applyQuotePatchUseCase({
            policyId: 'pol-missing',
            patch: { excess: 750 },
            actor: { id: 'apikey:k1', role: 'OPERATOR_AGENT' },
        });

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('expected failure');
        expect(result.code).toBe('NOT_FOUND');
        expect(mockTransaction).not.toHaveBeenCalled();
    });
});
