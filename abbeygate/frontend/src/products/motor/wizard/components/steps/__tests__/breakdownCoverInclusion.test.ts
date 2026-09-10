import { describe, expect, it } from 'vitest';
import { isBreakdownCoverIncluded } from '../step4QuoteDomain';

// Approved production requirement (Peter, 2026-07-21): breakdown cover
// (COV-ROADSIDE) must be auto-included in comprehensive Motor/Van/Motorbike/
// Motor-Caravan cover and never sold as a standalone/separate purchase.
describe('isBreakdownCoverIncluded — breakdown cover is auto-included, never standalone', () => {
  it('is included automatically on comprehensive cover (no customer selection needed)', () => {
    expect(
      isBreakdownCoverIncluded({ isComprehensiveCover: true, vipRoadsideSelected: false, alreadyOnQuote: false }),
    ).toBe(true);
  });

  it('is included when the VIP roadside upgrade is chosen (VIP implies base breakdown)', () => {
    expect(
      isBreakdownCoverIncluded({ isComprehensiveCover: false, vipRoadsideSelected: true, alreadyOnQuote: false }),
    ).toBe(true);
  });

  it('stays included when the quote already carried it (no silent removal)', () => {
    expect(
      isBreakdownCoverIncluded({ isComprehensiveCover: false, vipRoadsideSelected: false, alreadyOnQuote: true }),
    ).toBe(true);
  });

  it('is not force-added to a bare third-party-liability quote that never had it', () => {
    expect(
      isBreakdownCoverIncluded({ isComprehensiveCover: false, vipRoadsideSelected: false, alreadyOnQuote: false }),
    ).toBe(false);
  });
});
