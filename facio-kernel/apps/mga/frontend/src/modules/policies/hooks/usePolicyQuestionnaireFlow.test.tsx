/* @vitest-environment happy-dom */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolicyQuestionnaireFlow } from './usePolicyQuestionnaireFlow';

const mocks = vi.hoisted(() => ({
  sendQuestionnaire: vi.fn(),
}));

vi.mock('../api/policiesClient', () => ({
  policiesClient: {
    sendQuestionnaire: mocks.sendQuestionnaire,
  },
}));

type QuestionnaireFlowArgs = Parameters<typeof usePolicyQuestionnaireFlow>[0];

function buildArgs(overrides: Partial<QuestionnaireFlowArgs> = {}): QuestionnaireFlowArgs {
  return {
    selectedPortfolio: { id: 'policy-1', productType: null },
    isSending: false,
    setIsSending: vi.fn(),
    questionnaireLastSentAt: null,
    setQuestionnaireLastSentAt: vi.fn(),
    setQStatus: vi.fn(),
    qStatus: 'Draft',
    getQuoteOrigin: vi.fn(() => 'bo' as const),
    loadPolicyDetails: vi.fn(async () => undefined),
    setToastMessage: vi.fn(),
    setShowToast: vi.fn(),
    selectedProgramId: 'program-motor',
    selectedBinderId: 'binder-motor',
    ensureProgramBinderAssigned: vi.fn(async () => true),
    ...overrides,
  };
}

describe('usePolicyQuestionnaireFlow (ABY-470)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.sendQuestionnaire.mockResolvedValue({
      success: true,
      data: { sentAt: '2026-08-25T10:00:00.000Z', recipient: 'client@example.com' },
    });
  });

  it('persists the selected program and binder before sending for a product-less draft', async () => {
    const args = buildArgs();
    const { result } = renderHook(() => usePolicyQuestionnaireFlow(args));

    await act(async () => result.current.handleSendQuestionnaire());

    expect(args.ensureProgramBinderAssigned).toHaveBeenCalledWith('policy-1', 'program-motor', 'binder-motor');
    expect(mocks.sendQuestionnaire).toHaveBeenCalledWith('policy-1', { kind: 'initial' });
    expect(vi.mocked(args.ensureProgramBinderAssigned).mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendQuestionnaire.mock.invocationCallOrder[0],
    );
  });

  it('does not send when the selected program and binder cannot be persisted', async () => {
    const args = buildArgs({ ensureProgramBinderAssigned: vi.fn(async () => false) });
    const { result } = renderHook(() => usePolicyQuestionnaireFlow(args));

    await act(async () => result.current.handleSendQuestionnaire());

    expect(mocks.sendQuestionnaire).not.toHaveBeenCalled();
    expect(args.ensureProgramBinderAssigned).toHaveBeenCalledOnce();
  });

  it('requires both selections before sending a product-less draft', async () => {
    const args = buildArgs({ selectedProgramId: '', selectedBinderId: '' });
    const { result } = renderHook(() => usePolicyQuestionnaireFlow(args));

    await act(async () => result.current.handleSendQuestionnaire());

    expect(args.ensureProgramBinderAssigned).not.toHaveBeenCalled();
    expect(mocks.sendQuestionnaire).not.toHaveBeenCalled();
    expect(args.setToastMessage).toHaveBeenCalledWith('Select a program and binder before sending the questionnaire.');
  });
});
