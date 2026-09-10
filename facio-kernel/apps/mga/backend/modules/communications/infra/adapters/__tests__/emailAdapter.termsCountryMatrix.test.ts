import { createHash } from 'node:crypto';
import sgMail from '@sendgrid/mail';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailPort } from '../../../../../platform/ports/interfaces.js';
import { smtpSendMail } from '../../../../../platform/events/smtpClient.js';
import { emailPortService } from '../../../app/services/emailPortService.js';
import { sendEmail } from '../emailAdapter.js';

vi.mock('@sendgrid/mail', () => ({ default: { send: vi.fn(), setApiKey: vi.fn() } }));
vi.mock('../../../../../platform/events/smtpClient.js', () => ({ smtpSendMail: vi.fn() }));

const countries = [
  { country: 'CY', filename: 'TermsAndConditionsCyprus.pdf', sha256: '5fcad9d31a18789f04fa6a01714f1742ecb20630ded4cd7ee9fac637011b3515' },
  { country: 'GR', filename: 'TermsAndConditionsGreece.pdf', sha256: '5fcad9d31a18789f04fa6a01714f1742ecb20630ded4cd7ee9fac637011b3515' },
  { country: 'PT', filename: 'TermsAndConditionsPortugal.pdf', sha256: '390f4b37d1aeee76d498fc24d5fd521d88128cd5ae9f07b8a64fb740e125c5b5' },
];
const packAttachment = { filename: 'policy-pack.pdf', mimetype: 'application/pdf', contentBase64: Buffer.from('existing policy pack').toString('base64') };
const hash = (content: string | undefined) => createHash('sha256').update(Buffer.from(content || '', 'base64')).digest('hex');

describe.each(countries)('approved $country Terms transport', ({ country, filename, sha256 }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SENDGRID_API_KEY', 'test-key');
    vi.stubEnv('SMTP_HOST', 'smtp.example.invalid');
    vi.stubEnv('SMTP_PORT', '587');
    vi.mocked(sgMail.send).mockResolvedValue([{ statusCode: 202, body: {}, headers: { 'x-message-id': 'test-provider-id' } }, {}]);
    vi.mocked(smtpSendMail).mockResolvedValue(undefined);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each(['Quote', 'Issued policy pack'])('appends the approved PDF to a SendGrid raw %s and preserves existing documents', async (subject) => {
    const result = await sendEmail({ id: `test-${country}`, channel: 'EMAIL', provider: 'SENDGRID', fromActor: 'system', toRecipients: ['customer@example.invalid'], subject, body: subject, attachments: [packAttachment], externalRefs: { tenantCountryCode: country } });
    expect(result.status).toBe('SENT');
    const sent = vi.mocked(sgMail.send).mock.calls[0]?.[0];
    if (!sent || Array.isArray(sent)) throw new Error('Expected one email payload');
    expect(sent.attachments).toEqual(expect.arrayContaining([expect.objectContaining({ filename: packAttachment.filename, content: packAttachment.contentBase64 })]));
    const terms = sent.attachments?.filter((attachment) => attachment.filename === filename);
    expect(terms).toHaveLength(1);
    expect(hash(terms?.[0]?.content)).toBe(sha256);
  });

  it('carries the same approved MIME bytes through a provider template', async () => {
    const send = vi.fn<EmailPort['send']>().mockResolvedValue('test-template-id');
    emailPortService.overrideEmailPort({ send });
    const result = await sendEmail({ id: `test-${country}`, channel: 'EMAIL', provider: 'SENDGRID', fromActor: 'system', toRecipients: ['customer@example.invalid'], subject: 'Quote', body: 'Quote', attachments: [packAttachment], externalRefs: { tenantCountryCode: country, providerTemplateId: 'test-template', template: { variables: {} } } });
    expect(result.status).toBe('SENT');
    const attachments = send.mock.calls[0]?.[3]?.attachments;
    expect(attachments).toEqual(expect.arrayContaining([packAttachment]));
    expect(hash(attachments?.find((attachment) => attachment.filename === filename)?.contentBase64)).toBe(sha256);
  });

  it('carries the same approved MIME bytes through SMTP', async () => {
    const result = await sendEmail({ id: `test-${country}`, channel: 'EMAIL', provider: 'SMTP', fromActor: 'system', toRecipients: ['customer@example.invalid'], subject: 'Issued policy pack', body: 'Issued policy pack', attachments: [packAttachment], externalRefs: { tenantCountryCode: country } });
    expect(result.status).toBe('SENT');
    const attachments = vi.mocked(smtpSendMail).mock.calls[0]?.[0]?.attachments;
    expect(attachments).toEqual(expect.arrayContaining([packAttachment]));
    expect(hash(attachments?.find((attachment) => attachment.filename === filename)?.contentBase64)).toBe(sha256);
  });

  it('preserves already supplied same-filename terms without duplication or replacement', async () => {
    const existing = { filename, mimetype: 'application/pdf', contentBase64: Buffer.from('previously supplied terms').toString('base64') };
    await sendEmail({ id: `test-${country}`, channel: 'EMAIL', provider: 'SENDGRID', fromActor: 'system', toRecipients: ['customer@example.invalid'], subject: 'Issued policy pack', body: 'Issued policy pack', attachments: [packAttachment, existing], externalRefs: { tenantCountryCode: country } });
    const sent = vi.mocked(sgMail.send).mock.calls[0]?.[0];
    if (!sent || Array.isArray(sent)) throw new Error('Expected one email payload');
    expect(sent.attachments?.filter((attachment) => attachment.filename === filename)).toEqual([expect.objectContaining({ content: existing.contentBase64 })]);
  });
});
