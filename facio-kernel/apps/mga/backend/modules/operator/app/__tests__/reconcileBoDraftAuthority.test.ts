import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpContext } from '../../../mcp/domain/mcpContext.js';

const mocks = vi.hoisted(() => ({
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    updateStateMany: vi.fn(),
    transaction: vi.fn(),
    findLatest: vi.fn(),
    issueToken: vi.fn(),
    consumeToken: vi.fn(),
    audit: vi.fn(),
}));

vi.mock('../../../../platform/db/connection.js', () => ({
    tenantScopedPrisma: {
        policy: { findMany: mocks.findMany },
        $transaction: mocks.transaction,
    },
}));
vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({ getTenantConfig: () => ({ id: 'tenant-cy' }) }));
vi.mock('../../../../platform/audit/logger.js', () => ({ AuditLogger: { log: mocks.audit } }));
vi.mock('../../../policy/app/binders/binderAuthority.js', () => ({
    findLatestActiveBinderLinkForProduct: mocks.findLatest,
}));
vi.mock('../../../mcp/infra/confirmationTokenStore.js', () => ({
    hashPreviewInput: vi.fn(() => 'hash'),
    issueConfirmationToken: mocks.issueToken,
    consumeConfirmationToken: mocks.consumeToken,
}));
vi.mock('../operatorMutateGuards.js', () => ({
    requireMutatePermission: () => ({ ok: true, action: { actionId: 'action-1', correlationId: 'corr-1' } }),
}));

import { operatorReconcileBoDraftAuthority } from '../reconcileBoDraftAuthority.js';

const inceptionDate = new Date('2026-08-01T00:00:00.000Z');
const ctx: McpContext = {
    tenantId: 'tenant-cy',
    userId: 'operator-1',
    role: 'USER',
    permissions: ['operator.mutate'],
    channel: 'web',
    sessionId: 'session-1',
    requestId: 'request-1',
    correlationId: 'corr-1',
};

type TestCandidate = {
    id: string;
    policyNumber: string;
    status: string;
    productType: string;
    programId: string | null;
    binderId: string | null;
    inceptionDate: Date;
    quoteData: { __meta: { origin: string } };
    updatedAt: Date;
    stateCurrent: {
        snapshot: {
            quoteData: { __meta: { origin: string } };
            productType?: string;
            programId?: string;
            binderId?: string;
        };
        updatedAt: Date;
    } | null;
};

function candidate(overrides: Partial<TestCandidate> = {}): TestCandidate {
    return {
        id: 'policy-1',
        policyNumber: 'ABQ/CY0000001',
        status: 'DRAFT',
        productType: 'HOME',
        programId: null,
        binderId: null,
        inceptionDate,
        quoteData: { __meta: { origin: 'bo' } },
        updatedAt: new Date('2026-08-01T00:01:00.000Z'),
        stateCurrent: {
            snapshot: { quoteData: { __meta: { origin: 'bo' } } },
            updatedAt: new Date('2026-08-01T00:02:00.000Z'),
        },
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.issueToken.mockResolvedValue({ token: 'tok_0123456789abcdef0123456789abcdef', expiresAt: '2026-08-30T10:10:00.000Z' });
    mocks.findLatest.mockResolvedValue({ programId: 'program-home', binderId: 'binder-home' });
    mocks.audit.mockResolvedValue(undefined);
});

describe('operatorReconcileBoDraftAuthority', () => {
    it('returns exact affected/safe/skipped preview counts without writing', async () => {
        mocks.findMany.mockResolvedValue([
            candidate(),
            candidate({ id: 'policy-no-link', productType: 'TRAVEL' }),
            candidate({ id: 'policy-conflict', programId: 'program-old', binderId: null }),
            candidate({ id: 'policy-no-product', productType: '' }),
            candidate({ id: 'policy-customer', quoteData: { __meta: { origin: 'customer' } }, stateCurrent: { snapshot: { quoteData: { __meta: { origin: 'customer' } } }, updatedAt: new Date() } }),
        ]);
        mocks.findLatest.mockImplementation(async ({ productCode }: { productCode: string }) =>
            productCode === 'TRAVEL' ? null : { programId: 'program-home', binderId: 'binder-home' },
        );

        const result = await operatorReconcileBoDraftAuthority({}, ctx);

        expect(result).toMatchObject({ ok: true, status: 'preview', requires_confirmation: true });
        expect(result.preview_extra).toMatchObject({
            affected_count: 3,
            safe_to_backfill_count: 1,
            skipped_count: 2,
            skipped_by_reason: { NO_ACTIVE_BINDER_LINK: 1, EXISTING_AUTHORITY_CONFLICT: 1 },
            safe_policy_ids: ['policy-1'],
        });
        expect(mocks.transaction).not.toHaveBeenCalled();
        expect(mocks.issueToken).toHaveBeenCalledTimes(1);
    });

    it('applies only the missing authority fields and missing snapshot mirrors after confirmation', async () => {
        const row = candidate({ programId: 'program-home', binderId: null, stateCurrent: {
            snapshot: { quoteData: { __meta: { origin: 'bo' } }, productType: 'HOME', programId: 'program-home' },
            updatedAt: new Date('2026-08-01T00:02:00.000Z'),
        } });
        mocks.consumeToken.mockResolvedValue({
            inputHash: 'hash',
            preview: { kind: 'bo_draft_authority_reconciliation', safe_policy_ids: ['policy-1'] },
        });
        mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
            policy: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
            policyStateCurrent: { updateMany: mocks.updateStateMany },
        }));
        mocks.findUnique.mockResolvedValue(row);
        mocks.updateMany.mockResolvedValue({ count: 1 });
        mocks.updateStateMany.mockResolvedValue({ count: 1 });

        const result = await operatorReconcileBoDraftAuthority(
            { confirmation_token: 'tok_0123456789abcdef0123456789abcdef' },
            ctx,
        );

        expect(result).toMatchObject({ ok: true, status: 'completed', extra: { affected_count: 1, safe_to_backfill_count: 1, skipped_count: 0 } });
        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { binderId: 'binder-home' },
            where: expect.objectContaining({ programId: 'program-home', binderId: null, status: 'DRAFT' }),
        }));
        expect(mocks.updateStateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { snapshot: expect.objectContaining({ productType: 'HOME', programId: 'program-home', binderId: 'binder-home' }) },
        }));
    });

    it('does not write when a token is invalid', async () => {
        mocks.consumeToken.mockResolvedValue(null);

        const result = await operatorReconcileBoDraftAuthority(
            { confirmation_token: 'tok_0123456789abcdef0123456789abcdef' },
            ctx,
        );

        expect(result).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_TOKEN_INVALID' } });
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
});
