import { describe, expect, it } from 'vitest';
import type { BdxRowEvaluation } from '../../../reporting/app/bdxImport/types.js';
import { createBdxReplaySessionState, decideBdxReplayAction, markReplayRowApplied } from '../bdxReplayEngine.js';
import type { ExistingBdxPolicyCollisionAssessment } from '../bdxImportRecovery.js';

function evaluation(
  row: number,
  policyRef: string,
  result: BdxRowEvaluation['result'] = 'PASS',
  entry: string = 'NB'
): BdxRowEvaluation {
  return {
    dto: {
      sourceSheetName: 'Jul 25',
      sourceRowNumber: row,
      sourceId: `${policyRef}-${row}`,
      policyRef,
      rowKey: `Jul 25::${policyRef}::${row}`,
      policyChainKey: `${policyRef}::10`,
      entry,
      insured: 'Test User',
      endorsementRaw: '',
      bookedDate: `2025-07-${String((row % 28) + 1).padStart(2, '0')}`,
      inceptionDate: '2025-07-01',
      expiryDate: '2026-07-01',
      dateOfBirth: '1980-01-01',
      occupation: 'Tester',
      postcode: '1000',
      make: 'Mazda',
      model: '3',
      engineSize: 1600,
      ncbYears: 5,
      claimProtection: 'No',
      vehicleValue: 10000,
      vehicleYear: 2020,
      registration: 'ABC123',
      cover: 'Comp',
      excess: 250,
      drivers: 'Named Drivers Only',
      use: 'SDP',
      premiumPayable: 100,
      grossPremium: 90,
      mifPayable: 8,
      stampPayable: 2,
      commission: 10,
      payableToArb: 80,
      note: '',
      details: '',
      declared: {
        gross: 90,
        commission: 10,
        tax: 2,
        fees: 0,
        net: 80,
        total: 100,
      },
      parsedEndorsements: [],
    },
    result,
    calculated: null,
    deltas: null,
    gaps: [],
    policyImportDisposition: entry === 'RNL' ? 'IMPORT_RENEWAL' : row === 10 ? 'IMPORT_POLICY' : 'IMPORT_ENDORSEMENT',
  };
}

function assessment(overrides: Partial<ExistingBdxPolicyCollisionAssessment>): ExistingBdxPolicyCollisionAssessment {
  return {
    classification: 'no_existing_policy',
    policyId: null,
    reason: '',
    expectedBaseRowKey: null,
    expectedBaseSourceRowNumber: null,
    actualBaseRowKey: null,
    actualBaseSourceRowNumber: null,
    expectedReplayRowNumbers: [],
    existingReplayRowNumbers: [],
    missingReplayRowNumbers: [],
    ...overrides,
  };
}

