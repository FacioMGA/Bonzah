import { describe, expect, it } from 'vitest';
import { formatCheckoutError } from './PaymentStep';

describe('formatCheckoutError', () => {
  it('names the missing field and Home subsection from the canonical readiness blocker', () => {
    expect(formatCheckoutError({
      error: {
        details: {
          blocker: {
            details: {
              missingForIssuedPack: [{
                slug: 'property.landAreaSqm',
                label: 'Area of land (sqm)',
                customerHash: 'property',
              }],
            },
          },
        },
      },
    }, 'Failed to start payment')).toBe(
      'Please complete Area of land (sqm) in Property before proceeding to payment.',
    );
  });
});
