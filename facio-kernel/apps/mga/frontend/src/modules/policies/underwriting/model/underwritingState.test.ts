import { describe, expect, it } from 'vitest';
import {
  computeQuoteReadiness,
  buildUnderwritingReadinessSummary,
  deriveQuestionnaireStatusFromReadiness,
  deriveQuestionnaireAccess,
  deriveUnderwritingEditMode,
  deriveUnderwritingStage,
  normalizeUnderwritingDisplayState,
  shouldAutoRefreshUnderwritingQuestionnaire,
  shouldEnableFollowUps,
} from './underwritingState';

describe('underwritingState domain', () => {
  it('derives bind stage for issued lifecycle statuses', () => {
    expect(deriveUnderwritingStage('ISSUED')).toBe('bind');
  });

  it('derives endorsement draft mode when endorsement draft exists', () => {
    expect(
      deriveUnderwritingEditMode({
        isEndorsementMode: true,
        endorsementDraftRiskTransactionId: 'rt_1',
        isIssuedStage: false,
      })
    ).toBe('endorsementDraft');
  });

  it('computes quote readiness from required keys', () => {
    const readiness = computeQuoteReadiness({
      quoteData: { firstName: 'A', hasClaims: false },
      requiredKeys: ['firstName', 'lastName'],
    });
    expect(readiness.answered).toBe(1);
    expect(readiness.required).toBe(2);
  });

  it('builds compact readiness metrics from live questionnaire counts', () => {
    const summary = buildUnderwritingReadinessSummary({
      issueReadiness: {
        blockers: [{ code: 'A' }, { code: 'B' }, { code: 'C' }],
      },
      completed: 23,
      total: 28,
      riskFlagCount: 2,
    });

    expect(summary).toEqual({
      completed: 23,
      total: 28,
      readinessPct: 82,
      riskFlags: 2,
      blockingIssues: 3,
      missingForIssuedPack: [],
    });
  });

  it('does not infer questionnaire progress from issue-readiness metadata', () => {
    const summary = buildUnderwritingReadinessSummary({
      issueReadiness: { uwStateMeta: { isQuoteReady: true } },
      completed: 23,
      total: 28,
    });

    expect(summary.completed).toBe(23);
    expect(summary.total).toBe(28);
    expect(summary.readinessPct).toBe(82);
  });

  it('normalizes legacy complete state to quote ready', () => {
    expect(normalizeUnderwritingDisplayState({ uwStateRaw: 'COMPLETE', effectiveLastSavedBy: '' })).toBe('QUOTE_READY');
  });

  it('locks questionnaire ops in read only mode', () => {
    const access = deriveQuestionnaireAccess({
      editMode: 'readOnly',
      isEditing: false,
      isPolicyLocked: true,
      isEndorsementMode: false,
    });
    expect(access.lockQuestionnaireOps).toBe(true);
  });

  it('enables follow ups only for quote-ready yellow/red lanes', () => {
    expect(
      shouldEnableFollowUps({
        canEditQuestionnaire: true,
        underwritingState: 'QUOTE_READY',
        lane: 'yellow',
      })
    ).toBe(true);

    expect(
      shouldEnableFollowUps({
        canEditQuestionnaire: true,
        underwritingState: 'UW_STARTED',
        lane: 'yellow',
      })
    ).toBe(false);

    expect(
      shouldEnableFollowUps({
        canEditQuestionnaire: true,
        underwritingState: 'QUOTE_READY',
        lane: 'green',
      })
    ).toBe(false);
  });

  it('auto-refreshes pending customer questionnaires until readiness is complete', () => {
    expect(
      shouldAutoRefreshUnderwritingQuestionnaire({
        policyId: 'pol-1',
        qStatus: 'Sent',
        underwritingState: 'QUESTIONNAIRE_SENT',
        isEditing: false,
        hasUnsavedChanges: false,
      }),
    ).toBe(true);

    expect(
      shouldAutoRefreshUnderwritingQuestionnaire({
        policyId: 'pol-1',
        qStatus: 'Sent',
        underwritingState: 'QUOTE_READY',
        isEditing: false,
        hasUnsavedChanges: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoRefreshUnderwritingQuestionnaire({
        policyId: 'pol-1',
        qStatus: 'Sent',
        underwritingState: 'QUESTIONNAIRE_SENT',
        isEditing: true,
        hasUnsavedChanges: false,
      }),
    ).toBe(false);
  });

  it('derives questionnaire status from readiness refreshes', () => {
    expect(
      deriveQuestionnaireStatusFromReadiness({
        currentStatus: 'Sent',
        underwritingState: 'CUSTOMER_STARTED',
      }),
    ).toBe('In Process');

    expect(
      deriveQuestionnaireStatusFromReadiness({
        currentStatus: 'Sent',
        underwritingState: 'QUOTE_READY',
      }),
    ).toBe('Submitted');

    expect(
      deriveQuestionnaireStatusFromReadiness({
        currentStatus: 'Superseded',
        underwritingState: 'QUOTE_READY',
      }),
    ).toBeNull();
  });
});
