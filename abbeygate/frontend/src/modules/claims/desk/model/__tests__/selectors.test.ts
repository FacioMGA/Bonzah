import { describe, expect, it } from 'vitest';
import type { Worksheet } from '../../../case/model/worksheetTypes';
import { DEVELOPMENT_TYPES } from '../../../case/model/worksheetTypes';
import {
  selectAuditIndicator,
  selectAwaitingFnolResponse,
  selectAvailableDevelopmentTypes,
  selectIntakeStatusPill,
  selectOperationalLifecycleState,
  selectVisibleTabs,
} from '../selectors';

const baseWorksheet: Worksheet = {
  claimId: 'c1',
  claimReference: 'CLM-1',
  policyId: 'p1',
  policyNumber: 'ABQ1001',
  topBar: {
    status: 'OPEN',
    phase: 'OPEN',
    referredToUw: 'N',
    denied: 'N',
  },
  summary: {
    financials: {
      totalPaid: 0,
      totalOutstanding: 0,
      totalIncurred: 0,
      totalRecovered: 0,
      netIncurred: 0,
      recoveriesExpected: 0,
      buckets: {},
    },
  },
  intake: {
    status: 'NONE',
    clarificationOpen: false,
    amendments: [],
    gates: [],
    requiredActions: [],
    fnol: {},
  },
  timeline: [],
  documents: [],
  comms: {
    entityType: 'CLAIM',
    entityId: 'c1',
    policyholder: { name: '', email: '', phone: '' },
  },
  complianceGaps: [],
};

describe('claims desk selectors', () => {
  it('marks awaiting FNOL response only when link sent and no intake data', () => {
    const awaiting = selectAwaitingFnolResponse(
      {
        ...baseWorksheet,
        timeline: [{ id: 'e1', eventType: 'FNOL_LINK_SENT', occurredAt: '2026-03-02T10:00:00Z' }],
      },
      false,
      false,
    );
    expect(awaiting).toBe(true);
  });

  it('hides exposure tab in case mode', () => {
    const tabs = selectVisibleTabs(true, false);
    expect(tabs.some((t) => t.id === 'exposure')).toBe(false);
  });

  it('returns intake incomplete pill for failing non-confirm gates', () => {
    const status = selectIntakeStatusPill(
      {
        ...baseWorksheet,
        intake: {
          ...baseWorksheet.intake!,
          status: 'FNOL_SUBMITTED',
          fnol: { incident: { description: 'x' } },
          gates: [{ key: 'incident.location', label: 'Location', status: 'FAIL' }],
        },
      },
      false,
      false,
    );
    expect(status).toBe('Intake incomplete');
  });

  it('returns audit flagged indicator when compliance gaps exist', () => {
    const indicator = selectAuditIndicator({
      ...baseWorksheet,
      complianceGaps: ['CR0116'],
    });
    expect(indicator.dotClass).toBe('bg-rose-500');
    expect(indicator.title).toContain('compliance gap');
  });

  it('shows closed-state actions only for CLOSED claims', () => {
    const actions = selectAvailableDevelopmentTypes({
      ...baseWorksheet,
      topBar: { ...baseWorksheet.topBar, status: 'CLOSED', denied: 'N' },
    }, false);
    expect(actions.map((a) => a.value)).toEqual(['REOPEN', 'ADD_CLAIM_NOTE', 'ADD_CLAIM_EVIDENCE']);
  });

  it('shows denied-state actions only for DENIED claims', () => {
    const actions = selectAvailableDevelopmentTypes({
      ...baseWorksheet,
      topBar: { ...baseWorksheet.topBar, status: 'DENIED', denied: 'Y' },
    }, false);
    expect(actions.map((a) => a.value)).toEqual(['ADD_CLAIM_NOTE', 'ADD_CLAIM_EVIDENCE']);
  });

  it('limits pending claims to note and evidence actions until FNOL is complete', () => {
    const actions = selectAvailableDevelopmentTypes({
      ...baseWorksheet,
      topBar: { ...baseWorksheet.topBar, status: 'PENDING', phase: 'INTAKE', denied: 'N' },
    }, false);
    expect(actions.map((a) => a.value)).toEqual(['ADD_CLAIM_NOTE', 'ADD_CLAIM_EVIDENCE']);
  });

  it('maps reopened status to under-review operational state', () => {
    const state = selectOperationalLifecycleState({
      ...baseWorksheet,
      topBar: { ...baseWorksheet.topBar, status: 'REOPENED', phase: 'SETTLEMENT', denied: 'N' },
    });
    expect(state).toBe('UNDER_REVIEW');
  });

  it('maps withdrawn status to closed operational state', () => {
    const state = selectOperationalLifecycleState({
      ...baseWorksheet,
      topBar: { ...baseWorksheet.topBar, status: 'WITHDRAWN', phase: 'CLOSED', denied: 'N' },
    });
    expect(state).toBe('CLOSED');
  });

  it('shows simplified status label in intake pill when intake is confirmed', () => {
    const status = selectIntakeStatusPill(
      {
        ...baseWorksheet,
        topBar: { ...baseWorksheet.topBar, status: 'REOPENED', phase: 'DECISION', denied: 'N', referredToUw: 'N' },
        summary: {
          ...baseWorksheet.summary,
          financials: { ...baseWorksheet.summary.financials, totalOutstanding: 0 },
        },
        intake: {
          ...baseWorksheet.intake!,
          status: 'FNOL_CONFIRMED',
        },
      },
      false,
      false,
    );
    expect(status).toBe('Under review');
  });

  it('uses imperative action labels in the activity selector vocabulary', () => {
    const byValue = Object.fromEntries(DEVELOPMENT_TYPES.map((item) => [item.value, item.label]));
    expect(byValue.SET_RESERVE).toBe('Set reserve');
    expect(byValue.ADJUST_RESERVE).toBe('Adjust reserve');
    expect(byValue.ADD_PAYMENT).toBe('Record payment');
    expect(byValue.SET_RECOVERY_EXPECTED).toBe('Record recovery expected');
    expect(byValue.ADD_RECOVERY_RECEIVED).toBe('Record recovery received');
    expect(byValue.ADD_CLAIM_EVIDENCE).toBe('Upload evidence');
  });
});

