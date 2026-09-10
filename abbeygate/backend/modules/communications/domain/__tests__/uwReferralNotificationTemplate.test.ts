import { describe, expect, it } from 'vitest';
import { renderCustomerTemplate } from '../customerTemplateRenderer.js';
import { resolveTemplateForTrigger } from '../../app/customerEmailTriggerRegistry.js';

/**
 * UW_REFERRAL_RAISED → UW_REFERRAL_NOTIFICATION contract.
 *
 * The EMAIL.UW_REFERRAL worker previously dispatched through the
 * customer-facing UW_INFO_REQUEST template, whose schema requires a
 * `uw.url` secure-capture link. Referral producers have no such link, the
 * handler passed `uw.url: ''`, `validateVariables` treats '' as missing,
 * and `dispatchCustomerEmailTrigger` silently skipped — so no referral
 * notification ever reached the underwriting team, even when recipient
 * resolution succeeded. These tests pin the dedicated internal template
 * AND that the exact variable shape the handler passes renders with zero
 * missing variables.
 */

describe('UW_REFERRAL_RAISED → UW_REFERRAL_NOTIFICATION', () => {
  it('maps the trigger to the dedicated internal referral template', () => {
    expect(resolveTemplateForTrigger('UW_REFERRAL_RAISED')).toBe('UW_REFERRAL_NOTIFICATION');
  });

  it('renders with the exact variable shape the EMAIL.UW_REFERRAL handler passes', () => {
    const rendered = renderCustomerTemplate('UW_REFERRAL_NOTIFICATION', {
      policy: { number: 'DIRECT/BRIT/ABG/CY/Q/5000047' },
      uw: {
        adminUrl: 'https://cy.abbeygate.com/policies/policy-47#underwriting',
        message: 'Referral reasons:\n- AGE_REFERRAL: Traveller age 82 requires manual review',
      },
    });
    expect(rendered.missingVariables).toEqual([]);
    expect(rendered.subject).toContain('DIRECT/BRIT/ABG/CY/Q/5000047');
    expect(rendered.bodyText).toContain('AGE_REFERRAL');
    expect(rendered.bodyText).toContain('https://cy.abbeygate.com/policies/policy-47#underwriting');
    expect(rendered.bodyHtml).toContain(
      'href="https://cy.abbeygate.com/policies/policy-47#underwriting"',
    );
    expect(rendered.bodyHtml).toContain('>DIRECT/BRIT/ABG/CY/Q/5000047</a>');
    expect(rendered.bodyText).toContain('review the referral in the back office');
  });

  it('renders when reasons are absent (handler substitutes a placeholder line)', () => {
    const rendered = renderCustomerTemplate('UW_REFERRAL_NOTIFICATION', {
      policy: { number: 'ABQ/CY1000512' },
      uw: {
        adminUrl: 'https://cy.abbeygate.com/policies/policy-512#underwriting',
        message: 'Referral reasons:\n- No trigger fields captured',
      },
    });
    expect(rendered.missingVariables).toEqual([]);
  });

  it('is system-only so it can never be sent as a customer email', () => {
    const rendered = renderCustomerTemplate('UW_REFERRAL_NOTIFICATION', {
      policy: { number: 'X' },
      uw: { adminUrl: 'https://cy.abbeygate.com/policies/x#underwriting', message: 'Y' },
    });
    expect(rendered.systemOnly).toBe(true);
  });
});
