import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { getTenantTermsAttachment } from '../tenantTermsAttachment.js';

describe('getTenantTermsAttachment', () => {
  beforeEach(() => vi.stubEnv('KERNEL_PLATFORM_MODE', 'false'));
  afterEach(() => vi.unstubAllEnvs());
  it('never assigns archived customer terms by country in the shared platform', () => {
    vi.stubEnv('KERNEL_PLATFORM_MODE', 'true');
    for (const country of ['CY', 'PT', 'GR', 'ES']) expect(getTenantTermsAttachment(country)).toBeNull();
  });
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
    expect(getTenantTermsAttachment('ES')).toBeNull();
    expect(getTenantTermsAttachment('')).toBeNull();
    expect(getTenantTermsAttachment('unknown')).toBeNull();
  });

  it.each([
    ['CY', 'TermsAndConditionsCyprus.pdf', '5fcad9d31a18789f04fa6a01714f1742ecb20630ded4cd7ee9fac637011b3515'],
    [' gr ', 'TermsAndConditionsGreece.pdf', '5fcad9d31a18789f04fa6a01714f1742ecb20630ded4cd7ee9fac637011b3515'],
    ['PT', 'TermsAndConditionsPortugal.pdf', '390f4b37d1aeee76d498fc24d5fd521d88128cd5ae9f07b8a64fb740e125c5b5'],
  ])('serves the exact approved %s master without rewriting its bytes', (country, filename, sha256) => {
    const attachment = getTenantTermsAttachment(country);
    expect(attachment?.filename).toBe(filename);
    const bytes = Buffer.from(attachment?.contentBase64 || '', 'base64');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
    expect(attachment?.size).toBe(bytes.length);
  });

  it('returns cached PDF content for repeat resolutions', () => {
    const first = getTenantTermsAttachment('PT');
    const second = getTenantTermsAttachment('PT');

    expect(second?.contentBase64).toBe(first?.contentBase64);
  });
});
