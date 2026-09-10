import { describe, expect, it } from 'vitest';
import { DIRECTION_WINDOW_SIZE, computeDirection } from '../computeDirection.js';

describe('computeDirection', () => {
  it('empty input is HEALTHY with score 0', () => {
    const r = computeDirection([]);
    expect(r.direction).toBe('HEALTHY');
    expect(r.driftScore).toBe(0);
    expect(r.reasonCode).toBe('NO_BEHAVIOR');
    expect(r.evidence).toEqual([]);
  });

  it('non-empty but no rule matches → HEALTHY with no evidence', () => {
    const r = computeDirection(['policy.bound', 'policy.issued']);
    expect(r.direction).toBe('HEALTHY');
    expect(r.driftScore).toBe(0);
    expect(r.reasonCode).toBe('NO_PATTERN_MATCHED');
  });

  describe('cancellation drift', () => {
    it('explicit cancelled behavior → DRIFT_TO_CANCELLATION with score 1', () => {
      const r = computeDirection(['policy.cancelled', 'policy.payment_failed']);
      expect(r.direction).toBe('DRIFT_TO_CANCELLATION');
      expect(r.reasonCode).toBe('CANCELLATION_OBSERVED');
      expect(r.driftScore).toBe(1);
      expect(r.evidence[0].behaviorType).toBe('policy.cancelled');
      expect(r.evidence[0].indexFromMostRecent).toBe(0);
    });

    it('cancellation_confirmed in window → CANCELLATION_OBSERVED', () => {
      const r = computeDirection([
        'policy.bound',
        'policy.comm_cancellation_confirmed',
        'policy.payment_failed',
      ]);
      expect(r.direction).toBe('DRIFT_TO_CANCELLATION');
      expect(r.reasonCode).toBe('CANCELLATION_OBSERVED');
    });

    it('two payment failures + info_required → PAYMENT_FAILURES_PLUS_FOLLOWUP', () => {
      const r = computeDirection([
        'policy.comm_info_required',
        'policy.payment_failed',
        'policy.payment_failed',
        'policy.bound',
      ]);
      expect(r.direction).toBe('DRIFT_TO_CANCELLATION');
      expect(r.reasonCode).toBe('PAYMENT_FAILURES_PLUS_FOLLOWUP');
      expect(r.driftScore).toBeGreaterThan(0.55);
      expect(r.driftScore).toBeLessThanOrEqual(1);
      const types = r.evidence.map((e) => e.behaviorType);
      expect(types).toContain('policy.payment_failed');
      expect(types).toContain('policy.comm_info_required');
    });

    it('three+ payment failures alone → REPEATED_PAYMENT_FAILURES', () => {
      const r = computeDirection([
        'policy.payment_failed',
        'policy.payment_failed',
        'policy.payment_failed',
        'policy.bound',
      ]);
      expect(r.direction).toBe('DRIFT_TO_CANCELLATION');
      expect(r.reasonCode).toBe('REPEATED_PAYMENT_FAILURES');
      expect(r.driftScore).toBeGreaterThan(0);
    });

    it('one payment failure does not trip the cancellation rule', () => {
      const r = computeDirection(['policy.payment_failed', 'policy.bound']);
      expect(r.direction).toBe('HEALTHY');
    });

    it('cancellation rule short-circuits a renewal pattern in the same window', () => {
      const r = computeDirection([
        'policy.cancelled',
        'policy.renewal_invited',
        'policy.payment_captured',
      ]);
      expect(r.direction).toBe('DRIFT_TO_CANCELLATION');
    });
  });

  describe('renewal drift', () => {
    it('renewal_invited + recent payment_captured → DRIFT_TO_RENEWAL', () => {
      const r = computeDirection([
        'policy.renewal_invited',
        'policy.payment_captured',
        'policy.bound',
      ]);
      expect(r.direction).toBe('DRIFT_TO_RENEWAL');
      expect(r.reasonCode).toBe('RENEWAL_WITH_POSITIVE_ENGAGEMENT');
      expect(r.driftScore).toBeGreaterThan(0.5);
    });

    it('renewal_invited alone (no positive engagement) stays HEALTHY', () => {
      const r = computeDirection(['policy.renewal_invited']);
      expect(r.direction).toBe('HEALTHY');
    });

    it('renewal_chased + recent issuance → DRIFT_TO_RENEWAL', () => {
      const r = computeDirection([
        'policy.renewal_chased',
        'policy.issued',
      ]);
      expect(r.direction).toBe('DRIFT_TO_RENEWAL');
    });
  });

  describe('fraud-flag drift', () => {
    it('large_loss_flagged → DRIFT_TO_FRAUD_FLAG', () => {
      const r = computeDirection(['claim.large_loss_flagged', 'policy.bound']);
      expect(r.direction).toBe('DRIFT_TO_FRAUD_FLAG');
      expect(r.reasonCode).toBe('LARGE_LOSS_FLAGGED');
      expect(r.driftScore).toBeGreaterThanOrEqual(0.7);
    });

    it('three reserve adjustments → DRIFT_TO_FRAUD_FLAG (reserve creep)', () => {
      const r = computeDirection([
        'claim.reserve_adj',
        'claim.reserve_adj',
        'claim.reserve_adj',
        'policy.bound',
      ]);
      expect(r.direction).toBe('DRIFT_TO_FRAUD_FLAG');
      expect(r.reasonCode).toBe('RESERVE_CREEP');
    });

    it('two reserve adjustments alone do not trip fraud drift', () => {
      const r = computeDirection(['claim.reserve_adj', 'claim.reserve_adj', 'policy.bound']);
      expect(r.direction).toBe('HEALTHY');
    });
  });

  describe('window discipline', () => {
    it(`only inspects the first ${DIRECTION_WINDOW_SIZE} entries`, () => {
      const noisePadding = new Array(DIRECTION_WINDOW_SIZE).fill('policy.bound');
      const oldFailures = ['policy.payment_failed', 'policy.payment_failed', 'policy.payment_failed'];
      const recent = [...noisePadding, ...oldFailures];
      const r = computeDirection(recent);
      expect(r.direction).toBe('HEALTHY');
    });

    it('recency boost: drift score is higher when the pattern is more recent', () => {
      const recent = computeDirection([
        'policy.payment_failed',
        'policy.payment_failed',
        'policy.payment_failed',
        'policy.bound',
      ]);
      const distant = computeDirection([
        'policy.bound',
        'policy.bound',
        'policy.bound',
        'policy.bound',
        'policy.bound',
        'policy.payment_failed',
        'policy.payment_failed',
        'policy.payment_failed',
      ]);
      expect(recent.driftScore).toBeGreaterThan(distant.driftScore);
    });

    it('driftScore is always within [0,1]', () => {
      const cases = [
        ['policy.cancelled'],
        ['policy.payment_failed', 'policy.payment_failed', 'policy.payment_failed', 'policy.payment_failed'],
        ['claim.large_loss_flagged'],
        ['policy.renewal_invited', 'policy.payment_captured'],
      ];
      for (const c of cases) {
        const r = computeDirection(c);
        expect(r.driftScore).toBeGreaterThanOrEqual(0);
        expect(r.driftScore).toBeLessThanOrEqual(1);
      }
    });
  });
});
