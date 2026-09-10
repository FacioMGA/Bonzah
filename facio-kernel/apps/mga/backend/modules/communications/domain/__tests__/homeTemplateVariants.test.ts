import { describe, expect, it } from 'vitest';

import { resolveTemplateForTrigger } from '../../app/customerEmailTriggerRegistry.js';
import { renderCustomerTemplate } from '../customerTemplateRenderer.js';
import { buildBrandProfile } from '../emailBranding.js';

const CY_BRAND = buildBrandProfile({
  countryCode: 'CY',
  brokerName: 'Abbeygate',
  whiteLogoUrl: null,
  publicBaseUrl: 'https://abbeygate.cy',
  fromEmail: 'no-reply@abbeygate.cy',
});

describe('product standard-letter variants', () => {
  it('selects Home, Travel and Immigration Medical variants without changing another product', () => {
    expect(resolveTemplateForTrigger('QUOTE_SENT', { productCode: 'HOME' })).toBe('HOME_QUOTE_STANDARD');
    expect(resolveTemplateForTrigger('RENEWAL_INVITE', { productCode: 'HOME' })).toBe('HOME_RENEWAL_INVITE');
    expect(resolveTemplateForTrigger('NEW_BUSINESS_PLACED', { productCode: 'HOME', isRenewal: true }))
      .toBe('HOME_RENEWAL_CONFIRMATION');
    expect(resolveTemplateForTrigger('QUOTE_SENT', { productCode: 'TRAVEL' })).toBe('TRAVEL_QUOTE_STANDARD');
    expect(resolveTemplateForTrigger('RENEWAL_INVITE', { productCode: 'TRAVEL' })).toBe('TRAVEL_RENEWAL_INVITE');
    expect(resolveTemplateForTrigger('NEW_BUSINESS_PLACED', { productCode: 'TRAVEL', isRenewal: true }))
      .toBe('TRAVEL_RENEWAL_CONFIRMATION');
    expect(resolveTemplateForTrigger('QUOTE_SENT', { productCode: 'HEALTH' })).toBe('HEALTH_QUOTE_STANDARD');
    expect(resolveTemplateForTrigger('RENEWAL_INVITE', { productCode: 'HEALTH' })).toBe('HEALTH_RENEWAL_INVITE');
    expect(resolveTemplateForTrigger('NEW_BUSINESS_PLACED', { productCode: 'HEALTH', isRenewal: true }))
      .toBe('HEALTH_RENEWAL_CONFIRMATION');
    expect(resolveTemplateForTrigger('QUOTE_SENT', { productCode: 'MOTOR' })).toBe('QUOTE_STANDARD');
  });

  it('renders the Home contents notice with the tenant-owned country contacts', () => {
    const rendered = renderCustomerTemplate('HOME_HIGH_VALUE_CONTENTS_NOTICE', {
      customer: { firstName: 'Alex' },
      policy: { number: 'BZ/CY1000001' },
      home: { contentsSumInsured: 'EUR 75,000.00' },
    }, { brand: CY_BRAND });

    expect(rendered.missingVariables).toEqual([]);
    expect(rendered.bodyText).toContain('Any individual item worth more than €3,000 must be specified.');
    expect(rendered.bodyHtml).toContain('+357 26 819175');
    expect(rendered.bodyHtml).toContain('Mesogi Avenue');
  });

  it('renders the Travel quotation with the required disclosure and real quote values', () => {
    const rendered = renderCustomerTemplate('TRAVEL_QUOTE_STANDARD', {
      customer: { firstName: 'Alex' },
      quote: {
        reference: 'TR/CY1000001',
        premium: 'EUR 123.45',
        excess: 'EUR 75.00',
        url: 'https://cy.abbeygate.com/quote/travel-token?step=your-quote',
      },
      policy: { vehicleDescription: 'Annual multi-trip travel cover' },
    }, { brand: CY_BRAND });

    expect(rendered.missingVariables).toEqual([]);
    expect(rendered.bodyText).toContain('Insurance premium: EUR 123.45');
    expect(rendered.bodyText).toContain('Insurance Product Information Document (IPID)');
    expect(rendered.bodyHtml).toContain('+357 26 819175');
  });

  it('renders the Immigration Medical quotation with its required disclosure', () => {
    const rendered = renderCustomerTemplate('HEALTH_QUOTE_STANDARD', {
      customer: { firstName: 'Alex' },
      quote: {
        reference: 'IM/CY1000001',
        premium: 'EUR 456.78',
        excess: 'EUR 150.00',
        url: 'https://cy.abbeygate.com/quote/health-token?step=your-quote',
      },
      policy: { vehicleDescription: 'Immigration Medical Insurance' },
    }, { brand: CY_BRAND });

    expect(rendered.missingVariables).toEqual([]);
    expect(rendered.bodyText).toContain('Immigration Medical Insurance');
    expect(rendered.bodyText).toContain('Insurance Product Information Document (IPID)');
  });
});
