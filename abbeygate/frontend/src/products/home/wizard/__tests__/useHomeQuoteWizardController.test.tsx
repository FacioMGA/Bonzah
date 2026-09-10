/* @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import type { MockedObject } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicSessionAdapter } from '@/src/shared/lib/wizard';
import { useHomeQuoteWizardController } from '../useHomeQuoteWizardController';
import '@/src/products/home/register';

// Mock the validation runner so each test controls exactly which
// errors the canonical home validation profile returns. Per mock
// policy: mocking at the validation library boundary, not at the
// controller under test.
vi.mock('@facio/validation/frontend', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@facio/validation/frontend');
  return {
    ...actual,
    validateForContext: vi.fn(),
    applyValidationErrors: vi.fn(),
  };
});

// The production QuoteLoadingGate enforces a 3s minimum loader visible
// time so the customer-facing animation never flashes. In unit tests we
// short-circuit it so the controller's rate path doesn't add seconds
// per test (keeps the tier-1 budget honest).
vi.mock('@/src/shared/lib/wizard/quote/QuoteLoadingGate', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/src/shared/lib/wizard/quote/QuoteLoadingGate',
  );
  return {
    ...actual,
    QUOTE_LOADER_MIN_DELAY_MS: 0,
  };
});

import * as validation from '@facio/validation/frontend';

const mockedValidation = vi.mocked(validation);

// Stubbed adapter — `MockedObject<PublicSessionAdapter>` maps every
// method to a `MockedFunction`, which is both callable as the canonical
// contract method (so `sessionAdapter: adapter` assigns without any
// cast) and exposes `.mockResolvedValueOnce` etc. for per-test return
// scripting. Removes the need for a double-cast through `unknown`.
type StubAdapter = MockedObject<PublicSessionAdapter>;

function makeAdapter(): StubAdapter {
  return {
    patch: vi.fn(async () => ({ ok: true, session: {} })),
    rate: vi.fn(async () => ({ ok: true, quoteResponse: { status: 'QUOTED' } })),
    load: vi.fn(async () => ({ ok: true, session: {} })),
    create: vi.fn(async () => ({ ok: true, publicId: 'tok' })),
    issue: vi.fn(async () => ({ ok: true, policyId: 'pol_1' })),
    fork: vi.fn(async () => ({ ok: true, publicId: 'tok_2' })),
  };
}

function renderController(currentStepId: string, adapter: StubAdapter) {
  const dispatchEngine = vi.fn();
  const setQuoteResponse = vi.fn();
  const scrollToTop = vi.fn();
  const harness = renderHook(() => {
    const form = useForm({ defaultValues: {} });
    const controller = useHomeQuoteWizardController({
      policyId: 'tok_home',
      currentStepId,
      dispatchEngine,
      form,
      sessionAdapter: adapter,
      quoteResponse: null,
      setQuoteResponse,
      scrollToTop,
    });
    return { controller, form };
  });
  return { harness, dispatchEngine, setQuoteResponse, scrollToTop };
}

type AlertFn = (message?: string) => void;

describe('useHomeQuoteWizardController — spine', () => {
  let originalAlert: typeof window.alert;
  let alertMock: ReturnType<typeof vi.fn<AlertFn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedValidation.validateForContext.mockReturnValue({});
    originalAlert = window.alert;
    alertMock = vi.fn<AlertFn>();
    window.alert = alertMock;
  });

  afterEach(() => {
    window.alert = originalAlert;
  });

  describe('validateCurrentStep', () => {
    it('returns true and clears stale RHF errors when the canonical profile passes (ABY-271)', () => {
      // ABY-271 regression: previously `applyValidationErrors` was only
      // called when errors were present, which left manual errors set on
      // a previous step submission (e.g. "proposer.phone is required"
      // raised while the user was on policy-holder) stuck in the form
      // state. Surfaced to the customer as a phone validation error on
      // the property page even though phone was already filled.
      const adapter = makeAdapter();
      const { harness } = renderController('property', adapter);
      const ok = harness.result.current.controller.actions.validateCurrentStep();
      expect(ok).toBe(true);
      expect(mockedValidation.applyValidationErrors).toHaveBeenCalledTimes(1);
      expect(mockedValidation.applyValidationErrors).toHaveBeenCalledWith(expect.anything(), {});
    });

    it('returns false and surfaces errors to RHF when the canonical profile rejects', () => {
      mockedValidation.validateForContext.mockReturnValueOnce({
        'address.postcode': 'Required',
      });
      const adapter = makeAdapter();
      const { harness, scrollToTop } = renderController('property', adapter);
      const ok = harness.result.current.controller.actions.validateCurrentStep();
      expect(ok).toBe(false);
      expect(mockedValidation.applyValidationErrors).toHaveBeenCalledTimes(1);
      expect(scrollToTop).toHaveBeenCalled();
    });

    it('skips validation for unknown step ids (no profile gate registered)', () => {
      const adapter = makeAdapter();
      const { harness } = renderController('unknown-step', adapter);
      const ok = harness.result.current.controller.actions.validateCurrentStep();
      expect(ok).toBe(true);
      expect(mockedValidation.validateForContext).not.toHaveBeenCalled();
    });
  });

  describe('saveDraft', () => {
    it('PATCHes the session with the current form values + step id', async () => {
      const adapter = makeAdapter();
      const { harness } = renderController('policy-holder', adapter);
      let saved = false;
      await act(async () => {
        saved = await harness.result.current.controller.actions.saveDraft();
      });
      expect(saved).toBe(true);
      expect(adapter.patch).toHaveBeenCalledTimes(1);
      expect(adapter.patch).toHaveBeenCalledWith('tok_home', expect.objectContaining({
        step: 'policy-holder',
        materializeAccount: true,
      }));
    });

    it('does NOT materialize a customer account except on the policy-holder step', async () => {
      const adapter = makeAdapter();
      const { harness } = renderController('sums-insured', adapter);
      await act(async () => {
        await harness.result.current.controller.actions.saveDraft();
      });
      expect(adapter.patch).toHaveBeenCalledWith('tok_home', expect.objectContaining({
        step: 'sums-insured',
        materializeAccount: false,
      }));
    });

    it('returns false when the session adapter reports failure (no swallow)', async () => {
      const adapter = makeAdapter();
      adapter.patch.mockResolvedValueOnce({ ok: false, session: null });
      const { harness } = renderController('property', adapter);
      let saved = true;
      await act(async () => {
        saved = await harness.result.current.controller.actions.saveDraft();
      });
      expect(saved).toBe(false);
    });
  });

  describe('rateQuote', () => {
    it('reports the QUOTED status into engine context patch on success', async () => {
      const adapter = makeAdapter();
      adapter.rate.mockResolvedValueOnce({
        ok: true,
        quoteResponse: { status: 'QUOTED', primaryOption: {} },
      });
      const { harness, setQuoteResponse } = renderController('security', adapter);
      let ok = false;
      await act(async () => {
        ok = await harness.result.current.controller.actions.rateQuote();
      });
      expect(ok).toBe(true);
      expect(setQuoteResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 'QUOTED' }));
    });

    it('returns true (terminal) when the engine reports REFERRAL or DECLINED', async () => {
      const adapter = makeAdapter();
      adapter.rate.mockResolvedValueOnce({
        ok: true,
        quoteResponse: { status: 'REFERRAL' },
      });
      const { harness } = renderController('security', adapter);
      let ok = false;
      await act(async () => {
        ok = await harness.result.current.controller.actions.rateQuote();
      });
      expect(ok).toBe(true);
    });

    it('returns false when rate-stage canonical validation fails (surfaces RHF errors instead of round-tripping)', async () => {
      mockedValidation.validateForContext.mockReturnValueOnce({ ncbBlock: 'Required' });
      const adapter = makeAdapter();
      const { harness } = renderController('security', adapter);
      let ok = true;
      await act(async () => {
        ok = await harness.result.current.controller.actions.rateQuote();
      });
      expect(ok).toBe(false);
      expect(adapter.rate).not.toHaveBeenCalled();
    });

    it('returns false when the adapter reports the rate call failed', async () => {
      const adapter = makeAdapter();
      adapter.rate.mockResolvedValueOnce({ ok: false, quoteResponse: null });
      const { harness } = renderController('security', adapter);
      let ok = true;
      await act(async () => {
        ok = await harness.result.current.controller.actions.rateQuote();
      });
      expect(ok).toBe(false);
    });
  });

  describe('onNext', () => {
    it('blocks the transition when validateCurrentStep fails (no save, no rate, no nav dispatch)', async () => {
      mockedValidation.validateForContext.mockReturnValueOnce({ x: 'oops' });
      const adapter = makeAdapter();
      const { harness, dispatchEngine } = renderController('property', adapter);
      await act(async () => {
        await harness.result.current.controller.actions.onNext();
      });
      expect(adapter.patch).not.toHaveBeenCalled();
      expect(adapter.rate).not.toHaveBeenCalled();
      expect(dispatchEngine).not.toHaveBeenCalled();
    });

    it('saves then dispatches NAV.NEXT for mid-flow form steps', async () => {
      const adapter = makeAdapter();
      const { harness, dispatchEngine } = renderController('property', adapter);
      await act(async () => {
        await harness.result.current.controller.actions.onNext();
      });
      expect(adapter.patch).toHaveBeenCalledTimes(1);
      expect(adapter.rate).not.toHaveBeenCalled();
      expect(dispatchEngine).toHaveBeenCalledWith({ type: 'NAV.NEXT' });
    });

    it('rates exactly once on the security -> your-quote transition', async () => {
      const adapter = makeAdapter();
      adapter.rate.mockResolvedValueOnce({
        ok: true,
        quoteResponse: { status: 'QUOTED' },
      });
      const { harness, dispatchEngine } = renderController('security', adapter);
      await act(async () => {
        await harness.result.current.controller.actions.onNext();
      });
      expect(adapter.rate).toHaveBeenCalledTimes(1);
      expect(dispatchEngine).toHaveBeenCalledWith({ type: 'NAV.NEXT' });
    });

    it('does NOT save on review/payment/success steps (mirrors motor.session.saveDraft skip list)', async () => {
      const adapter = makeAdapter();
      const { harness, dispatchEngine } = renderController('your-quote', adapter);
      await act(async () => {
        await harness.result.current.controller.actions.onNext();
      });
      expect(adapter.patch).not.toHaveBeenCalled();
      expect(dispatchEngine).toHaveBeenCalledWith({ type: 'NAV.NEXT' });
    });
  });

  describe('onBack', () => {
    it('dispatches NAV.BACK without saving or rating', () => {
      const adapter = makeAdapter();
      const { harness, dispatchEngine } = renderController('property', adapter);
      act(() => {
        harness.result.current.controller.actions.onBack();
      });
      expect(adapter.patch).not.toHaveBeenCalled();
      expect(adapter.rate).not.toHaveBeenCalled();
      expect(dispatchEngine).toHaveBeenCalledWith({ type: 'NAV.BACK' });
    });
  });
});
