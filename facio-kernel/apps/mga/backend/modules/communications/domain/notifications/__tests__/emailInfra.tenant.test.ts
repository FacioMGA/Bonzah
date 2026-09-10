import { describe, expect, it, vi } from 'vitest';
import { runWithOperatingTenant } from '../../../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../../../platform/tenant/tenantConfig.js';
import { loadPolicyWelcomeInlineLogos } from '../emailInfra.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => Buffer.from('logo')),
}));

function tenant(overrides: Partial<TenantConfig>): TenantConfig {
  return {
    id: 'tenant-test',
    tenantSlug: 'abbeygate-cy',
    countryCode: 'CY',
    country: 'Cyprus',
    currency: 'EUR',
    ipt: { flatFee: 0 },
    adminFee: 10,
    publicBaseUrl: 'https://abbeygate-cy.facio.io',
    fromEmail: 'cy@example.com',
    brandLogo: { white: 'https://cdn.example.com/cy-white.png', blue: 'https://cdn.example.com/cy-blue.png' },
    legalPack: 'cy',
    ...overrides,
  };
}

describe('emailInfra tenant branding', () => {
  it('uses the active operating tenant for inline logo content IDs', async () => {
    await runWithOperatingTenant(tenant({
      tenantSlug: 'abbeygate-pt',
      countryCode: 'PT',
      publicBaseUrl: 'https://abbeygate-pt.facio.io',
      fromEmail: 'pt@example.com',
      brandLogo: {
        white: 'https://cdn.example.com/pt-white.png',
        blue: 'https://cdn.example.com/pt-blue.png',
      },
    }), async () => {
      const attachments = await loadPolicyWelcomeInlineLogos();
      expect(attachments.map((attachment) => attachment.contentId)).toEqual([
        'abbeygate-pt-logo-white',
        'abbeygate-pt-logo-blue',
      ]);
    });
  });
});
