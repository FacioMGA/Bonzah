import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendExecuteMock = vi.fn();

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
    vi.clearAllMocks();
    sendExecuteMock.mockResolvedValue({ id: 'msg-1' });
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
