import { describe, expect, it } from 'vitest';
import { buildUnderwritingAnalysis } from '../underwritingAnalysis.js';

describe('buildUnderwritingAnalysis', () => {
  it('keeps every fired underwriting trigger visible with explanations', () => {
    const analysis = buildUnderwritingAnalysis({
      uwDecision: {
        lane: 'yellow',
        outcome: 'referral',
        triggers: [
          { ruleId: 'YELLOW.CLAIMS_MULTIPLE', lane: 'yellow', message: 'Two or more claims in history.', fields: ['claimsCountLast5Years'] },
          { ruleId: 'YELLOW.MAJOR_CONVICTION', lane: 'yellow', message: 'Major conviction within last 5 years.', fields: ['hasMajorConvictionLast5Years'] },
          { ruleId: 'YELLOW.VEHICLE_VALUE_OVER_80K', lane: 'yellow', message: 'Vehicle value over EUR 80,000.', fields: ['vehicleValue'] },
        ],
      },
      quoteResponse: {
        primaryOption: {
          calculationTrace: {
            steps: [],
          },
        },
      },
    });

    expect(analysis.triggerCount).toBe(3);
    expect(analysis.triggers.map((trigger) => trigger.code)).toEqual([
      'YELLOW.CLAIMS_MULTIPLE',
      'YELLOW.MAJOR_CONVICTION',
      'YELLOW.VEHICLE_VALUE_OVER_80K',
    ]);
    expect(analysis.triggers.every((trigger) => trigger.explanation.length > 0)).toBe(true);
  });

  it('marks yellow-lane without rated loading as manual review', () => {
    const analysis = buildUnderwritingAnalysis({
      uwDecision: {
        lane: 'yellow',
        outcome: 'referral',
        triggers: [
          { ruleId: 'YELLOW.CLAIMS_MULTIPLE', lane: 'yellow', message: 'Two or more claims in history.', fields: ['claimsCountLast5Years'] },
        ],
      },
      quoteResponse: {
        primaryOption: {
          calculationTrace: {
            steps: [
              { id: 'comp.claims', name: 'Claims', kind: 'factor', factor: 1 },
            ],
          },
        },
      },
    });

    expect(analysis.pricingAdjustment.type).toBe('manual');
    expect(analysis.pricingAdjustment.valuePct).toBe(0);
    expect(analysis.pricingAdjustment.explanation).toBe('Manual review required — no automatic pricing adjustment applied.');
  });

  it('marks actual risk-factor loading as automatic with a non-zero percentage', () => {
    const analysis = buildUnderwritingAnalysis({
      uwDecision: {
        lane: 'yellow',
        outcome: 'referral',
        triggers: [
          { ruleId: 'YELLOW.CLAIMS_MULTIPLE', lane: 'yellow', message: 'Two or more claims in history.', fields: ['claimsCountLast5Years'] },
          { ruleId: 'YELLOW.MAJOR_CONVICTION', lane: 'yellow', message: 'Major conviction within last 5 years.', fields: ['hasMajorConvictionLast5Years'] },
        ],
      },
      quoteResponse: {
        primaryOption: {
          calculationTrace: {
            steps: [
              { id: 'comp.claims', name: 'Claims', kind: 'factor', factor: 1.25 },
              { id: 'comp.convictions', name: 'Convictions', kind: 'factor', factor: 1.1 },
            ],
          },
        },
      },
    });

    expect(analysis.pricingAdjustment.type).toBe('automatic');
    expect(analysis.pricingAdjustment.valuePct).toBeGreaterThan(0);
    expect(analysis.pricingAdjustment.sources).toEqual([
      'Claims history (+25%)',
      'Convictions (+10%)',
    ]);
  });
});
