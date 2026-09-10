import { describe, expect, it } from 'vitest';
import { resolveHomePaymentEntryRedirect } from '../paymentEntryGuard';

describe('resolveHomePaymentEntryRedirect', () => {
  it('routes a canonical missing Home field to its owning information subsection', () => {
    expect(resolveHomePaymentEntryRedirect({
      missingFields: [{
        slug: 'property.landAreaSqm',
        label: 'Area of land (sqm)',
        customerHash: 'property',
      }],
    })).toEqual({
      stepId: 'property',
      fieldPath: 'property.landAreaSqm',
      label: 'Area of land (sqm)',
    });
  });

  it('reads the issued-pack blocker shape used by the payment endpoint', () => {
    expect(resolveHomePaymentEntryRedirect({
      blockers: [{
        code: 'DOCUMENT_FIELDS_MISSING',
        details: {
          missingForIssuedPack: [{
            slug: 'property.landAreaSqm',
            label: 'Area of land (sqm)',
            customerHash: 'property',
          }],
        },
      }],
    })?.stepId).toBe('property');
  });

  it('routes canonical use-of-property diagnostics to the rendered Sums insured step', () => {
    expect(resolveHomePaymentEntryRedirect({
      missingFields: [{
        slug: 'usage.permanentHome',
        label: 'Permanent Home',
        customerHash: 'use',
      }],
    })).toMatchObject({
      stepId: 'sums-insured',
      fieldPath: 'usage.permanentHome',
    });
  });

  it('does not invent a destination for an unowned or malformed blocker', () => {
    expect(resolveHomePaymentEntryRedirect({
      missingFields: [{ slug: 'unknown', customerHash: 'not-a-home-step' }],
    })).toBeNull();
  });
});
