import { describe, expect, it } from 'vitest';
import {
  loadTravelFeeBands,
  resolveTravelAdminFee,
} from '../data/travel-fee-bands.loader.js';

/**
 * Sliding admin-fee bands per Andy 2026-05-16. Bands are defined
 * against NET premium and apply to Travel only.
 */

describe('loadTravelFeeBands', () => {
  it('loads, validates, and freezes the fee-bands JSON', () => {
    const data = loadTravelFeeBands();
    expect(data.appliesTo).toBe('net_premium');
    expect(data.bands).toHaveLength(3);
    expect(Object.isFrozen(data)).toBe(true);
    expect(Object.isFrozen(data.bands)).toBe(true);
  });
});

describe('resolveTravelAdminFee', () => {
  it.each([
    [0, 7, 'zero net'],
    [10, 7, 'small premium'],
    [69.99, 7, 'just under €70 boundary'],
    [70, 7, '€70 boundary — top of band 1'],
    [70.01, 18, 'just over €70 boundary — into band 2'],
    [71, 18, 'top of "71-200" band'],
    [150, 18, 'mid band 2'],
    [199.99, 18, 'just under €200 boundary'],
    [200, 18, '€200 boundary — top of band 2'],
    [200.01, 25, 'just over €200 boundary — into band 3'],
    [201, 25, 'top of "201+" tier'],
    [500, 25, 'high net'],
    [10_000, 25, 'very high net (open-ended tier)'],
  ])('resolves netPremium=%s → fee=€%s (%s)', (net, expected) => {
    expect(resolveTravelAdminFee(net)).toBe(expected);
  });

  it('clamps negative inputs to band 1 (lowest fee)', () => {
    // Negative inputs should never reach this layer — the calculator
    // enforces non-negative net upstream — but the resolver does not
    // throw on bad input; it falls back to the lowest band.
    expect(resolveTravelAdminFee(-100)).toBe(7);
  });

  it('handles non-finite inputs as zero net (fee = lowest band)', () => {
    expect(resolveTravelAdminFee(Number.NaN)).toBe(7);
    expect(resolveTravelAdminFee(Number.POSITIVE_INFINITY)).toBe(25);
  });
});
