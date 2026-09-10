import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendExecuteMock = vi.fn();
const policyLookupMock = vi.fn<() => Promise<{ productType: string | null } | null>>();
vi.mock('../../../../platform/db/connection.js', () => ({ tenantScopedPrisma: { policy: { findUnique: policyLookupMock } } }));
vi.mock('../syntheticEmailAudit.js', () => ({ recordSyntheticEmailRun: vi.fn() }));
const countryMock = vi.hoisted(() => ({ countryCode: 'CY' }));
vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({ getTenantConfig: () => countryMock }));

vi.mock('../commands/sendMessageCommand.js', () => ({
  sendMessageCommand: {
    execute: sendExecuteMock,
  },
}));

vi.mock('../customerEmailTriggerRegistry.js', () => ({
  resolveTemplateForTrigger: vi.fn(() => 'UW_INFO_REQUEST'),
}));

vi.mock('../customerTemplateCatalogService.js', () => ({
  renderCustomerTemplate: vi.fn(async () => ({
    templateKey: 'UW_INFO_REQUEST',
    templateId: 'customer-template-uw-info-request',
    templateName: 'UW_INFO_REQUEST',
    subject: 'Action required',
    bodyText: 'Please send details',
    bodyHtml: '<p>Please send details</p>',
    missingVariables: [],
    usedVariables: ['customer.firstName', 'uw.url'],
    variablesSchemaValidation: { valid: true, missing: [] },
    systemOnly: false,
  })),
}));

