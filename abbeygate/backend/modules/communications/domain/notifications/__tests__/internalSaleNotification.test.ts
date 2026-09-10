import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispatchMock = vi.hoisted(() => vi.fn(async () => ({ messageId: 'msg-internal-sale' })));

vi.mock('../../../app/customerEmailTriggerService.js', () => ({
  dispatchCustomerEmailTrigger: dispatchMock,
}));

import { renderCustomerTemplate } from '../../customerTemplateRenderer.js';
import {
  CUSTOMER_EMAIL_TRIGGER_REGISTRY,
  resolveTemplateForTrigger,
} from '../../../app/customerEmailTriggerRegistry.js';
import { sendInternalSaleNotificationEmail } from '../unifiedEmailNotifications.js';

describe('INTERNAL_SALE_NOTIFICATION staff template (Phase 2)', () => {
  it('maps the trigger to its own template and marks it system-only', () => {
    expect(resolveTemplateForTrigger('INTERNAL_SALE_NOTIFICATION')).toBe('INTERNAL_SALE_NOTIFICATION');
    const entry = CUSTOMER_EMAIL_TRIGGER_REGISTRY.find((e) => e.trigger === 'INTERNAL_SALE_NOTIFICATION');
    expect(entry?.systemOnly).toBe(true);
  });

  it('renders a structured staff summary (not the customer welcome copy)', () => {
    const out = renderCustomerTemplate('INTERNAL_SALE_NOTIFICATION', {
      policy: { number: 'ABG-123' },
      sale: {
        purchaserName: 'Jane Doe',
        purchaserEmail: 'jane@example.test',
        productLabel: 'Travel',
        coverSummary: 'Single Trip to Spain',
        paymentReference: 'PAY-REF-9',
        source: 'ONLINE',
        correlationId: 'rt-77',
        adminUrl: 'https://bo.example.test/policies/abc',
      },
    });
    expect(out.systemOnly).toBe(true);
    expect(out.missingVariables).toEqual([]);
    expect(out.subject).toContain('New sale');
    expect(out.subject).toContain('Travel');
    expect(out.subject).toContain('ABG-123');
    expect(out.subject).toContain('Jane Doe');
    expect(out.bodyText).toContain('Payment reference: PAY-REF-9');
    expect(out.bodyText).toContain('Source: ONLINE');
    expect(out.bodyText).toContain('Correlation ID: rt-77');
    expect(out.bodyText).toContain('https://bo.example.test/policies/abc');
    expect(out.bodyHtml).toContain('href="https://bo.example.test/policies/abc"');
    expect(out.bodyHtml).toContain('>ABG-123</a>');
    // It must NOT read as the customer welcome ("Welcome" / "your policy is ready").
    expect(out.bodyText.toLowerCase()).not.toContain('welcome');
  });

  describe('sendInternalSaleNotificationEmail', () => {
    beforeEach(() => dispatchMock.mockClear());

    it('forces system-only and fills optional fields with n/a so dispatch is never skipped', async () => {
      const ok = await sendInternalSaleNotificationEmail({
        toEmail: 'sales@abbeygate.cy',
        purchaserName: 'Jane Doe',
        purchaserEmail: 'jane@example.test',
        productLabel: 'Travel',
        policyNumber: 'ABG-123',
        // paymentReference / source / correlationId / adminUrl intentionally omitted
        policyId: 'policy-1',
      });
      expect(ok).toBe(true);
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'INTERNAL_SALE_NOTIFICATION',
          forceSystemOnly: true,
          toEmail: 'sales@abbeygate.cy',
          variables: expect.objectContaining({
            sale: expect.objectContaining({
              purchaserName: 'Jane Doe',
              paymentReference: 'n/a',
              source: 'n/a',
              correlationId: 'n/a',
              adminUrl: 'n/a',
            }),
          }),
        }),
      );
    });
  });
});
