import { describe, expect, it } from 'vitest';
import { renderCustomerTemplate } from '../customerTemplateRenderer.js';
import {
  getFallbackBrandProfile,
  renderEmailLayout,
  SYNTHETIC_TEST_SUBJECT_PREFIX,
} from '../emailBranding.js';

const VARS = {
  customer: { firstName: 'Ada' },
  quote: { url: 'https://app.example.test/quote/abc' },
};

describe('synthetic email rendering (Phase 1 safety rails)', () => {
  describe('renderCustomerTemplate synthetic flag', () => {
    it('prefixes the subject and injects the test banner when synthetic', () => {
      const out = renderCustomerTemplate('QUOTE_CHASER', VARS, { synthetic: true });
      expect(out.subject.startsWith(SYNTHETIC_TEST_SUBJECT_PREFIX)).toBe(true);
      expect(out.subject).toContain('Reminder: your insurance quote is waiting');
      expect(out.bodyHtml).toContain('SYNTHETIC TEST — NOT A REAL POLICY');
      // The real body content is still present under the banner.
      expect(out.bodyHtml).toContain('quote is still waiting');
    });

    it('is byte-clean for a real (non-synthetic) email — no prefix, no banner', () => {
      const out = renderCustomerTemplate('QUOTE_CHASER', VARS);
      expect(out.subject).toBe('Reminder: your insurance quote is waiting');
      expect(out.subject.includes('SYNTHETIC TEST')).toBe(false);
      expect(out.bodyHtml).not.toContain('SYNTHETIC TEST — NOT A REAL POLICY');
    });
  });

  describe('renderEmailLayout banner', () => {
    const brand = getFallbackBrandProfile();

    it('adds the banner only when synthetic is true', () => {
      const withBanner = renderEmailLayout({ bodyText: 'Hello', brand, synthetic: true });
      const withoutBanner = renderEmailLayout({ bodyText: 'Hello', brand });
      expect(withBanner).toContain('SYNTHETIC TEST — NOT A REAL POLICY');
      expect(withoutBanner).not.toContain('SYNTHETIC TEST — NOT A REAL POLICY');
    });
  });
});
