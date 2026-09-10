/* @vitest-environment happy-dom */
/**
 * Motor wizard controller — spine coverage beyond ABY-236/237.
 *
 * Pins three branches the ABY-236/237 suite does not exercise:
 *   - validateCurrentStep error scroll + summary focus behaviour
 *   - saveDraft 423 (locked) -> unlock -> retry recovery loop
 *   - forkAndRateToNewSession 429 throttle alert (5-variants cap)
 *
 * Deeper coverage lives in:
 *   - useQuoteWizardController.aby236-237.test.ts (issue-details path)
 *   - wizardStepValidationLifecycle.test.tsx (per-step validation)
 */
import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useQuoteWizardController } from './useQuoteWizardController';
import type { QuoteData, QuoteResponse } from './types';
import { initialQuoteData } from './quoteWizard.constants';
import '@/src/products/motor/register';

vi.mock('./quoteWizard.api', () => ({
  MOTOR_PUBLIC_PRODUCT_CODE: 'motor',
  patchPublicSessionQuoteData: vi.fn(),
  forkPublicSession: vi.fn(),
  getPublicSessionSummary: vi.fn(),
  rateQuote: vi.fn(),
  requestPublicQuoteCallback: vi.fn(),
  unlockPublicSession: vi.fn(),
}));

vi.mock('@/src/shared/lib/wizard/issueReadinessClient', () => ({
  fetchIssueReadinessRaw: vi.fn(),
}));

vi.mock('@/src/shared/lib/wizard/quote/QuoteLoadingGate', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/src/shared/lib/wizard/quote/QuoteLoadingGate',
  );
  return { ...actual, QUOTE_LOADER_MIN_DELAY_MS: 0 };
});

import * as api from './quoteWizard.api';

const mockedApi = vi.mocked(api);

function renderController(currentStep: number, currentStepId: string) {
  const dispatchEngine = vi.fn();
  const setQuoteResponse = vi.fn();
  const scrollToTop = vi.fn();
  const scrollToField = vi.fn(() => true);
  return {
    dispatchEngine,
    setQuoteResponse,
    scrollToTop,
    scrollToField,
    harness: renderHook(() => {
      const form = useForm<QuoteData>({ defaultValues: initialQuoteData });
      const controller = useQuoteWizardController({
        policyId: 'tok_motor',
        currentStep,
        currentStepId,
        dispatchEngine,
        form,
        data: form.getValues(),
        quoteResponse: null,
        normalizeQuoteResponse: (raw: unknown) => raw as QuoteResponse | null,
        quoteBaselineSnapshot: '',
        setQuoteBaselineSnapshot: vi.fn(),
        scrollToTop,
        scrollToField,
        errorSummaryEl: null,
        setQuoteResponse,
      });
      return controller;
    }),
  };
}

type AlertFn = (message?: string) => void;

describe('useQuoteWizardController — spine (non-ABY-236/237)', () => {
  let originalAlert: typeof window.alert;
  let alertMock: ReturnType<typeof vi.fn<AlertFn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalAlert = window.alert;
    alertMock = vi.fn<AlertFn>();
    window.alert = alertMock;
  });

  afterEach(() => {
    window.alert = originalAlert;
  });

  describe('saveDraft — 423 locked recovery', () => {
    it('unlocks the session then retries the patch when the first save returns 423', async () => {
      mockedApi.patchPublicSessionQuoteData
        .mockResolvedValueOnce({ ok: false, status: 423, json: { success: false } })
        .mockResolvedValueOnce({ ok: true, status: 200, json: { success: true } });
      mockedApi.unlockPublicSession.mockResolvedValueOnce({ ok: true, status: 200, json: { success: true } });

      const { harness } = renderController(1, 'policy-holder');
      let result: { ok: boolean; status: number } = { ok: false, status: 0 };
      await act(async () => {
        result = await harness.result.current.actions.saveDraft();
      });

      expect(mockedApi.patchPublicSessionQuoteData).toHaveBeenCalledTimes(2);
      expect(mockedApi.unlockPublicSession).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
    });

    it('reports the 423 status to the caller when the unlock fails (no silent swallow)', async () => {
      mockedApi.patchPublicSessionQuoteData.mockResolvedValueOnce({ ok: false, status: 423, json: { success: false } });
      mockedApi.unlockPublicSession.mockResolvedValueOnce({ ok: false, status: 500, json: { success: false } });

      const { harness } = renderController(1, 'policy-holder');
      let result: { ok: boolean; status: number } = { ok: true, status: 200 };
      await act(async () => {
        result = await harness.result.current.actions.saveDraft();
      });

      expect(mockedApi.patchPublicSessionQuoteData).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(423);
    });
  });

  describe('forkAndRateToNewSession — 429 throttle', () => {
    it('surfaces the 5-variants-per-24h throttle alert when the fork is rate-limited', async () => {
      mockedApi.patchPublicSessionQuoteData.mockResolvedValue({ ok: true, status: 200, json: { success: true } });
      mockedApi.forkPublicSession.mockResolvedValueOnce({ ok: false, status: 429, json: { success: false } });

      const { harness } = renderController(4, 'your-quote');
      let ok = true;
      await act(async () => {
        ok = await harness.result.current.actions.forkAndRateToNewSession();
      });

      expect(ok).toBe(false);
      expect(alertMock).toHaveBeenCalledTimes(1);
      expect(String(alertMock.mock.calls[0]?.[0] ?? '')).toMatch(/5 in 24 hours/i);
    });

    it('returns false without prompting when the saveDraft itself fails (no spurious fork)', async () => {
      mockedApi.patchPublicSessionQuoteData.mockResolvedValueOnce({ ok: false, status: 500, json: { success: false } });

      const { harness } = renderController(4, 'your-quote');
      let ok = true;
      await act(async () => {
        ok = await harness.result.current.actions.forkAndRateToNewSession();
      });

      expect(ok).toBe(false);
      expect(mockedApi.forkPublicSession).not.toHaveBeenCalled();
      expect(alertMock).not.toHaveBeenCalled();
    });
  });
});
