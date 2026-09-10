import { describe, expect, it } from 'vitest';

import {
  buildBrandProfile,
  brandVariables,
  expandBrandPlaceholders,
  getFallbackBrandProfile,
  renderEmailLayout,
  type BrandJurisdictionKey,
} from '../emailBranding.js';
import { renderCustomerTemplate } from '../customerTemplateRenderer.js';

const BASE_URL = 'https://abbeygate-cy.facio.io';

function profileFor(jurisdiction: BrandJurisdictionKey) {
  return buildBrandProfile({
    countryCode: jurisdiction,
    brokerName: 'Abbeygate',
    whiteLogoUrl: null,
    publicBaseUrl: BASE_URL,
    fromEmail: `no-reply@abbeygate.${jurisdiction.toLowerCase()}`,
  });
}

describe('emailBranding — buildBrandProfile', () => {
  it('falls back to logo asset path when DB has no logo URL', () => {
    const profile = profileFor('CY');
    expect(profile.logoUrl).toBe(`${BASE_URL}/assets/branding/logo-white.png`);
    expect(profile.brandName).toBe('Abbeygate');
    expect(profile.jurisdictionKey).toBe('CY');
  });

  it('honours explicit DB-supplied logo URL when provided', () => {
    const profile = buildBrandProfile({
      countryCode: 'PT',
      brokerName: 'Abbeygate',
      whiteLogoUrl: 'https://cdn.example.com/abbeygate-pt-white.png',
      publicBaseUrl: BASE_URL,
      fromEmail: 'no-reply@abbeygate.pt',
    });
    expect(profile.logoUrl).toBe('https://cdn.example.com/abbeygate-pt-white.png');
  });

  it('normalises unknown jurisdictions to CY', () => {
    const profile = buildBrandProfile({
      countryCode: 'IT',
      brokerName: 'Abbeygate',
      whiteLogoUrl: null,
      publicBaseUrl: BASE_URL,
      fromEmail: 'no-reply@abbeygate.it',
    });
    expect(profile.jurisdictionKey).toBe('CY');
  });
});

describe('emailBranding — per-jurisdiction signatures', () => {
  it('Cyprus signature carries the ICCS regulator and CY phones', () => {
    const html = renderEmailLayout({ bodyText: 'Hello there.', brand: profileFor('CY') });
    expect(html).toContain("Lloyd&#39;s Coverholder registered and regulated in Cyprus.");
    expect(html).toContain('Insurance Companies Control Service (ICCS)');
    expect(html).toContain('Mesogi Avenue');
    expect(html).toContain('+357 97 612602');
    expect(html).toContain('+357 99 218015');
    expect(html).toContain('+357 26 819175');
    expect(html).toContain('https://wa.me/35797612602');
    expect(html).toContain('Abbeygate.cy');
  });

  it('Portugal signature carries the NIPC and PT phones', () => {
    const html = renderEmailLayout({ bodyText: 'Hello.', brand: profileFor('PT') });
    expect(html).toContain('Sucursal em Portugal');
    expect(html).toContain('NIPC) 980831970');
    expect(html).toContain('Boliqueime');
    expect(html).toContain('+351 968 127522');
    expect(html).toContain('+351 925 602100');
    expect(html).toContain('+351 289 369 254');
    expect(html).toContain('https://wa.me/351968127522');
  });

  it('Spain signature reuses the Cyprus regulator (per spec)', () => {
    const html = renderEmailLayout({ bodyText: 'Hello.', brand: profileFor('ES') });
    expect(html).toContain('Insurance Companies Control Service (ICCS)');
    expect(html).toContain('+357 97 612602');
    expect(html).toContain('Mesogi Avenue');
  });

  it('Greece signature carries GR + UK numbers and working hours', () => {
    const html = renderEmailLayout({ bodyText: 'Hello.', brand: profileFor('GR') });
    expect(html).toContain('+30 211 2345 774');
    expect(html).toContain('+44 7593 621183');
    expect(html).toContain('Working Hours');
    expect(html).toContain('Insurance Companies Control Service (ICCS)');
  });
});

