import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailPort } from '../../../../../platform/ports/interfaces.js';
import { emailPortService } from '../../../app/services/emailPortService.js';
import { sendEmail } from '../emailAdapter.js';

const sendgridMocks = vi.hoisted(() => ({
  send: vi.fn(async () => [{ headers: { 'x-message-id': 'sg-message-1' } }]),
  setApiKey: vi.fn(),
}));

vi.mock('@sendgrid/mail', () => ({
  default: {
    send: sendgridMocks.send,
    setApiKey: sendgridMocks.setApiKey,
  },
}));

describe('emailAdapter tenant terms attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
  });

  it('adds the Portugal terms PDF to SendGrid raw emails', async () => {
    await sendEmail({
      id: 'msg-pt',
      channel: 'EMAIL',
      provider: 'SENDGRID',
      fromActor: 'system',
      toRecipients: ['customer@example.com'],
      subject: 'Quote',
      body: 'Here is your quote',
      attachments: [{
        filename: 'quote.pdf',
        mimetype: 'application/pdf',
        contentBase64: Buffer.from('quote-pdf').toString('base64'),
      }],
      externalRefs: { tenantCountryCode: 'PT' },
    });

    const payload = sendgridMocks.send.mock.calls[0]?.[0] as { attachments?: Array<{ filename: string; content: string; type: string }> };
    expect(payload.attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ filename: 'quote.pdf' }),
      expect.objectContaining({
        filename: 'TermsAndConditionsPortugal.pdf',
        type: 'application/pdf',
        content: expect.any(String),
      }),
    ]));
    const terms = payload.attachments?.find((attachment) => attachment.filename === 'TermsAndConditionsPortugal.pdf');
    expect(Buffer.from(terms?.content || '', 'base64').subarray(0, 4).toString()).toBe('%PDF');
  });

  it('adds the Cyprus terms PDF to SendGrid template emails', async () => {
    const sent = vi.fn(async () => 'template-message-1');
    const fakePort: EmailPort = { send: sent };
    emailPortService.overrideEmailPort(fakePort);

    await sendEmail({
      id: 'msg-cy',
      channel: 'EMAIL',
      provider: 'SENDGRID',
      fromActor: 'system',
      toRecipients: ['customer@example.com'],
      subject: 'Welcome',
      body: 'Welcome',
      attachments: [],
      externalRefs: {
        providerTemplateId: 'sendgrid-template-id',
        tenantCountryCode: 'CY',
        template: {
          variables: { customer: { firstName: 'Ada' } },
        },
      },
    });

    expect(sent).toHaveBeenCalledWith(
      'customer@example.com',
      'sendgrid-template-id',
      { customer: { firstName: 'Ada' } },
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            filename: 'TermsAndConditionsCyprus.pdf',
            mimetype: 'application/pdf',
            contentBase64: expect.any(String),
          }),
        ],
      }),
    );
  });

  it('does not duplicate an existing tenant terms attachment', async () => {
    await sendEmail({
      id: 'msg-pt-duplicate',
      channel: 'EMAIL',
      provider: 'SENDGRID',
      fromActor: 'system',
      toRecipients: ['customer@example.com'],
      subject: 'Quote',
      body: 'Here is your quote',
      attachments: [{
        filename: 'TermsAndConditionsPortugal.pdf',
        mimetype: 'application/pdf',
        contentBase64: Buffer.from('existing-terms').toString('base64'),
      }],
      externalRefs: { tenantCountryCode: 'PT' },
    });

    const payload = sendgridMocks.send.mock.calls[0]?.[0] as { attachments?: Array<{ filename: string }> };
    const termsAttachments = (payload.attachments || [])
      .filter((attachment) => attachment.filename === 'TermsAndConditionsPortugal.pdf');
    expect(termsAttachments).toHaveLength(1);
  });

  it('does not add a terms PDF when the tenant country has no configured attachment', async () => {
    await sendEmail({
      id: 'msg-gr',
      channel: 'EMAIL',
      provider: 'SENDGRID',
      fromActor: 'system',
      toRecipients: ['customer@example.com'],
      subject: 'Quote',
      body: 'Here is your quote',
      attachments: [],
      externalRefs: { tenantCountryCode: 'GR' },
    });

    const payload = sendgridMocks.send.mock.calls[0]?.[0] as { attachments?: Array<{ filename: string }> };
    expect(payload.attachments || []).toHaveLength(0);
  });
});

