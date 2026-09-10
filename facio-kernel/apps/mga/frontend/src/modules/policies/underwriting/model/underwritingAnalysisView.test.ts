import { describe, expect, it } from 'vitest';
import {
  buildUnderwritingPricingDetails,
  formatUnderwritingDecisionHeadline,
  formatUnderwritingPricingLabel,
  formatUnderwritingPricingHeadline,
  normalizeUnderwritingAnalysis,
} from './underwritingAnalysisView';

describe('underwritingAnalysisView', () => {
  it('keeps the full trigger list and count from the backend payload', () => {
    const analysis = normalizeUnderwritingAnalysis({
      lane: 'yellow',
      outcome: 'referral',
      triggerCount: 3,
      triggers: [
        { code: 'YELLOW.CLAIMS_MULTIPLE', message: 'Two or more claims in history.', lane: 'yellow', severity: 'medium', fields: ['claimsCountLast5Years'], explanation: 'Claims history requires manual review.' },
        { code: 'YELLOW.MAJOR_CONVICTION', message: 'Major conviction within last 5 years.', lane: 'yellow', severity: 'high', fields: ['hasMajorConvictionLast5Years'], explanation: 'Major convictions always require review.' },
        { code: 'YELLOW.VEHICLE_VALUE_OVER_80K', message: 'Vehicle value over EUR 80,000.', lane: 'yellow', severity: 'medium', fields: ['vehicleValue'], explanation: 'High-value vehicles require manual review.' },
      ],
      pricingAdjustment: {
        type: 'manual',
        valuePct: 0,
        explanation: 'Manual review required — no automatic pricing adjustment applied.',
        sources: ['Two or more claims in history.', 'Major conviction within last 5 years.'],
      },
    });

    expect(analysis?.triggerCount).toBe(3);
    expect(analysis?.triggers.map((trigger) => trigger.code)).toEqual([
      'YELLOW.CLAIMS_MULTIPLE',
      'YELLOW.MAJOR_CONVICTION',
      'YELLOW.VEHICLE_VALUE_OVER_80K',
    ]);
  });

  it('renders manual review text instead of a fake neutral pricing fallback', () => {
    const analysis = normalizeUnderwritingAnalysis({
      lane: 'yellow',
      outcome: 'referral',
      triggers: [{ code: 'YELLOW.CLAIMS_MULTIPLE', message: 'Two or more claims in history.', lane: 'yellow', severity: 'medium', fields: ['claimsCountLast5Years'], explanation: 'Claims history requires manual review.' }],
      pricingAdjustment: {
        type: 'manual',
        valuePct: 0,
        explanation: 'Manual review required — no automatic pricing adjustment applied.',
        sources: ['Two or more claims in history.'],
      },
    });

    expect(analysis).not.toBeNull();
    expect(formatUnderwritingPricingHeadline(analysis!)).toBe('Manual review required — no automatic pricing adjustment applied.');
  });

  it('formats automatic loading and discount headlines from the authoritative payload', () => {
    const loading = normalizeUnderwritingAnalysis({
      lane: 'yellow',
      outcome: 'referral',
      triggers: [],
      pricingAdjustment: { type: 'automatic', valuePct: 25, explanation: 'Automatic pricing loading applied.', sources: ['Claims history (+25%)'] },
    });
    const discount = normalizeUnderwritingAnalysis({
      lane: 'green',
      outcome: 'accept',
      triggers: [],
      pricingAdjustment: { type: 'automatic', valuePct: -10, explanation: 'Automatic pricing discount applied.', sources: ['Claims history (-10%)'] },
    });

    expect(formatUnderwritingPricingHeadline(loading!)).toBe('Automatic load +25%');
    expect(formatUnderwritingPricingHeadline(discount!)).toBe('Automatic discount -10%');
  });

  it('builds a decision-first headline and compact pricing label', () => {
    const analysis = normalizeUnderwritingAnalysis({
      lane: 'yellow',
      outcome: 'referral',
      triggers: [
        {
          code: 'YELLOW.STP_LICENCE_YEARS_NOT_MET',
          message: 'Full licence must be held >2 years for STP.',
          lane: 'yellow',
          severity: 'medium',
          fields: ['licenseYears'],
          explanation: 'This risk falls outside the straight-through licence-history threshold.',
        },
      ],
      pricingAdjustment: {
        type: 'manual',
        valuePct: 0,
        explanation: 'Manual review required — no automatic pricing adjustment applied.',
        sources: ['Full licence must be held >2 years for STP.'],
      },
    });

    expect(formatUnderwritingDecisionHeadline(analysis!)).toBe('Referral required — licence history below threshold');
    expect(formatUnderwritingPricingLabel(analysis!)).toBe('Pricing: Manual');
    expect(buildUnderwritingPricingDetails(analysis!)).toEqual([
      'Manual review required.',
      'No automatic adjustment applied.',
      'Full licence must be held >2 years for STP.',
    ]);
  });
});
