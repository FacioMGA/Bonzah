import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import type { ensurePolicyPublicSessionToken, ensureVerifiedContactEmail } from '../../../modules/policy/http/uwHelpers.js';
import type { sendAutoQuoteInviteEmail, sendUwQuestionnaireRequestEmail } from '../../../modules/policy/app/communicationsInterop.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../products/testHelpers/tenantFixtures.js';

interface PolicyFixture {
    id: string;
    productType: string;
    policyHolder: { id: string; name: string; contact: string };
    publicSessionToken: null;
    quoteData: { email: string };
    stateCurrent: null;
}
interface TestTransaction {
    policy: { update: () => Promise<void> };
    policyStateCurrent: { findUnique: () => Promise<null>; upsert: () => Promise<void> };
}
const mocks = vi.hoisted(() => ({
    findPolicy: vi.fn<() => Promise<PolicyFixture | null>>(),
    updatePolicy: vi.fn<() => Promise<void>>(),
    findState: vi.fn<() => Promise<null>>(),
    upsertState: vi.fn<() => Promise<void>>(),
    transaction: vi.fn<(callback: (tx: TestTransaction) => Promise<void>) => Promise<void>>(),
    verifyContact: vi.fn<typeof ensureVerifiedContactEmail>(),
    createToken: vi.fn<typeof ensurePolicyPublicSessionToken>(),
    questionnaireEmail: vi.fn<typeof sendUwQuestionnaireRequestEmail>(),
    inviteEmail: vi.fn<typeof sendAutoQuoteInviteEmail>(),
    transition: vi.fn(),
    audit: vi.fn(),
}));
vi.mock('../../../platform/db/connection.js', () => {
    const db = {
        policy: { findUnique: mocks.findPolicy, update: mocks.updatePolicy },
        policyStateCurrent: { findUnique: mocks.findState, upsert: mocks.upsertState },
        $transaction: mocks.transaction,
    };
    return { prisma: db, tenantScopedPrisma: db };
});
vi.mock('../../../platform/audit/logger.js', () => ({ AuditLogger: { log: mocks.audit } }));
vi.mock('../../../modules/policy/app/communicationsInterop.js', () => ({
    sendUwQuestionnaireRequestEmail: mocks.questionnaireEmail,
    sendAutoQuoteInviteEmail: mocks.inviteEmail,
}));
vi.mock('../../../modules/policy/app/commands/uwWorkflowCommands.js', () => ({ transitionUwWorkflow: mocks.transition }));
vi.mock('../../../modules/policy/http/uwHelpers.js', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../../modules/policy/http/uwHelpers.js')>(),
    ensureVerifiedContactEmail: mocks.verifyContact,
    ensurePolicyPublicSessionToken: mocks.createToken,
}));
import { registerUwFollowUpRoutes } from '../../../modules/policy/http/uwFollowUpRouter.js';

async function postFollowUp(countryCode: string, endpoint: 'send-questionnaire' | 'send-follow-up-batch') {
    const tenant = getTenantFixtures().find(candidate => candidate.countryCode === countryCode);
    if (!tenant) throw new Error(`Missing tenant fixture for ${countryCode}`);
    const app = express();
    app.use(express.json());
    app.use((_req, _res, next) => runWithOperatingTenant(tenant, () => next()));
    const router = express.Router();
    registerUwFollowUpRoutes(router);
    app.use('/policies', router);
    const server = app.listen(0, '127.0.0.1');
    try {
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected a TCP test server');
        const response = await fetch(`http://127.0.0.1:${address.port}/policies/policy-1/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: [{ fieldKey: 'email', question: 'Please confirm your email address.' }] }),
        });
        return { status: response.status, body: await response.text() };
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPolicy.mockResolvedValue({ id: 'policy-1', productType: 'MOTOR', policyHolder: { id: 'holder-1', name: 'Example Customer', contact: 'customer@example.test' }, publicSessionToken: null, quoteData: { email: 'customer@example.test' }, stateCurrent: null });
    mocks.verifyContact.mockResolvedValue({ ok: true, email: 'customer@example.test', contactName: 'Example Customer' });
    mocks.createToken.mockResolvedValue('synthetic-session-token');
    mocks.questionnaireEmail.mockResolvedValue(true);
    mocks.inviteEmail.mockResolvedValue(true);
    mocks.updatePolicy.mockResolvedValue(undefined);
    mocks.findState.mockResolvedValue(null);
    mocks.upsertState.mockResolvedValue(undefined);
    mocks.transition.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async callback => callback({ policy: { update: mocks.updatePolicy }, policyStateCurrent: { findUnique: mocks.findState, upsert: mocks.upsertState } }));
});

describe('underwriting follow-up product authority', () => {
    it.each(['send-questionnaire', 'send-follow-up-batch'] as const)('rejects Greece Motor %s before contact/token/snapshot/email work', async endpoint => {
        const response = await postFollowUp('GR', endpoint);

        expect(response.status).toBe(403);
        expect(response.body).toContain('"code":"PRODUCT_UNAVAILABLE"');
        expect(mocks.verifyContact).not.toHaveBeenCalled();
        expect(mocks.createToken).not.toHaveBeenCalled();
        expect(mocks.updatePolicy).not.toHaveBeenCalled();
        expect(mocks.transaction).not.toHaveBeenCalled();
        expect(mocks.upsertState).not.toHaveBeenCalled();
        expect(mocks.transition).not.toHaveBeenCalled();
        expect(mocks.questionnaireEmail).not.toHaveBeenCalled();
        expect(mocks.inviteEmail).not.toHaveBeenCalled();
    });

    it.each(['send-questionnaire', 'send-follow-up-batch'] as const)('allows Cyprus Motor %s and preserves explicit email product context', async endpoint => {
        const response = await postFollowUp('CY', endpoint);

        expect(response.status).toBe(200);
        expect(mocks.verifyContact).toHaveBeenCalledTimes(1);
        expect(mocks.createToken).toHaveBeenCalledTimes(1);
        expect(mocks.transaction).toHaveBeenCalledTimes(1);
        expect(mocks.upsertState).toHaveBeenCalledTimes(1);
        const dispatch = endpoint === 'send-questionnaire' ? mocks.questionnaireEmail : mocks.inviteEmail;
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ productCode: 'MOTOR', policyId: 'policy-1', toEmail: 'customer@example.test' }));
    });
});
