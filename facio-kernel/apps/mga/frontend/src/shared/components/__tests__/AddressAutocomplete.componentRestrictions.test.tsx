/* @vitest-environment happy-dom */
/**
 * ABY-299 regression: when `componentRestrictions` is supplied, the
 * Google Places suggestion fetch (modern AND legacy paths) must
 * carry the country filter through to Google. Otherwise the
 * customer-facing HOME / proposer-address dropdown re-acquires the
 * USA / international suggestions that motivated the ticket
 * (peter@abbeygate.cy: "Pre emotive addresses need to bo only EU or
 * leave off USA looks confusing").
 *
 * - Modern API: `includedRegionCodes`
 * - Legacy API: `componentRestrictions: { country: [...] }`
 *
 * Both shapes are pinned here. Empty / undefined restrictions must
 * NOT leak into the request — that would silently drop suggestions
 * on BO surfaces that legitimately need international addresses.
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

function Harness({
  componentRestrictions,
}: {
  componentRestrictions?: string[];
}) {
  const [value, setValue] = useState('');
  const form = useForm();
  return (
    <FormProvider {...form}>
      <AddressAutocomplete
        value={value}
        onChange={setValue}
        onAddressSelect={vi.fn()}
        componentRestrictions={componentRestrictions}
      />
    </FormProvider>
  );
}

function installPlaces(places: Record<string, unknown>) {
  const w = window as GoogleWindow;
  w.google = { maps: { places } };
}

afterEach(() => {
  const w = window as GoogleWindow;
  delete w.google;
  delete w.__facioGmAuthHooked;
  document.querySelectorAll('script[src*="maps.googleapis.com"]').forEach((s) => s.remove());
  vi.useRealTimers();
});

describe('AddressAutocomplete — componentRestrictions threading (ABY-299)', () => {
  it('passes includedRegionCodes through to the modern AutocompleteSuggestion API', async () => {
    const fetchAutocompleteSuggestions = vi.fn().mockResolvedValue({ suggestions: [] });
    installPlaces({
      AutocompleteSuggestion: { fetchAutocompleteSuggestions },
      AutocompleteSessionToken: function () { return {}; },
    });

    const { getByPlaceholderText } = render(<Harness componentRestrictions={['CY']} />);
    const input = getByPlaceholderText('Search address...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10 Demosthenis Severis' } });

    await new Promise<void>((resolve) => setTimeout(resolve, 320));

    expect(fetchAutocompleteSuggestions).toHaveBeenCalledTimes(1);
    expect(fetchAutocompleteSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: '10 Demosthenis Severis',
        includedRegionCodes: ['CY'],
      }),
    );
  });

  it('passes componentRestrictions.country through to the legacy AutocompleteService when modern API is missing', async () => {
    const legacyGetPlacePredictions = vi.fn();
    installPlaces({
      AutocompleteService: function () {
        return { getPlacePredictions: legacyGetPlacePredictions };
      },
    });

    const { getByPlaceholderText } = render(<Harness componentRestrictions={['PT']} />);
    const input = getByPlaceholderText('Search address...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Avenida da Liberdade' } });

    await new Promise<void>((resolve) => setTimeout(resolve, 320));

    expect(legacyGetPlacePredictions).toHaveBeenCalledTimes(1);
    expect(legacyGetPlacePredictions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'Avenida da Liberdade',
        componentRestrictions: { country: ['PT'] },
      }),
      expect.any(Function),
    );
  });

  it('omits the country filter entirely when componentRestrictions is undefined (BO surfaces unaffected)', async () => {
    const fetchAutocompleteSuggestions = vi.fn().mockResolvedValue({ suggestions: [] });
    installPlaces({
      AutocompleteSuggestion: { fetchAutocompleteSuggestions },
      AutocompleteSessionToken: function () { return {}; },
    });

    const { getByPlaceholderText } = render(<Harness />);
    const input = getByPlaceholderText('Search address...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '350 Fifth Avenue' } });

    await new Promise<void>((resolve) => setTimeout(resolve, 320));

    expect(fetchAutocompleteSuggestions).toHaveBeenCalledTimes(1);
    const [arg] = fetchAutocompleteSuggestions.mock.calls[0];
    expect(arg).not.toHaveProperty('includedRegionCodes');
  });

  it('drops invalid / non-ISO country codes and caps at Google\'s max of 5', async () => {
    const fetchAutocompleteSuggestions = vi.fn().mockResolvedValue({ suggestions: [] });
    installPlaces({
      AutocompleteSuggestion: { fetchAutocompleteSuggestions },
      AutocompleteSessionToken: function () { return {}; },
    });

    // Mix of garbage entries (whitespace, lowercase, multi-char) and valid
    // codes. The valid ones (uppercased) should be the only ones forwarded
    // to Google and the list should be sliced to ≤5.
    const { getByPlaceholderText } = render(
      <Harness componentRestrictions={[' cy ', 'pt', 'GR', 'es', 'gb', 'IT', 'FR', '???', 'XYZ']} />,
    );
    const input = getByPlaceholderText('Search address...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Plateia Eleftherias' } });

    await new Promise<void>((resolve) => setTimeout(resolve, 320));

    expect(fetchAutocompleteSuggestions).toHaveBeenCalledTimes(1);
    const [arg] = fetchAutocompleteSuggestions.mock.calls[0];
    expect(arg.includedRegionCodes).toEqual(['CY', 'PT', 'GR', 'ES', 'GB']);
  });
});
