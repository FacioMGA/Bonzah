/* @vitest-environment happy-dom */
/**
 * Regression suite for ABY-352 — issue-details Registration/VIN either-or.
 *
 * The post-quote `issue-details` step renders ONE Registration/VIN switch
 * because the server lists BOTH `registrationNumber` and `vin` as missing
 * (so the UI can offer the choice). `validateMotorIssuanceStage` (ABY-104)
 * treats them as either-or: only one is required to issue.
 *
 * The bug: `onIssueDetailsSaveAndContinue`'s pre-save check looped over
 * each server-missing key independently, so a customer who filled
 * Registration (leaving VIN blank) was still blocked with
 * "Provide either Registration number OR VIN ... is required." on the VIN
 * field. The fix honours the either-or: when EITHER side has a value,
 * neither is flagged.
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

vi.mock('@facio/validation/frontend', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@facio/validation/frontend');
  return { ...actual, validateForContext: vi.fn() };
});

import * as api from './quoteWizard.api';
import * as issueReadinessClient from '@/src/shared/lib/wizard/issueReadinessClient';
import * as validation from '@facio/validation/frontend';

const mockedApi = vi.mocked(api);
const mockedReadiness = vi.mocked(issueReadinessClient);
const mockedValidation = vi.mocked(validation);

const EITHER_OR_LABEL = 'Provide either Registration number OR VIN — only one is required to issue.';

function readinessWithRegAndVinMissing() {
  return {
    ok: true,
    status: 200,
    json: {
      success: true,
      data: {
        blockers: [
          {
            code: 'DOCUMENT_FIELDS_MISSING',
            details: {
              missingFields: [
                { slug: 'vehicle.registration', label: EITHER_OR_LABEL },
                { slug: 'vehicle.vin', label: EITHER_OR_LABEL },
              ],
            },
          },
        ],
      },
    },
  };
}

function makeFullProposer(): NonNullable<QuoteData['proposer']> {
  return {
    ...(initialQuoteData.proposer ?? {}),
    firstName: 'Effie',
    lastName: 'Test',
    email: 'effie@example.com',
    phone: '+35799000000',
    dateOfBirth: '1990-01-01',
    address: {
      ...(initialQuoteData.proposer?.address ?? {}),
      line1: '1 Street',
      city: 'Limassol',
      province: 'Limassol',
      postcode: '3020',
      country: 'Cyprus',
    },
  };
}

function renderController(defaultValues: Partial<QuoteData>) {
  return renderHook(() => {
    const form = useForm<QuoteData>({ defaultValues: { ...initialQuoteData, ...defaultValues } });
    const controller = useQuoteWizardController({
      policyId: 'test-session-token',
      currentStep: 5,
      currentStepId: 'issue-details',
      dispatchEngine: vi.fn(),
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
    return { form, controller };
  });
}

describe('useQuoteWizardController — Registration/VIN either-or (ABY-352)', () => {
  let originalAlert: typeof window.alert;
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.patchPublicSessionQuoteData.mockResolvedValue({ ok: true, status: 200, json: { success: true } });
    mockedApi.rateQuote.mockResolvedValue({ ok: true, json: { success: true, data: { quoteId: 'q1' } } });
    mockedValidation.validateForContext.mockReturnValue({});
    originalAlert = window.alert;
    window.alert = vi.fn();
  });
  afterEach(() => {
    window.alert = originalAlert;
    vi.restoreAllMocks();
  });

  it('does NOT block Save & Continue when Registration is filled and VIN is blank', async () => {
    // First readiness call (gate populate) lists BOTH reg + vin missing;
    // after the save the server accepts the registration (no blockers).
    mockedReadiness.fetchIssueReadinessRaw
      .mockResolvedValueOnce(readinessWithRegAndVinMissing())
      .mockResolvedValue({ ok: true, status: 200, json: { success: true, data: { blockers: [] } } });

    const { result } = renderController({
      proposer: makeFullProposer(),
      registrationNumber: 'KAA123',
      vin: '',
      vehicleLocation: 'Cyprus',
      countryOfRegistration: 'Cyprus',
      coverRequired: 'Comprehensive',
      renewalDate: '2030-01-01',
    });

    await act(async () => {
      await result.current.controller.actions.runIssueReadinessGate();
    });

    await act(async () => {
      await result.current.controller.actions.onIssueDetailsSaveAndContinue();
    });

    // The save was reached (no false either-or block) and the flow
    // proceeded all the way to re-rating.
    expect(mockedApi.patchPublicSessionQuoteData).toHaveBeenCalledTimes(1);
    expect(mockedApi.rateQuote).toHaveBeenCalledTimes(1);
  });

  it('still blocks when BOTH Registration and VIN are blank', async () => {
    mockedReadiness.fetchIssueReadinessRaw.mockResolvedValue(readinessWithRegAndVinMissing());

    const { result } = renderController({
      proposer: makeFullProposer(),
      registrationNumber: '',
      vin: '',
      vehicleLocation: 'Cyprus',
      countryOfRegistration: 'Cyprus',
      coverRequired: 'Comprehensive',
      renewalDate: '2030-01-01',
    });

    await act(async () => {
      await result.current.controller.actions.runIssueReadinessGate();
    });

    await act(async () => {
      await result.current.controller.actions.onIssueDetailsSaveAndContinue();
    });

    // Neither identifier provided → blocked before save.
    expect(mockedApi.patchPublicSessionQuoteData).not.toHaveBeenCalled();
    expect(mockedApi.rateQuote).not.toHaveBeenCalled();
  });
});
