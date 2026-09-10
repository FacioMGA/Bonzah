import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpContext } from '../../../mcp/domain/mcpContext.js';
import type { dispatchCustomerEmailTrigger } from '../../../communications/app/customerEmailTriggerService.js';
import type { createLeadDraftPolicy, upsertPolicyHolderByContact } from '../../infra/delegators/leadDelegate.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../../products/testHelpers/tenantFixtures.js';
import type { TenantConfig } from '../../../../platform/tenant/tenantConfig.js';
import { sendWizardLink, type SendWizardLinkInput } from '../sendWizardLink.js';

const mocks = vi.hoisted(() => ({
    upsertHolder: vi.fn<typeof upsertPolicyHolderByContact>(),
    createDraft: vi.fn<typeof createLeadDraftPolicy>(),
    dispatch: vi.fn<typeof dispatchCustomerEmailTrigger>(),
}));
vi.mock('../../infra/delegators/leadDelegate.js', () => ({
    upsertPolicyHolderByContact: mocks.upsertHolder,
    createLeadDraftPolicy: mocks.createDraft,
}));
vi.mock('../../../communications/app/customerEmailTriggerService.js', () => ({
    dispatchCustomerEmailTrigger: mocks.dispatch,
}));
// Availability resolves real jurisdiction authority; no channel-setting query is needed.
vi.mock('../../../../platform/db/connection.js', () => ({ tenantScopedPrisma: {} }));

function contextForCountry(countryCode: string) {
    const usRentalTenant: TenantConfig = {
        id: '00000000-0000-0000-0000-000000000099', tenantSlug: 'synthetic-us-rental',
        countryCode: 'US', country: 'United States', currency: 'USD', ipt: {}, adminFee: 0,
        publicBaseUrl: 'https://example.test', fromEmail: 'noreply@example.test',
        brandLogo: { white: '', blue: '' }, legalPack: 'us',
    };
    const tenant = countryCode === 'US' ? usRentalTenant : getTenantFixtures().find(candidate => candidate.countryCode === countryCode);
    if (!tenant) throw new Error(`Missing tenant fixture for ${countryCode}`);
    const context: McpContext = {
        tenantId: tenant.id,
        userId: 'synthetic-operator',
        role: 'USER',
        permissions: ['operator.comm'],
        channel: 'web',
        sessionId: 'synthetic-session',
        requestId: 'synthetic-request',
        correlationId: 'synthetic-correlation',
    };
    return { tenant, context };
}

function inputForProduct(productType: SendWizardLinkInput['productType']): SendWizardLinkInput {
    return { name: 'Example Customer', email: 'customer@example.test', productType };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsertHolder.mockResolvedValue({ id: 'holder-1', created: true, name: 'Example Customer', contact: 'customer@example.test' });
    mocks.createDraft.mockResolvedValue({ policyId: 'draft-1', policyNumber: 'QUOTE-1', publicSessionToken: 'synthetic-token', programId: 'program-1', binderId: 'binder-1' });
    mocks.dispatch.mockResolvedValue({ messageId: 'message-1', skipped: false });
});

describe('operator wizard invite product authority', () => {
    it('rejects Greece Motor before any holder upsert, draft creation or dispatch', async () => {
        const { tenant, context } = contextForCountry('GR');
        const result = await runWithOperatingTenant(tenant, () => sendWizardLink(inputForProduct('MOTOR'), context));

        expect(result).toMatchObject({ ok: false, status: 'error', error: { code: 'PRODUCT_UNAVAILABLE' } });
        expect(mocks.upsertHolder).not.toHaveBeenCalled();
        expect(mocks.createDraft).not.toHaveBeenCalled();
        expect(mocks.dispatch).not.toHaveBeenCalled();
    });

    it.each<{ countryCode: string; productType: SendWizardLinkInput['productType'] }>([
        { countryCode: 'CY', productType: 'MOTOR' },
        { countryCode: 'PT', productType: 'MOTOR' },
        { countryCode: 'GR', productType: 'HOME' },
    ])('creates and dispatches $countryCode $productType with an explicit product code', async ({ countryCode, productType }) => {
        const { tenant, context } = contextForCountry(countryCode);
        const result = await runWithOperatingTenant(tenant, () => sendWizardLink(inputForProduct(productType), context));

        expect(result).toMatchObject({ ok: true, status: 'completed', extra: { policy_id: 'draft-1', policy_holder_id: 'holder-1' } });
        expect(mocks.upsertHolder).toHaveBeenCalledWith({ name: 'Example Customer', contact: 'customer@example.test' });
        expect(mocks.createDraft).toHaveBeenCalledWith({ policyHolderId: 'holder-1', productType });
        expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
            trigger: 'QUOTE_RESUME_LINK_REQUESTED',
            entityType: 'POLICY',
            entityId: 'draft-1',
            productCode: productType,
            toEmail: 'customer@example.test',
            variables: expect.objectContaining({ quote: expect.objectContaining({ resumeUrl: `${tenant.publicBaseUrl}/quote/synthetic-token?product=${productType.toLowerCase()}&step=policy-holder` }) }),
        }));
    });

    it('accepts RENTAL and deep-links to the rental wizard entry step, not policy-holder', async () => {
        const { tenant, context } = contextForCountry('US');
        const result = await runWithOperatingTenant(tenant, () => sendWizardLink(inputForProduct('RENTAL'), context));

        // Before RENTAL was added to SUPPORTED_PRODUCTS this returned
        // UNSUPPORTED_PRODUCT and no invite could ever be sent for a rental quote.
        expect(result).not.toMatchObject({ error: { code: 'UNSUPPORTED_PRODUCT' } });
        expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
            productCode: 'RENTAL',
            variables: expect.objectContaining({
                quote: expect.objectContaining({
                    resumeUrl: expect.stringContaining('product=rental'),
                }),
            }),
        }));
        const dispatched = mocks.dispatch.mock.calls[0]![0] as { variables: { quote: { resumeUrl: string } } };
        expect(dispatched.variables.quote.resumeUrl).not.toContain('step=policy-holder');
        expect(dispatched.variables.quote.resumeUrl).toContain('step=rental-search');
    });

    it('still refuses a product that is not supported', async () => {
        const { tenant, context } = contextForCountry('CY');
        const result = await runWithOperatingTenant(
            tenant,
            () => sendWizardLink({ name: 'Example Customer', email: 'customer@example.test', productType: 'PET' as SendWizardLinkInput['productType'] }, context),
        );

        expect(result).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_PRODUCT' } });
        expect(mocks.upsertHolder).not.toHaveBeenCalled();
        expect(mocks.dispatch).not.toHaveBeenCalled();
    });

    it('does not report completion when customer email dispatch is skipped', async () => {
        const { tenant, context } = contextForCountry('CY');
        mocks.dispatch.mockResolvedValue({ skipped: true, reason: 'Missing variables: quote.resumeUrl' });
        const result = await runWithOperatingTenant(tenant, () => sendWizardLink(inputForProduct('MOTOR'), context));

        expect(result).toMatchObject({ ok: false, status: 'error' });
        expect(result.status).not.toBe('completed');
        expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    });
});
