import { describe, expect, it } from 'vitest';
import { sha256Hex, stableStringify } from '../../../domain/hashes.js';
import { computePricingIntegrityStamp } from '../../../domain/pricingIntegrityStamp.js';

/**
 * Pins the pricing integrity stamp contract used by every path that
 * finalizes rated state into `PolicyStateCurrent.snapshot`. Issue-
 * readiness blocks bind/issuance with `PRICING_HASH_MISMATCH`
 * ("Pricing integrity check is missing. Please re-rate to finalize
 * pricing.") whenever either hash field is absent — see
 * `backend/modules/policy/domain/issueReadiness.ts:524-541`.
 */

describe('computePricingIntegrityStamp', () => {
  const quoteData = { proposer: { firstName: 'Ada' }, coverage: { buildings: 250000 } };
  const quoteResponse = { status: 'QUOTED', primaryOption: { annualPremium: 200 } };

  it('emits the canonical snapshotHash + pricingHash + calculatedAt fields', () => {
    const stamp = computePricingIntegrityStamp({ quoteData, quoteResponse });
    expect(stamp.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stamp.pricingHash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof stamp.calculatedAt).toBe('string');
    expect(Number.isFinite(Date.parse(stamp.calculatedAt))).toBe(true);
  });

  it('matches the hash math previously inlined in Motor / RateEndorsementDraft / BDX', () => {
    const stamp = computePricingIntegrityStamp({
      quoteData,
      quoteResponse,
      overrideExcess: 300,
    });
    const expectedSnapshot = sha256Hex(stableStringify({ quoteData, quoteResponse }));
    const expectedPricing = sha256Hex(stableStringify({
      snapshotHash: expectedSnapshot,
      overrideExcess: 300,
      binderVersion: 'default',
    }));
    expect(stamp.snapshotHash).toBe(expectedSnapshot);
    expect(stamp.pricingHash).toBe(expectedPricing);
  });

  it('treats undefined and null overrideExcess as the same canonical value', () => {
    const a = computePricingIntegrityStamp({ quoteData, quoteResponse });
    const b = computePricingIntegrityStamp({ quoteData, quoteResponse, overrideExcess: null });
    expect(a.snapshotHash).toBe(b.snapshotHash);
    expect(a.pricingHash).toBe(b.pricingHash);
  });

  it('produces a different pricingHash when overrideExcess changes', () => {
    const noOverride = computePricingIntegrityStamp({ quoteData, quoteResponse });
    const withOverride = computePricingIntegrityStamp({ quoteData, quoteResponse, overrideExcess: 500 });
    expect(noOverride.snapshotHash).toBe(withOverride.snapshotHash);
    expect(noOverride.pricingHash).not.toBe(withOverride.pricingHash);
  });

  it('produces a different snapshotHash when quoteResponse changes', () => {
    const a = computePricingIntegrityStamp({ quoteData, quoteResponse });
    const b = computePricingIntegrityStamp({
      quoteData,
      quoteResponse: { ...quoteResponse, primaryOption: { annualPremium: 999 } },
    });
    expect(a.snapshotHash).not.toBe(b.snapshotHash);
    expect(a.pricingHash).not.toBe(b.pricingHash);
  });

  it('hashes the JSON-persisted representation used by issue-readiness', () => {
    const prePersistence = {
      quoteData: { proposer: { firstName: 'Ada', middleName: undefined }, additionalDrivers: [undefined] },
      quoteResponse: { status: 'QUOTED', warnings: [undefined], primaryOption: { annualPremium: 200, referralMessage: undefined } },
    };
    const persisted = JSON.parse(JSON.stringify(prePersistence));

    const stamp = computePricingIntegrityStamp(prePersistence);
    const persistedStamp = computePricingIntegrityStamp(persisted);
    const expectedSnapshot = sha256Hex(stableStringify(persisted));

    expect(stamp.snapshotHash).toBe(expectedSnapshot);
    expect(stamp.snapshotHash).toBe(persistedStamp.snapshotHash);
    expect(stamp.pricingHash).toBe(persistedStamp.pricingHash);
  });

  it('honors a non-default binderVersion when supplied', () => {
    const def = computePricingIntegrityStamp({ quoteData, quoteResponse });
    const custom = computePricingIntegrityStamp({ quoteData, quoteResponse, binderVersion: 'binder-v2' });
    expect(def.snapshotHash).toBe(custom.snapshotHash);
    expect(def.pricingHash).not.toBe(custom.pricingHash);
  });
});
