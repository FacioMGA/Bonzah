/* @vitest-environment happy-dom */
/**
 * Regression suite for ABY-344 — motor "Confirm & Pay" dead-end.
 *
 * A motor quote that is missing issued-pack fields (e.g. an additional
 * driver, or registration/VIN) must never sit on the payment step: the
 * backend `/checkout` hard-blocks with `ISSUE_READINESS_BLOCKED` (422),
 * which surfaced to customers as the unrecoverable "small hiccup".
 *
 * The linear `your-quote` gate already routes a not-ready quote to
 * `issue-details`, but the payment step is also reachable via `NAV.GOTO`
 * (a `?step=payment` deep link / resume link / refresh), bypassing that
 * gate, and the gate itself fails open if the readiness probe errors.
 * `guardPaymentEntry` re-runs the canonical issue-readiness gate on
 * payment entry and bounces back to `issue-details` when it is not clear.
 *
 * These tests pin that behaviour and the deliberate fail-open: a flaky
 * probe must NOT trap an otherwise-ready customer away from payment.
 */
import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useQuoteWizardController } from './useQuoteWizardController';
import type { QuoteData, QuoteResponse } from './types';
import { initialQuoteData } from './quoteWizard.constants';

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

import * as issueReadinessClient from '@/src/shared/lib/wizard/issueReadinessClient';

const mockedReadiness = vi.mocked(issueReadinessClient);

const GOTO_ISSUE_DETAILS = { type: 'NAV.GOTO', stepId: 'issue-details' };

function renderController() {
  const dispatchEngine = vi.fn();
  const hook = renderHook(() => {
    const form = useForm<QuoteData>({ defaultValues: initialQuoteData });
    const controller = useQuoteWizardController({
      policyId: 'test-session-token',
      currentStep: 6,
      currentStepId: 'payment',
      dispatchEngine,
      form,
      data: form.getValues(),
      quoteResponse: null,
      normalizeQuoteResponse: (raw: unknown) => raw as QuoteResponse | null,
      quoteBaselineSnapshot: '',
      setQuoteBaselineSnapshot: vi.fn(),
      scrollToTop: vi.fn(),
      scrollToField: vi.fn(() => true),
      errorSummaryEl: null,
      setQuoteResponse: vi.fn(),
    });
    return { controller };
  });
  return { hook, dispatchEngine };
}

describe('useQuoteWizardController — guardPaymentEntry (ABY-344)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects to issue-details when a required issued field is missing', async () => {
    mockedReadiness.fetchIssueReadinessRaw.mockResolvedValue({
      ok: true,
      status: 200,
      json: { success: true, data: { missingFields: [{ slug: 'additionalDrivers', label: 'Additional driver details' }] } },
    });
    const { hook, dispatchEngine } = renderController();

    let cleared: boolean | undefined;
    await act(async () => {
      cleared = await hook.result.current.controller.actions.guardPaymentEntry();
    });

    expect(cleared).toBe(false);
    expect(dispatchEngine).toHaveBeenCalledWith(GOTO_ISSUE_DETAILS);
  });

  it('redirects to issue-details when an unmet conditional requirement remains', async () => {
    mockedReadiness.fetchIssueReadinessRaw.mockResolvedValue({
      ok: true,
      status: 200,
      json: {
        success: true,
        data: {
          conditionalRequirements: [
            { code: 'ADDITIONAL_DRIVERS_REQUIRED', message: 'Please add at least one additional driver before continuing.', severity: 'BLOCK' },
          ],
        },
      },
    });
    const { hook, dispatchEngine } = renderController();

    let cleared: boolean | undefined;
    await act(async () => {
      cleared = await hook.result.current.controller.actions.guardPaymentEntry();
    });

    expect(cleared).toBe(false);
    expect(dispatchEngine).toHaveBeenCalledWith(GOTO_ISSUE_DETAILS);
  });

  it('stays on payment when issue-readiness is clear', async () => {
    mockedReadiness.fetchIssueReadinessRaw.mockResolvedValue({
      ok: true,
      status: 200,
      json: { success: true, data: { missingFields: [], conditionalRequirements: [], blockers: [] } },
    });
    const { hook, dispatchEngine } = renderController();

    let cleared: boolean | undefined;
    await act(async () => {
      cleared = await hook.result.current.controller.actions.guardPaymentEntry();
    });

    expect(cleared).toBe(true);
    expect(dispatchEngine).not.toHaveBeenCalledWith(GOTO_ISSUE_DETAILS);
  });

  it('fails open (does NOT trap the customer off payment) when the readiness probe errors', async () => {
    // e.g. a 429 under rapid retries — bouncing a ready customer off
    // payment on a transient would be worse than letting the backend
    // /checkout re-validate.
    mockedReadiness.fetchIssueReadinessRaw.mockResolvedValue({ ok: false, status: 429, json: { success: false } });
    const { hook, dispatchEngine } = renderController();

    let cleared: boolean | undefined;
    await act(async () => {
      cleared = await hook.result.current.controller.actions.guardPaymentEntry();
    });

    expect(cleared).toBe(true);
    expect(dispatchEngine).not.toHaveBeenCalledWith(GOTO_ISSUE_DETAILS);
  });
});
