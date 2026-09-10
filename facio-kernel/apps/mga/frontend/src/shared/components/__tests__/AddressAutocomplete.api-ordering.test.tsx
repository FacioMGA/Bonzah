/* @vitest-environment happy-dom */
/**
 * Production regression: Google deprecated the legacy
 * `google.maps.places.AutocompleteService` for any API key issued after
 * 2025-03-01. The call still resolves with HTTP 200 but predictions come
 * back null with a deprecation error in the browser console — leaving
 * the dropdown silently empty for every customer on a modern key.
 *
 * Commit `02db9d23` (May 2026) reordered `AddressAutocomplete` to prefer
 * the legacy path "first" so existing staging keys would not hit
 * unsupported `places.googleapis.com` endpoints. That fixed staging but
 * silently broke production cy4, where the deployed key is a current
 * one. The "fix the fix" landed alongside ABY-82..88: try the modern
 * `AutocompleteSuggestion` API first, and only fall back to legacy when
 * the modern path is genuinely missing or rejects.
 *
 * This suite pins the contract with no UI rendering involved:
 *   1. When BOTH APIs are present, the modern path is invoked AND legacy
 *      is NOT invoked.
 *   2. When ONLY the legacy API is present (old staging keys), legacy IS
 *      invoked — preserving the original 2026-05-07 fix.
 *   3. When the modern API is present but rejects (e.g. Places API
 *      (New) not enabled on the project), the legacy API is attempted
 *      as a fallback — so a partial misconfiguration doesn't kill
 *      address autocomplete entirely.
 */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import AddressAutocomplete from '../AddressAutocomplete';

type GoogleWindow = typeof window & {
  google?: { maps?: { places?: Record<string, unknown> } };
  __facioGmAuthHooked?: boolean;
};

function Harness({ onSelect }: {
  onSelect: (data: { address: string; city: string; state: string; zip: string; country?: string }) => void;
}) {
  // Real controlled state so the input reflects what the user types
  // (the previous harness used a `vi.fn()` for `onChange`, which left
  // the parent value at "" forever and starved the debounced fetch).
  const [value, setValue] = useState('');
  const form = useForm();
  return (
    <FormProvider {...form}>
      <AddressAutocomplete value={value} onChange={setValue} onAddressSelect={onSelect} />
    </FormProvider>
  );
}

function installPlaces(places: Record<string, unknown>) {
  const w = window as GoogleWindow;
  w.google = { maps: { places } };
  // The script-loader effect short-circuits when `window.google.maps.places`
  // is already present, so we don't need to insert the loader `<script>`
  // tag at all — that's good, because happy-dom throws a `DOMException`
  // when asked to append a remote script. Setting `window.google` directly
  // is the cleanest stub.
}

afterEach(() => {
  const w = window as GoogleWindow;
  delete w.google;
  delete w.__facioGmAuthHooked;
  document.querySelectorAll('script[src*="maps.googleapis.com"]').forEach((s) => s.remove());
  vi.useRealTimers();
});

describe('AddressAutocomplete — modern API is preferred (production regression guard)', () => {
  it('calls the modern AutocompleteSuggestion API first when both APIs are available', async () => {
    const fetchAutocompleteSuggestions = vi.fn().mockResolvedValue({ suggestions: [] });
    const legacyGetPlacePredictions = vi.fn();
    installPlaces({
      AutocompleteSuggestion: { fetchAutocompleteSuggestions },
      AutocompleteSessionToken: function () { return {}; },
      AutocompleteService: function () {
        return { getPlacePredictions: legacyGetPlacePredictions };
      },
    });

    const { getByPlaceholderText } = render(<Harness onSelect={vi.fn()} />);

    const input = getByPlaceholderText('Search address...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10 Downing Street' } });

    // Component debounces 200ms then calls the API.
    await new Promise<void>((resolve) => setTimeout(resolve, 320));

    expect(fetchAutocompleteSuggestions).toHaveBeenCalledTimes(1);
    expect(fetchAutocompleteSuggestions).toHaveBeenCalledWith(expect.objectContaining({
      input: '10 Downing Street',
    }));
    // Critical: the broken commit `02db9d23` called this first and
    // never reached the modern path on production keys. Locking the
    // ordering keeps cy4 working.
    expect(legacyGetPlacePredictions).not.toHaveBeenCalled();
  });

  it('falls back to the legacy AutocompleteService when the modern API is not present (old staging keys)', async () => {
    const legacyGetPlacePredictions = vi.fn();
    installPlaces({
      // No `AutocompleteSuggestion` at all — old key shape.
      AutocompleteService: function () {
        return { getPlacePredictions: legacyGetPlacePredictions };
      },
    });

    const { getByPlaceholderText } = render(<Harness onSelect={vi.fn()} />);

    const input = getByPlaceholderText('Search address...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10 Downing Street' } });
    await new Promise<void>((resolve) => setTimeout(resolve, 320));

    expect(legacyGetPlacePredictions).toHaveBeenCalledTimes(1);
    expect(legacyGetPlacePredictions).toHaveBeenCalledWith(
      expect.objectContaining({ input: '10 Downing Street' }),
      expect.any(Function),
    );
  });

  it('falls back to legacy when the modern API rejects (Places API (New) not enabled on the project)', async () => {
    const fetchAutocompleteSuggestions = vi.fn().mockRejectedValue(new Error('Places API (New) is not enabled'));
    const legacyGetPlacePredictions = vi.fn();
    installPlaces({
      AutocompleteSuggestion: { fetchAutocompleteSuggestions },
      AutocompleteSessionToken: function () { return {}; },
      AutocompleteService: function () {
        return { getPlacePredictions: legacyGetPlacePredictions };
      },
    });

    const { getByPlaceholderText } = render(<Harness onSelect={vi.fn()} />);

    const input = getByPlaceholderText('Search address...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10 Downing Street' } });
    await new Promise<void>((resolve) => setTimeout(resolve, 320));

    expect(fetchAutocompleteSuggestions).toHaveBeenCalledTimes(1);
    expect(legacyGetPlacePredictions).toHaveBeenCalledTimes(1);
  });
});
