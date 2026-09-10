import { describe, expect, it } from 'vitest';
import { getTenantTermsAttachment } from '../tenantTermsAttachment.js';

describe('getTenantTermsAttachment', () => {
  it('resolves the Portugal terms PDF', () => {
    const attachment = getTenantTermsAttachment('PT');

    expect(attachment).toEqual(expect.objectContaining({
      filename: 'TermsAndConditionsPortugal.pdf',
      mimetype: 'application/pdf',
      size: expect.any(Number),
      contentBase64: expect.any(String),
    }));
    expect(attachment?.size).toBeGreaterThan(0);
    expect(Buffer.from(attachment?.contentBase64 || '', 'base64').subarray(0, 4).toString()).toBe('%PDF');
  });

  it('resolves the Cyprus terms PDF', () => {
    const attachment = getTenantTermsAttachment('cy');

    expect(attachment).toEqual(expect.objectContaining({
      filename: 'TermsAndConditionsCyprus.pdf',
      mimetype: 'application/pdf',
      size: expect.any(Number),
      contentBase64: expect.any(String),
    }));
    expect(attachment?.size).toBeGreaterThan(0);
    expect(Buffer.from(attachment?.contentBase64 || '', 'base64').subarray(0, 4).toString()).toBe('%PDF');
  });

  it('does not attach terms for jurisdictions without a configured PDF', () => {
    expect(getTenantTermsAttachment('GR')).toBeNull();
    expect(getTenantTermsAttachment('ES')).toBeNull();
  });

  it('returns cached PDF content for repeat resolutions', () => {
    const first = getTenantTermsAttachment('PT');
    const second = getTenantTermsAttachment('PT');

    expect(second?.contentBase64).toBe(first?.contentBase64);
  });
});
