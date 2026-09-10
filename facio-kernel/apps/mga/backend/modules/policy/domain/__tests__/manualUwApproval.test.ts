import { describe, expect, it } from 'vitest';

import {
  buildManualUwApprovalAuthority,
  computeManualUwApprovedRiskHash,
  isManualUwApprovalCurrent,
} from '../manualUwApproval.js';

describe('manual UW approval risk scope', () => {
  const approvedQuoteData = {
    property: { woodenConstruction: true, alarm: 'Yes' },
    coverage: { contents: 50_000 },
    eligibility: { confirmation: false },
    policy: { startDate: '' },
    proposer: { nif: '' },
    mortgage: { hasMortgage: false, lenderName: '', lenderAddress: '', lenderReference: '' },
  };
  const customerCompletionPaths = [
    'eligibility.confirmation', 'policy.startDate', 'proposer.nif', 'mortgage.hasMortgage',
    'mortgage.lenderName', 'mortgage.lenderAddress', 'mortgage.lenderReference',
  ];
  const coverageSelection = { selected: { accidentalDamage: false } };
  const authority = {
    binderId: 'binder-home',
    programId: 'program-home',
    underwritingAuthority: { abbeygateMotorUwConfig: { referralThreshold: 2 } },
  };
  const underwritingDecision = {
    outcome: 'referral',
    triggers: [{ code: 'COMBUSTIBLE_CONSTRUCTION' }],
  };
  const approvedRiskHash = computeManualUwApprovedRiskHash({
    quoteData: approvedQuoteData,
    coverageSelection,
    authority,
    underwritingDecision,
    customerCompletionPaths,
  });

  it('remains current when the outstanding customer acceptance fields are completed', () => {
    expect(isManualUwApprovalCurrent({
      manualApproval: { approvedRiskHash, customerCompletionPaths },
      quoteData: {
        ...approvedQuoteData,
        eligibility: { confirmation: true },
        policy: { startDate: '2026-09-10' },
        proposer: { nif: 'PT123456789' },
        mortgage: { hasMortgage: true, lenderName: 'Bank', lenderAddress: '1 Main Street', lenderReference: 'ref-1' },
      },
      coverageSelection,
      authority,
      underwritingDecision,
    })).toBe(true);
  });

  it('expires when any reviewed risk value changes', () => {
    expect(isManualUwApprovalCurrent({
      manualApproval: { approvedRiskHash, customerCompletionPaths },
      quoteData: {
        ...approvedQuoteData,
        coverage: { contents: 75_000 },
      },
      coverageSelection,
      authority,
      underwritingDecision,
    })).toBe(false);
  });

  it('fails closed for approvals without an approved-risk hash', () => {
    expect(isManualUwApprovalCurrent({
      manualApproval: { customerCompletionPaths },
      quoteData: approvedQuoteData,
      coverageSelection,
      authority,
      underwritingDecision,
    })).toBe(false);
  });

  it('expires when the chosen cover or authority changes', () => {
    expect(isManualUwApprovalCurrent({
      manualApproval: { approvedRiskHash, customerCompletionPaths },
      quoteData: approvedQuoteData,
      coverageSelection: { selected: { accidentalDamage: true } },
      authority,
      underwritingDecision,
    })).toBe(false);
    expect(isManualUwApprovalCurrent({
      manualApproval: { approvedRiskHash, customerCompletionPaths },
      quoteData: approvedQuoteData,
      coverageSelection,
      authority: { binderId: 'binder-home-next', programId: 'program-home-next', underwritingAuthority: {} },
      underwritingDecision,
    })).toBe(false);
    expect(isManualUwApprovalCurrent({
      manualApproval: { approvedRiskHash, customerCompletionPaths },
      quoteData: approvedQuoteData,
      coverageSelection,
      authority: { ...authority, underwritingAuthority: { abbeygateMotorUwConfig: { referralThreshold: 3 } } },
      underwritingDecision,
    })).toBe(false);
  });

  it('does not expire when coverage operational metadata changes, but expires for a reviewed UW decision change', () => {
    expect(isManualUwApprovalCurrent({
      manualApproval: { approvedRiskHash, customerCompletionPaths },
      quoteData: approvedQuoteData,
      coverageSelection: {
        ...coverageSelection,
        source: 'CUSTOMER_SAVE',
        updatedAt: '2026-09-04T00:00:00.000Z',
      },
      authority,
      underwritingDecision,
    })).toBe(true);
    expect(isManualUwApprovalCurrent({
      manualApproval: { approvedRiskHash, customerCompletionPaths },
      quoteData: approvedQuoteData,
      coverageSelection,
      authority,
      underwritingDecision: { outcome: 'referral', triggers: [{ code: 'NEW_UW_RULE' }] },
    })).toBe(false);
  });

  it('fails closed when the adapter completion-only scope changes after approval', () => {
    expect(isManualUwApprovalCurrent({
      manualApproval: { approvedRiskHash, customerCompletionPaths },
      quoteData: approvedQuoteData,
      coverageSelection,
      authority,
      underwritingDecision,
      currentCustomerCompletionPaths: [...customerCompletionPaths, 'property.roofType'],
    })).toBe(false);
  });

  it('hashes the normalized MBE authority rather than operational stored metadata', () => {
    const normalizedMbeProductConfig = { schemaVersion: 1, programCode: 'abbeygate_home', base: [], options: [] };
    const initialAuthority = buildManualUwApprovalAuthority({
      binderId: 'binder-home',
      programId: 'program-home',
      programMetadata: { mbeProductConfig: { legacy: true } },
      normalizedMbeProductConfig,
    });
    const selfHealedAuthority = buildManualUwApprovalAuthority({
      binderId: 'binder-home',
      programId: 'program-home',
      programMetadata: { mbeProductConfig: { persistedAt: '2026-09-04T00:00:00.000Z' } },
      normalizedMbeProductConfig,
    });
    expect(selfHealedAuthority).toEqual(initialAuthority);
  });

  it('includes the effective binder-product authority in the approved risk scope', () => {
    const base = {
      id: 'authority-home', productCode: 'HOME', status: 'ACTIVE', classOfBusiness: 'PROPERTY',
      riskCode: 'HH', territorialScope: ['CY'], maxPremiumAnnual: '10000',
      maxPolicyPeriodDays: 365, maxAdvanceInceptionDays: 60, authorityClasses: ['BUILDINGS'],
      effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null,
    };
    const approvedAuthority = buildManualUwApprovalAuthority({
      binderId: 'binder-home', programId: 'program-home', normalizedMbeProductConfig: {}, binderProductAuthority: base,
    });
    const changedAuthority = buildManualUwApprovalAuthority({
      binderId: 'binder-home', programId: 'program-home', normalizedMbeProductConfig: {},
      binderProductAuthority: { ...base, maxPremiumAnnual: '5000' },
    });
    const hash = computeManualUwApprovedRiskHash({
      quoteData: approvedQuoteData, coverageSelection, authority: approvedAuthority, underwritingDecision, customerCompletionPaths,
    });
    expect(isManualUwApprovalCurrent({
      manualApproval: { approvedRiskHash: hash, customerCompletionPaths }, quoteData: approvedQuoteData,
      coverageSelection, authority: changedAuthority, underwritingDecision,
    })).toBe(false);
  });
});
