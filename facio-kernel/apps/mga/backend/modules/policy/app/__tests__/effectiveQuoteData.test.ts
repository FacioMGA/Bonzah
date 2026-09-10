import { describe, expect, it } from 'vitest';
import { resolveEffectiveQuoteData } from '../effectiveQuoteData.js';

describe('resolveEffectiveQuoteData', () => {
  it('prefers snapshot quoteData when present', () => {
    const result = resolveEffectiveQuoteData({
      snapshot: { quoteData: { from: 'snapshot', nested: { ok: true } } },
      policyQuoteData: { from: 'policy' },
    });

    expect(result).toEqual({ from: 'snapshot', nested: { ok: true } });
  });

  it('falls back to policy quoteData when snapshot has no quoteData key', () => {
    const result = resolveEffectiveQuoteData({
      snapshot: { somethingElse: true },
      policyQuoteData: { from: 'policy', nested: { ok: true } },
    });

    expect(result).toEqual({ from: 'policy', nested: { ok: true } });
  });

  it('preserves explicit empty snapshot quoteData instead of falling back', () => {
    const result = resolveEffectiveQuoteData({
      snapshot: { quoteData: {} },
      policyQuoteData: { from: 'policy' },
    });

    expect(result).toEqual({});
  });
});
