/* @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolicyLifecycleActions } from './usePolicyLifecycleActions';
import type { PolicyRecord } from '../model/policy';

const mocks = vi.hoisted(() => ({
  getIssueReadiness: vi.fn(),
  getPolicyBundle: vi.fn(),
  rateQuote: vi.fn(),
  saveQuoteHistory: vi.fn(),
  issuePolicy: vi.fn(),
  bindCoverage: vi.fn(),
  bindPolicy: vi.fn(),
  createEndorsementDraft: vi.fn(),
  rateEndorsementDraft: vi.fn(),
  sendQuote: vi.fn(),
  getPolicy: vi.fn(),
}));

vi.mock('../api/policiesClient', () => ({
  policiesClient: {
    sendQuote: mocks.sendQuote,
    getPolicy: mocks.getPolicy,
  },
}));

vi.mock('../api/policyCrudApiClient', () => ({
  policyCrudApiClient: {
    getIssueReadiness: mocks.getIssueReadiness,
    getPolicyBundle: mocks.getPolicyBundle,
    rateQuote: mocks.rateQuote,
    saveQuoteHistory: mocks.saveQuoteHistory,
  },
}));

vi.mock('../commands/issuePolicy', () => ({
  issuePolicy: mocks.issuePolicy,
  unlockBoundMode: vi.fn(),
}));

vi.mock('../commands/bindPolicy', () => ({
  bindCoverage: mocks.bindCoverage,
  bindPolicy: mocks.bindPolicy,
  generateDraftPolicyPack: vi.fn(),
}));

vi.mock('../commands/endorsement', () => ({
  bindEndorsementDraft: vi.fn(),
  cancelEndorsementDraft: vi.fn(),
  createEndorsementDraft: mocks.createEndorsementDraft,
  issueEndorsement: vi.fn(),
  rateEndorsementDraft: mocks.rateEndorsementDraft,
  saveEndorsementVersion: vi.fn(),
}));

vi.mock('../model/policyStateFlag', () => ({
  policyDisplayStatus: (value: Record<string, unknown>) => String(value?.status || ''),
}));

vi.mock('@/src/shared/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

describe('usePolicyLifecycleActions', () => {
  type LifecycleArgs = Parameters<typeof usePolicyLifecycleActions>[0];

  function buildArgs(overrides: Partial<LifecycleArgs> & { selectedPortfolio: PolicyRecord | null }): LifecycleArgs {
    const { selectedPortfolio, ...rest } = overrides;
    return {
      selectedPortfolio,
      endorsementDraftRiskTransactionId: null,
      viewingRiskTransactionSnapshot: null,
      refreshPolicyVersions: vi.fn(async () => undefined),
      refreshPolicyDocuments: vi.fn(async () => undefined),
      refreshIssueReadiness: vi.fn(async () => undefined),
      reloadCurrentPolicy: vi.fn(async () => undefined),
      loadPolicyDetails: async () => undefined,
      clearQuoteSentIndicator: vi.fn(),
      resolvePublicAutoSessionId: async () => 'session-1',
      setSelectedPortfolio: vi.fn(),
      setViewingVersionId: vi.fn(),
      setViewingRiskTransactionId: vi.fn(),
      setViewingRiskTransactionSnapshot: vi.fn(),
      setEditingScope: vi.fn(),
      setCoverageDirty: vi.fn(),
      setToastMessage: vi.fn(),
      setShowToast: vi.fn(),
      setQuoteSentAt: vi.fn(),
      setQuoteSentKey: vi.fn(),
      toPolicyRecord: (value: unknown) => value as PolicyRecord,
      navigate: vi.fn(),
      ...rest,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getIssueReadiness.mockResolvedValue({ success: true, data: { canIssue: true, blockers: [] } });
    mocks.getPolicyBundle.mockResolvedValue({
      success: true,
      data: {
        history: [{ id: 'rt-bound', transactionType: 'INCEPTION', status: 'BOUND' }],
      },
    });
    mocks.rateQuote.mockResolvedValue({
      success: true,
      data: { status: 'quoted', primaryOption: { annualPremium: 123 } },
    });
    mocks.issuePolicy.mockResolvedValue({
      success: true,
      data: { status: 'ACTIVE', riskTransactionId: 'rt-issued' },
    });
    mocks.bindCoverage.mockResolvedValue({ success: true, data: { riskTransactionId: 'rt-new-bound' } });
    mocks.bindPolicy.mockResolvedValue({ success: true, data: {} });
    mocks.createEndorsementDraft.mockResolvedValue({ success: true, data: { riskTransactionId: 'rt-endorsement-draft' } });
    mocks.rateEndorsementDraft.mockResolvedValue({ success: true, data: { status: 'quoted' } });
    mocks.saveQuoteHistory.mockResolvedValue({ success: true, data: { id: 'qh-1', version: 1 } });
    mocks.sendQuote.mockResolvedValue({ success: true, data: { status: 'queued' } });
    mocks.getPolicy.mockResolvedValue({ success: true, data: { id: 'pol-1', status: 'BOUND' } });
  });

  it('refreshes BO policy state after successful final issue', async () => {
    const refreshPolicyDocuments = vi.fn(async () => undefined);
    const refreshPolicyVersions = vi.fn(async () => undefined);
    const refreshIssueReadiness = vi.fn(async () => undefined);
    const reloadCurrentPolicy = vi.fn(async () => undefined);
    const setViewingRiskTransactionId = vi.fn();
    const setToastMessage = vi.fn();
    const setShowToast = vi.fn();

    const selectedPortfolio: PolicyRecord = { id: 'pol-1', status: 'BOUND' };
    const { result } = renderHook(() => usePolicyLifecycleActions(buildArgs({
      selectedPortfolio,
      refreshPolicyVersions,
      refreshPolicyDocuments,
      refreshIssueReadiness,
      reloadCurrentPolicy,
      setViewingRiskTransactionId,
      setToastMessage,
      setShowToast,
    })));

    await act(async () => {
      await result.current.handleIssuePolicyFinal();
    });

    expect(mocks.getIssueReadiness).toHaveBeenCalledWith('pol-1', { channel: 'bo' });
    expect(mocks.getPolicyBundle).toHaveBeenCalledWith('pol-1');
    expect(mocks.bindCoverage).not.toHaveBeenCalled();
    expect(mocks.issuePolicy).toHaveBeenCalledWith('pol-1');
    expect(refreshPolicyDocuments).toHaveBeenCalledWith('pol-1');
    expect(setViewingRiskTransactionId).toHaveBeenCalledWith('rt-issued');
    expect(reloadCurrentPolicy).toHaveBeenCalledWith({ riskTransactionId: 'rt-issued' });
    expect(refreshPolicyVersions).toHaveBeenCalledWith('pol-1');
    expect(refreshIssueReadiness).toHaveBeenCalledWith('pol-1');
    expect(setToastMessage).toHaveBeenCalledWith('Policy issued and documents sent.');
    expect(setShowToast).toHaveBeenCalledWith(true);
  });

  it('recalculates with the current coverage selection payload', async () => {
    const refreshIssueReadiness = vi.fn(async () => undefined);
    const setSelectedPortfolio = vi.fn();
    const selectedPortfolio: PolicyRecord = {
      id: 'pol-1',
      status: 'QUOTED',
      productType: 'MOTOR',
      quoteData: { requiredExcess: '250' },
      coverageSelection: {
        selected: { 'COV-ROADSIDE-VIP': true, 'CV 172': false },
        params: { 'COV-ROADSIDE-VIP': { target_vehicle_id: 'primary' } },
        source: 'BO_INIT',
      },
    };

    const { result } = renderHook(() => usePolicyLifecycleActions(buildArgs({
      selectedPortfolio,
      refreshIssueReadiness,
      setSelectedPortfolio,
    })));

    await act(async () => {
      await result.current.handleReRate();
    });

    expect(mocks.rateQuote).toHaveBeenCalledWith('MOTOR', 'session-1', {
      quoteData: { requiredExcess: '250' },
      coverageSelection: {
        selected: { 'COV-ROADSIDE-VIP': true, 'CV 172': false },
        params: { 'COV-ROADSIDE-VIP': { target_vehicle_id: 'primary' } },
        source: 'BO_INIT',
      },
    });
    expect(refreshIssueReadiness).toHaveBeenCalledWith('pol-1');
    expect(setSelectedPortfolio).toHaveBeenCalled();
  });

  it('waits for a pending Home assignment before rerating a Motor quote', async () => {
    const prepareRatingIdentity = vi.fn(async () => ({ productType: 'HOME' }));
    const selectedPortfolio: PolicyRecord = {
      id: 'pol-1',
      status: 'QUOTED',
      productType: 'MOTOR',
      quoteData: { rebuildingCost: 300000 },
    };
    const { result } = renderHook(() => usePolicyLifecycleActions(buildArgs({
      selectedPortfolio,
      prepareRatingIdentity,
    })));

    await act(async () => {
      await result.current.handleReRate();
    });

    expect(prepareRatingIdentity).toHaveBeenCalledTimes(1);
    expect(mocks.rateQuote).toHaveBeenCalledWith('HOME', 'session-1', {
      quoteData: { rebuildingCost: 300000 },
    });
    expect(prepareRatingIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rateQuote.mock.invocationCallOrder[0],
    );
  });

  it('opens an endorsement draft before recalculating an issued policy', async () => {
    const setViewingRiskTransactionId = vi.fn();
    const setViewingVersionId = vi.fn();
    const setViewingRiskTransactionSnapshot = vi.fn();
    const selectedPortfolio: PolicyRecord = {
      id: 'pol-issued',
      status: 'ISSUED',
      productType: 'MOTOR',
      quoteData: { vehicleValue: 10000 },
    };

    const { result } = renderHook(() => usePolicyLifecycleActions(buildArgs({
      selectedPortfolio,
      setViewingRiskTransactionId,
      setViewingVersionId,
      setViewingRiskTransactionSnapshot,
    })));

    await act(async () => {
      await result.current.handleReRate();
    });

    expect(mocks.createEndorsementDraft).toHaveBeenCalledWith('pol-issued', {
      effectiveDate: expect.any(String),
      reason: 'Premium recalculation',
    });
    expect(setViewingVersionId).toHaveBeenCalledWith(null);
    expect(setViewingRiskTransactionSnapshot).toHaveBeenCalledWith({
      riskTransactionId: 'rt-endorsement-draft',
      transactionType: 'ENDORSEMENT',
      status: 'DRAFT',
      snapshot: {},
    });
    expect(setViewingRiskTransactionId).toHaveBeenCalledWith('rt-endorsement-draft');
    expect(mocks.rateEndorsementDraft).toHaveBeenCalledWith('pol-issued', 'rt-endorsement-draft');
    expect(mocks.rateQuote).not.toHaveBeenCalled();
  });

  it('surfaces canonical issue-readiness blockers when final issue fails', async () => {
    const refreshIssueReadiness = vi.fn(async () => undefined);
    const setToastMessage = vi.fn();
    const setShowToast = vi.fn();
    mocks.issuePolicy.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Issue readiness check failed',
        blockers: [{ code: 'DOCUMENT_FIELDS_MISSING', message: 'Some required details are missing for the issued document pack.' }],
      },
    });

    const selectedPortfolio: PolicyRecord = { id: 'pol-1', status: 'BOUND' };
    const { result } = renderHook(() => usePolicyLifecycleActions(buildArgs({
      selectedPortfolio,
      refreshIssueReadiness,
      setToastMessage,
      setShowToast,
    })));

    await act(async () => {
      await result.current.handleIssuePolicyFinal();
    });

    expect(setToastMessage).toHaveBeenCalledWith('Some required details are missing for the issued document pack.');
    expect(refreshIssueReadiness).toHaveBeenCalledWith('pol-1');
    expect(setShowToast).toHaveBeenCalledWith(true);
  });

  // ABY-88: bind-policy failure used to surface only `error.message`
  // ("Unknown error") even when the backend returned a structured
  // `error.blockers` list. With `apiErrorMessage` plumbed in,
  // operators see the first blocker reason and the toast switches to
  // the error tone so the failure isn't mistaken for a confirmation.
  it('surfaces canonical bind-policy blockers and signals an error toast on failure', async () => {
    const refreshIssueReadiness = vi.fn(async () => undefined);
    const setToastMessage = vi.fn();
    const setToastType = vi.fn();
    const setShowToast = vi.fn();
    mocks.bindPolicy.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Policy is not ready to bind.',
        blockers: [
          { code: 'PRICING_DRIFT', message: 'The quote was edited after the last premium calculation. Recalculate premium so the displayed price matches the current risk details.' },
          { code: 'UW_INCOMPLETE', message: 'Underwriting is incomplete.' },
        ],
      },
    });

    const selectedPortfolio: PolicyRecord = { id: 'pol-1', status: 'QUOTED' };
    const { result } = renderHook(() => usePolicyLifecycleActions(buildArgs({
      selectedPortfolio,
      refreshIssueReadiness,
      setToastMessage,
      setToastType,
      setShowToast,
    })));

    await act(async () => {
      await result.current.handleBindPolicy();
    });

    expect(mocks.bindPolicy).toHaveBeenCalledWith('pol-1');
    expect(setToastMessage).toHaveBeenCalledWith(
      'Failed to bind policy: The quote was edited after the last premium calculation. Recalculate premium so the displayed price matches the current risk details.'
    );
    expect(setToastType).toHaveBeenCalledWith('error');
    expect(setShowToast).toHaveBeenCalledWith(true);
    // Readiness is refreshed on failure so the Premium tab's blockers
    // panel reflects the same reason the toast is showing.
    expect(refreshIssueReadiness).toHaveBeenCalledWith('pol-1');
  });

  // ABY-84 / ABY-87: send-quote failures used to surface with the
  // success styling. Now they switch the toast tone to error and
  // prefer the backend's actionable message.
  it('signals an error toast when send-quote returns MISSING_EMAIL', async () => {
    const setToastMessage = vi.fn();
    const setToastType = vi.fn();
    const setShowToast = vi.fn();
    mocks.sendQuote.mockResolvedValueOnce({
      success: false,
      error: {
        code: 'MISSING_EMAIL',
        message: 'Customer email is missing from quote data',
      },
    });

    const selectedPortfolio: PolicyRecord = { id: 'pol-1', status: 'QUOTED' };
    const { result } = renderHook(() => usePolicyLifecycleActions(buildArgs({
      selectedPortfolio,
      setToastMessage,
      setToastType,
      setShowToast,
    })));

    await act(async () => {
      await result.current.handleIssueQuote();
    });

    expect(mocks.sendQuote).toHaveBeenCalledWith('pol-1');
    expect(setToastMessage).toHaveBeenCalledWith('Failed to send quote: Customer email is missing from quote data');
    expect(setToastType).toHaveBeenCalledWith('error');
    expect(setShowToast).toHaveBeenCalledWith(true);
  });

  it('keeps the success tone for send-quote success', async () => {
    const setToastType = vi.fn();
    mocks.sendQuote.mockResolvedValueOnce({ success: true, data: { status: 'queued' } });

    const selectedPortfolio: PolicyRecord = { id: 'pol-1', status: 'QUOTED' };
    const { result } = renderHook(() => usePolicyLifecycleActions(buildArgs({
      selectedPortfolio,
      setToastType,
    })));

    await act(async () => {
      await result.current.handleIssueQuote();
    });

    expect(setToastType).toHaveBeenCalledWith('success');
  });

  it('surfaces save-version backend messages without replacing them with a generic toast', async () => {
    const setToastMessage = vi.fn();
    const setShowToast = vi.fn();
    mocks.saveQuoteHistory.mockResolvedValueOnce({
      success: false,
      error: { message: 'Quote version could not be saved for this tenant.' },
    });

    const selectedPortfolio: PolicyRecord = { id: 'pol-1', status: 'QUOTED' };
    const { result } = renderHook(() => usePolicyLifecycleActions(buildArgs({
      selectedPortfolio,
      setToastMessage,
      setShowToast,
    })));

    await act(async () => {
      await result.current.handleSaveQuoteVersion();
    });

    expect(mocks.saveQuoteHistory).toHaveBeenCalledWith('pol-1');
    expect(setToastMessage).toHaveBeenCalledWith('Quote version could not be saved for this tenant.');
    expect(setShowToast).toHaveBeenCalledWith(true);
  });
});