describe('bdxReplayEngine', () => {
  it('creates a base policy for the earliest row when no policy exists', () => {
    const policyHistory = [evaluation(10, 'ABLV1'), evaluation(20, 'ABLV1')];
    const session = createBdxReplaySessionState(assessment({
      expectedBaseRowKey: policyHistory[0]!.dto.rowKey,
      expectedBaseSourceRowNumber: 10,
      expectedReplayRowNumbers: [20],
      missingReplayRowNumbers: [20],
    }));
    const decision = decideBdxReplayAction({
      evaluation: policyHistory[0]!,
      policyHistory,
      session,
      importedPolicyRowAlreadyExists: false,
      importedEndorsementRowAlreadyExists: false,
    });
    expect(decision.action).toBe('create_base');
  });

  it('defers a later row until the prior row is applied', () => {
    const policyHistory = [evaluation(10, 'ABLV2'), evaluation(20, 'ABLV2')];
    const session = createBdxReplaySessionState(assessment({
      expectedBaseRowKey: policyHistory[0]!.dto.rowKey,
      expectedBaseSourceRowNumber: 10,
      expectedReplayRowNumbers: [20],
      missingReplayRowNumbers: [20],
    }));
    const decision = decideBdxReplayAction({
      evaluation: policyHistory[1]!,
      policyHistory,
      session,
      importedPolicyRowAlreadyExists: false,
      importedEndorsementRowAlreadyExists: false,
    });
    expect(decision.action).toBe('defer_waiting_for_prior_row');
    expect(decision.waitingForRowNumber).toBe(10);
  });

  it('replays the next endorsement after the base row is applied', () => {
    const policyHistory = [evaluation(10, 'ABLV3'), evaluation(20, 'ABLV3')];
    const session = createBdxReplaySessionState(assessment({
      classification: 'missing_replay',
      policyId: 'policy-1',
      expectedBaseRowKey: policyHistory[0]!.dto.rowKey,
      expectedBaseSourceRowNumber: 10,
      actualBaseRowKey: policyHistory[0]!.dto.rowKey,
      actualBaseSourceRowNumber: 10,
      expectedReplayRowNumbers: [20],
      existingReplayRowNumbers: [],
      missingReplayRowNumbers: [20],
    }));
    const decision = decideBdxReplayAction({
      evaluation: policyHistory[1]!,
      policyHistory,
      session,
      importedPolicyRowAlreadyExists: false,
      importedEndorsementRowAlreadyExists: false,
    });
    expect(decision.action).toBe('replay_endorsement');
  });

  it('replays a renewal row as a renewal transaction', () => {
    const policyHistory = [evaluation(10, 'ABLV3A'), evaluation(20, 'ABLV3A', 'PASS', 'RNL')];
    const session = createBdxReplaySessionState(assessment({
      classification: 'missing_replay',
      policyId: 'policy-1',
      expectedBaseRowKey: policyHistory[0]!.dto.rowKey,
      expectedBaseSourceRowNumber: 10,
      actualBaseRowKey: policyHistory[0]!.dto.rowKey,
      actualBaseSourceRowNumber: 10,
      expectedReplayRowNumbers: [20],
      existingReplayRowNumbers: [],
      missingReplayRowNumbers: [20],
    }));
    const decision = decideBdxReplayAction({
      evaluation: policyHistory[1]!,
      policyHistory,
      session,
      importedPolicyRowAlreadyExists: false,
      importedEndorsementRowAlreadyExists: false,
    });
    expect(decision.action).toBe('replay_renewal');
  });

  it('blocks rows when an earlier row still fails validation', () => {
    const policyHistory = [evaluation(10, 'ABLV4', 'FAIL'), evaluation(20, 'ABLV4')];
    const session = createBdxReplaySessionState(assessment({
      expectedBaseRowKey: policyHistory[0]!.dto.rowKey,
      expectedBaseSourceRowNumber: 10,
      expectedReplayRowNumbers: [20],
      missingReplayRowNumbers: [20],
    }));
    const decision = decideBdxReplayAction({
      evaluation: policyHistory[1]!,
      policyHistory,
      session,
      importedPolicyRowAlreadyExists: false,
      importedEndorsementRowAlreadyExists: false,
    });
    expect(decision.action).toBe('blocked_prior_row_failed');
    expect(decision.waitingForRowNumber).toBe(10);
  });

  it('blocks rows when existing history is unsafe', () => {
    const policyHistory = [evaluation(10, 'ABLV5'), evaluation(20, 'ABLV5')];
    const session = createBdxReplaySessionState(assessment({
      classification: 'unsafe_to_touch',
      policyId: 'policy-unsafe',
      reason: 'Existing policy has no BDX base metadata.',
      expectedBaseRowKey: policyHistory[0]!.dto.rowKey,
      expectedBaseSourceRowNumber: 10,
      expectedReplayRowNumbers: [20],
      missingReplayRowNumbers: [20],
    }));
    const decision = decideBdxReplayAction({
      evaluation: policyHistory[0]!,
      policyHistory,
      session,
      importedPolicyRowAlreadyExists: false,
      importedEndorsementRowAlreadyExists: false,
    });
    expect(decision.action).toBe('blocked_existing_history');
    expect(decision.reason).toContain('no BDX base metadata');
  });

  // ADR-0056 regression: bordereau transaction lines (PAM premium adjustments,
  // CAN cancellations, …) were imported as standalone base policies when the
  // NB/RNL term row was missing from the held files — creating phantom
  // policies in production. A transaction line must never open a term.
  it('refuses to create a base policy from a transaction line', () => {
    for (const entry of ['PAM', 'ADJ', 'FIVA-PAM', 'CAN', 'NTU']) {
      const policyHistory = [evaluation(10, 'ABLV7', 'PASS', entry)];
      const session = createBdxReplaySessionState(assessment({}));
      const decision = decideBdxReplayAction({
        evaluation: policyHistory[0]!,
        policyHistory,
        session,
        importedPolicyRowAlreadyExists: false,
        importedEndorsementRowAlreadyExists: false,
      });
      expect(decision.action).toBe('blocked_transaction_row_without_base');
      expect(decision.reason).toContain('cannot create policies');
    }
  });

  it('still creates a base policy from an RNL row (historical migration entrypoint)', () => {
    const policyHistory = [evaluation(10, 'ABLV8', 'PASS', 'RNL')];
    const session = createBdxReplaySessionState(assessment({}));
    const decision = decideBdxReplayAction({
      evaluation: policyHistory[0]!,
      policyHistory,
      session,
      importedPolicyRowAlreadyExists: false,
      importedEndorsementRowAlreadyExists: false,
    });
    expect(decision.action).toBe('create_base');
  });

  it('advances session state after a successful base import', () => {
    const policyHistory = [evaluation(10, 'ABLV6'), evaluation(20, 'ABLV6')];
    const session = createBdxReplaySessionState(assessment({
      expectedBaseRowKey: policyHistory[0]!.dto.rowKey,
      expectedBaseSourceRowNumber: 10,
      expectedReplayRowNumbers: [20],
      missingReplayRowNumbers: [20],
    }));
    markReplayRowApplied(session, policyHistory[0]!, 'policy-6');
    const decision = decideBdxReplayAction({
      evaluation: policyHistory[1]!,
      policyHistory,
      session,
      importedPolicyRowAlreadyExists: false,
      importedEndorsementRowAlreadyExists: false,
    });
    expect(decision.action).toBe('replay_endorsement');
  });
});
