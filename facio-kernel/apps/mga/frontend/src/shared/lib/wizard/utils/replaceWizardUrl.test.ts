/* @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  replaceWizardStepInUrl,
  replaceWizardUrlIfChanged,
  stripWizardUrlSearchParams,
} from './replaceWizardUrl';

describe('replaceWizardUrlIfChanged', () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.history.replaceState(null, '', '/quote/session-token?product=travel&step=trip');
    replaceStateSpy = vi.spyOn(window.history, 'replaceState');
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
  });

  it('skips replaceState when the URL is already correct', () => {
    const changed = replaceWizardUrlIfChanged((url) => {
      url.searchParams.set('step', 'trip');
    });

    expect(changed).toBe(false);
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('calls replaceState only when the URL would change', () => {
    const changed = replaceWizardUrlIfChanged((url) => {
      url.searchParams.set('step', 'payment');
    });

    expect(changed).toBe(true);
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      '',
      '/quote/session-token?product=travel&step=payment',
    );
  });

  it('supports thank-you URL sync without redundant writes', () => {
    window.history.replaceState(null, '', '/quote/session-token?step=thank-you');
    replaceStateSpy.mockClear();

    const changed = replaceWizardStepInUrl('thank-you', { deleteParams: ['ref'] });

    expect(changed).toBe(false);
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('strips gateway params only when they are present', () => {
    window.history.replaceState(
      null,
      '',
      '/quote/session-token?step=payment&id=checkout-1&resourcePath=abc',
    );
    replaceStateSpy.mockClear();

    const changed = stripWizardUrlSearchParams(['id', 'resourcePath', 'result']);

    expect(changed).toBe(true);
    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      '',
      '/quote/session-token?step=payment',
    );
  });
});