describe('dispatchCustomerEmailTrigger', () => {
  beforeEach(() => {
    countryMock.countryCode = 'CY';
    vi.clearAllMocks();
    sendExecuteMock.mockResolvedValue({ id: 'msg-1' });
    policyLookupMock.mockResolvedValue({ productType: 'TRAVEL' });
  });

  it.each(['QUOTE_SENT', 'QUOTE_FOLLOW_UP', 'QUOTE_RESUME_LINK_REQUESTED', 'UW_INFO_REQUESTED', 'PAYMENT_REQUESTED', 'NEW_BUSINESS_PLACED', 'RENEWAL_INVITE', 'RENEWAL_CHASER'] as const)('does not queue %s for Greece Motor', async (trigger) => {
    countryMock.countryCode = 'GR';
    const { dispatchCustomerEmailTrigger } = await import('../customerEmailTriggerService.js');
    const result = await dispatchCustomerEmailTrigger({ trigger, entityType: 'POLICY', entityId: 'old-gr-draft', toEmail: 'test@example.com', productCode: 'MOTOR', variables: {} });
    expect(result).toMatchObject({ skipped: true, reason: expect.stringContaining('PRODUCT_UNAVAILABLE') });
    expect(sendExecuteMock).not.toHaveBeenCalled();
  });

  it.each(['QUOTE_SENT', 'QUOTE_FOLLOW_UP', 'QUOTE_RESUME_LINK_REQUESTED', 'UW_INFO_REQUESTED', 'PAYMENT_REQUESTED', 'NEW_BUSINESS_PLACED', 'RENEWAL_INVITE', 'RENEWAL_CHASER'] as const)('resolves omitted identity and blocks Greece Motor %s before rendering or queueing', async (trigger) => {
    countryMock.countryCode = 'GR';
    policyLookupMock.mockResolvedValue({ productType: 'MOTOR' });
    const { dispatchCustomerEmailTrigger } = await import('../customerEmailTriggerService.js');
    const { renderCustomerTemplate } = await import('../customerTemplateCatalogService.js');
    const result = await dispatchCustomerEmailTrigger({ trigger, entityType: 'POLICY', entityId: 'old-gr-draft', toEmail: 'test@example.com', variables: {} });
    expect(result).toMatchObject({ skipped: true, reason: expect.stringContaining('PRODUCT_UNAVAILABLE') });
    expect(policyLookupMock).toHaveBeenCalledWith({ where: { id: 'old-gr-draft' }, select: { productType: true } });
    expect(renderCustomerTemplate).not.toHaveBeenCalled();
    expect(sendExecuteMock).not.toHaveBeenCalled();
  });

  it('fails closed when a policy product cannot be resolved', async () => {
    policyLookupMock.mockResolvedValue(null);
    const { dispatchCustomerEmailTrigger } = await import('../customerEmailTriggerService.js');
    expect(await dispatchCustomerEmailTrigger({ trigger: 'QUOTE_SENT', entityType: 'POLICY', entityId: 'missing', toEmail: 'test@example.com', variables: {} })).toMatchObject({ skipped: true, reason: expect.stringContaining('PRODUCT_IDENTITY_REQUIRED') });
    expect(sendExecuteMock).not.toHaveBeenCalled();
  });

  it.each(['QUOTE_SENT', 'QUOTE_FOLLOW_UP', 'QUOTE_RESUME_LINK_REQUESTED', 'UW_INFO_REQUESTED', 'NEW_BUSINESS_PLACED', 'RENEWAL_INVITE', 'RENEWAL_CHASER'] as const)('requires product identity for %s even without a POLICY entity', async (trigger) => {
    const { dispatchCustomerEmailTrigger } = await import('../customerEmailTriggerService.js');
    expect(await dispatchCustomerEmailTrigger({ trigger, entityType: 'QUOTE', entityId: 'quote-1', toEmail: 'test@example.com', variables: {} })).toMatchObject({ skipped: true, reason: expect.stringContaining('PRODUCT_IDENTITY_REQUIRED') });
    expect(sendExecuteMock).not.toHaveBeenCalled();
    expect(policyLookupMock).not.toHaveBeenCalled();
  });

  it('uses the resolved supported product for template selection', async () => {
    countryMock.countryCode = 'GR';
    policyLookupMock.mockResolvedValue({ productType: 'HOME' });
    const { dispatchCustomerEmailTrigger } = await import('../customerEmailTriggerService.js');
    const { resolveTemplateForTrigger } = await import('../customerEmailTriggerRegistry.js');
    expect(await dispatchCustomerEmailTrigger({ trigger: 'QUOTE_SENT', entityType: 'POLICY', entityId: 'gr-home', toEmail: 'test@example.com', variables: {} })).toMatchObject({ messageId: 'msg-1' });
    expect(resolveTemplateForTrigger).toHaveBeenCalledWith('QUOTE_SENT', { productCode: 'HOME', isRenewal: undefined });
  });

  it('preserves generic invoice payment notifications without inventing a policy product', async () => {
    const { dispatchCustomerEmailTrigger } = await import('../customerEmailTriggerService.js');
    expect(await dispatchCustomerEmailTrigger({ trigger: 'PAYMENT_REQUESTED', entityType: 'INVOICE', entityId: 'invoice-1', toEmail: 'test@example.com', variables: {} })).toMatchObject({ messageId: 'msg-1' });
    expect(policyLookupMock).not.toHaveBeenCalled();
  });

  it('preserves an allowlisted generic synthetic preview without a business policy', async () => {
    process.env.SYNTHETIC_EMAIL_ALLOWLIST = 'qa+sink@facio.io';
    const { dispatchCustomerEmailTrigger } = await import('../customerEmailTriggerService.js');
    expect(await dispatchCustomerEmailTrigger({ trigger: 'QUOTE_SENT', entityType: 'POLICY', entityId: 'preview-test:QUOTE_STANDARD', toEmail: 'qa+sink@facio.io', variables: {}, synthetic: true, source: 'PREVIEW_TEST_SEND' })).toMatchObject({ messageId: 'msg-1' });
    expect(policyLookupMock).not.toHaveBeenCalled();
  });

  it('preserves historical Greece Motor document resend communications', async () => {
    countryMock.countryCode = 'GR';
    const { dispatchCustomerEmailTrigger } = await import('../customerEmailTriggerService.js');
    expect(await dispatchCustomerEmailTrigger({ trigger: 'DOCUMENTS_RESEND', entityType: 'POLICY', entityId: 'issued-gr-history', toEmail: 'test@example.com', productCode: 'MOTOR', variables: {} })).toMatchObject({ messageId: 'msg-1' });
  });

  it('builds deterministic idempotency key for same trigger payload', async () => {
    const { dispatchCustomerEmailTrigger } = await import('../customerEmailTriggerService.js');

    const input = {
      trigger: 'UW_INFO_REQUESTED' as const,
      entityType: 'POLICY' as const,
      entityId: 'policy-1',
      toEmail: 'customer@example.com',
      variables: {
        customer: { firstName: 'Avi' },
        uw: { message: 'Need docs', url: 'https://example.com/form' },
      },
      idempotencySeed: 'seed-1',
    };

    await dispatchCustomerEmailTrigger(input);
    await dispatchCustomerEmailTrigger(input);

    const first = sendExecuteMock.mock.calls[0]?.[0];
    const second = sendExecuteMock.mock.calls[1]?.[0];
    expect(first.idempotencyKey).toBeTruthy();
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
  });

  it('skips synthetic dispatch when the recipient is not on the allowlist', async () => {
    process.env.SYNTHETIC_EMAIL_ALLOWLIST = 'qa+sink@facio.io';
    process.env.ISSUANCE_PROOF_WELCOME_TO = 'qa+sink@facio.io';
    const { dispatchCustomerEmailTrigger } = await import('../customerEmailTriggerService.js');

    const result = await dispatchCustomerEmailTrigger({
      trigger: 'NEW_BUSINESS_PLACED',
      entityType: 'POLICY',
      entityId: 'policy-proof',
      toEmail: 'alerts@facio.io',
      synthetic: true,
      source: 'ISSUANCE_PROOF',
      variables: {
        customer: { firstName: 'Ada' },
        policy: {
          number: 'PROOF-1',
          boundDate: '28 August 2026',
          startDate: '1 May 2026',
          endDate: '1 May 2027',
          coverSubjectLabel: 'Trip',
          vehicleDescription: 'Single Trip to Spain',
          dashboardUrl: 'https://cy.abbeygate.com/login',
        },
        support: { phone: '+357 26 819175' },
      },
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/SYNTHETIC_RECIPIENT_NOT_ALLOWLISTED/);
    expect(sendExecuteMock).not.toHaveBeenCalled();
  });
});
