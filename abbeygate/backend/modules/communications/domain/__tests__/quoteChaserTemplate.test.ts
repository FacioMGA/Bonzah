import { describe, expect, it } from 'vitest';
import { renderCustomerTemplate } from '../customerTemplateRenderer.js';
import { resolveTemplateForTrigger } from '../../app/customerEmailTriggerRegistry.js';

/**
 * QUOTE_FOLLOW_UP → QUOTE_CHASER contract.
 *
 * Before this template existed, QUOTE_FOLLOW_UP mapped to RENEWAL_CHASER,
 * whose schema requires `policy.number` + `renewal.url`. Neither producer
 * supplied both (`sendAutoQuoteInviteEmail` resend has no `policy.number`;
 * `operator.send_quote_reminder` has no `renewal.url`), so every quote
 * follow-up dispatch was silently skipped on missing required variables.
 * These tests pin the mapping AND that BOTH producers' variable shapes
 * render with zero missing variables.
 */

describe('QUOTE_FOLLOW_UP → QUOTE_CHASER', () => {
  it('maps the trigger to the dedicated quote chaser template', () => {
    expect(resolveTemplateForTrigger('QUOTE_FOLLOW_UP')).toBe('QUOTE_CHASER');
  });

  it('renders with the sendAutoQuoteInviteEmail (resend) variable shape', () => {
    const rendered = renderCustomerTemplate('QUOTE_CHASER', {
      customer: { firstName: 'Maria' },
      policy: { vehicleDescription: 'Maria Santos', registration: '-' },
      quote: {
        reference: 'ABQ5000123',
        premium: '€120.00',
        excess: '-',
        url: 'https://abbeygate-pt.facio.io/quote/tok123',
      },
      renewal: { url: 'https://abbeygate-pt.facio.io/quote/tok123', date: '' },
    });
    expect(rendered.missingVariables).toEqual([]);
    expect(rendered.bodyText).toContain('https://abbeygate-pt.facio.io/quote/tok123');
    expect(rendered.bodyText).toContain('Maria');
  });

  it('renders with the operator.send_quote_reminder variable shape', () => {
    const rendered = renderCustomerTemplate('QUOTE_CHASER', {
      customer: { firstName: 'Nikos' },
      quote: {
        url: 'https://abbeygate-gr.facio.io/quote/tok456?product=travel&step=your-quote',
        resumeUrl: 'https://abbeygate-gr.facio.io/quote/tok456?product=travel&step=your-quote',
        policyNumber: 'ABQ7000456',
      },
      policy: { number: 'ABQ7000456' },
    });
    expect(rendered.missingVariables).toEqual([]);
    expect(rendered.bodyText).toContain('tok456');
  });
});
