/**
 * Regression tests for Bug #1 — UW save was wiping nested sibling fields.
 *
 * Symptom: in the BO Underwriting tab, saving `trip.planType = 'single'`
 * also wiped `trip.destinations`, `trip.startDate`, `trip.endDate` from
 * the persisted quote, because the save handler used a shallow spread
 * (`{ ...prevQuoteData, ...updates }`) which atomically replaced the
 * entire nested `trip` object with only the fields that were dirty.
 *
 * Fix: route both client and server merges through `deepMergePlain`, which
 * recursively merges plain objects and replaces arrays/primitives wholesale.
 *
 * If anyone reverts the deep-merge to a shallow spread these tests fail.
 */
import { describe, expect, it } from 'vitest';
import { deepMergePlain, defaultCustomerQuoteStep } from '../uwHelpers.js';

describe('uwHelpers — deepMergePlain (Bug #1 regression)', () => {
  it('preserves nested sibling fields when patch only touches one leaf', () => {
    const prev = {
      trip: {
        planType: 'multi',
        destinations: ['Algeria', 'Andorra'],
        startDate: '2026-06-01',
        endDate: '2026-06-08',
      },
      proposer: { firstName: 'Uriel' },
    };
    const patch = {
      trip: { planType: 'single' },
    };

    const merged = deepMergePlain(prev, patch);

    expect(merged.trip).toEqual({
      planType: 'single',
      destinations: ['Algeria', 'Andorra'],
      startDate: '2026-06-01',
      endDate: '2026-06-08',
    });
    expect(merged.proposer).toEqual({ firstName: 'Uriel' });
  });

  it('replaces arrays atomically (never element-wise merges them)', () => {
    const prev = { trip: { destinations: ['Algeria', 'Andorra'] } };
    const patch = { trip: { destinations: ['Spain'] } };

    const merged = deepMergePlain(prev, patch);

    expect(merged.trip).toEqual({ destinations: ['Spain'] });
  });

  it('replaces primitives wholesale and does not coerce types', () => {
    const prev = { quote: { selectedPlan: 'silver', basePrice: 120 } };
    const patch = { quote: { selectedPlan: 'gold' } };

    const merged = deepMergePlain(prev, patch);

    expect(merged.quote).toEqual({ selectedPlan: 'gold', basePrice: 120 });
  });

  it('overwrites a nested object with a primitive (and vice versa)', () => {
    expect(
      deepMergePlain({ a: { b: 1 } }, { a: 'replaced' as unknown as Record<string, unknown> }),
    ).toEqual({ a: 'replaced' });
    expect(
      deepMergePlain(
        { a: 'old' as unknown as Record<string, unknown> },
        { a: { b: 1 } },
      ),
    ).toEqual({ a: { b: 1 } });
  });

  it('does not mutate the original `base` or `patch` references', () => {
    const prev = { trip: { planType: 'multi', destinations: ['A'] } };
    const patch = { trip: { planType: 'single' } };
    const prevSnapshot = JSON.parse(JSON.stringify(prev));
    const patchSnapshot = JSON.parse(JSON.stringify(patch));

    deepMergePlain(prev, patch);

    expect(prev).toEqual(prevSnapshot);
    expect(patch).toEqual(patchSnapshot);
  });

  it('handles three or more levels of nesting', () => {
    const prev = {
      proposer: {
        firstName: 'Uriel',
        address: { line1: '10 Downing St', city: 'London', country: 'United Kingdom' },
      },
    };
    const patch = {
      proposer: {
        address: { city: 'Manchester' },
      },
    };

    const merged = deepMergePlain(prev, patch);

    expect(merged.proposer).toEqual({
      firstName: 'Uriel',
      address: { line1: '10 Downing St', city: 'Manchester', country: 'United Kingdom' },
    });
  });
});

describe('uwHelpers — defaultCustomerQuoteStep (ABY-413)', () => {
  it('does not default Home (or other non-motor products) to vehicle-cover', () => {
    expect(defaultCustomerQuoteStep('HOME')).toBe('policy-holder');
    expect(defaultCustomerQuoteStep('MOTOR')).toBe('policy-holder');
    expect(defaultCustomerQuoteStep('TRAVEL')).toBe('eligibility');
    expect(defaultCustomerQuoteStep('HEALTH')).toBe('eligibility');
  });
});
