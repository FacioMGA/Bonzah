/* @vitest-environment happy-dom */
/**
 * Regression suite for ABY-236 (duplicated VIN question after save) and
 * ABY-237 ("Too many requests" after repeated save-and-continue clicks).
 *
 * Both bugs originated on the post-quote `issue-details` step. The fix
 * adds three guarantees to `onIssueDetailsSaveAndContinue`:
 *
 *  1. Re-entry guard: rapid double-clicks must not fan out into
 *     multiple `saveDraft` / `runIssueReadinessGate` / `rateQuote`
 *     calls that ultimately trip server-side 429 throttling.
 *  2. Canonical issuance pre-validation: a syntactically invalid VIN
 *     (e.g. too short, or containing I / O / Q) must be rejected
 *     BEFORE we hit the server, so the user does not see the same
 *     field "come back" as a re-asked missing field after a save.
 *  3. The 429 response must surface a friendly throttling message so
 *     the user understands why repeated clicks are failing.
 */
import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useQuoteWizardController } from './useQuoteWizardController';
import type { QuoteData, QuoteResponse } from './types';
import { initialQuoteData } from './quoteWizard.constants';
// Register motor's validation profile so `validateForContext({
// productCode: 'MOTOR' })` resolves the canonical issuance stage.
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

// Mock the validation runner so each test controls exactly which
// pre-validation errors the canonical issuance check returns. The
// real runner is exercised by `packages/products` schema tests
// (notably `issuanceStage.aby104.test.ts`); here we want surgical
// control over the controller's reaction to those errors.
vi.mock('@facio/validation/frontend', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@facio/validation/frontend');
  return {
    ...actual,
    validateForContext: vi.fn(),
  };
});

import * as api from './quoteWizard.api';
import * as issueReadinessClient from '@/src/shared/lib/wizard/issueReadinessClient';
import * as validation from '@facio/validation/frontend';

const mockedApi = vi.mocked(api);
const mockedReadiness = vi.mocked(issueReadinessClient);
const mockedValidation = vi.mocked(validation);

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

type ControllerFixture = ReturnType<typeof useQuoteWizardController>;

type RenderFixtureResult = {
  controller: ControllerFixture;
};

function renderController(defaultValues: Partial<QuoteData>) {
  // Render the real RHF `useForm` alongside the controller in a single
  // `renderHook` so the controller receives a properly typed
  // `UseFormReturn<QuoteData>` — no hand-rolled mock, no struct casts.
  return renderHook(
    (): RenderFixtureResult => {
      const form = useForm<QuoteData>({
        defaultValues: { ...initialQuoteData, ...defaultValues },
      });
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
      return { controller };
    },
  );
}

const INVALID_VIN_DEFAULTS: Partial<QuoteData> = {
  proposer: makeFullProposer(),
  registrationNumber: '',
  vin: 'IOQ',
  vehicleLocation: 'Cyprus',
  countryOfRegistration: 'Cyprus',
  coverRequired: 'Comprehensive',
  renewalDate: '2030-01-01',
};

const VALID_REG_DEFAULTS: Partial<QuoteData> = {
  proposer: makeFullProposer(),
  registrationNumber: 'KAA123',
  vin: '',
  vehicleLocation: 'Cyprus',
  countryOfRegistration: 'Cyprus',
  coverRequired: 'Comprehensive',
  renewalDate: '2030-01-01',
};

type AlertFn = (message?: string) => void;

describe('useQuoteWizardController — onIssueDetailsSaveAndContinue', () => {
  let alertMock: ReturnType<typeof vi.fn<AlertFn>>;
  let originalAlert: typeof window.alert;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.patchPublicSessionQuoteData.mockResolvedValue({ ok: true, status: 200, json: { success: true } });
    mockedApi.rateQuote.mockResolvedValue({ ok: true, json: { success: true, data: { quoteId: 'q1' } } });
    mockedReadiness.fetchIssueReadinessRaw.mockResolvedValue({ ok: true, status: 200, json: { success: true, data: { blockers: [] } } });
    // Default: pre-validation passes. Individual tests override this.
    mockedValidation.validateForContext.mockReturnValue({});
    // happy-dom doesn't define `window.alert` as a real function, so
    // vi.spyOn fails. Wrap the mock in a typed arrow so the assignment
    // matches `window.alert`'s exact signature without a struct cast.
    originalAlert = window.alert;
    alertMock = vi.fn<AlertFn>();
    window.alert = alertMock;
  });

  afterEach(() => {
    window.alert = originalAlert;
    vi.restoreAllMocks();
  });

  // ABY-236 — invalid VIN format must be caught client-side before we
  // round-trip to the server. Simulates the canonical
  // `validateMotorIssuanceStage` regex check rejecting the VIN.
  it('does not call saveDraft when the canonical issuance check rejects the VIN format', async () => {
    mockedValidation.validateForContext.mockReturnValue({
      vin: 'VIN must be 11-17 characters and cannot contain I, O, or Q',
    });

    const { result } = renderController(INVALID_VIN_DEFAULTS);

    await act(async () => {
      await result.current.controller.actions.onIssueDetailsSaveAndContinue();
    });

    expect(mockedValidation.validateForContext).toHaveBeenCalledWith(
      expect.objectContaining({
        productCode: 'MOTOR',
        stage: { kind: 'stage', id: 'issuance' },
      }),
    );
    expect(mockedApi.patchPublicSessionQuoteData).not.toHaveBeenCalled();
    expect(mockedReadiness.fetchIssueReadinessRaw).not.toHaveBeenCalled();
    expect(mockedApi.rateQuote).not.toHaveBeenCalled();
  });

  // ABY-237 — rapid double-click should NOT fan out into multiple
  // network requests. The re-entry guard makes the handler idempotent
  // while a save is already in flight.
  it('coalesces a rapid double-click into a single saveDraft call', async () => {
    // Hold the saveDraft network until both clicks have landed so the
    // re-entry guard can be observed.
    let resolveSave: (value: { ok: boolean; status: number; json: { success: boolean } }) => void = () => {};
    mockedApi.patchPublicSessionQuoteData.mockImplementation(
      () => new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    const { result } = renderController(VALID_REG_DEFAULTS);

    await act(async () => {
      // Two rapid clicks before the in-flight save resolves.
      void result.current.controller.actions.onIssueDetailsSaveAndContinue();
      void result.current.controller.actions.onIssueDetailsSaveAndContinue();
    });

    expect(mockedApi.patchPublicSessionQuoteData).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave({ ok: true, status: 200, json: { success: true } });
      await Promise.resolve();
    });
  });

  // ABY-237 — when the server throttles a save, the user must see a
  // friendly "you're saving too quickly" message instead of the
  // generic "we could not save your updates".
  it('surfaces a throttling-specific alert when the save returns 429', async () => {
    mockedApi.patchPublicSessionQuoteData.mockResolvedValue({ ok: false, status: 429, json: { success: false } });

    const { result } = renderController(VALID_REG_DEFAULTS);

    await act(async () => {
      await result.current.controller.actions.onIssueDetailsSaveAndContinue();
    });

    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(String(alertMock.mock.calls[0]?.[0] ?? '').toLowerCase()).toContain('too quickly');
  });
});
