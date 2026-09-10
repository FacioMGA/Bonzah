import { describe, expect, it } from 'vitest';
import { renderCustomerTemplate } from '../customerTemplateRenderer.js';
import {
  CUSTOMER_TEMPLATE_DEFINITIONS,
  getCustomerTemplateDefinitionByKey,
} from '../customerTemplateCatalog.js';
import {
  buildPreviewBrand,
  buildPreviewVariables,
  normalizePreviewJurisdiction,
} from '../emailPreviewFixtures.js';
import {
  extractHtmlLinks,
  isBrokenEmailLink,
  lintRenderedEmail,
} from '../emailPreviewLint.js';

describe('email preview fixtures (Phase 4)', () => {
  it('normalises jurisdictions with a CY fallback', () => {
    expect(normalizePreviewJurisdiction('pt')).toBe('PT');
    expect(normalizePreviewJurisdiction('gr')).toBe('GR');
    expect(normalizePreviewJurisdiction('zz')).toBe('CY');
    expect(normalizePreviewJurisdiction(undefined)).toBe('CY');
  });

  it('generates a complete fixture for EVERY catalog template (no missing variables)', () => {
    const brand = buildPreviewBrand('CY');
    for (const def of CUSTOMER_TEMPLATE_DEFINITIONS) {
      const vars = buildPreviewVariables(def, 'CY');
      const rendered = renderCustomerTemplate(def.key, vars, { brand });
      expect(
        rendered.missingVariables,
        `template ${def.key} had missing variables: ${rendered.missingVariables.join(', ')}`,
      ).toEqual([]);
    }
  });

  it('fills fixtures with obviously-fake, safe sample values', () => {
    const def = getCustomerTemplateDefinitionByKey('QUOTE_STANDARD');
    const vars = buildPreviewVariables(def!, 'CY');
    const customer = vars.customer;
    if (typeof customer !== 'object' || customer === null) {
      throw new Error('expected customer fixture to be a nested object');
    }
    expect(customer.firstName).toBe('Alex');
  });
});

describe('email preview lint (Phase 4)', () => {
  it('extracts href and src links from html', () => {
    const links = extractHtmlLinks('<a href="https://x.test/a">a</a><img src="https://x.test/logo.png"/>');
    expect(links).toEqual(['https://x.test/a', 'https://x.test/logo.png']);
  });

  it('classifies broken vs valid email links', () => {
    expect(isBrokenEmailLink('https://abbeygate.cy/x')).toBe(false);
    expect(isBrokenEmailLink('mailto:x@y.z')).toBe(false);
    expect(isBrokenEmailLink('')).toBe(true);
    expect(isBrokenEmailLink('#')).toBe(true);
    expect(isBrokenEmailLink('/relative/path')).toBe(true);
    expect(isBrokenEmailLink('https://x.test/{{quote.url}}')).toBe(true);
  });

  it('flags unresolved variables, broken links, and a missing logo', () => {
    const findings = lintRenderedEmail({
      subject: 'Hi {{customer.firstName}}',
      bodyText: 'Click {{quote.url}}',
      bodyHtml: '<a href="/relative">go</a><img src=""/>',
      logoUrl: '',
    });
    const codes = findings.map((f) => f.code);
    expect(codes).toContain('UNRESOLVED_VARIABLES');
    expect(codes).toContain('BROKEN_LINKS');
    expect(codes).toContain('MISSING_LOGO');
  });

  it('passes a clean rendered email', () => {
    const findings = lintRenderedEmail({
      subject: 'Your quote',
      bodyText: 'Visit https://abbeygate.cy/quote/abc',
      bodyHtml: '<a href="https://abbeygate.cy/quote/abc">go</a><img src="https://abbeygate.cy/logo.png"/>',
      logoUrl: 'https://abbeygate.cy/logo.png',
    });
    expect(findings).toEqual([]);
  });
});