describe('emailBranding — layout safety', () => {
  it('escapes user-supplied HTML in the body', () => {
    const html = renderEmailLayout({
      bodyText: 'Hello <script>alert(1)</script> & friends',
      brand: profileFor('CY'),
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; friends');
  });

  it('auto-links bare URLs in the rendered body', () => {
    const html = renderEmailLayout({
      bodyText: 'Continue here: https://example.com/quote/abc',
      brand: profileFor('CY'),
    });
    expect(html).toContain('href="https://example.com/quote/abc"');
  });

  it('renders an explicit reference label as a safe anchor', () => {
    const html = renderEmailLayout({
      bodyText: 'Reference: Q/1000155\nOpen: https://cy.abbeygate.com/policies/policy-1',
      brand: profileFor('CY'),
      inlineLinks: [{
        label: 'Q/1000155',
        url: 'https://cy.abbeygate.com/policies/policy-1#underwriting',
      }],
    });
    expect(html).toContain(
      'href="https://cy.abbeygate.com/policies/policy-1#underwriting"',
    );
    expect(html).toContain('>Q/1000155</a>');
  });

  it('does not turn a non-http destination into an inline link', () => {
    const html = renderEmailLayout({
      bodyText: 'Reference: Q/1000155',
      brand: profileFor('CY'),
      inlineLinks: [{ label: 'Q/1000155', url: 'javascript:alert(1)' }],
    });
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('Reference: Q/1000155');
  });

  it('includes the resolved logo as an <img>, never a literal placeholder', () => {
    const html = renderEmailLayout({ bodyText: 'Hi.', brand: profileFor('CY') });
    expect(html).toContain(`src="${BASE_URL}/assets/branding/logo-white.png"`);
    expect(html).not.toContain('{{brandName}}');
    expect(html).not.toContain('{{brand.');
  });
});

describe('renderCustomerTemplate — brand integration', () => {
  it('renders quote emails with the product label instead of hardcoded motor wording', () => {
    const result = renderCustomerTemplate(
      'QUOTE_STANDARD',
      {
        customer: { firstName: 'Business' },
        policy: { vehicleDescription: 'Business Test' },
        quote: {
          productLabel: 'business insurance proposal',
          reference: 'ABQ/CY1000296',
          premium: 'EUR 12,000.00',
          excess: 'EUR 500.00',
          url: 'https://example.com/quote/token?product=business&step=your-quote',
        },
      },
      { brand: profileFor('CY') },
    );

    expect(result.subject).toBe('Your business insurance proposal');
    expect(result.bodyText).toContain('Your business insurance proposal is ready for Business Test.');
    expect(result.bodyText).not.toContain('motor insurance quote');
  });

  it('does not leak {{brandName}} or {{brand.*}} placeholders into the rendered HTML', () => {
    const result = renderCustomerTemplate(
      'UW_INFO_REQUEST',
      {
        customer: { firstName: 'Avi' },
        uw: { message: 'We need your driver licence.', url: 'https://example.com/policy/abc' },
      },
      { brand: profileFor('CY') },
    );

    expect(result.bodyHtml).not.toContain('{{brandName}}');
    expect(result.bodyHtml).not.toContain('{{brand.');
    expect(result.bodyHtml).toContain('Hi Avi,');
    expect(result.bodyHtml).toContain('href="https://example.com/policy/abc"');
    expect(result.bodyHtml).toContain('The Abbeygate Team');
    expect(result.bodyHtml).toContain('Insurance Companies Control Service (ICCS)');
    expect(result.subject).toBe('Action required: additional information needed');
    expect(result.bodyText).not.toContain('Kind regards');
  });

  it('uses the brand profile when DB override mentions {{brandName}}', () => {
    const result = renderCustomerTemplate(
      'UW_INFO_REQUEST',
      { customer: { firstName: 'Sandra' }, uw: { url: 'https://x.test' } },
      {
        brand: profileFor('PT'),
        templateOverride: {
          subjectTemplate: '{{brandName}} — please respond',
          bodyTemplate: 'Dear {{customer.firstName}}, regards from {{brandName}} {{brand.jurisdiction}}. Link: {{uw.url}}',
          variablesSchema: { 'customer.firstName': 'required', 'uw.url': 'required' },
        },
      },
    );

    expect(result.subject).toBe('Abbeygate — please respond');
    expect(result.bodyText).toContain('regards from Abbeygate Portugal');
    expect(result.bodyHtml).toContain('Abbeygate Portugal');
    expect(result.bodyHtml).toContain('Sucursal em Portugal');
    expect(result.bodyHtml).not.toContain('{{brandName}}');
  });

  it('uses the deterministic CY fallback profile when no brand is injected', () => {
    const result = renderCustomerTemplate('UW_INFO_REQUEST', {
      customer: { firstName: 'Maria' },
      uw: { url: 'https://x.test' },
    });

    expect(result.bodyHtml).not.toContain('{{brandName}}');
    expect(result.bodyHtml).toContain('Mesogi Avenue');
  });
});

describe('emailBranding — helpers', () => {
  it('brandVariables exposes brandName and brand.* paths', () => {
    const vars = brandVariables(getFallbackBrandProfile());
    expect(vars.brandName).toBe('Abbeygate');
    expect(((vars.brand as Record<string, unknown>).jurisdiction)).toBe('Cyprus');
  });

  it('expandBrandPlaceholders rewrites {{brandName}} but leaves other placeholders untouched', () => {
    const expanded = expandBrandPlaceholders(
      'Welcome to {{brandName}}, {{customer.firstName}}.',
      profileFor('GR'),
    );
    expect(expanded).toBe('Welcome to Abbeygate, {{customer.firstName}}.');
  });
});