// Synthetic messages (canary / preview / test-send) may ONLY be delivered to
// an allowlisted test mailbox. The transport is the last-line, caller-agnostic
// guardrail — it refuses to hand a synthetic message to a real address.
describe('emailAdapter synthetic recipient allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.SYNTHETIC_EMAIL_ALLOWLIST = 'qa+sink@facio.io';
    delete process.env.ISSUANCE_PROOF_WELCOME_TO;
    delete process.env.ISSUANCE_PROOF_ALERT_TO;
  });

  it('refuses a synthetic message to a non-allowlisted address and never calls the provider', async () => {
    const result = await sendEmail({
      id: 'msg-synthetic-blocked',
      channel: 'EMAIL',
      provider: 'SENDGRID',
      fromActor: 'system',
      toRecipients: ['theo@abbeygate.cy'],
      subject: '[SYNTHETIC TEST — NOT A REAL POLICY] Welcome',
      body: 'synthetic',
      attachments: [],
      externalRefs: { synthetic: true, tenantCountryCode: 'CY' },
    });

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('SYNTHETIC_RECIPIENT_NOT_ALLOWLISTED');
    expect(sendgridMocks.send).not.toHaveBeenCalled();
  });

  it('delivers a synthetic message to an allowlisted address', async () => {
    const result = await sendEmail({
      id: 'msg-synthetic-ok',
      channel: 'EMAIL',
      provider: 'SENDGRID',
      fromActor: 'system',
      toRecipients: ['qa+sink@facio.io'],
      subject: '[SYNTHETIC TEST — NOT A REAL POLICY] Welcome',
      body: 'synthetic',
      attachments: [],
      externalRefs: { synthetic: true, tenantCountryCode: 'CY' },
    });

    expect(result.status).toBe('SENT');
    expect(sendgridMocks.send).toHaveBeenCalledTimes(1);
  });

  it('does not apply the allowlist to a normal (non-synthetic) customer email', async () => {
    const result = await sendEmail({
      id: 'msg-real-customer',
      channel: 'EMAIL',
      provider: 'SENDGRID',
      fromActor: 'system',
      toRecipients: ['customer@gmail.com'],
      subject: 'Welcome',
      body: 'real',
      attachments: [],
      externalRefs: { tenantCountryCode: 'CY' },
    });

    expect(result.status).toBe('SENT');
    expect(sendgridMocks.send).toHaveBeenCalledTimes(1);
  });
});

// The inbox "From" must read as the Abbeygate brand, not the platform
// vendor default a bare `no-reply@…` address inherits from SendGrid.
describe('emailAdapter from display name (branding)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
    delete process.env.EMAIL_FROM_NAME;
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@abbeygate.cy';
  });

  it('sets the brand display name on the SendGrid raw From for a branded customer email', async () => {
    await sendEmail({
      id: 'msg-brand',
      channel: 'EMAIL',
      provider: 'SENDGRID',
      fromActor: 'system',
      toRecipients: ['customer@example.com'],
      subject: 'Pick up where you left off',
      body: 'Your answers have been saved.',
      attachments: [],
      externalRefs: { tenantCountryCode: 'CY' },
    });

    const payload = sendgridMocks.send.mock.calls[0]?.[0] as { from?: unknown; replyTo?: unknown };
    expect(payload.from).toEqual({ email: 'no-reply@abbeygate.cy', name: 'Abbeygate' });
    expect(payload.replyTo).toBe('cyprus@abbeygate.cy');
  });

  it('sets Reply-To from the tenant contact inbox (ABY-440)', async () => {
    await sendEmail({
      id: 'msg-reply-to',
      channel: 'EMAIL',
      provider: 'SENDGRID',
      fromActor: 'system',
      toRecipients: ['customer@example.com'],
      subject: 'Quote',
      body: 'Here is your quote',
      attachments: [],
      externalRefs: { tenantCountryCode: 'PT' },
    });

    const payload = sendgridMocks.send.mock.calls[0]?.[0] as { replyTo?: unknown; from?: unknown };
    expect(payload.from).toEqual({ email: 'no-reply@abbeygate.cy', name: 'Abbeygate' });
    expect(payload.replyTo).toBe('portugal@abbeygate.pt');
  });

  it('omits Reply-To when the tenant country is unknown (no invented fallback)', async () => {
    await sendEmail({
      id: 'msg-no-reply-to',
      channel: 'EMAIL',
      provider: 'SENDGRID',
      fromActor: 'system',
      toRecipients: ['customer@example.com'],
      subject: 'Quote',
      body: 'Here is your quote',
      attachments: [],
      externalRefs: { tenantCountryCode: 'XX' },
    });

    const payload = sendgridMocks.send.mock.calls[0]?.[0] as { replyTo?: unknown };
    expect(payload.replyTo).toBeUndefined();
  });

  it('honours the EMAIL_FROM_NAME override when set', async () => {
    process.env.EMAIL_FROM_NAME = 'Abbeygate Insurance';
    await sendEmail({
      id: 'msg-brand-override',
      channel: 'EMAIL',
      provider: 'SENDGRID',
      fromActor: 'system',
      toRecipients: ['customer@example.com'],
      subject: 'Pick up where you left off',
      body: 'Your answers have been saved.',
      attachments: [],
      externalRefs: { tenantCountryCode: 'CY' },
    });

    const payload = sendgridMocks.send.mock.calls[0]?.[0] as { from?: unknown };
    expect(payload.from).toEqual({ email: 'no-reply@abbeygate.cy', name: 'Abbeygate Insurance' });
  });

  it('leaves From as a bare address when there is no tenant/brand context', async () => {
    await sendEmail({
      id: 'msg-no-brand',
      channel: 'EMAIL',
      provider: 'SENDGRID',
      fromActor: 'system',
      toRecipients: ['customer@example.com'],
      subject: 'Internal',
      body: 'No brand context',
      attachments: [],
      externalRefs: {},
    });

    const payload = sendgridMocks.send.mock.calls[0]?.[0] as { from?: unknown };
    expect(payload.from).toBe('no-reply@abbeygate.cy');
  });
});
