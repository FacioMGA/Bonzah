import { describe, expect, it } from 'vitest';
import { formatPaymentReadinessBlockerMessage } from './cardcorpPublicRouter.js';

describe('formatPaymentReadinessBlockerMessage', () => {
  it('identifies the first required detail and its customer section', () => {
    expect(formatPaymentReadinessBlockerMessage({
      details: {
        missingForIssuedPack: [{
          slug: 'property.landAreaSqm',
          label: 'Area of land (sqm)',
          customerHash: 'property',
        }],
      },
    })).toBe('Please complete Area of land (sqm) in Property before proceeding to payment.');
  });
});
